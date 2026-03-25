/**
 * Hierarchical retriever for viking-ts.
 *
 * Faithful port of openviking/retrieve/hierarchical_retriever.py.
 * Implements directory-based hierarchical retrieval with recursive search
 * and score propagation.
 */
import { Injectable } from '@nestjs/common';
import { ContextVectorService, ContextRecord } from '../storage/context-vector.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { hotnessScore } from './hotness';
import { MatchedContextResponse } from './search.dto';

/** Priority queue entry: [negativeScore, uri] for max-heap via min-heap inversion. */
type QueueEntry = [number, string];

/** Internal candidate with propagated score. */
interface ScoredCandidate extends ContextRecord {
  score: number;
  finalScore: number;
}

export interface RetrieveOptions {
  query: string;
  contextType?: string;
  targetDirectories?: string[];
  limit?: number;
  scoreThreshold?: number;
  accountId?: string;
  /** User space name for root URI resolution. */
  userSpace?: string;
  /** Agent space name for root URI resolution. */
  agentSpace?: string;
}

@Injectable()
export class HierarchicalRetrieverService {
  /**
   * All constants match openviking/retrieve/hierarchical_retriever.py exactly.
   * Source: HierarchicalRetriever class attributes (lines 46-52).
   */
  readonly MAX_CONVERGENCE_ROUNDS = 3;
  readonly MAX_RELATIONS = 5;
  readonly SCORE_PROPAGATION_ALPHA = 0.5;
  readonly DIRECTORY_DOMINANCE_RATIO = 1.2;
  readonly GLOBAL_SEARCH_TOPK = 5;
  readonly HOTNESS_ALPHA = 0.2;

  /** Level-to-URI suffix mapping. Source: hierarchical_retriever.py line 52. */
  private readonly LEVEL_URI_SUFFIX: Record<number, string> = {
    0: '.abstract.md',
    1: '.overview.md',
  };

