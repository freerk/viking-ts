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
- `POST /api/v1/sessions` - Create session
- `GET /api/v1/sessions` - List sessions
- `GET /api/v1/sessions/:id` - Get session
- `DELETE /api/v1/sessions/:id` - Delete session
- `POST /api/v1/sessions/:id/commit` - Commit session (extract memories, returns task_id)
- `POST /api/v1/sessions/:id/extract` - Extract memories from session
- `POST /api/v1/sessions/:id/messages` - Add message (content or parts)
- `POST /api/v1/sessions/:id/used` - Record used contexts/skills
- `POST /api/v1/resources/temp_upload` - Upload temp file (multipart)
- `POST /api/v1/resources` - Add resource (OpenViking-compatible: path/temp_path, to/parent)
- `POST /api/v1/skills` - Add skill (data or temp_path)
- `GET /api/v1/resources/search?q=...` - Search resources
- `GET /api/v1/ls?uri=viking://...` - List Viking URI contents
- `GET /api/v1/tree?uri=viking://...` - Tree view
- `GET /api/v1/fs/ls` - Filesystem list (new)
- `GET /api/v1/fs/tree` - Filesystem tree (new)
- `GET /api/v1/fs/stat` - Filesystem stat (new)
- `POST /api/v1/fs/mkdir` - Create directory (new)
- `DELETE /api/v1/fs` - Remove file/directory (new)
- `POST /api/v1/fs/mv` - Move/rename (new)
- `GET /api/v1/content/read` - Read file content (new)
- `GET /api/v1/content/abstract` - Get abstract (new)
- `GET /api/v1/content/overview` - Get overview (new)
- `GET /api/v1/content/download` - Download file (new)
- `GET /api/v1/relations` - List relations (new)
- `POST /api/v1/relations/link` - Create relation (new)
- `DELETE /api/v1/relations/link` - Remove relation (new)

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
- better-sqlite3 (unified SQLite storage, WAL mode)
- OpenAI SDK (embedding + LLM, works with any OpenAI-compatible endpoint)
- Zod (validation in plugin client)

## Architecture (Phase 1: Unified Storage)

### Storage layer

All data lives in a single SQLite database (`{STORAGE_PATH}/viking.db`) with 5 tables:

- `vfs_nodes` - Virtual filesystem (files and directories with Viking URIs)
- `context_vectors` - Unified vector storage with embeddings (JSON-serialized float arrays)
- `relations` - URI-to-URI relations with optional reason
- `sessions` - Conversation sessions
- `session_messages` - Individual messages within sessions

### Core services (packages/server/src/storage/)

- `DatabaseService` - Manages SQLite connection, creates schema on init
- `VfsService` - Virtual filesystem operations (mkdir, writeFile, readFile, rm, mv, ls, tree, grep, glob)
- `ContextVectorService` - Vector storage with cosine similarity search (pure TypeScript, no native deps)
- `RelationsService` - URI relation CRUD

### Viking URI scheme

All content is addressed via `viking://` URIs:
- `viking://resources/{id}.md` - Resources
- `viking://agent/{agentId}/memories/{id}.md` - Agent memories
- `viking://user/{userId}/memories/{id}.md` - User memories
- `viking://agent/{agentId}/skills/{name}.md` - Skills

### ID generation

Context vector IDs are deterministic: `MD5("{accountId}:{uri}")`. This enables idempotent upserts.

### Vector search

Cosine similarity is computed in TypeScript (not SQL). Rows are filtered by contextType/parentUriPrefix in SQL, then embeddings are deserialized and scored in-process. Default score threshold is 0.0.

### LLM prompts (packages/server/src/llm/prompts.ts)

All LLM prompts are verbatim copies from OpenViking's YAML templates in `openviking/prompts/templates/`.
Seven prompt functions: `fileSummaryPrompt`, `documentSummaryPrompt`, `overviewGenerationPrompt`,
`memoryExtractionPrompt`, `memoryMergePrompt`, `dedupDecisionPrompt`, `intentAnalysisPrompt`.

### Search / IntentAnalyzer

- `POST /search/find` and `POST /search/search` return `FindResult`: `{memories[], resources[], skills[], total}`
- `search` with `session_id` runs `IntentAnalyzerService` to produce a multi-type `QueryPlan`
- `IntentAnalyzerService` (packages/server/src/search/intent-analyzer.service.ts) ports OpenViking's `IntentAnalyzer`

### Memory extraction categories

8 categories: profile, preferences, entities, events, cases, patterns, tools, skills.

### Legacy files (not imported, safe to remove later)

- `src/storage/database/` - TypeORM entities, migrations, postgres services
- `src/storage/metadata-store.service.ts` - Old SQLite metadata store
- `src/storage/vector-store.service.ts` - Old vectra wrapper
- `src/viking-uri/viking-uri.service.ts` - Old URI service (replaced by VfsService)
