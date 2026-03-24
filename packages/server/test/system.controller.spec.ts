import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import request from 'supertest';
import { SystemController } from '../src/system/system.controller';
import { DatabaseService } from '../src/storage/database.service';
import { EmbeddingService } from '../src/embedding/embedding.service';
import { EmbeddingQueueService } from '../src/queue/embedding-queue.service';
import { SemanticQueueService } from '../src/queue/semantic-queue.service';
import { QueueStats } from '../src/queue/async-queue';
import { RequestContextInterceptor } from '../src/shared/request-context.interceptor';

describe('SystemController (HTTP)', () => {
  let app: INestApplication;
  let mockDb: Partial<DatabaseService>;
  let mockEmbedding: Partial<EmbeddingService>;
  let mockEmbeddingQueue: Partial<EmbeddingQueueService>;
  let mockSemanticQueue: Partial<SemanticQueueService>;

  const idleStats: QueueStats = { queued: 0, active: 0, processed: 0, errors: 0 };

  beforeEach(async () => {
    mockDb = {
      db: {
        prepare: jest.fn().mockReturnValue({ get: jest.fn().mockReturnValue({ 1: 1 }) }),
      } as unknown as DatabaseService['db'],
    };

    mockEmbedding = {
      getDimension: jest.fn().mockReturnValue(1536),
    };

    mockEmbeddingQueue = {
      getStats: jest.fn().mockReturnValue(idleStats),
    };

    mockSemanticQueue = {
      getStats: jest.fn().mockReturnValue(idleStats),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [
        { provide: DatabaseService, useValue: mockDb },
        { provide: EmbeddingService, useValue: mockEmbedding },
        { provide: EmbeddingQueueService, useValue: mockEmbeddingQueue },
        { provide: SemanticQueueService, useValue: mockSemanticQueue },
        { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /ready', () => {
    it('should return 200 with checks when all subsystems ok', async () => {
      const res = await request(app.getHttpServer())
        .get('/ready')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.status).toBe('ready');
      expect(res.body.result.checks.db).toBe('ok');
      expect(res.body.result.checks.embedding).toBe('ok');
    });

    it('should return 503 when db check fails', async () => {
      const failDb = {
        db: {
          prepare: jest.fn().mockImplementation(() => { throw new Error('db down'); }),
        } as unknown as DatabaseService['db'],
      };

      const failModule = await Test.createTestingModule({
        controllers: [SystemController],
        providers: [
          { provide: DatabaseService, useValue: failDb },
          { provide: EmbeddingService, useValue: mockEmbedding },
          { provide: EmbeddingQueueService, useValue: mockEmbeddingQueue },
          { provide: SemanticQueueService, useValue: mockSemanticQueue },
        ],
      }).compile();

      const failApp = failModule.createNestApplication();
      await failApp.init();

      const res = await request(failApp.getHttpServer())
        .get('/ready')
        .expect(503);

      expect(res.body.status).toBe('error');
      await failApp.close();
    });

    it('should return 503 when embedding check fails', async () => {
      (mockEmbedding.getDimension as jest.Mock).mockReturnValue(0);

      const res = await request(app.getHttpServer())
        .get('/ready')
        .expect(503);

      expect(res.body.status).toBe('error');
    });
  });

  describe('GET /api/v1/system/status', () => {
    it('should return initialized status with default user and agent', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/system/status')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.initialized).toBe(true);
      expect(res.body.result.version).toBe('0.1.0');
      expect(res.body.result.user).toBe('default');
      expect(res.body.result.agent).toBe('default');
    });

    it('should return user and agent from request headers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/system/status')
        .set('X-OpenViking-User', 'freerk')
        .set('X-OpenViking-Agent', 'main')
        .expect(200);

      expect(res.body.result.user).toBe('freerk');
      expect(res.body.result.agent).toBe('main');
    });
  });

  describe('POST /api/v1/system/wait', () => {
    it('should return drained true when queues are idle', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/system/wait')
        .send({ timeout: 1000 })
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.drained).toBe(true);
    });

    it('should return drained false on timeout when queues busy', async () => {
      const busyStats: QueueStats = { queued: 5, active: 1, processed: 0, errors: 0 };
      (mockEmbeddingQueue.getStats as jest.Mock).mockReturnValue(busyStats);

      const res = await request(app.getHttpServer())
        .post('/api/v1/system/wait')
        .send({ timeout: 300 })
        .expect(200);

      expect(res.body.result.drained).toBe(false);
      expect(res.body.result.reason).toBe('timeout');
    });
  });
});
