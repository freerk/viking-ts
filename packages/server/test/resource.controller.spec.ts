import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
      addResource: jest.fn(),
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
        { provide: ConfigService, useValue: { get: () => '/tmp/viking-test' } },
      ],
    }).compile();

    app = module.createNestApplication();
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

  describe('POST /api/v1/resources (OpenViking)', () => {
    it('should return 400 when neither path nor temp_path provided', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({})
        .expect(400);
    });

    it('should return 400 when both to and parent provided', async () => {
      resourceService.addResource!.mockRejectedValue(
        new BadRequestException("Cannot specify both 'to' and 'parent'"),
      );

      await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ path: '/tmp/test.md', to: 'viking://resources/a.md', parent: 'viking://resources' })
        .expect(400);
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
