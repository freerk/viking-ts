import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { VectorSearchResult } from '../../storage/vector-store.service';
import { MetadataTypes } from 'vectra';

@Injectable()
export class PostgresVectorStoreService {
  private readonly logger = new Logger(PostgresVectorStoreService.name);

  constructor(private readonly dataSource: DataSource) {
    this.logger.log('Postgres vector store initialized');
  }

  /* ── Memories ── */

  async upsertMemory(
    id: string,
    vector: number[],
    metadata: Record<string, MetadataTypes>,
  ): Promise<void> {
    await this.upsertEmbedding('memories', id, vector, metadata);
  }

  async searchMemories(
    vector: number[],
    limit: number,
    scoreThreshold: number,
  ): Promise<VectorSearchResult[]> {
    return this.searchByEmbedding('memories', vector, limit, scoreThreshold);
  }

  async deleteMemory(id: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM memories WHERE id = $1`, [id]);
  }

  /* ── Resources ── */

  async upsertResource(
    id: string,
    vector: number[],
    metadata: Record<string, MetadataTypes>,
  ): Promise<void> {
    await this.upsertEmbedding('resources', id, vector, metadata);
  }

  async searchResources(
    vector: number[],
    limit: number,
    scoreThreshold: number,
  ): Promise<VectorSearchResult[]> {
    return this.searchByEmbedding('resources', vector, limit, scoreThreshold);
  }

  async deleteResource(id: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM resources WHERE id = $1`, [id]);
  }

  /* ── Skills ── */

  async upsertSkill(
    id: string,
    vector: number[],
    metadata: Record<string, MetadataTypes>,
  ): Promise<void> {
    await this.upsertEmbedding('skills', id, vector, metadata);
  }

  async searchSkills(
    vector: number[],
    limit: number,
    scoreThreshold: number,
  ): Promise<VectorSearchResult[]> {
    return this.searchByEmbedding('skills', vector, limit, scoreThreshold);
  }

  async deleteSkill(id: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM skills WHERE id = $1`, [id]);
  }

  /* ── Internal helpers ── */

  private async upsertEmbedding(
    table: string,
    id: string,
    vector: number[],
    _metadata: Record<string, MetadataTypes>,
  ): Promise<void> {
    const vectorStr = `[${vector.join(',')}]`;
    await this.dataSource.query(
      `UPDATE ${table} SET embedding = $1::vector WHERE id = $2`,
      [vectorStr, id],
    );
  }

  private async searchByEmbedding(
    table: 'memories' | 'resources' | 'skills',
    vector: number[],
    limit: number,
    scoreThreshold: number,
  ): Promise<VectorSearchResult[]> {
    const vectorStr = `[${vector.join(',')}]`;
    const textColumn = table === 'memories' ? 'text' : 'l0_abstract';

    const rows: Array<{ id: string; uri: string; text: string; score: number }> =
      await this.dataSource.query(
        `SELECT id, uri,
                COALESCE(${textColumn}, '') AS text,
                1 - (embedding <=> $1::vector) AS score
         FROM ${table}
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [vectorStr, limit],
      );

    return rows
      .filter((r) => r.score >= scoreThreshold)
      .map((r) => ({
        id: r.id,
        uri: r.uri,
        text: r.text,
        score: r.score,
        metadata: {},
      }));
  }
}
