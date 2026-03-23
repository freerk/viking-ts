# Phase 7 Spec — Config Surface + Semantic Processor Polish (P2)
**Status:** Queued — implement after Phase 6 is merged
**Branch:** `feature/phase7-config-semantic` → `feature/phase6-dedup-archive`

---

## Context

P2 gaps from `DEEP-PARITY-REVIEW.md`. Lower urgency — won't break correctness but needed for production deployability and full parity.

---

## Fix 1 — `semantic.*` Config Section

### Source to read first
- `/home/openclaw/code/OpenViking/openviking_cli/utils/config/parser_config.py` — `SemanticConfig`
- `/home/openclaw/code/viking-ts/packages/server/src/config.ts`

### Update `packages/server/src/config.ts`

Add `semantic` section with defaults matching OpenViking `SemanticConfig` exactly:

```typescript
semantic: {
  maxFileContentChars: parseInt(process.env.SEMANTIC_MAX_FILE_CONTENT_CHARS || '30000'),
  maxOverviewPromptChars: parseInt(process.env.SEMANTIC_MAX_OVERVIEW_PROMPT_CHARS || '60000'),
  overviewBatchSize: parseInt(process.env.SEMANTIC_OVERVIEW_BATCH_SIZE || '50'),
  abstractMaxChars: parseInt(process.env.SEMANTIC_ABSTRACT_MAX_CHARS || '256'),
  overviewMaxChars: parseInt(process.env.SEMANTIC_OVERVIEW_MAX_CHARS || '4000'),
  memoryChunkChars: parseInt(process.env.SEMANTIC_MEMORY_CHUNK_CHARS || '2000'),
  memoryChunkOverlap: parseInt(process.env.SEMANTIC_MEMORY_CHUNK_OVERLAP || '200'),
},
defaultSearchMode: process.env.DEFAULT_SEARCH_MODE || 'thinking',   // 'thinking' | 'fast'
defaultSearchLimit: parseInt(process.env.DEFAULT_SEARCH_LIMIT || '3'),
```

### Update `SemanticProcessorService` and `HierarchicalRetrieverService`

Replace all hardcoded constants with `ConfigService` lookups:
- `MAX_OVERVIEW_CHARS` → `config.get('semantic.overviewMaxChars', 4000)`
- `MAX_ABSTRACT_CHARS` → `config.get('semantic.abstractMaxChars', 256)`
- `MEMORY_CHUNK_SIZE` → `config.get('semantic.memoryChunkChars', 2000)`
- `MEMORY_CHUNK_OVERLAP` → `config.get('semantic.memoryChunkOverlap', 200)`
- `LLM_CONCURRENCY` — keep internal, not user-facing

### Update `.env.example`

Add all `SEMANTIC_*` vars with defaults and comments.

---

## Fix 2 — Semantic Processor Budget Guard + Batching

### Source to read first
- `/home/openclaw/code/OpenViking/openviking/storage/queuefs/semantic_processor.py` — `_generate_overview()`, `_batched_generate_overview()`, `_single_generate_overview()`

### Update `SemanticProcessorService.processDirectory()`

Add budget guard before generating overview:

```typescript
const estimatedSize = fileSummariesStr.length + childAbstractsStr.length;
const overBudget = estimatedSize > config.semantic.maxOverviewPromptChars;
const manyFiles = fileSummaries.length > config.semantic.overviewBatchSize;

if (overBudget && manyFiles) {
  // Batch: split fileSummaries into groups of overviewBatchSize
  // Generate partial overviews, then merge with a final LLM call
  overview = await this.batchedGenerateOverview(dirUri, fileSummaries, childAbstracts, fileIndexMap);
} else if (overBudget) {
  // Few files but long summaries: truncate proportionally
  const perFile = Math.max(100, Math.floor(config.semantic.maxOverviewPromptChars / fileSummaries.length));
  // truncate each summary to perFile chars
  overview = await this.singleGenerateOverview(...truncated);
} else {
  overview = await this.singleGenerateOverview(...);
}
```

File index map (`[1]` → filename replacement) must be applied after overview generation.

---

## Fix 3 — `tools` and `skills` Memory Categories

### Update `SessionExtractorService`

Extend `CandidateMemory` and `MemoryCategory` type to include `tools` and `skills`:

```typescript
export type MemoryCategory =
  | 'profile' | 'preferences' | 'entities' | 'events'
  | 'cases' | 'patterns'
  | 'tools' | 'skills';  // add these

export interface CandidateMemory {
  category: MemoryCategory;
  abstract: string;
  overview: string;
  content: string;
  language: string;
  // Extended fields for tools/skills (optional)
  toolName?: string;
  skillName?: string;
  bestFor?: string;
  optimalParams?: string;
  recommendedFlow?: string;
  keyDependencies?: string;
  commonFailures?: string;
  recommendation?: string;
}
```

### Update `SessionMemoryWriterService`

Add VFS path routing for `tools` and `skills`:
```typescript
// tools → viking://agent/{ownerSpace}/memories/tools/{toolName}.md
// skills → viking://agent/{ownerSpace}/memories/skills/{skillName}.md
```

Write extended fields (bestFor, optimalParams, etc.) as structured Markdown sections in the content.

---

## Fix 4 — `rerank.*` Config (Optional, skip if no rerank model available)

OpenViking supports an optional rerank model for improving retrieval quality.

### Update config.ts

```typescript
rerank: {
  model: process.env.RERANK_MODEL || '',        // empty = disabled
  apiKey: process.env.RERANK_API_KEY || '',
  apiBase: process.env.RERANK_API_BASE || '',
  threshold: parseFloat(process.env.RERANK_THRESHOLD || '0'),
},
```

### Update `HierarchicalRetrieverService`

If `rerank.model` is configured, call rerank API after retrieving candidates (before hotness boost).
Match OpenViking: use rerank score to replace semantic score for final ranking.
Skip gracefully if not configured (current behaviour).

---

## Tests

- `test/semantic-processor.service.spec.ts` (update) — budget guard triggers batching when `estimatedSize > maxOverviewPromptChars`
- `test/config.spec.ts` (update) — verify `semantic.*` defaults match OpenViking constants
- `test/session-extractor.service.spec.ts` (update) — tools/skills categories parsed with extended fields
- `test/session-memory-writer.service.spec.ts` (update) — tools/skills routed to correct VFS paths

---

## Acceptance criteria

1. All existing tests pass
2. `config.get('semantic.overviewMaxChars')` returns 4000 by default
3. All `SEMANTIC_*` env vars documented in `.env.example`
4. Budget guard triggers batching for directories with many large files
5. `tools` category writes to `memories/tools/{toolName}.md`
6. `skills` category writes to `memories/skills/{skillName}.md`
