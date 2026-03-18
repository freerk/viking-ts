import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { MetadataStoreService } from '../storage/metadata-store.service';
import { VectorStoreService } from '../storage/vector-store.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { LlmService } from '../llm/llm.service';
import { VikingUriService } from '../viking-uri/viking-uri.service';
import {
  MemoryRecord,
  MemoryType,
  MemoryCategory,
  SearchResult,
  SessionMessage,
} from '../shared/types';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly metadataStore: MetadataStoreService,
    private readonly vectorStore: VectorStoreService,
    private readonly embeddingService: EmbeddingService,
    private readonly llmService: LlmService,
    private readonly vikingUri: VikingUriService,
  ) {}

  async createMemory(params: {
    text: string;
    type?: MemoryType;
    category?: MemoryCategory;
    agentId?: string;
    userId?: string;
    uri?: string;
  }): Promise<MemoryRecord> {
    const id = uuid();
    const now = new Date().toISOString();
    const type: MemoryType = params.type ?? 'user';
    const category: MemoryCategory = params.category ?? 'general';

    const scope = type === 'user' ? 'user' : 'agent';
    const uri =
      params.uri ?? this.vikingUri.build(scope, 'memories', category, `${id}.md`);

    let l0Abstract = '';
    let l1Overview = '';

    try {
      [l0Abstract, l1Overview] = await Promise.all([
        this.llmService.generateAbstract(params.text),
        this.llmService.generateOverview(params.text),
      ]);
    } catch (err) {
      this.logger.warn(`L0/L1 generation failed, storing without summaries: ${String(err)}`);
      l0Abstract = params.text.slice(0, 100);
      l1Overview = params.text.slice(0, 500);
    }

    const memory: MemoryRecord = {
      id,
      text: params.text,
      type,
      category,
      agentId: params.agentId,
      userId: params.userId,
      uri,
      l0Abstract,
      l1Overview,
      l2Content: params.text,
      createdAt: now,
      updatedAt: now,
    };

    this.metadataStore.insertMemory(memory);

    try {
      const vector = await this.embeddingService.embed(l0Abstract || params.text);
      await this.vectorStore.upsertMemory(id, vector, {
        uri,
        text: l0Abstract || params.text.slice(0, 200),
        type,
        category,
        agentId: params.agentId ?? '',
        userId: params.userId ?? '',
      });
    } catch (err) {
      this.logger.warn(`Vector indexing failed for memory ${id}: ${String(err)}`);
    }

    this.logger.log(`Created memory ${id} [${type}/${category}]`);
    return memory;
  }

  async searchMemories(
    query: string,
    limit: number = 6,
    scoreThreshold: number = 0.01,
    uriFilter?: string,
  ): Promise<SearchResult[]> {
    const vector = await this.embeddingService.embed(query);
    const results = await this.vectorStore.searchMemories(vector, limit * 2, scoreThreshold);

    let filtered = results;
    if (uriFilter) {
      const parsed = this.vikingUri.parse(uriFilter);
      const prefix = `viking://${parsed.fullPath}`;
      filtered = results.filter((r) => r.uri.startsWith(prefix));
    }

    return filtered.slice(0, limit).map((r) => ({
      id: r.id,
      uri: r.uri,
      text: r.text,
      score: r.score,
      l0Abstract: String(r.metadata['text'] ?? ''),
      category: String(r.metadata['category'] ?? ''),
      type: String(r.metadata['type'] ?? ''),
    }));
  }

  getMemory(id: string): MemoryRecord {
    const memory = this.metadataStore.getMemoryById(id);
    if (!memory) {
      throw new NotFoundException(`Memory ${id} not found`);
    }
    return memory;
  }

  listMemories(filters: {
    agentId?: string;
    userId?: string;
    type?: MemoryType;
    category?: MemoryCategory;
    limit?: number;
    offset?: number;
  }): MemoryRecord[] {
    return this.metadataStore.listMemories(filters);
  }

  async deleteMemory(id: string): Promise<void> {
    const deleted = this.metadataStore.deleteMemory(id);
    if (!deleted) {
      throw new NotFoundException(`Memory ${id} not found`);
    }
    await this.vectorStore.deleteMemory(id);
    this.logger.log(`Deleted memory ${id}`);
  }

  async captureSession(
    messages: Array<{ role: string; content: string }>,
    agentId?: string,
    userId?: string,
  ): Promise<MemoryRecord[]> {
    const sessionId = uuid();
    const now = new Date().toISOString();

    this.metadataStore.insertSession({
      id: sessionId,
      agentId,
      userId,
      createdAt: now,
      updatedAt: now,
    });

    for (const msg of messages) {
      const msgRecord: SessionMessage = {
        id: uuid(),
        sessionId,
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        createdAt: now,
      };
      this.metadataStore.insertSessionMessage(msgRecord);
    }

    let extracted: Array<{ text: string; category: string }> = [];
    try {
      extracted = await this.llmService.extractMemories(messages);
    } catch (err) {
      this.logger.warn(`Memory extraction failed for session ${sessionId}: ${String(err)}`);
    }

    const createdMemories: MemoryRecord[] = [];

    for (const item of extracted) {
      try {
        const memory = await this.createMemory({
          text: item.text,
          type: 'user',
          category: (item.category as MemoryCategory) || 'general',
          agentId,
          userId,
        });
        createdMemories.push(memory);
      } catch (err) {
        this.logger.warn(`Failed to create extracted memory: ${String(err)}`);
      }
    }

    this.logger.log(
      `Session ${sessionId} captured: ${messages.length} messages, ${createdMemories.length} memories extracted`,
    );

    return createdMemories;
  }
}
