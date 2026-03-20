import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { MetadataStoreService } from '../storage/metadata-store.service';
import { VectorStoreService } from '../storage/vector-store.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { LlmService } from '../llm/llm.service';
import { VikingUriService } from '../viking-uri/viking-uri.service';
import { ResourceRecord, SearchResult } from '../shared/types';

@Injectable()
export class ResourceService {
  private readonly logger = new Logger(ResourceService.name);

  constructor(
    private readonly metadataStore: MetadataStoreService,
    private readonly vectorStore: VectorStoreService,
    private readonly embeddingService: EmbeddingService,
    private readonly llmService: LlmService,
    private readonly vikingUri: VikingUriService,
  ) {}

  async createResource(params: {
    title?: string;
    text?: string;
    url?: string;
    uri?: string;
  }): Promise<ResourceRecord> {
    if (!params.text && !params.url) {
      throw new BadRequestException('Either text or url must be provided');
    }

    const id = uuid();
    const now = new Date().toISOString();
    const content = params.text ?? `Resource from URL: ${params.url}`;
    const title = params.title ?? params.url ?? content.slice(0, 80);
    const uri = params.uri ?? this.vikingUri.build('resources', `${id}.md`);

    let l0Abstract = '';
    let l1Overview = '';

    try {
      [l0Abstract, l1Overview] = await Promise.all([
        this.llmService.generateAbstract(content),
        this.llmService.generateOverview(content),
      ]);
    } catch (err) {
      this.logger.warn(`L0/L1 generation failed for resource ${id}: ${String(err)}`);
      l0Abstract = content.slice(0, 100);
      l1Overview = content.slice(0, 500);
    }

    const resource: ResourceRecord = {
      id,
      title,
      uri,
      sourceUrl: params.url,
      l0Abstract,
      l1Overview,
      l2Content: content,
      createdAt: now,
      updatedAt: now,
    };

    await this.metadataStore.insertResource(resource);

    try {
      const vector = await this.embeddingService.embed(l0Abstract || content);
      await this.vectorStore.upsertResource(id, vector, {
        uri,
        text: l0Abstract || content.slice(0, 200),
        title,
      });
    } catch (err) {
      this.logger.warn(`Vector indexing failed for resource ${id}: ${String(err)}`);
    }

    this.logger.log(`Created resource ${id}: "${title}"`);
    return resource;
  }

  async searchResources(
    query: string,
    limit: number = 10,
    scoreThreshold: number = 0.01,
  ): Promise<SearchResult[]> {
    const vector = await this.embeddingService.embed(query);
    const results = await this.vectorStore.searchResources(vector, limit, scoreThreshold);

    return results.map((r) => ({
      id: r.id,
      uri: r.uri,
      text: r.text,
      score: r.score,
      l0Abstract: String(r.metadata['text'] ?? ''),
    }));
  }

  async getResource(id: string): Promise<ResourceRecord> {
    const resource = await this.metadataStore.getResourceById(id);
    if (!resource) {
      throw new NotFoundException(`Resource ${id} not found`);
    }
    return resource;
  }

  async listResources(limit: number = 100, offset: number = 0): Promise<ResourceRecord[]> {
    return this.metadataStore.listResources(limit, offset);
  }

  async deleteResource(id: string): Promise<void> {
    const deleted = await this.metadataStore.deleteResource(id);
    if (!deleted) {
      throw new NotFoundException(`Resource ${id} not found`);
    }
    await this.vectorStore.deleteResource(id);
    this.logger.log(`Deleted resource ${id}`);
  }
}
