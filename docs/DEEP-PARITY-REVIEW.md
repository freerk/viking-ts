# viking-ts Deep Parity Review
**Date:** 2026-03-23
**Scope:** Phases 1–4 — deep check including prompts, search, config, progressive loading
**Baseline:** `feature/phase4-sessions` @ commit 9ecfec6

---

## Executive Summary

The API surface is largely faithful. The major gaps are in **LLM prompts**, **search intent analysis** (the `/search/search` progressive loading path), **memory deduplication**, and **config surface**. These are the last things standing between viking-ts and a true OpenViking drop-in.

---

## 1. LLM Prompts — Major Gap 🔴

### What OpenViking uses
OpenViking has a prompt template system (`openviking/prompts/templates/`) with YAML files for every LLM call. The prompts are highly engineered:

| Prompt ID | Used for |
|---|---|
| `semantic.file_summary` | Generate per-file summary (50–150 words) |
| `semantic.document_summary` | Generate summary for Markdown/RST/txt docs |
| `semantic.overview_generation` | Generate L1 `.overview.md` for a directory |
| `compression.memory_extraction` | Extract 6-category memories from session (version 5.2.0) |
| `compression.memory_merge` | Merge new memory into existing file |
| `compression.dedup_decision` | Decide skip/create/merge/delete for dedup |
| `retrieval.intent_analysis` | Analyze session context → generate multi-type `TypedQuery` plan |

### What viking-ts uses
All LLM calls use ad-hoc inline prompts in `LlmService`:
- `summarizeFile()` — "Summarize this file in 2-3 sentences" (vs. 50–150 word structured prompt)
- `generateDirectoryOverview()` — bare instruction string (vs. structured Markdown template with Quick Navigation, Detailed Description sections)
- `extractMemories()` — simplified prompt that returns `[{text, category}]` (vs. the full 200-line extraction prompt with all 8 categories, few-shot examples, anti-injection rules, temporal precision rules, etc.)
- Session extractor uses a simplified 10-line prompt (vs. the full `memory_extraction.yaml` v5.2.0)

**Impact:** Memory quality and retrieval quality both depend critically on prompt fidelity. The simplified prompts will produce structurally wrong outputs (wrong abstract format, missing L0/L1/L2 separation, wrong category handling for tools/skills, no dedup-key format).

**Fix needed:** Port the 7 core prompts exactly. Store as template strings in a `prompts/` module. Wire into `LlmService`.

---

## 2. Search — `POST /search/search` Missing Intent Analysis 🔴

### What OpenViking does
When `session_id` is provided to `/search/search`:
1. Load session → call `session.get_context_for_search(query)` → returns `{summaries, recent_messages}`
2. Run `IntentAnalyzer.analyze()` — calls LLM with `retrieval.intent_analysis` prompt
3. LLM produces a **QueryPlan**: multiple `TypedQuery` objects (memory + resource + skill), each with its own query text and priority
4. Run each `TypedQuery` through `HierarchicalRetriever` concurrently
5. Merge results across all typed queries → `FindResult{memories, resources, skills}`

### What viking-ts does
`POST /search/search` with `session_id` → calls the same `find()` as `POST /search/find`, ignoring the session entirely.

**Impact:** The distinction between `/search/find` (no session, direct vector search) and `/search/search` (session-aware, intent-analyzed, multi-query) is the core value proposition of OpenViking. Without it, session-aware search is identical to basic search.

**Fix needed:**
- Implement `IntentAnalyzer` service (port `intent_analyzer.py`)
- Wire into `SearchService.search()` when `sessionId` provided
- `FindResult` response shape must include `memories[]`, `resources[]`, `skills[]` (currently returns flat `contexts[]`)

---

## 3. FindResult Response Shape — Gap 🔴

### What OpenViking returns
```json
{
  "status": "ok",
  "result": {
    "memories": [...MatchedContext],
    "resources": [...MatchedContext],
    "skills": [...MatchedContext]
  }
}
```

### What viking-ts returns
```json
{
  "status": "ok",
  "result": {
    "contexts": [...MatchedContext]
  }
}
```

**Fix needed:** Change response shape for both `/find` and `/search` to `{ memories, resources, skills }`.

---

## 4. Memory Deduplication — Missing 🔴

### What OpenViking does
After `SessionCompressor.extract_long_term_memories()`:
1. For each candidate memory: search for similar existing memories via `ContextVectorService`
2. Call LLM with `compression.dedup_decision` prompt → `{decision: 'skip'|'create'|'none', actions: [{id, action: 'merge'|'delete'}]}`
3. If `merge`: call LLM with `compression.memory_merge` prompt to combine existing + new content
4. If `delete`: remove old memory from VFS + vector store
5. Only `create` if no duplicates

### What viking-ts does
`SessionMemoryWriterService` writes memories to VFS unconditionally. For `profile` it appends, but no LLM-based dedup/merge for other categories.

**Impact:** Memory store grows unbounded with duplicates. The `ALWAYS_MERGE_CATEGORIES` (profile), `MERGE_SUPPORTED_CATEGORIES` (preferences, entities, patterns), and dedup-skip categories each require different handling.

**Fix needed:** Implement `MemoryDeduplicatorService` using the `dedup_decision.yaml` and `memory_merge.yaml` prompts.

---

## 5. Session Archive — Missing 🔴

### What OpenViking does on commit
**Phase 1 (archive):**
1. Generate archive summary via LLM (`compression.structured_summary` prompt)
2. Write `{session_uri}/history/archive_NNN/` to VFS (contains messages JSONL + abstract + overview)
3. Clear session messages

