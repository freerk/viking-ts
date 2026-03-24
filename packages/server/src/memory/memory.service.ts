import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { VfsService } from '../storage/vfs.service';
import { ContextVectorService } from '../storage/context-vector.service';
import { DatabaseService } from '../storage/database.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { LlmService } from '../llm/llm.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { SemanticQueueService } from '../queue/semantic-queue.service';
import {
  MemoryRecord,
  MemoryType,
  MemoryCategory,
  SearchResult,
} from '../shared/types';
import { UserIdentifier } from '../shared/request-context';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly vfs: VfsService,
    private readonly contextVectors: ContextVectorService,
    private readonly database: DatabaseService,
    private readonly embeddingService: EmbeddingService,
    private readonly llmService: LlmService,
    @Optional() private readonly embeddingQueue?: EmbeddingQueueService,
    @Optional() private readonly semanticQueue?: SemanticQueueService,
  ) {}

  private buildMemoryUri(id: string, type: MemoryType, agentId?: string, userId?: string): string {
    if (type === 'agent') {
      const space = this.computeAgentSpace(userId, agentId);
      return `viking://agent/${space}/memories/${id}.md`;
    }
    const space = userId ?? 'default';
    return `viking://user/${space}/memories/${id}.md`;
  }

  private parentUriForMemory(type: MemoryType, agentId?: string, userId?: string): string {
    if (type === 'agent') {
      const space = this.computeAgentSpace(userId, agentId);
      return `viking://agent/${space}/memories`;
    }
    const space = userId ?? 'default';
    return `viking://user/${space}/memories`;
  }

  private computeAgentSpace(userId?: string, agentId?: string): string {
    const uid = userId ?? 'default';
    const aid = agentId ?? 'default';
    return new UserIdentifier('default', uid, aid).agentSpaceName();
  }

  async createMemory(params: {
    text: string;
    l0Abstract?: string;
    l1Overview?: string;
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
    const uri = params.uri ?? this.buildMemoryUri(id, type, params.agentId, params.userId);
    const parentUri = this.parentUriForMemory(type, params.agentId, params.userId);
    const ownerSpace = type === 'agent'
      ? this.computeAgentSpace(params.userId, params.agentId)
      : (params.userId ?? 'default');

    await this.vfs.writeFile(uri, params.text);

    const l0Abstract = params.l0Abstract || params.text.slice(0, 256);
    const l1Overview = params.l1Overview ?? '';

    if (this.embeddingQueue) {
      this.embeddingQueue.enqueue({
        uri,
        text: params.text,
        contextType: 'memory',
        level: 2,
        abstract: l0Abstract,
        name: `${id}.md`,
        parentUri,
        accountId: 'default',
        ownerSpace,
        description: l1Overview || undefined,
        tags: category,
      });
    } else {
      let embedding: number[] | null = null;
      try {
        embedding = await this.embeddingService.embed(l0Abstract || params.text);
      } catch (err) {
        this.logger.warn(`Embedding failed for memory ${id}: ${String(err)}`);
      }
      await this.contextVectors.upsert({
        uri,
        parentUri,
        contextType: 'memory',
        level: 2,
        abstract: l0Abstract,
        name: `${id}.md`,
        tags: category,
        description: l1Overview || undefined,
        accountId: 'default',
        ownerSpace,
        embedding,
      });
    }

    if (this.semanticQueue) {
      this.semanticQueue.enqueue({
        uri: parentUri,
        contextType: 'memory',
        accountId: 'default',
        ownerSpace,
      });
    }

    const memory: MemoryRecord = {
      id: ContextVectorService.generateId('default', uri),
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

    this.logger.log(`Created memory ${memory.id} [${type}/${category}]`);
    return memory;
  }

  async searchMemories(
    query: string,
    limit: number = 6,
    scoreThreshold: number = 0.01,
    uriFilter?: string,
  ): Promise<SearchResult[]> {
    const vector = await this.embeddingService.embed(query);
    const results = await this.contextVectors.searchSimilar(vector, {
      limit: limit * 2,
      scoreThreshold,
      contextType: 'memory',
      parentUriPrefix: uriFilter,
    });

    return results.slice(0, limit).map((r) => ({
      id: r.id,
      uri: r.uri,
      text: r.abstract || r.description,
      score: r.score,
      l0Abstract: r.abstract,
      category: r.tags,
      type: r.uri.startsWith('viking://agent/') ? 'agent' : 'user',
    }));
  }

  async getMemory(id: string): Promise<MemoryRecord> {
    const record = await this.contextVectors.getById(id);
    if (!record || record.contextType !== 'memory') {
      throw new NotFoundException(`Memory ${id} not found`);
    }

    let content = '';
    try {
      content = await this.vfs.readFile(record.uri);
    } catch {
      content = record.description;
    }

    return this.contextRecordToMemory(record, content);
  }

  async listMemories(filters: {
    agentId?: string;
    userId?: string;
    type?: MemoryType;
    category?: MemoryCategory;
    limit?: number;
    offset?: number;
  }): Promise<MemoryRecord[]> {
    // When both userId and agentId are provided, fetch both user-space and agent-space memories
    // and merge them — matching OpenViking behaviour where a user+agent query returns all
    // memories belonging to that user (user-space) and that agent (agent-space).
    let records: Awaited<ReturnType<typeof this.contextVectors.listByContextType>>;

    if (filters.agentId && filters.userId && !filters.type) {
      const agentSpace = this.computeAgentSpace(filters.userId, filters.agentId);
      const userSpace = filters.userId;
      const [agentRecords, userRecords] = await Promise.all([
        this.contextVectors.listByContextType('memory', {
          accountId: 'default',
          ownerSpace: agentSpace,
          limit: filters.limit,
          offset: filters.offset,
        }),
        this.contextVectors.listByContextType('memory', {
          accountId: 'default',
          ownerSpace: userSpace,
          limit: filters.limit,
          offset: filters.offset,
        }),
      ]);
      // Merge, deduplicate by id
      const seen = new Set<string>();
      records = [...agentRecords, ...userRecords].filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
    } else {
      let ownerSpace: string | undefined;
      if (filters.agentId) {
        ownerSpace = this.computeAgentSpace(filters.userId, filters.agentId);
      } else if (filters.userId) {
        ownerSpace = filters.userId;
      }
      records = await this.contextVectors.listByContextType('memory', {
        accountId: 'default',
        ownerSpace,
        limit: filters.limit,
        offset: filters.offset,
      });
    }

    let filtered = records;
    // Exclude VFS directory metadata nodes — these are internal files written by the
    // semantic processor, not user/agent memories.
    filtered = filtered.filter(
      (r) => !r.uri.endsWith('.abstract.md') && !r.uri.endsWith('.overview.md'),
    );
    if (filters.type) {
      const prefix = filters.type === 'agent' ? 'viking://agent/' : 'viking://user/';
      filtered = filtered.filter((r) => r.uri.startsWith(prefix));
    }
    if (filters.category) {
      filtered = filtered.filter((r) => r.tags === filters.category);
    }

    const memories: MemoryRecord[] = [];
    for (const record of filtered) {
      let content = '';
      try {
        content = await this.vfs.readFile(record.uri);
      } catch {
        content = record.description;
      }
      memories.push(this.contextRecordToMemory(record, content));
    }

    return memories;
  }

  async deleteMemory(id: string): Promise<void> {
    const record = await this.contextVectors.getById(id);
    if (!record || record.contextType !== 'memory') {
      throw new NotFoundException(`Memory ${id} not found`);
    }

    try {
      await this.vfs.rm(record.uri);
    } catch {
      // file may not exist
    }

    await this.contextVectors.deleteById(id);
    this.logger.log(`Deleted memory ${id}`);
  }

  async captureSession(
    messages: Array<{ role: string; content: string }>,
    agentId?: string,
    userId?: string,
  ): Promise<MemoryRecord[]> {
    const sessionId = uuid();
    const now = new Date().toISOString();

    this.database.db
      .prepare(
        `INSERT INTO sessions (session_id, account_id, user_id, agent_id, status, message_count, contexts_used, skills_used, created_at, updated_at)
         VALUES (?, 'default', ?, ?, 'active', 0, 0, 0, ?, ?)`,
      )
      .run(sessionId, userId ?? 'default', agentId ?? 'default', now, now);

    for (const msg of messages) {
      this.database.db
        .prepare(
          `INSERT INTO session_messages (id, session_id, role, content, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(uuid(), sessionId, msg.role, msg.content, now);
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

  private contextRecordToMemory(
    record: { id: string; uri: string; abstract: string; description: string; tags: string; ownerSpace: string; createdAt: string; updatedAt: string },
    content: string,
  ): MemoryRecord {
    const isAgent = record.uri.startsWith('viking://agent/');
    const type: MemoryType = isAgent ? 'agent' : 'user';

    return {
      id: record.id,
      text: content,
      type,
      category: (record.tags || 'general') as MemoryCategory,
      agentId: isAgent ? record.ownerSpace : undefined,
      userId: !isAgent ? record.ownerSpace : undefined,
      uri: record.uri,
      l0Abstract: record.abstract,
      l1Overview: record.description,
      l2Content: content,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
