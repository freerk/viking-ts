import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { MetadataStoreService } from '../storage/metadata-store.service';
import { VectorStoreService } from '../storage/vector-store.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { LlmService } from '../llm/llm.service';
import { VikingUriService } from '../viking-uri/viking-uri.service';
import { SkillRecord, SearchResult } from '../shared/types';

@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(
    private readonly metadataStore: MetadataStoreService,
    private readonly vectorStore: VectorStoreService,
    private readonly embeddingService: EmbeddingService,
    private readonly llmService: LlmService,
    private readonly vikingUri: VikingUriService,
  ) {}

  async createSkill(params: {
    name: string;
    description: string;
    content: string;
    tags?: string[];
  }): Promise<SkillRecord> {
    const id = uuid();
    const now = new Date().toISOString();
    const uri = this.vikingUri.build('agent', 'skills', `${params.name}/`);
    const tags = params.tags ?? [];

    let l0Abstract = '';
    let l1Overview = '';

    try {
      [l0Abstract, l1Overview] = await Promise.all([
        this.llmService.generateAbstract(params.content),
        this.llmService.generateOverview(params.content),
      ]);
    } catch (err) {
      this.logger.warn(`L0/L1 generation failed for skill ${id}: ${String(err)}`);
      l0Abstract = params.content.slice(0, 100);
      l1Overview = params.content.slice(0, 500);
    }

    const skill: SkillRecord = {
      id,
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

    await this.metadataStore.insertSkill(skill);

    try {
      const vector = await this.embeddingService.embed(l0Abstract || params.content);
      await this.vectorStore.upsertSkill(id, vector, {
        uri,
        text: l0Abstract || params.content.slice(0, 200),
        name: params.name,
        description: params.description,
      });
    } catch (err) {
      this.logger.warn(`Vector indexing failed for skill ${id}: ${String(err)}`);
    }

    this.logger.log(`Created skill ${id}: "${params.name}"`);
    return skill;
  }

  async searchSkills(
    query: string,
    limit: number = 10,
    scoreThreshold: number = 0.01,
  ): Promise<SearchResult[]> {
    const vector = await this.embeddingService.embed(query);
    const results = await this.vectorStore.searchSkills(vector, limit, scoreThreshold);

    return results.map((r) => ({
      id: r.id,
      uri: r.uri,
      text: r.text,
      score: r.score,
      l0Abstract: String(r.metadata['text'] ?? ''),
    }));
  }

  async getSkill(id: string): Promise<SkillRecord> {
    const skill = await this.metadataStore.getSkillById(id);
    if (!skill) {
      throw new NotFoundException(`Skill ${id} not found`);
    }
    return skill;
  }

  async listSkills(limit: number = 100, offset: number = 0, tag?: string): Promise<SkillRecord[]> {
    return this.metadataStore.listSkills(limit, offset, tag);
  }

  async deleteSkill(id: string): Promise<void> {
    const deleted = await this.metadataStore.deleteSkill(id);
    if (!deleted) {
      throw new NotFoundException(`Skill ${id} not found`);
    }
    await this.vectorStore.deleteSkill(id);
    this.logger.log(`Deleted skill ${id}`);
  }
}
