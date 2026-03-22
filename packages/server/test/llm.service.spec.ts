import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { LlmService } from '../src/llm/llm.service';

const mockGenerateText = jest.fn();

jest.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

jest.mock('../src/llm/providers', () => ({
  getLanguageModel: jest.fn().mockReturnValue({ modelId: 'test-model' }),
}));

function mockCompletion(content: string): void {
  mockGenerateText.mockResolvedValueOnce({ text: content });
}

describe('LlmService', () => {
  let module: TestingModule;
  let service: LlmService;

  beforeEach(async () => {
    mockGenerateText.mockReset();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              llm: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                apiKey: 'test-key',
                apiBase: 'http://localhost:9999',
              },
            }),
          ],
        }),
      ],
      providers: [LlmService],
    }).compile();

    await module.init();
    service = module.get(LlmService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('complete', () => {
    it('should return trimmed completion text', async () => {
      mockCompletion('  Hello world  ');
      const result = await service.complete('system', 'user message');
      expect(result).toBe('Hello world');
    });

    it('should throw when no completion returned', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: '' });
      await expect(service.complete('system', 'user')).rejects.toThrow(
        'No completion returned from LLM provider',
      );
    });

    it('should throw when text is null', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: null });
      await expect(service.complete('system', 'user')).rejects.toThrow(
        'No completion returned from LLM provider',
      );
    });

    it('should propagate API errors', async () => {
      mockGenerateText.mockRejectedValueOnce(new Error('Service unavailable'));
      await expect(service.complete('system', 'user')).rejects.toThrow('Service unavailable');
    });
  });

  describe('generateAbstract', () => {
    it('should return abstract text', async () => {
      mockCompletion('A concise abstract of the content.');
      const result = await service.generateAbstract('Long content here...');
      expect(result).toBe('A concise abstract of the content.');
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputTokens: 100 }),
      );
    });
  });

  describe('generateOverview', () => {
    it('should return overview text', async () => {
      mockCompletion('- Key point 1\n- Key point 2');
      const result = await service.generateOverview('Long content here...');
      expect(result).toBe('- Key point 1\n- Key point 2');
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputTokens: 600 }),
      );
    });
  });

  describe('extractMemories', () => {
    it('should parse valid JSON array response', async () => {
      mockCompletion(
        '[{"text": "User likes TypeScript", "category": "preferences"}]',
      );

      const result = await service.extractMemories([
        { role: 'user', content: 'I love TypeScript' },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('User likes TypeScript');
      expect(result[0]?.category).toBe('preferences');
    });

    it('should handle JSON wrapped in markdown code fences', async () => {
      mockCompletion(
        '```json\n[{"text": "User is a developer", "category": "profile"}]\n```',
      );

      const result = await service.extractMemories([
        { role: 'user', content: 'I am a developer' },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('User is a developer');
    });

    it('should return empty array for malformed JSON', async () => {
      mockCompletion('This is not JSON at all');

      const result = await service.extractMemories([
        { role: 'user', content: 'Test' },
      ]);

      expect(result).toEqual([]);
    });

    it('should return empty array when response is not an array', async () => {
      mockCompletion('{"text": "single object", "category": "general"}');

      const result = await service.extractMemories([
        { role: 'user', content: 'Test' },
      ]);

      expect(result).toEqual([]);
    });

    it('should filter out items missing required fields', async () => {
      mockCompletion(
        '[{"text": "Valid", "category": "general"}, {"text": "Missing category"}, {"category": "Missing text"}, {"text": 123, "category": "general"}]',
      );

      const result = await service.extractMemories([
        { role: 'user', content: 'Test' },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('Valid');
    });

    it('should return empty array for empty conversation', async () => {
      mockCompletion('[]');

      const result = await service.extractMemories([]);
      expect(result).toEqual([]);
    });

    it('should format conversation with roles for the prompt', async () => {
      mockCompletion('[]');

      await service.extractMemories([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]);

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.prompt).toContain('user: Hello');
      expect(callArgs?.prompt).toContain('assistant: Hi there');
    });

    it('should handle multiple valid memories in response', async () => {
      mockCompletion(
        '[{"text": "Likes dark mode", "category": "preferences"}, {"text": "Works at Acme", "category": "profile"}]',
      );

      const result = await service.extractMemories([
        { role: 'user', content: 'I like dark mode and I work at Acme' },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]?.text).toBe('Likes dark mode');
      expect(result[1]?.text).toBe('Works at Acme');
    });

    it('should handle code fences without json language tag', async () => {
      mockCompletion(
        '```\n[{"text": "Fact", "category": "general"}]\n```',
      );

      const result = await service.extractMemories([
        { role: 'user', content: 'Something' },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('Fact');
    });

    it('should filter out null items in the array', async () => {
      mockCompletion(
        '[null, {"text": "Valid", "category": "general"}, null]',
      );

      const result = await service.extractMemories([
        { role: 'user', content: 'Test' },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]?.text).toBe('Valid');
    });
  });

  describe('complete edge cases', () => {
    it('should use temperature 0 for deterministic output', async () => {
      mockCompletion('Test');
      await service.complete('system', 'user');

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0 }),
      );
    });

    it('should pass custom maxTokens', async () => {
      mockCompletion('Test');
      await service.complete('system', 'user', 512);

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputTokens: 512 }),
      );
    });

    it('should use default maxTokens of 1024', async () => {
      mockCompletion('Test');
      await service.complete('system', 'user');

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputTokens: 1024 }),
      );
    });
  });
});
