import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, NotFoundException, BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { ResourceController } from '../src/resource/resource.controller';
import { ResourceService } from '../src/resource/resource.service';
import { ResourceRecord } from '../src/shared/types';

function makeResourceRecord(overrides: Partial<ResourceRecord> = {}): ResourceRecord {
  const now = new Date().toISOString();
  return {
    id: 'res-123',
    title: 'Test resource',
    uri: 'viking://resources/res-123.md',
    l0Abstract: 'Abstract',
    l1Overview: 'Overview',
    l2Content: 'Resource content',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ResourceController (HTTP)', () => {
  let app: INestApplication;
  let resourceService: Partial<Record<keyof ResourceService, jest.Mock>>;

  beforeEach(async () => {
    resourceService = {
      createResource: jest.fn(),
      searchResources: jest.fn(),
      listResources: jest.fn(),
      getResource: jest.fn(),
      deleteResource: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourceController],
      providers: [
        { provide: ResourceService, useValue: resourceService },
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

  describe('POST /api/v1/resources', () => {
    it('should create a resource with text and return 201', async () => {
      const record = makeResourceRecord();
      resourceService.createResource!.mockResolvedValue(record);

      const response = await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ text: 'Some documentation content', title: 'API Docs' })
        .expect(201);

      expect(response.body.status).toBe('ok');
      expect(response.body.result.id).toBe('res-123');
      expect(response.body.result.title).toBe('Test resource');
    });

    it('should create a resource with URL only', async () => {
      const record = makeResourceRecord({ sourceUrl: 'https://example.com' });
      resourceService.createResource!.mockResolvedValue(record);

      await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ url: 'https://example.com' })
        .expect(201);

      expect(resourceService.createResource).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://example.com' }),
      );
    });

    it('should return 400 for unknown fields', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ text: 'Test', badField: 'nope' })
        .expect(400);
    });

    it('should handle service BadRequestException', async () => {
      resourceService.createResource!.mockRejectedValue(
        new BadRequestException('Either text or url must be provided'),
      );

      await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({})
        .expect(400);
    });

    it('should pass custom uri to service', async () => {
      const record = makeResourceRecord({ uri: 'viking://resources/custom/path.md' });
      resourceService.createResource!.mockResolvedValue(record);

      const response = await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ text: 'Content', uri: 'viking://resources/custom/path.md' })
        .expect(201);

      expect(resourceService.createResource).toHaveBeenCalledWith(
        expect.objectContaining({ uri: 'viking://resources/custom/path.md' }),
      );
      expect(response.body.result.uri).toBe('viking://resources/custom/path.md');
    });

    it('should create resource with both text and url', async () => {
      const record = makeResourceRecord({ sourceUrl: 'https://example.com' });
      resourceService.createResource!.mockResolvedValue(record);

      await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ text: 'Content', url: 'https://example.com', title: 'Both' })
        .expect(201);

      expect(resourceService.createResource).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Content', url: 'https://example.com', title: 'Both' }),
      );
    });

    it('should include time field in response', async () => {
      const record = makeResourceRecord();
      resourceService.createResource!.mockResolvedValue(record);

      const response = await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ text: 'Time test' })
        .expect(201);

      expect(response.body.time).toBeDefined();
      expect(typeof response.body.time).toBe('number');
    });
  });

  describe('GET /api/v1/resources/search', () => {
    it('should search resources with query', async () => {
      resourceService.searchResources!.mockResolvedValue([
        { id: 'res-1', uri: 'viking://resources/res-1.md', text: 'Found', score: 0.85, l0Abstract: 'Abstract' },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/resources/search')
        .query({ q: 'NestJS' })
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result).toHaveLength(1);
      expect(response.body.result[0].score).toBe(0.85);
    });

    it('should pass custom limit and scoreThreshold', async () => {
      resourceService.searchResources!.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/resources/search')
        .query({ q: 'test', limit: '5', scoreThreshold: '0.3' })
        .expect(200);

      expect(resourceService.searchResources).toHaveBeenCalledWith('test', 5, 0.3);
    });

    it('should use default limit and scoreThreshold', async () => {
      resourceService.searchResources!.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/resources/search')
        .query({ q: 'test' })
        .expect(200);

      expect(resourceService.searchResources).toHaveBeenCalledWith('test', 10, 0.01);
    });
  });

  describe('GET /api/v1/resources', () => {
    it('should list all resources', async () => {
      resourceService.listResources!.mockResolvedValue([makeResourceRecord()]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/resources')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result).toHaveLength(1);
    });

    it('should return empty array when no resources', async () => {
      resourceService.listResources!.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/resources')
        .expect(200);

      expect(response.body.result).toHaveLength(0);
    });
  });

  describe('GET /api/v1/resources/:id', () => {
    it('should return a resource by ID', async () => {
      const record = makeResourceRecord({ id: 'res-456' });
      resourceService.getResource!.mockResolvedValue(record);

      const response = await request(app.getHttpServer())
        .get('/api/v1/resources/res-456')
        .expect(200);

      expect(response.body.result.id).toBe('res-456');
    });

    it('should return 404 when resource not found', async () => {
      resourceService.getResource!.mockRejectedValue(
        new NotFoundException('Resource not found'),
      );

      await request(app.getHttpServer())
        .get('/api/v1/resources/missing')
        .expect(404);
    });
  });

  describe('DELETE /api/v1/resources/:id', () => {
    it('should delete a resource and return success', async () => {
      resourceService.deleteResource!.mockResolvedValue(undefined);

      const response = await request(app.getHttpServer())
        .delete('/api/v1/resources/res-123')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result.deleted).toBe(true);
    });

    it('should return 404 when deleting non-existent resource', async () => {
      resourceService.deleteResource!.mockRejectedValue(
        new NotFoundException('Resource not found'),
      );

      await request(app.getHttpServer())
        .delete('/api/v1/resources/missing')
        .expect(404);
    });
  });
});
