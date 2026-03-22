# viking-ts

TypeScript-native context database for AI agents, inspired by OpenViking.

## Build & run

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Start server (dev mode with watch)
npm run start:dev

# Start server (production)
npm run start

# Run all tests
npm test

# Type check (no emit)
cd packages/server && npx tsc --noEmit
cd packages/openclaw-plugin && npx tsc --noEmit
```

## Project structure

- `packages/server` - NestJS REST API server (port 1934)
- `packages/openclaw-plugin` - OpenClaw context-engine plugin

## Environment variables

```
PORT=1934
HOST=127.0.0.1
STORAGE_PATH=~/.viking-ts/data
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
EMBEDDING_API_BASE=https://api.openai.com/v1
EMBEDDING_DIMENSION=1536
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...
LLM_API_BASE=https://api.openai.com/v1
SWAGGER_ENABLED=true
SWAGGER_USER=admin
SWAGGER_PASSWORD=changeme
```

## Swagger / OpenAPI

- `GET /openapi` - Swagger UI (when enabled)
- `GET /openapi-json` - Raw OpenAPI JSON spec (when enabled)

Controlled by `SWAGGER_ENABLED` env var (default: `false`).
In production (`NODE_ENV=production`), requires `SWAGGER_USER` and `SWAGGER_PASSWORD` for HTTP basic auth.
In development, accessible without auth.

## Key API endpoints

- `GET /health` - Health check
- `POST /api/v1/memories` - Store memory
- `GET /api/v1/memories/search?q=...` - Semantic search
- `GET /api/v1/memories` - List memories
- `DELETE /api/v1/memories/:id` - Delete memory
- `POST /api/v1/sessions/capture` - Ingest conversation, extract memories
- `POST /api/v1/resources` - Add resource
- `GET /api/v1/resources/search?q=...` - Search resources
- `GET /api/v1/ls?uri=viking://...` - List Viking URI contents
- `GET /api/v1/tree?uri=viking://...` - Tree view

## Testing

```bash
# Run all tests
npm test

# Run server tests only
npm test --workspace=packages/server

# Run with coverage
npm test --workspace=packages/server -- --coverage
```

## Tech stack

- NestJS (REST API framework)
- vectra (pure TypeScript vector DB)
- better-sqlite3 (metadata storage)
- OpenAI SDK (embedding + LLM, works with any OpenAI-compatible endpoint)
- Zod (validation in plugin client)
