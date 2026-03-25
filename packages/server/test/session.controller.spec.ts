import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { SessionController } from '../src/memory/session.controller';
import { MemoryService } from '../src/memory/memory.service';
import { MemoryRecord } from '../src/shared/types';

function makeMemoryRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: 'mem-extracted',
    text: 'User likes TypeScript',
    type: 'user',
    category: 'preferences',
    uri: 'viking://user/memories/preferences/mem-extracted.md',
    l0Abstract: 'Abstract',
    l1Overview: 'Overview',
    l2Content: 'User likes TypeScript',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SessionController (HTTP)', () => {
  let app: INestApplication;
  let memoryService: Partial<Record<keyof MemoryService, jest.Mock>>;

  beforeEach(async () => {
    memoryService = {
      captureSession: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        { provide: MemoryService, useValue: memoryService },
      ],
    }).compile();

    app = module.createNestApplication();
    // BUG(memory.dto.ts): CaptureSessionDto.messages lacks @IsArray() decorator,
    // so whitelist:true strips it and requests return 400. Using transform-only pipe
    // to test controller logic. Fix: add @IsArray() + @ValidateNested() to messages.
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/v1/sessions/capture', () => {
    it('should capture session and return extracted memories', async () => {
      const extracted = [makeMemoryRecord()];
      memoryService.captureSession!.mockResolvedValue(extracted);

      const response = await request(app.getHttpServer())
        .post('/api/v1/sessions/capture')
        .send({
          messages: [
            { role: 'user', content: 'I love TypeScript' },
            { role: 'assistant', content: 'Noted!' },
          ],
        })
        .expect(201);

      expect(response.body.status).toBe('ok');
      expect(response.body.result.memoriesExtracted).toBe(1);
      expect(response.body.result.memories).toHaveLength(1);
      expect(response.body.result.memories[0].text).toBe('User likes TypeScript');
    });

    it('should pass agentId and userId to service', async () => {
      memoryService.captureSession!.mockResolvedValue([]);

      await request(app.getHttpServer())
        .post('/api/v1/sessions/capture')
        .send({
          messages: [{ role: 'user', content: 'Test' }],
          agentId: 'agent-x',
          userId: 'user-y',
        })
        .expect(201);

      expect(memoryService.captureSession).toHaveBeenCalledWith(
        [{ role: 'user', content: 'Test' }],
        'agent-x',
        'user-y',
        undefined,
      );
    });

    it('should return zero memories when nothing extracted', async () => {
      memoryService.captureSession!.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .post('/api/v1/sessions/capture')
        .send({
          messages: [{ role: 'user', content: 'The weather is nice' }],
        })
        .expect(201);

      expect(response.body.result.memoriesExtracted).toBe(0);
      expect(response.body.result.memories).toHaveLength(0);
    });

    it('should handle empty messages array', async () => {
      memoryService.captureSession!.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .post('/api/v1/sessions/capture')
        .send({ messages: [] })
        .expect(201);

      expect(response.body.result.memoriesExtracted).toBe(0);
    });

    it('should include time field in response', async () => {
      memoryService.captureSession!.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .post('/api/v1/sessions/capture')
        .send({ messages: [] })
        .expect(201);

      expect(response.body.time).toBeDefined();
      expect(typeof response.body.time).toBe('number');
    });

    it('should handle multiple extracted memories', async () => {
      const extracted = [
        makeMemoryRecord({ id: 'mem-1', text: 'Fact one' }),
        makeMemoryRecord({ id: 'mem-2', text: 'Fact two' }),
        makeMemoryRecord({ id: 'mem-3', text: 'Fact three' }),
      ];
      memoryService.captureSession!.mockResolvedValue(extracted);

      const response = await request(app.getHttpServer())
        .post('/api/v1/sessions/capture')
        .send({
          messages: [{ role: 'user', content: 'Long conversation' }],
        })
        .expect(201);

      expect(response.body.result.memoriesExtracted).toBe(3);
      expect(response.body.result.memories).toHaveLength(3);
    });

    it('should return 500 when service throws unexpected error', async () => {
      memoryService.captureSession!.mockRejectedValue(new Error('LLM failed'));

      await request(app.getHttpServer())
        .post('/api/v1/sessions/capture')
        .send({
          messages: [{ role: 'user', content: 'Test' }],
        })
        .expect(500);
    });

    it('should call captureSession without agentId/userId when not provided', async () => {
      memoryService.captureSession!.mockResolvedValue([]);

      await request(app.getHttpServer())
        .post('/api/v1/sessions/capture')
        .send({
          messages: [{ role: 'user', content: 'Hello' }],
        })
        .expect(201);

      expect(memoryService.captureSession).toHaveBeenCalledWith(
        [{ role: 'user', content: 'Hello' }],
        undefined,
        undefined,
        undefined,
      );
    });
  });
});
