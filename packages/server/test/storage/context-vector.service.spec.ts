import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContextVectorService } from '../../src/storage/context-vector.service';
import { ContextVectorEntity } from '../../src/storage/entities';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-cv-test-'));
}

describe('ContextVectorService', () => {
  let module: TestingModule;
  let cv: ContextVectorService;

  beforeEach(async () => {
    const tempDir = createTempDir();

    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: join(tempDir, 'viking.db'),
          entities: [ContextVectorEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([ContextVectorEntity]),
      ],
      providers: [ContextVectorService],
    }).compile();

    await module.init();
    cv = module.get(ContextVectorService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('generateId', () => {
    it('should generate deterministic MD5 ID', () => {
      const id1 = ContextVectorService.generateId('default', 'viking://resources/test.md');
      const id2 = ContextVectorService.generateId('default', 'viking://resources/test.md');
      expect(id1).toBe(id2);
      expect(id1).toHaveLength(32);
    });

    it('should produce different IDs for different URIs', () => {
      const id1 = ContextVectorService.generateId('default', 'viking://resources/a.md');
      const id2 = ContextVectorService.generateId('default', 'viking://resources/b.md');
      expect(id1).not.toBe(id2);
    });

    it('should produce different IDs for different accounts', () => {
      const id1 = ContextVectorService.generateId('account1', 'viking://resources/a.md');
      const id2 = ContextVectorService.generateId('account2', 'viking://resources/a.md');
      expect(id1).not.toBe(id2);
    });
  });

  describe('upsert and getByUri', () => {
    it('should create and retrieve a context vector', async () => {
      const record = await cv.upsert({
        uri: 'viking://resources/test.md',
        contextType: 'resource',
        level: 2,
        abstract: 'Test abstract',
        name: 'test.md',
      });

      expect(record.id).toBeDefined();
      expect(record.uri).toBe('viking://resources/test.md');
      expect(record.contextType).toBe('resource');

      const retrieved = await cv.getByUri('viking://resources/test.md');
      expect(retrieved).toBeDefined();
      expect(retrieved?.abstract).toBe('Test abstract');
    });

    it('should update existing record on re-upsert', async () => {
      await cv.upsert({
        uri: 'viking://resources/test.md',
        contextType: 'resource',
        abstract: 'Original',
      });

      await cv.upsert({
        uri: 'viking://resources/test.md',
        contextType: 'resource',
        abstract: 'Updated',
      });

      const record = await cv.getByUri('viking://resources/test.md');
      expect(record?.abstract).toBe('Updated');
    });
  });

  describe('getById', () => {
    it('should retrieve by deterministic ID', async () => {
      const record = await cv.upsert({
        uri: 'viking://resources/test.md',
        contextType: 'resource',
      });

      const retrieved = await cv.getById(record.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.uri).toBe('viking://resources/test.md');
    });

    it('should return undefined for non-existent ID', async () => {
      const result = await cv.getById('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('deleteByUri and deleteById', () => {
    it('should delete by URI', async () => {
      await cv.upsert({
        uri: 'viking://resources/del.md',
        contextType: 'resource',
      });

      const deleted = await cv.deleteByUri('viking://resources/del.md');
      expect(deleted).toBe(true);
      expect(await cv.getByUri('viking://resources/del.md')).toBeUndefined();
    });

    it('should delete by ID', async () => {
      const record = await cv.upsert({
        uri: 'viking://resources/del2.md',
        contextType: 'resource',
      });

      const deleted = await cv.deleteById(record.id);
      expect(deleted).toBe(true);
    });

    it('should return false when deleting non-existent', async () => {
      expect(await cv.deleteByUri('viking://resources/nope.md')).toBe(false);
    });
  });

  describe('listByContextType', () => {
    it('should list records by context type', async () => {
      await cv.upsert({ uri: 'viking://resources/a.md', contextType: 'resource' });
      await cv.upsert({ uri: 'viking://agent/default/memories/b.md', contextType: 'memory' });
      await cv.upsert({ uri: 'viking://resources/c.md', contextType: 'resource' });

      const resources = await cv.listByContextType('resource');
      expect(resources).toHaveLength(2);

      const memories = await cv.listByContextType('memory');
      expect(memories).toHaveLength(1);
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await cv.upsert({ uri: `viking://resources/r${i}.md`, contextType: 'resource' });
      }

      const page1 = await cv.listByContextType('resource', { limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = await cv.listByContextType('resource', { limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);
    });
  });

  describe('searchSimilar', () => {
    it('should return results sorted by cosine similarity', async () => {
      const vec1 = new Array(4).fill(0.5) as number[];
      const vec2 = [0.5, 0.1, 0.1, 0.1] as number[];
      const queryVec = new Array(4).fill(0.5) as number[];

      await cv.upsert({
        uri: 'viking://resources/similar.md',
        contextType: 'resource',
        abstract: 'Similar',
        embedding: vec1,
      });

      await cv.upsert({
        uri: 'viking://resources/different.md',
        contextType: 'resource',
        abstract: 'Different',
        embedding: vec2,
      });

      const results = await cv.searchSimilar(queryVec, {
        contextType: 'resource',
      });

      expect(results).toHaveLength(2);
      expect(results[0]?.uri).toBe('viking://resources/similar.md');
      expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
    });

    it('should filter by scoreThreshold', async () => {
      const vec = new Array(4).fill(0.5) as number[];
      const oppositeVec = new Array(4).fill(-0.5) as number[];

      await cv.upsert({
        uri: 'viking://resources/good.md',
        contextType: 'resource',
        embedding: vec,
      });

      await cv.upsert({
        uri: 'viking://resources/bad.md',
        contextType: 'resource',
        embedding: oppositeVec,
      });

      const results = await cv.searchSimilar(vec, {
        contextType: 'resource',
        scoreThreshold: 0.5,
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.uri).toBe('viking://resources/good.md');
    });

    it('should return empty array when no embeddings exist', async () => {
      await cv.upsert({
        uri: 'viking://resources/no-embed.md',
        contextType: 'resource',
      });

      const results = await cv.searchSimilar([0.1, 0.2, 0.3], {
        contextType: 'resource',
      });

      expect(results).toHaveLength(0);
    });

    it('should filter by parentUriPrefix', async () => {
      const vec = new Array(4).fill(0.5) as number[];

      await cv.upsert({
        uri: 'viking://user/u1/memories/a.md',
        contextType: 'memory',
        embedding: vec,
      });

      await cv.upsert({
        uri: 'viking://agent/a1/memories/b.md',
        contextType: 'memory',
        embedding: vec,
      });

      const results = await cv.searchSimilar(vec, {
        contextType: 'memory',
        parentUriPrefix: 'viking://user/',
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.uri).toBe('viking://user/u1/memories/a.md');
    });
  });
});