**Phase 2 (memory extraction):**
1. Run `SessionCompressor.extract_long_term_memories()` → dedup → write to VFS → enqueue

### What viking-ts does
Commit runs `SessionExtractorService` → `SessionMemoryWriterService`. No archive phase. Session messages are not cleared after commit. No compression counter.

**Fix needed:** Implement two-phase commit: archive first (write to VFS history dir, clear messages), then extract + dedup.

---

## 6. Config Surface — Partial 🟡

### What OpenViking configures
```yaml
# ~/.viking/config.yaml
storage:
  path: ~/.viking/data
embedding:
  model: text-embedding-3-small
  api_key: ...
  api_base: ...
  dimension: 1536
vlm:                          # LLM for semantic processing
  model: gpt-4o
  api_key: ...
  api_base: ...
rerank:                       # Optional rerank model
  model: ...
semantic:
  max_file_content_chars: 30000
  max_overview_prompt_chars: 60000
  overview_batch_size: 50
  abstract_max_chars: 256
  overview_max_chars: 4000
  memory_chunk_chars: 2000
  memory_chunk_overlap: 200
default_search_mode: thinking
default_search_limit: 3
```

### What viking-ts configures
`config.ts` has: `storage.path`, `embedding.*`, `llm.*`. Missing: `semantic.*` section (hardcoded constants), `rerank.*`, `default_search_mode`, `default_search_limit`.

**Fix needed:** Add `semantic.*` config section that maps to the `SemanticConfig` defaults. Currently these are hardcoded in `semantic-processor.service.ts` and `search/hierarchical-retriever.service.ts`.

---

## 7. Semantic Processor Prompt Fidelity — Gap 🟡

### What OpenViking does in L0/L1 generation
- **File summary**: uses `semantic.file_summary` (50–150 words) or `semantic.document_summary` for `.md/.txt/.rst` files
- **Overview**: uses `semantic.overview_generation` — structured Markdown with Title, Brief Description, Quick Navigation (decision tree with file number refs `[1]`, `[2]`), Detailed Description sections
- **Abstract extraction**: skip leading `#` lines, take first non-empty non-header paragraph, enforce 256-char limit with `...` truncation

### What viking-ts does
- File summary: "Summarize this file in 2-3 sentences" (no length constraint, no keyword inclusion requirement)
- Overview: bare instruction with no structure requirement (no Quick Navigation, no file numbering)
- Abstract extraction: `extractAbstractFromOverview()` skips `#` lines and returns first trimmed line — functionally correct

**Fix:** Port `semantic.file_summary`, `semantic.document_summary`, and `semantic.overview_generation` prompts exactly, including the file numbering `[1]`, `[2]` replacement post-processing.

---

## 8. Semantic Processor — Budget Guard + Batching 🟡

### What OpenViking does
When overview prompt would exceed `max_overview_prompt_chars` (60k):
- Many files → batch into groups of `overview_batch_size` (50), generate partial overviews, merge
- Few files with long summaries → truncate summaries proportionally to fit budget

### What viking-ts does
No budget guard. Overview prompt can be arbitrarily large.

**Fix:** Add budget check and batching logic.

---

## 9. Memory Extraction — Response Shape 🟡

### What OpenViking returns from extraction
The `memory_extraction.yaml` prompt produces 8 categories including `tools` and `skills` with additional fields (`tool_name`, `skill_name`, `best_for`, `optimal_params`, `common_failures`, etc.).

### What viking-ts extracts
The simplified prompt only returns `{category, abstract, overview, content}` — no `tools`/`skills` categories, no extended fields.

**Fix:** Port the full 8-category extraction with extended fields for tools/skills. The path routing for tools/skills should go to `memories/tools/` and `memories/skills/` directories.

---

## Prioritised Fix Plan

| Priority | Item | Effort |
|---|---|---|
| P0 | Port all 7 LLM prompts exactly (memory_extraction, file_summary, document_summary, overview_generation, memory_merge, dedup_decision, intent_analysis) | Medium |
| P0 | Fix FindResult response shape: `{memories, resources, skills}` (not `{contexts}`) | Trivial |
| P0 | Implement IntentAnalyzer + wire into `/search/search` | Medium |
| P1 | Implement MemoryDeduplicatorService (dedup_decision + memory_merge) | Medium |
| P1 | Two-phase session commit (archive phase + clear messages) | Small |
| P2 | Add `semantic.*` config section (expose hardcoded constants) | Trivial |
| P2 | Add budget guard + batching to SemanticProcessor | Small |
| P3 | Add `tools`/`skills` memory categories + extended fields | Small |

---

## What Is Already Correct

- ✅ All API endpoint routes and HTTP methods
- ✅ `limit` alias, `node_limit` alias, default limits
- ✅ Task tracker + system endpoints
- ✅ Hierarchical retriever algorithm constants (SCORE_PROPAGATION_ALPHA, HOTNESS_ALPHA, etc.)
- ✅ Score propagation formula, convergence logic, hotness scoring
- ✅ VFS schema (vfs_nodes, context_vectors, relations, sessions, session_messages)
- ✅ URI namespace (viking://user/, viking://agent/, viking://resources/)
- ✅ L0/L1/L2 level hierarchy in vector store
- ✅ Category → VFS path mapping (profile, preferences, entities, events, cases, patterns)
- ✅ Chunking constants (2000 chars, 200 overlap)
- ✅ Queue pipeline (SemanticQueue → SemanticProcessor → EmbeddingQueue)
- ✅ Async commit with task tracking