  constructor(
    private readonly contextVectors: ContextVectorService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * Execute hierarchical retrieval.
   *
   * Faithfully follows the algorithm from hierarchical_retriever.py:
   * 1. Global search for top-K across all levels
   * 2. Build starting directories from global results + root URIs
   * 3. Priority queue traversal with score propagation
   * 4. Convergence check
   * 5. Hotness boost
   */
  async retrieve(opts: RetrieveOptions): Promise<MatchedContextResponse[]> {
    const limit = opts.limit ?? 5;
    const threshold = opts.scoreThreshold ?? 0;

    // Step 1: Embed query
    const queryVector = await this.embedding.embed(opts.query);

    // Step 2: Determine root URIs for context type
    const targetDirs = opts.targetDirectories?.filter(Boolean) ?? [];
    const rootUris = targetDirs.length > 0
      ? targetDirs
      : this.getRootUrisForType(opts.contextType, opts.userSpace, opts.agentSpace);

    // Step 3: Global vector search
    const globalResults = await this.contextVectors.searchGlobal(queryVector, {
      limit: Math.min(limit, this.GLOBAL_SEARCH_TOPK),
      contextType: opts.contextType,
      accountId: opts.accountId,
      targetDirectories: targetDirs.length > 0 ? targetDirs : undefined,
    });

    // Step 4: Merge starting points (non-L2 from global + root URIs)
    const startingPoints = this.mergeStartingPoints(rootUris, globalResults);

    // Extract L2 files from global results as initial candidates
    const initialCandidates = globalResults.filter((r) => r.level === 2);

    // Step 5: Recursive search with priority queue
    const candidates = await this.recursiveSearch({
      queryVector,
      startingPoints,
      limit,
      threshold,
      contextType: opts.contextType,
      accountId: opts.accountId,
      initialCandidates,
    });

    // Step 6: Apply hotness boost and convert to response format
    const matched = this.applyHotnessAndConvert(candidates);

    return matched.slice(0, limit);
  }

  /**
   * Return starting directory URI list based on context_type.
   * Source: hierarchical_retriever.py _get_root_uris_for_type (lines 543-572).
   */
  private getRootUrisForType(
    contextType?: string,
    userSpace?: string,
    agentSpace?: string,
  ): string[] {
    const user = userSpace ?? 'default';
    const agent = agentSpace ?? 'default';

    if (contextType === undefined || contextType === null) {
      return [
        `viking://user/${user}/memories`,
        `viking://agent/${agent}/memories`,
        'viking://resources',
        `viking://agent/${agent}/skills`,
      ];
    }

    switch (contextType) {
      case 'memory':
        return [
          `viking://user/${user}/memories`,
          `viking://agent/${agent}/memories`,
        ];
      case 'resource':
        return ['viking://resources'];
      case 'skill':
        return [`viking://agent/${agent}/skills`];
      default:
        return [];
    }
  }

  /**
   * Merge starting points from global results (non-L2) and root URIs.
   * Source: hierarchical_retriever.py _merge_starting_points (lines 274-311).
   */
  private mergeStartingPoints(
    rootUris: string[],
    globalResults: Array<ContextRecord & { score: number }>,
  ): Array<[string, number]> {
    const points: Array<[string, number]> = [];
    const seen = new Set<string>();

    // Add non-L2 global results as starting points
    for (const r of globalResults) {
      if (r.level !== 2) {
        points.push([r.uri, r.score]);
        seen.add(r.uri);
      }
    }

    // Add root directories with score 0
    for (const uri of rootUris) {
      if (!seen.has(uri)) {
        points.push([uri, 0.0]);
        seen.add(uri);
      }
    }

    return points;
  }

  /**
   * Recursive search with directory priority queue and score propagation.
   * Source: hierarchical_retriever.py _recursive_search (lines 313-457).
   *
   * Uses a max-heap (inverted min-heap) to always explore the highest-scored
   * directory first. Score propagation blends child and parent scores.
   */
  private async recursiveSearch(params: {
    queryVector: number[];
    startingPoints: Array<[string, number]>;
    limit: number;
    threshold: number;
    contextType?: string;
    accountId?: string;
    initialCandidates: Array<ContextRecord & { score: number }>;
  }): Promise<ScoredCandidate[]> {
    const { queryVector, startingPoints, limit, threshold } = params;
    const alpha = this.SCORE_PROPAGATION_ALPHA;

    const collectedByUri = new Map<string, ScoredCandidate>();
    const dirQueue: QueueEntry[] = [];
    const visited = new Set<string>();
    let prevTopkUris = new Set<string>();
    let convergenceRounds = 0;

    // Add initial L2 candidates from global search
    // Source: hierarchical_retriever.py lines 356-367
    for (const r of params.initialCandidates) {
      if (r.uri && r.level === 2) {
        collectedByUri.set(r.uri, { ...r, finalScore: r.score });
      }
    }

    // Initialize priority queue with starting points
    // Source: hierarchical_retriever.py lines 372-373
    for (const [uri, score] of startingPoints) {
      heapPush(dirQueue, [-score, uri]);
    }

    // Main traversal loop
    // Source: hierarchical_retriever.py lines 375-457
    while (dirQueue.length > 0) {
      const entry = heapPop(dirQueue);
      if (!entry) break;

      const [negScore, currentUri] = entry;
      const currentScore = -negScore;

      if (visited.has(currentUri)) continue;
      visited.add(currentUri);

      const preFilterLimit = Math.max(limit * 2, 20);

      // Search children of current directory
      const results = await this.contextVectors.searchByParentUri(
        currentUri,
        queryVector,
        {
          limit: preFilterLimit,
          contextType: params.contextType,
          accountId: params.accountId,
        },
      );

      if (results.length === 0) continue;

      for (const r of results) {
        const uri = r.uri;

        // Score propagation formula
        // Source: hierarchical_retriever.py lines 409-411
        // final_score = alpha * score + (1 - alpha) * current_score if current_score else score
        const finalScore = currentScore
          ? alpha * r.score + (1 - alpha) * currentScore
          : r.score;

        if (finalScore <= threshold) continue;

        // Deduplicate by URI, keep highest score
        // Source: hierarchical_retriever.py lines 421-429
        const previous = collectedByUri.get(uri);
        if (previous === undefined || finalScore > previous.finalScore) {
          collectedByUri.set(uri, { ...r, finalScore });
        }

        // Only recurse into directories (L0/L1). L2 files are terminal.
        // Source: hierarchical_retriever.py lines 432-433
        if (!visited.has(uri) && r.level !== 2) {
          heapPush(dirQueue, [-finalScore, uri]);
        }
      }

      // Convergence check
      // Source: hierarchical_retriever.py lines 436-450
      const currentTopk = [...collectedByUri.values()]
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, limit);

      const currentTopkUris = new Set(currentTopk.map((c) => c.uri));

      if (setsEqual(currentTopkUris, prevTopkUris) && currentTopkUris.size >= limit) {
        convergenceRounds++;
        if (convergenceRounds >= this.MAX_CONVERGENCE_ROUNDS) {
          break;
        }
      } else {
        convergenceRounds = 0;
        prevTopkUris = currentTopkUris;
      }
    }

    // Sort by final score descending, return top limit
    // Source: hierarchical_retriever.py lines 452-457
    return [...collectedByUri.values()]
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, limit);
  }

  /**
   * Apply hotness boost and convert candidates to response format.
   * Source: hierarchical_retriever.py _convert_to_matched_contexts (lines 459-527).
   *
   * Hotness formula: final_score = (1 - HOTNESS_ALPHA) * semantic_score + HOTNESS_ALPHA * hotness_score
   */
  private applyHotnessAndConvert(candidates: ScoredCandidate[]): MatchedContextResponse[] {
    const alpha = this.HOTNESS_ALPHA;

    const results: MatchedContextResponse[] = candidates.map((c) => {
      const semanticScore = c.finalScore;
      const hScore = hotnessScore(c.activeCount, c.updatedAt);
      const finalScore = (1 - alpha) * semanticScore + alpha * hScore;

      const displayUri = this.appendLevelSuffix(c.uri, c.level);

      return {
        uri: displayUri,
        parent_uri: c.parentUri ?? '',
        context_type: c.contextType,
        level: c.level,
        abstract: c.abstract,
        name: c.name,
        description: c.description,
        tags: c.tags,
        score: finalScore,
        active_count: c.activeCount,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
      };
    });

    // Re-sort by blended score so hotness boost can change ranking
    // Source: hierarchical_retriever.py line 526
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Append level suffix to URI for display.
   * Source: hierarchical_retriever.py _append_level_suffix (lines 529-541).
   */
  private appendLevelSuffix(uri: string, level: number): string {
    const suffix = this.LEVEL_URI_SUFFIX[level];
    if (!uri || !suffix) return uri;

    if (uri.endsWith(`/${suffix}`)) return uri;
    if (uri.endsWith('/.abstract.md') || uri.endsWith('/.overview.md')) return uri;

    const trimmed = uri.endsWith('/') && !uri.endsWith('://') ? uri.replace(/\/+$/, '') : uri;
    return `${trimmed}/${suffix}`;
  }
}

