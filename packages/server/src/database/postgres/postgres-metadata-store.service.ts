import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemoryEntity } from '../entities/memory.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { SkillEntity } from '../entities/skill.entity';
import { SessionEntity } from '../entities/session.entity';
import { SessionMessageEntity } from '../entities/session-message.entity';
import {
  MemoryRecord,
  MemoryType,
  MemoryCategory,
  ResourceRecord,
  SkillRecord,
  SessionRecord,
  SessionMessage,
} from '../../shared/types';

@Injectable()
export class PostgresMetadataStoreService {
  private readonly logger = new Logger(PostgresMetadataStoreService.name);

  constructor(
    @InjectRepository(MemoryEntity)
    private readonly memoryRepo: Repository<MemoryEntity>,
    @InjectRepository(ResourceEntity)
    private readonly resourceRepo: Repository<ResourceEntity>,
    @InjectRepository(SkillEntity)
    private readonly skillRepo: Repository<SkillEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessionRepo: Repository<SessionEntity>,
    @InjectRepository(SessionMessageEntity)
    private readonly sessionMessageRepo: Repository<SessionMessageEntity>,
  ) {
    this.logger.log('Postgres metadata store initialized');
  }

  /* ── Memories ── */

  async insertMemory(memory: MemoryRecord): Promise<void> {
    await this.memoryRepo.save({
      id: memory.id,
      text: memory.text,
      type: memory.type,
      category: memory.category,
      agentId: memory.agentId ?? null,
      userId: memory.userId ?? null,
      uri: memory.uri,
      l0Abstract: memory.l0Abstract || null,
      l1Overview: memory.l1Overview || null,
      l2Content: memory.l2Content,
      embedding: null,
    });
  }

  async getMemoryById(id: string): Promise<MemoryRecord | undefined> {
    const entity = await this.memoryRepo.findOne({ where: { id } });
    return entity ? this.entityToMemory(entity) : undefined;
  }

  async listMemories(filters: {
    agentId?: string;
    userId?: string;
    type?: MemoryType;
    category?: MemoryCategory;
    limit?: number;
    offset?: number;
  }): Promise<MemoryRecord[]> {
    const qb = this.memoryRepo.createQueryBuilder('m');

    if (filters.agentId) {
      qb.andWhere('m.agent_id = :agentId', { agentId: filters.agentId });
    }
    if (filters.userId) {
      qb.andWhere('m.user_id = :userId', { userId: filters.userId });
    }
    if (filters.type) {
      qb.andWhere('m.type = :type', { type: filters.type });
    }
    if (filters.category) {
      qb.andWhere('m.category = :category', { category: filters.category });
    }

    qb.orderBy('m.created_at', 'DESC')
      .take(filters.limit ?? 100)
      .skip(filters.offset ?? 0);

    const entities = await qb.getMany();
    return entities.map((e) => this.entityToMemory(e));
  }

