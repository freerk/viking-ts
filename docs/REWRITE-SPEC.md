# viking-ts Rewrite Spec — OpenViking-faithful TypeScript port

## Objective

Rewrite viking-ts to be a faithful TypeScript equivalent of OpenViking.
**Same architecture. Same API surface. Same storage hierarchy. Pure TypeScript — no Python, Rust, Go, or C++.**

The current codebase picked up OpenViking terminology (L0/L1/L2, Viking URI) but implemented a flat, simplified model.
This rewrite aligns it with the real OpenViking architecture so it can serve as a baseline for ReflectiveAI.

---

## What OpenViking is (and what we must replicate)

### Components in OpenViking we replace with TypeScript

| OpenViking component | Language | viking-ts replacement |
|---|---|---|
| AGFS file server | Go + native .so | Pure TypeScript VFS over SQLite |
| VikingDB vector engine | C++ (OpenViking C++ index) | better-sqlite3 + sqlite-vss or vectra |
| SemanticProcessor / intelligence layer | Python | TypeScript + Vercel AI SDK |
| REST HTTP server | Python FastAPI | NestJS (keep existing) |
| CLI | Rust (ov_cli) | Node.js scripts |

---

## Storage hierarchy (must match OpenViking exactly)

### Filesystem layer (VFS)

OpenViking uses AGFS (Go file server) to store actual file content on disk under a Viking URI namespace.
We replace this with a **SQLite-backed virtual filesystem** mapping `viking://...` URIs to file content rows.

URI namespace:
```
viking://user/{user_space}/memories/          ← user memories directory
viking://agent/{agent_space}/memories/        ← agent memories directory
viking://agent/{agent_space}/skills/          ← agent skills directory
viking://resources/                           ← shared resources directory
viking://session/{session_id}/                ← session scratch space
```

Each "directory" can contain:
- Regular files (L2 content, `.md`, `.txt`, etc.)
- `.abstract.md` — L0 abstract for the directory (auto-generated)
- `.overview.md` — L1 overview for the directory (auto-generated)
- Subdirectories

### Vector layer (VikingDB)

Single unified collection. Each vector record has:

| Field | Type | Description |
|---|---|---|
| `id` | string (PK) | MD5 of `{account_id}:{uri}` (deterministic) |
| `uri` | path | Viking URI of the content |
| `parent_uri` | path | Parent directory URI |
| `type` | string | Reserved for future (file/directory/image/etc.) |
| `context_type` | string | `"memory"` \| `"resource"` \| `"skill"` |
| `level` | int | `0`=L0 abstract, `1`=L1 overview, `2`=L2 detail |
| `vector` | float[] | Dense embedding vector |
| `sparse_vector` | map | Sparse vector (BM25/SPLADE) — can omit v1 |
| `abstract` | string | Short summary text (≤256 chars) |
| `name` | string | Filename |
| `description` | string | Optional description |
| `tags` | string | Comma-separated tags |
| `account_id` | string | Tenant account |
| `owner_space` | string | User/agent space name (empty = global/resources) |
| `created_at` | datetime | Creation timestamp |
| `updated_at` | datetime | Last update timestamp |
| `active_count` | int | Access counter (for hotness scoring) |

### L0 / L1 / L2 — the core hierarchy

**L2 (DETAIL, level=2):** Individual files. The actual content.
- URI: `viking://user/{space}/memories/2026-03-22.md`
- Vectorized using file content (chunked if >2000 chars, with 200 char overlap)
- Chunks get URI suffix: `...#chunk_0000`, `...#chunk_0001` etc., parent_uri = base file URI

**L1 (OVERVIEW, level=1):** Per-directory overview (`.overview.md`).
- URI: `viking://user/{space}/memories/.overview.md`
- LLM-generated narrative overview of all files in the directory
- Max ~4000 chars
- Vectorized as single record

**L0 (ABSTRACT, level=0):** Per-directory abstract (`.abstract.md`).
- URI: `viking://user/{space}/memories/.abstract.md`
- Extracted from first paragraph of L1 overview
- Max ~256 chars
- Vectorized as single record

