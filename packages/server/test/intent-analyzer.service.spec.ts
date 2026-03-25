import { IntentAnalyzerService } from '../src/search/intent-analyzer.service';
import { LlmService, QueryPlan, TypedQuery } from '../src/llm/llm.service';

describe('IntentAnalyzerService', () => {
  let service: IntentAnalyzerService;
  let llm: { analyzeIntent: jest.Mock };

  beforeEach(() => {
    llm = { analyzeIntent: jest.fn() };
    service = new IntentAnalyzerService(llm as unknown as LlmService);
  });

  it('should return QueryPlan with typed queries', async () => {
    const plan: QueryPlan = {
      reasoning: 'Operational task',
      queries: [
        { query: 'Create RFC', contextType: 'skill', intent: 'Find tool', priority: 1, targetDirectories: [] },
        { query: 'RFC template', contextType: 'resource', intent: 'Get template', priority: 2, targetDirectories: [] },
        { query: "User's doc preferences", contextType: 'memory', intent: 'Get prefs', priority: 3, targetDirectories: [] },
      ],
    };
    llm.analyzeIntent.mockResolvedValue(plan);

    const result = await service.analyze({
      compressionSummary: '',
      messages: [{ role: 'user', content: 'Create an RFC document' }],
      currentMessage: 'Create an RFC document',
    });

    expect(result.reasoning).toBe('Operational task');
    expect(result.queries).toHaveLength(3);
    expect(result.queries[0]?.contextType).toBe('skill');
    expect(result.queries[1]?.contextType).toBe('resource');
    expect(result.queries[2]?.contextType).toBe('memory');
  });

  it('should fall back gracefully on LLM failure', async () => {
    llm.analyzeIntent.mockRejectedValue(new Error('LLM timeout'));

    const result = await service.analyze({
      compressionSummary: '',
      messages: [{ role: 'user', content: 'Search for something' }],
      currentMessage: 'Search for something',
    });

    expect(result.queries).toHaveLength(1);
    expect(result.queries[0]?.query).toBe('Search for something');
    expect(result.queries[0]?.contextType).toBeNull();
    expect(result.reasoning).toContain('Fallback');
  });

  it('should respect MAX_RECENT_MESSAGES cap', async () => {
    const plan: QueryPlan = { reasoning: '', queries: [] };
    llm.analyzeIntent.mockResolvedValue(plan);

    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));

    await service.analyze({
      compressionSummary: '',
      messages,
      currentMessage: 'Latest',
    });

    const recentMessages = llm.analyzeIntent.mock.calls[0]?.[0] as string;
    // Should only include last 5 messages
    expect(recentMessages).toContain('Message 15');
    expect(recentMessages).toContain('Message 19');
    expect(recentMessages).not.toContain('Message 0');
    expect(recentMessages).not.toContain('Message 14');
  });

  it('should force targetDirectories when targetUri is set', async () => {
    const queries: TypedQuery[] = [
      { query: 'test', contextType: 'memory', intent: '', priority: 1, targetDirectories: [] },
      { query: 'test2', contextType: 'resource', intent: '', priority: 2, targetDirectories: [] },
    ];
    llm.analyzeIntent.mockResolvedValue({ reasoning: '', queries });

    const result = await service.analyze({
      compressionSummary: '',
      messages: [{ role: 'user', content: 'Query' }],
      currentMessage: 'Query',
      targetUri: 'viking://resources/docs',
    });

    for (const q of result.queries) {
      expect(q.targetDirectories).toEqual(['viking://resources/docs']);
    }
  });

  it('should truncate compression summary when too long', async () => {
    llm.analyzeIntent.mockResolvedValue({ reasoning: '', queries: [] });

    const longSummary = 'x'.repeat(40_000);
    await service.analyze({
      compressionSummary: longSummary,
      messages: [],
      currentMessage: 'Test',
    });

    const summaryArg = llm.analyzeIntent.mock.calls[0]?.[2] as string;
    expect(summaryArg.length).toBeLessThan(31_000);
    expect(summaryArg).toContain('(truncated)');
  });

  it('should pass contextType constraint to LLM', async () => {
    llm.analyzeIntent.mockResolvedValue({ reasoning: '', queries: [] });

    await service.analyze({
      compressionSummary: '',
      messages: [],
      currentMessage: 'Find skill',
      contextType: 'skill',
    });

    expect(llm.analyzeIntent).toHaveBeenCalledWith(
      expect.any(String),
      'Find skill',
      expect.any(String),
      'skill',
      undefined,
    );
  });

  it('should handle empty messages list', async () => {
    llm.analyzeIntent.mockResolvedValue({ reasoning: '', queries: [] });

    const result = await service.analyze({
      compressionSummary: '',
      messages: [],
      currentMessage: 'Query',
    });

    expect(result.queries).toEqual([]);

    const recentArg = llm.analyzeIntent.mock.calls[0]?.[0] as string;
    expect(recentArg).toBe('None');
  });

  it('should pass fallback contextType from options on LLM failure', async () => {
    llm.analyzeIntent.mockRejectedValue(new Error('fail'));

    const result = await service.analyze({
      compressionSummary: '',
      messages: [],
      currentMessage: 'Test',
      contextType: 'resource',
    });

    expect(result.queries[0]?.contextType).toBe('resource');
  });
});
