# viking-ts vs OpenViking — Parity Review
**Date:** 2026-03-23  
**Scope:** Phases 1–3 (VFS + Storage, Async Queue, Hierarchical Search)  
**Baseline:** `feature/phase3-hierarchical-search` @ commit 04c0b34

---

## Summary

| Category | Status |
|---|---|
| Filesystem endpoints | ⚠️ Minor gaps |
| Content endpoints | ✅ Parity |
| Search endpoints | ⚠️ Minor gaps |
| Resources/Skills endpoints | 🔴 Significant drift |
| Sessions endpoints | 🔴 Missing (Phase 4) |
| System/Tasks endpoints | 🔴 Missing |
| Hierarchical retriever algorithm | ✅ Parity (constants match) |
| Queue pipeline | ✅ Parity |

---

## ✅ Confirmed Parity

### Filesystem (`/api/v1/fs`)
- `GET /fs/ls` ✅ — all params present (uri, simple, recursive, output, abs_limit, show_all_hidden, node_limit)
- `GET /fs/tree` ✅ — all params present
- `GET /fs/stat` ✅
- `POST /fs/mkdir` ✅
- `DELETE /fs` ✅ with recursive param
- `POST /fs/mv` ✅ (from_uri, to_uri)

### Content (`/api/v1/content`)
- `GET /content/read` ✅ (uri, offset, limit)
- `GET /content/abstract` ✅
- `GET /content/overview` ✅
- `GET /content/download` ✅
- `POST /content/reindex` ✅ (uri, regenerate, wait)

### Search algorithm
- All 6 constants match OpenViking exactly ✅
- Score propagation formula: `0.5 * child + 0.5 * parent` ✅
- Hotness boost: `0.8 * semantic + 0.2 * hotness` ✅
- Convergence: stop after 3 unchanged top-K rounds ✅

---

## ⚠️ Minor Gaps (Low Risk — quick fixes)

### 1. `/api/v1/fs` — missing `limit` alias for `node_limit`
**OpenViking:** `ls` and `tree` accept both `node_limit` AND `limit` (alias).  
**viking-ts:** Only `node_limit`. Missing `limit` alias.  
**Fix:** Add `limit?: number` to `LsQueryDto` and `TreeQueryDto`; resolve actual limit as `limit ?? node_limit`.

### 2. `/api/v1/search` — default `limit` should be 10, not 5
**OpenViking:** `FindRequest.limit = 10`, `SearchRequest.limit = 10`.  
**viking-ts:** Defaults to `5` in the controller (`dto.limit ?? 5`).  
**Fix:** Change default from `5` to `10`.

### 3. `/api/v1/search` — missing `node_limit` as alias in find/search DTOs
**OpenViking:** Both `find` and `search` accept `node_limit` as override; actual limit = `node_limit ?? limit`.  
**viking-ts:** `node_limit` is in GrepRequestDto and GlobRequestDto but NOT in FindRequestDto or SearchRequestDto.  
**Fix:** Add `node_limit?: number` to `FindRequestDto` and `SearchRequestDto`; apply same alias pattern.

### 4. `/api/v1/search/search` — session_id ignored
**OpenViking:** `session_id` in SearchRequest is used to boost memories from an active session.  
**viking-ts:** Field is accepted in DTO but the controller passes it to the same `find()` call — session context is not used.  
**Fix:** Phase 4 concern, but the field should at minimum be wired through (even if boost logic ships with sessions).

---

## 🔴 Significant Drift

### 5. Resources endpoint — completely different API shape
**OpenViking:**
- `POST /api/v1/resources/temp_upload` — multipart file upload, returns `temp_path`
- `POST /api/v1/resources` — `{ path|temp_path, to, parent, reason, instruction, wait, timeout, strict, ... }`
- `POST /api/v1/skills` — `{ data|temp_path, wait, timeout }`

