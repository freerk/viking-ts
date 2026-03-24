# viking-ts — Implementation Phases

## Status overview

| Phase | Branch | Status | Description |
|---|---|---|---|
| 1 | `main` | ✅ done | Initial server scaffold, VFS, memory CRUD, basic search |
| 2 | `feature/phase2-async-queue` | ✅ done | Async queue pipeline (SemanticProcessor + EmbeddingQueue) |
| 3 | `feature/phase3-hierarchical-search` | ✅ done | Hierarchical search (faithful OpenViking port) |
| 3a | `feature/phase3a-parity-fixes` | ✅ done | Parity fixes pass |
| 4 | `feature/phase4-sessions` | ✅ done | Sessions lifecycle + resources rewrite |
| 5 | `feature/phase5-prompt-fidelity` | ✅ done | Prompt fidelity, intent analysis, FindResult shape |
| 6 | `feature/phase6-dedup-archive` | ✅ done | Memory deduplication + two-phase session commit |
| 7 | `feature/phase7-config-semantic` | ✅ done | Config surface, semantic processor polish, tools/skills categories |
| 8 | `feature/phase8-identity-namespacing` | ✅ done | Request identity context + URI namespacing |
| 9 | `feature/phase9-directory-init` | ✅ done | Preset directory initialization with L0/L1 seeding |
| 10 | `feature/phase10-commit-sync` | 🔜 next | Session commit sync by default (match OpenViking `wait` param) |
| 11 | `feature/phase11-skills-shape` | 🔜 | Skills API shape fix — `data` wrapper + MCP auto-detection |
| 12 | `feature/phase12-resource-pipeline` | 🔜 | Full resource ingestion pipeline |
| 13 | `feature/phase13-pack` | 🔜 | Pack/export/import (.ovpack format) |
| 14 | `feature/phase14-observer` | 🔜 | Observer endpoints (vikingdb, vlm, system status) |

---

## Phase 10 — Session commit sync by default

**Branch:** `feature/phase10-commit-sync` (base: `feature/phase9-directory-init`)

### Problem
viking-ts `POST /api/v1/sessions/{id}/commit` always runs async and returns a `task_id`. OpenViking defaults to synchronous (`wait=true`) and returns the full result inline. Agents and clients expect a completed result when calling commit without parameters.

### OpenViking behaviour (source: `openviking/server/routers/sessions.py`)
```
POST /api/v1/sessions/{id}/commit?wait=true   (default) → blocks, returns full result
POST /api/v1/sessions/{id}/commit?wait=false             → background, returns task_id
```

Response when `wait=true`:
```json
{
  "status": "ok",
  "result": {
    "session_id": "...",
    "status": "committed",
    "archived": true,
    "memories_extracted": 5
  }
}
```

Response when `wait=false`:
```json
{
  "status": "ok",
  "result": {
    "task_id": "...",
    "status": "processing"
  }
}
```

### What to change
- `session.controller.ts` — add `@Query('wait') wait = true` param
- When `wait=true`: call synchronous commit, return full result
- When `wait=false`: existing async behaviour (task_id), keep as opt-in
- `SessionService` — add synchronous `commit(sessionId, ctx)` method alongside existing `commitAsync`
- Update response shape to include `archived: true` and `memories_extracted: N`

### Tests
- `POST /commit` (no param) → synchronous, returns `status: committed`
- `POST /commit?wait=true` → same
- `POST /commit?wait=false` → async, returns `task_id`
- Conflict: two simultaneous sync commits on same session → 409

---

## Phase 11 — Skills API shape fix

**Branch:** `feature/phase11-skills-shape` (base: `feature/phase10-commit-sync`)

### Problem
OpenViking `POST /api/v1/skills` accepts `{ data: dict|string|path }` with auto-detection of MCP tool format. viking-ts accepts `{ name, description, content, tags }` directly — a different shape that breaks clients targeting OpenViking parity.

### OpenViking request shape (source: `openviking/server/routers/resources.py`)
```json
{
  "data": {
    "name": "search-web",
    "description": "Search the web",
    "content": "# search-web\n...",
    "tags": ["search"]
  }
}
```