**L0/L1 are directory-level, never per-file or per-chunk.**
They are regenerated bottom-up whenever files in a directory change.

---

## API surface (must match OpenViking exactly)

All endpoints under `/api/v1`. Response envelope: `{ "status": "ok"|"error", "result": ... }`.

### Filesystem (`/api/v1/fs`)
```
GET  /fs/ls     ?uri=&simple=&recursive=&output=&abs_limit=&show_all_hidden=&node_limit=
GET  /fs/tree   ?uri=&output=&abs_limit=&show_all_hidden=&node_limit=&level_limit=
GET  /fs/stat   ?uri=
POST /fs/mkdir  { uri }
DEL  /fs        ?uri=&recursive=
POST /fs/mv     { from_uri, to_uri }
```

### Content (`/api/v1/content`)
```
GET  /content/read      ?uri=&offset=&limit=    ← read L2 file content
GET  /content/abstract  ?uri=                   ← read L0 (.abstract.md)
GET  /content/overview  ?uri=                   ← read L1 (.overview.md)
GET  /content/download  ?uri=                   ← raw bytes
POST /content/reindex   { uri, regenerate, wait }
```

### Search (`/api/v1/search`)
```
POST /search/find   { query, target_uri, limit, score_threshold, filter, telemetry }
POST /search/search { query, target_uri, session_id, limit, score_threshold, filter }
POST /search/grep   { uri, pattern, case_insensitive, node_limit }
POST /search/glob   { pattern, uri, node_limit }
```

### Resources & Skills (`/api/v1`)
```
POST /resources/temp_upload  (multipart file upload)
POST /resources   { path|temp_path, to, parent, reason, instruction, wait, timeout, ... }
POST /skills      { data|temp_path, wait, timeout }
```

### Sessions (`/api/v1/sessions`)
```
POST   /sessions
GET    /sessions
GET    /sessions/{id}
DEL    /sessions/{id}
POST   /sessions/{id}/commit     { wait }
POST   /sessions/{id}/extract
POST   /sessions/{id}/messages   { role, content|parts }
POST   /sessions/{id}/used       { contexts, skill }
```

### Relations (`/api/v1/relations`)
```
GET  /relations         ?uri=
POST /relations/link    { from_uri, to_uris, reason }
DEL  /relations/link    { from_uri, to_uri }
```

### System
```
GET /health
GET /ready
GET /api/v1/system/status
POST /api/v1/system/wait
GET /api/v1/tasks/{task_id}
GET /api/v1/tasks
```

### Admin (`/api/v1/admin`) — multi-tenant, can be v2
```
POST /accounts
GET  /accounts
DEL  /accounts/{id}
POST /accounts/{id}/users
GET  /accounts/{id}/users
DEL  /accounts/{id}/users/{uid}
PUT  /accounts/{id}/users/{uid}/role
POST /accounts/{id}/users/{uid}/key
```

---

## Semantic processing pipeline

This is the core intelligence layer. Must be async queue-based like OpenViking.

### Queue architecture
1. **SemanticQueue** — triggers L0/L1 generation for a directory
2. **EmbeddingQueue** — triggers vector embedding for a single Context record

### SemanticProcessor flow (per directory)
1. List all files in directory
2. For each file: generate a per-file summary (LLM call with file content, max 30k chars)
3. Collect all subdirectory `.abstract.md` files
4. Generate `.overview.md` (L1) from file summaries + child abstracts (LLM call)
   - If prompt > 60k chars: batch files in groups of 50, merge partial overviews
5. Extract `.abstract.md` (L0) from first paragraph of overview
6. Enforce size limits: overview ≤ 4000 chars, abstract ≤ 256 chars
7. Write `.abstract.md` and `.overview.md` to VFS
8. Enqueue L0 and L1 to EmbeddingQueue

### Memory-specific flow
- Memory files go directly to EmbeddingQueue (no per-file LLM summary)
- If file > 2000 chars: chunk with 200 char overlap, each chunk = separate vector record
- Base record always enqueued too (using abstract as vector text)
- After all files processed: generate L0/L1 for the memories directory

