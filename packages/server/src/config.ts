import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

type StorageBackend = 'sqlite' | 'postgres';
type SearchMode = 'thinking' | 'fast';

interface PostgresConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

interface SemanticConfig {
  maxFileContentChars: number;
  maxOverviewPromptChars: number;
  overviewBatchSize: number;
  abstractMaxChars: number;
  overviewMaxChars: number;
  memoryChunkChars: number;
  memoryChunkOverlap: number;
}

interface RerankConfig {
  model: string;
  apiKey: string;
  apiBase: string;
  threshold: number;
}

export interface VikingConfig {
  server: {
    host: string;
    port: number;
    rootApiKey: string;
    corsOrigins: string[];
  };
  storage: {
    path: string;
    backend: StorageBackend;
    postgres: PostgresConfig;
  };
  embedding: {
    provider: string;
    model: string;
    apiKey: string;
    apiBase: string;
    dimension: number;
    input: string;
    batchSize: number;
    maxConcurrent: number;
  };
  vlm: {
    provider: string;
    model: string;
    apiKey: string;
    apiBase: string;
    thinking: boolean;
    maxConcurrent: number;
    extraHeaders: Record<string, string>;
    stream: boolean;
  };
  transcription: {
    provider: string;
    apiKey: string;
    apiBase: string;
    model: string;
  };
  semantic: SemanticConfig;
  rerank: RerankConfig;
  defaultSearchMode: SearchMode;
  defaultSearchLimit: number;
}

