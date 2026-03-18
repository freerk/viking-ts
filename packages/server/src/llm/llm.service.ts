import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private client!: OpenAI;
  private model!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('llm.apiKey', '');
    const apiBase = this.config.get<string>('llm.apiBase', 'https://api.openai.com/v1');
    this.model = this.config.get<string>('llm.model', 'gpt-4o-mini');

    this.client = new OpenAI({
      apiKey: apiKey || 'dummy-key',
      baseURL: apiBase,
    });

    this.logger.log(`LLM service initialized: model=${this.model}`);
  }

  async complete(systemPrompt: string, userContent: string, maxTokens: number = 1024): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });

    const text = response.choices[0]?.message?.content;
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
