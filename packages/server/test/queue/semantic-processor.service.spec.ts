import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { SemanticProcessorService } from '../../src/queue/semantic-processor.service';
import { EmbeddingQueueService } from '../../src/queue/embedding-queue.service';
import { EmbeddingService } from '../../src/embedding/embedding.service';
import { VfsService } from '../../src/storage/vfs.service';
import { ContextVectorService } from '../../src/storage/context-vector.service';
import { DatabaseService } from '../../src/storage/database.service';
import { LlmService } from '../../src/llm/llm.service';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-sp-test-'));
}

describe('SemanticProcessorService', () => {
  let module: TestingModule;
  let processor: SemanticProcessorService;
  let vfs: VfsService;
  let mockSummarizeFile: jest.Mock;
  let mockGenerateDirectoryOverview: jest.Mock;
  let mockExtractAbstract: jest.Mock;
  let mockEnqueue: jest.Mock;

  beforeEach(async () => {
    mockSummarizeFile = jest.fn().mockResolvedValue('File summary');
    mockGenerateDirectoryOverview = jest.fn().mockResolvedValue('# Directory Overview\n\nThis directory contains test files for validation.');
    mockExtractAbstract = jest.fn().mockReturnValue('This directory contains test files for validation.');
    mockEnqueue = jest.fn();

    const tempDir = createTempDir();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ storage: { path: tempDir } })],
        }),
      ],
      providers: [
        SemanticProcessorService,
        DatabaseService,
        VfsService,
        ContextVectorService,
        {
          provide: EmbeddingQueueService,
          useValue: {
            enqueue: mockEnqueue,
            getStats: jest.fn().mockReturnValue({ queued: 0, active: 0, processed: 0, errors: 0 }),
          },
        },
        {
          provide: EmbeddingService,
          useValue: { embed: jest.fn().mockResolvedValue(new Array(1536).fill(0.1)) },
        },
        {
          provide: LlmService,
          useValue: {
            summarizeFile: mockSummarizeFile,
            generateDirectoryOverview: mockGenerateDirectoryOverview,
            extractAbstractFromOverview: mockExtractAbstract,
          },
        },
      ],
    }).compile();

    await module.init();
    processor = module.get(SemanticProcessorService);
    vfs = module.get(VfsService);

  });

  afterEach(async () => {
    await module.close();
  });

  describe('processDirectory (resource/skill)', () => {
    it('should generate L0/L1 and enqueue embeddings', async () => {
      await vfs.mkdir('viking://resources');
      await vfs.writeFile('viking://resources/doc1.md', 'Document one content');
      await vfs.writeFile('viking://resources/doc2.md', 'Document two content');

      await processor.processDirectory({
        uri: 'viking://resources',
        contextType: 'resource',
        accountId: 'default',
        ownerSpace: '',
      });

      expect(mockSummarizeFile).toHaveBeenCalledTimes(2);
      expect(mockGenerateDirectoryOverview).toHaveBeenCalledTimes(1);

      const abstractContent = await vfs.readFile('viking://resources/.abstract.md');
      expect(abstractContent).toBeTruthy();

      const overviewContent = await vfs.readFile('viking://resources/.overview.md');
      expect(overviewContent).toBeTruthy();

      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      const l0Call = mockEnqueue.mock.calls.find(
        (c: Array<{ level: number }>) => c[0]?.level === 0,
      );
      const l1Call = mockEnqueue.mock.calls.find(
        (c: Array<{ level: number }>) => c[0]?.level === 1,
      );
      expect(l0Call).toBeDefined();
      expect(l1Call).toBeDefined();
    });

    it('should handle empty directory gracefully', async () => {
      await vfs.mkdir('viking://resources/empty');

      await processor.processDirectory({
        uri: 'viking://resources/empty',
        contextType: 'resource',
        accountId: 'default',
        ownerSpace: '',
      });

      expect(mockSummarizeFile).not.toHaveBeenCalled();
      expect(mockGenerateDirectoryOverview).toHaveBeenCalledTimes(1);
    });
  });

  describe('processMemoryDirectory', () => {
    it('should enqueue L2 for each file and generate L0/L1', async () => {
      await vfs.mkdir('viking://agent/test/memories');
      await vfs.writeFile('viking://agent/test/memories/m1.md', 'Memory one');
      await vfs.writeFile('viking://agent/test/memories/m2.md', 'Memory two');

      await processor.processMemoryDirectory({
        uri: 'viking://agent/test/memories',
        contextType: 'memory',
        accountId: 'default',
        ownerSpace: 'test',
      });

      expect(mockSummarizeFile).not.toHaveBeenCalled();

      const enqueueCalls = mockEnqueue.mock.calls;
      const l2Calls = enqueueCalls.filter(
        (c: Array<{ level: number }>) => c[0]?.level === 2,
      );
      expect(l2Calls.length).toBe(2);

      const l0Calls = enqueueCalls.filter(
        (c: Array<{ level: number }>) => c[0]?.level === 0,
      );
      const l1Calls = enqueueCalls.filter(
        (c: Array<{ level: number }>) => c[0]?.level === 1,
      );
      expect(l0Calls.length).toBe(1);
      expect(l1Calls.length).toBe(1);
    });

    it('should chunk large memory files', async () => {
      await vfs.mkdir('viking://user/test/memories');
      const largeContent = 'Paragraph one content.\n\n'.repeat(200);
      await vfs.writeFile('viking://user/test/memories/large.md', largeContent);

      await processor.processMemoryDirectory({
        uri: 'viking://user/test/memories',
        contextType: 'memory',
        accountId: 'default',
        ownerSpace: 'test',
      });

      const enqueueCalls = mockEnqueue.mock.calls;
      const l2Calls = enqueueCalls.filter(
        (c: Array<{ level: number }>) => c[0]?.level === 2,
      );
      expect(l2Calls.length).toBeGreaterThan(1);

      const chunkCalls = l2Calls.filter(
        (c: Array<{ uri: string }>) => c[0]?.uri.includes('#chunk_'),
      );
      expect(chunkCalls.length).toBeGreaterThan(0);
    });
  });
});
