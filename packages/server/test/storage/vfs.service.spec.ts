import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { VfsService } from '../../src/storage/vfs.service';
import { NotFoundError, ConflictError, InvalidUriError } from '../../src/shared/errors';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { typeOrmTestImports } from '../helpers/test-typeorm';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-vfs-test-'));
}

describe('VfsService', () => {
  let module: TestingModule;
  let vfs: VfsService;

  beforeEach(async () => {
    const tempDir = createTempDir();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ storage: { path: tempDir } })],
        }),
        ...typeOrmTestImports(tempDir),
      ],
      providers: [VfsService],
    }).compile();

    await module.init();
    vfs = module.get(VfsService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('normalizeUri', () => {
    it('should strip trailing slashes except for bare viking://', () => {
      expect(vfs.normalizeUri('viking://resources/')).toBe('viking://resources');
      expect(vfs.normalizeUri('viking://resources/foo/')).toBe('viking://resources/foo');
      expect(vfs.normalizeUri('viking://')).toBe('viking://');
    });

    it('should throw InvalidUriError for non-viking URIs', () => {
      expect(() => vfs.normalizeUri('http://invalid')).toThrow(InvalidUriError);
    });
  });

  describe('parentUri', () => {
    it('should return parent directory URI', () => {
      expect(vfs.parentUri('viking://resources/foo/bar.md')).toBe('viking://resources/foo');
      expect(vfs.parentUri('viking://resources/foo')).toBe('viking://resources');
      expect(vfs.parentUri('viking://resources')).toBe('viking://');
    });

    it('should return null for root', () => {
      expect(vfs.parentUri('viking://')).toBeNull();
    });
  });

  describe('mkdir', () => {
    it('should create a directory', async () => {
      const entry = await vfs.mkdir('viking://agent/test/memories');
      expect(entry.uri).toBe('viking://agent/test/memories');
      expect(entry.isDir).toBe(true);
      expect(entry.name).toBe('memories');
    });

    it('should create parent directories recursively', async () => {
      await vfs.mkdir('viking://agent/deep/nested/dir');
      expect(await vfs.exists('viking://agent')).toBe(true);
      expect(await vfs.exists('viking://agent/deep')).toBe(true);
      expect(await vfs.exists('viking://agent/deep/nested')).toBe(true);
      expect(await vfs.exists('viking://agent/deep/nested/dir')).toBe(true);
    });

    it('should be idempotent for existing directories', async () => {
      const first = await vfs.mkdir('viking://agent/test');
      const second = await vfs.mkdir('viking://agent/test');
      expect(first.uri).toBe(second.uri);
    });

    it('should throw ConflictError if file exists at URI', async () => {
      await vfs.writeFile('viking://agent/test', 'content');
      await expect(vfs.mkdir('viking://agent/test')).rejects.toThrow(ConflictError);
    });
  });

  describe('writeFile and readFile', () => {
    it('should write and read file content', async () => {
      await vfs.writeFile('viking://resources/test.md', 'Hello World');
      const content = await vfs.readFile('viking://resources/test.md');
      expect(content).toBe('Hello World');
    });

    it('should create parent directories automatically', async () => {
      await vfs.writeFile('viking://resources/nested/deep/file.md', 'content');
      expect(await vfs.exists('viking://resources')).toBe(true);
      expect(await vfs.exists('viking://resources/nested')).toBe(true);
      expect(await vfs.exists('viking://resources/nested/deep')).toBe(true);
    });

    it('should overwrite existing file content', async () => {
      await vfs.writeFile('viking://resources/test.md', 'Original');
      await vfs.writeFile('viking://resources/test.md', 'Updated');
      const content = await vfs.readFile('viking://resources/test.md');
      expect(content).toBe('Updated');
    });

    it('should throw NotFoundError when reading non-existent file', async () => {
      await expect(vfs.readFile('viking://resources/nope.md')).rejects.toThrow(NotFoundError);
    });
  });

  describe('stat', () => {
    it('should return info about a file', async () => {
      await vfs.writeFile('viking://resources/doc.md', 'Content');
      const stat = await vfs.stat('viking://resources/doc.md');
      expect(stat.uri).toBe('viking://resources/doc.md');
      expect(stat.isDir).toBe(false);
      expect(stat.name).toBe('doc.md');
      expect(stat.size).toBeGreaterThan(0);
    });

    it('should return info about a directory', async () => {
      await vfs.mkdir('viking://agent/test');
      const stat = await vfs.stat('viking://agent/test');
      expect(stat.isDir).toBe(true);
      expect(stat.name).toBe('test');
    });

    it('should throw NotFoundError for non-existent URI', async () => {
      await expect(vfs.stat('viking://nowhere')).rejects.toThrow(NotFoundError);
    });
  });

  describe('rm', () => {
    it('should delete a file', async () => {
      await vfs.writeFile('viking://resources/del.md', 'bye');
      await vfs.rm('viking://resources/del.md');
      expect(await vfs.exists('viking://resources/del.md')).toBe(false);
    });

    it('should throw NotFoundError for non-existent URI', async () => {
      await expect(vfs.rm('viking://resources/nope')).rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError for non-empty directory without recursive', async () => {
      await vfs.writeFile('viking://resources/dir/file.md', 'content');
      await expect(vfs.rm('viking://resources/dir')).rejects.toThrow(ConflictError);
    });

    it('should delete directory and children with recursive flag', async () => {
      await vfs.writeFile('viking://resources/dir/a.md', 'a');
      await vfs.writeFile('viking://resources/dir/b.md', 'b');
      await vfs.rm('viking://resources/dir', true);
      expect(await vfs.exists('viking://resources/dir')).toBe(false);
      expect(await vfs.exists('viking://resources/dir/a.md')).toBe(false);
    });
  });

  describe('mv', () => {
    it('should move a file', async () => {
      await vfs.writeFile('viking://resources/old.md', 'content');
      await vfs.mv('viking://resources/old.md', 'viking://resources/new.md');
      expect(await vfs.exists('viking://resources/old.md')).toBe(false);
      const content = await vfs.readFile('viking://resources/new.md');
      expect(content).toBe('content');
    });

    it('should throw NotFoundError for non-existent source', async () => {
      await expect(
        vfs.mv('viking://resources/nope.md', 'viking://resources/dest.md'),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError if target exists', async () => {
      await vfs.writeFile('viking://resources/a.md', 'a');
      await vfs.writeFile('viking://resources/b.md', 'b');
      await expect(
        vfs.mv('viking://resources/a.md', 'viking://resources/b.md'),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('ls', () => {
    it('should list direct children', async () => {
      await vfs.writeFile('viking://resources/a.md', 'a');
      await vfs.writeFile('viking://resources/b.md', 'b');
      await vfs.writeFile('viking://resources/sub/c.md', 'c');

      const entries = await vfs.ls('viking://resources');
      const uris = entries.map((e) => e.uri);
      expect(uris).toContain('viking://resources/a.md');
      expect(uris).toContain('viking://resources/b.md');
      expect(uris).toContain('viking://resources/sub');
      expect(uris).not.toContain('viking://resources/sub/c.md');
    });

    it('should hide .abstract.md and .overview.md by default', async () => {
      await vfs.writeFile('viking://resources/.abstract.md', 'abs');
      await vfs.writeFile('viking://resources/.overview.md', 'over');
      await vfs.writeFile('viking://resources/visible.md', 'vis');

      const entries = await vfs.ls('viking://resources');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe('visible.md');
    });

    it('should show hidden files when showAllHidden=true', async () => {
      await vfs.writeFile('viking://resources/.abstract.md', 'abs');
      await vfs.writeFile('viking://resources/visible.md', 'vis');

      const entries = await vfs.ls('viking://resources', { showAllHidden: true });
      expect(entries).toHaveLength(2);
    });

    it('should list recursively when recursive=true', async () => {
      await vfs.writeFile('viking://resources/a.md', 'a');
      await vfs.writeFile('viking://resources/sub/b.md', 'b');

      const entries = await vfs.ls('viking://resources', { recursive: true });
      const uris = entries.map((e) => e.uri);
      expect(uris).toContain('viking://resources/a.md');
      expect(uris).toContain('viking://resources/sub');
      expect(uris).toContain('viking://resources/sub/b.md');
    });

    it('should respect nodeLimit', async () => {
      await vfs.writeFile('viking://resources/a.md', 'a');
      await vfs.writeFile('viking://resources/b.md', 'b');
      await vfs.writeFile('viking://resources/c.md', 'c');

      const entries = await vfs.ls('viking://resources', { nodeLimit: 2 });
      expect(entries).toHaveLength(2);
    });
  });

  describe('abstract and overview', () => {
    it('should return empty string when no abstract exists', async () => {
      await vfs.mkdir('viking://agent/test');
      const abs = await vfs.abstract('viking://agent/test');
      expect(abs).toBe('');
    });

    it('should return abstract content when it exists', async () => {
      await vfs.writeFile('viking://agent/test/.abstract.md', 'This is the abstract');
      const abs = await vfs.abstract('viking://agent/test');
      expect(abs).toBe('This is the abstract');
    });

    it('should return overview content when it exists', async () => {
      await vfs.writeFile('viking://agent/test/.overview.md', 'This is the overview');
      const ov = await vfs.overview('viking://agent/test');
      expect(ov).toBe('This is the overview');
    });
  });

  describe('tree', () => {
    it('should return tree structure', async () => {
      await vfs.writeFile('viking://resources/a.md', 'a');
      await vfs.writeFile('viking://resources/sub/b.md', 'b');

      const tree = await vfs.tree('viking://resources');
      expect(tree.uri).toBe('viking://resources');
      expect(tree.isDir).toBe(true);
      expect(tree.children).toBeDefined();
      expect(tree.children!.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('grep', () => {
    it('should find matching content in files', async () => {
      await vfs.writeFile('viking://resources/a.md', 'Hello world\nGoodbye world');
      await vfs.writeFile('viking://resources/b.md', 'No match here');

      const results = await vfs.grep('viking://resources', 'Hello');
      expect(results).toHaveLength(1);
      expect(results[0]?.uri).toBe('viking://resources/a.md');
      expect(results[0]?.matches).toContain('Hello world');
    });
  });
});
