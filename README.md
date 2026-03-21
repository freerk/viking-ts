# viking-ts

TypeScript-native context database for AI agents. A clean reimplementation of the core concepts from [OpenViking](https://github.com/volcengine/OpenViking), built entirely in TypeScript with zero Python/Rust/Go/C++ dependencies.

## Why viking-ts?

OpenViking provides a powerful memory layer for AI agents, but its Python/Rust stack introduces deployment complexity and native dependency headaches. viking-ts solves this:

- **Pure TypeScript**: runs anywhere Node.js runs, no native compilation beyond better-sqlite3
- **Provider agnostic**: works with OpenAI, Ollama, Anthropic, Azure OpenAI, LiteLLM, or any OpenAI-compatible endpoint
- **L0/L1/L2 tiered memory**: automatic abstraction hierarchy for efficient retrieval
- **Viking URI scheme**: content-addressable namespace for memories, resources, skills, and sessions
- **OpenClaw plugin**: drop-in context engine with auto-recall, auto-capture, and agent tools
- **Ingest CLI**: bulk import of identity files, workspace memories, sessions, resources, and skills

## Architecture

```
viking-ts/
├── packages/
│   ├── server/              # NestJS REST API (port 1934)
│   │   ├── src/
│   │   │   ├── memory/      # Memory CRUD + search + session capture
│   │   │   ├── resource/    # Resource storage + search
│   │   │   ├── skills/      # Skill storage + search
│   │   │   ├── viking-uri/  # viking:// URI resolution + tree view
│   │   │   ├── embedding/   # OpenAI-compatible embedding service
│   │   │   ├── llm/         # LLM service (L0/L1 generation, memory extraction)
│   │   │   ├── storage/     # vectra vector DB + SQLite metadata
│   │   │   └── health/      # Health check endpoint
│   │   └── test/            # Jest tests
│   └── openclaw-plugin/     # OpenClaw context-engine plugin
│       ├── src/
│       │   ├── index.ts     # Plugin entry + context engine
│       │   ├── client.ts    # HTTP client with Zod validation
│       │   ├── process-manager.ts  # Local server lifecycle
│       │   └── text-utils.ts       # Capture sanitization + triggers
│       └── openclaw.plugin.json    # Plugin manifest
├── scripts/
│   ├── ingest.mjs           # Multi-agent ingest CLI
│   └── ingest-completion.bash  # Bash completion for ingest CLI
└── docs/                    # Extended documentation
```

The server stores data in two layers:

- **SQLite** (via better-sqlite3): structured metadata, full text, filtering, pagination
- **vectra** (pure TypeScript vector DB): semantic search via embeddings

See [docs/architecture.md](docs/architecture.md) for the full deep dive.

## Quick start

```bash
# Clone and install
git clone <repo-url> && cd viking-ts
npm install

# Set API keys (OpenAI example)
export EMBEDDING_API_KEY=sk-your-key
export LLM_API_KEY=sk-your-key

# Or use Ollama (no API key needed)
export EMBEDDING_PROVIDER=openai
export EMBEDDING_MODEL=nomic-embed-text
export EMBEDDING_API_BASE=http://localhost:11434/v1
export EMBEDDING_DIMENSION=768
export LLM_MODEL=llama3
export LLM_API_BASE=http://localhost:11434/v1

# Build and start
npm run build
npm run start:dev

# Verify
curl http://localhost:1934/health
```

### Store a memory

```bash
curl -X POST http://localhost:1934/api/v1/memories \
  -H 'Content-Type: application/json' \
  -d '{"text": "User prefers TypeScript with strict mode", "category": "preferences"}'
```

### Search memories

```bash
curl 'http://localhost:1934/api/v1/memories/search?q=programming+language+preference'
```

### Capture a conversation

```bash
curl -X POST http://localhost:1934/api/v1/sessions/capture \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [
      {"role": "user", "content": "I always use dark mode"},
      {"role": "assistant", "content": "Noted, I will remember that preference."}
    ],
    "agentId": "my-agent"
  }'
```

## L0/L1/L2 tiered memory

Every memory, resource, and skill is stored with three tiers of abstraction:

| Tier | Name | Size | Purpose |
|------|------|------|---------|
| L0 | Abstract | ~50 tokens | One-sentence summary. Used for vector embedding and search results. |
| L1 | Overview | ~500 tokens | Structured key points. Loaded for context without full content. |
| L2 | Content | Full text | Original untruncated content. Fetched on demand. |

L0 and L1 are generated automatically by the LLM when a record is created. If the LLM is unavailable, the system falls back to text truncation (first 100 chars for L0, first 500 for L1).

## Viking URI scheme

All content is addressable via `viking://` URIs:

```
viking://user/memories/preferences/theme     # User preference
viking://agent/memories/cases/bug-fix         # Agent case memory
viking://agent/skills/code-review/            # Agent skill
viking://resources/docs/api.md                # Resource document
viking://session/123/messages                 # Session messages
```

**Scopes**: `resources`, `user`, `agent`, `session`, `queue`, `temp`

Browse the URI namespace:

```bash
# List children at a URI
curl 'http://localhost:1934/api/v1/ls?uri=viking://agent/'

# Tree view with depth control
curl 'http://localhost:1934/api/v1/tree?uri=viking://agent/&depth=3'
```

## Environment variables

All configuration can be set via environment variables, `~/.viking-ts/config.json`, or defaults. Env vars take highest priority.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `1934` | Server port |
| `HOST` | `127.0.0.1` | Server bind address |
| `STORAGE_PATH` | `~/.viking-ts/data` | Data directory (SQLite DB + vectra indexes) |
| `EMBEDDING_PROVIDER` | `openai` | Embedding provider identifier |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name |
| `EMBEDDING_API_KEY` | (none) | API key for embedding provider |
| `EMBEDDING_API_BASE` | `https://api.openai.com/v1` | Base URL for embedding API |
| `EMBEDDING_DIMENSION` | `1536` | Embedding vector dimension |
| `LLM_PROVIDER` | `openai` | LLM provider identifier |
| `LLM_MODEL` | `gpt-4o-mini` | LLM model name |
| `LLM_API_KEY` | (none) | API key for LLM provider |
| `LLM_API_BASE` | `https://api.openai.com/v1` | Base URL for LLM API |

### Config file

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

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/memories` | Create memory |
| `GET` | `/api/v1/memories` | List memories (with filters) |
| `GET` | `/api/v1/memories/search?q=...` | Semantic search memories |
| `GET` | `/api/v1/memories/:id` | Get memory by ID |
| `DELETE` | `/api/v1/memories/:id` | Delete memory |
| `POST` | `/api/v1/sessions/capture` | Ingest conversation, extract memories |
| `POST` | `/api/v1/resources` | Create resource |
| `GET` | `/api/v1/resources` | List resources |
| `GET` | `/api/v1/resources/search?q=...` | Semantic search resources |
| `GET` | `/api/v1/resources/:id` | Get resource by ID |
| `DELETE` | `/api/v1/resources/:id` | Delete resource |
| `POST` | `/api/v1/skills` | Create skill |
| `GET` | `/api/v1/skills` | List skills (with tag filter) |
| `GET` | `/api/v1/skills/search?q=...` | Semantic search skills |
| `GET` | `/api/v1/skills/:id` | Get skill by ID |
| `DELETE` | `/api/v1/skills/:id` | Delete skill |
| `GET` | `/api/v1/ls?uri=...` | List Viking URI children |
| `GET` | `/api/v1/tree?uri=...&depth=N` | Viking URI tree view |

All responses follow the shape `{ status: "ok", result: T, time: number }` or `{ status: "error", error: { code, message } }`.

Interactive Swagger docs available at `http://localhost:1934/docs` when the server is running.

See [docs/api-reference.md](docs/api-reference.md) for full request/response examples.

## OpenClaw integration

The `@viking-ts/openclaw-plugin` implements the OpenClaw context-engine interface. It can run in two modes:

- **Local**: spawns a viking-ts server as a subprocess
- **Remote**: connects to an existing server

Configure in your OpenClaw `plugins.slots.contextEngine`:

```json
{
  "pluginId": "viking-ts",
  "mode": "remote",
  "params": { "baseUrl": "http://localhost:1934" },
  "config": {
    "agentId": "my-agent",
    "autoRecall": true,
    "autoCapture": true,
    "recallLimit": 6
  }
}
```

Features:
- **Auto-recall**: semantic memory search before each turn
- **Auto-capture**: LLM-based memory extraction after each turn
- **Agent tools**: `commit_memory` and `search_memories` for explicit control

See [docs/openclaw-integration.md](docs/openclaw-integration.md) for the full setup guide.

## Ingest CLI

Bulk import identity files, workspace memories, sessions, resources, and skills:

```bash
# Full ingest for all agents
node scripts/ingest.mjs --skills ~/apps/openclaw/skills

# Specific agent with resources
node scripts/ingest.mjs --agent simon --resources ~/.openclaw/workspace/projects/docs

# Dry run to preview
node scripts/ingest.mjs --dry-run --agent simon

# Force re-ingest (skip dedup)
node scripts/ingest.mjs --force --skills ~/apps/openclaw/skills

# Sync skills (delete stale entries)
node scripts/ingest.mjs --skills ~/apps/openclaw/skills --sync-skills
```

See [docs/ingest-cli.md](docs/ingest-cli.md) for all flags and behavior.

## Local embedding with Ollama

viking-ts works with any OpenAI-compatible embedding endpoint. To use Ollama locally:

```bash
# Pull an embedding model
ollama pull nomic-embed-text

# Configure viking-ts
export EMBEDDING_MODEL=nomic-embed-text
export EMBEDDING_API_BASE=http://localhost:11434/v1
export EMBEDDING_DIMENSION=768

# Optionally use Ollama for LLM too
export LLM_MODEL=llama3
export LLM_API_BASE=http://localhost:11434/v1
```

No API keys needed. The OpenAI SDK client works with Ollama's OpenAI-compatible API out of the box.

## Self-hosting

viking-ts is designed for self-hosting. Run it as a systemd service, behind a reverse proxy, or access it over Tailscale.

See [docs/self-hosting.md](docs/self-hosting.md) for the full guide.

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Start in dev mode (with watch)
npm run start:dev

# Run all tests
npm test

# Run server tests only
npm test --workspace=packages/server

# Type check
cd packages/server && npx tsc --noEmit
cd packages/openclaw-plugin && npx tsc --noEmit

# Lint
npm run lint
```

### Project structure

| Package | Description |
|---------|-------------|
| `packages/server` | NestJS REST API server |
| `packages/openclaw-plugin` | OpenClaw context-engine plugin |

### Tech stack

| Component | Technology |
|-----------|-----------|
| API framework | NestJS 10 |
| Vector storage | vectra (pure TypeScript) |
| Metadata storage | better-sqlite3 |
| Embedding + LLM | OpenAI SDK (works with any compatible endpoint) |
| Validation | class-validator (server), Zod (plugin) |
| API docs | @nestjs/swagger |
| Testing | Jest |

Zero native dependencies beyond better-sqlite3. No Python, Rust, Go, or C++ required.

## Documentation

- [Architecture deep dive](docs/architecture.md)
- [API reference](docs/api-reference.md)
- [OpenClaw integration guide](docs/openclaw-integration.md)
- [Ingest CLI](docs/ingest-cli.md)
- [Self-hosting guide](docs/self-hosting.md)
- [Project retrospective](docs/retrospective.md)
- [Self-hosting principles](docs/self-hosting-principles.md)

## License

MIT
