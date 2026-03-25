import { Injectable, Logger } from '@nestjs/common';
import { ContextVectorService } from '../storage/context-vector.service';
import { VfsService } from '../storage/vfs.service';
import { LlmService, DedupDecision } from '../llm/llm.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingQueueService } from '../queue/embedding-queue.service';
import { CandidateMemory, MemoryCategory } from './session-extractor.service';

/** Categories that always merge (skip dedup entirely). */
const ALWAYS_MERGE_CATEGORIES = new Set<MemoryCategory>(['profile']);

/** Categories where the merge action is supported. */
const MERGE_SUPPORTED_CATEGORIES = new Set<MemoryCategory>([
  'preferences',
  'entities',
  'patterns',
]);

/** Similarity score threshold for pre-filtering. */
const SIMILARITY_THRESHOLD = 0.7;

/** Max similar memories sent to LLM for dedup decision. */
const MAX_PROMPT_SIMILAR_MEMORIES = 5;

/** Categories that live under the user space. */
const USER_CATEGORIES = new Set<MemoryCategory>([
  'profile',
  'preferences',
  'entities',
  'events',
]);

interface SimilarMemory {
  uri: string;
  abstract: string;
  content: string;
  score: number;
}

export type DedupOutcome = 'created' | 'merged' | 'skipped';

@Injectable()
export class MemoryDeduplicatorService {
  private readonly logger = new Logger(MemoryDeduplicatorService.name);

  constructor(
    private readonly contextVector: ContextVectorService,
    private readonly vfs: VfsService,
    private readonly llm: LlmService,
    private readonly embedding: EmbeddingService,
    private readonly embeddingQueue: EmbeddingQueueService,
  ) {}

  /**
   * Deduplicate a candidate memory against existing memories in the vector store.
   * Returns the outcome: created, merged, or skipped.
   *
   * Ports OpenViking MemoryDeduplicator.deduplicate() + SessionCompressor.extract_long_term_memories().
   */
  async deduplicate(
    candidate: CandidateMemory,
    accountId: string,
    ownerSpace: string,
  ): Promise<DedupOutcome> {
    if (ALWAYS_MERGE_CATEGORIES.has(candidate.category)) {
      this.logger.debug(`Profile category: skipping dedup, always merge`);
      return 'skipped';
    }

    const scopeUri = this.categoryUriPrefix(candidate.category, ownerSpace);
    const similar = await this.findSimilarMemories(candidate, scopeUri, accountId);

    if (similar.length === 0) {
      return 'created';
    }

    const dedupDecision = await this.llm.decideDeduplicate(
      {
        abstract: candidate.abstract,
        overview: candidate.overview,
        content: candidate.content,
      },
      similar.map((m) => ({
        uri: m.uri,
        abstract: m.abstract,
        overview: '',
        content: m.content,
      })),
    );

    return this.executeDecision(dedupDecision, candidate, similar, accountId, ownerSpace);
  }

  private async findSimilarMemories(
    candidate: CandidateMemory,
    scopeUri: string,
    accountId: string,
  ): Promise<SimilarMemory[]> {
    let queryVector: number[];
    try {
      const queryText = `${candidate.abstract} ${candidate.content}`;
      queryVector = await this.embedding.embed(queryText);
    } catch (err) {
      this.logger.warn(`Embedding failed for candidate: ${String(err)}`);
      return [];
    }

    try {
      const results = await this.contextVector.searchSimilar(queryVector, {
        limit: MAX_PROMPT_SIMILAR_MEMORIES,
        scoreThreshold: SIMILARITY_THRESHOLD,
        contextType: 'memory',
        accountId,
        parentUriPrefix: scopeUri,
      });

      const similar: SimilarMemory[] = [];
      for (const r of results) {
        let content = '';
        try {
          content = await this.vfs.readFile(r.uri);
        } catch {
          content = r.abstract;
        }

        similar.push({
          uri: r.uri,
          abstract: r.abstract,
          content,
          score: r.score,
        });
      }

      return similar;
    } catch (err) {
      this.logger.warn(`Vector search failed: ${String(err)}`);
      return [];
    }
  }

  private async executeDecision(
    decision: DedupDecision,
    candidate: CandidateMemory,
    similar: SimilarMemory[],
    accountId: string,
    ownerSpace: string,
  ): Promise<DedupOutcome> {
    const similarByUri = new Map(similar.map((m) => [m.uri, m]));

    if (decision.decision === 'skip') {
      this.logger.debug(`Dedup: skipping candidate "${candidate.abstract}"`);
      return 'skipped';
    }

    if (decision.decision === 'none') {
      if (decision.list.length === 0) {
        return 'skipped';
      }

      let merged = false;
      for (const action of decision.list) {
        const existing = similarByUri.get(action.uri);
        if (!existing) continue;

        if (action.action === 'delete') {
          await this.deleteMemory(action.uri);
        } else if (action.action === 'merge') {
          if (MERGE_SUPPORTED_CATEGORIES.has(candidate.category)) {
            await this.mergeIntoExisting(candidate, existing, accountId, ownerSpace);
            merged = true;
          }
        }
      }

      return merged ? 'merged' : 'skipped';
    }

    // decision === 'create'
    for (const action of decision.list) {
      if (action.action === 'delete') {
        await this.deleteMemory(action.uri);
      }
    }

    return 'created';
  }

  private async mergeIntoExisting(
    candidate: CandidateMemory,
    existing: SimilarMemory,
    accountId: string,
    ownerSpace: string,
  ): Promise<void> {
    try {
      const mergedContent = await this.llm.mergeMemory(
        existing.content,
        candidate.content,
        candidate.category,
      );

      await this.vfs.writeFile(existing.uri, mergedContent);

      const parentUri = existing.uri.substring(0, existing.uri.lastIndexOf('/'));
      const name = existing.uri.substring(existing.uri.lastIndexOf('/') + 1);

      this.embeddingQueue.enqueue({
        uri: existing.uri,
        text: mergedContent,
        contextType: 'memory',
        level: 2,
        abstract: existing.abstract,
        name,
        parentUri,
        accountId,
        ownerSpace,
      });

      this.logger.log(`Merged memory: ${existing.uri}`);
    } catch (err) {
      this.logger.error(`Failed to merge memory ${existing.uri}: ${String(err)}`);
    }
  }

  private async deleteMemory(uri: string): Promise<void> {
    try {
      await this.vfs.rm(uri);
    } catch (err) {
      this.logger.error(`Failed to delete VFS file ${uri}: ${String(err)}`);
    }

    try {
      await this.contextVector.deleteByUri(uri);
    } catch (err) {
      this.logger.warn(`Failed to remove vector record for ${uri}: ${String(err)}`);
    }

    this.logger.log(`Deleted memory: ${uri}`);
  }

  /**
   * Build the URI prefix for category-scoped search.
   * Matches OpenViking _category_uri_prefix from deduplicator.py.
   */
  private categoryUriPrefix(category: MemoryCategory, ownerSpace: string): string {
    const space = USER_CATEGORIES.has(category) ? 'user' : 'agent';
    if (category === 'profile') {
      return `viking://${space}/${ownerSpace}/memories/profile.md`;
    }
    return `viking://${space}/${ownerSpace}/memories/${category}/`;
  }
}
