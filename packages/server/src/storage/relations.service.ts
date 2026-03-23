import { Injectable } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DatabaseService } from './database.service';
import { InvalidUriError } from '../shared/errors';

export interface Relation {
  id: string;
  fromUri: string;
  toUri: string;
  reason: string;
  createdAt: string;
}

interface RelationRow {
  id: string;
  from_uri: string;
  to_uri: string;
  reason: string;
  created_at: string;
}

@Injectable()
export class RelationsService {

  constructor(private readonly database: DatabaseService) {}

  private validateUri(uri: string): void {
    if (!uri.startsWith('viking://')) {
      throw new InvalidUriError(uri);
    }
  }

  async getRelations(uri: string): Promise<Relation[]> {
    this.validateUri(uri);

    const rows = this.database.db
      .prepare('SELECT id, from_uri, to_uri, reason, created_at FROM relations WHERE from_uri = ? ORDER BY created_at ASC')
      .all(uri) as RelationRow[];

    return rows.map((row) => ({
      id: row.id,
      fromUri: row.from_uri,
      toUri: row.to_uri,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  async link(fromUri: string, toUris: string[], reason: string = ''): Promise<Relation[]> {
    this.validateUri(fromUri);
    for (const uri of toUris) {
      this.validateUri(uri);
    }

    const now = new Date().toISOString();
    const created: Relation[] = [];

    const insertStmt = this.database.db.prepare(
      `INSERT OR IGNORE INTO relations (id, from_uri, to_uri, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
    );

    const insertAll = this.database.db.transaction(() => {
      for (const toUri of toUris) {
        const id = uuid();
        const result = insertStmt.run(id, fromUri, toUri, reason, now);
        if (result.changes > 0) {
          created.push({
            id,
            fromUri,
            toUri,
            reason,
            createdAt: now,
          });
        }
      }
    });

    insertAll();
    return created;
  }

  async unlink(fromUri: string, toUri: string): Promise<boolean> {
    this.validateUri(fromUri);
    this.validateUri(toUri);

    const result = this.database.db
      .prepare('DELETE FROM relations WHERE from_uri = ? AND to_uri = ?')
      .run(fromUri, toUri);

    return result.changes > 0;
  }
}
