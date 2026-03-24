import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { PackService, validateZipEntryPath } from '../src/pack/pack.service';
import { VfsService, TreeNode } from '../src/storage/vfs.service';
import { EmbeddingQueueService } from '../src/queue/embedding-queue.service';
import { ConflictError } from '../src/shared/errors';

describe('PackService', () => {
  let service: PackService;
  let tmpDir: string;

  const mockVfs = {
    tree: jest.fn<Promise<TreeNode>, [string]>(),
    readFile: jest.fn<Promise<string>, [string]>(),
    writeFile: jest.fn<Promise<unknown>, [string, string]>(),
    mkdir: jest.fn<Promise<unknown>, [string]>(),
    exists: jest.fn<Promise<boolean>, [string]>(),
  };

  const mockEmbeddingQueue = {
    enqueue: jest.fn(),
  };

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-test-'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackService,
        { provide: VfsService, useValue: mockVfs },
        { provide: EmbeddingQueueService, useValue: mockEmbeddingQueue },
      ],
    }).compile();

    service = module.get(PackService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('exportOvpack', () => {
    const TREE: TreeNode = {
      uri: 'viking://resources/my-project',
      name: 'my-project',
      isDir: true,
      size: 0,
      children: [
        {
          uri: 'viking://resources/my-project/.abstract.md',
          name: '.abstract.md',
          isDir: false,
          size: 20,
        },
        {
          uri: 'viking://resources/my-project/docs',
          name: 'docs',
          isDir: true,
          size: 0,
          children: [
            {
              uri: 'viking://resources/my-project/docs/api.md',
              name: 'api.md',
              isDir: false,
              size: 50,
            },
          ],
        },
      ],
    };

    beforeEach(() => {
      mockVfs.tree.mockResolvedValue(TREE);
      mockVfs.readFile.mockImplementation(async (uri: string) => {
        if (uri.endsWith('.abstract.md')) return 'Abstract content';
        if (uri.endsWith('api.md')) return '# API docs';
        return '';
      });
    });

    it('should create a zip with correct structure and _._meta.json', async () => {
      const outPath = path.join(tmpDir, 'export.ovpack');
      const result = await service.exportOvpack(
        'viking://resources/my-project',
        outPath,
      );

      expect(result).toBe(outPath);
      expect(fs.existsSync(outPath)).toBe(true);

      const zip = new AdmZip(outPath);
      const entryNames = zip.getEntries().map((e) => e.entryName);

      expect(entryNames).toContain('my-project/');
      expect(entryNames).toContain('my-project/_._meta.json');
      expect(entryNames).toContain('my-project/.abstract.md');
      expect(entryNames).toContain('my-project/docs/');
      expect(entryNames).toContain('my-project/docs/api.md');

      const meta = JSON.parse(
        zip.getEntry('my-project/_._meta.json')!.getData().toString('utf-8'),
      );
      expect(meta.uri).toBe('viking://resources/my-project');
      expect(meta.version).toBe('1.0');
      expect(meta.exported_at).toBeDefined();
    });

    it('should auto-append .ovpack extension', async () => {
      const outPath = path.join(tmpDir, 'export');
      const result = await service.exportOvpack(
        'viking://resources/my-project',
        outPath,
      );

      expect(result).toBe(outPath + '.ovpack');
      expect(fs.existsSync(outPath + '.ovpack')).toBe(true);
    });

    it('should not double-append .ovpack extension', async () => {
      const outPath = path.join(tmpDir, 'export.ovpack');
      const result = await service.exportOvpack(
        'viking://resources/my-project',
        outPath,
      );

      expect(result).toBe(outPath);
    });
  });

  describe('importOvpack', () => {
    function createTestOvpack(entries: Array<{ name: string; content?: string }>): string {
      const zip = new AdmZip();
      for (const entry of entries) {
        if (entry.name.endsWith('/')) {
          zip.addFile(entry.name, Buffer.alloc(0));
        } else {
          zip.addFile(entry.name, Buffer.from(entry.content ?? '', 'utf-8'));
        }
      }
      const filePath = path.join(tmpDir, 'test.ovpack');
      zip.writeZip(filePath);
      return filePath;
    }

    it('should import a single file to the correct URI', async () => {
      const filePath = createTestOvpack([
        { name: 'my-project/' },
        { name: 'my-project/readme.md', content: '# Hello' },
      ]);
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.mkdir.mockResolvedValue({});
      mockVfs.writeFile.mockResolvedValue({});

      const result = await service.importOvpack(
        filePath,
        'viking://resources',
        false,
        false,
      );

      expect(result).toBe('viking://resources/my-project');
      expect(mockVfs.writeFile).toHaveBeenCalledWith(
        'viking://resources/my-project/readme.md',
        '# Hello',
      );
    });

    it('should handle nested directories correctly', async () => {
      const filePath = createTestOvpack([
        { name: 'my-project/' },
        { name: 'my-project/docs/' },
        { name: 'my-project/docs/api.md', content: '# API' },
      ]);
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.mkdir.mockResolvedValue({});
      mockVfs.writeFile.mockResolvedValue({});

      await service.importOvpack(filePath, 'viking://resources', false, false);

      expect(mockVfs.mkdir).toHaveBeenCalledWith('viking://resources/my-project/docs');
      expect(mockVfs.writeFile).toHaveBeenCalledWith(
        'viking://resources/my-project/docs/api.md',
        '# API',
      );
    });

    it('should throw ConflictError when root exists and force=false', async () => {
      const filePath = createTestOvpack([
        { name: 'my-project/' },
        { name: 'my-project/readme.md', content: '# Hello' },
      ]);
      mockVfs.exists.mockResolvedValue(true);

      await expect(
        service.importOvpack(filePath, 'viking://resources', false, false),
      ).rejects.toThrow(ConflictError);
    });

    it('should overwrite when root exists and force=true', async () => {
      const filePath = createTestOvpack([
        { name: 'my-project/' },
        { name: 'my-project/readme.md', content: '# Hello' },
      ]);
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.writeFile.mockResolvedValue({});

      const result = await service.importOvpack(
        filePath,
        'viking://resources',
        true,
        false,
      );

      expect(result).toBe('viking://resources/my-project');
      expect(mockVfs.writeFile).toHaveBeenCalled();
    });

    it('should enqueue embeddings when vectorize=true', async () => {
      const filePath = createTestOvpack([
        { name: 'my-project/' },
        { name: 'my-project/readme.md', content: '# Hello' },
      ]);
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.writeFile.mockResolvedValue({});

      await service.importOvpack(filePath, 'viking://resources', false, true);

      expect(mockEmbeddingQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          uri: 'viking://resources/my-project/readme.md',
          contextType: 'resource',
        }),
      );
    });

    it('should reject entries with mismatched root', async () => {
      const filePath = createTestOvpack([
        { name: 'my-project/' },
        { name: 'other-root/secret.md', content: 'evil' },
      ]);
      mockVfs.exists.mockResolvedValue(false);

      await expect(
        service.importOvpack(filePath, 'viking://resources', false, false),
      ).rejects.toThrow('Invalid root in zip');
    });

    it('should throw when file does not exist', async () => {
      await expect(
        service.importOvpack('/nonexistent/file.ovpack', 'viking://resources', false, false),
      ).rejects.toThrow('File not found');
    });

    it('should not enqueue embeddings when vectorize=false', async () => {
      const filePath = createTestOvpack([
        { name: 'my-project/' },
        { name: 'my-project/readme.md', content: '# Hello' },
      ]);
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.writeFile.mockResolvedValue({});

      await service.importOvpack(filePath, 'viking://resources', false, false);

      expect(mockEmbeddingQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should strip trailing slashes from parent URI', async () => {
      const filePath = createTestOvpack([
        { name: 'my-project/' },
        { name: 'my-project/readme.md', content: '# Hello' },
      ]);
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.writeFile.mockResolvedValue({});

      const result = await service.importOvpack(
        filePath,
        'viking://resources/',
        false,
        false,
      );

      expect(result).toBe('viking://resources/my-project');
    });
  });

  describe('validateZipEntryPath', () => {
    it('should accept valid paths', () => {
      expect(() => validateZipEntryPath('proj/', 'proj')).not.toThrow();
      expect(() => validateZipEntryPath('proj/docs/api.md', 'proj')).not.toThrow();
    });

    it('should reject empty paths', () => {
      expect(() => validateZipEntryPath('', 'proj')).toThrow('Empty zip entry path');
    });

    it('should reject paths with backslashes', () => {
      expect(() => validateZipEntryPath('proj\\file.md', 'proj')).toThrow('Unsafe path');
    });

    it('should reject absolute paths', () => {
      expect(() => validateZipEntryPath('/etc/passwd', 'proj')).toThrow('Unsafe path');
    });

    it('should reject drive letter paths', () => {
      expect(() => validateZipEntryPath('C:file.md', 'proj')).toThrow('Unsafe path');
    });

    it('should reject paths with ..', () => {
      expect(() => validateZipEntryPath('proj/../etc/passwd', 'proj')).toThrow('Unsafe path');
    });

    it('should reject paths with mismatched root', () => {
      expect(() => validateZipEntryPath('other/file.md', 'proj')).toThrow('Invalid root in zip');
    });

    it('should reject ../escape traversal path', () => {
      expect(() => validateZipEntryPath('../escape', 'proj')).toThrow('Unsafe path');
    });
  });

  describe('export then import round-trip', () => {
    it('should export a tree and import it back to VFS', async () => {
      const TREE: TreeNode = {
        uri: 'viking://resources/roundtrip',
        name: 'roundtrip',
        isDir: true,
        size: 0,
        children: [
          { uri: 'viking://resources/roundtrip/doc.md', name: 'doc.md', isDir: false, size: 12 },
        ],
      };

      mockVfs.tree.mockResolvedValue(TREE);
      mockVfs.readFile.mockResolvedValue('Round-trip content');
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.writeFile.mockResolvedValue({});

      const exportPath = path.join(tmpDir, 'roundtrip.ovpack');
      const exported = await service.exportOvpack('viking://resources/roundtrip', exportPath);
      expect(fs.existsSync(exported)).toBe(true);

      const importResult = await service.importOvpack(exported, 'viking://resources', false, false);
      expect(importResult).toBe('viking://resources/roundtrip');
      expect(mockVfs.writeFile).toHaveBeenCalledWith(
        'viking://resources/roundtrip/doc.md',
        expect.any(String),
      );
    });

    it('should enqueue embeddings for each file when vectorize=true in round-trip', async () => {
      const TREE: TreeNode = {
        uri: 'viking://resources/vec-test',
        name: 'vec-test',
        isDir: true,
        size: 0,
        children: [
          { uri: 'viking://resources/vec-test/a.md', name: 'a.md', isDir: false, size: 5 },
          { uri: 'viking://resources/vec-test/b.md', name: 'b.md', isDir: false, size: 5 },
        ],
      };

      mockVfs.tree.mockResolvedValue(TREE);
      mockVfs.readFile.mockResolvedValue('Content');
      mockVfs.exists.mockResolvedValue(false);
      mockVfs.writeFile.mockResolvedValue({});

      const exportPath = path.join(tmpDir, 'vec.ovpack');
      await service.exportOvpack('viking://resources/vec-test', exportPath);
      await service.importOvpack(exportPath, 'viking://resources', false, true);

      // a.md, b.md, and _._meta.json are all enqueued
      expect(mockEmbeddingQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ uri: 'viking://resources/vec-test/a.md' }),
      );
      expect(mockEmbeddingQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ uri: 'viking://resources/vec-test/b.md' }),
      );
      expect(mockEmbeddingQueue.enqueue).toHaveBeenCalledTimes(3);
    });
  });
});
