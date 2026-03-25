import { Injectable, Logger } from '@nestjs/common';
import { LlmService, CandidateMemory } from '../llm/llm.service';

// Re-export types so existing consumers keep working
export type { CandidateMemory, MemoryCategory } from '../llm/llm.service';

/**
 * Detect the dominant language from a set of messages.
 * Counts CJK characters vs Latin; returns 'zh' for Chinese-dominant,
 * 'en' for English-dominant, 'auto' when uncertain.
 */
function detectOutputLanguage(
  messages: ReadonlyArray<{ role: string; content: string }>,
): string {
  let cjkChars = 0;
  let latinChars = 0;

  for (const m of messages) {
    for (const ch of m.content) {
      const code = ch.codePointAt(0) ?? 0;
      if (
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0xf900 && code <= 0xfaff)
      ) {
        cjkChars++;
      } else if (
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a)
      ) {
        latinChars++;
      }
    }
  }

  const total = cjkChars + latinChars;
  if (total === 0) return 'auto';
  if (cjkChars / total > 0.3) return 'zh';
  if (latinChars / total > 0.7) return 'en';
  return 'auto';
}

@Injectable()
export class SessionExtractorService {
  private readonly logger = new Logger(SessionExtractorService.name);

  constructor(private readonly llm: LlmService) {}

  async extract(
    messages: ReadonlyArray<{ role: string; content: string }>,
    user?: string,
  ): Promise<CandidateMemory[]> {
    if (messages.length === 0) {
      return [];
    }

    const hasContent = messages.some((m) => m.content.trim().length > 0);
    if (!hasContent) {
      return [];
    }

    const outputLanguage = detectOutputLanguage(messages);

    try {
      return await this.llm.extractMemoriesFromSession(
        user ?? 'default',
        messages,
        outputLanguage,
      );
    } catch (err) {
      this.logger.error(`Memory extraction failed: ${String(err)}`);
      return [];
    }
  }
}
