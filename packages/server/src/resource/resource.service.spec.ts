import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ResourceService } from './resource.service';
import { VfsService } from '../storage/vfs.service';
import { ContextVectorService } from '../storage/context-vector.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
import { LlmService } from '../llm/llm.service';
import * as parsers from './parsers';

jest.mock('./parsers', () => ({
  parsePdf: jest.fn(),
  parseDocx: jest.fn(),
  parseXlsx: jest.fn(),
  parsePptx: jest.fn(),
  parseHtml: jest.fn(),
  parseImage: jest.fn(),
  parseAudio: jest.fn(),
  stripHtmlTags: jest.fn(),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn().mockReturnValue(true),
    statSync: jest.fn().mockReturnValue({ isDirectory: () => false }),
    readFileSync: jest.fn().mockReturnValue('plain text content'),
  };
});

describe('ResourceService', () => {
  let service: ResourceService;

  const mockVfs = { writeFile: jest.fn().mockResolvedValue(undefined), readFile: jest.fn(), rm: jest.fn() };
  const mockContextVectors = { upsert: jest.fn().mockResolvedValue(undefined), searchSimilar: jest.fn(), getById: jest.fn(), deleteById: jest.fn(), listByContextType: jest.fn(), generateId: jest.fn() };
  const mockEmbeddingService = { embed: jest.fn().mockResolvedValue([0.1, 0.2]) };
  const mockEmbeddingQueue = { enqueue: jest.fn() };
  const mockSemanticQueue = { enqueue: jest.fn() };
  const mockLlmService = { describeImage: jest.fn().mockResolvedValue('image description') };
  const mockConfig = {
    get: jest.fn().mockImplementation((key: string, defaultVal?: string) => {
      const map: Record<string, string> = {
        'transcription.provider': 'openai',
        'transcription.apiKey': '',
        'transcription.apiBase': 'https://api.openai.com/v1',
        'transcription.model': 'whisper-1',
      };
      return map[key] ?? defaultVal ?? '';
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceService,
        { provide: VfsService, useValue: mockVfs },
        { provide: ContextVectorService, useValue: mockContextVectors },
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: ConfigService, useValue: mockConfig },
        { provide: LlmService, useValue: mockLlmService },
        { provide: EmbeddingQueueService, useValue: mockEmbeddingQueue },
        { provide: SemanticQueueService, useValue: mockSemanticQueue },
      ],
    }).compile();

    service = module.get<ResourceService>(ResourceService);
  });

  describe('addResource input modes', () => {
    it('should write text content to VFS at the specified URI', async () => {
      mockVfs.writeFile.mockResolvedValue(undefined);

      const result = await service.addResource({
        text: 'hello world',
        to: 'viking://resources/test.md',
      });

      expect(result.status).toBe('success');
      expect(mockVfs.writeFile).toHaveBeenCalledWith(
        'viking://resources/test.md',
        'hello world',
      );
    });

    it('should throw 400 when target URI is outside viking://resources/ scope', async () => {
      await expect(
        service.addResource({
          text: 'should fail',
          to: 'viking://user/default/memories/test.md',
        }),
      ).rejects.toThrow('Target URI must be in viking://resources/ scope');
    });

    it('should throw 400 when both to and parent are specified', async () => {
      await expect(
        service.addResource({
          to: 'viking://resources/dest',
          parent: 'viking://resources/parent',
          text: 'conflict',
        }),
      ).rejects.toThrow("Cannot specify both 'to' and 'parent'");
    });

    it('should fetch URL content when path is an HTTP URL', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: jest.fn().mockReturnValue('text/plain') },
        text: jest.fn().mockResolvedValue('Remote doc content'),
      });
      mockVfs.writeFile.mockResolvedValue(undefined);

      const result = await service.addResource({
        path: 'https://example.com/doc.md',
      });

      expect(global.fetch).toHaveBeenCalledWith('https://example.com/doc.md');
      expect(result.status).toBe('success');
    });
  });

  describe('ingestFile with PDF', () => {
    it('should call parsePdf for .pdf files', async () => {
      (parsers.parsePdf as jest.Mock).mockResolvedValue('PDF text content');

      const result = await service.addResource({ path: '/tmp/doc.pdf' });

      expect(parsers.parsePdf).toHaveBeenCalledWith('/tmp/doc.pdf');
      expect(result.status).toBe('success');
      expect(mockVfs.writeFile).toHaveBeenCalled();
    });
  });

  describe('ingestFile with DOCX', () => {
    it('should call parseDocx for .docx files', async () => {
      (parsers.parseDocx as jest.Mock).mockResolvedValue('DOCX text content');

      const result = await service.addResource({ path: '/tmp/doc.docx' });

      expect(parsers.parseDocx).toHaveBeenCalledWith('/tmp/doc.docx');
      expect(result.status).toBe('success');
    });
  });

  describe('ingestFile with XLSX', () => {
    it('should call parseXlsx for .xlsx files', async () => {
      (parsers.parseXlsx as jest.Mock).mockResolvedValue('## Sheet: Data\nA,B\n1,2');

      const result = await service.addResource({ path: '/tmp/data.xlsx' });

      expect(parsers.parseXlsx).toHaveBeenCalledWith('/tmp/data.xlsx');
      expect(result.status).toBe('success');
    });

    it('should call parseXlsx for .csv files', async () => {
      (parsers.parseXlsx as jest.Mock).mockResolvedValue('a,b\n1,2');

      const result = await service.addResource({ path: '/tmp/data.csv' });

      expect(parsers.parseXlsx).toHaveBeenCalledWith('/tmp/data.csv');
      expect(result.status).toBe('success');
    });
  });

  describe('ingestFile with HTML', () => {
    it('should call parseHtml for .html files', async () => {
      (parsers.parseHtml as jest.Mock).mockResolvedValue('Stripped HTML text');

      const result = await service.addResource({ path: '/tmp/page.html' });

      expect(parsers.parseHtml).toHaveBeenCalledWith('/tmp/page.html');
      expect(result.status).toBe('success');
    });
  });

  describe('ingestFile with image', () => {
    it('should call parseImage for .png files with LlmService', async () => {
      (parsers.parseImage as jest.Mock).mockResolvedValue('A colorful chart');

      const result = await service.addResource({ path: '/tmp/chart.png' });

      expect(parsers.parseImage).toHaveBeenCalledWith('/tmp/chart.png', mockLlmService);
      expect(result.status).toBe('success');
    });
  });

  describe('ingestFile with audio', () => {
    it('should call parseAudio for .mp3 files', async () => {
      (parsers.parseAudio as jest.Mock).mockResolvedValue('Transcribed text');

      const result = await service.addResource({ path: '/tmp/recording.mp3' });

      expect(parsers.parseAudio).toHaveBeenCalledWith(
        '/tmp/recording.mp3',
        expect.objectContaining({ provider: 'openai', model: 'whisper-1' }),
      );
      expect(result.status).toBe('success');
    });
  });

  describe('ingestFile with empty parse result', () => {
    it('should return error when no content extracted', async () => {
      (parsers.parsePdf as jest.Mock).mockResolvedValue('   ');

      const result = await service.addResource({ path: '/tmp/empty.pdf' });

      expect(result.status).toBe('error');
      expect(result.errors[0]).toContain('No content extracted');
    });
  });

  describe('ingestFile with parse error', () => {
    it('should return error on parse failure', async () => {
      (parsers.parsePdf as jest.Mock).mockRejectedValue(new Error('Corrupt PDF'));

      const result = await service.addResource({ path: '/tmp/corrupt.pdf' });

      expect(result.status).toBe('error');
      expect(result.errors[0]).toContain('Parse error');
      expect(result.errors[0]).toContain('Corrupt PDF');
    });
  });

  describe('ingestFile with plain text', () => {
    it('should read text files directly', async () => {
      const result = await service.addResource({ path: '/tmp/readme.md' });

      expect(result.status).toBe('success');
      expect(parsers.parsePdf).not.toHaveBeenCalled();
      expect(parsers.parseDocx).not.toHaveBeenCalled();
    });
  });

  describe('ingestUrl with HTML content-type', () => {
    it('should strip HTML tags when content-type is text/html', async () => {
      (parsers.stripHtmlTags as jest.Mock).mockReturnValue('Clean page text');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('text/html; charset=utf-8'),
        },
        text: jest.fn().mockResolvedValue('<html><body><p>Clean page text</p></body></html>'),
      });

      const result = await service.addResource({ path: 'https://example.com/page' });

      expect(parsers.stripHtmlTags).toHaveBeenCalledWith(
        '<html><body><p>Clean page text</p></body></html>',
      );
      expect(result.status).toBe('success');
    });

    it('should not strip tags for non-HTML content-type', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('text/plain'),
        },
        text: jest.fn().mockResolvedValue('Plain text from URL'),
      });

      const result = await service.addResource({ path: 'https://example.com/file.txt' });

      expect(parsers.stripHtmlTags).not.toHaveBeenCalled();
      expect(result.status).toBe('success');
    });
  });
});
