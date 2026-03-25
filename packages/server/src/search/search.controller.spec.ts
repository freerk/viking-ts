import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { MatchedContextResponse, FindResult, GrepMatch } from './search.dto';

function makeMatchedContext(
  overrides?: Partial<MatchedContextResponse>,
): MatchedContextResponse {
  return {
    uri: 'viking://user/default/memories/test.md',
    parent_uri: 'viking://user/default/memories',
    context_type: 'memory',
    level: 2,
    abstract: 'Test memory abstract',
    name: 'test.md',
    description: '',
    tags: '',
    score: 0.85,
    active_count: 3,
    created_at: '2026-03-23T00:00:00.000Z',
    updated_at: '2026-03-23T00:00:00.000Z',
    ...overrides,
  };
}

function makeFindResult(contexts: MatchedContextResponse[] = []): FindResult {
  const memories: MatchedContextResponse[] = [];
  const resources: MatchedContextResponse[] = [];
  const skills: MatchedContextResponse[] = [];

  for (const ctx of contexts) {
    switch (ctx.context_type) {
      case 'memory':
        memories.push(ctx);
        break;
      case 'skill':
        skills.push(ctx);
        break;
      default:
        resources.push(ctx);
        break;
    }
  }

  return {
    memories,
    resources,
    skills,
    total: memories.length + resources.length + skills.length,
  };
}

function makeGrepMatch(overrides?: Partial<GrepMatch>): GrepMatch {
  return {
    uri: 'viking://resources/test.md',
    line_number: 5,
    line: 'matching line content',
    context_before: ['line 3', 'line 4'],
    context_after: ['line 6', 'line 7'],
    ...overrides,
  };
}

describe('SearchController', () => {
  let app: INestApplication;
  const mockService = {
    find: jest.fn(),
    search: jest.fn(),
    grep: jest.fn(),
    glob: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [{ provide: SearchService, useValue: mockService }],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/search/find', () => {
    it('should return 201 with memories/resources/skills shape', async () => {
      const findResult = makeFindResult([makeMatchedContext()]);
      mockService.find.mockResolvedValue(findResult);

      const res = await request(app.getHttpServer())
        .post('/api/v1/search/find')
        .send({ query: 'test search' })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.memories).toHaveLength(1);
      expect(res.body.result.resources).toHaveLength(0);
      expect(res.body.result.skills).toHaveLength(0);
      expect(res.body.result.total).toBe(1);
      expect(res.body.result.memories[0].uri).toBe(
        'viking://user/default/memories/test.md',
      );
      expect(res.body.time).toBeDefined();
    });

    it('should return mixed types in separate arrays', async () => {
      const findResult = makeFindResult([
        makeMatchedContext({ context_type: 'memory', uri: 'viking://user/default/memories/m.md' }),
        makeMatchedContext({ context_type: 'resource', uri: 'viking://resources/r.md' }),
        makeMatchedContext({ context_type: 'skill', uri: 'viking://agent/default/skills/s.md' }),
      ]);
      mockService.find.mockResolvedValue(findResult);

      const res = await request(app.getHttpServer())
        .post('/api/v1/search/find')
        .send({ query: 'test search' })
        .expect(201);

      expect(res.body.result.memories).toHaveLength(1);
      expect(res.body.result.resources).toHaveLength(1);
      expect(res.body.result.skills).toHaveLength(1);
      expect(res.body.result.total).toBe(3);
    });

    it('should pass options through to service', async () => {
      mockService.find.mockResolvedValue(makeFindResult());

      await request(app.getHttpServer())
        .post('/api/v1/search/find')
        .send({
          query: 'test',
          target_uri: 'viking://resources',
          limit: 10,
          score_threshold: 0.5,
        })
        .expect(201);

      expect(mockService.find).toHaveBeenCalledWith({
        query: 'test',
        targetDirectories: ['viking://resources'],
        limit: 10,
        scoreThreshold: 0.5,
      });
    });

    it('should reject missing query', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/search/find')
        .send({})
        .expect(400);
    });

    it('should reject unknown fields', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/search/find')
        .send({ query: 'test', badField: 'nope' })
        .expect(400);
    });
  });

  describe('POST /api/v1/search/search', () => {
    it('should return FindResult shape with session support', async () => {
      const findResult = makeFindResult([makeMatchedContext()]);
      mockService.search.mockResolvedValue(findResult);

      const res = await request(app.getHttpServer())
        .post('/api/v1/search/search')
        .send({ query: 'test', session_id: 'sess-1' })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.memories).toHaveLength(1);
      expect(res.body.result.total).toBe(1);

      expect(mockService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'test',
          sessionId: 'sess-1',
        }),
      );
    });

    it('should work without session_id', async () => {
      mockService.search.mockResolvedValue(makeFindResult());

      const res = await request(app.getHttpServer())
        .post('/api/v1/search/search')
        .send({ query: 'test' })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.memories).toHaveLength(0);
      expect(res.body.result.resources).toHaveLength(0);
      expect(res.body.result.skills).toHaveLength(0);
    });
  });

  describe('POST /api/v1/search/grep', () => {
    it('should return matches', async () => {
      const matches = [makeGrepMatch()];
      mockService.grep.mockResolvedValue(matches);

      const res = await request(app.getHttpServer())
        .post('/api/v1/search/grep')
        .send({ uri: 'viking://resources', pattern: 'test' })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.matches).toHaveLength(1);
      expect(res.body.result.matches[0].line_number).toBe(5);
    });

    it('should reject missing uri', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/search/grep')
        .send({ pattern: 'test' })
        .expect(400);
    });

    it('should reject missing pattern', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/search/grep')
        .send({ uri: 'viking://resources' })
        .expect(400);
    });
  });

  describe('POST /api/v1/search/glob', () => {
    it('should return matched URIs', async () => {
      mockService.glob.mockResolvedValue([
        'viking://user/default/memories/note1.md',
        'viking://user/default/memories/note2.md',
      ]);

      const res = await request(app.getHttpServer())
        .post('/api/v1/search/glob')
        .send({ pattern: 'viking://user/*/memories/*.md' })
        .expect(201);

      expect(res.body.status).toBe('ok');
      expect(res.body.result.matches).toHaveLength(2);
    });

    it('should reject missing pattern', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/search/glob')
        .send({})
        .expect(400);
    });
  });
});
