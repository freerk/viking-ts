import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../storage/database.service';
import { VfsService } from '../storage/vfs.service';
import { TaskTrackerService } from '../tasks/task-tracker.service';
import { SessionExtractorService, CandidateMemory } from './session-extractor.service';
import { SessionMemoryWriterService } from './session-memory-writer.service';
import { NotFoundError, ConflictError } from '../shared/errors';

export interface SessionRecord {
  session_id: string;
  account_id: string;
  user_id: string;
  agent_id: string;
  status: 'active' | 'committed';
  message_count: number;
  contexts_used: number;
  skills_used: number;
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
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async create(): Promise<SessionRecord> {
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    this.database.db
      .prepare(
        `INSERT INTO sessions (session_id, account_id, user_id, agent_id, status, message_count, contexts_used, skills_used, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 0, 0, 0, ?, ?)`,
      )
      .run(sessionId, 'default', 'default', 'default', now, now);

    await this.ensureUserDirectories();

    this.logger.log(`Session created: ${sessionId}`);

    return {
      session_id: sessionId,
      account_id: 'default',
      user_id: 'default',
      agent_id: 'default',
      status: 'active',
      message_count: 0,
      contexts_used: 0,
      skills_used: 0,
      created_at: now,
      updated_at: now,
    };
  }

  async get(sessionId: string): Promise<SessionRecord> {
    const row = this.database.db
      .prepare('SELECT session_id, account_id, user_id, agent_id, status, message_count, contexts_used, skills_used, created_at, updated_at FROM sessions WHERE session_id = ?')
      .get(sessionId) as SessionRow | undefined;

    if (!row) {
      throw new NotFoundError(`session:${sessionId}`);
    }

    return this.rowToRecord(row);
  }

  async list(): Promise<SessionRecord[]> {
    const rows = this.database.db
      .prepare('SELECT session_id, account_id, user_id, agent_id, status, message_count, contexts_used, skills_used, created_at, updated_at FROM sessions ORDER BY created_at DESC')
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

    const formattedMessages = messages.map((m) => {
      const parts: MessagePart[] = JSON.parse(m.content) as MessagePart[];
      const text = parts
        .filter((p): p is MessagePart & { text: string } => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text)
        .join('\n');
      return { role: m.role, content: text };
    });

    return this.extractor.extract(formattedMessages);
  }

  async commitAsync(sessionId: string): Promise<{ session_id: string; status: string; task_id: string }> {
    await this.get(sessionId);

    if (this.taskTracker.hasRunning('session_commit', sessionId)) {
      throw new ConflictError(`Session ${sessionId} already has a commit in progress`);
    }

    const task = this.taskTracker.createIfNoRunning('session_commit', sessionId);
    if (!task) {
      throw new ConflictError(`Session ${sessionId} already has a commit in progress`);
    }

    this.runCommitInBackground(sessionId, task.task_id);

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

  private runCommitInBackground(sessionId: string, taskId: string): void {
    this.taskTracker.start(taskId);

    const doCommit = async (): Promise<void> => {
      try {
        const messages = this.getMessages(sessionId);

        const formattedMessages = messages.map((m) => {
          const parts: MessagePart[] = JSON.parse(m.content) as MessagePart[];
          const text = parts
            .filter((p): p is MessagePart & { text: string } => p.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text)
            .join('\n');
          return { role: m.role, content: text };
        });

        const candidates = await this.extractor.extract(formattedMessages);

        let memoriesExtracted = 0;
        if (candidates.length > 0) {
          memoriesExtracted = await this.memoryWriter.writeAll(candidates);
        }

        const now = new Date().toISOString();
        this.database.db
          .prepare(`UPDATE sessions SET status = 'committed', updated_at = ? WHERE session_id = ?`)
          .run(now, sessionId);

        this.taskTracker.complete(taskId, {
          session_id: sessionId,
          memories_extracted: memoriesExtracted,
          archived: true,
        });

        this.logger.log(
          `Session ${sessionId} committed: ${memoriesExtracted} memories extracted`,
        );
      } catch (err) {
        this.taskTracker.fail(taskId, String(err));
        this.logger.error(`Session ${sessionId} commit failed: ${String(err)}`);
      }
    };

    void doCommit();
  }

  private async ensureUserDirectories(): Promise<void> {
    const userMemDir = 'viking://user/default/memories';
    const agentMemDir = 'viking://agent/default/memories';

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
