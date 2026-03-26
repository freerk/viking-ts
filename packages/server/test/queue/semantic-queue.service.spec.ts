import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { SemanticQueueService } from '../../src/queue/semantic-queue.service';
import { SemanticProcessorService } from '../../src/queue/semantic-processor.service';
import { VfsService } from '../../src/storage/vfs.service';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { typeOrmTestImports } from '../helpers/test-typeorm';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'viking-sq-test-'));
}

describe('SemanticQueueService', () => {
  let module: TestingModule;
  let service: SemanticQueueService;
  let mockProcessDirectory: jest.Mock;

  beforeEach(async () => {
    mockProcessDirectory = jest.fn().mockResolvedValue(undefined);

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
        SemanticQueueService,
        VfsService,
        {
          provide: SemanticProcessorService,
          useValue: {
            processDirectory: mockProcessDirectory,
          },
        },
      ],
    }).compile();

    await module.init();
    service = module.get(SemanticQueueService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should enqueue and process a semantic job', async () => {
    service.enqueue({
      uri: 'viking://agent/test/memories',
      contextType: 'memory',
      accountId: 'default',
      ownerSpace: 'test',
    });

    await waitForStats(service, (s) => s.processed >= 1);

    expect(mockProcessDirectory).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: 'viking://agent/test/memories',
        contextType: 'memory',
      }),
    );
  });

  it('should deduplicate same-URI jobs', async () => {
    mockProcessDirectory.mockImplementation(
      () => new Promise((r) => setTimeout(r, 100)),
    );

    service.enqueue({
      uri: 'viking://resources',
      contextType: 'resource',
      accountId: 'default',
      ownerSpace: '',
    });

    service.enqueue({
      uri: 'viking://resources',
      contextType: 'resource',
      accountId: 'default',
      ownerSpace: '',
    });

    await waitForStats(service, (s) => s.processed >= 1, 3000);

    expect(mockProcessDirectory).toHaveBeenCalledTimes(1);
  });

  it('should report stats', () => {
    const stats = service.getStats();
    expect(stats).toHaveProperty('queued');
    expect(stats).toHaveProperty('active');
    expect(stats).toHaveProperty('processed');
    expect(stats).toHaveProperty('errors');
  });
});

async function waitForStats(
  service: SemanticQueueService,
  predicate: (stats: { queued: number; active: number; processed: number; errors: number }) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(service.getStats())) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}
