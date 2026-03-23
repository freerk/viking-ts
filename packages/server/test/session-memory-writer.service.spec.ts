import { SessionMemoryWriterService } from '../src/session/session-memory-writer.service';
import { VfsService } from '../src/storage/vfs.service';
import { EmbeddingQueueService } from '../src/queue/embedding-queue.service';
import { SemanticQueueService } from '../src/queue/semantic-queue.service';
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

  beforeEach(() => {
    vfs = {
      writeFile: jest.fn().mockResolvedValue({ uri: 'test' }),
      readFile: jest.fn(),
    };
    embeddingQueue = { enqueue: jest.fn() };
    semanticQueue = { enqueue: jest.fn() };

    writer = new SessionMemoryWriterService(
      vfs as unknown as VfsService,
      embeddingQueue as unknown as EmbeddingQueueService,
      semanticQueue as unknown as SemanticQueueService,
    );
  });

  it('should return 0 for empty candidates', async () => {
    const count = await writer.writeAll([]);
    expect(count).toBe(0);
    expect(vfs.writeFile).not.toHaveBeenCalled();
  });

  describe('user space categories', () => {
    it('should write profile to single file under user space', async () => {
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

    it('should write preferences as separate files under user space', async () => {
      const count = await writer.writeAll([
        makeCandidate({ category: 'preferences', abstract: 'Likes dark mode' }),
      ]);

      expect(count).toBe(1);
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/user\/default\/memories\/preferences\//);
      expect(writeCall[0]).toMatch(/\.md$/);
    });

    it('should write entities under user space', async () => {
      const count = await writer.writeAll([
        makeCandidate({ category: 'entities', abstract: 'Project Viking' }),
      ]);

      expect(count).toBe(1);
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/user\/default\/memories\/entities\//);
    });

    it('should write events under user space', async () => {
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
      const count = await writer.writeAll([
        makeCandidate({ category: 'cases', abstract: 'Fixed auth bug' }),
      ]);

      expect(count).toBe(1);
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/agent\/default\/memories\/cases\//);
    });

    it('should write patterns under agent space', async () => {
      const count = await writer.writeAll([
        makeCandidate({ category: 'patterns', abstract: 'TDD workflow' }),
      ]);

      expect(count).toBe(1);
      const writeCall = vfs.writeFile.mock.calls[0] as [string, string];
      expect(writeCall[0]).toMatch(/^viking:\/\/agent\/default\/memories\/patterns\//);
    });
  });

  it('should enqueue embedding for each written memory', async () => {
    vfs.readFile.mockRejectedValue(new Error('not found'));

    await writer.writeAll([
      makeCandidate({ category: 'profile' }),
      makeCandidate({ category: 'preferences' }),
      makeCandidate({ category: 'cases' }),
    ]);

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
