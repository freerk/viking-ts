import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private _db!: Database.Database;

  constructor(private readonly config: ConfigService) {}

  get db(): Database.Database {
    return this._db;
  }

  onModuleInit(): void {
    const storagePath = this.config.get<string>('storage.path', '~/.viking-ts/data');

    if (!existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true });
    }

    this._db = new Database(join(storagePath, 'viking.db'));
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this.initSchema();
    this.logger.log('Unified database initialized');
  }

  onModuleDestroy(): void {
    this._db.close();
  }

  private initSchema(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS vfs_nodes (
        uri TEXT PRIMARY KEY,
        parent_uri TEXT,
        name TEXT NOT NULL,
        is_dir INTEGER NOT NULL DEFAULT 0,
        content TEXT,
        content_bytes BLOB,
        size INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vfs_parent ON vfs_nodes(parent_uri);

      CREATE TABLE IF NOT EXISTS context_vectors (
        id TEXT PRIMARY KEY,
        uri TEXT NOT NULL UNIQUE,
        parent_uri TEXT,
        type TEXT DEFAULT 'file',
        context_type TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 2,
        abstract TEXT DEFAULT '',
        name TEXT DEFAULT '',
        description TEXT DEFAULT '',
        tags TEXT DEFAULT '',
        account_id TEXT DEFAULT 'default',
        owner_space TEXT DEFAULT '',
        active_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        embedding_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cv_uri ON context_vectors(uri);
      CREATE INDEX IF NOT EXISTS idx_cv_parent ON context_vectors(parent_uri);
      CREATE INDEX IF NOT EXISTS idx_cv_context_type ON context_vectors(context_type);
      CREATE INDEX IF NOT EXISTS idx_cv_level ON context_vectors(level);
      CREATE INDEX IF NOT EXISTS idx_cv_account ON context_vectors(account_id);

      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        from_uri TEXT NOT NULL,
        to_uri TEXT NOT NULL,
        reason TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(from_uri, to_uri)
      );
      CREATE INDEX IF NOT EXISTS idx_rel_from ON relations(from_uri);

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL DEFAULT 'default',
        user_id TEXT NOT NULL DEFAULT 'default',
        agent_id TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL DEFAULT 'active',
        message_count INTEGER NOT NULL DEFAULT 0,
        contexts_used INTEGER NOT NULL DEFAULT 0,
        skills_used INTEGER NOT NULL DEFAULT 0,
        compression_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sm_session ON session_messages(session_id);
    `);
  }
}
