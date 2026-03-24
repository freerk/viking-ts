import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, streamText, LanguageModel } from 'ai';
import { getLanguageModel, LlmProvider } from './providers';
import {
  fileSummaryPrompt,
  documentSummaryPrompt,
  overviewGenerationPrompt,
  memoryExtractionPrompt,
  memoryMergePrompt,
  dedupDecisionPrompt,
  intentAnalysisPrompt,
  archiveSummaryPrompt,
} from './prompts';

const DOCUMENT_EXTENSIONS = new Set(['.md', '.txt', '.rst', '.adoc', '.tex']);

const VALID_MEMORY_CATEGORIES = new Set([
  'profile',
  'preferences',
  'entities',
  'events',
  'cases',
  'patterns',
  'tools',
  'skills',
]);

export type MemoryCategory =
  | 'profile'
  | 'preferences'
  | 'entities'
  | 'events'
  | 'cases'
  | 'patterns'
  | 'tools'
  | 'skills';

export interface CandidateMemory {
  category: MemoryCategory;
  abstract: string;
  overview: string;
  content: string;
  toolName?: string;
  skillName?: string;
  bestFor?: string;
  optimalParams?: string;
  recommendedFlow?: string;
  keyDependencies?: string;
  commonFailures?: string;
  recommendation?: string;
}

export interface DedupAction {
  uri: string;
  action: 'merge' | 'delete';
  reason: string;
}

export interface DedupDecision {
  decision: 'skip' | 'create' | 'none';
  reason: string;
  list: DedupAction[];
}

export interface TypedQuery {
  query: string;
  contextType: 'memory' | 'resource' | 'skill' | null;
  intent: string;
  priority: number;
  targetDirectories: string[];
}

export interface QueryPlan {
  reasoning: string;
  queries: TypedQuery[];
}