MCP auto-detection: if `data` contains `inputSchema` field → convert to skill format automatically.

### What to change
- `skill.controller.ts` / `skill.dto.ts` — accept `{ data: CreateSkillDto | McpToolDto }` wrapper
- Add MCP format detection: if `data.inputSchema` exists → auto-convert name (camelCase/snake_case → kebab-case), generate markdown content from schema
- Keep backward compat: if body is sent without `data` wrapper, still accept (for existing ingest scripts)
- `scripts/ingest.mjs` — update to send `{ data: { name, description, content, tags } }`

### MCP conversion logic (port from `openviking/core/mcp_converter.py`)
1. name: snake_case/camelCase → kebab-case
2. description: preserve as-is
3. Parameters extracted from `inputSchema.properties`
4. Required fields from `inputSchema.required`
5. Generate markdown: name, description, `## Parameters` section

### Tests
- POST with `data` wrapper → skill created
- POST with MCP `inputSchema` → auto-converted, skill created
- POST without wrapper (legacy) → still works
- MCP name conversion: `search_web` → `search-web`

---

## Phase 12 — Full resource ingestion pipeline

**Branch:** `feature/phase12-resource-pipeline` (base: `feature/phase11-skills-shape`)

### Problem
viking-ts `POST /api/v1/resources` is a simplified create (stores text directly). OpenViking has a full pipeline: Parser → TreeBuilder → AGFS write → SemanticQueue → Vector index. This is the most significant feature gap for real-world use.

### OpenViking pipeline (source: `openviking/utils/skill_processor.py`, `openviking/server/routers/resources.py`)
```
Input (path/URL/text) → Parser → TreeBuilder → VFS write → EmbeddingQueue → SemanticQueue
```

### Input types to support
- Plain text / Markdown string (already works)
- Local file path (`.md`, `.txt`, `.json`, `.yaml`, `.py`, `.ts`, etc.)
- URL (fetch + parse)
- Directory (walk + process each file)

### Request shape (matching OpenViking)
```json
{
  "path": "./docs/guide.md",
  "to": "viking://resources/my-project/",    // optional target URI
  "reason": "why this is being added",        // improves search relevance
  "wait": false,                              // async by default for resources
  "instruction": ""                           // processing hints
}
```

### What to change
- `resource.controller.ts` — accept new `AddResourceRequest` shape
- `resource.service.ts` — implement pipeline:
  1. Detect input type (text, file, URL, directory)
  2. Parse content (markdown-native, plain text for others in v1 — no PDF/image in Phase 12)
  3. Write to VFS at target URI (auto-generate if not provided: `viking://resources/{filename}`)
  4. Enqueue embedding + semantic processing
  5. Return `{ root_uri, status, errors }`
- `watch_interval` support: optional, schedule re-processing (can be a stub in Phase 12)
- Keep legacy `POST /api/v1/resources` shape as fallback

### Phase 12 scope limits (defer to later)
- PDF parsing → Phase 12+
- Image/video/audio → Phase 12+
- Feishu/Lark cloud docs → Phase 12+
- Incremental update (diff existing tree) → Phase 12+
- `watch_interval` actual scheduling → Phase 12+

### Tests
- Add markdown string → stored at auto-URI, searchable
- Add with explicit `to` URI → stored at correct path
- Add with `wait=true` → blocks until vectorized
- Add with `wait=false` → returns immediately, background processing
- `reason` field is used in semantic context generation

---

## Phase 13 — Pack / export / import

**Branch:** `feature/phase13-pack` (base: `feature/phase12-resource-pipeline`)

### Problem
No way to export or import VFS + vector state. Needed for:
- Side-by-side comparison: export same data into both OpenViking and viking-ts, compare search results
- Backups: snapshot state before destructive operations
- Test fixtures: create deterministic test states

### OpenViking endpoints
```
POST /api/v1/pack/export   { uri, to }        → writes .ovpack file
POST /api/v1/pack/import   { file_path, parent, force, vectorize }  → imports .ovpack
```

