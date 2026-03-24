import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';
import { VfsService } from '../storage/vfs.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';

describe('ResourceController', () => {
  let app: INestApplication;

  const mockResourceService = {
    addResource: jest.fn(),
    createResource: jest.fn(),
    searchResources: jest.fn(),
    listResources: jest.fn(),
    getResource: jest.fn(),
    deleteResource: jest.fn(),
  };

  const mockVfs = {
    writeFile: jest.fn(),
  };

  const mockEmbeddingQueue = {
    enqueue: jest.fn(),
  };

  const mockSemanticQueue = {
    enqueue: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue('/tmp/viking-test'),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourceController],
      providers: [
        { provide: ResourceService, useValue: mockResourceService },
        { provide: ConfigService, useValue: mockConfig },
        { provide: VfsService, useValue: mockVfs },
        { provide: EmbeddingQueueService, useValue: mockEmbeddingQueue },
        { provide: SemanticQueueService, useValue: mockSemanticQueue },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/resources', () => {
    const successResult = {
      status: 'success',
      root_uri: 'viking://resources/test.md',
      source_path: './test.md',
      errors: [],
    };

    it('should accept path to local file and return pipeline result', async () => {
      mockResourceService.addResource.mockResolvedValue(successResult);

      const res = await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ path: './file.md' })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.status).toBe('success');
      expect(res.body.result.root_uri).toBe('viking://resources/test.md');
      expect(mockResourceService.addResource).toHaveBeenCalledWith(
        expect.objectContaining({ path: './file.md' }),
      );
    });

    it('should accept URL path and route to URL ingestion', async () => {
      const urlResult = {
        status: 'success',
        root_uri: 'viking://resources/doc.md',
        source_path: 'https://example.com/doc.md',
        errors: [],
      };
      mockResourceService.addResource.mockResolvedValue(urlResult);

      const res = await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ path: 'https://example.com/doc.md' })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.root_uri).toBe('viking://resources/doc.md');
      expect(mockResourceService.addResource).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'https://example.com/doc.md' }),
      );
    });

    it('should accept text with to param and store at correct URI', async () => {
      const textResult = {
        status: 'success',
        root_uri: 'viking://resources/test/',
        source_path: null,
        errors: [],
      };
      mockResourceService.addResource.mockResolvedValue(textResult);

      const res = await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ text: 'markdown content', to: 'viking://resources/test/' })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.root_uri).toBe('viking://resources/test/');
      expect(mockResourceService.addResource).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'markdown content',
          to: 'viking://resources/test/',
        }),
      );
    });

    it('should accept directory path and return multiple-file result', async () => {
      const dirResult = {
        status: 'success',
        root_uri: 'viking://resources/docs',
        source_path: '/some/dir/',
        errors: [],
      };
      mockResourceService.addResource.mockResolvedValue(dirResult);

      const res = await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ path: '/some/dir/' })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.root_uri).toBe('viking://resources/docs');
      expect(mockResourceService.addResource).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/some/dir/' }),
      );
    });

    it('should return 400 when both to and parent are specified', async () => {
      mockResourceService.addResource.mockRejectedValue(
        new (await import('@nestjs/common')).BadRequestException(
          "Cannot specify both 'to' and 'parent'",
        ),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({
          text: 'content',
          to: 'viking://resources/a',
          parent: 'viking://resources/b',
        })
        .expect(400);

      expect(res.body.message).toContain("Cannot specify both 'to' and 'parent'");
    });

    it('should return 400 when to URI is outside resources scope', async () => {
      mockResourceService.addResource.mockRejectedValue(
        new (await import('@nestjs/common')).BadRequestException(
          'Target URI must be in viking://resources/ scope',
        ),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({
          text: 'content',
          to: 'viking://user/private',
        })
        .expect(400);

      expect(res.body.message).toContain('viking://resources/');
    });

    it('should handle legacy shape { title, text, uri } via backward compat', async () => {
      const legacyResult = {
        status: 'success',
        root_uri: 'viking://resources/my-doc',
        source_path: null,
        errors: [],
      };
      mockResourceService.addResource.mockResolvedValue(legacyResult);

      const res = await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({
          title: 'My Document',
          text: 'Some content here',
          uri: 'viking://resources/my-doc',
        })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.root_uri).toBe('viking://resources/my-doc');
      expect(mockResourceService.addResource).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Some content here',
          to: 'viking://resources/my-doc',
          title: 'My Document',
        }),
      );
    });

    it('should pass wait param through to service', async () => {
      mockResourceService.addResource.mockResolvedValue({
        status: 'success',
        root_uri: 'viking://resources/test',
        source_path: null,
        errors: [],
      });

      await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ text: 'content', to: 'viking://resources/test', wait: true })
        .expect(201);

      expect(mockResourceService.addResource).toHaveBeenCalledWith(
        expect.objectContaining({ wait: true }),
      );
    });

    it('should return 400 when neither path nor text is provided', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/resources')
        .send({ reason: 'just a reason' })
        .expect(400);
    });
  });

  describe('GET /api/v1/resources', () => {
    it('should list resources', async () => {
      mockResourceService.listResources.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/resources')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result).toEqual([]);
    });
  });

  describe('GET /api/v1/resources/search', () => {
    it('should search resources', async () => {
      mockResourceService.searchResources.mockResolvedValue([]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/resources/search?q=test')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(mockResourceService.searchResources).toHaveBeenCalledWith('test', 10, 0.01);
    });
  });

  describe('DELETE /api/v1/resources/:id', () => {
    it('should delete a resource', async () => {
      mockResourceService.deleteResource.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .delete('/api/v1/resources/res-123')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.deleted).toBe(true);
    });
  });
});
