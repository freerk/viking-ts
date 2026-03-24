import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../storage/database.service';
import { VfsService } from '../storage/vfs.service';
import { TaskTrackerService } from '../tasks/task-tracker.service';
import { LlmService } from '../llm/llm.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
import { SessionExtractorService, CandidateMemory } from './session-extractor.service';
import { SessionMemoryWriterService } from './session-memory-writer.service';
import { NotFoundError, ConflictError } from '../shared/errors';
import { RequestContext, UserIdentifier } from '../shared/request-context';

export interface SessionRecord {
  session_id: string;
  account_id: string;
  user_id: string;
  agent_id: string;
  status: 'active' | 'committed';
  message_count: number;
  contexts_used: number;
  skills_used: number;
  compression_index: number;
  created_at: string;
  updated_at: string;
}

export interface SessionMessageRecord {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface SessionRow {
  session_id: string;
  account_id: string;
  user_id: string;
  agent_id: string;
  status: string;
  message_count: number;
  contexts_used: number;
  skills_used: number;
  compression_index: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface MessagePart {
  type: 'text' | 'context' | 'tool';
  text?: string;
  uri?: string;
  context_type?: string;
  abstract?: string;
  tool_id?: string;
  tool_name?: string;
  tool_uri?: string;
  skill_uri?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  tool_status?: string;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly vfs: VfsService,
    private readonly taskTracker: TaskTrackerService,
    private readonly extractor: SessionExtractorService,
    private readonly memoryWriter: SessionMemoryWriterService,
    private readonly llm: LlmService,
    private readonly semanticQueue: SemanticQueueService,
  ) {}