### .ovpack format
A zip archive containing:
- VFS file tree (all `.md`, `.json` files under the URI)
- `manifest.json` with metadata (uri, created_at, viking-ts version)
- Does NOT include vector embeddings (re-vectorized on import)

### What to implement
- `POST /api/v1/pack/export` — walk VFS under URI, zip to file, return path
- `POST /api/v1/pack/import` — unzip, write to VFS under `parent`, optionally trigger vectorization
- CLI flag in `scripts/ingest.mjs`: `--export <uri> <file>` and `--import <file> <uri>`

### Tests
- Export + import round-trip: data survives
- `force=true` overwrites existing
- `vectorize=true` triggers embedding queue after import

---

## Phase 14 — Observer endpoints

**Branch:** `feature/phase14-observer` (base: `feature/phase13-pack`)

### Problem
Observer API is incomplete. Missing: `/observer/vikingdb`, `/observer/vlm`, `/observer/system`.

### What to add
- `GET /api/v1/observer/vikingdb` — return context vector store stats (record count, index info)
- `GET /api/v1/observer/vlm` — return LLM/VLM token usage totals (from in-memory counter)
- `GET /api/v1/observer/system` — aggregate all component statuses

### Notes
- Low priority — monitoring only, not required for functional parity
- VLM token tracking needs a simple in-memory accumulator added to `LlmService`

---

## OpenViking API parity table (as of Phase 9)

| Endpoint | Status | Notes |
|---|---|---|
| `GET /health` | ✅ | |
| `GET /api/v1/system/status` | ✅ | |
| `POST /api/v1/system/wait` | ✅ | |
| `GET /api/v1/fs/ls` | ✅ | |
| `GET /api/v1/fs/tree` | ✅ | |
| `GET /api/v1/fs/stat` | ✅ | |
| `POST /api/v1/fs/mkdir` | ✅ | |
| `DELETE /api/v1/fs` | ✅ | |
| `POST /api/v1/fs/mv` | ✅ | |
| `GET /api/v1/content/read` | ✅ | |
| `GET /api/v1/content/abstract` | ✅ | |
| `GET /api/v1/content/overview` | ✅ | |
| `POST /api/v1/search/find` | ✅ | |
| `POST /api/v1/search/search` | ✅ | |
| `POST /api/v1/search/grep` | ✅ | |
| `POST /api/v1/search/glob` | ✅ | |
| `GET /api/v1/relations` | ✅ | |
| `POST /api/v1/relations/link` | ✅ | |
| `DELETE /api/v1/relations/link` | ✅ | |
| `POST /api/v1/sessions` | ✅ | |
| `GET /api/v1/sessions` | ✅ | |
| `GET /api/v1/sessions/{id}` | ✅ | |
| `DELETE /api/v1/sessions/{id}` | ✅ | |
| `POST /api/v1/sessions/{id}/commit` | ⚠️ | Always async — Phase 10 fix |
| `POST /api/v1/sessions/{id}/messages` | ✅ | |
| `POST /api/v1/sessions/{id}/used` | ✅ | |
| `POST /api/v1/skills` | ⚠️ | Wrong shape, no MCP detection — Phase 11 fix |
| `POST /api/v1/resources` | ⚠️ | Simplified only — Phase 12 full pipeline |
| `GET /api/v1/observer/queue` | ✅ | |
| `GET /api/v1/observer/vikingdb` | ❌ | Phase 14 |
| `GET /api/v1/observer/vlm` | ❌ | Phase 14 |
| `GET /api/v1/observer/system` | ❌ | Phase 14 |
| `GET /api/v1/debug/health` | ✅ | |
| `POST /api/v1/pack/export` | ❌ | Phase 13 |
| `POST /api/v1/pack/import` | ❌ | Phase 13 |
| Admin API (`/api/v1/admin/*`) | ❌ | Out of scope (multi-tenant only) |

---

## URI scheme parity (as of Phase 8+9)

