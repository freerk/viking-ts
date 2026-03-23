import { Injectable, Logger, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { VfsService } from '../storage/vfs.service';
import { ContextVectorService } from '../storage/context-vector.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
import { ResourceRecord, SearchResult } from '../shared/types';

@Injectable()
export class ResourceService {
  private readonly logger = new Logger(ResourceService.name);

  constructor(
    private readonly vfs: VfsService,
    private readonly contextVectors: ContextVectorService,
    private readonly embeddingService: EmbeddingService,
    @Optional() private readonly embeddingQueue?: EmbeddingQueueService,
    @Optional() private readonly semanticQueue?: SemanticQueueService,
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
    const uri = params.uri ?? `viking://resources/${id}.md`;
    const parentUri = 'viking://resources';

    await this.vfs.writeFile(uri, content);

    const l0Abstract = content.slice(0, 256);
    const cvId = ContextVectorService.generateId('default', uri);

    if (this.embeddingQueue) {
      this.embeddingQueue.enqueue({
        uri,
        text: content,
        contextType: 'resource',
        level: 2,
        abstract: l0Abstract,
        name: title,
        parentUri,
        accountId: 'default',
        ownerSpace: '',
      });
    } else {
      let embedding: number[] | null = null;
      try {
        embedding = await this.embeddingService.embed(l0Abstract || content);
      } catch (err) {
        this.logger.warn(`Embedding failed for resource ${id}: ${String(err)}`);
      }
      await this.contextVectors.upsert({
        uri,
        parentUri,
        contextType: 'resource',
        level: 2,
        abstract: l0Abstract,
        name: title,
        accountId: 'default',
        embedding,
      });
    }

    if (this.semanticQueue) {
      this.semanticQueue.enqueue({
        uri: parentUri,
        contextType: 'resource',
        accountId: 'default',
        ownerSpace: '',
      });
    }

    const resource: ResourceRecord = {
      id: cvId,
      title,
      uri,
      sourceUrl: params.url,
      l0Abstract,
      l1Overview: '',
      l2Content: content,
      createdAt: now,
      updatedAt: now,
    };

    this.logger.log(`Created resource ${cvId}: "${title}"`);
    return resource;
  }

  async searchResources(
    query: string,
    limit: number = 10,
    scoreThreshold: number = 0.01,
  ): Promise<SearchResult[]> {
    const vector = await this.embeddingService.embed(query);
    const results = await this.contextVectors.searchSimilar(vector, {
      limit,
      scoreThreshold,
      contextType: 'resource',
    });

    return results.map((r) => ({
      id: r.id,
      uri: r.uri,
      text: r.abstract || r.description,
      score: r.score,
      l0Abstract: r.abstract,
    }));
  }

  async getResource(id: string): Promise<ResourceRecord> {
    const record = await this.contextVectors.getById(id);
    if (!record || record.contextType !== 'resource') {
      throw new NotFoundException(`Resource ${id} not found`);
    }

    let content = '';
    try {
      content = await this.vfs.readFile(record.uri);
    } catch {
      content = record.description;
    }

    return {
      id: record.id,
      title: record.name,
      uri: record.uri,
      l0Abstract: record.abstract,
      l1Overview: record.description,
      l2Content: content,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async listResources(limit: number = 100, offset: number = 0): Promise<ResourceRecord[]> {
    const records = await this.contextVectors.listByContextType('resource', {
      limit,
      offset,
    });

    const resources: ResourceRecord[] = [];
    for (const record of records) {
      let content = '';
      try {
        content = await this.vfs.readFile(record.uri);
      } catch {
        content = record.description;
      }
      resources.push({
        id: record.id,
        title: record.name,
        uri: record.uri,
        l0Abstract: record.abstract,
        l1Overview: record.description,
        l2Content: content,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }

    return resources;
  }

  async deleteResource(id: string): Promise<void> {
    const record = await this.contextVectors.getById(id);
    if (!record || record.contextType !== 'resource') {
      throw new NotFoundException(`Resource ${id} not found`);
    }

    try {
      await this.vfs.rm(record.uri);
    } catch {
      // file may not exist
    }

    await this.contextVectors.deleteById(id);
    this.logger.log(`Deleted resource ${id}`);
  }
}
