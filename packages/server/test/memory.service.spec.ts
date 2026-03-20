import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MemoryService } from '../src/memory/memory.service';
import { MetadataStoreService } from '../src/storage/metadata-store.service';
import { VectorStoreService } from '../src/storage/vector-store.service';
import { EmbeddingService } from '../src/embedding/embedding.service';
import { LlmService } from '../src/llm/llm.service';
import { VikingUriService } from '../src/viking-uri/viking-uri.service';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-test-'));
}

describe('MemoryService', () => {
  let module: TestingModule;
  let memoryService: MemoryService;
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
        MemoryService,
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
            generateAbstract: jest.fn().mockResolvedValue('Test abstract'),
            generateOverview: jest.fn().mockResolvedValue('Test overview with key points'),
            extractMemories: jest.fn().mockResolvedValue([
              { text: 'User likes TypeScript', category: 'preferences' },
            ]),
          },
        },
      ],
    }).compile();

    await module.init();

    memoryService = module.get(MemoryService);
    metadataStore = module.get(MetadataStoreService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('createMemory', () => {
    it('should create a memory with L0/L1 summaries', async () => {
      const memory = await memoryService.createMemory({
        text: 'User prefers dark mode in all applications',
        type: 'user',
        category: 'preferences',
      });

      expect(memory.id).toBeDefined();
      expect(memory.text).toBe('User prefers dark mode in all applications');
      expect(memory.type).toBe('user');
      expect(memory.category).toBe('preferences');
      expect(memory.l0Abstract).toBe('Test abstract');
      expect(memory.l1Overview).toBe('Test overview with key points');
      expect(memory.l2Content).toBe('User prefers dark mode in all applications');
      expect(memory.uri).toMatch(/^viking:\/\/user\/memories\/preferences\//);
    });

    it('should store memory in metadata database', async () => {
      const memory = await memoryService.createMemory({
        text: 'Test memory content',
      });

      const retrieved = metadataStore.getMemoryById(memory.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.text).toBe('Test memory content');
    });

    it('should default to user type and general category', async () => {
      const memory = await memoryService.createMemory({
        text: 'Some general information',
      });

      expect(memory.type).toBe('user');
      expect(memory.category).toBe('general');
    });

    it('should use custom URI when provided', async () => {
      const memory = await memoryService.createMemory({
        text: 'Custom URI memory',
        uri: 'viking://user/memories/custom/test.md',
      });

      expect(memory.uri).toBe('viking://user/memories/custom/test.md');
    });

    it('should generate agent-scope URI for agent type', async () => {
      const memory = await memoryService.createMemory({
        text: 'Agent observation',
        type: 'agent',
        category: 'cases',
      });

      expect(memory.uri).toMatch(/^viking:\/\/agent\/memories\/cases\//);
    });

    it('should gracefully handle LLM failure and fall back to text slices', async () => {
      const llm = module.get(LlmService);
      (llm.generateAbstract as jest.Mock).mockRejectedValueOnce(new Error('LLM down'));
      (llm.generateOverview as jest.Mock).mockRejectedValueOnce(new Error('LLM down'));

      const text = 'Content that triggers LLM failure for testing';
      const memory = await memoryService.createMemory({ text });

      expect(memory.id).toBeDefined();
      expect(memory.l0Abstract).toBe(text.slice(0, 100));
      expect(memory.l1Overview).toBe(text.slice(0, 500));
    });

    it('should gracefully handle embedding failure', async () => {
      const embedding = module.get(EmbeddingService);
      (embedding.embed as jest.Mock).mockRejectedValueOnce(new Error('Embed down'));

      const memory = await memoryService.createMemory({ text: 'Content with embed failure' });

      expect(memory.id).toBeDefined();
      const retrieved = metadataStore.getMemoryById(memory.id);
      expect(retrieved).toBeDefined();
    });

    it('should preserve agentId and userId on the created memory', async () => {
      const memory = await memoryService.createMemory({
        text: 'Scoped memory',
        agentId: 'agent-42',
        userId: 'user-99',
      });

      expect(memory.agentId).toBe('agent-42');
      expect(memory.userId).toBe('user-99');
    });

    it('should set createdAt and updatedAt timestamps', async () => {
      const memory = await memoryService.createMemory({ text: 'Timestamped' });

      expect(memory.createdAt).toBeDefined();
      expect(memory.updatedAt).toBeDefined();
      expect(memory.createdAt).toBe(memory.updatedAt);
    });
  });

  describe('listMemories', () => {
    it('should list memories with filters', async () => {
      await memoryService.createMemory({
        text: 'Memory A',
        type: 'user',
        category: 'preferences',
        userId: 'user-1',
      });
      await memoryService.createMemory({
        text: 'Memory B',
        type: 'agent',
        category: 'cases',
        agentId: 'agent-1',
      });

      const userMemories = memoryService.listMemories({ type: 'user' });
      expect(userMemories).toHaveLength(1);
      expect(userMemories[0]?.text).toBe('Memory A');

      const agentMemories = memoryService.listMemories({ type: 'agent' });
      expect(agentMemories).toHaveLength(1);
      expect(agentMemories[0]?.text).toBe('Memory B');

      const allMemories = memoryService.listMemories({});
      expect(allMemories).toHaveLength(2);
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await memoryService.createMemory({ text: `Memory ${i}` });
      }

      const page1 = memoryService.listMemories({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = memoryService.listMemories({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      const page3 = memoryService.listMemories({ limit: 2, offset: 4 });
      expect(page3).toHaveLength(1);
    });
  });

  describe('getMemory', () => {
    it('should return a specific memory by ID', async () => {
      const created = await memoryService.createMemory({ text: 'Find me' });
      const found = memoryService.getMemory(created.id);
      expect(found.text).toBe('Find me');
    });

    it('should throw NotFoundException for missing ID', () => {
      expect(() => memoryService.getMemory('nonexistent')).toThrow();
    });
  });

  describe('deleteMemory', () => {
    it('should delete an existing memory', async () => {
      const memory = await memoryService.createMemory({ text: 'Delete me' });
      await memoryService.deleteMemory(memory.id);

      expect(() => memoryService.getMemory(memory.id)).toThrow();
    });

    it('should throw NotFoundException for missing ID', async () => {
      await expect(memoryService.deleteMemory('nonexistent')).rejects.toThrow();
    });
  });

  describe('searchMemories', () => {
    it('should return vector search results', async () => {
      await memoryService.createMemory({
        text: 'User prefers TypeScript over JavaScript',
        category: 'preferences',
      });

      const results = await memoryService.searchMemories('TypeScript preference');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.score).toBeGreaterThan(0);
    });

    it('should include id, uri, text, and l0Abstract in results', async () => {
      await memoryService.createMemory({
        text: 'Detailed memory for search result shape',
        category: 'general',
      });

      const results = await memoryService.searchMemories('search result shape');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.id).toBeDefined();
      expect(results[0]?.uri).toBeDefined();
      expect(results[0]?.text).toBeDefined();
      expect(results[0]?.l0Abstract).toBeDefined();
    });

    it('should filter results by uriFilter prefix', async () => {
      await memoryService.createMemory({
        text: 'Memory with user scope',
        type: 'user',
        category: 'preferences',
      });
      await memoryService.createMemory({
        text: 'Memory with agent scope',
        type: 'agent',
        category: 'cases',
      });

      const results = await memoryService.searchMemories(
        'Memory',
        10,
        0.01,
        'viking://user/memories/',
      );

      for (const r of results) {
        expect(r.uri).toMatch(/^viking:\/\/user\/memories\//);
      }
    });
  });

  describe('captureSession', () => {
    it('should extract memories from conversation messages', async () => {
      const messages = [
        { role: 'user', content: 'I really love TypeScript and always use strict mode' },
        { role: 'assistant', content: 'Noted! TypeScript with strict mode is a great practice.' },
      ];

      const memories = await memoryService.captureSession(messages);
      expect(memories.length).toBeGreaterThanOrEqual(1);
      expect(memories[0]?.text).toBe('User likes TypeScript');
      expect(memories[0]?.category).toBe('preferences');
    });

    it('should pass agentId and userId to created memories', async () => {
      const messages = [{ role: 'user', content: 'I like dark mode' }];
      const memories = await memoryService.captureSession(messages, 'agent-1', 'user-1');

      expect(memories.length).toBeGreaterThanOrEqual(1);
      expect(memories[0]?.agentId).toBe('agent-1');
      expect(memories[0]?.userId).toBe('user-1');
    });

    it('should store session and messages in metadata store', async () => {
      const messages = [
        { role: 'user', content: 'Test message' },
        { role: 'assistant', content: 'Response' },
      ];

      await memoryService.captureSession(messages);

      const allMemories = metadataStore.listMemories({});
      expect(allMemories.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty array when extraction returns nothing', async () => {
      const llmService = module.get(LlmService);
      (llmService.extractMemories as jest.Mock).mockResolvedValueOnce([]);

      const memories = await memoryService.captureSession([
        { role: 'user', content: 'Nothing worth remembering' },
      ]);

      expect(memories).toHaveLength(0);
    });

    it('should handle extraction failure gracefully', async () => {
      const llmService = module.get(LlmService);
      (llmService.extractMemories as jest.Mock).mockRejectedValueOnce(
        new Error('LLM extraction error'),
      );

      const memories = await memoryService.captureSession([
        { role: 'user', content: 'Something' },
      ]);

      expect(memories).toHaveLength(0);
    });

    it('should skip individual memory creation failures and continue', async () => {
      const llmService = module.get(LlmService);
      const embeddingService = module.get(EmbeddingService);
      (llmService.extractMemories as jest.Mock).mockResolvedValueOnce([
        { text: 'First fact', category: 'general' },
        { text: 'Second fact', category: 'preferences' },
      ]);
      // First createMemory succeeds, second fails on LLM
      (llmService.generateAbstract as jest.Mock)
        .mockResolvedValueOnce('Abstract 1')
        .mockRejectedValueOnce(new Error('LLM fail'));
      (llmService.generateOverview as jest.Mock)
        .mockResolvedValueOnce('Overview 1')
        .mockRejectedValueOnce(new Error('LLM fail'));
      // Make embedding fail on second call to trigger the catch in createMemory
      (embeddingService.embed as jest.Mock)
        .mockResolvedValueOnce(FAKE_VECTOR)
        .mockRejectedValueOnce(new Error('Embed fail'));

      const memories = await memoryService.captureSession([
        { role: 'user', content: 'Some facts' },
      ]);

      // Both memories should still be created (graceful degradation)
      expect(memories).toHaveLength(2);
    });
  });
});
