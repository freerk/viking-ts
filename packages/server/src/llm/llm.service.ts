import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, LanguageModel } from 'ai';
import { getLanguageModel, LlmProvider } from './providers';

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private languageModel!: LanguageModel;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const provider = this.config.get<LlmProvider>('llm.provider', 'openai');
    const model = this.config.get<string>('llm.model', 'gpt-4o-mini');
    const apiKey = this.config.get<string>('llm.apiKey', '');
    const apiBase = this.config.get<string>('llm.apiBase', '');

    this.languageModel = getLanguageModel(
      provider,
      model,
      apiKey || 'dummy-key',
      apiBase || undefined,
    );

    this.logger.log(`LLM service initialized: provider=${provider} model=${model}`);
  }

  async complete(systemPrompt: string, userContent: string, maxTokens: number = 1024): Promise<string> {
    const { text } = await generateText({
      model: this.languageModel,
      maxOutputTokens: maxTokens,
      temperature: 0,
      system: systemPrompt,
      prompt: userContent,
    });

    if (!text) {
      throw new Error('No completion returned from LLM provider');
    }

    return text.trim();
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
    return this.complete(
      'Summarize this file in 2-3 sentences. Return only the summary, no prefix.',
      `File: ${fileName}\n\n${capped}`,
      200,
    );
  }

  async generateDirectoryOverview(
    dirName: string,
    fileSummaries: ReadonlyArray<{ name: string; summary: string }>,
    childAbstracts: ReadonlyArray<{ name: string; abstract: string }>,
  ): Promise<string> {
    const filePart = fileSummaries
      .map((f) => `- ${f.name}: ${f.summary}`)
      .join('\n');
    const childPart = childAbstracts
      .map((c) => `- ${c.name}: ${c.abstract}`)
      .join('\n');

    const userContent = [
      `Generate a concise overview of this directory '${dirName}'.`,
      filePart ? `\nFiles:\n${filePart}` : '',
      childPart ? `\nSubdirectories:\n${childPart}` : '',
    ].join('');

    return this.complete(
      'Generate a concise directory overview. Include key themes and contents. Max 4000 characters. Return only the overview.',
      userContent.slice(0, 60_000),
      1024,
    );
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
}