| Data type | OpenViking | viking-ts | Status |
|---|---|---|---|
| User profile | `viking://user/{user_id}/memories/profile.md` | `viking://user/{userSpaceName}/memories/profile.md` | ✅ |
| User preferences | `viking://user/{user_id}/memories/preferences/...` | `viking://user/{userSpaceName}/memories/preferences/...` | ✅ |
| User entities | `viking://user/{user_id}/memories/entities/...` | same | ✅ |
| User events | `viking://user/{user_id}/memories/events/...` | same | ✅ |
| Agent cases | `viking://agent/{agent_space}/memories/cases/...` | same | ✅ |
| Agent patterns | `viking://agent/{agent_space}/memories/patterns/...` | same | ✅ |
| Agent tool memories | `viking://agent/{agent_space}/memories/tools/{name}.md` | same | ✅ |
| Agent skill memories | `viking://agent/{agent_space}/memories/skills/{name}.md` | same | ✅ |
| Agent instructions dir | `viking://agent/{agent_space}/instructions/` | ✅ seeded (Phase 9) | ✅ |
| Skill definitions | `viking://agent/skills/{name}/` | same | ✅ |
| Resources | `viking://resources/...` | same | ✅ |
| Sessions | `viking://session/{user_id}/{session_id}/history` | same | ✅ |

`{agent_space}` = `md5("{user_id}:{agent_id}")[:12]`

---

## Future phases (post-parity add-ons)

These are documented extensions beyond the 1:1 OpenViking clone. Implement only after Phases 10–14 are complete and parity is verified.

### Phase 15 — LLM → VLM rename (config parity)

Rename `llm` config section and `LlmService` to `vlm`/`VlmService` to match OpenViking naming.

- `config.ts`: `llm.*` → `vlm.*` env vars (`VLM_PROVIDER`, `VLM_MODEL`, `VLM_API_KEY`, `VLM_API_BASE`)
- `LlmService` → `VlmService` (keep `LlmService` as deprecated alias)
- `.env.example` updated
- No behaviour changes — pure rename

### Phase 16 — Split LLM + VLM providers (add-on)

Allow separate model config for text-only tasks (memory extraction, semantic processing) vs vision tasks (image/video description).

- `config.ts`: add `vlm.vision.*` optional override (falls back to `vlm.*` if not set)
- `VlmService`: `generateText(prompt)` uses base model, `describeImage(prompt, images)` uses vision model
- Enables: cheap/fast text model for memory extraction + expensive vision model only when needed

### Phase 17 — Media format support (add-on)

Extend resource ingestion pipeline (Phase 12) with binary/media parsing:

- **PDF**: extract text via `pdf-parse` npm package
- **HTML**: clean via `cheerio` (strip tags, keep structure)
- **DOCX**: extract via `mammoth`
- **Images** (`.png`, `.jpg`, `.gif`, `.webp`): describe via VlmService vision capability
- **Audio** (`.mp3`, `.wav`, `.m4a`): transcribe via configurable transcription service (OpenAI Whisper API or compatible)
- **Video**: frame extraction + VLM description (complex, lowest priority)

### Phase 18 — Transcription service (add-on)

Standalone transcription service using OpenAI Whisper API (or compatible endpoint).

- Config: `transcription.provider`, `transcription.model`, `transcription.apiKey`, `transcription.apiBase`
- `POST /api/v1/transcribe` endpoint: accept audio file/URL → return transcript text
- Used by Phase 17 audio resource ingestion
- Also useful standalone for voice notes, meeting recordings etc.

---

## Revised post-parity phases (updated 2026-03-24)

### Phase 15 — Config schema parity (LLM → VLM rename + key alignment)

**Branch:** `feature/phase15-config-parity` (base: `feature/phase14-observer`)

**Goal:** Make `~/.viking-ts/config.json` a drop-in replacement for OpenViking's `~/.openviking/ov.conf`. An OpenViking user should be able to copy their config with minimal changes.

#### Changes

**Rename `llm` → `vlm` throughout:**
- `config.ts`: `llm.*` → `vlm.*`
- Env vars: `LLM_*` → `VLM_*` (keep `LLM_*` as deprecated aliases)
- All service references: `LlmService` → keep name for now, but config key is `vlm`

