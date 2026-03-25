import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { VfsService } from '../storage/vfs.service';
import { ContextVectorService } from '../storage/context-vector.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
import { LlmService } from '../llm/llm.service';
import { SkillRecord, SearchResult } from '../shared/types';

@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(
    private readonly vfs: VfsService,
    private readonly contextVectors: ContextVectorService,
    private readonly embeddingService: EmbeddingService,
    @Optional() private readonly embeddingQueue?: EmbeddingQueueService,
    @Optional() private readonly semanticQueue?: SemanticQueueService,
    @Optional() private readonly llmService?: LlmService,
  ) {}

  async createSkill(params: {
    name: string;
    description: string;
    content: string;
    tags?: string[];
  }): Promise<SkillRecord> {
    const now = new Date().toISOString();
    const uri = `viking://agent/skills/${params.name}/`;
    const parentUri = 'viking://agent/skills';
    const tags = params.tags ?? [];

    await this.vfs.writeFile(uri, params.content);

    let l0Abstract = params.content.slice(0, 256);
    let l1Overview = '';

    if (this.llmService?.isConfigured()) {
      try {
        const overview = await this.llmService.generateSkillOverview(
          params.name,
          params.description,
          params.content,
        );
        if (overview) {
          l1Overview = overview;
        }
      } catch (err) {
        this.logger.warn(`Skill overview generation failed for "${params.name}", using fallback: ${String(err)}`);
      }

      try {
        const l0l1 = await this.llmService.generateContextL0L1(
          params.name,
          params.content,
          'skill',
        );
        l0Abstract = l0l1.abstract || l0Abstract;
        if (!l1Overview) {
          l1Overview = l0l1.overview;
        }
      } catch (err) {
        this.logger.warn(`L0/L1 generation failed for skill "${params.name}": ${String(err)}`);
      }
    }

    const skillDescription = l1Overview || params.description;
    const cvId = ContextVectorService.generateId('default', uri);

    if (this.embeddingQueue) {
      this.embeddingQueue.enqueue({
        uri,
        text: params.content,
        contextType: 'skill',
        level: 2,
        abstract: l0Abstract,
        name: params.name,
        parentUri,
        accountId: 'default',
        ownerSpace: 'default',
        description: skillDescription || undefined,
        tags: tags.join(',') || undefined,
      });
    } else {
      let embedding: number[] | null = null;
      try {
        embedding = await this.embeddingService.embed(l0Abstract || params.content);
      } catch (err) {
        this.logger.warn(`Embedding failed for skill ${params.name}: ${String(err)}`);
      }
      await this.contextVectors.upsert({
        uri,
        parentUri,
        contextType: 'skill',
        level: 2,
        abstract: l0Abstract,
        name: params.name,
        description: skillDescription,
        tags: tags.join(','),
        accountId: 'default',
        embedding,
      });
    }

    if (this.semanticQueue) {
      this.semanticQueue.enqueue({
        uri: parentUri,
        contextType: 'skill',
        accountId: 'default',
        ownerSpace: 'default',
      });
    }

    const skill: SkillRecord = {
      id: cvId,
      name: params.name,
      description: params.description,
      uri,
      tags,
      l0Abstract,
      l1Overview,
      l2Content: params.content,
      createdAt: now,
      updatedAt: now,
    };

    this.logger.log(`Created skill ${cvId}: "${params.name}"`);
    return skill;
  }

  async searchSkills(
    query: string,
    limit: number = 10,
    scoreThreshold: number = 0.01,
  ): Promise<SearchResult[]> {
    const vector = await this.embeddingService.embed(query);
    const results = await this.contextVectors.searchSimilar(vector, {
      limit,
      scoreThreshold,
      contextType: 'skill',
    });

    const filtered = results.filter(
      (r) => !r.uri.endsWith('/.abstract.md') && !r.uri.endsWith('/.overview.md'),
    );

    return filtered.map((r) => ({
      id: r.id,
      uri: r.uri,
      text: r.abstract || r.description,
      score: r.score,
      l0Abstract: r.abstract,
    }));
  }

  async getSkill(id: string): Promise<SkillRecord> {
    const record = await this.contextVectors.getById(id);
    if (!record || record.contextType !== 'skill') {
      throw new NotFoundException(`Skill ${id} not found`);
    }

    let content = '';
    try {
      content = await this.vfs.readFile(record.uri);
    } catch {
      content = record.description;
    }

    const tags = record.tags ? record.tags.split(',').filter(Boolean) : [];

    return {
      id: record.id,
      name: record.name,
      description: record.description,
      uri: record.uri,
      tags,
      l0Abstract: record.abstract,
      l1Overview: record.description,
      l2Content: content,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async listSkills(limit: number = 100, offset: number = 0, tag?: string): Promise<SkillRecord[]> {
    const records = await this.contextVectors.listByContextType('skill', {
      limit,
      offset,
    });

    let filtered = records.filter(
      (r) => !r.uri.endsWith('/.abstract.md') && !r.uri.endsWith('/.overview.md'),
    );
    if (tag) {
      filtered = filtered.filter((r) => {
        const recordTags = r.tags ? r.tags.split(',') : [];
        return recordTags.includes(tag);
      });
    }

    const skills: SkillRecord[] = [];
    for (const record of filtered) {
      let content = '';
      try {
        content = await this.vfs.readFile(record.uri);
      } catch {
        content = record.description;
      }

      const recordTags = record.tags ? record.tags.split(',').filter(Boolean) : [];

      skills.push({
        id: record.id,
        name: record.name,
        description: record.description,
        uri: record.uri,
        tags: recordTags,
        l0Abstract: record.abstract,
        l1Overview: record.description,
        l2Content: content,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }

    return skills;
  }

  async deleteSkill(id: string): Promise<void> {
    const record = await this.contextVectors.getById(id);
    if (!record || record.contextType !== 'skill') {
      throw new NotFoundException(`Skill ${id} not found`);
    }

    try {
      await this.vfs.rm(record.uri);
    } catch {
      // file may not exist
    }

    await this.contextVectors.deleteById(id);
    this.logger.log(`Deleted skill ${id}`);
  }
}
