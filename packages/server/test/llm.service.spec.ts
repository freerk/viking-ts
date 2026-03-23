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

  describe('summarizeFile', () => {
    it('should use fileSummaryPrompt for .ts files', async () => {
      mockCompletion('A TypeScript module that exports helper functions.');
      const result = await service.summarizeFile('utils.ts', 'export function foo() {}');

      expect(result).toBe('A TypeScript module that exports helper functions.');
      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.prompt).toContain('【File Name】');
      expect(callArgs?.prompt).toContain('utils.ts');
      expect(callArgs?.prompt).not.toContain('documentation analysis expert');
    });

    it('should use documentSummaryPrompt for .md files', async () => {
      mockCompletion('A README describing the project setup.');
      const result = await service.summarizeFile('README.md', '# My Project');

      expect(result).toBe('A README describing the project setup.');
      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.prompt).toContain('documentation analysis expert');
      expect(callArgs?.prompt).toContain('README.md');
    });

    it('should use documentSummaryPrompt for .txt files', async () => {
      mockCompletion('A text document.');
      await service.summarizeFile('notes.txt', 'Some notes here');

      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.prompt).toContain('documentation analysis expert');
    });

    it('should cap content at 30000 chars', async () => {
      mockCompletion('Summary');
      const longContent = 'x'.repeat(40_000);
      await service.summarizeFile('big.ts', longContent);

      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.prompt.length).toBeLessThan(31_000);
    });
  });

  describe('generateDirectoryOverview', () => {
    it('should use numbered file references and post-process them', async () => {
      mockCompletion('# src\n\nBrief description.\n\n## Quick Navigation\n→ [1] for setup\n→ [2] for config');
      const result = await service.generateDirectoryOverview(
        'src',
        [
          { name: 'index.ts', summary: 'Entry point' },
          { name: 'config.ts', summary: 'Configuration loader' },
        ],
        [{ name: 'utils', abstract: 'Utility functions' }],
      );

      // [1] should be replaced with index.ts, [2] with config.ts
      expect(result).toContain('index.ts');
      expect(result).toContain('config.ts');
      expect(result).not.toContain('[1]');
      expect(result).not.toContain('[2]');

      // Check the prompt included numbered format
      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.prompt).toContain('[1] index.ts');
      expect(callArgs?.prompt).toContain('[2] config.ts');
      expect(callArgs?.prompt).toContain('utils/: Utility functions');
    });
  });

  describe('extractMemoriesFromSession', () => {
    it('should parse 8-category response', async () => {
      const response = JSON.stringify({
        memories: [
          { category: 'profile', abstract: 'User is dev', overview: '## Background', content: 'Full profile' },
          { category: 'preferences', abstract: 'Likes TS', overview: '## Prefs', content: 'TS preferred' },
          { category: 'entities', abstract: 'Viking project', overview: '## Info', content: 'Project details' },
          { category: 'events', abstract: 'Decided X', overview: '## Decision', content: 'Event details' },
          { category: 'cases', abstract: 'Bug fix', overview: '## Problem', content: 'Case details' },
          { category: 'patterns', abstract: 'Process X', overview: '## Flow', content: 'Pattern details' },
          { category: 'tools', abstract: 'web_search usage', overview: '## Tool', content: 'Tool details' },
          { category: 'skills', abstract: 'create_ppt tips', overview: '## Skill', content: 'Skill details' },
        ],
      });
      mockCompletion(response);

      const result = await service.extractMemoriesFromSession('testuser', [
        { role: 'user', content: 'Test message' },
      ]);

      expect(result).toHaveLength(8);
      expect(result[0]?.category).toBe('profile');
      expect(result[6]?.category).toBe('tools');
      expect(result[7]?.category).toBe('skills');
    });

    it('should default invalid category to patterns', async () => {
      mockCompletion(JSON.stringify({
        memories: [{ category: 'invalid_cat', abstract: 'X', overview: '', content: 'Y' }],
      }));

      const result = await service.extractMemoriesFromSession('user', [
        { role: 'user', content: 'Test' },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]?.category).toBe('patterns');
    });

    it('should return empty array for empty messages', async () => {
      const result = await service.extractMemoriesFromSession('user', []);
      expect(result).toEqual([]);
      expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('should handle markdown-wrapped JSON', async () => {
      mockCompletion('```json\n{"memories": [{"category": "profile", "abstract": "A", "overview": "", "content": "B"}]}\n```');

      const result = await service.extractMemoriesFromSession('user', [
        { role: 'user', content: 'Test' },
      ]);

      expect(result).toHaveLength(1);
    });

    it('should include memory extraction prompt content', async () => {
      mockCompletion('{"memories": []}');

      await service.extractMemoriesFromSession('alice', [
        { role: 'user', content: 'Hello' },
      ]);

      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.prompt).toContain('User: alice');
      expect(callArgs?.prompt).toContain('Memory Extraction Criteria');
      expect(callArgs?.prompt).toContain('[user]: Hello');
    });

    it('should return empty on LLM failure', async () => {
      mockGenerateText.mockRejectedValueOnce(new Error('timeout'));

      const result = await service.extractMemoriesFromSession('user', [
        { role: 'user', content: 'Test' },
      ]);

      expect(result).toEqual([]);
    });
  });

  describe('mergeMemory', () => {
    it('should call merge prompt and return merged content', async () => {
      mockCompletion('Merged result with both old and new info.');

      const result = await service.mergeMemory(
        'User likes TypeScript',
        'User also likes Rust',
        'preferences',
      );

      expect(result).toBe('Merged result with both old and new info.');
      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.prompt).toContain('Existing Content');
      expect(callArgs?.prompt).toContain('New Information');
      expect(callArgs?.prompt).toContain('preferences');
    });
  });

  describe('decideDeduplicate', () => {
    it('should parse valid dedup JSON response', async () => {
      mockCompletion(JSON.stringify({
        decision: 'none',
        reason: 'Same subject, merge',
        list: [{ uri: 'viking://user/default/memories/x.md', decide: 'merge', reason: 'complementary' }],
      }));

      const result = await service.decideDeduplicate(
        { abstract: 'A', overview: 'B', content: 'C' },
        [{ uri: 'viking://user/default/memories/x.md', abstract: 'A2', overview: 'B2', content: 'C2' }],
      );

      expect(result.decision).toBe('none');
      expect(result.list).toHaveLength(1);
      expect(result.list[0]?.action).toBe('merge');
    });

    it('should default to skip on invalid JSON', async () => {
      mockCompletion('not json');

      const result = await service.decideDeduplicate(
        { abstract: 'A', overview: 'B', content: 'C' },
        [],
      );

      expect(result.decision).toBe('skip');
    });

    it('should include dedup prompt content', async () => {
      mockCompletion(JSON.stringify({ decision: 'create', reason: 'new', list: [] }));

      await service.decideDeduplicate(
        { abstract: 'Test abstract', overview: 'Test overview', content: 'Test content' },
        [],
      );

      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.prompt).toContain('Critical delete boundary');
      expect(callArgs?.prompt).toContain('Test abstract');
    });
  });

  describe('analyzeIntent', () => {
    it('should parse valid query plan', async () => {
      mockCompletion(JSON.stringify({
        reasoning: 'Operational task',
        queries: [
          { query: 'Create RFC', context_type: 'skill', intent: 'Find tool', priority: 1 },
          { query: 'RFC template', context_type: 'resource', intent: 'Get template', priority: 2 },
        ],
      }));

      const result = await service.analyzeIntent(
        '[user]: Create an RFC',
        'Create an RFC document',
      );

      expect(result.reasoning).toBe('Operational task');
      expect(result.queries).toHaveLength(2);
      expect(result.queries[0]?.contextType).toBe('skill');
      expect(result.queries[1]?.contextType).toBe('resource');
    });

    it('should return empty queries on invalid JSON', async () => {
      mockCompletion('not json');

      const result = await service.analyzeIntent('msg', 'query');

      expect(result.queries).toEqual([]);
    });

    it('should default invalid context_type to null', async () => {
      mockCompletion(JSON.stringify({
        reasoning: 'test',
        queries: [{ query: 'test', context_type: 'invalid', intent: '', priority: 3 }],
      }));

      const result = await service.analyzeIntent('msg', 'query');

      expect(result.queries[0]?.contextType).toBeNull();
    });

    it('should include intent analysis prompt content', async () => {
      mockCompletion(JSON.stringify({ reasoning: '', queries: [] }));

      await service.analyzeIntent(
        '[user]: Hello',
        'What is Viking?',
        'Some summary',
        'resource',
        'Project overview',
      );

      const callArgs = mockGenerateText.mock.calls[0]?.[0];
      expect(callArgs?.prompt).toContain('context query planner');
      expect(callArgs?.prompt).toContain('What is Viking?');
      expect(callArgs?.prompt).toContain('Restricted Context Type');
      expect(callArgs?.prompt).toContain('resource');
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
