import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

type StorageBackend = 'sqlite' | 'postgres';

interface PostgresConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
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
  };

  return config;
}
