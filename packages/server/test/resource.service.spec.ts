import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ResourceService } from '../src/resource/resource.service';
import { VfsService } from '../src/storage/vfs.service';
import { ContextVectorService } from '../src/storage/context-vector.service';
import { EmbeddingService } from '../src/embedding/embedding.service';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { typeOrmTestImports } from './helpers/test-typeorm';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-res-test-'));
}

describe('ResourceService', () => {
  let module: TestingModule;
  let resourceService: ResourceService;

  const FAKE_VECTOR = new Array(1536).fill(0.1) as number[];

  beforeEach(async () => {
    const tempDir = createTempDir();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              storage: { path: tempDir },
            }),
          ],
        }),
        ...typeOrmTestImports(tempDir),
      ],
      providers: [
        ResourceService,
        VfsService,
        ContextVectorService,
        {
          provide: EmbeddingService,
          useValue: {
            embed: jest.fn().mockResolvedValue(FAKE_VECTOR),
          },
        },
      ],
    }).compile();

    await module.init();
    resourceService = module.get(ResourceService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('createResource', () => {
    it('should create a resource with text content', async () => {
      const resource = await resourceService.createResource({
        title: 'Test Resource',
        text: 'Resource content here',
      });

      expect(resource.id).toBeDefined();
      expect(resource.title).toBe('Test Resource');
      expect(resource.uri).toMatch(/^viking:\/\/resources\//);
      expect(resource.l0Abstract).toBe('Resource content here');
      expect(resource.l2Content).toBe('Resource content here');
    });

    it('should throw when neither text nor url provided', async () => {
      await expect(resourceService.createResource({})).rejects.toThrow();
    });

    it('should use custom URI when provided', async () => {
      const resource = await resourceService.createResource({
        text: 'Test',
        uri: 'viking://resources/custom.md',
      });

      expect(resource.uri).toBe('viking://resources/custom.md');
    });
  });

  describe('getResource', () => {
    it('should retrieve a resource by ID', async () => {
      const created = await resourceService.createResource({
        title: 'Find me',
        text: 'Find me content',
      });

      const found = await resourceService.getResource(created.id);
      expect(found.title).toBe('Find me');
    });

    it('should throw for non-existent ID', async () => {
      await expect(resourceService.getResource('nonexistent')).rejects.toThrow();
    });
  });

  describe('deleteResource', () => {
    it('should delete an existing resource', async () => {
      const resource = await resourceService.createResource({
        text: 'Delete me',
      });

      await resourceService.deleteResource(resource.id);
      await expect(resourceService.getResource(resource.id)).rejects.toThrow();
    });
  });

  describe('listResources', () => {
    it('should list all resources', async () => {
      await resourceService.createResource({ text: 'Resource 1' });
      await resourceService.createResource({ text: 'Resource 2' });

      const all = await resourceService.listResources();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no resources', async () => {
      const all = await resourceService.listResources();
      expect(all).toHaveLength(0);
    });
  });

  describe('searchResources', () => {
    it('should return search results', async () => {
      await resourceService.createResource({
        text: 'TypeScript guide',
        title: 'TS Guide',
      });

      const results = await resourceService.searchResources('TypeScript');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.score).toBeGreaterThan(0);
    });
  });
});
