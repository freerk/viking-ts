import { SessionService } from '../src/session/session.service';
import { DatabaseService } from '../src/storage/database.service';
import { VfsService } from '../src/storage/vfs.service';
import { TaskTrackerService } from '../src/tasks/task-tracker.service';
import { LlmService } from '../src/llm/llm.service';
import { SemanticQueueService } from '../src/queue/semantic-queue.service';
import { SessionExtractorService } from '../src/session/session-extractor.service';
import { SessionMemoryWriterService } from '../src/session/session-memory-writer.service';

describe('SessionService.getContextForSearch', () => {
  let service: SessionService;
  let mockDb: { db: { prepare: jest.Mock } };
  let mockVfs: {
    exists: jest.Mock;
    ls: jest.Mock;
    readFile: jest.Mock;
    mkdir: jest.Mock;
  };

  beforeEach(() => {
    const sessionRow = {
      session_id: 'sess-1',
      account_id: 'default',
      user_id: 'default',
      agent_id: 'default',
      status: 'active',
      message_count: 0,
      contexts_used: 0,
      skills_used: 0,
      compression_index: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockDb = {
      db: {
        prepare: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('session_messages')) {
            return { all: jest.fn().mockReturnValue([]) };
          }
          return { get: jest.fn().mockReturnValue(sessionRow) };
        }),
      },
    };

    mockVfs = {
      exists: jest.fn().mockResolvedValue(false),
      ls: jest.fn().mockResolvedValue([]),
      readFile: jest.fn(),
      mkdir: jest.fn().mockResolvedValue(undefined),
    };

    service = new SessionService(
      mockDb as unknown as DatabaseService,
      mockVfs as unknown as VfsService,
      {} as TaskTrackerService,
      {} as SessionExtractorService,
      {} as SessionMemoryWriterService,
      {} as LlmService,
      {} as SemanticQueueService,
    );
  });

  it('should return empty summaries when no history exists', async () => {
    mockVfs.exists.mockResolvedValue(false);

    const result = await service.getContextForSearch('sess-1');

    expect(result.summaries).toEqual([]);
    expect(result.recentMessages).toEqual([]);
  });

  it('should return up to 3 archive summaries from VFS history', async () => {
    mockVfs.exists.mockResolvedValue(true);
    mockVfs.ls.mockResolvedValue([
      { uri: 'viking://session/sess-1/history/archive_001', name: 'archive_001', isDir: true },
      { uri: 'viking://session/sess-1/history/archive_002', name: 'archive_002', isDir: true },
      { uri: 'viking://session/sess-1/history/archive_003', name: 'archive_003', isDir: true },
      { uri: 'viking://session/sess-1/history/archive_004', name: 'archive_004', isDir: true },
    ]);
    mockVfs.readFile
      .mockResolvedValueOnce('Summary of archive 4')
      .mockResolvedValueOnce('Summary of archive 3')
      .mockResolvedValueOnce('Summary of archive 2');

    const result = await service.getContextForSearch('sess-1');

    expect(result.summaries).toHaveLength(3);
    expect(result.summaries[0]).toBe('Summary of archive 4');
    expect(result.summaries[1]).toBe('Summary of archive 3');
    expect(result.summaries[2]).toBe('Summary of archive 2');

    // Should have read most recent 3 (004, 003, 002), not 001
    expect(mockVfs.readFile).toHaveBeenCalledTimes(3);
    expect(mockVfs.readFile).toHaveBeenCalledWith(
      'viking://session/sess-1/history/archive_004/.overview.md',
    );
  });

  it('should skip archives with empty overviews', async () => {
    mockVfs.exists.mockResolvedValue(true);
    mockVfs.ls.mockResolvedValue([
      { uri: 'viking://session/sess-1/history/archive_001', name: 'archive_001', isDir: true },
      { uri: 'viking://session/sess-1/history/archive_002', name: 'archive_002', isDir: true },
    ]);
    mockVfs.readFile
      .mockResolvedValueOnce('  ')
      .mockResolvedValueOnce('Real summary');

    const result = await service.getContextForSearch('sess-1');

    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]).toBe('Real summary');
  });

  it('should skip archives with missing overviews', async () => {
    mockVfs.exists.mockResolvedValue(true);
    mockVfs.ls.mockResolvedValue([
      { uri: 'viking://session/sess-1/history/archive_001', name: 'archive_001', isDir: true },
    ]);
    mockVfs.readFile.mockRejectedValue(new Error('file not found'));

    const result = await service.getContextForSearch('sess-1');

    expect(result.summaries).toHaveLength(0);
  });

  it('should handle VFS errors gracefully', async () => {
    mockVfs.exists.mockRejectedValue(new Error('vfs broken'));

    const result = await service.getContextForSearch('sess-1');

    expect(result.summaries).toEqual([]);
    expect(result.recentMessages).toEqual([]);
  });
});
