import { loadConfig } from '../src/config';
import { join } from 'path';
import { homedir } from 'os';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all config-related env vars to get predictable defaults
    delete process.env['OPENVIKING_CONFIG_FILE'];
    delete process.env['VIKING_TS_CONFIG_FILE'];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return config without env vars (uses file config or defaults)', () => {
    delete process.env['HOST'];
    delete process.env['PORT'];
    delete process.env['STORAGE_PATH'];
    delete process.env['STORAGE_WORKSPACE'];
    delete process.env['EMBEDDING_PROVIDER'];
    delete process.env['EMBEDDING_MODEL'];
    delete process.env['EMBEDDING_API_KEY'];
    delete process.env['EMBEDDING_API_BASE'];
    delete process.env['EMBEDDING_DIMENSION'];
    delete process.env['VLM_PROVIDER'];
    delete process.env['VLM_MODEL'];
    delete process.env['VLM_API_KEY'];
    delete process.env['VLM_API_BASE'];
    delete process.env['LLM_PROVIDER'];
    delete process.env['LLM_MODEL'];
    delete process.env['LLM_API_KEY'];
    delete process.env['LLM_API_BASE'];

    const config = loadConfig();

    expect(config.server.port).toBe(1934);
    expect(config.storage.path).toBe(join(homedir(), '.viking-ts/data'));
    expect(config.embedding.provider).toBe('openai');
    expect(config.vlm.provider).toBe('openai');
  });

  it('should use VLM_* environment variables when set', () => {
    process.env['HOST'] = '0.0.0.0';
    process.env['PORT'] = '8080';
    process.env['STORAGE_PATH'] = '/tmp/viking-test';
    process.env['EMBEDDING_PROVIDER'] = 'custom';
    process.env['EMBEDDING_MODEL'] = 'custom-model';
    process.env['EMBEDDING_API_KEY'] = 'test-key';
    process.env['EMBEDDING_API_BASE'] = 'http://localhost:11434';
    process.env['EMBEDDING_DIMENSION'] = '768';
    process.env['VLM_PROVIDER'] = 'ollama';
    process.env['VLM_MODEL'] = 'llama3';
    process.env['VLM_API_KEY'] = 'vlm-key';
    process.env['VLM_API_BASE'] = 'http://localhost:11434';

    const config = loadConfig();

    expect(config.server.host).toBe('0.0.0.0');
    expect(config.server.port).toBe(8080);
    expect(config.storage.path).toBe('/tmp/viking-test');
    expect(config.embedding.provider).toBe('custom');
    expect(config.embedding.model).toBe('custom-model');
    expect(config.embedding.apiKey).toBe('test-key');
    expect(config.embedding.apiBase).toBe('http://localhost:11434');
    expect(config.embedding.dimension).toBe(768);
    expect(config.vlm.provider).toBe('ollama');
    expect(config.vlm.model).toBe('llama3');
    expect(config.vlm.apiKey).toBe('vlm-key');
    expect(config.vlm.apiBase).toBe('http://localhost:11434');
  });

  it('should fall back to LLM_* env vars when VLM_* are not set', () => {
    delete process.env['VLM_PROVIDER'];
    delete process.env['VLM_MODEL'];
    delete process.env['VLM_API_KEY'];
    delete process.env['VLM_API_BASE'];
    process.env['LLM_PROVIDER'] = 'anthropic';
    process.env['LLM_MODEL'] = 'claude-3-haiku';
    process.env['LLM_API_KEY'] = 'llm-legacy-key';
    process.env['LLM_API_BASE'] = 'https://api.anthropic.com';

    const config = loadConfig();

    expect(config.vlm.provider).toBe('anthropic');
    expect(config.vlm.model).toBe('claude-3-haiku');
    expect(config.vlm.apiKey).toBe('llm-legacy-key');
    expect(config.vlm.apiBase).toBe('https://api.anthropic.com');
  });

  it('should prefer VLM_* over LLM_* env vars', () => {
    process.env['VLM_PROVIDER'] = 'openai';
    process.env['LLM_PROVIDER'] = 'anthropic';

    const config = loadConfig();

    expect(config.vlm.provider).toBe('openai');
  });

  it('should resolve tilde in storage path', () => {
    delete process.env['STORAGE_PATH'];
    delete process.env['STORAGE_WORKSPACE'];
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

  describe('VLM new fields', () => {
    it('should return correct VLM defaults', () => {
      const config = loadConfig();
      expect(config.vlm.thinking).toBe(false);
      expect(config.vlm.maxConcurrent).toBe(100);
      expect(config.vlm.extraHeaders).toEqual({});
      expect(config.vlm.stream).toBe(false);
    });

    it('should parse VLM_THINKING env var', () => {
      process.env['VLM_THINKING'] = 'true';
      const config = loadConfig();
      expect(config.vlm.thinking).toBe(true);
    });

    it('should parse VLM_MAX_CONCURRENT env var', () => {
      process.env['VLM_MAX_CONCURRENT'] = '50';
      const config = loadConfig();
      expect(config.vlm.maxConcurrent).toBe(50);
    });

    it('should parse VLM_STREAM env var', () => {
      process.env['VLM_STREAM'] = 'true';
      const config = loadConfig();
      expect(config.vlm.stream).toBe(true);
    });

    it('should parse VLM_EXTRA_HEADERS as JSON', () => {
      process.env['VLM_EXTRA_HEADERS'] = '{"X-Custom":"value"}';
      const config = loadConfig();
      expect(config.vlm.extraHeaders).toEqual({ 'X-Custom': 'value' });
    });

    it('should fall back to empty object for invalid VLM_EXTRA_HEADERS', () => {
      process.env['VLM_EXTRA_HEADERS'] = 'not-json';
      const config = loadConfig();
      expect(config.vlm.extraHeaders).toEqual({});
    });
  });

  describe('embedding new fields', () => {
    it('should return correct embedding defaults', () => {
      const config = loadConfig();
      expect(config.embedding.input).toBe('text');
      expect(config.embedding.batchSize).toBe(32);
      expect(config.embedding.maxConcurrent).toBe(10);
    });

    it('should use EMBEDDING_INPUT env var', () => {
      process.env['EMBEDDING_INPUT'] = 'multimodal';
      const config = loadConfig();
      expect(config.embedding.input).toBe('multimodal');
    });

    it('should use EMBEDDING_BATCH_SIZE env var', () => {
      process.env['EMBEDDING_BATCH_SIZE'] = '64';
      const config = loadConfig();
      expect(config.embedding.batchSize).toBe(64);
    });

    it('should use EMBEDDING_MAX_CONCURRENT env var', () => {
      process.env['EMBEDDING_MAX_CONCURRENT'] = '20';
      const config = loadConfig();
      expect(config.embedding.maxConcurrent).toBe(20);
    });
  });

  describe('server new fields', () => {
    it('should return correct server defaults', () => {
      const config = loadConfig();
      expect(config.server.rootApiKey).toBe('');
      expect(config.server.corsOrigins).toEqual(['*']);
    });

    it('should use ROOT_API_KEY env var', () => {
      process.env['ROOT_API_KEY'] = 'secret-key-123';
      const config = loadConfig();
      expect(config.server.rootApiKey).toBe('secret-key-123');
    });

    it('should parse CORS_ORIGINS as comma-separated list', () => {
      process.env['CORS_ORIGINS'] = 'http://localhost:3000,https://example.com';
      const config = loadConfig();
      expect(config.server.corsOrigins).toEqual([
        'http://localhost:3000',
        'https://example.com',
      ]);
    });
  });

  describe('storage.workspace alias', () => {
    it('should use STORAGE_WORKSPACE env var as alias for STORAGE_PATH', () => {
      delete process.env['STORAGE_PATH'];
      process.env['STORAGE_WORKSPACE'] = '/tmp/workspace-test';
      const config = loadConfig();
      expect(config.storage.path).toBe('/tmp/workspace-test');
    });

    it('should prefer STORAGE_WORKSPACE over STORAGE_PATH', () => {
      process.env['STORAGE_WORKSPACE'] = '/tmp/workspace';
      process.env['STORAGE_PATH'] = '/tmp/path';
      const config = loadConfig();
      expect(config.storage.path).toBe('/tmp/workspace');
    });
  });

  describe('config file with embedding.dense (OpenViking shape)', () => {
    const tmpConfigDir = join(tmpdir(), 'viking-config-test-' + process.pid);
    const tmpConfigPath = join(tmpConfigDir, 'config.json');

    beforeEach(() => {
      if (!existsSync(tmpConfigDir)) {
        mkdirSync(tmpConfigDir, { recursive: true });
      }
    });

    afterEach(() => {
      if (existsSync(tmpConfigDir)) {
        rmSync(tmpConfigDir, { recursive: true, force: true });
      }
    });

    it('should read embedding from nested dense structure with snake_case api_key', () => {
      writeFileSync(tmpConfigPath, JSON.stringify({
        embedding: {
          dense: {
            provider: 'openai',
            api_key: 'dense-key',
            model: 'text-embedding-3-large',
            dimension: 1024,
          },
        },
      }));
      process.env['VIKING_TS_CONFIG_FILE'] = tmpConfigPath;
      delete process.env['EMBEDDING_PROVIDER'];
      delete process.env['EMBEDDING_MODEL'];
      delete process.env['EMBEDDING_API_KEY'];
      delete process.env['EMBEDDING_DIMENSION'];

      const config = loadConfig();
      expect(config.embedding.provider).toBe('openai');
      expect(config.embedding.apiKey).toBe('dense-key');
      expect(config.embedding.model).toBe('text-embedding-3-large');
      expect(config.embedding.dimension).toBe(1024);
    });

    it('should read vlm from legacy llm key in config file', () => {
      writeFileSync(tmpConfigPath, JSON.stringify({
        llm: {
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          apiKey: 'llm-file-key',
          apiBase: 'https://api.anthropic.com',
        },
      }));
      process.env['VIKING_TS_CONFIG_FILE'] = tmpConfigPath;
      delete process.env['VLM_PROVIDER'];
      delete process.env['VLM_MODEL'];
      delete process.env['VLM_API_KEY'];
      delete process.env['VLM_API_BASE'];
      delete process.env['LLM_PROVIDER'];
      delete process.env['LLM_MODEL'];
      delete process.env['LLM_API_KEY'];
      delete process.env['LLM_API_BASE'];

      const config = loadConfig();
      expect(config.vlm.provider).toBe('anthropic');
      expect(config.vlm.model).toBe('claude-3-sonnet');
      expect(config.vlm.apiKey).toBe('llm-file-key');
    });

    it('should prefer vlm key over llm key in config file', () => {
      writeFileSync(tmpConfigPath, JSON.stringify({
        vlm: { provider: 'openai', model: 'gpt-4o' },
        llm: { provider: 'anthropic', model: 'claude-3' },
      }));
      process.env['VIKING_TS_CONFIG_FILE'] = tmpConfigPath;
      delete process.env['VLM_PROVIDER'];
      delete process.env['VLM_MODEL'];
      delete process.env['LLM_PROVIDER'];
      delete process.env['LLM_MODEL'];

      const config = loadConfig();
      expect(config.vlm.provider).toBe('openai');
      expect(config.vlm.model).toBe('gpt-4o');
    });

    it('should read storage.workspace from config file', () => {
      writeFileSync(tmpConfigPath, JSON.stringify({
        storage: { workspace: '/data/viking' },
      }));
      process.env['VIKING_TS_CONFIG_FILE'] = tmpConfigPath;
      delete process.env['STORAGE_PATH'];
      delete process.env['STORAGE_WORKSPACE'];

      const config = loadConfig();
      expect(config.storage.path).toBe('/data/viking');
    });

    it('should accept storage.agfs key without error', () => {
      writeFileSync(tmpConfigPath, JSON.stringify({
        storage: {
          workspace: '/data/viking',
          agfs: { some: 'value' },
          vectordb: { some: 'value' },
        },
      }));
      process.env['VIKING_TS_CONFIG_FILE'] = tmpConfigPath;
      delete process.env['STORAGE_PATH'];
      delete process.env['STORAGE_WORKSPACE'];

      const config = loadConfig();
      expect(config.storage.path).toBe('/data/viking');
    });
  });

  describe('config file path resolution', () => {
    const tmpConfigDir = join(tmpdir(), 'viking-resolve-test-' + process.pid);

    beforeEach(() => {
      if (!existsSync(tmpConfigDir)) {
        mkdirSync(tmpConfigDir, { recursive: true });
      }
    });

    afterEach(() => {
      if (existsSync(tmpConfigDir)) {
        rmSync(tmpConfigDir, { recursive: true, force: true });
      }
    });

    it('should respect OPENVIKING_CONFIG_FILE env var', () => {
      const configPath = join(tmpConfigDir, 'ov.conf');
      writeFileSync(configPath, JSON.stringify({
        vlm: { provider: 'anthropic', model: 'claude-3' },
      }));
      process.env['OPENVIKING_CONFIG_FILE'] = configPath;
      delete process.env['VLM_PROVIDER'];
      delete process.env['VLM_MODEL'];
      delete process.env['LLM_PROVIDER'];
      delete process.env['LLM_MODEL'];

      const config = loadConfig();
      expect(config.vlm.provider).toBe('anthropic');
      expect(config.vlm.model).toBe('claude-3');
    });

    it('should prefer OPENVIKING_CONFIG_FILE over VIKING_TS_CONFIG_FILE', () => {
      const ovPath = join(tmpConfigDir, 'ov.conf');
      const vtPath = join(tmpConfigDir, 'config.json');
      writeFileSync(ovPath, JSON.stringify({ vlm: { model: 'ov-model' } }));
      writeFileSync(vtPath, JSON.stringify({ vlm: { model: 'vt-model' } }));
      process.env['OPENVIKING_CONFIG_FILE'] = ovPath;
      process.env['VIKING_TS_CONFIG_FILE'] = vtPath;
      delete process.env['VLM_MODEL'];
      delete process.env['LLM_MODEL'];

      const config = loadConfig();
      expect(config.vlm.model).toBe('ov-model');
    });
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
