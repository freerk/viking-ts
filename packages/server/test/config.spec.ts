import { loadConfig } from '../src/config';
import { join } from 'path';
import { homedir } from 'os';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return config without env vars (uses file config or defaults)', () => {
    delete process.env['HOST'];
    delete process.env['PORT'];
    delete process.env['STORAGE_PATH'];
    delete process.env['EMBEDDING_PROVIDER'];
    delete process.env['EMBEDDING_MODEL'];
    delete process.env['EMBEDDING_API_KEY'];
    delete process.env['EMBEDDING_API_BASE'];
    delete process.env['EMBEDDING_DIMENSION'];
    delete process.env['LLM_PROVIDER'];
    delete process.env['LLM_MODEL'];
    delete process.env['LLM_API_KEY'];
    delete process.env['LLM_API_BASE'];

    const config = loadConfig();

    expect(config.server.port).toBe(1934);
    expect(config.storage.path).toBe(join(homedir(), '.viking-ts/data'));
    expect(config.embedding.provider).toBe('openai');
    expect(config.llm.provider).toBe('openai');
  });

  it('should use environment variables when set', () => {
    process.env['HOST'] = '0.0.0.0';
    process.env['PORT'] = '8080';
    process.env['STORAGE_PATH'] = '/tmp/viking-test';
    process.env['EMBEDDING_PROVIDER'] = 'custom';
    process.env['EMBEDDING_MODEL'] = 'custom-model';
    process.env['EMBEDDING_API_KEY'] = 'test-key';
    process.env['EMBEDDING_API_BASE'] = 'http://localhost:11434';
    process.env['EMBEDDING_DIMENSION'] = '768';
    process.env['LLM_PROVIDER'] = 'ollama';
    process.env['LLM_MODEL'] = 'llama3';
    process.env['LLM_API_KEY'] = 'llm-key';
    process.env['LLM_API_BASE'] = 'http://localhost:11434';

    const config = loadConfig();

    expect(config.server.host).toBe('0.0.0.0');
    expect(config.server.port).toBe(8080);
    expect(config.storage.path).toBe('/tmp/viking-test');
    expect(config.embedding.provider).toBe('custom');
    expect(config.embedding.model).toBe('custom-model');
    expect(config.embedding.apiKey).toBe('test-key');
    expect(config.embedding.apiBase).toBe('http://localhost:11434');
    expect(config.embedding.dimension).toBe(768);
    expect(config.llm.provider).toBe('ollama');
    expect(config.llm.model).toBe('llama3');
    expect(config.llm.apiKey).toBe('llm-key');
    expect(config.llm.apiBase).toBe('http://localhost:11434');
  });

  it('should resolve tilde in storage path', () => {
    delete process.env['STORAGE_PATH'];
    const config = loadConfig();
    expect(config.storage.path).not.toContain('~');
    expect(config.storage.path).toContain(homedir());
  });

  it('should handle invalid PORT gracefully by falling back to default', () => {
    process.env['PORT'] = 'not-a-number';
    const config = loadConfig();
    expect(config.server.port).toBe(1934);
  });

  it('should handle invalid EMBEDDING_DIMENSION by falling back to file config or default', () => {
    process.env['EMBEDDING_DIMENSION'] = 'bad';
    const config = loadConfig();
    expect(typeof config.embedding.dimension).toBe('number');
    expect(config.embedding.dimension).toBeGreaterThan(0);
  });

  describe('semantic config defaults match OpenViking SemanticConfig', () => {
    it('should return correct semantic defaults', () => {
      const config = loadConfig();
      expect(config.semantic.maxFileContentChars).toBe(30000);
      expect(config.semantic.maxOverviewPromptChars).toBe(60000);
      expect(config.semantic.overviewBatchSize).toBe(50);
      expect(config.semantic.abstractMaxChars).toBe(256);
      expect(config.semantic.overviewMaxChars).toBe(4000);
      expect(config.semantic.memoryChunkChars).toBe(2000);
      expect(config.semantic.memoryChunkOverlap).toBe(200);
    });

    it('should use SEMANTIC_* env vars when set', () => {
      process.env['SEMANTIC_MAX_FILE_CONTENT_CHARS'] = '50000';
      process.env['SEMANTIC_MAX_OVERVIEW_PROMPT_CHARS'] = '80000';
      process.env['SEMANTIC_OVERVIEW_BATCH_SIZE'] = '100';
      process.env['SEMANTIC_ABSTRACT_MAX_CHARS'] = '512';
      process.env['SEMANTIC_OVERVIEW_MAX_CHARS'] = '8000';
      process.env['SEMANTIC_MEMORY_CHUNK_CHARS'] = '4000';
      process.env['SEMANTIC_MEMORY_CHUNK_OVERLAP'] = '400';

      const config = loadConfig();
      expect(config.semantic.maxFileContentChars).toBe(50000);
      expect(config.semantic.maxOverviewPromptChars).toBe(80000);
      expect(config.semantic.overviewBatchSize).toBe(100);
      expect(config.semantic.abstractMaxChars).toBe(512);
      expect(config.semantic.overviewMaxChars).toBe(8000);
      expect(config.semantic.memoryChunkChars).toBe(4000);
      expect(config.semantic.memoryChunkOverlap).toBe(400);
    });
  });

  describe('search config defaults', () => {
    it('should return correct search defaults', () => {
      const config = loadConfig();
      expect(config.defaultSearchMode).toBe('thinking');
      expect(config.defaultSearchLimit).toBe(3);
    });

    it('should use DEFAULT_SEARCH_* env vars when set', () => {
      process.env['DEFAULT_SEARCH_MODE'] = 'fast';
      process.env['DEFAULT_SEARCH_LIMIT'] = '10';

      const config = loadConfig();
      expect(config.defaultSearchMode).toBe('fast');
      expect(config.defaultSearchLimit).toBe(10);
    });
  });

  describe('rerank config defaults', () => {
    it('should return empty rerank config by default', () => {
      const config = loadConfig();
      expect(config.rerank.model).toBe('');
      expect(config.rerank.apiKey).toBe('');
      expect(config.rerank.apiBase).toBe('');
      expect(config.rerank.threshold).toBe(0);
    });

    it('should use RERANK_* env vars when set', () => {
      process.env['RERANK_MODEL'] = 'cohere-rerank-v3';
      process.env['RERANK_API_KEY'] = 'rk-test';
      process.env['RERANK_API_BASE'] = 'https://rerank.example.com';
      process.env['RERANK_THRESHOLD'] = '0.5';

      const config = loadConfig();
      expect(config.rerank.model).toBe('cohere-rerank-v3');
      expect(config.rerank.apiKey).toBe('rk-test');
      expect(config.rerank.apiBase).toBe('https://rerank.example.com');
      expect(config.rerank.threshold).toBe(0.5);
    });
  });
});
