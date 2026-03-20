# viking-ts

TypeScript-native context database for AI agents. A clean reimplementation of the core concepts from [OpenViking](https://github.com/volcengine/OpenViking), built entirely in TypeScript with zero Python/Rust/Go/C++ dependencies.

## Architecture

```
viking-ts/
├── packages/
│   ├── server/              # NestJS REST API (port 1934)
│   │   ├── src/
│   │   │   ├── memory/      # Memory CRUD + search + session capture
│   │   │   ├── resource/    # Resource storage + search
│   │   │   ├── viking-uri/  # viking:// URI resolution
│   │   │   ├── embedding/   # OpenAI-compatible embedding service
│   │   │   ├── llm/         # LLM service (L0/L1 generation, memory extraction)
│   │   │   ├── storage/     # vectra vector DB + SQLite metadata
│   │   │   ├── database/    # TypeORM entities, migrations, Postgres services
│   │   │   └── health/      # Health check endpoint
│   │   └── test/            # Jest tests
│   └── openclaw-plugin/     # OpenClaw context-engine plugin
│       ├── src/
│       │   ├── index.ts     # Plugin entry + context engine
│       │   ├── client.ts    # HTTP client with Zod validation
│       │   ├── process-manager.ts  # Local server lifecycle
│       │   └── text-utils.ts       # Capture sanitization + triggers
│       └── openclaw.plugin.json    # Plugin manifest
```

## Quick start

```bash
# Install dependencies
npm install

# Set API keys
export EMBEDDING_API_KEY=sk-your-key
export LLM_API_KEY=sk-your-key

# Start server
npm run start:dev

# Store a memory
curl -X POST http://localhost:1934/api/v1/memories \
  -H 'Content-Type: application/json' \
  -d '{"text": "User prefers TypeScript with strict mode", "category": "preferences"}'

# Search memories
curl 'http://localhost:1934/api/v1/memories/search?q=programming+language+preference'

# Capture a conversation
curl -X POST http://localhost:1934/api/v1/sessions/capture \
  -H 'Content-Type: application/json' \
  -d '{"messages": [{"role": "user", "content": "I always use dark mode"}, {"role": "assistant", "content": "Noted!"}]}'
```

## L0/L1/L2 tiered memory

Every memory and resource is stored with three tiers of detail:

- **L0 (Abstract)**: One-sentence summary (~50 tokens). Used for vector search and quick filtering.
- **L1 (Overview)**: Key points summary (~500 tokens). Loaded for context without full content.
- **L2 (Content)**: Full original text. Fetched on demand.

L0 and L1 are generated automatically via LLM when a memory or resource is created.

## Viking URI scheme

All content is addressable via `viking://` URIs:

```
viking://user/memories/preferences/theme.md    # User preference
viking://agent/memories/cases/bug-fix.md        # Agent case memory
viking://resources/docs/api.md                  # Resource document
viking://session/123/messages                   # Session messages
```

Scopes: `resources`, `user`, `agent`, `session`, `queue`, `temp`

## OpenClaw integration

The `@viking-ts/openclaw-plugin` package implements the OpenClaw context-engine interface:

### Plugin manifest (`openclaw.plugin.json`)
- ID: `viking-ts`, kind: `context-engine`
- Two modes: `local` (spawns server subprocess) and `remote` (connects to existing server)

### Auto-recall
Before each conversation turn, the plugin searches memories semantically and injects relevant results as context.

### Auto-capture
After each turn, the plugin sends the conversation to the server for memory extraction via LLM.

### Agent tools
- `commit_memory`: Explicitly store a memory
- `search_memories`: Search the memory database

## PostgreSQL + pgvector (optional)

By default viking-ts uses SQLite + vectra for zero-config local storage. For production workloads you can switch to PostgreSQL with pgvector for scalable vector search.

### Requirements

- PostgreSQL 14+ with the [pgvector](https://github.com/pgvector/pgvector) extension

### Docker quickstart

```bash
docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 pgvector/pgvector:pg16
```

### Enable Postgres backend

```bash
export STORAGE_BACKEND=postgres
export DB_HOST=localhost
export DB_PORT=5432
export DB_USERNAME=postgres
export DB_PASSWORD=postgres
export DB_DATABASE=viking_ts
```

### Run migrations

```bash
npm run migration:run --workspace=packages/server
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_BACKEND` | `sqlite` | Set to `postgres` to use PostgreSQL |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USERNAME` | `postgres` | PostgreSQL username |
| `DB_PASSWORD` | — | PostgreSQL password |
| `DB_DATABASE` | `viking_ts` | PostgreSQL database name |
| `DB_LOGGING` | `false` | Enable TypeORM query logging |

## Configuration

Optional config file at `~/.viking-ts/config.json`:

```json
{
  "server": { "host": "127.0.0.1", "port": 1934 },
  "storage": { "path": "~/.viking-ts/data" },
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "sk-...",
    "apiBase": "https://api.openai.com/v1",
    "dimension": 1536
  },
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "sk-...",
    "apiBase": "https://api.openai.com/v1"
  }
}
```

Environment variables override config file values. Any OpenAI-compatible endpoint works (e.g., Ollama, Azure OpenAI, LiteLLM).

## API documentation

Start the server and visit `http://localhost:1934/docs` for interactive Swagger documentation.

## PostgreSQL backend

By default, viking-ts uses SQLite + vectra for local/dev use. For production, you can switch to PostgreSQL with pgvector.

### Requirements

- PostgreSQL 14+ with the [pgvector](https://github.com/pgvector/pgvector) extension

### Quick start with Docker

```bash
docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 pgvector/pgvector:pg16
```

### Enable Postgres backend

```bash
STORAGE_BACKEND=postgres \
DB_HOST=localhost \
DB_PORT=5432 \
DB_USERNAME=postgres \
DB_PASSWORD=postgres \
DB_DATABASE=viking_ts \
npm run start --workspace=packages/server
```

### Run migrations

```bash
DB_PASSWORD=postgres npm run migration:run --workspace=packages/server
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_BACKEND` | `sqlite` | `sqlite` or `postgres` |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USERNAME` | `postgres` | PostgreSQL username |
| `DB_PASSWORD` | (none) | PostgreSQL password |
| `DB_DATABASE` | `viking_ts` | PostgreSQL database name |
| `DB_LOGGING` | `false` | Enable TypeORM query logging |

## Tech stack

| Component | Technology |
|-----------|-----------|
| API framework | NestJS |
| Vector storage | vectra (pure TypeScript) / pgvector |
| Metadata storage | better-sqlite3 / PostgreSQL + TypeORM |
| Embedding + LLM | OpenAI SDK |
| Validation | class-validator (server), Zod (plugin) |
| API docs | @nestjs/swagger |
| Testing | Jest |

Zero native dependencies beyond better-sqlite3. No Python, Rust, Go, or C++ required.