  async deleteMemory(id: string): Promise<boolean> {
    const result = await this.memoryRepo.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async updateMemory(
    id: string,
    updates: Partial<Pick<MemoryRecord, 'text' | 'l0Abstract' | 'l1Overview' | 'l2Content'>>,
  ): Promise<boolean> {
    const updateData: Record<string, unknown> = {};

    if (updates.text !== undefined) updateData['text'] = updates.text;
    if (updates.l0Abstract !== undefined) updateData['l0Abstract'] = updates.l0Abstract;
    if (updates.l1Overview !== undefined) updateData['l1Overview'] = updates.l1Overview;
    if (updates.l2Content !== undefined) updateData['l2Content'] = updates.l2Content;

    if (Object.keys(updateData).length === 0) return false;

    const result = await this.memoryRepo.update(id, updateData);
    return (result.affected ?? 0) > 0;
  }

  /* ── Resources ── */

  async insertResource(resource: ResourceRecord): Promise<void> {
    await this.resourceRepo.save({
      id: resource.id,
      title: resource.title || null,
      uri: resource.uri,
      sourceUrl: resource.sourceUrl ?? null,
      l0Abstract: resource.l0Abstract || null,
      l1Overview: resource.l1Overview || null,
      l2Content: resource.l2Content,
      embedding: null,
    });
  }

  async getResourceById(id: string): Promise<ResourceRecord | undefined> {
    const entity = await this.resourceRepo.findOne({ where: { id } });
    return entity ? this.entityToResource(entity) : undefined;
  }

  async listResources(limit: number = 100, offset: number = 0): Promise<ResourceRecord[]> {
    const entities = await this.resourceRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return entities.map((e) => this.entityToResource(e));
  }

  async deleteResource(id: string): Promise<boolean> {
    const result = await this.resourceRepo.delete(id);
    return (result.affected ?? 0) > 0;
  }

  /* ── Skills ── */

  async insertSkill(skill: SkillRecord): Promise<void> {
    await this.skillRepo.save({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      uri: skill.uri,
      tags: skill.tags.length > 0 ? skill.tags : null,
      l0Abstract: skill.l0Abstract || null,
      l1Overview: skill.l1Overview || null,
      l2Content: skill.l2Content,
      embedding: null,
    });
  }

  async getSkillById(id: string): Promise<SkillRecord | undefined> {
    const entity = await this.skillRepo.findOne({ where: { id } });
    return entity ? this.entityToSkill(entity) : undefined;
  }

  async listSkills(limit: number = 100, offset: number = 0, tag?: string): Promise<SkillRecord[]> {
    if (tag) {
      const entities = await this.skillRepo
        .createQueryBuilder('s')
        .where('s.tags @> :tag', { tag: JSON.stringify([tag]) })
        .orderBy('s.created_at', 'DESC')
        .take(limit)
        .skip(offset)
        .getMany();
      return entities.map((e) => this.entityToSkill(e));
    }

    const entities = await this.skillRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return entities.map((e) => this.entityToSkill(e));
  }

  async deleteSkill(id: string): Promise<boolean> {
    const result = await this.skillRepo.delete(id);
    return (result.affected ?? 0) > 0;
  }

  /* ── Sessions ── */

  async insertSession(session: SessionRecord): Promise<void> {
    await this.sessionRepo.save({
      id: session.id,
      agentId: session.agentId ?? null,
      userId: session.userId ?? null,
    });
  }

  async getSessionById(id: string): Promise<SessionRecord | undefined> {
    const entity = await this.sessionRepo.findOne({ where: { id } });
    if (!entity) return undefined;
    return {
      id: entity.id,
      agentId: entity.agentId ?? undefined,
      userId: entity.userId ?? undefined,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  async deleteSession(id: string): Promise<boolean> {
    const result = await this.sessionRepo.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async insertSessionMessage(message: SessionMessage): Promise<void> {
    await this.sessionMessageRepo.save({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
    });
  }

  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    const entities = await this.sessionMessageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
    return entities.map((e) => ({
      id: e.id,
      sessionId: e.sessionId,
      role: e.role as 'user' | 'assistant',
      content: e.content,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  /* ── Entity mappers ── */

  private entityToMemory(e: MemoryEntity): MemoryRecord {
    return {
      id: e.id,
      text: e.text,
      type: e.type as MemoryType,
      category: e.category as MemoryCategory,
      agentId: e.agentId ?? undefined,
      userId: e.userId ?? undefined,
      uri: e.uri,
      l0Abstract: e.l0Abstract ?? '',
      l1Overview: e.l1Overview ?? '',
      l2Content: e.l2Content,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private entityToResource(e: ResourceEntity): ResourceRecord {
    return {
      id: e.id,
      title: e.title ?? '',
      uri: e.uri,
      sourceUrl: e.sourceUrl ?? undefined,
      l0Abstract: e.l0Abstract ?? '',
      l1Overview: e.l1Overview ?? '',
      l2Content: e.l2Content,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private entityToSkill(e: SkillEntity): SkillRecord {
    return {
      id: e.id,
      name: e.name,
      description: e.description,
      uri: e.uri,
      tags: e.tags ?? [],
      l0Abstract: e.l0Abstract ?? '',
      l1Overview: e.l1Overview ?? '',
      l2Content: e.l2Content,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }
}
