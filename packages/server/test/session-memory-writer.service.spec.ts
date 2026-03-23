import { SessionMemoryWriterService } from '../src/session/session-memory-writer.service';
import { VfsService } from '../src/storage/vfs.service';
import { EmbeddingQueueService } from '../src/queue/embedding-queue.service';
import { SemanticQueueService } from '../src/queue/semantic-queue.service';
import { MemoryDeduplicatorService, DedupOutcome } from '../src/session/memory-deduplicator.service';
import { CandidateMemory } from '../src/session/session-extractor.service';

function makeCandidate(overrides: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    category: 'preferences',
    abstract: 'User prefers TypeScript',
    overview: 'Detailed preference info',
    content: 'The user prefers TypeScript for all backend work.',
    ...overrides,
  };
}

describe('SessionMemoryWriterService', () => {
  let writer: SessionMemoryWriterService;
  let vfs: { writeFile: jest.Mock; readFile: jest.Mock };
  let embeddingQueue: { enqueue: jest.Mock };
  let semanticQueue: { enqueue: jest.Mock };
  let deduplicator: { deduplicate: jest.Mock };

  beforeEach(() => {
    vfs = {
      writeFile: jest.fn().mockResolvedValue({ uri: 'test' }),
      readFile: jest.fn(),
    };
    embeddingQueue = { enqueue: jest.fn() };
    semanticQueue = { enqueue: jest.fn() };
    deduplicator = {
      deduplicate: jest.fn().mockResolvedValue('created' as DedupOutcome),
    };

    writer = new SessionMemoryWriterService(
      vfs as unknown as VfsService,
      embeddingQueue as unknown as EmbeddingQueueService,
      semanticQueue as unknown as SemanticQueueService,
      deduplicator as unknown as MemoryDeduplicatorService,
    );
  });

  it('should return 0 for empty candidates', async () => {
    const count = await writer.writeAll([]);
    expect(count).toBe(0);
    expect(vfs.writeFile).not.toHaveBeenCalled();
  });

  describe('user space categories', () => {
    it('should write profile to single file under user space (bypasses dedup)', async () => {
      vfs.readFile.mockRejectedValue(new Error('not found'));

      const count = await writer.writeAll([
        makeCandidate({ category: 'profile', content: 'User is Alice' }),
      ]);

      expect(count).toBe(1);
      expect(vfs.writeFile).toHaveBeenCalledWith(
        'viking://user/default/memories/profile.md',
        'User is Alice',
      );
      expect(embeddingQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          uri: 'viking://user/default/memories/profile.md',
          contextType: 'memory',
          level: 2,
        }),
      );
      // Profile should NOT call deduplicator
      expect(deduplicator.deduplicate).not.toHaveBeenCalled();
    });

    it('should merge into existing profile content', async () => {
      vfs.readFile.mockResolvedValue('Existing profile data');

      const count = await writer.writeAll([
        makeCandidate({ category: 'profile', content: 'New info about user' }),
      ]);

      expect(count).toBe(1);
      expect(vfs.writeFile).toHaveBeenCalledWith(
        'viking://user/default/memories/profile.md',
        expect.stringContaining('Existing profile data'),
      );
      expect(vfs.writeFile).toHaveBeenCalledWith(
        'viking://user/default/memories/profile.md',
        expect.stringContaining('New info about user'),
      );
    });

    it('should call deduplicator for preferences category', async () => {
      deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

      const count = await writer.writeAll([
        makeCandidate({ category: 'preferences', abstract: 'Likes dark mode' }),
      ]);

      expect(count).toBe(1);
      expect(deduplicator.deduplicate).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'preferences' }),
        'default',
        'default',
      );
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/user\/default\/memories\/preferences\//);
      expect(writeCall[0]).toMatch(/\.md$/);
    });

    it('should write entities under user space', async () => {
      deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

      const count = await writer.writeAll([
        makeCandidate({ category: 'entities', abstract: 'Project Viking' }),
      ]);

      expect(count).toBe(1);
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/user\/default\/memories\/entities\//);
    });

    it('should write events under user space', async () => {
      deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

      const count = await writer.writeAll([
        makeCandidate({ category: 'events', abstract: 'Shipped v1.0' }),
      ]);

      expect(count).toBe(1);
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/user\/default\/memories\/events\//);
    });
  });

  describe('agent space categories', () => {
    it('should write cases under agent space', async () => {
      deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

      const count = await writer.writeAll([
        makeCandidate({ category: 'cases', abstract: 'Fixed auth bug' }),
      ]);

      expect(count).toBe(1);
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/agent\/default\/memories\/cases\//);
    });

    it('should write patterns under agent space', async () => {
      deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

      const count = await writer.writeAll([
        makeCandidate({ category: 'patterns', abstract: 'TDD workflow' }),
      ]);

      expect(count).toBe(1);
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/agent\/default\/memories\/patterns\//);
    });

    it('should write tools under agent space with toolName as filename', async () => {
      deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

      const count = await writer.writeAll([
        makeCandidate({
          category: 'tools',
          abstract: 'Docker container management',
          toolName: 'docker-compose',
          bestFor: 'Multi-container orchestration',
        }),
      ]);

      expect(count).toBe(1);
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/agent\/default\/memories\/tools\//);
      expect(writeCall[0]).toMatch(/docker-compose\.md$/);
    });

    it('should write skills under agent space with skillName as filename', async () => {
      deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

      const count = await writer.writeAll([
        makeCandidate({
          category: 'skills',
          abstract: 'Code review skill',
          skillName: 'code-review',
          bestFor: 'PR reviews',
          commonFailures: 'Missing edge case checks',
        }),
      ]);

      expect(count).toBe(1);
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/agent\/default\/memories\/skills\//);
      expect(writeCall[0]).toMatch(/code-review\.md$/);
    });

    it('should write extended fields as structured Markdown for tools', async () => {
      deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

      await writer.writeAll([
        makeCandidate({
          category: 'tools',
          abstract: 'Webpack bundler',
          toolName: 'webpack',
          content: 'Webpack is a module bundler.',
          bestFor: 'Frontend bundling',
          optimalParams: '--mode production',
          recommendedFlow: 'Build then deploy',
          keyDependencies: 'Node.js >= 16',
          commonFailures: 'OOM on large builds',
          recommendation: 'Use webpack 5',
        }),
      ]);

      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      const content = writeCall[1];
      expect(content).toContain('Webpack is a module bundler.');
      expect(content).toContain('## Best For');
      expect(content).toContain('Frontend bundling');
      expect(content).toContain('## Optimal Parameters');
      expect(content).toContain('## Recommended Flow');
      expect(content).toContain('## Key Dependencies');
      expect(content).toContain('## Common Failures');
      expect(content).toContain('## Recommendation');
    });
  });

  describe('dedup outcomes', () => {
    it('should not write file when dedup returns "skipped"', async () => {
      deduplicator.deduplicate.mockResolvedValue('skipped' as DedupOutcome);

      const count = await writer.writeAll([
        makeCandidate({ category: 'preferences' }),
      ]);

      expect(count).toBe(0);
      expect(vfs.writeFile).not.toHaveBeenCalled();
    });

    it('should not write new file when dedup returns "merged"', async () => {
      deduplicator.deduplicate.mockResolvedValue('merged' as DedupOutcome);

      const count = await writer.writeAll([
        makeCandidate({ category: 'preferences' }),
      ]);

      // merged counts as written (successful)
      expect(count).toBe(1);
      // No new VFS file created (deduplicator handled the merge)
      expect(vfs.writeFile).not.toHaveBeenCalled();
    });

    it('should create new file when dedup returns "created"', async () => {
      deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

      const count = await writer.writeAll([
        makeCandidate({ category: 'preferences', content: 'Prefers dark mode' }),
      ]);

      expect(count).toBe(1);
      expect(vfs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/^viking:\/\/user\/default\/memories\/preferences\//),
        'Prefers dark mode',
      );
    });
  });

  it('should enqueue embedding for each written memory', async () => {
    vfs.readFile.mockRejectedValue(new Error('not found'));
    deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

    await writer.writeAll([
      makeCandidate({ category: 'profile' }),
      makeCandidate({ category: 'preferences' }),
      makeCandidate({ category: 'cases' }),
    ]);

    // profile + preferences + cases = 3 embedding enqueues
    expect(embeddingQueue.enqueue).toHaveBeenCalledTimes(3);
    for (const call of embeddingQueue.enqueue.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          contextType: 'memory',
          level: 2,
          accountId: 'default',
        }),
      );
    }
  });

  it('should enqueue semantic processing for affected directories', async () => {
    vfs.readFile.mockRejectedValue(new Error('not found'));
    deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

    await writer.writeAll([
      makeCandidate({ category: 'profile' }),
      makeCandidate({ category: 'preferences' }),
      makeCandidate({ category: 'preferences' }),
    ]);

    // profile -> viking://user/default/memories
    // preferences -> viking://user/default/memories/preferences (deduped)
    expect(semanticQueue.enqueue).toHaveBeenCalledTimes(2);
  });

  it('should continue writing remaining candidates if one fails', async () => {
    vfs.readFile.mockRejectedValue(new Error('not found'));
    deduplicator.deduplicate.mockResolvedValue('created' as DedupOutcome);

    vfs.writeFile
      .mockResolvedValueOnce({ uri: 'ok' })
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce({ uri: 'ok' });

    const count = await writer.writeAll([
      makeCandidate({ category: 'profile' }),
      makeCandidate({ category: 'entities' }),
      makeCandidate({ category: 'cases' }),
    ]);

    expect(count).toBe(2);
  });
});
