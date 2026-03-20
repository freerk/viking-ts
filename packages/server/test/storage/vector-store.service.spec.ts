import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { VectorStoreService } from '../../src/storage/vector-store.service';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-vec-test-'));
}

function fakeVector(seed: number = 0.1, dim: number = 16): number[] {
  return new Array(dim).fill(seed) as number[];
}

describe('VectorStoreService', () => {
  let module: TestingModule;
  let store: VectorStoreService;

  beforeEach(async () => {
    const tempDir = createTempDir();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ storage: { path: tempDir } })],
        }),
      ],
      providers: [VectorStoreService],
    }).compile();

    await module.init();
    store = module.get(VectorStoreService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('Memory vectors', () => {
    it('should upsert and search a memory vector', async () => {
      const vector = fakeVector(0.5);
      await store.upsertMemory('mem-1', vector, {
        uri: 'viking://user/memories/general/mem-1.md',
        text: 'Test memory',
      });

      const results = await store.searchMemories(vector, 10, 0.0);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.id).toBe('mem-1');
      expect(results[0]?.score).toBeGreaterThan(0);
      expect(results[0]?.uri).toBe('viking://user/memories/general/mem-1.md');
      expect(results[0]?.text).toBe('Test memory');
    });

    it('should overwrite existing item on upsert', async () => {
      const vector = fakeVector(0.5);
      await store.upsertMemory('mem-1', vector, { text: 'Original' });
      await store.upsertMemory('mem-1', vector, { text: 'Updated' });

      const results = await store.searchMemories(vector, 10, 0.0);
      const match = results.find((r) => r.id === 'mem-1');
      expect(match).toBeDefined();
      expect(match?.metadata['text']).toBe('Updated');
    });

    it('should delete a memory vector', async () => {
      const vector = fakeVector(0.5);
      await store.upsertMemory('mem-del', vector, { text: 'Delete me' });
      await store.deleteMemory('mem-del');

      const results = await store.searchMemories(vector, 10, 0.0);
      const match = results.find((r) => r.id === 'mem-del');
      expect(match).toBeUndefined();
    });

    it('should not throw when deleting non-existent memory vector', async () => {
      await expect(store.deleteMemory('non-existent')).resolves.not.toThrow();
    });

    it('should filter results by score threshold', async () => {
      const v1 = fakeVector(0.9);
      await store.upsertMemory('high', v1, { text: 'High score' });

      const results = await store.searchMemories(v1, 10, 0.99);
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0.99);
      }
    });

    it('should respect limit parameter', async () => {
      const vector = fakeVector(0.3);
      for (let i = 0; i < 5; i++) {
        await store.upsertMemory(`mem-${i}`, fakeVector(0.3 + i * 0.01), { text: `Item ${i}` });
      }

      const results = await store.searchMemories(vector, 2, 0.0);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Resource vectors', () => {
    it('should upsert and search a resource vector', async () => {
      const vector = fakeVector(0.7);
      await store.upsertResource('res-1', vector, {
        uri: 'viking://resources/res-1.md',
        text: 'Test resource',
        title: 'Resource Title',
      });

      const results = await store.searchResources(vector, 10, 0.0);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.id).toBe('res-1');
      expect(results[0]?.uri).toBe('viking://resources/res-1.md');
    });

    it('should delete a resource vector', async () => {
      const vector = fakeVector(0.7);
      await store.upsertResource('res-del', vector, { text: 'Delete me' });
      await store.deleteResource('res-del');

      const results = await store.searchResources(vector, 10, 0.0);
      const match = results.find((r) => r.id === 'res-del');
      expect(match).toBeUndefined();
    });

    it('should not throw when deleting non-existent resource vector', async () => {
      await expect(store.deleteResource('non-existent')).resolves.not.toThrow();
    });

    it('should overwrite existing resource on upsert', async () => {
      const vector = fakeVector(0.7);
      await store.upsertResource('res-1', vector, { text: 'Original' });
      await store.upsertResource('res-1', vector, { text: 'Updated' });

      const results = await store.searchResources(vector, 10, 0.0);
      const match = results.find((r) => r.id === 'res-1');
      expect(match).toBeDefined();
      expect(match?.metadata['text']).toBe('Updated');
    });

    it('should respect limit parameter for resources', async () => {
      const vector = fakeVector(0.7);
      for (let i = 0; i < 5; i++) {
        await store.upsertResource(`res-${i}`, fakeVector(0.7 + i * 0.01), { text: `Res ${i}` });
      }

      const results = await store.searchResources(vector, 2, 0.0);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Cross-index isolation', () => {
    it('should not return memories when searching resources', async () => {
      const vector = fakeVector(0.5);
      await store.upsertMemory('mem-iso', vector, { text: 'Memory' });

      const results = await store.searchResources(vector, 10, 0.0);
      const match = results.find((r) => r.id === 'mem-iso');
      expect(match).toBeUndefined();
    });

    it('should not return resources when searching memories', async () => {
      const vector = fakeVector(0.5);
      await store.upsertResource('res-iso', vector, { text: 'Resource' });

      const results = await store.searchMemories(vector, 10, 0.0);
      const match = results.find((r) => r.id === 'res-iso');
      expect(match).toBeUndefined();
    });
  });
});
