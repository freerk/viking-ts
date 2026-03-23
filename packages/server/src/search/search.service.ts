import { Injectable, Logger } from '@nestjs/common';
import { HierarchicalRetrieverService, RetrieveOptions } from './hierarchical-retriever.service';
import { IntentAnalyzerService } from './intent-analyzer.service';
import { SessionService } from '../session/session.service';
import { VfsService } from '../storage/vfs.service';
import { MatchedContextResponse, FindResult, GrepMatch } from './search.dto';

export type { FindResult } from './search.dto';

function categorize(contexts: MatchedContextResponse[]): FindResult {
  const memories: MatchedContextResponse[] = [];
  const resources: MatchedContextResponse[] = [];
  const skills: MatchedContextResponse[] = [];

  for (const ctx of contexts) {
    switch (ctx.context_type) {
      case 'memory':
        memories.push(ctx);
        break;
      case 'skill':
        skills.push(ctx);
        break;
      case 'resource':
      default:
        resources.push(ctx);
        break;
    }
  }

  return {
    memories,
    resources,
    skills,
    total: memories.length + resources.length + skills.length,
  };
}

/** Infer context_type from a Viking URI prefix. */
function inferContextType(
  targetUri?: string,
): 'memory' | 'resource' | 'skill' | undefined {
  if (!targetUri) return undefined;
  if (targetUri.includes('/memories')) return 'memory';
  if (targetUri.includes('/skills')) return 'skill';
  if (targetUri.includes('/resources')) return 'resource';
  return undefined;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly retriever: HierarchicalRetrieverService,
    private readonly intentAnalyzer: IntentAnalyzerService,
    private readonly sessionService: SessionService,
    private readonly vfs: VfsService,
  ) {}

  /**
   * Semantic search using hierarchical retrieval.
   * Returns categorized FindResult.
   */
  async find(opts: RetrieveOptions): Promise<FindResult> {
    const contexts = await this.retriever.retrieve(opts);
    return categorize(contexts);
  }

  /**
   * Session-aware search with intent analysis.
   */
  async search(opts: {
    query: string;
    targetUri?: string;
    sessionId?: string;
    limit?: number;
    scoreThreshold?: number;
    filter?: Record<string, unknown>;
  }): Promise<FindResult> {
    const limit = opts.limit ?? 10;

    if (opts.sessionId) {
      return this.searchWithSession(opts.query, opts.sessionId, opts.targetUri, limit, opts.scoreThreshold);
    }

    return this.searchWithoutSession(opts.query, opts.targetUri, limit, opts.scoreThreshold);
  }

  private async searchWithSession(
    query: string,
    sessionId: string,
    targetUri: string | undefined,
    limit: number,
    scoreThreshold: number | undefined,
  ): Promise<FindResult> {
    const sessionContext = await this.sessionService.getContextForSearch(sessionId);
    const summaryText = sessionContext.summaries.join('\n\n');

    const contextType = inferContextType(targetUri);

    const plan = await this.intentAnalyzer.analyze({
      compressionSummary: summaryText,
      messages: sessionContext.recentMessages,
      currentMessage: query,
      contextType,
      targetUri,
    });

    this.logger.debug(
      `Intent analysis produced ${plan.queries.length} queries (reasoning: ${plan.reasoning.slice(0, 100)})`,
    );

    const results = await Promise.all(
      plan.queries.map((tq) =>
        this.retriever.retrieve({
          query: tq.query,
          contextType: tq.contextType ?? undefined,
          targetDirectories: tq.targetDirectories.length > 0 ? tq.targetDirectories : undefined,
          limit,
          scoreThreshold,
        }),
      ),
    );

    const merged = this.mergeResults(results);
    return categorize(merged.slice(0, limit));
  }

  private async searchWithoutSession(
    query: string,
    targetUri: string | undefined,
    limit: number,
    scoreThreshold: number | undefined,
  ): Promise<FindResult> {
    const contextType = inferContextType(targetUri);

    if (contextType) {
      const contexts = await this.retriever.retrieve({
        query,
        contextType,
        targetDirectories: targetUri ? [targetUri] : undefined,
        limit,
        scoreThreshold,
      });
      return categorize(contexts);
    }

    const types: Array<'memory' | 'resource' | 'skill'> = ['memory', 'resource', 'skill'];
    const results = await Promise.all(
      types.map((ct) =>
        this.retriever.retrieve({
          query,
          contextType: ct,
          targetDirectories: targetUri ? [targetUri] : undefined,
          limit,
          scoreThreshold,
        }),
      ),
    );

    const merged = this.mergeResults(results);
    return categorize(merged.slice(0, limit));
  }

  private mergeResults(resultSets: MatchedContextResponse[][]): MatchedContextResponse[] {
    const byUri = new Map<string, MatchedContextResponse>();

    for (const results of resultSets) {
      for (const ctx of results) {
        const existing = byUri.get(ctx.uri);
        if (!existing || ctx.score > existing.score) {
          byUri.set(ctx.uri, ctx);
        }
      }
    }

    return [...byUri.values()].sort((a, b) => b.score - a.score);
  }

  /**
   * Grep: line-by-line regex search over VFS file content.
   */
  async grep(
    uri: string,
    pattern: string,
    caseInsensitive: boolean = false,
    nodeLimit?: number,
  ): Promise<GrepMatch[]> {
    const results = await this.vfs.grep(uri, pattern, caseInsensitive, nodeLimit);
    const matches: GrepMatch[] = [];

    for (const result of results) {
      const content = await this.vfs.readFile(result.uri);
      const lines = content.split('\n');
      const flags = caseInsensitive ? 'gi' : 'g';
      const regex = new RegExp(pattern, flags);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        regex.lastIndex = 0;
        if (regex.test(line)) {
          const contextBefore: string[] = [];
          const contextAfter: string[] = [];

          for (let j = Math.max(0, i - 2); j < i; j++) {
            const beforeLine = lines[j];
            if (beforeLine !== undefined) {
              contextBefore.push(beforeLine);
            }
          }
          for (let j = i + 1; j <= Math.min(lines.length - 1, i + 2); j++) {
            const afterLine = lines[j];
            if (afterLine !== undefined) {
              contextAfter.push(afterLine);
            }
          }

          matches.push({
            uri: result.uri,
            line_number: i + 1,
            line,
            context_before: contextBefore,
            context_after: contextAfter,
          });
        }
        regex.lastIndex = 0;
      }

      if (nodeLimit !== undefined && matches.length >= nodeLimit) {
        return matches.slice(0, nodeLimit);
      }
    }

    return matches;
  }

  /**
   * Glob: match VFS node URIs against a glob pattern.
   */
  async glob(
    pattern: string,
    uri?: string,
    nodeLimit?: number,
  ): Promise<string[]> {
    return this.vfs.glob(pattern, uri, nodeLimit);
  }
}
