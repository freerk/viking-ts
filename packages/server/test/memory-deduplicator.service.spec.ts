import { MemoryDeduplicatorService } from '../src/session/memory-deduplicator.service';
import { ContextVectorService } from '../src/storage/context-vector.service';
import { VfsService } from '../src/storage/vfs.service';
import { LlmService } from '../src/llm/llm.service';
import { EmbeddingService } from '../src/embedding/embedding.service';
import { EmbeddingQueueService } from '../src/queue/embedding-queue.service';
import { CandidateMemory } from '../src/session/session-extractor.service';

function makeCandidate(overrides: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    category: 'preferences',
    abstract: 'User prefers dark mode',
    overview: '## Preference\n- Dark mode for IDE',
    content: 'The user prefers dark mode in all their IDEs.',
    ...overrides,
  };
}

describe('MemoryDeduplicatorService', () => {
  let deduplicator: MemoryDeduplicatorService;
  let contextVector: { searchSimilar: jest.Mock; deleteByUri: jest.Mock };
  let vfs: { readFile: jest.Mock; writeFile: jest.Mock; rm: jest.Mock };
  let llm: { decideDeduplicate: jest.Mock; mergeMemory: jest.Mock };
  let embedding: { embed: jest.Mock };
  let embeddingQueue: { enqueue: jest.Mock };

  beforeEach(() => {
    contextVector = {
      searchSimilar: jest.fn().mockResolvedValue([]),
      deleteByUri: jest.fn().mockResolvedValue(true),
    };
    vfs = {
      readFile: jest.fn().mockResolvedValue('existing content'),
      writeFile: jest.fn().mockResolvedValue(undefined),
      rm: jest.fn().mockResolvedValue(undefined),
    };
    llm = {
      decideDeduplicate: jest.fn(),
      mergeMemory: jest.fn().mockResolvedValue('merged content'),
    };
    embedding = {
      embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
    embeddingQueue = {
      enqueue: jest.fn(),
    };

    deduplicator = new MemoryDeduplicatorService(
      contextVector as unknown as ContextVectorService,
      vfs as unknown as VfsService,
      llm as unknown as LlmService,
      embedding as unknown as EmbeddingService,
      embeddingQueue as unknown as EmbeddingQueueService,
    );
  });

  it('should return "created" when no similar memories exist', async () => {
    contextVector.searchSimilar.mockResolvedValue([]);

    const result = await deduplicator.deduplicate(
      makeCandidate(),
      'default',
      'default',
    );

    expect(result).toBe('created');
    expect(llm.decideDeduplicate).not.toHaveBeenCalled();
  });

  it('should return "skipped" when LLM returns decision: skip', async () => {
    contextVector.searchSimilar.mockResolvedValue([
      {
        uri: 'viking://user/default/memories/preferences/existing.md',
        abstract: 'User prefers dark mode',
        score: 0.95,
      },
    ]);

    llm.decideDeduplicate.mockResolvedValue({
      decision: 'skip',
      reason: 'Duplicate information',
      list: [],
    });

    const result = await deduplicator.deduplicate(
      makeCandidate(),
      'default',
      'default',
    );

    expect(result).toBe('skipped');
    expect(llm.decideDeduplicate).toHaveBeenCalled();
  });

  it('should return "created" when LLM returns decision: create with no actions', async () => {
    contextVector.searchSimilar.mockResolvedValue([
      {
        uri: 'viking://user/default/memories/preferences/existing.md',
        abstract: 'User prefers light mode',
        score: 0.75,
      },
    ]);

    llm.decideDeduplicate.mockResolvedValue({
      decision: 'create',
      reason: 'New independent preference',
      list: [],
    });

    const result = await deduplicator.deduplicate(
      makeCandidate(),
      'default',
      'default',
    );

    expect(result).toBe('created');
  });

  it('should call mergeMemory and return "merged" on none+merge action', async () => {
    const existingUri = 'viking://user/default/memories/preferences/existing.md';

    contextVector.searchSimilar.mockResolvedValue([
      {
        uri: existingUri,
        abstract: 'User prefers dark mode',
        score: 0.92,
      },
    ]);

    llm.decideDeduplicate.mockResolvedValue({
      decision: 'none',
      reason: 'Same subject, merge',
      list: [{ uri: existingUri, action: 'merge', reason: 'Same preference facet' }],
    });

    const result = await deduplicator.deduplicate(
      makeCandidate(),
      'default',
      'default',
    );

    expect(result).toBe('merged');
    expect(llm.mergeMemory).toHaveBeenCalledWith(
      'existing content',
      'The user prefers dark mode in all their IDEs.',
      'preferences',
    );
    expect(vfs.writeFile).toHaveBeenCalledWith(existingUri, 'merged content');
    expect(embeddingQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: existingUri,
        text: 'merged content',
        contextType: 'memory',
      }),
    );
  });

  it('should delete from VFS and vector store on delete action', async () => {
    const existingUri = 'viking://user/default/memories/preferences/old.md';

    contextVector.searchSimilar.mockResolvedValue([
      {
        uri: existingUri,
        abstract: 'Outdated preference',
        score: 0.88,
      },
    ]);

    llm.decideDeduplicate.mockResolvedValue({
      decision: 'create',
      reason: 'Replace outdated memory',
      list: [{ uri: existingUri, action: 'delete', reason: 'Fully invalidated' }],
    });

    const result = await deduplicator.deduplicate(
      makeCandidate(),
      'default',
      'default',
    );

    expect(result).toBe('created');
    expect(vfs.rm).toHaveBeenCalledWith(existingUri);
    expect(contextVector.deleteByUri).toHaveBeenCalledWith(existingUri);
  });

  it('should skip dedup for profile category (ALWAYS_MERGE)', async () => {
    const result = await deduplicator.deduplicate(
      makeCandidate({ category: 'profile' }),
      'default',
      'default',
    );

    expect(result).toBe('skipped');
    expect(embedding.embed).not.toHaveBeenCalled();
    expect(llm.decideDeduplicate).not.toHaveBeenCalled();
  });

  it('should return "skipped" for none decision with no actions', async () => {
    contextVector.searchSimilar.mockResolvedValue([
      {
        uri: 'viking://user/default/memories/preferences/existing.md',
        abstract: 'Some preference',
        score: 0.8,
      },
    ]);

    llm.decideDeduplicate.mockResolvedValue({
      decision: 'none',
      reason: 'No action needed',
      list: [],
    });

    const result = await deduplicator.deduplicate(
      makeCandidate(),
      'default',
      'default',
    );

    expect(result).toBe('skipped');
  });

  it('should use agent space for cases category', async () => {
    contextVector.searchSimilar.mockResolvedValue([]);

    await deduplicator.deduplicate(
      makeCandidate({ category: 'cases' }),
      'default',
      'default',
    );

    expect(contextVector.searchSimilar).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        parentUriPrefix: 'viking://agent/default/memories/cases/',
      }),
    );
  });

  it('should use user space for preferences category', async () => {
    contextVector.searchSimilar.mockResolvedValue([]);

    await deduplicator.deduplicate(
      makeCandidate({ category: 'preferences' }),
      'default',
      'default',
    );

    expect(contextVector.searchSimilar).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        parentUriPrefix: 'viking://user/default/memories/preferences/',
      }),
    );
  });

  it('should not merge for non-MERGE_SUPPORTED categories (events)', async () => {
    const existingUri = 'viking://user/default/memories/events/existing.md';

    contextVector.searchSimilar.mockResolvedValue([
      {
        uri: existingUri,
        abstract: 'Some event',
        score: 0.85,
      },
    ]);

    llm.decideDeduplicate.mockResolvedValue({
      decision: 'none',
      reason: 'Same event, merge',
      list: [{ uri: existingUri, action: 'merge', reason: 'Same event' }],
    });

    const result = await deduplicator.deduplicate(
      makeCandidate({ category: 'events' }),
      'default',
      'default',
    );

    // events does not support merge, so it should be skipped
    expect(result).toBe('skipped');
    expect(llm.mergeMemory).not.toHaveBeenCalled();
  });
});
