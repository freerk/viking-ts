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

interface VikingConfig {
  server: { host: string; port: number };
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
  };
  llm: {
    provider: string;
    model: string;
    apiKey: string;
    apiBase: string;
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

export function loadConfig(): VikingConfig {
  const defaults: VikingConfig = {
    server: {
      host: '127.0.0.1',
      port: 1934,
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
    },
    llm: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: '',
      apiBase: 'https://api.openai.com/v1',
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
    rerank: {
      model: '',
      apiKey: '',
      apiBase: '',
      threshold: 0,
    },
    defaultSearchMode: 'thinking' as SearchMode,
    defaultSearchLimit: 3,
  };

  const configPath = join(homedir(), '.viking-ts', 'config.json');
  let fileConfig: Partial<VikingConfig> = {};

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(raw) as Partial<VikingConfig>;
    } catch {
      /* ignore malformed config */
    }
  }

  const config: VikingConfig = {
    server: {
      host:
        process.env['HOST'] ??
        fileConfig.server?.host ??
        defaults.server.host,
      port: parseInt(process.env['PORT'] ?? '', 10) ||
        (fileConfig.server?.port ?? defaults.server.port),
    },
    storage: {
      path: resolveStoragePath(
        process.env['STORAGE_PATH'] ??
          fileConfig.storage?.path ??
          defaults.storage.path,
      ),
      backend: (process.env['STORAGE_BACKEND'] ??
        fileConfig.storage?.backend ??
        defaults.storage.backend) as StorageBackend,
      postgres: {
        host:
          process.env['DB_HOST'] ??
          fileConfig.storage?.postgres?.host ??
          defaults.storage.postgres.host,
        port:
          parseInt(process.env['DB_PORT'] ?? '', 10) ||
          (fileConfig.storage?.postgres?.port ?? defaults.storage.postgres.port),
        username:
          process.env['DB_USERNAME'] ??
          fileConfig.storage?.postgres?.username ??
          defaults.storage.postgres.username,
        password:
          process.env['DB_PASSWORD'] ??
          fileConfig.storage?.postgres?.password ??
          defaults.storage.postgres.password,
        database:
          process.env['DB_DATABASE'] ??
          fileConfig.storage?.postgres?.database ??
          defaults.storage.postgres.database,
      },
    },
    embedding: {
      provider:
        process.env['EMBEDDING_PROVIDER'] ??
        fileConfig.embedding?.provider ??
        defaults.embedding.provider,
      model:
        process.env['EMBEDDING_MODEL'] ??
        fileConfig.embedding?.model ??
        defaults.embedding.model,
      apiKey:
        process.env['EMBEDDING_API_KEY'] ??
        fileConfig.embedding?.apiKey ??
        defaults.embedding.apiKey,
      apiBase:
        process.env['EMBEDDING_API_BASE'] ??
        fileConfig.embedding?.apiBase ??
        defaults.embedding.apiBase,
      dimension:
        parseInt(process.env['EMBEDDING_DIMENSION'] ?? '', 10) ||
        (fileConfig.embedding?.dimension ?? defaults.embedding.dimension),
    },
    llm: {
      provider:
        process.env['LLM_PROVIDER'] ??
        fileConfig.llm?.provider ??
        defaults.llm.provider,
      model:
        process.env['LLM_MODEL'] ??
        fileConfig.llm?.model ??
        defaults.llm.model,
      apiKey:
        process.env['LLM_API_KEY'] ??
        fileConfig.llm?.apiKey ??
        defaults.llm.apiKey,
      apiBase:
        process.env['LLM_API_BASE'] ??
        fileConfig.llm?.apiBase ??
        defaults.llm.apiBase,
    },
    semantic: {
      maxFileContentChars:
        parseInt(process.env['SEMANTIC_MAX_FILE_CONTENT_CHARS'] ?? '', 10) ||
        (fileConfig.semantic?.maxFileContentChars ?? defaults.semantic.maxFileContentChars),
      maxOverviewPromptChars:
        parseInt(process.env['SEMANTIC_MAX_OVERVIEW_PROMPT_CHARS'] ?? '', 10) ||
        (fileConfig.semantic?.maxOverviewPromptChars ?? defaults.semantic.maxOverviewPromptChars),
      overviewBatchSize:
        parseInt(process.env['SEMANTIC_OVERVIEW_BATCH_SIZE'] ?? '', 10) ||
        (fileConfig.semantic?.overviewBatchSize ?? defaults.semantic.overviewBatchSize),
      abstractMaxChars:
        parseInt(process.env['SEMANTIC_ABSTRACT_MAX_CHARS'] ?? '', 10) ||
        (fileConfig.semantic?.abstractMaxChars ?? defaults.semantic.abstractMaxChars),
      overviewMaxChars:
        parseInt(process.env['SEMANTIC_OVERVIEW_MAX_CHARS'] ?? '', 10) ||
        (fileConfig.semantic?.overviewMaxChars ?? defaults.semantic.overviewMaxChars),
      memoryChunkChars:
        parseInt(process.env['SEMANTIC_MEMORY_CHUNK_CHARS'] ?? '', 10) ||
        (fileConfig.semantic?.memoryChunkChars ?? defaults.semantic.memoryChunkChars),
      memoryChunkOverlap:
        parseInt(process.env['SEMANTIC_MEMORY_CHUNK_OVERLAP'] ?? '', 10) ||
        (fileConfig.semantic?.memoryChunkOverlap ?? defaults.semantic.memoryChunkOverlap),
    },
    rerank: {
      model:
        process.env['RERANK_MODEL'] ??
        fileConfig.rerank?.model ??
        defaults.rerank.model,
      apiKey:
        process.env['RERANK_API_KEY'] ??
        fileConfig.rerank?.apiKey ??
        defaults.rerank.apiKey,
      apiBase:
        process.env['RERANK_API_BASE'] ??
        fileConfig.rerank?.apiBase ??
        defaults.rerank.apiBase,
      threshold:
        parseFloat(process.env['RERANK_THRESHOLD'] ?? '') ||
        (fileConfig.rerank?.threshold ?? defaults.rerank.threshold),
    },
    defaultSearchMode: (
      process.env['DEFAULT_SEARCH_MODE'] ??
      fileConfig.defaultSearchMode ??
      defaults.defaultSearchMode
    ) as SearchMode,
    defaultSearchLimit:
      parseInt(process.env['DEFAULT_SEARCH_LIMIT'] ?? '', 10) ||
      (fileConfig.defaultSearchLimit ?? defaults.defaultSearchLimit),
  };

  return config;
}
