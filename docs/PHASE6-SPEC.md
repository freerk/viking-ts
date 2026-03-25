# Phase 6 Spec — Memory Dedup + Session Archive (P1)
**Status:** Queued — implement after Phase 5 is merged
**Branch:** `feature/phase6-dedup-archive` → `feature/phase5-prompt-fidelity`

---

## Context

P1 gaps from `DEEP-PARITY-REVIEW.md`. Both require Phase 5 (prompts) to be in place first:
- `MemoryDeduplicatorService` needs `LlmService.decideDeduplicate()` and `LlmService.mergeMemory()`
- Two-phase commit needs `LlmService.generateArchiveSummary()` (which uses the structured_summary prompt)

---

## Fix 1 — Memory Deduplication

### Source to read first
- `/home/openclaw/code/OpenViking/openviking/session/memory_deduplicator.py` — full file
- `/home/openclaw/code/OpenViking/openviking/session/compressor.py` — `extract_long_term_memories()` method
- `/home/openclaw/code/OpenViking/openviking/prompts/templates/compression/dedup_decision.yaml`
- `/home/openclaw/code/OpenViking/openviking/prompts/templates/compression/memory_merge.yaml`

### Create `packages/server/src/session/memory-deduplicator.service.ts`

```typescript
// Match OpenViking's category constants exactly
const ALWAYS_MERGE_CATEGORIES = new Set(['profile']);
const MERGE_SUPPORTED_CATEGORIES = new Set(['preferences', 'entities', 'patterns']);
const TOOL_SKILL_CATEGORIES = new Set(['tools', 'skills']);

@Injectable()
export class MemoryDeduplicatorService {
  constructor(
    private readonly contextVector: ContextVectorService,
    private readonly vfs: VfsService,
    private readonly llm: LlmService,
    private readonly embedding: EmbeddingService,
  ) {}

  async deduplicate(
    candidate: CandidateMemory,
    accountId: string,
    ownerSpace: string,
  ): Promise<'created' | 'merged' | 'skipped'>

  // Flow (match memory_deduplicator.py):
  // 1. Embed candidate.content
  // 2. Search for similar existing memories (same context_type + category URI prefix, score > 0.7)
  // 3. If ALWAYS_MERGE_CATEGORIES (profile): skip dedup, always merge into existing file
  // 4. Call LlmService.decideDeduplicate(candidate, existingMemories)
  // 5. Handle decision:
  //    - 'skip': return 'skipped'
  //    - 'create': write new file, optionally delete flagged existing memories
  //    - 'none': execute per-item actions (merge/delete) without creating new memory
  // 6. For 'merge' actions: call LlmService.mergeMemory(), write merged content back to VFS
  // 7. For 'delete' actions: remove from VFS + ContextVectorService
  // 8. Enqueue changed files to EmbeddingQueueService

  private categoryUriPrefix(category: string, ownerSpace: string): string
  // Returns root URI for category search scope (match _category_uri_prefix from deduplicator.py):
  // profile → viking://user/{ownerSpace}/memories/profile.md
  // preferences → viking://user/{ownerSpace}/memories/preferences
  // entities → viking://user/{ownerSpace}/memories/entities
  // events → viking://user/{ownerSpace}/memories/events
  // cases → viking://agent/{ownerSpace}/memories/cases
  // patterns → viking://agent/{ownerSpace}/memories/patterns
}
```

### Wire into `SessionMemoryWriterService`

Replace unconditional VFS write with deduplication:
```typescript
for (const candidate of candidates) {
  if (ALWAYS_MERGE_CATEGORIES.has(candidate.category)) {
    await this.writeAndMerge(candidate, accountId, ownerSpace);
  } else {
    await this.deduplicator.deduplicate(candidate, accountId, ownerSpace);
  }
}
```

---

## Fix 2 — Two-Phase Session Commit

### Source to read first
- `/home/openclaw/code/OpenViking/openviking/session/session.py` — `commit_async()` method (lines 226–344)
- `/home/openclaw/code/OpenViking/openviking/prompts/templates/compression/structured_summary.yaml`
- `/home/openclaw/code/OpenViking/openviking/session/memory_archiver.py`

### Add `compression/structured_summary` prompt to `prompts.ts`

```typescript
export function archiveSummaryPrompt(messages: string): string
// Source: compression/structured_summary.yaml
// Generates a structured summary of archived messages for the history entry
```

### Update `SessionService.commitAsync()`

Implement two-phase commit matching OpenViking `commit_async()`:

**Phase 1 — Archive (before extraction):**
1. Generate archive summary via `LlmService.complete(archiveSummaryPrompt(messages))`
2. Extract abstract from summary (first non-header paragraph, ≤256 chars)
3. Write to VFS: `viking://session/{sessionId}/history/archive_{NNN:03d}/`
   - `archive_{NNN:03d}.jsonl` — messages serialized as JSONL
   - `.abstract.md` — archive abstract
   - `.overview.md` — archive summary
4. Increment `compression_index` on session record
5. Clear session messages (set `message_count = 0`)
6. Enqueue session archive dir to SemanticQueue

**Phase 2 — Memory extraction + dedup:**
1. Run `SessionExtractorService.extract(messages)` → CandidateMemory[]
2. For each candidate: run `MemoryDeduplicatorService.deduplicate()`
3. Update `memories_extracted` counter on session
4. Mark TaskTracker task as complete with result

**Return:**
```typescript
{
  session_id: string;
  status: 'committed';
  memories_extracted: number;
  archived: boolean;
  task_id: string;
}
```

---

## Tests

- `test/memory-deduplicator.service.spec.ts`
  - `deduplicate()` returns 'skipped' when LLM returns `decision: 'skip'`
  - `deduplicate()` returns 'merged' when LLM returns `decision: 'none' + action: 'merge'`
  - `deduplicate()` calls `LlmService.mergeMemory()` on merge action
  - `deduplicate()` removes file from VFS on delete action
  - profile category always merges without dedup
- `test/session.service.spec.ts` (update)
  - `commitAsync()` archives messages to VFS before extracting
  - `commitAsync()` clears session messages after archive
  - `commitAsync()` returns `archived: true` in result

---

## Acceptance criteria

1. All existing tests pass
2. `SessionService.commitAsync()` writes archive dir to VFS before extracting
3. Session messages are cleared after commit
4. `MemoryDeduplicatorService` correctly skips duplicates
5. Merge action produces LLM-merged content in VFS
6. Delete action removes memory from VFS + vector store
7. Profile always merges unconditionally