function resolveStoragePath(raw: string): string {
  if (raw.startsWith('~')) {
    return join(homedir(), raw.slice(1));
  }
  return raw;
}

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function parseCorsOrigins(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseExtraHeaders(raw: string | undefined, fallback: Record<string, string>): Record<string, string> {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Resolve config file path. Check in order:
 * 1. OPENVIKING_CONFIG_FILE env var
 * 2. VIKING_TS_CONFIG_FILE env var
 * 3. ~/.viking-ts/config.json
 * 4. ~/.openviking/ov.conf (OpenViking fallback)
 */
function resolveConfigFilePath(): string | undefined {
  const envOpenViking = process.env['OPENVIKING_CONFIG_FILE'];
  if (envOpenViking && existsSync(envOpenViking)) return envOpenViking;

  const envVikingTs = process.env['VIKING_TS_CONFIG_FILE'];
  if (envVikingTs && existsSync(envVikingTs)) return envVikingTs;

  const defaultPath = join(homedir(), '.viking-ts', 'config.json');
  if (existsSync(defaultPath)) return defaultPath;

  const ovPath = join(homedir(), '.openviking', 'ov.conf');
  if (existsSync(ovPath)) return ovPath;

  return undefined;
}

/**
 * Read embedding config from file, supporting both flat and nested `dense` shapes.
 * Also supports snake_case `api_key` from OpenViking configs.
 */
function resolveEmbeddingFromFile(
  fileEmbedding: Record<string, unknown> | undefined,
): Partial<VikingConfig['embedding']> {
  if (!fileEmbedding) return {};

  const dense = fileEmbedding['dense'] as Record<string, unknown> | undefined;
  const source = dense ?? fileEmbedding;

  return {
    provider: asString(source['provider']),
    model: asString(source['model']),
    apiKey: asString(source['apiKey'] ?? source['api_key']),
    apiBase: asString(source['apiBase'] ?? source['api_base']),
    dimension: asNumber(source['dimension']),
    input: asString(source['input']),
    batchSize: asNumber(source['batchSize'] ?? source['batch_size']),
    maxConcurrent: asNumber(source['maxConcurrent'] ?? source['max_concurrent']),
  };
}

/**
 * Read VLM config from file, supporting both `vlm` and legacy `llm` keys.
 * Also supports snake_case keys from OpenViking configs.
 */
function resolveVlmFromFile(
  fileConfig: Record<string, unknown>,
): Partial<VikingConfig['vlm']> {
  const vlmRaw = fileConfig['vlm'] as Record<string, unknown> | undefined;
  const llmRaw = fileConfig['llm'] as Record<string, unknown> | undefined;
  const source = vlmRaw ?? llmRaw;
  if (!source) return {};

  return {
    provider: asString(source['provider']),
    model: asString(source['model']),
    apiKey: asString(source['apiKey'] ?? source['api_key']),
    apiBase: asString(source['apiBase'] ?? source['api_base']),
    thinking: asBool(source['thinking']),
    maxConcurrent: asNumber(source['maxConcurrent'] ?? source['max_concurrent']),
    extraHeaders: asHeaders(source['extraHeaders'] ?? source['extra_headers']),
    stream: asBool(source['stream']),
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  return undefined;
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  return undefined;
}

function asHeaders(v: unknown): Record<string, string> | undefined {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return v as Record<string, string>;
  }
  return undefined;
}

export function loadConfig(): VikingConfig {
  const defaults: VikingConfig = {
    server: {
      host: '127.0.0.1',
      port: 1934,
      rootApiKey: '',
      corsOrigins: ['*'],
    },
    storage: {
      path: '~/.viking-ts/data',
      backend: 'sqlite' as StorageBackend,
      postgres: {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: '',
        database: 'viking_ts',
      },
    },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: '',
      apiBase: 'https://api.openai.com/v1',
      dimension: 1536,
      input: 'text',
      batchSize: 32,
      maxConcurrent: 10,
    },
    vlm: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: '',
      apiBase: 'https://api.openai.com/v1',
      thinking: false,
      maxConcurrent: 100,
      extraHeaders: {},
      stream: false,
    },
    semantic: {
      maxFileContentChars: 30000,
      maxOverviewPromptChars: 60000,
      overviewBatchSize: 50,
      abstractMaxChars: 256,
      overviewMaxChars: 4000,
      memoryChunkChars: 2000,
      memoryChunkOverlap: 200,
    },
    transcription: {
      provider: 'openai',
      apiKey: '',
      apiBase: 'https://api.openai.com/v1',
      model: 'whisper-1',
    },
    rerank: {
      model: '',
      apiKey: '',
      apiBase: '',
      threshold: 0,
    },
    defaultSearchMode: 'thinking' as SearchMode,
    defaultSearchLimit: 3,
  };

  const configPath = resolveConfigFilePath();
  let fileConfig: Record<string, unknown> = {};

  if (configPath) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* ignore malformed config */
    }
  }

  const fileServer = fileConfig['server'] as Record<string, unknown> | undefined;
  const fileStorage = fileConfig['storage'] as Record<string, unknown> | undefined;
  const fileEmbedding = fileConfig['embedding'] as Record<string, unknown> | undefined;
  const fileSemantic = fileConfig['semantic'] as Record<string, unknown> | undefined;
  const fileRerank = fileConfig['rerank'] as Record<string, unknown> | undefined;
  const fileTranscription = fileConfig['transcription'] as Record<string, unknown> | undefined;

  const embFromFile = resolveEmbeddingFromFile(fileEmbedding);
  const vlmFromFile = resolveVlmFromFile(fileConfig);

  // Storage: support `workspace` as alias for `path`
  const fileStoragePath =
    asString(fileStorage?.['workspace']) ??
    asString(fileStorage?.['path']);

  const config: VikingConfig = {
    server: {
      host:
        process.env['HOST'] ??
        asString(fileServer?.['host']) ??
        defaults.server.host,
      port: parseInt(process.env['PORT'] ?? '', 10) ||
        (asNumber(fileServer?.['port']) ?? defaults.server.port),
      rootApiKey:
        process.env['ROOT_API_KEY'] ??
        asString(fileServer?.['rootApiKey'] ?? fileServer?.['root_api_key']) ??
        defaults.server.rootApiKey,
      corsOrigins: parseCorsOrigins(
        process.env['CORS_ORIGINS'],
        (fileServer?.['corsOrigins'] ?? fileServer?.['cors_origins']) as string[] | undefined
          ?? defaults.server.corsOrigins,
      ),
    },
    storage: {
      path: resolveStoragePath(
        process.env['STORAGE_WORKSPACE'] ??
          process.env['STORAGE_PATH'] ??
          fileStoragePath ??
          defaults.storage.path,
      ),
      backend: (process.env['STORAGE_BACKEND'] ??
        asString(fileStorage?.['backend']) ??
        defaults.storage.backend) as StorageBackend,
      postgres: {
        host:
          process.env['DB_HOST'] ??
          asString((fileStorage?.['postgres'] as Record<string, unknown> | undefined)?.['host']) ??
          defaults.storage.postgres.host,
        port:
          parseInt(process.env['DB_PORT'] ?? '', 10) ||
          (asNumber((fileStorage?.['postgres'] as Record<string, unknown> | undefined)?.['port']) ?? defaults.storage.postgres.port),
        username:
          process.env['DB_USERNAME'] ??
          asString((fileStorage?.['postgres'] as Record<string, unknown> | undefined)?.['username']) ??
          defaults.storage.postgres.username,
        password:
          process.env['DB_PASSWORD'] ??
          asString((fileStorage?.['postgres'] as Record<string, unknown> | undefined)?.['password']) ??
          defaults.storage.postgres.password,
        database:
          process.env['DB_DATABASE'] ??
          asString((fileStorage?.['postgres'] as Record<string, unknown> | undefined)?.['database']) ??
          defaults.storage.postgres.database,
      },
    },
    embedding: {
      provider:
        process.env['EMBEDDING_PROVIDER'] ??
        embFromFile.provider ??
        defaults.embedding.provider,
      model:
        process.env['EMBEDDING_MODEL'] ??
        embFromFile.model ??
        defaults.embedding.model,
      apiKey:
        process.env['EMBEDDING_API_KEY'] ??
        embFromFile.apiKey ??
        defaults.embedding.apiKey,
      apiBase:
        process.env['EMBEDDING_API_BASE'] ??
        embFromFile.apiBase ??
        defaults.embedding.apiBase,
      dimension:
        parseInt(process.env['EMBEDDING_DIMENSION'] ?? '', 10) ||
        (embFromFile.dimension ?? defaults.embedding.dimension),
      input:
        process.env['EMBEDDING_INPUT'] ??
        embFromFile.input ??
        defaults.embedding.input,
      batchSize:
        parseInt(process.env['EMBEDDING_BATCH_SIZE'] ?? '', 10) ||
        (embFromFile.batchSize ?? defaults.embedding.batchSize),
      maxConcurrent:
        parseInt(process.env['EMBEDDING_MAX_CONCURRENT'] ?? '', 10) ||
        (embFromFile.maxConcurrent ?? defaults.embedding.maxConcurrent),
    },
    vlm: {
      provider:
        process.env['VLM_PROVIDER'] ?? process.env['LLM_PROVIDER'] ??
        vlmFromFile.provider ??
        defaults.vlm.provider,
      model:
        process.env['VLM_MODEL'] ?? process.env['LLM_MODEL'] ??
        vlmFromFile.model ??
        defaults.vlm.model,
      apiKey:
        process.env['VLM_API_KEY'] ?? process.env['LLM_API_KEY'] ??
        vlmFromFile.apiKey ??
        defaults.vlm.apiKey,
      apiBase:
        process.env['VLM_API_BASE'] ?? process.env['LLM_API_BASE'] ??
        vlmFromFile.apiBase ??
        defaults.vlm.apiBase,
      thinking: parseBoolEnv(
        process.env['VLM_THINKING'],
        vlmFromFile.thinking ?? defaults.vlm.thinking,
      ),
      maxConcurrent:
        parseInt(process.env['VLM_MAX_CONCURRENT'] ?? '', 10) ||
        (vlmFromFile.maxConcurrent ?? defaults.vlm.maxConcurrent),
      extraHeaders: parseExtraHeaders(
        process.env['VLM_EXTRA_HEADERS'],
        vlmFromFile.extraHeaders ?? defaults.vlm.extraHeaders,
      ),
      stream: parseBoolEnv(
        process.env['VLM_STREAM'],
        vlmFromFile.stream ?? defaults.vlm.stream,
      ),
    },
    semantic: {
      maxFileContentChars:
        parseInt(process.env['SEMANTIC_MAX_FILE_CONTENT_CHARS'] ?? '', 10) ||
        (asNumber(fileSemantic?.['maxFileContentChars']) ?? defaults.semantic.maxFileContentChars),
      maxOverviewPromptChars:
        parseInt(process.env['SEMANTIC_MAX_OVERVIEW_PROMPT_CHARS'] ?? '', 10) ||
        (asNumber(fileSemantic?.['maxOverviewPromptChars']) ?? defaults.semantic.maxOverviewPromptChars),
      overviewBatchSize:
        parseInt(process.env['SEMANTIC_OVERVIEW_BATCH_SIZE'] ?? '', 10) ||
        (asNumber(fileSemantic?.['overviewBatchSize']) ?? defaults.semantic.overviewBatchSize),
      abstractMaxChars:
        parseInt(process.env['SEMANTIC_ABSTRACT_MAX_CHARS'] ?? '', 10) ||
        (asNumber(fileSemantic?.['abstractMaxChars']) ?? defaults.semantic.abstractMaxChars),
      overviewMaxChars:
        parseInt(process.env['SEMANTIC_OVERVIEW_MAX_CHARS'] ?? '', 10) ||
        (asNumber(fileSemantic?.['overviewMaxChars']) ?? defaults.semantic.overviewMaxChars),
      memoryChunkChars:
        parseInt(process.env['SEMANTIC_MEMORY_CHUNK_CHARS'] ?? '', 10) ||
        (asNumber(fileSemantic?.['memoryChunkChars']) ?? defaults.semantic.memoryChunkChars),
      memoryChunkOverlap:
        parseInt(process.env['SEMANTIC_MEMORY_CHUNK_OVERLAP'] ?? '', 10) ||
        (asNumber(fileSemantic?.['memoryChunkOverlap']) ?? defaults.semantic.memoryChunkOverlap),
    },
    transcription: {
      provider:
        process.env['TRANSCRIPTION_PROVIDER'] ??
        asString(fileTranscription?.['provider']) ??
        defaults.transcription.provider,
      apiKey:
        process.env['TRANSCRIPTION_API_KEY'] ??
        asString(fileTranscription?.['apiKey'] ?? fileTranscription?.['api_key']) ??
        defaults.transcription.apiKey,
      apiBase:
        process.env['TRANSCRIPTION_API_BASE'] ??
        asString(fileTranscription?.['apiBase'] ?? fileTranscription?.['api_base']) ??
        defaults.transcription.apiBase,
      model:
        process.env['TRANSCRIPTION_MODEL'] ??
        asString(fileTranscription?.['model']) ??
        defaults.transcription.model,
    },
    rerank: {
      model:
        process.env['RERANK_MODEL'] ??
        asString(fileRerank?.['model']) ??
        defaults.rerank.model,
      apiKey:
        process.env['RERANK_API_KEY'] ??
        asString(fileRerank?.['apiKey'] ?? fileRerank?.['api_key']) ??
        defaults.rerank.apiKey,
      apiBase:
        process.env['RERANK_API_BASE'] ??
        asString(fileRerank?.['apiBase'] ?? fileRerank?.['api_base']) ??
        defaults.rerank.apiBase,
      threshold:
        parseFloat(process.env['RERANK_THRESHOLD'] ?? '') ||
        (asNumber(fileRerank?.['threshold']) ?? defaults.rerank.threshold),
    },
    defaultSearchMode: (
      process.env['DEFAULT_SEARCH_MODE'] ??
      asString(fileConfig['defaultSearchMode']) ??
      defaults.defaultSearchMode
    ) as SearchMode,
    defaultSearchLimit:
      parseInt(process.env['DEFAULT_SEARCH_LIMIT'] ?? '', 10) ||
      (asNumber(fileConfig['defaultSearchLimit']) ?? defaults.defaultSearchLimit),
  };

  return config;
}