// --- Heap utilities (min-heap for max-heap via negation) ---

function heapPush(heap: QueueEntry[], entry: QueueEntry): void {
  heap.push(entry);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    const parentEntry = heap[parent];
    const currentEntry = heap[i];
    if (parentEntry === undefined || currentEntry === undefined) break;
    if (parentEntry[0] <= currentEntry[0]) break;
    heap[parent] = currentEntry;
    heap[i] = parentEntry;
    i = parent;
  }
}

function heapPop(heap: QueueEntry[]): QueueEntry | undefined {
  if (heap.length === 0) return undefined;
  if (heap.length === 1) return heap.pop();

  const top = heap[0];
  const last = heap.pop();
  if (last === undefined || top === undefined) return top;

  heap[0] = last;
  let i = 0;
  const len = heap.length;

  while (true) {
    const left = 2 * i + 1;
    const right = 2 * i + 2;
    let smallest = i;

    const smallestEntry = heap[smallest];
    const leftEntry = heap[left];
    const rightEntry = heap[right];

    if (smallestEntry === undefined) break;
    if (left < len && leftEntry !== undefined && leftEntry[0] < smallestEntry[0]) {
      smallest = left;
    }
    const newSmallestEntry = heap[smallest];
    if (newSmallestEntry === undefined) break;
    if (right < len && rightEntry !== undefined && rightEntry[0] < newSmallestEntry[0]) {
      smallest = right;
    }
    if (smallest === i) break;

    const swapEntry = heap[smallest];
    const currentEntry = heap[i];
    if (swapEntry === undefined || currentEntry === undefined) break;
    heap[i] = swapEntry;
    heap[smallest] = currentEntry;
    i = smallest;
  }

  return top;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}
