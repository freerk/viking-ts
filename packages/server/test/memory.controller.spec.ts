import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { MemoryController } from '../src/memory/memory.controller';
import { MemoryService } from '../src/memory/memory.service';
import { MemoryRecord } from '../src/shared/types';

function makeMemoryRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: 'mem-123',
    text: 'Test memory',
    type: 'user',
    category: 'general',
    uri: 'viking://user/memories/general/mem-123.md',
    l0Abstract: 'Abstract',
    l1Overview: 'Overview',
    l2Content: 'Test memory',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('MemoryController (HTTP)', () => {
  let app: INestApplication;
  let memoryService: Partial<Record<keyof MemoryService, jest.Mock>>;

  beforeEach(async () => {
    memoryService = {
      createMemory: jest.fn(),
      searchMemories: jest.fn(),
      listMemories: jest.fn(),
      getMemory: jest.fn(),
      deleteMemory: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [
        { provide: MemoryService, useValue: memoryService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/v1/memories', () => {
    it('should create a memory and return 201', async () => {
      const record = makeMemoryRecord();
      memoryService.createMemory!.mockResolvedValue(record);

      const response = await request(app.getHttpServer())
        .post('/api/v1/memories')
        .send({ text: 'Test memory', type: 'user', category: 'general' })
        .expect(201);

      expect(response.body.status).toBe('ok');
      expect(response.body.result.id).toBe('mem-123');
      expect(response.body.result.text).toBe('Test memory');
    });

    it('should create a memory with only required fields', async () => {
      const record = makeMemoryRecord();
      memoryService.createMemory!.mockResolvedValue(record);

      await request(app.getHttpServer())
        .post('/api/v1/memories')
        .send({ text: 'Minimal memory' })
        .expect(201);

      expect(memoryService.createMemory).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Minimal memory' }),
      );
    });

    it('should return 400 when text is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/memories')
        .send({})
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should return 400 for invalid type enum', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/memories')
        .send({ text: 'Test', type: 'invalid' })
        .expect(400);
    });

    it('should return 400 for invalid category enum', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/memories')
        .send({ text: 'Test', category: 'nonexistent' })
        .expect(400);
    });

    it('should return 400 for unknown fields (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/memories')
        .send({ text: 'Test', unknownField: 'bad' })
        .expect(400);
    });

    it('should accept all valid optional fields', async () => {
      const record = makeMemoryRecord();
      memoryService.createMemory!.mockResolvedValue(record);

      await request(app.getHttpServer())
        .post('/api/v1/memories')
        .send({
          text: 'Full payload',
          type: 'agent',
          category: 'preferences',
          agentId: 'agent-1',
          userId: 'user-1',
          uri: 'viking://agent/memories/preferences/custom.md',
        })
        .expect(201);

      expect(memoryService.createMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Full payload',
          type: 'agent',
          category: 'preferences',
          agentId: 'agent-1',
          userId: 'user-1',
          uri: 'viking://agent/memories/preferences/custom.md',
        }),
      );
    });

    it('should return 400 for non-string text', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/memories')
        .send({ text: 12345 })
        .expect(400);
    });

    it('should include time field in response', async () => {
      const record = makeMemoryRecord();
      memoryService.createMemory!.mockResolvedValue(record);

      const response = await request(app.getHttpServer())
        .post('/api/v1/memories')
        .send({ text: 'Time test' })
        .expect(201);

      expect(response.body.time).toBeDefined();
      expect(typeof response.body.time).toBe('number');
    });
  });

  describe('GET /api/v1/memories/search', () => {
    it('should search memories with query', async () => {
      memoryService.searchMemories!.mockResolvedValue([
        { id: 'mem-1', uri: 'viking://user/memories/general/mem-1.md', text: 'Found', score: 0.95, l0Abstract: 'Abstract' },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/memories/search')
        .query({ q: 'TypeScript' })
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result).toHaveLength(1);
      expect(response.body.result[0].score).toBe(0.95);
    });

    it('should pass limit and scoreThreshold to service', async () => {
      memoryService.searchMemories!.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/memories/search')
        .query({ q: 'test', limit: '3', scoreThreshold: '0.5' })
        .expect(200);

      expect(memoryService.searchMemories).toHaveBeenCalledWith('test', 3, 0.5, undefined);
    });

    it('should pass uri filter when provided', async () => {
      memoryService.searchMemories!.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/memories/search')
        .query({ q: 'test', uri: 'viking://user/memories/' })
        .expect(200);

      expect(memoryService.searchMemories).toHaveBeenCalledWith(
        'test', 6, 0.01, 'viking://user/memories/',
      );
    });
  });

  describe('GET /api/v1/memories', () => {
    it('should list memories', async () => {
      memoryService.listMemories!.mockReturnValue([makeMemoryRecord()]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/memories')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result).toHaveLength(1);
    });

    it('should pass filter parameters to service', async () => {
      memoryService.listMemories!.mockReturnValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/memories')
        .query({ type: 'user', category: 'preferences', limit: '10', offset: '5' })
        .expect(200);

      expect(memoryService.listMemories).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'user',
          category: 'preferences',
          limit: 10,
          offset: 5,
        }),
      );
    });

    it('should use default limit and offset', async () => {
      memoryService.listMemories!.mockReturnValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/memories')
        .expect(200);

      expect(memoryService.listMemories).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100, offset: 0 }),
      );
    });
  });

  describe('GET /api/v1/memories/:id', () => {
    it('should return a memory by ID', async () => {
      const record = makeMemoryRecord({ id: 'specific-id' });
      memoryService.getMemory!.mockReturnValue(record);

      const response = await request(app.getHttpServer())
        .get('/api/v1/memories/specific-id')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result.id).toBe('specific-id');
    });

    it('should return 404 when memory not found', async () => {
      memoryService.getMemory!.mockImplementation(() => {
        const { NotFoundException } = require('@nestjs/common');
        throw new NotFoundException('Memory not-found not found');
      });

      await request(app.getHttpServer())
        .get('/api/v1/memories/not-found')
        .expect(404);
    });
  });

  describe('DELETE /api/v1/memories/:id', () => {
    it('should delete a memory and return success', async () => {
      memoryService.deleteMemory!.mockResolvedValue(undefined);

      const response = await request(app.getHttpServer())
        .delete('/api/v1/memories/mem-123')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result.deleted).toBe(true);
    });

    it('should return 404 when deleting non-existent memory', async () => {
      memoryService.deleteMemory!.mockRejectedValue(
        new (require('@nestjs/common').NotFoundException)('Memory not found'),
      );

      await request(app.getHttpServer())
        .delete('/api/v1/memories/non-existent')
        .expect(404);
    });
  });
});
