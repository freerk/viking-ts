import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import {
  MemoryRecord,
  MemoryType,
  MemoryCategory,
  ResourceRecord,
  SkillRecord,
  SessionRecord,
  SessionMessage,
} from '../shared/types';

@Injectable()
export class MetadataStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetadataStoreService.name);
  private db!: Database.Database;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const storagePath = this.config.get<string>('storage.path', '~/.viking-ts/data');
    const dbDir = join(storagePath, 'db');

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(join(dbDir, 'viking.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initTables();
    this.logger.log('Metadata store initialized');
  }

  onModuleDestroy(): void {
    this.db.close();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'user',
        category TEXT NOT NULL DEFAULT 'general',
        agent_id TEXT,
        user_id TEXT,
        uri TEXT NOT NULL,
        l0_abstract TEXT NOT NULL DEFAULT '',
        l1_overview TEXT NOT NULL DEFAULT '',
        l2_content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memories_uri ON memories(uri);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);

      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        uri TEXT NOT NULL,
        source_url TEXT,
        l0_abstract TEXT NOT NULL DEFAULT '',
        l1_overview TEXT NOT NULL DEFAULT '',
        l2_content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_resources_uri ON resources(uri);

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        uri TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        l0_abstract TEXT NOT NULL DEFAULT '',
        l1_overview TEXT NOT NULL DEFAULT '',
        l2_content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_skills_uri ON skills(uri);
      CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id);
    `);
  }

  /* ── Memories ── */

  insertMemory(memory: MemoryRecord): void {
    this.db
      .prepare(
        `INSERT INTO memories (id, text, type, category, agent_id, user_id, uri, l0_abstract, l1_overview, l2_content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        memory.id,
        memory.text,
        memory.type,
        memory.category,
        memory.agentId ?? null,
        memory.userId ?? null,
        memory.uri,
        memory.l0Abstract,
        memory.l1Overview,
        memory.l2Content,
        memory.createdAt,
        memory.updatedAt,
      );
  }

  getMemoryById(id: string): MemoryRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToMemory(row) : undefined;
  }

  listMemories(filters: {
    agentId?: string;
    userId?: string;
    type?: MemoryType;
    category?: MemoryCategory;
    limit?: number;
    offset?: number;
  }): MemoryRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.agentId) {
      conditions.push('agent_id = ?');
      params.push(filters.agentId);
    }
    if (filters.userId) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.type) {
      conditions.push('type = ?');
      params.push(filters.type);
    }
    if (filters.category) {
      conditions.push('category = ?');
      params.push(filters.category);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM memories ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Record<string, unknown>[];

    return rows.map((row) => this.rowToMemory(row));
  }

  deleteMemory(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  updateMemory(
    id: string,
    updates: Partial<Pick<MemoryRecord, 'text' | 'l0Abstract' | 'l1Overview' | 'l2Content'>>,
  ): boolean {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.text !== undefined) {
      sets.push('text = ?');
      params.push(updates.text);
    }
    if (updates.l0Abstract !== undefined) {
      sets.push('l0_abstract = ?');
      params.push(updates.l0Abstract);
    }
    if (updates.l1Overview !== undefined) {
      sets.push('l1_overview = ?');
      params.push(updates.l1Overview);
    }
    if (updates.l2Content !== undefined) {
      sets.push('l2_content = ?');
      params.push(updates.l2Content);
    }

    if (sets.length === 0) return false;

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    const result = this.db
      .prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);
    return result.changes > 0;
  }

  /* ── Resources ── */

  insertResource(resource: ResourceRecord): void {
    this.db
      .prepare(
        `INSERT INTO resources (id, title, uri, source_url, l0_abstract, l1_overview, l2_content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        resource.id,
        resource.title,
        resource.uri,
        resource.sourceUrl ?? null,
        resource.l0Abstract,
        resource.l1Overview,
        resource.l2Content,
        resource.createdAt,
        resource.updatedAt,
      );
  }

  getResourceById(id: string): ResourceRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM resources WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToResource(row) : undefined;
  }

  listResources(limit: number = 100, offset: number = 0): ResourceRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM resources ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as Record<string, unknown>[];
    return rows.map((row) => this.rowToResource(row));
  }

  deleteResource(id: string): boolean {
    const result = this.db.prepare('DELETE FROM resources WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /* ── Skills ── */

  insertSkill(skill: SkillRecord): void {
    this.db
      .prepare(
        `INSERT INTO skills (id, name, description, uri, tags, l0_abstract, l1_overview, l2_content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        skill.id,
        skill.name,
        skill.description,
        skill.uri,
        JSON.stringify(skill.tags),
        skill.l0Abstract,
        skill.l1Overview,
        skill.l2Content,
        skill.createdAt,
        skill.updatedAt,
      );
  }

  getSkillById(id: string): SkillRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM skills WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSkill(row) : undefined;
  }

  listSkills(limit: number = 100, offset: number = 0, tag?: string): SkillRecord[] {
    if (tag) {
      const rows = this.db
        .prepare(
          `SELECT * FROM skills WHERE tags LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(`%"${tag}"%`, limit, offset) as Record<string, unknown>[];
      return rows.map((row) => this.rowToSkill(row));
    }

    const rows = this.db
      .prepare('SELECT * FROM skills ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as Record<string, unknown>[];
    return rows.map((row) => this.rowToSkill(row));
  }

  deleteSkill(id: string): boolean {
    const result = this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /* ── Sessions ── */

  insertSession(session: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, agent_id, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(session.id, session.agentId ?? null, session.userId ?? null, session.createdAt, session.updatedAt);
  }

  getSessionById(id: string): SessionRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSession(row) : undefined;
  }

  deleteSession(id: string): boolean {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  insertSessionMessage(message: SessionMessage): void {
    this.db
      .prepare(
        `INSERT INTO session_messages (id, session_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(message.id, message.sessionId, message.role, message.content, message.createdAt);
  }

  getSessionMessages(sessionId: string): SessionMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row['id']),
      sessionId: String(row['session_id']),
      role: String(row['role']) as 'user' | 'assistant',
      content: String(row['content']),
      createdAt: String(row['created_at']),
    }));
  }

  /* ── Row mappers ── */

  private rowToMemory(row: Record<string, unknown>): MemoryRecord {
    return {
      id: String(row['id']),
      text: String(row['text']),
      type: String(row['type']) as MemoryType,
      category: String(row['category']) as MemoryCategory,
      agentId: row['agent_id'] ? String(row['agent_id']) : undefined,
      userId: row['user_id'] ? String(row['user_id']) : undefined,
      uri: String(row['uri']),
      l0Abstract: String(row['l0_abstract']),
      l1Overview: String(row['l1_overview']),
      l2Content: String(row['l2_content']),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    };
  }

  private rowToResource(row: Record<string, unknown>): ResourceRecord {
    return {
      id: String(row['id']),
      title: String(row['title']),
      uri: String(row['uri']),
      sourceUrl: row['source_url'] ? String(row['source_url']) : undefined,
      l0Abstract: String(row['l0_abstract']),
      l1Overview: String(row['l1_overview']),
      l2Content: String(row['l2_content']),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    };
  }

  private rowToSkill(row: Record<string, unknown>): SkillRecord {
    let tags: string[] = [];
    try {
      tags = JSON.parse(String(row['tags'] ?? '[]')) as string[];
    } catch {
      tags = [];
    }
    return {
      id: String(row['id']),
      name: String(row['name']),
      description: String(row['description']),
      uri: String(row['uri']),
      tags,
      l0Abstract: String(row['l0_abstract']),
      l1Overview: String(row['l1_overview']),
      l2Content: String(row['l2_content']),
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    };
  }

  private rowToSession(row: Record<string, unknown>): SessionRecord {
    return {
      id: String(row['id']),
      agentId: row['agent_id'] ? String(row['agent_id']) : undefined,
      userId: row['user_id'] ? String(row['user_id']) : undefined,
      createdAt: String(row['created_at']),
      updatedAt: String(row['updated_at']),
    };
  }
}
