# Known Issues & Limitations

This document tracks known correctness gaps, concurrency limitations, and architectural divergences from OpenViking. Each entry includes a description, impact assessment, and concrete fix directions.

---

## KI-001 — Session Commit Race Condition

**Severity:** Low (single-process SQLite deployments), High (multi-process / PostgreSQL)
**Affects:** `POST /api/v1/sessions/:id/commit`
**Introduced:** Phase 6

### Description

`commitAsync()` returns a `task_id` immediately and runs the actual commit in a background async closure. The messages snapshot (`getMessages()`) happens inside that closure, not before it. This creates a race window:

```
t0: commitAsync() called → task created, background job queued
t1: [async gap] — other addMessage() calls can still write to session_messages
t2: doCommit() runs → getMessages() snapshots DB → includes messages added at t1
t3: DELETE FROM session_messages — deletes t1 messages without caller knowing
```

In a single-process Node.js app with SQLite (synchronous `better-sqlite3`), this window is extremely narrow (sub-millisecond) and unlikely to cause observable problems in practice. However, it is not safe under:
- Multiple Node.js processes sharing the same DB
- PostgreSQL with concurrent connection pools
- High-throughput agents sending messages at commit time

### OpenViking's approach

OpenViking uses a **redo-log** pattern: before Phase 1 begins, it writes a "pending commit" record to a redo-log on disk. If the process crashes mid-commit, the redo-log enables recovery on restart. The session row is also locked during the critical section.

### Fix options

**Option A — PostgreSQL `SELECT FOR UPDATE` (recommended for PostgreSQL migration)**
```sql
BEGIN;
-- Lock session row for the duration of commit
SELECT session_id FROM sessions WHERE session_id = $1 FOR UPDATE;
-- Snapshot messages atomically
SELECT * FROM session_messages WHERE session_id = $1 ORDER BY created_at ASC;
-- Clear messages in the same transaction
UPDATE sessions SET message_count = 0, compression_index = $2, updated_at = $3
  WHERE session_id = $1;
DELETE FROM session_messages WHERE session_id = $1;
COMMIT;
-- Then run LLM + memory extraction OUTSIDE the transaction using the snapshot
```
This ensures `addMessage()` calls that arrive after the lock is acquired either block (serialise) or write to an already-empty table after commit completes.

**Option B — Snapshot before background dispatch (quick SQLite fix)**
Move `getMessages()` to before `runCommitInBackground()` is called, and pass the snapshot into the closure:
```typescript
async commitAsync(sessionId: string) {
  const messages = this.getMessages(sessionId); // snapshot synchronously
  this.runCommitInBackground(sessionId, task.task_id, messages); // pass snapshot
}
```
This closes the race for single-process deployments at the cost of holding the message array in memory. Does not help with multi-process.

**Option C — Redo-log (full OpenViking parity)**
Write a pending-commit intent record to a `commit_log` table (or file) before Phase 1. On server startup, replay any incomplete commits. Most robust but most complex.

### Recommended action

For Phase 7 / PostgreSQL migration: implement Option A as part of the PostgreSQL backend port.
For now: document as known gap, acceptable for single-process SQLite.

---

## KI-002 — No Message Count Enforcement on Auto-Commit

**Severity:** Low
**Affects:** Session lifecycle
**Introduced:** Phase 4

### Description

OpenViking supports `auto_commit_threshold` — sessions are automatically committed when message count exceeds a configurable limit (default 8000 tokens). viking-ts has no auto-commit logic. Long-running sessions will accumulate messages indefinitely until manually committed.

### Fix direction

Add a config option `session.autoCommitThreshold` (message count, not token count for simplicity). In `addMessage()`, after inserting, check `message_count >= threshold` and trigger `commitAsync()` if exceeded. Token-based thresholding would require an LLM tokenizer count and is out of scope for now.

---

## KI-003 — Session Archive Not Indexed by Search

**Severity:** Medium
**Affects:** `/api/v1/search/search` session context
**Introduced:** Phase 6

### Description

Session archives are written to `viking://session/{id}/history/archive_{NNN}/` and enqueued to `SemanticQueueService`. However, `getContextForSearch()` only returns current (uncommitted) session messages — it returns `summaries: []`, meaning the archive summaries are never included in the intent analysis context for `/search/search`.

In OpenViking, `session.get_context_for_search()` reads the archive `.overview.md` files and passes them as `session_summary` to the `IntentAnalyzer`. This allows the LLM to use the full conversation history (not just the current window) when planning search queries.

### Fix direction

Update `SessionService.getContextForSearch()` to:
1. List `viking://session/{id}/history/` VFS directory
2. Read `.overview.md` from each `archive_NNN` subdir
3. Return as `summaries` array (most recent N archives, e.g. last 3)

---

## KI-004 — Memory Dedup Uses In-Memory Vector Store Only

**Severity:** Low (correctness), Medium (scale)
**Affects:** `MemoryDeduplicatorService.findSimilarMemories()`
**Introduced:** Phase 6

### Description

`findSimilarMemories()` calls `ContextVectorService.searchByParentUri()` which searches the SQLite-backed vector store. Vector records are only present if the EmbeddingQueue has processed the file. New memories written in the same session commit may not yet be vectorised when dedup runs, so back-to-back identical memories in a single commit may not be caught.

### Fix direction

Flush `EmbeddingQueueService` before running dedup (wait for queue drain), or run dedup before writing (check existing VFS files by URI prefix without relying on vectors). The VFS-based approach is simpler and doesn't require queue drain.

---

## KI-005 — No Multi-Tenant / Account Isolation

**Severity:** Low (single-tenant deployments), High (multi-tenant)
**Affects:** All storage operations
**Introduced:** Phase 1

### Description

All operations use `account_id = 'default'` and `owner_space = 'default'`. The `account_id` field exists in the schema and is passed through the pipeline, but no access control or tenant isolation is enforced. Any API caller can read/write any account's data.

OpenViking has an `APIKeyManager` + `RequestContext` with `account_id` and `role` that enforces tenant boundaries at the storage layer.

### Fix direction

Phase 7 (config) adds proper `account_id` and `user_id` to requests via config or auth header (`X-OpenViking-Account`, `X-OpenViking-User`, `X-OpenViking-Agent`). Full multi-tenant auth is out of scope for the drop-in port but the schema supports it.

---

## KI-006 — Rerank Not Implemented

**Severity:** Low (optional feature)
**Affects:** `HierarchicalRetrieverService`
**Introduced:** Phase 3

### Description

OpenViking supports an optional rerank model that re-scores retrieved candidates using a cross-encoder before applying hotness boost. The `rerank_config` is checked at startup; if not configured, vector scores are used directly. viking-ts skips rerank entirely.

### Fix direction

Covered in Phase 7 spec (`PHASE7-SPEC.md`). Add `rerank.*` config section; if `rerank.model` is set, call the rerank API after retrieval and before hotness boost. Use existing `HOTNESS_ALPHA` constant for the final blending step.

---

## KI-007 — `POST /content/reindex` Does Not Support Background Task Tracking

**Severity:** Low
**Affects:** `POST /api/v1/content/reindex`
**Introduced:** Phase 1

### Description

OpenViking's `/content/reindex` supports `wait: false` which runs reindex in the background and returns a `task_id`. The current implementation accepts the `wait` field but always runs synchronously regardless of its value.

### Fix direction

Wire `TaskTrackerService` into `ContentController.reindex()`. When `wait: false`, create a task, run `SemanticQueueService.enqueue()` + `EmbeddingQueueService.enqueue()` in background, return `{task_id, status: 'accepted'}`.
