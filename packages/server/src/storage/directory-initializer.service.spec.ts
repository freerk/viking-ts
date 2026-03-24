import { DirectoryInitializerService } from './directory-initializer.service';
import { VfsService } from './vfs.service';
import { ContextVectorService } from './context-vector.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { RequestContext, UserIdentifier } from '../shared/request-context';

function createMockVfs(): jest.Mocked<Pick<VfsService, 'exists' | 'mkdir'>> {
  return {
    exists: jest.fn().mockResolvedValue(false),
    mkdir: jest.fn().mockResolvedValue({ uri: '', parentUri: null, name: '', isDir: true, size: 0, createdAt: '', updatedAt: '' }),
  };
}

function createMockContextVectors(): jest.Mocked<Pick<ContextVectorService, 'upsert'>> {
  return {
    upsert: jest.fn().mockResolvedValue({} as never),
  };
}

function createMockEmbeddingService(): jest.Mocked<Pick<EmbeddingService, 'embed'>> {
  return {
    embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  };
}

function createMockEmbeddingQueue(): jest.Mocked<Pick<EmbeddingQueueService, 'enqueue'>> {
  return {
    enqueue: jest.fn(),
  };
}

function createCtx(userId = 'user1', agentId = 'agent1', accountId = 'acc1'): RequestContext {
  return { user: new UserIdentifier(accountId, userId, agentId) };
}

describe('DirectoryInitializerService', () => {
  let service: DirectoryInitializerService;
  let vfs: ReturnType<typeof createMockVfs>;
  let contextVectors: ReturnType<typeof createMockContextVectors>;
  let embeddingService: ReturnType<typeof createMockEmbeddingService>;
  let embeddingQueue: ReturnType<typeof createMockEmbeddingQueue>;

  beforeEach(() => {
    vfs = createMockVfs();
    contextVectors = createMockContextVectors();
    embeddingService = createMockEmbeddingService();
    embeddingQueue = createMockEmbeddingQueue();

    service = new DirectoryInitializerService(
      vfs as unknown as VfsService,
      contextVectors as unknown as ContextVectorService,
      embeddingService as unknown as EmbeddingService,
      embeddingQueue as unknown as EmbeddingQueueService,
    );
  });

  describe('initializeAgentSpace', () => {
    it('should create all 4 agent directories with correct URIs', async () => {
      const ctx = createCtx();
      const agentSpace = ctx.user.agentSpaceName();

      await service.initializeAgentSpace(ctx);

      const expectedUris = [
        `viking://agent/${agentSpace}/memories`,
        `viking://agent/${agentSpace}/memories/cases`,
        `viking://agent/${agentSpace}/memories/patterns`,
        `viking://agent/${agentSpace}/instructions`,
      ];

      const mkdirUris = vfs.mkdir.mock.calls.map((call) => call[0]);
      expect(mkdirUris).toEqual(expectedUris);
    });

    it('should enqueue L0 and L1 vectors for each directory', async () => {
      const ctx = createCtx();

      await service.initializeAgentSpace(ctx);

      // 4 directories x 2 vectors (L0 + L1) = 8 enqueue calls
      expect(embeddingQueue.enqueue).toHaveBeenCalledTimes(8);

      const levels = embeddingQueue.enqueue.mock.calls.map((call) => call[0].level);
      // Alternating L0, L1 for each directory
      expect(levels).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    });
  });

  describe('initializeUserSpace', () => {
    it('should create all 4 user directories with correct URIs', async () => {
      const ctx = createCtx();
      const userId = ctx.user.userSpaceName();

      await service.initializeUserSpace(ctx);

      const expectedUris = [
        `viking://user/${userId}/memories`,
        `viking://user/${userId}/memories/preferences`,
        `viking://user/${userId}/memories/entities`,
        `viking://user/${userId}/memories/events`,
      ];

      const mkdirUris = vfs.mkdir.mock.calls.map((call) => call[0]);
      expect(mkdirUris).toEqual(expectedUris);
    });

    it('should enqueue L0 and L1 vectors for each directory', async () => {
      const ctx = createCtx();

      await service.initializeUserSpace(ctx);

      expect(embeddingQueue.enqueue).toHaveBeenCalledTimes(8);
    });
  });

  describe('idempotency', () => {
    it('should not re-create directories that already exist', async () => {
      vfs.exists.mockResolvedValue(true);
      const ctx = createCtx();

      await service.initializeAgentSpace(ctx);

      expect(vfs.exists).toHaveBeenCalled();
      expect(vfs.mkdir).not.toHaveBeenCalled();
      // Vectors are still seeded (upsert is idempotent)
      expect(embeddingQueue.enqueue).toHaveBeenCalledTimes(8);
    });
  });

  describe('initializeSkillsRoot', () => {
    it('should use global URI viking://agent/skills without agent namespace', async () => {
      await service.initializeSkillsRoot();

      expect(vfs.mkdir).toHaveBeenCalledWith('viking://agent/skills');

      const enqueuedJobs = embeddingQueue.enqueue.mock.calls.map((call) => call[0]);
      expect(enqueuedJobs).toHaveLength(2);
      expect(enqueuedJobs[0]!.uri).toBe('viking://agent/skills');
      expect(enqueuedJobs[0]!.ownerSpace).toBe('default');
      expect(enqueuedJobs[0]!.accountId).toBe('default');
    });
  });

  describe('fallback to direct embedding', () => {
    it('should use EmbeddingService.embed when queue is not available', async () => {
      const serviceWithoutQueue = new DirectoryInitializerService(
        vfs as unknown as VfsService,
        contextVectors as unknown as ContextVectorService,
        embeddingService as unknown as EmbeddingService,
        undefined,
      );

      await serviceWithoutQueue.initializeSkillsRoot();

      expect(embeddingService.embed).toHaveBeenCalledTimes(2);
      expect(contextVectors.upsert).toHaveBeenCalledTimes(2);

      const upsertCalls = contextVectors.upsert.mock.calls as Array<[{ level: number; embedding: number[] }]>;
      expect(upsertCalls[0]![0].level).toBe(0);
      expect(upsertCalls[0]![0].embedding).toEqual([0.1, 0.2, 0.3]);
      expect(upsertCalls[1]![0].level).toBe(1);
    });
  });
});
