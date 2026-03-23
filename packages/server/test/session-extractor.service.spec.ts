import { SessionExtractorService, CandidateMemory } from '../src/session/session-extractor.service';
import { LlmService } from '../src/llm/llm.service';

describe('SessionExtractorService', () => {
  let service: SessionExtractorService;
  let llm: { extractMemoriesFromSession: jest.Mock };

  beforeEach(() => {
    llm = { extractMemoriesFromSession: jest.fn() };
    service = new SessionExtractorService(llm as unknown as LlmService);
  });

  it('should return empty array for empty messages', async () => {
    const result = await service.extract([]);
    expect(result).toEqual([]);
    expect(llm.extractMemoriesFromSession).not.toHaveBeenCalled();
  });

  it('should delegate to LlmService.extractMemoriesFromSession', async () => {
    const candidates: CandidateMemory[] = [
      {
        category: 'preferences',
        abstract: 'User prefers TypeScript',
        overview: 'The user expressed a strong preference for TypeScript',
        content: 'During the conversation, the user stated they prefer TypeScript over JavaScript.',
      },
      {
        category: 'entities',
        abstract: 'Project: Viking',
        overview: 'Viking is the user project',
        content: 'The user is working on a project called Viking.',
      },
    ];
    llm.extractMemoriesFromSession.mockResolvedValue(candidates);

    const result = await service.extract([
      { role: 'user', content: 'I prefer TypeScript. My project is Viking.' },
      { role: 'assistant', content: 'Noted!' },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.category).toBe('preferences');
    expect(result[0]?.abstract).toBe('User prefers TypeScript');
    expect(result[1]?.category).toBe('entities');

    expect(llm.extractMemoriesFromSession).toHaveBeenCalledWith(
      'default',
      expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({ role: 'assistant' }),
      ]),
      'en',
    );
  });

  it('should pass user parameter to LlmService', async () => {
    llm.extractMemoriesFromSession.mockResolvedValue([]);

    await service.extract(
      [{ role: 'user', content: 'Hello' }],
      'custom-user',
    );

    expect(llm.extractMemoriesFromSession).toHaveBeenCalledWith(
      'custom-user',
      expect.any(Array),
      expect.any(String),
    );
  });

  it('should return empty on LLM failure', async () => {
    llm.extractMemoriesFromSession.mockRejectedValue(new Error('LLM provider down'));

    const result = await service.extract([
      { role: 'user', content: 'Some message' },
    ]);

    expect(result).toEqual([]);
  });

  it('should return empty for whitespace-only messages', async () => {
    const result = await service.extract([
      { role: 'user', content: '   ' },
    ]);

    expect(result).toEqual([]);
    expect(llm.extractMemoriesFromSession).not.toHaveBeenCalled();
  });

  it('should detect Chinese language from messages', async () => {
    llm.extractMemoriesFromSession.mockResolvedValue([]);

    await service.extract([
      { role: 'user', content: '我喜欢用这个工具来进行开发工作' },
    ]);

    expect(llm.extractMemoriesFromSession).toHaveBeenCalledWith(
      'default',
      expect.any(Array),
      'zh',
    );
  });

  it('should detect English language from messages', async () => {
    llm.extractMemoriesFromSession.mockResolvedValue([]);

    await service.extract([
      { role: 'user', content: 'I prefer TypeScript for backend work' },
    ]);

    expect(llm.extractMemoriesFromSession).toHaveBeenCalledWith(
      'default',
      expect.any(Array),
      'en',
    );
  });

  it('should handle all 8 valid categories', async () => {
    const categories = ['profile', 'preferences', 'entities', 'events', 'cases', 'patterns', 'tools', 'skills'] as const;
    const candidates: CandidateMemory[] = categories.map((cat) => ({
      category: cat,
      abstract: `${cat} memory`,
      overview: 'Details',
      content: `Content for ${cat}`,
    }));
    llm.extractMemoriesFromSession.mockResolvedValue(candidates);

    const result = await service.extract([
      { role: 'user', content: 'Multi category test' },
    ]);

    expect(result).toHaveLength(8);
    for (let i = 0; i < categories.length; i++) {
      expect(result[i]?.category).toBe(categories[i]);
    }
  });

  it('should return empty memories as empty array', async () => {
    llm.extractMemoriesFromSession.mockResolvedValue([]);

    const result = await service.extract([
      { role: 'user', content: 'Nothing important' },
    ]);

    expect(result).toEqual([]);
  });
});
