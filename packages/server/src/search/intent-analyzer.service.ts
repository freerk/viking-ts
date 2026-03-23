import { Injectable, Logger } from '@nestjs/common';
import { LlmService, QueryPlan, TypedQuery } from '../llm/llm.service';

export type { TypedQuery, QueryPlan } from '../llm/llm.service';

export interface AnalyzeOptions {
  compressionSummary: string;
  messages: ReadonlyArray<{ role: string; content: string }>;
  currentMessage: string;
  contextType?: 'memory' | 'resource' | 'skill';
  targetAbstract?: string;
  targetUri?: string;
}

@Injectable()
export class IntentAnalyzerService {
  private readonly logger = new Logger(IntentAnalyzerService.name);

  readonly MAX_RECENT_MESSAGES = 5;
  readonly MAX_COMPRESSION_SUMMARY_CHARS = 30_000;

  constructor(private readonly llm: LlmService) {}

  async analyze(opts: AnalyzeOptions): Promise<QueryPlan> {
    const recent = opts.messages.slice(-this.MAX_RECENT_MESSAGES);
    const recentMessages = recent.length > 0
      ? recent
          .filter((m) => m.content)
          .map((m) => `[${m.role}]: ${m.content}`)
          .join('\n')
      : 'None';

    const summary = this.truncateText(
      opts.compressionSummary,
      this.MAX_COMPRESSION_SUMMARY_CHARS,
    ) || 'None';

    const currentMessage = opts.currentMessage || 'None';

    try {
      const plan = await this.llm.analyzeIntent(
        recentMessages,
        currentMessage,
        summary,
        opts.contextType,
        opts.targetAbstract,
      );

      // If targetUri set, force targetDirectories on all queries
      if (opts.targetUri) {
        for (const q of plan.queries) {
          q.targetDirectories = [opts.targetUri];
        }
      }

      for (let i = 0; i < plan.queries.length; i++) {
        const q = plan.queries[i];
        if (q) {
          this.logger.debug(
            `  [${i + 1}] type=${q.contextType ?? 'all'}, priority=${q.priority}, query="${q.query}"`,
          );
        }
      }

      return plan;
    } catch (err) {
      this.logger.warn(`Intent analysis failed, falling back to single query: ${String(err)}`);

      // Fallback: single query with the original message
      const fallbackQuery: TypedQuery = {
        query: opts.currentMessage,
        contextType: opts.contextType ?? null,
        intent: 'fallback',
        priority: 1,
        targetDirectories: opts.targetUri ? [opts.targetUri] : [],
      };

      return {
        reasoning: 'Fallback: LLM intent analysis failed',
        queries: [fallbackQuery],
      };
    }
  }

  private truncateText(text: string, maxChars: number): string {
    if (!text || text.length <= maxChars) return text;
    return text.slice(0, maxChars - 15) + '\n...(truncated)';
  }
}