export interface LlmUsageStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
}

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private languageModel!: LanguageModel;
  private usageStats: LlmUsageStats = { calls: 0, inputTokens: 0, outputTokens: 0, byModel: {} };
  private providerName = '';
  private modelName = '';
  private thinking = false;
  private maxConcurrent = 100;
  private extraHeaders: Record<string, string> = {};
  private useStream = false;
  private activeCalls = 0;
  private waitQueue: Array<() => void> = [];

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const provider = this.config.get<LlmProvider>('vlm.provider', 'openai');
    const model = this.config.get<string>('vlm.model', 'gpt-4o-mini');
    const apiKey = this.config.get<string>('vlm.apiKey', '');
    const apiBase = this.config.get<string>('vlm.apiBase', '');

    this.providerName = provider;
    this.modelName = model;
    this.thinking = this.config.get<boolean>('vlm.thinking', false);
    this.maxConcurrent = this.config.get<number>('vlm.maxConcurrent', 100);
    this.extraHeaders = this.config.get<Record<string, string>>('vlm.extraHeaders', {});
    this.useStream = this.config.get<boolean>('vlm.stream', false);

    this.languageModel = getLanguageModel(
      provider,
      model,
      apiKey || 'dummy-key',
      apiBase || undefined,
    );

    this.logger.log(`LLM service initialized: provider=${provider} model=${model} thinking=${this.thinking} stream=${this.useStream} maxConcurrent=${this.maxConcurrent}`);
  }

  async complete(systemPrompt: string, userContent: string, maxTokens: number = 1024): Promise<string> {
    await this.acquireSemaphore();
    try {
      return await this.doComplete(systemPrompt, userContent, maxTokens);
    } finally {
      this.releaseSemaphore();
    }
  }

  private async doComplete(systemPrompt: string, userContent: string, maxTokens: number): Promise<string> {
    const headers = Object.keys(this.extraHeaders).length > 0 ? this.extraHeaders : undefined;

    if (this.useStream) {
      return this.doStreamComplete(systemPrompt, userContent, maxTokens, headers);
    }

    const { text, usage } = await generateText({
      model: this.languageModel,
      maxOutputTokens: maxTokens,
      temperature: 0,
      system: systemPrompt,
      prompt: userContent,
      ...(headers ? { headers } : {}),
    });

    if (!text) {
      throw new Error('No completion returned from LLM provider');
    }

    const inputTokens = usage?.inputTokens ?? Math.ceil(userContent.length / 4);
    const outputTokens = usage?.outputTokens ?? Math.ceil(text.length / 4);
    this.trackUsage(inputTokens, outputTokens);

    return text.trim();
  }

  private async doStreamComplete(
    systemPrompt: string,
    userContent: string,
    maxTokens: number,
    headers: Record<string, string> | undefined,
  ): Promise<string> {
    const result = streamText({
      model: this.languageModel,
      maxOutputTokens: maxTokens,
      temperature: 0,
      system: systemPrompt,
      prompt: userContent,
      ...(headers ? { headers } : {}),
    });

    const text = await result.text;
    const usage = await result.usage;

    if (!text) {
      throw new Error('No completion returned from LLM provider');
    }

    const inputTokens = usage?.inputTokens ?? Math.ceil(userContent.length / 4);
    const outputTokens = usage?.outputTokens ?? Math.ceil(text.length / 4);
    this.trackUsage(inputTokens, outputTokens);

    return text.trim();
  }

  private async acquireSemaphore(): Promise<void> {
    if (this.activeCalls < this.maxConcurrent) {
      this.activeCalls++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeCalls++;
        resolve();
      });
    });
  }

  private releaseSemaphore(): void {
    this.activeCalls--;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  getUsageStats(): LlmUsageStats {
    return {
      ...this.usageStats,
      byModel: { ...this.usageStats.byModel },
    };
  }

  getProviderName(): string {
    return this.providerName;
  }

  getModelName(): string {
    return this.modelName;
  }

  isConfigured(): boolean {
    const apiKey = this.config.get<string>('vlm.apiKey', '');
    const provider = this.config.get<string>('vlm.provider', '');
    return Boolean(apiKey && provider);
  }

  private trackUsage(inputTokens: number, outputTokens: number): void {
    this.usageStats.calls += 1;
    this.usageStats.inputTokens += inputTokens;
    this.usageStats.outputTokens += outputTokens;

    const key = `${this.providerName}/${this.modelName}`;
    const existing = this.usageStats.byModel[key] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
    existing.calls += 1;
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    this.usageStats.byModel[key] = existing;
  }

  async generateAbstract(content: string): Promise<string> {
    return this.complete(
      'Generate an ultra-concise one-sentence abstract (under 50 tokens) of the following content. Focus on the key topic and purpose. Return only the abstract, no prefix.',
      content,
      100,
    );
  }

  async generateOverview(content: string): Promise<string> {
    return this.complete(
      'Generate a concise overview (under 500 tokens) of the following content. Include key points as bullet points. Return only the overview, no prefix.',
      content,
      600,
    );
  }

  async summarizeFile(fileName: string, content: string): Promise<string> {
    const capped = content.slice(0, 30_000);
    const dotIndex = fileName.lastIndexOf('.');
    const ext = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
    const isDocument = DOCUMENT_EXTENSIONS.has(ext);

    const prompt = isDocument
      ? documentSummaryPrompt(fileName, capped)
      : fileSummaryPrompt(fileName, capped);

    return this.complete(
      'You are a file analysis expert. Follow the instructions in the user message exactly.',
      prompt,
      512,
    );
  }

  async generateDirectoryOverview(
    dirName: string,
    fileSummaries: ReadonlyArray<{ name: string; summary: string }>,
    childAbstracts: ReadonlyArray<{ name: string; abstract: string }>,
  ): Promise<string> {
    const fileIndexMap = new Map<number, string>();
    const filePart = fileSummaries
      .map((f, i) => {
        const num = i + 1;
        fileIndexMap.set(num, f.name);
        return `- [${num}] ${f.name}: ${f.summary}`;
      })
      .join('\n');

    const childPart = childAbstracts
      .map((c) => `- ${c.name}/: ${c.abstract}`)
      .join('\n');

    const prompt = overviewGenerationPrompt(
      dirName,
      filePart || '(none)',
      childPart || '(none)',
    );

    let result = await this.complete(
      'You are a documentation expert. Follow the instructions in the user message exactly.',
      prompt.slice(0, 60_000),
      2048,
    );

    result = result.replace(/\[(\d+)\]/g, (_match, numStr: string) => {
      const num = parseInt(numStr, 10);
      const name = fileIndexMap.get(num);
      return name ?? `[${numStr}]`;
    });

    return result;
  }

  extractAbstractFromOverview(overviewText: string): string {
    const lines = overviewText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith('#')) continue;
      return trimmed.slice(0, 256);
    }
    return overviewText.slice(0, 256);
  }

  async extractMemoriesFromSession(
    user: string,
    messages: ReadonlyArray<{ role: string; content: string }>,
    outputLanguage?: string,
  ): Promise<CandidateMemory[]> {
    const formatted = messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n');

    if (!formatted.trim()) {
      return [];
    }

    const prompt = memoryExtractionPrompt(
      user,
      formatted,
      outputLanguage ?? 'auto',
    );

    try {
      const response = await this.complete(
        'You extract structured memories from conversations. Return only valid JSON. No markdown fences, no explanation.',
        prompt,
        4096,
      );

      return this.parseMemoryResponse(response);
    } catch (err) {
      this.logger.error(`Memory extraction failed: ${String(err)}`);
      return [];
    }
  }

  async mergeMemory(
    existingContent: string,
    newContent: string,
    category: string,
    outputLanguage?: string,
  ): Promise<string> {
    const prompt = memoryMergePrompt(
      existingContent,
      newContent,
      category,
      outputLanguage ?? 'auto',
    );

    return this.complete(
      'You merge memory content. Return only the merged content, no explanation.',
      prompt,
      2048,
    );
  }

  async generateArchiveSummary(
    messages: ReadonlyArray<{ role: string; content: string }>,
  ): Promise<string> {
    const formatted = messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n');

    if (!formatted.trim()) {
      return '';
    }

    const prompt = archiveSummaryPrompt(formatted);

    return this.complete(
      'You are a session analysis expert. Follow the instructions in the user message exactly.',
      prompt,
      2048,
    );
  }

  async decideDeduplicate(
    candidate: { abstract: string; overview: string; content: string },
    existingMemories: ReadonlyArray<{ uri: string; abstract: string; overview: string; content: string }>,
  ): Promise<DedupDecision> {
    const existingFormatted = existingMemories
      .map((m) => `- URI: ${m.uri}\n  Abstract: ${m.abstract}\n  Overview: ${m.overview}\n  Content: ${m.content}`)
      .join('\n\n');

    const prompt = dedupDecisionPrompt(
      candidate.abstract,
      candidate.overview,
      candidate.content,
      existingFormatted || '(none)',
    );

    const response = await this.complete(
      'You make memory deduplication decisions. Return only valid JSON. No markdown fences, no explanation.',
      prompt,
      1024,
    );

    return this.parseDedupResponse(response);
  }

  async analyzeIntent(
    recentMessages: string,
    currentMessage: string,
    compressionSummary?: string,
    contextType?: string,
    targetAbstract?: string,
  ): Promise<QueryPlan> {
    const prompt = intentAnalysisPrompt(
      recentMessages,
      currentMessage,
      compressionSummary,
      contextType,
      targetAbstract,
    );

    const response = await this.complete(
      'You are a context query planner. Return only valid JSON. No markdown fences, no explanation.',
      prompt,
      2048,
    );

    return this.parseQueryPlanResponse(response);
  }

  async extractMemories(
    messages: Array<{ role: string; content: string }>,
  ): Promise<Array<{ text: string; category: string }>> {
    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `Analyze this conversation and extract important memories that should be stored for future reference.

Categorize each memory as one of: profile, preferences, entities, events, cases, patterns, general

Return a JSON array of objects with "text" and "category" fields. Only extract genuinely important information. Return an empty array if nothing is worth remembering.

Example output:
[{"text": "User prefers TypeScript over JavaScript", "category": "preferences"}]

Conversation:
<user_content>
${conversationText}
</user_content>`;

    const result = await this.complete(
      'You extract structured memories from conversations. Return only valid JSON arrays. No markdown, no explanation.',
      prompt,
      2048,
    );

    try {
      const cleaned = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed: unknown = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is { text: string; category: string } =>
          typeof item === 'object' &&
          item !== null &&
          'text' in item &&
          'category' in item &&
          typeof (item as Record<string, unknown>)['text'] === 'string' &&
          typeof (item as Record<string, unknown>)['category'] === 'string',
      );
    } catch {
      this.logger.warn('Failed to parse LLM memory extraction response');
      return [];
    }
  }

  private parseMemoryResponse(raw: string): CandidateMemory[] {
    const cleaned = raw
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
      .trim();

    let data: unknown;
    try {
      data = JSON.parse(cleaned);
    } catch {
      this.logger.warn('Failed to parse LLM memory extraction response');
      return [];
    }

    if (Array.isArray(data)) {
      data = { memories: data };
    }

    if (typeof data !== 'object' || data === null) {
      return [];
    }

    const obj = data as Record<string, unknown>;
    const memories = obj['memories'];
    if (!Array.isArray(memories)) {
      return [];
    }

    const candidates: CandidateMemory[] = [];

    for (const mem of memories) {
      if (typeof mem !== 'object' || mem === null) continue;

      const entry = mem as Record<string, unknown>;
      const categoryRaw = String(entry['category'] ?? 'patterns');
      const category: MemoryCategory = VALID_MEMORY_CATEGORIES.has(categoryRaw)
        ? (categoryRaw as MemoryCategory)
        : 'patterns';

      const abstract = String(entry['abstract'] ?? '').slice(0, 256);
      const overview = String(entry['overview'] ?? '');
      const content = String(entry['content'] ?? '');

      if (!abstract && !content) continue;

      candidates.push({ category, abstract, overview, content });
    }

    this.logger.log(`Extracted ${candidates.length} candidate memories`);
    return candidates;
  }

  private parseDedupResponse(raw: string): DedupDecision {
    const cleaned = raw
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
      .trim();

    let data: unknown;
    try {
      data = JSON.parse(cleaned);
    } catch {
      this.logger.warn('Failed to parse dedup decision response');
      return { decision: 'skip', reason: 'Failed to parse LLM response', list: [] };
    }

    if (typeof data !== 'object' || data === null) {
      return { decision: 'skip', reason: 'Invalid response shape', list: [] };
    }

    const obj = data as Record<string, unknown>;
    const decisionRaw = String(obj['decision'] ?? 'skip');
    const validDecisions = new Set(['skip', 'create', 'none']);
    const decision = validDecisions.has(decisionRaw)
      ? (decisionRaw as 'skip' | 'create' | 'none')
      : 'skip';

    const reason = String(obj['reason'] ?? '');
    const rawList = obj['list'];
    const list: DedupAction[] = [];

    if (Array.isArray(rawList)) {
      for (const item of rawList) {
        if (typeof item !== 'object' || item === null) continue;
        const entry = item as Record<string, unknown>;
        const uri = String(entry['uri'] ?? '');
        const actionRaw = String(entry['decide'] ?? '');
        if (!uri || (actionRaw !== 'merge' && actionRaw !== 'delete')) continue;
        list.push({
          uri,
          action: actionRaw,
          reason: String(entry['reason'] ?? ''),
        });
      }
    }

    return { decision, reason, list };
  }

  private parseQueryPlanResponse(raw: string): QueryPlan {
    const cleaned = raw
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
      .trim();

    let data: unknown;
    try {
      data = JSON.parse(cleaned);
    } catch {
      this.logger.warn('Failed to parse intent analysis response');
      return { reasoning: 'Failed to parse LLM response', queries: [] };
    }

    if (typeof data !== 'object' || data === null) {
      return { reasoning: 'Invalid response shape', queries: [] };
    }

    const obj = data as Record<string, unknown>;
    const reasoning = String(obj['reasoning'] ?? '');
    const rawQueries = obj['queries'];
    const queries: TypedQuery[] = [];

    if (Array.isArray(rawQueries)) {
      for (const q of rawQueries) {
        if (typeof q !== 'object' || q === null) continue;
        const entry = q as Record<string, unknown>;
        const query = String(entry['query'] ?? '');
        if (!query) continue;

        const ctRaw = String(entry['context_type'] ?? '');
        const validTypes = new Set(['memory', 'resource', 'skill']);
        const contextType = validTypes.has(ctRaw)
          ? (ctRaw as 'memory' | 'resource' | 'skill')
          : null;

        queries.push({
          query,
          contextType,
          intent: String(entry['intent'] ?? ''),
          priority: typeof entry['priority'] === 'number' ? entry['priority'] : 3,
          targetDirectories: [],
        });
      }
    }

    return { reasoning, queries };
  }
}
