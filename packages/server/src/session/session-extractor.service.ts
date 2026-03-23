import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';

export type MemoryCategory =
  | 'profile'
  | 'preferences'
  | 'entities'
  | 'events'
  | 'cases'
  | 'patterns';

const VALID_CATEGORIES = new Set<MemoryCategory>([
  'profile',
  'preferences',
  'entities',
  'events',
  'cases',
  'patterns',
]);

export interface CandidateMemory {
  category: MemoryCategory;
  abstract: string;
  overview: string;
  content: string;
  language: string;
}

const EXTRACTION_SYSTEM_PROMPT = `You extract structured memories from conversations. Return only valid JSON. No markdown fences, no explanation.`;

function buildExtractionPrompt(
  messages: string,
): string {
  return `Extract key memories from this conversation. Return JSON:
{
  "memories": [
    {
      "category": "profile|preferences|entities|events|cases|patterns",
      "abstract": "one sentence summary (max 256 chars)",
      "overview": "medium detail markdown",
      "content": "full narrative markdown"
    }
  ]
}

Category guide:
- profile: user identity, background, persistent facts about the user
- preferences: user preferences and settings by topic
- entities: projects, people, concepts the user cares about
- events: decisions, milestones, key moments
- cases: specific problems solved (agent-level)
- patterns: reusable processes/methods (agent-level)

Only extract genuinely important information. Return {"memories": []} if nothing is worth remembering.

Conversation:
<user_content>
${messages}
</user_content>`;
}

@Injectable()
export class SessionExtractorService {
  private readonly logger = new Logger(SessionExtractorService.name);

  constructor(private readonly llm: LlmService) {}

  async extract(
    messages: ReadonlyArray<{ role: string; content: string }>,
  ): Promise<CandidateMemory[]> {
    if (messages.length === 0) {
      return [];
    }

    const formatted = messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n');

    if (!formatted.trim()) {
      return [];
    }

    const prompt = buildExtractionPrompt(formatted);

    try {
      const response = await this.llm.complete(
        EXTRACTION_SYSTEM_PROMPT,
        prompt,
        2048,
      );

      return this.parseResponse(response);
    } catch (err) {
      this.logger.error(`Memory extraction failed: ${String(err)}`);
      return [];
    }
  }

  private parseResponse(raw: string): CandidateMemory[] {
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
      const category: MemoryCategory = VALID_CATEGORIES.has(categoryRaw as MemoryCategory)
        ? (categoryRaw as MemoryCategory)
        : 'patterns';

      const abstract = String(entry['abstract'] ?? '').slice(0, 256);
      const overview = String(entry['overview'] ?? '');
      const content = String(entry['content'] ?? '');

      if (!abstract && !content) continue;

      candidates.push({
        category,
        abstract,
        overview,
        content,
        language: 'auto',
      });
    }

    this.logger.log(`Extracted ${candidates.length} candidate memories`);
    return candidates;
  }
}
