import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScopedRepository } from 'typeorm-scoped-repository';
import { createHash } from 'crypto';
import { ContextVectorEntity } from './entities';
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

@Injectable()
export class ContextVectorService {

  constructor(
    @InjectRepository(ContextVectorEntity)
    private readonly repo: Repository<ContextVectorEntity>,
  ) {}

  static generateId(accountId: string, uri: string): string {
    return createHash('md5').update(`${accountId}:${uri}`).digest('hex');
  }

  private entityToRecord(entity: ContextVectorEntity): ContextRecord {
    let embedding: number[] | null = null;
    if (entity.embeddingJson) {
      try {
        embedding = JSON.parse(entity.embeddingJson) as number[];
      } catch {
        embedding = null;
      }
    }

    return {
      id: entity.id,
      uri: entity.uri,
      parentUri: entity.parentUri,
      type: entity.type,
      contextType: entity.contextType,
      level: entity.level,
      abstract: entity.abstract,
      name: entity.name,
      description: entity.description,
      tags: entity.tags,
      accountId: entity.accountId,
      ownerSpace: entity.ownerSpace,
      activeCount: entity.activeCount,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      embedding,
    };
  }

  /**
   * Build a ScopedRepository for scoped queries (memories/skills).
   * Resources use the bare repo (no scope filtering).
   */
  private scoped(scope: { accountId?: string; ownerSpace?: string }): ScopedRepository<ContextVectorEntity> {
    const scopeFields: Record<string, string> = {};
    if (scope.accountId) {
      scopeFields['accountId'] = scope.accountId;
    }
    if (scope.ownerSpace !== undefined) {
      scopeFields['ownerSpace'] = scope.ownerSpace;
    }
    return new ScopedRepository(this.repo, scopeFields);
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
    /**
     * Scoping identifier. For memories/skills: flows from request context
     * (ctx.user.accountId). For resources: always 'default' (shared/global).
     */
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

    const entity = this.repo.create({
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
      embeddingJson,
    });

    // Atomic upsert matching original ON CONFLICT(id) DO UPDATE behaviour
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(ContextVectorEntity)
      .values(entity)
      .orUpdate(
        [
          'parent_uri', 'type', 'context_type', 'level', 'abstract',
          'name', 'description', 'tags', 'owner_space', 'updated_at', 'embedding_json',
        ],
        ['id'],
      )
      .execute();

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
    const entity = await this.repo.findOne({ where: { uri } });
    return entity ? this.entityToRecord(entity) : undefined;
  }

  async getById(id: string): Promise<ContextRecord | undefined> {
    const entity = await this.repo.findOne({ where: { id } });
    return entity ? this.entityToRecord(entity) : undefined;
  }

  async deleteByUri(uri: string): Promise<boolean> {
    const result = await this.repo.delete({ uri });
    return (result.affected ?? 0) > 0;
  }

