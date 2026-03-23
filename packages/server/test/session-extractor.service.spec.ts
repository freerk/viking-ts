import { SessionExtractorService } from '../src/session/session-extractor.service';
import { LlmService } from '../src/llm/llm.service';

describe('SessionExtractorService', () => {
  let service: SessionExtractorService;
  let llm: { complete: jest.Mock };

  beforeEach(() => {
    llm = { complete: jest.fn() };
    service = new SessionExtractorService(llm as unknown as LlmService);
  });

  it('should return empty array for empty messages', async () => {
    const result = await service.extract([]);
    expect(result).toEqual([]);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('should parse valid LLM JSON response', async () => {
    llm.complete.mockResolvedValue(JSON.stringify({
      memories: [
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
      ],
    }));

    const result = await service.extract([
      { role: 'user', content: 'I prefer TypeScript. My project is Viking.' },
      { role: 'assistant', content: 'Noted!' },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.category).toBe('preferences');
    expect(result[0]?.abstract).toBe('User prefers TypeScript');
    expect(result[1]?.category).toBe('entities');
  });

  it('should default invalid category to patterns', async () => {
    llm.complete.mockResolvedValue(JSON.stringify({
      memories: [
        {
          category: 'invalid_category',
          abstract: 'Something',
          overview: 'Details',
          content: 'Full content',
        },
      ],
    }));

    const result = await service.extract([
      { role: 'user', content: 'Test message' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe('patterns');
  });

  it('should handle markdown-wrapped JSON response', async () => {
    llm.complete.mockResolvedValue('```json\n{"memories": [{"category": "profile", "abstract": "Name is Alice", "overview": "", "content": "The user name is Alice"}]}\n```');

    const result = await service.extract([
      { role: 'user', content: 'My name is Alice' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe('profile');
  });

  it('should handle list response (legacy format)', async () => {
    llm.complete.mockResolvedValue(JSON.stringify([
      {
        category: 'events',
        abstract: 'Met deadline',
        overview: 'Details',
        content: 'The team met the deadline',
      },
    ]));

    const result = await service.extract([
      { role: 'user', content: 'We met the deadline' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe('events');
  });

  it('should return empty on LLM failure', async () => {
    llm.complete.mockRejectedValue(new Error('LLM provider down'));

    const result = await service.extract([
      { role: 'user', content: 'Some message' },
    ]);

    expect(result).toEqual([]);
  });

  it('should return empty on invalid JSON', async () => {
    llm.complete.mockResolvedValue('not valid json at all');

    const result = await service.extract([
      { role: 'user', content: 'Some message' },
    ]);

    expect(result).toEqual([]);
  });

  it('should skip entries without abstract and content', async () => {
    llm.complete.mockResolvedValue(JSON.stringify({
      memories: [
        { category: 'profile', abstract: '', overview: '', content: '' },
        { category: 'profile', abstract: 'Valid one', overview: '', content: 'Has content' },
      ],
    }));

    const result = await service.extract([
      { role: 'user', content: 'Test' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.abstract).toBe('Valid one');
  });

  it('should truncate abstract to 256 chars', async () => {
    const longAbstract = 'A'.repeat(300);
    llm.complete.mockResolvedValue(JSON.stringify({
      memories: [
        { category: 'profile', abstract: longAbstract, overview: '', content: 'Content' },
      ],
    }));

    const result = await service.extract([
      { role: 'user', content: 'Test' },
    ]);

    expect(result[0]?.abstract.length).toBe(256);
  });

  it('should handle all 6 valid categories', async () => {
    const categories = ['profile', 'preferences', 'entities', 'events', 'cases', 'patterns'];
    llm.complete.mockResolvedValue(JSON.stringify({
      memories: categories.map((cat) => ({
        category: cat,
        abstract: `${cat} memory`,
        overview: 'Details',
        content: `Content for ${cat}`,
      })),
    }));

    const result = await service.extract([
      { role: 'user', content: 'Multi category test' },
    ]);

    expect(result).toHaveLength(6);
    for (let i = 0; i < categories.length; i++) {
      expect(result[i]?.category).toBe(categories[i]);
    }
  });

  it('should return empty memories JSON as empty array', async () => {
    llm.complete.mockResolvedValue('{"memories": []}');

    const result = await service.extract([
      { role: 'user', content: 'Nothing important' },
    ]);

    expect(result).toEqual([]);
  });
});
