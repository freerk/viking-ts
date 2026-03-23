import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DatabaseService } from './database.service';
import { InvalidUriError } from '../shared/errors';

export interface ContextRecord {
  id: string;
  uri: string;
  parentUri: string | null;
  type: string;
  contextType: string;
  level: number;
  abstract: string;
  name: string;
  description: string;
  tags: string;
  accountId: string;
  ownerSpace: string;
  activeCount: number;
  createdAt: string;
  updatedAt: string;
  embedding: number[] | null;
}

interface ContextVectorRow {
  id: string;
  uri: string;
  parent_uri: string | null;
  type: string;
  context_type: string;
  level: number;
  abstract: string;
  name: string;
  description: string;
  tags: string;
  account_id: string;
  owner_space: string;
  active_count: number;
  created_at: string;
  updated_at: string;
  embedding_json: string | null;
}

@Injectable()
export class ContextVectorService {

  constructor(private readonly database: DatabaseService) {}

  static generateId(accountId: string, uri: string): string {
    return createHash('md5').update(`${accountId}:${uri}`).digest('hex');
  }

  private rowToRecord(row: ContextVectorRow): ContextRecord {
    let embedding: number[] | null = null;
    if (row.embedding_json) {
      try {
        embedding = JSON.parse(row.embedding_json) as number[];
      } catch {
        embedding = null;
      }
    }

    return {
      id: row.id,
      uri: row.uri,
      parentUri: row.parent_uri,
      type: row.type,
      contextType: row.context_type,
      level: row.level,
      abstract: row.abstract,
      name: row.name,
      description: row.description,
      tags: row.tags,
      accountId: row.account_id,
      ownerSpace: row.owner_space,
      activeCount: row.active_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      embedding,
    };
  }

  async upsert(params: {
    uri: string;
    parentUri?: string | null;
    type?: string;
    contextType: string;
    level?: number;
    abstract?: string;
    name?: string;
    description?: string;
    tags?: string;
    accountId?: string;
    ownerSpace?: string;
    embedding?: number[] | null;
  }): Promise<ContextRecord> {
    if (!params.uri.startsWith('viking://')) {
      throw new InvalidUriError(params.uri);
    }

    const accountId = params.accountId ?? 'default';
    const id = ContextVectorService.generateId(accountId, params.uri);
    const now = new Date().toISOString();
    const embeddingJson = params.embedding ? JSON.stringify(params.embedding) : null;

    this.database.db
      .prepare(
        `INSERT INTO context_vectors (id, uri, parent_uri, type, context_type, level, abstract, name, description, tags, account_id, owner_space, created_at, updated_at, embedding_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           parent_uri = excluded.parent_uri,
           type = excluded.type,
           context_type = excluded.context_type,
           level = excluded.level,
           abstract = excluded.abstract,
           name = excluded.name,
           description = excluded.description,
           tags = excluded.tags,
           owner_space = excluded.owner_space,
           updated_at = excluded.updated_at,
           embedding_json = excluded.embedding_json`,
      )
      .run(
        id,
        params.uri,
        params.parentUri ?? null,
        params.type ?? 'file',
        params.contextType,
        params.level ?? 2,
        params.abstract ?? '',
        params.name ?? '',
        params.description ?? '',
        params.tags ?? '',
        accountId,
        params.ownerSpace ?? '',
        now,
        now,
        embeddingJson,
      );

    return {
      id,
      uri: params.uri,
      parentUri: params.parentUri ?? null,
      type: params.type ?? 'file',
      contextType: params.contextType,
      level: params.level ?? 2,
      abstract: params.abstract ?? '',
      name: params.name ?? '',
      description: params.description ?? '',
      tags: params.tags ?? '',
      accountId,
      ownerSpace: params.ownerSpace ?? '',
      activeCount: 0,
      createdAt: now,
      updatedAt: now,
      embedding: params.embedding ?? null,
    };
  }

  async getByUri(uri: string): Promise<ContextRecord | undefined> {
    const row = this.database.db
      .prepare('SELECT * FROM context_vectors WHERE uri = ?')
      .get(uri) as ContextVectorRow | undefined;

    return row ? this.rowToRecord(row) : undefined;
  }

  async getById(id: string): Promise<ContextRecord | undefined> {
    const row = this.database.db
      .prepare('SELECT * FROM context_vectors WHERE id = ?')
      .get(id) as ContextVectorRow | undefined;

    return row ? this.rowToRecord(row) : undefined;
  }

  async deleteByUri(uri: string): Promise<boolean> {
    const result = this.database.db
      .prepare('DELETE FROM context_vectors WHERE uri = ?')
      .run(uri);
    return result.changes > 0;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = this.database.db
      .prepare('DELETE FROM context_vectors WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  async listByContextType(
    contextType: string,
    opts: { accountId?: string; ownerSpace?: string; limit?: number; offset?: number } = {},
  ): Promise<ContextRecord[]> {
    const conditions: string[] = ['context_type = ?'];
    const params: unknown[] = [contextType];

    if (opts.accountId) {
      conditions.push('account_id = ?');
      params.push(opts.accountId);
    }
    if (opts.ownerSpace !== undefined) {
      conditions.push('owner_space = ?');
      params.push(opts.ownerSpace);
    }

    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    const rows = this.database.db
      .prepare(
        `SELECT * FROM context_vectors WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ContextVectorRow[];

    return rows.map((row) => this.rowToRecord(row));
  }

  async searchSimilar(
    vector: number[],
    opts: {
      limit?: number;
      scoreThreshold?: number;
      contextType?: string;
      level?: number;
      accountId?: string;
      parentUriPrefix?: string;
    } = {},
  ): Promise<Array<ContextRecord & { score: number }>> {
    const conditions: string[] = ['embedding_json IS NOT NULL'];
    const params: unknown[] = [];

    if (opts.contextType) {
      conditions.push('context_type = ?');
      params.push(opts.contextType);
    }
    if (opts.level !== undefined) {
      conditions.push('level = ?');
      params.push(opts.level);
    }
    if (opts.accountId) {
      conditions.push('account_id = ?');
      params.push(opts.accountId);
    }
    if (opts.parentUriPrefix) {
      conditions.push('uri LIKE ?');
      params.push(`${opts.parentUriPrefix}%`);
    }

    const rows = this.database.db
      .prepare(`SELECT * FROM context_vectors WHERE ${conditions.join(' AND ')}`)
      .all(...params) as ContextVectorRow[];

    const limit = opts.limit ?? 10;
    const scoreThreshold = opts.scoreThreshold ?? 0.0;

    const scored: Array<ContextRecord & { score: number }> = [];

    for (const row of rows) {
      if (!row.embedding_json) continue;

      let embedding: number[];
      try {
        embedding = JSON.parse(row.embedding_json) as number[];
      } catch {
        continue;
      }

      const score = cosineSimilarity(vector, embedding);
      if (score >= scoreThreshold) {
        scored.push({ ...this.rowToRecord(row), score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async incrementActiveCount(uri: string): Promise<void> {
    this.database.db
      .prepare('UPDATE context_vectors SET active_count = active_count + 1, updated_at = ? WHERE uri = ?')
      .run(new Date().toISOString(), uri);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