**Align `embedding` structure:**
```json
// OpenViking
{ "embedding": { "dense": { "provider": "...", "model": "...", "apiKey": "...", "dimension": 1024 } } }

// viking-ts current (flat)
{ "embedding": { "provider": "...", "model": "...", "apiKey": "...", "dimension": 1024 } }
```
Support both: if `embedding.dense` exists → use nested shape. If flat → use as-is (backward compat).
Add missing fields: `input`, `batch_size`, `max_concurrent`.

**Align `storage` keys:**
- `storage.path` → `storage.workspace` (keep `path` as alias)
- Add `storage.agfs` stub (ignored internally but accepted without error)
- Add `storage.vectordb` stub (ignored internally — viking-ts uses SQLite)

**Add `server.root_api_key` and `server.cors_origins`:**
- `root_api_key`: if set → require `X-API-Key` header matching this value (simple single-key auth, not full multi-tenant)
- `cors_origins`: pass to NestJS CORS config

**Config file location:**
- Primary: `~/.viking-ts/config.json` (keep)
- Also check `~/.openviking/ov.conf` as fallback (JSON format — same parser works)
- Env var override: `OPENVIKING_CONFIG_FILE` (same as OpenViking)

**Add missing `vlm` fields:**
- `vlm.thinking` (bool, default false) — pass to LLM service
- `vlm.max_concurrent` (int, default 100) — throttle concurrent LLM calls
- `vlm.extra_headers` (object) — add to LLM HTTP requests
- `vlm.stream` (bool, default false) — enable streaming

#### End result config (viking-ts after Phase 15):
```json
{
  "embedding": {
    "dense": {
      "provider": "openai",
      "api_key": "your-key",
      "model": "text-embedding-3-small",
      "dimension": 1536
    }
  },
  "vlm": {
    "provider": "openai",
    "api_key": "your-key",
    "model": "gpt-4o-mini",
    "api_base": "https://api.openai.com/v1"
  },
  "rerank": {
    "provider": "openai",
    "api_key": "your-key",
    "model": "...",
    "threshold": 0.1
  },
  "storage": {
    "workspace": "./data"
  },
  "server": {
    "host": "0.0.0.0",
    "port": 1934,
    "root_api_key": "optional-key",
    "cors_origins": ["*"]
  }
}
```

---

### Phase 16 — Media format support (binary ingestion)

**Branch:** `feature/phase16-media-formats` (base: `feature/phase15-config-parity`)

**Goal:** Extend resource ingestion pipeline (Phase 12) to support binary/media formats. After this phase, viking-ts accepts the same input formats as OpenViking.

#### Formats to add

| Format | Library | Notes |
|---|---|---|
| PDF | `pdf-parse` | Text extraction only (no image extraction from PDF in v1) |
| HTML | `cheerio` | Strip tags, preserve structure, clean whitespace |
| DOCX | `mammoth` | Text extraction |
| Images (`.png`, `.jpg`, `.gif`, `.webp`) | VLM via `VlmService` | Describe via vision capability (requires Phase 16 VLM split) |
| Audio (`.mp3`, `.wav`, `.m4a`) | OpenAI Whisper API | Transcription — requires transcription config section |

#### Config additions
```json
{
  "transcription": {
    "provider": "openai",
    "api_key": "your-key",
    "api_base": "https://api.openai.com/v1",
    "model": "whisper-1"
  }
}
```

#### Notes
- Images/audio require VLM/transcription to be configured — graceful fallback (store filename + empty content) if not
- Video (`.mp4`, etc.) deferred — requires frame extraction, lowest priority
- Feishu/Lark deferred — requires separate SDK

---

## Drop-in replacement milestone

After Phase 16 completes, viking-ts should be a **100% drop-in replacement** for OpenViking server:
- Same API endpoints ✅ (Phases 10–14)
- Same URI scheme ✅ (Phases 8–9)
- Same config format ✅ (Phase 15)
- Same resource formats ✅ (Phase 16)
- Same session/memory behaviour ✅ (Phases 1–7)