  private rowToRecord(row: SessionRow): SessionRecord {
    return {
      session_id: row.session_id,
      account_id: row.account_id,
      user_id: row.user_id,
      agent_id: row.agent_id,
      status: row.status as 'active' | 'committed',
      message_count: row.message_count,
      contexts_used: row.contexts_used,
      skills_used: row.skills_used,
      compression_index: row.compression_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async create(ctx: RequestContext): Promise<SessionRecord> {
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const { accountId, userId, agentId } = ctx.user;

    this.database.db
      .prepare(
        `INSERT INTO sessions (session_id, account_id, user_id, agent_id, status, message_count, contexts_used, skills_used, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 0, 0, 0, ?, ?)`,
      )
      .run(sessionId, accountId, userId, agentId, now, now);

    await this.ensureUserDirectories(ctx);

    this.logger.log(`Session created: ${sessionId}`);

    return {
      session_id: sessionId,
      account_id: accountId,
      user_id: userId,
      agent_id: agentId,
      status: 'active',
      message_count: 0,
      contexts_used: 0,
      skills_used: 0,
      compression_index: 0,
      created_at: now,
      updated_at: now,
    };
  }

  async get(sessionId: string): Promise<SessionRecord> {
    const row = this.database.db
      .prepare('SELECT session_id, account_id, user_id, agent_id, status, message_count, contexts_used, skills_used, compression_index, created_at, updated_at FROM sessions WHERE session_id = ?')
      .get(sessionId) as SessionRow | undefined;

    if (!row) {
      throw new NotFoundError(`session:${sessionId}`);
    }

    return this.rowToRecord(row);
  }

  async list(): Promise<SessionRecord[]> {
    const rows = this.database.db
      .prepare('SELECT session_id, account_id, user_id, agent_id, status, message_count, contexts_used, skills_used, compression_index, created_at, updated_at FROM sessions ORDER BY created_at DESC')
      .all() as SessionRow[];

    return rows.map((row) => this.rowToRecord(row));
  }

  async delete(sessionId: string): Promise<void> {
    await this.get(sessionId);

    this.database.db
      .prepare('DELETE FROM sessions WHERE session_id = ?')
      .run(sessionId);

    this.logger.log(`Session deleted: ${sessionId}`);
  }

  async addMessage(
    sessionId: string,
    role: string,
    content: string | MessagePart[],
  ): Promise<SessionRecord> {
    await this.get(sessionId);

    const messageId = `msg_${randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();

    const serialized = typeof content === 'string'
      ? JSON.stringify([{ type: 'text', text: content }])
      : JSON.stringify(content);

    this.database.db
      .prepare(
        `INSERT INTO session_messages (id, session_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(messageId, sessionId, role, serialized, now);

    this.database.db
      .prepare(
        `UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE session_id = ?`,
      )
      .run(now, sessionId);

    return this.get(sessionId);
  }

  async recordUsed(
    sessionId: string,
    contexts?: string[],
    skill?: Record<string, unknown>,
  ): Promise<SessionRecord> {
    const session = await this.get(sessionId);
    const now = new Date().toISOString();

    const newContextsUsed = session.contexts_used + (contexts?.length ?? 0);
    const newSkillsUsed = session.skills_used + (skill ? 1 : 0);

    this.database.db
      .prepare(
        `UPDATE sessions SET contexts_used = ?, skills_used = ?, updated_at = ? WHERE session_id = ?`,
      )
      .run(newContextsUsed, newSkillsUsed, now, sessionId);

    return this.get(sessionId);
  }

  async extract(sessionId: string): Promise<CandidateMemory[]> {
    await this.get(sessionId);

    const messages = this.getMessages(sessionId);
    if (messages.length === 0) {
      return [];
    }

    const formattedMessages = this.formatMessages(messages);
    return this.extractor.extract(formattedMessages);
  }

  async commitAsync(sessionId: string, ctx: RequestContext): Promise<{ session_id: string; status: string; task_id: string }> {
    await this.get(sessionId);

    if (this.taskTracker.hasRunning('session_commit', sessionId)) {
      throw new ConflictError(`Session ${sessionId} already has a commit in progress`);
    }

    const task = this.taskTracker.createIfNoRunning('session_commit', sessionId);
    if (!task) {
      throw new ConflictError(`Session ${sessionId} already has a commit in progress`);
    }

    this.runCommitInBackground(sessionId, task.task_id, ctx);

    return {
      session_id: sessionId,
      status: 'accepted',
      task_id: task.task_id,
    };
  }

  getMessages(sessionId: string): SessionMessageRecord[] {
    const rows = this.database.db
      .prepare('SELECT id, session_id, role, content, created_at FROM session_messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as MessageRow[];

    return rows;
  }

  /**
   * Get session context for search: recent messages + archive summaries.
   * Reads up to 3 most recent archive .overview.md files from VFS history.
   */
  async getContextForSearch(
    sessionId: string,
  ): Promise<{ summaries: string[]; recentMessages: Array<{ role: string; content: string }> }> {
    const session = await this.get(sessionId);

    const messages = this.getMessages(sessionId);
    const recentMessages = this.formatMessages(messages);

    const summaries: string[] = [];
    try {
      const identifier = new UserIdentifier(session.account_id, session.user_id, session.agent_id);
      const historyUri = `viking://session/${identifier.userSpaceName()}/${sessionId}/history`;
      const historyExists = await this.vfs.exists(historyUri);
      if (historyExists) {
        const entries = await this.vfs.ls(historyUri, { showAllHidden: false });
        const archiveDirs = entries
          .filter((e) => e.isDir && e.name.startsWith('archive_'))
          .sort((a, b) => b.name.localeCompare(a.name))
          .slice(0, 3);

        for (const dir of archiveDirs) {
          try {
            const overview = await this.vfs.readFile(`${dir.uri}/.overview.md`);
            if (overview.trim()) {
              summaries.push(overview);
            }
          } catch {
            // skip missing overviews
          }
        }
      }
    } catch {
      // history dir may not exist yet
    }

    return {
      summaries,
      recentMessages,
    };
  }

  /**
   * Two-phase session commit matching OpenViking session.py commit_async().
   *
   * Phase 1 - Archive:
   *   Generate archive summary, write archive to VFS, clear session messages.
   *
   * Phase 2 - Memory extraction + dedup:
   *   Extract memories from archived messages, write with dedup.
   */
  private runCommitInBackground(sessionId: string, taskId: string, ctx: RequestContext): void {
    this.taskTracker.start(taskId);

    const doCommit = async (): Promise<void> => {
      try {
        const session = await this.get(sessionId);
        const messages = this.getMessages(sessionId);

        if (messages.length === 0) {
          this.taskTracker.complete(taskId, {
            session_id: sessionId,
            memories_extracted: 0,
            archived: false,
          });
          return;
        }

        const formattedMessages = this.formatMessages(messages);

        // Phase 1: Archive
        const compressionIndex = session.compression_index + 1;
        const archiveUri = `viking://session/${ctx.user.userSpaceName()}/${sessionId}/history/archive_${String(compressionIndex).padStart(3, '0')}`;

        let summary: string;
        try {
          summary = await this.llm.generateArchiveSummary(formattedMessages);
        } catch (err) {
          this.logger.warn(`Archive summary generation failed: ${String(err)}`);
          const turnCount = formattedMessages.filter((m) => m.role === 'user').length;
          summary = `# Session Summary\n\n**Overview**: ${turnCount} turns, ${formattedMessages.length} messages`;
        }

        const archiveAbstract = this.llm.extractAbstractFromOverview(summary);

        // Write archive files to VFS
        const serializedMessages = messages
          .map((m) => JSON.stringify({ id: m.id, role: m.role, content: m.content, created_at: m.created_at }))
          .join('\n') + '\n';

        await this.vfs.writeFile(`${archiveUri}/messages.jsonl`, serializedMessages);
        await this.vfs.writeFile(`${archiveUri}/.abstract.md`, archiveAbstract);
        await this.vfs.writeFile(`${archiveUri}/.overview.md`, summary);

        // Clear session messages from DB and update session
        const now = new Date().toISOString();
        this.database.db
          .prepare('DELETE FROM session_messages WHERE session_id = ?')
          .run(sessionId);

        this.database.db
          .prepare(
            `UPDATE sessions SET message_count = 0, compression_index = ?, updated_at = ? WHERE session_id = ?`,
          )
          .run(compressionIndex, now, sessionId);

        // Enqueue archive for semantic processing
        this.semanticQueue.enqueue({
          uri: archiveUri,
          contextType: 'memory',
          accountId: ctx.user.accountId,
          ownerSpace: ctx.user.userSpaceName(),
        });

        this.logger.log(
          `Phase 1 complete: archived ${messages.length} messages to ${archiveUri}`,
        );

        // Phase 2: Memory extraction + dedup
        const candidates = await this.extractor.extract(formattedMessages);

        let memoriesExtracted = 0;
        if (candidates.length > 0) {
          memoriesExtracted = await this.memoryWriter.writeAll(candidates, ctx);
        }

        const commitNow = new Date().toISOString();
        this.database.db
          .prepare(`UPDATE sessions SET status = 'committed', updated_at = ? WHERE session_id = ?`)
          .run(commitNow, sessionId);

        this.taskTracker.complete(taskId, {
          session_id: sessionId,
          memories_extracted: memoriesExtracted,
          archived: true,
        });

        this.logger.log(
          `Session ${sessionId} committed: ${memoriesExtracted} memories extracted, archive_${String(compressionIndex).padStart(3, '0')}`,
        );
      } catch (err) {
        this.taskTracker.fail(taskId, String(err));
        this.logger.error(`Session ${sessionId} commit failed: ${String(err)}`);
      }
    };

    void doCommit();
  }

  private formatMessages(
    messages: SessionMessageRecord[],
  ): Array<{ role: string; content: string }> {
    return messages.map((m) => {
      const parts: MessagePart[] = JSON.parse(m.content) as MessagePart[];
      const text = parts
        .filter((p): p is MessagePart & { text: string } => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text)
        .join('\n');
      return { role: m.role, content: text };
    });
  }

  private async ensureUserDirectories(ctx: RequestContext): Promise<void> {
    const userMemDir = `viking://user/${ctx.user.userSpaceName()}/memories`;
    const agentMemDir = `viking://agent/${ctx.user.agentSpaceName()}/memories`;

    try {
      if (!(await this.vfs.exists(userMemDir))) {
        await this.vfs.mkdir(userMemDir);
      }
    } catch {
      // directory may already exist
    }

    try {
      if (!(await this.vfs.exists(agentMemDir))) {
        await this.vfs.mkdir(agentMemDir);
      }
    } catch {
      // directory may already exist
    }
  }
}