  /** Back-propagate L0 abstract and L1 overview into the vector record for a given URI. */
  async updateAbstractAndDescription(uri: string, abstract: string, description: string): Promise<void> {
    await this.repo.update({ uri }, {
      abstract,
      description,
      updatedAt: new Date().toISOString(),
    });
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  async listByContextType(
    contextType: string,
    opts: { accountId?: string; ownerSpace?: string; limit?: number; offset?: number } = {},
  ): Promise<ContextRecord[]> {
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    if (opts.accountId || opts.ownerSpace !== undefined) {
      // Fortress pattern: ScopedRepository guarantees scope is always applied
      const scopedRepo = this.scoped({
        accountId: opts.accountId,
        ownerSpace: opts.ownerSpace,
      });
      const entities = await scopedRepo.find({
        where: { contextType },
        order: { createdAt: 'DESC' },
        take: limit,
        skip: offset,
      });
      return entities.map((e) => this.entityToRecord(e));
    }

    const entities = await this.repo.find({
      where: { contextType },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return entities.map((e) => this.entityToRecord(e));
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
    const qb = this.repo.createQueryBuilder('cv')
      .where('cv.embedding_json IS NOT NULL');

    if (opts.contextType) {
      qb.andWhere('cv.context_type = :contextType', { contextType: opts.contextType });
    }
    if (opts.level !== undefined) {
      qb.andWhere('cv.level = :level', { level: opts.level });
    }
    if (opts.accountId) {
      qb.andWhere('cv.account_id = :accountId', { accountId: opts.accountId });
    }
    if (opts.parentUriPrefix) {
      qb.andWhere('cv.uri LIKE :uriPrefix', { uriPrefix: `${opts.parentUriPrefix}%` });
    }

    const entities = await qb.getMany();

    const limit = opts.limit ?? 10;
    const scoreThreshold = opts.scoreThreshold ?? 0.0;
    const scored: Array<ContextRecord & { score: number }> = [];

    for (const entity of entities) {
      if (!entity.embeddingJson) continue;

      let embedding: number[];
      try {
        embedding = JSON.parse(entity.embeddingJson) as number[];
      } catch {
        continue;
      }

      const score = cosineSimilarity(vector, embedding);
      if (score >= scoreThreshold) {
        scored.push({ ...this.entityToRecord(entity), score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Search children of a specific parent URI by vector similarity.
   * Used by hierarchical retriever for directory traversal.
   */
  async searchByParentUri(
    parentUri: string,
    queryVector: number[],
    opts: {
      limit?: number;
      contextType?: string;
      accountId?: string;
    } = {},
  ): Promise<Array<ContextRecord & { score: number }>> {
    const qb = this.repo.createQueryBuilder('cv')
      .where('cv.embedding_json IS NOT NULL')
      .andWhere('cv.parent_uri = :parentUri', { parentUri });

    if (opts.contextType) {
      qb.andWhere('cv.context_type = :contextType', { contextType: opts.contextType });
    }
    if (opts.accountId) {
      qb.andWhere('cv.account_id = :accountId', { accountId: opts.accountId });
    }

    const entities = await qb.getMany();
    const limit = opts.limit ?? 20;
    const scored: Array<ContextRecord & { score: number }> = [];

    for (const entity of entities) {
      if (!entity.embeddingJson) continue;

      let embedding: number[];
      try {
        embedding = JSON.parse(entity.embeddingJson) as number[];
      } catch {
        continue;
      }

      const score = cosineSimilarity(queryVector, embedding);
      scored.push({ ...this.entityToRecord(entity), score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Global vector search across the entire collection.
   * Used by hierarchical retriever for initial directory discovery.
   */
  async searchGlobal(
    queryVector: number[],
    opts: {
      limit?: number;
      contextType?: string;
      accountId?: string;
      targetDirectories?: string[];
    } = {},
  ): Promise<Array<ContextRecord & { score: number }>> {
    const qb = this.repo.createQueryBuilder('cv')
      .where('cv.embedding_json IS NOT NULL');

    if (opts.contextType) {
      qb.andWhere('cv.context_type = :contextType', { contextType: opts.contextType });
    }
    if (opts.accountId) {
      qb.andWhere('cv.account_id = :accountId', { accountId: opts.accountId });
    }
    if (opts.targetDirectories && opts.targetDirectories.length > 0) {
      const uriConditions = opts.targetDirectories
        .map((_, i) => `cv.uri LIKE :dir${i}`)
        .join(' OR ');
      const params: Record<string, string> = {};
      opts.targetDirectories.forEach((dir, i) => {
        params[`dir${i}`] = `${dir}%`;
      });
      qb.andWhere(`(${uriConditions})`, params);
    }

    const entities = await qb.getMany();
    const limit = opts.limit ?? 5;
    const scored: Array<ContextRecord & { score: number }> = [];

    for (const entity of entities) {
      if (!entity.embeddingJson) continue;

      let embedding: number[];
      try {
        embedding = JSON.parse(entity.embeddingJson) as number[];
      } catch {
        continue;
      }

      const score = cosineSimilarity(queryVector, embedding);
      scored.push({ ...this.entityToRecord(entity), score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async count(): Promise<number> {
    return this.repo.count();
  }

  async incrementActiveCount(uri: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(ContextVectorEntity)
      .set({
        activeCount: () => 'active_count + 1',
        updatedAt: new Date().toISOString(),
      })
      .where('uri = :uri', { uri })
      .execute();
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
