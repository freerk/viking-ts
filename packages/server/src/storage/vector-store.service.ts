import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalIndex, MetadataTypes } from 'vectra';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

export interface VectorItem {
  id: string;
  uri: string;
  text: string;
  metadata: Record<string, MetadataTypes>;
}

export interface VectorSearchResult {
  id: string;
  uri: string;
  text: string;
  score: number;
  metadata: Record<string, MetadataTypes>;
}

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private memoriesIndex!: LocalIndex;
  private resourcesIndex!: LocalIndex;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const storagePath = this.config.get<string>('storage.path', '~/.viking-ts/data');
    const memoriesPath = join(storagePath, 'vectors', 'memories');
    const resourcesPath = join(storagePath, 'vectors', 'resources');

    for (const dir of [memoriesPath, resourcesPath]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.memoriesIndex = new LocalIndex(memoriesPath);
    this.resourcesIndex = new LocalIndex(resourcesPath);

    if (!(await this.memoriesIndex.isIndexCreated())) {
      await this.memoriesIndex.createIndex();
      this.logger.log('Created memories vector index');
    }

    if (!(await this.resourcesIndex.isIndexCreated())) {
      await this.resourcesIndex.createIndex();
      this.logger.log('Created resources vector index');
    }

    this.logger.log(`Vector store initialized at ${storagePath}`);
  }

  async upsertMemory(
    id: string,
    vector: number[],
    metadata: Record<string, MetadataTypes>,
  ): Promise<void> {
    const existing = await this.memoriesIndex.getItem(id);
    if (existing) {
      await this.memoriesIndex.deleteItem(id);
    }
    await this.memoriesIndex.insertItem({
      id,
      vector,
      metadata,
    });
  }

  async searchMemories(
    vector: number[],
    limit: number,
    scoreThreshold: number,
  ): Promise<VectorSearchResult[]> {
    const results = await this.memoriesIndex.queryItems(vector, limit);
    return results
      .filter((r) => r.score >= scoreThreshold)
      .map((r) => ({
        id: r.item.id,
        uri: String(r.item.metadata['uri'] ?? ''),
        text: String(r.item.metadata['text'] ?? ''),
        score: r.score,
        metadata: r.item.metadata,
      }));
  }

  async deleteMemory(id: string): Promise<void> {
    const existing = await this.memoriesIndex.getItem(id);
    if (existing) {
      await this.memoriesIndex.deleteItem(id);
    }
  }

  async upsertResource(
    id: string,
    vector: number[],
    metadata: Record<string, MetadataTypes>,
  ): Promise<void> {
    const existing = await this.resourcesIndex.getItem(id);
    if (existing) {
      await this.resourcesIndex.deleteItem(id);
    }
    await this.resourcesIndex.insertItem({
      id,
      vector,
      metadata,
    });
  }

  async searchResources(
    vector: number[],
    limit: number,
    scoreThreshold: number,
  ): Promise<VectorSearchResult[]> {
    const results = await this.resourcesIndex.queryItems(vector, limit);
    return results
      .filter((r) => r.score >= scoreThreshold)
      .map((r) => ({
        id: r.item.id,
        uri: String(r.item.metadata['uri'] ?? ''),
        text: String(r.item.metadata['text'] ?? ''),
        score: r.score,
        metadata: r.item.metadata,
      }));
  }

  async deleteResource(id: string): Promise<void> {
    const existing = await this.resourcesIndex.getItem(id);
    if (existing) {
      await this.resourcesIndex.deleteItem(id);
    }
  }
}