### Chunking
```typescript
function chunkText(text: string, chunkSize = 2000, overlap = 200): string[] {
  // Split at paragraph boundaries (\n\n) where possible
  // Each chunk: text.slice(start, end), start advances by chunkSize - overlap
}
```

---

## Retrieval (hierarchical)

The search must implement OpenViking's hierarchical retriever, not flat vector similarity.

### Algorithm
1. **Global search** — search entire collection for top-5 matching records across all levels
2. **Determine starting points** — combine global results (non-L2) + root URIs for context_type
3. **Recursive search** — priority queue traversal:
   - Pop directory URI with highest score
   - Search children of that directory
   - Score propagation: `final_score = 0.5 * child_score + 0.5 * parent_score`
   - If child is L2 (file): add to candidates
   - If child is L0/L1 (directory): add to queue for further traversal
   - Convergence: stop if top-K unchanged for 3 rounds
4. **Rerank** (optional): if rerank model configured, rerank using abstract text
5. **Hotness boost**: `final_score = 0.8 * semantic_score + 0.2 * hotness_score`
   - `hotness_score` based on `active_count` and `updated_at` recency

### Root URIs by context type
- `memory` → `viking://user/{space}/memories`, `viking://agent/{space}/memories`
- `resource` → `viking://resources`
- `skill` → `viking://agent/{space}/skills`
- `null` → all of the above

---

## Session model

A session is a conversation context that accumulates messages and is committed to extract memories.

### Session lifecycle
1. `POST /sessions` — create session, initialize user/agent directories
2. `POST /sessions/{id}/messages` — append messages (role + content or parts)
3. `POST /sessions/{id}/used` — record which contexts/skills were actually used
4. `POST /sessions/{id}/commit` — extract memories + archive session
   - LLM extracts key facts from conversation
   - Each fact = new memory file written to VFS
   - Triggers SemanticQueue for affected memory directories
5. `DELETE /sessions/{id}` — delete session

### Message parts
- `TextPart`: `{ type: "text", text: string }`
- `ContextPart`: `{ type: "context", uri, context_type, abstract }`
- `ToolPart`: `{ type: "tool", tool_id, tool_name, tool_uri, skill_uri, tool_input, tool_output, tool_status }`

---

## What to keep from current viking-ts

- NestJS server structure and module layout
- Vercel AI SDK integration (llm.service.ts)
- Embedding service pattern
- OpenClaw plugin package
- Ingest script (needs updates for new API)
- Build tooling, package.json structure
- `~/.viking-ts/config.json` config format (extend, don't replace)

## What to rewrite

- **Storage layer**: replace vectra + SQLite metadata split → unified SQLite schema (VFS table + vector table)
- **Memory service**: remove flat CRUD → VFS-based file write + queue trigger
- **Resource service**: implement full add_resource flow with parse → VFS → semantic queue
- **Viking URI service**: full hierarchical VFS operations (ls, tree, stat, mkdir, rm, mv, grep, glob)
- **Content service**: read/abstract/overview/download endpoints against VFS
- **Search service**: implement hierarchical retriever (replace flat vector search)
- **Session service**: full lifecycle with message parts, commit → memory extraction
- **Relations service**: link/unlink between URIs (stored in SQLite)
- **Semantic processor**: async queue + LLM pipeline for L0/L1 generation
- **Embedding queue**: async vectorization pipeline

---

## Tech constraints

- **Runtime**: Node.js ≥ 18, TypeScript strict mode
- **Framework**: NestJS (keep)
- **Vector store**: SQLite with `sqlite-vss` extension OR keep vectra (pure TS) — prefer vectra for zero native deps
- **VFS storage**: SQLite via better-sqlite3 (keep)
- **LLM**: Vercel AI SDK (keep, already supports openai/anthropic/ollama)
- **Embedding**: OpenAI-compatible API (keep)
- **No new native dependencies** beyond what's already in use

---

## Out of scope for this rewrite (v2+)

- Admin/multi-tenant API
- Pack/export/import (.ovpack format)
- Sparse vectors (BM25/SPLADE)
- Media file handling (image/audio/video parsing)
- Watch tasks (automatic resource monitoring)
- Observer/telemetry endpoints
- Bot/chat endpoints
