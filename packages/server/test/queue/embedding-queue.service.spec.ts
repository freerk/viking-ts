import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EmbeddingQueueService, EmbeddingJob } from '../../src/queue/embedding-queue.service';
import { EmbeddingService } from '../../src/embedding/embedding.service';
import { ContextVectorService } from '../../src/storage/context-vector.service';
import { DatabaseService } from '../../src/storage/database.service';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { typeOrmTestImports } from '../helpers/test-typeorm';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-eq-test-'));
}

describe('EmbeddingQueueService', () => {
  let module: TestingModule;
  let service: EmbeddingQueueService;
  let mockEmbed: jest.Mock;

  const FAKE_VECTOR = new Array(1536).fill(0.1) as number[];

  beforeEach(async () => {
    mockEmbed = jest.fn().mockResolvedValue(FAKE_VECTOR);
    const tempDir = createTempDir();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ storage: { path: tempDir } })],
        }),
        ...typeOrmTestImports(tempDir),
      ],
      providers: [
        EmbeddingQueueService,
        DatabaseService,
        ContextVectorService,
        {
          provide: EmbeddingService,
          useValue: { embed: mockEmbed },
        },
      ],
    }).compile();

    await module.init();
    service = module.get(EmbeddingQueueService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should enqueue and process an embedding job', async () => {
    const job: EmbeddingJob = {
      uri: 'viking://test/file.md',
      text: 'Test content',
      contextType: 'memory',
      level: 2,
      abstract: 'Test abstract',
      name: 'file.md',
      parentUri: 'viking://test',
      accountId: 'default',
      ownerSpace: 'test',
    };

    service.enqueue(job);

    await waitForStats(service, (s) => s.processed >= 1);

    expect(mockEmbed).toHaveBeenCalledWith('Test content');

    const contextVectors = module.get(ContextVectorService);
    const record = await contextVectors.getByUri('viking://test/file.md');
    expect(record).toBeDefined();
    expect(record?.embedding).toBeDefined();
    expect(record?.level).toBe(2);
  });

  it('should store record without vector on embedding failure', async () => {
    mockEmbed.mockRejectedValue(new Error('Embedding API down'));

    const job: EmbeddingJob = {
      uri: 'viking://test/fail.md',
      text: 'Will fail embedding',
      contextType: 'resource',
      level: 2,
      abstract: 'Fail test',
      name: 'fail.md',
      parentUri: 'viking://test',
      accountId: 'default',
      ownerSpace: '',
    };

    service.enqueue(job);

    await waitForStats(service, (s) => s.processed + s.errors >= 1);

    const contextVectors = module.get(ContextVectorService);
    const record = await contextVectors.getByUri('viking://test/fail.md');
    expect(record).toBeDefined();
    expect(record?.embedding).toBeNull();
  }, 15000);

  it('should report stats', () => {
    const stats = service.getStats();
    expect(stats).toHaveProperty('queued');
    expect(stats).toHaveProperty('active');
    expect(stats).toHaveProperty('processed');
    expect(stats).toHaveProperty('errors');
  });
});

async function waitForStats(
  service: EmbeddingQueueService,
  predicate: (stats: { queued: number; active: number; processed: number; errors: number }) => boolean,
  timeoutMs = 10000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(service.getStats())) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}
