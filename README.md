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

## Tech stack

| Component | Technology |
|-----------|-----------|
| API framework | NestJS |
| Vector storage | vectra (pure TypeScript) |
| Metadata storage | better-sqlite3 |
| Embedding + LLM | OpenAI SDK |
| Validation | class-validator (server), Zod (plugin) |
| API docs | @nestjs/swagger |
| Testing | Jest |

Zero native dependencies beyond better-sqlite3. No Python, Rust, Go, or C++ required.
