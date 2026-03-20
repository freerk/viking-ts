import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResourceService } from '../src/resource/resource.service';
import { MetadataStoreService } from '../src/storage/metadata-store.service';
import { VectorStoreService } from '../src/storage/vector-store.service';
import { EmbeddingService } from '../src/embedding/embedding.service';
import { LlmService } from '../src/llm/llm.service';
import { VikingUriService } from '../src/viking-uri/viking-uri.service';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-res-test-'));
}

describe('ResourceService', () => {
  let module: TestingModule;
  let resourceService: ResourceService;
  let metadataStore: MetadataStoreService;

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
              embedding: {
                provider: 'openai',
                model: 'text-embedding-3-small',
                apiKey: '',
                apiBase: 'http://localhost:9999',
                dimension: 1536,
              },
              llm: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                apiKey: '',
                apiBase: 'http://localhost:9999',
              },
            }),
          ],
        }),
      ],
      providers: [
        ResourceService,
        MetadataStoreService,
        VectorStoreService,
        VikingUriService,
        {
          provide: EmbeddingService,
          useValue: {
            embed: jest.fn().mockResolvedValue(FAKE_VECTOR),
            embedBatch: jest.fn().mockResolvedValue([FAKE_VECTOR]),
            getDimension: jest.fn().mockReturnValue(1536),
          },
        },
        {
          provide: LlmService,
          useValue: {
            generateAbstract: jest.fn().mockResolvedValue('Resource abstract'),
            generateOverview: jest.fn().mockResolvedValue('Resource overview'),
          },
        },
      ],
    }).compile();

    await module.init();

    resourceService = module.get(ResourceService);
    metadataStore = module.get(MetadataStoreService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('createResource', () => {
    it('should create a resource with text content', async () => {
      const resource = await resourceService.createResource({
        title: 'API Docs',
        text: 'REST API documentation for the service',
      });

      expect(resource.id).toBeDefined();
      expect(resource.title).toBe('API Docs');
      expect(resource.l0Abstract).toBe('Resource abstract');
      expect(resource.l1Overview).toBe('Resource overview');
      expect(resource.l2Content).toBe('REST API documentation for the service');
      expect(resource.uri).toMatch(/^viking:\/\/resources\//);
    });

    it('should use custom uri when provided', async () => {
      const customUri = 'viking://resources/whisperline/principles.md';
      const resource = await resourceService.createResource({
        text: 'Whisperline principles',
        uri: customUri,
      });

      expect(resource.uri).toBe(customUri);
    });

    it('should generate uuid-based uri when no custom uri provided', async () => {
      const resource = await resourceService.createResource({
        text: 'Auto-uri content',
      });

      expect(resource.uri).toMatch(/^viking:\/\/resources\/[0-9a-f-]+\.md$/);
    });

    it('should create a resource with URL', async () => {
      const resource = await resourceService.createResource({
        url: 'https://example.com/doc.pdf',
      });

      expect(resource.id).toBeDefined();
      expect(resource.title).toBe('https://example.com/doc.pdf');
      expect(resource.sourceUrl).toBe('https://example.com/doc.pdf');
      expect(resource.l2Content).toBe('Resource from URL: https://example.com/doc.pdf');
    });

    it('should throw BadRequestException when neither text nor url provided', async () => {
      await expect(resourceService.createResource({})).rejects.toThrow(BadRequestException);
      await expect(resourceService.createResource({})).rejects.toThrow(
        'Either text or url must be provided',
      );
    });

    it('should use text content as title fallback when no title or url', async () => {
      const resource = await resourceService.createResource({
        text: 'Short content',
      });

      expect(resource.title).toBe('Short content');
    });

    it('should truncate long text for auto-title', async () => {
      const longText = 'A'.repeat(200);
      const resource = await resourceService.createResource({ text: longText });
      expect(resource.title.length).toBeLessThanOrEqual(80);
    });

    it('should store resource in metadata database', async () => {
      const resource = await resourceService.createResource({
        text: 'Stored content',
      });

      const retrieved = metadataStore.getResourceById(resource.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.l2Content).toBe('Stored content');
    });

    it('should gracefully handle LLM failure during creation', async () => {
      const llm = module.get(LlmService);
      (llm.generateAbstract as jest.Mock).mockRejectedValueOnce(new Error('LLM down'));
      (llm.generateOverview as jest.Mock).mockRejectedValueOnce(new Error('LLM down'));

      const resource = await resourceService.createResource({
        text: 'Content for testing LLM failure gracefully',
      });

      expect(resource.id).toBeDefined();
      expect(resource.l0Abstract).toBe('Content for testing LLM failure gracefully'.slice(0, 100));
    });

    it('should gracefully handle embedding failure during creation', async () => {
      const embedding = module.get(EmbeddingService);
      (embedding.embed as jest.Mock).mockRejectedValueOnce(new Error('Embed down'));

      const resource = await resourceService.createResource({
        text: 'Content with embedding failure',
      });

      expect(resource.id).toBeDefined();
      const retrieved = metadataStore.getResourceById(resource.id);
      expect(retrieved).toBeDefined();
    });
  });

  describe('getResource', () => {
    it('should return a resource by ID', async () => {
      const created = await resourceService.createResource({ text: 'Find me' });
      const found = resourceService.getResource(created.id);
      expect(found.id).toBe(created.id);
      expect(found.l2Content).toBe('Find me');
    });

    it('should throw NotFoundException for missing ID', () => {
      expect(() => resourceService.getResource('non-existent')).toThrow(NotFoundException);
    });
  });

  describe('listResources', () => {
    it('should list all resources', async () => {
      await resourceService.createResource({ text: 'Res 1' });
      await resourceService.createResource({ text: 'Res 2' });

      const all = resourceService.listResources();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no resources exist', () => {
      const result = resourceService.listResources();
      expect(result).toHaveLength(0);
    });

    it('should support pagination via limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await resourceService.createResource({ text: `Res ${i}` });
      }

      const page1 = resourceService.listResources(2, 0);
      expect(page1).toHaveLength(2);

      const page2 = resourceService.listResources(2, 2);
      expect(page2).toHaveLength(2);
    });
  });

  describe('deleteResource', () => {
    it('should delete an existing resource', async () => {
      const resource = await resourceService.createResource({ text: 'Delete me' });
      await resourceService.deleteResource(resource.id);

      expect(() => resourceService.getResource(resource.id)).toThrow(NotFoundException);
    });

    it('should throw NotFoundException for missing ID', async () => {
      await expect(resourceService.deleteResource('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('searchResources', () => {
    it('should return vector search results', async () => {
      await resourceService.createResource({
        text: 'NestJS testing patterns and best practices',
      });

      const results = await resourceService.searchResources('NestJS testing');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.score).toBeGreaterThan(0);
      expect(results[0]?.id).toBeDefined();
      expect(results[0]?.uri).toBeDefined();
    });

    it('should include l0Abstract in search results', async () => {
      await resourceService.createResource({
        text: 'Search result shape verification',
      });

      const results = await resourceService.searchResources('shape');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.l0Abstract).toBeDefined();
    });
  });

  describe('createResource edge cases', () => {
    it('should set createdAt and updatedAt timestamps', async () => {
      const resource = await resourceService.createResource({ text: 'Timestamps' });

      expect(resource.createdAt).toBeDefined();
      expect(resource.updatedAt).toBeDefined();
      expect(resource.createdAt).toBe(resource.updatedAt);
    });

    it('should prefer explicit title over url and text fallbacks', async () => {
      const resource = await resourceService.createResource({
        title: 'Explicit Title',
        text: 'Some content',
        url: 'https://example.com',
      });

      expect(resource.title).toBe('Explicit Title');
    });

    it('should use url as title fallback when no title and no text', async () => {
      const resource = await resourceService.createResource({
        url: 'https://example.com/article',
      });

      expect(resource.title).toBe('https://example.com/article');
    });

    it('should set sourceUrl to undefined when only text provided', async () => {
      const resource = await resourceService.createResource({ text: 'Text only' });
      expect(resource.sourceUrl).toBeUndefined();
    });

    it('should use content for embedding when l0Abstract is empty after LLM failure', async () => {
      const llm = module.get(LlmService);
      (llm.generateAbstract as jest.Mock).mockRejectedValueOnce(new Error('LLM down'));
      (llm.generateOverview as jest.Mock).mockRejectedValueOnce(new Error('LLM down'));

      const embedding = module.get(EmbeddingService);
      const embedSpy = embedding.embed as jest.Mock;
      embedSpy.mockClear();

      const resource = await resourceService.createResource({
        text: 'Content for fallback embedding test',
      });

      expect(resource.l0Abstract).toBe('Content for fallback embedding test'.slice(0, 100));
      expect(embedSpy).toHaveBeenCalled();
    });

    it('should create resource with both text and url', async () => {
      const resource = await resourceService.createResource({
        title: 'Both',
        text: 'Article content',
        url: 'https://example.com/article',
      });

      expect(resource.title).toBe('Both');
      expect(resource.l2Content).toBe('Article content');
      expect(resource.sourceUrl).toBe('https://example.com/article');
    });
  });
});
