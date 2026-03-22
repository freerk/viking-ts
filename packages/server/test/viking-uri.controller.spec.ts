import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { VikingUriController } from '../src/viking-uri/viking-uri.controller';
import { VikingUriService } from '../src/viking-uri/viking-uri.service';
import { MetadataStoreService } from '../src/storage/metadata-store.service';

describe('VikingUriController (HTTP)', () => {
  let app: INestApplication;
  let metadataStore: Partial<Record<keyof MetadataStoreService, jest.Mock>>;

  beforeEach(async () => {
    metadataStore = {
      listResources: jest.fn().mockResolvedValue([]),
      listMemories: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VikingUriController],
      providers: [
        VikingUriService,
        { provide: MetadataStoreService, useValue: metadataStore },
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

  describe('GET /api/v1/ls', () => {
    it('should list children at a resource URI', async () => {
      metadataStore.listResources!.mockResolvedValue([
        { uri: 'viking://resources/doc1.md' },
        { uri: 'viking://resources/doc2.md' },
        { uri: 'viking://resources/other/nested.md' },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/ls')
        .query({ uri: 'viking://resources/' })
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result.uri).toBe('viking://resources/');
      expect(response.body.result.children).toEqual(
        expect.arrayContaining([
          'viking://resources/doc1.md',
          'viking://resources/doc2.md',
          'viking://resources/other/nested.md',
        ]),
      );
    });

    it('should list children at a user memories URI', async () => {
      metadataStore.listMemories!.mockResolvedValue([
        { uri: 'viking://user/memories/preferences/a.md' },
        { uri: 'viking://user/memories/general/b.md' },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/ls')
        .query({ uri: 'viking://user/memories/' })
        .expect(200);

      expect(response.body.result.children).toHaveLength(2);
      expect(metadataStore.listMemories).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'user' }),
      );
    });

    it('should return 400 when uri is missing', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/ls')
        .expect(400);
    });

    it('should return 500 for invalid viking URI', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/ls')
        .query({ uri: 'http://invalid' })
        .expect(500);
    });

    it('should return empty children when no matches', async () => {
      metadataStore.listResources!.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/ls')
        .query({ uri: 'viking://resources/' })
        .expect(200);

      expect(response.body.result.children).toHaveLength(0);
    });
  });

  describe('GET /api/v1/tree', () => {
    it('should return tree view of resources', async () => {
      metadataStore.listResources!.mockResolvedValue([
        { uri: 'viking://resources/doc1.md' },
        { uri: 'viking://resources/doc2.md' },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/tree')
        .query({ uri: 'viking://resources/' })
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.result.name).toBe('resources');
      expect(response.body.result.type).toBe('directory');
      expect(response.body.result.children).toBeDefined();
    });

    it('should accept custom depth parameter', async () => {
      metadataStore.listResources!.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/tree')
        .query({ uri: 'viking://resources/', depth: '1' })
        .expect(200);
    });

    it('should default to depth 2 when not specified', async () => {
      metadataStore.listResources!.mockResolvedValue([
        { uri: 'viking://resources/a/b/c.md' },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/tree')
        .query({ uri: 'viking://resources/' })
        .expect(200);

      expect(response.body.result.type).toBe('directory');
    });

    it('should return 400 when uri is missing', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/tree')
        .expect(400);
    });

    it('should use listMemories for user scope', async () => {
      metadataStore.listMemories!.mockResolvedValue([
        { uri: 'viking://user/memories/general/m1.md' },
      ]);

      await request(app.getHttpServer())
        .get('/api/v1/tree')
        .query({ uri: 'viking://user/' })
        .expect(200);

      expect(metadataStore.listMemories).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'user' }),
      );
    });

    it('should include time field in response', async () => {
      metadataStore.listResources!.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/tree')
        .query({ uri: 'viking://resources/' })
        .expect(200);

      expect(response.body.time).toBeDefined();
      expect(typeof response.body.time).toBe('number');
    });

    it('should use listMemories for agent scope', async () => {
      metadataStore.listMemories!.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/tree')
        .query({ uri: 'viking://agent/' })
        .expect(200);

      expect(metadataStore.listMemories).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'agent' }),
      );
    });
  });

  describe('GET /api/v1/ls edge cases', () => {
    it('should exclude the queried URI itself from children', async () => {
      metadataStore.listResources!.mockResolvedValue([
        { uri: 'viking://resources/' },
        { uri: 'viking://resources/doc.md' },
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/ls')
        .query({ uri: 'viking://resources/' })
        .expect(200);

      expect(response.body.result.children).not.toContain('viking://resources/');
    });

    it('should include time field in ls response', async () => {
      metadataStore.listResources!.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/ls')
        .query({ uri: 'viking://resources/' })
        .expect(200);

      expect(response.body.time).toBeDefined();
    });

    it('should use listMemories for agent scope in ls', async () => {
      metadataStore.listMemories!.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/api/v1/ls')
        .query({ uri: 'viking://agent/' })
        .expect(200);

      expect(metadataStore.listMemories).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'agent' }),
      );
    });
  });
});