**viking-ts:**
- `POST /api/v1/resources` — `{ title, text, url, uri }` — flat CRUD, no VFS, no temp_upload, no semantic pipeline trigger
- `GET /api/v1/resources/search` — exists but uses flat embedding, not hierarchical
- `GET /api/v1/resources`, `GET /api/v1/resources/:id`, `DELETE /api/v1/resources/:id` — not in OpenViking spec
- No `POST /api/v1/skills` at all
- No `POST /api/v1/resources/temp_upload`

**Risk:** High. This is the primary way external agents add content to the memory system. The current resource controller is pre-rewrite legacy. Needs full replacement.

**Fix:** Replace resource controller with OpenViking-faithful implementation:
- `POST /resources/temp_upload` — multipart upload to temp dir, return `temp_path`
- `POST /resources` — accept OpenViking shape, write to VFS, trigger SemanticQueue
- `POST /skills` — accept OpenViking shape, write skill to VFS

### 6. Sessions endpoint — stub only, not OpenViking-faithful
**OpenViking:**
- `POST /api/v1/sessions` — create session (returns session_id + user)
- `GET /api/v1/sessions` — list sessions
- `GET /api/v1/sessions/{id}` — get session
- `DELETE /api/v1/sessions/{id}` — delete session
- `POST /api/v1/sessions/{id}/commit` — background commit, returns task_id
- `POST /api/v1/sessions/{id}/extract` — extract memories from session
- `POST /api/v1/sessions/{id}/messages` — append message (simple content OR parts array)
- `POST /api/v1/sessions/{id}/used` — record used contexts/skills

**viking-ts:**
- `POST /api/v1/sessions/capture` — non-standard, bulk JSON ingest (not in OpenViking spec)
- None of the above OpenViking endpoints exist

**Note:** This is Phase 4 scope and expected to be missing.

### 7. System endpoints — missing
**OpenViking:**
- `GET /health` ✅ (exists)
- `GET /ready` 🔴 — readiness probe with subsystem checks (AGFS, VectorDB, APIKeyManager)
- `GET /api/v1/system/status` 🔴
- `POST /api/v1/system/wait` 🔴 — wait for queue drain

**viking-ts:** Only `/health` exists. `/ready`, `/api/v1/system/status`, `/api/v1/system/wait` are missing.

### 8. Task tracker endpoints — missing
**OpenViking:**
- `GET /api/v1/tasks/{task_id}` — poll background task status
- `GET /api/v1/tasks` — list tasks with filter

**viking-ts:** No task tracker. The queue observer (`GET /api/v1/observer/queues`) is a partial substitute but not compatible.

**Note:** Task tracker is needed for async session commit and async reindex (both of which return `task_id`).

---

## Recommended Fix Priority

### Before Phase 4 (pre-condition fixes)

| # | Fix | Effort |
|---|---|---|
| 1 | Search default `limit` 5→10 | Trivial |
| 2 | Add `node_limit` alias to FindRequestDto/SearchRequestDto | Trivial |
| 3 | Add `limit` alias to LsQueryDto/TreeQueryDto | Trivial |
| 4 | Task tracker service + `/api/v1/tasks` endpoints | Small (needed by sessions commit) |
| 5 | Add `/ready` + `/api/v1/system/status` + `/api/v1/system/wait` | Small |

### Phase 4 scope (sessions bring this in naturally)
| # | Fix | Effort |
|---|---|---|
| 6 | Full sessions endpoint (Phase 4 core) | Large |
| 7 | Resources endpoint rewrite (VFS-backed, temp_upload, skills) | Medium |

---

## Files to change for pre-condition fixes

- `packages/server/src/fs/fs.dto.ts` — add `limit` alias to Ls/Tree DTOs
- `packages/server/src/fs/fs.controller.ts` — apply `limit ?? node_limit` resolution
- `packages/server/src/search/search.dto.ts` — add `node_limit` to Find/Search DTOs; fix default limit
- `packages/server/src/search/search.controller.ts` — apply `node_limit ?? limit` + default 10
- `packages/server/src/` — add `system/` module (ready, status, wait)
- `packages/server/src/` — add `tasks/` module (task tracker + GET tasks/:id, GET tasks)
