import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { LanguageModel } from 'ai';

export type LlmProvider = 'openai' | 'anthropic';

export function getLanguageModel(
  provider: LlmProvider,
  model: string,
  apiKey: string,
  apiBase?: string,
): LanguageModel {
  switch (provider) {
    case 'anthropic': {
      const client = createAnthropic({
        apiKey,
        ...(apiBase ? { baseURL: apiBase } : {}),
      });
      return client(model);
    }
    case 'openai':
    default: {
      const client = createOpenAI({
        apiKey,
        ...(apiBase ? { baseURL: apiBase } : {}),
      });
      return client(model);
    }
  }
}
