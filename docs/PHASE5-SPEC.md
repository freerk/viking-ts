# Phase 5 Spec — Prompt Fidelity + Search Intent + FindResult Shape
**Status:** Dispatched 2026-03-23
**Branch:** `feature/phase5-prompt-fidelity` → `feature/phase4-sessions`
**Fixes:** P0 gaps from `DEEP-PARITY-REVIEW.md`

---

## Context

This phase closes the three P0 gaps that block drop-in compatibility with OpenViking:

1. **All LLM prompts are wrong** — ad-hoc inline strings instead of OpenViking's engineered templates
2. **`/search/search` ignores session** — no `IntentAnalyzer`, no multi-type `QueryPlan`
3. **FindResult shape is wrong** — returns `{contexts[]}` instead of `{memories[], resources[], skills[]}`

See `docs/DEEP-PARITY-REVIEW.md` for full analysis.

---

## Fix 1 — Port all LLM prompts exactly

### Source files to read first
All prompts live in `/home/openclaw/code/OpenViking/openviking/prompts/templates/`.
Read every relevant YAML before writing TypeScript. No paraphrasing — the prompts must match exactly.

### Create `packages/server/src/llm/prompts.ts`

A module that exports the exact prompt templates as TypeScript template literals.
Structure each as a function that takes the required variables and returns the filled prompt string.

```typescript
// Template variables must exactly match the YAML `variables` section

export function fileSummaryPrompt(fileName: string, content: string): string
// Source: semantic/file_summary.yaml
// Required: file_name, content
// Output: 50-150 word plain text summary, no markdown

export function documentSummaryPrompt(fileName: string, content: string): string
// Source: semantic/document_summary.yaml
// Required: file_name, content
// Output: 60-180 word summary with structure (purpose, sections, takeaways, audience)

export function overviewGenerationPrompt(
  dirName: string,
  fileSummaries: string,    // "- [1] filename: summary\n- [2] filename: summary"
  childrenAbstracts: string // "- dirname/: abstract\n..."
): string
// Source: semantic/overview_generation.yaml
// Required: dir_name, file_summaries, children_abstracts
// Output: Markdown with H1 title, brief description, Quick Navigation (decision tree with [N] refs), Detailed Description

export function memoryExtractionPrompt(
  user: string,
  recentMessages: string,
  outputLanguage: string,
  summary?: string,
  feedback?: string
): string
// Source: compression/memory_extraction.yaml (version 5.2.0)
// COPY THE FULL TEMPLATE EXACTLY — this is 200+ lines with category tables,
// few-shot examples for all 8 categories, anti-injection rules, temporal precision rules
// Required: user, recent_messages, output_language
// Optional: summary, feedback

export function memoryMergePrompt(
  existingContent: string,
  newContent: string,
  category: string,
  outputLanguage: string
): string
// Source: compression/memory_merge.yaml
// Required: existing_content, new_content, category, output_language

export function dedupDecisionPrompt(
  candidateAbstract: string,
  candidateOverview: string,
  candidateContent: string,
  existingMemories: string  // formatted list of existing similar memories
): string
// Source: compression/dedup_decision.yaml (version 3.3.1)
// COPY THE FULL TEMPLATE — includes critical delete boundary rules

export function intentAnalysisPrompt(
  recentMessages: string,
  currentMessage: string,
  compressionSummary?: string,
  contextType?: string,
  targetAbstract?: string
): string
// Source: retrieval/intent_analysis.yaml (version 2.0.0)
// COPY THE FULL TEMPLATE — includes context type style guide, query examples,
// step-by-step analysis method, output JSON schema
```

### Update `LlmService`

Replace all ad-hoc prompt strings with calls to `prompts.ts`. Add new methods:

```typescript
// Replace summarizeFile() — detect doc vs generic, use correct prompt
async summarizeFile(fileName: string, content: string): Promise<string>
// If fileName ends in .md/.txt/.rst → use documentSummaryPrompt
// Otherwise → use fileSummaryPrompt
// Cap content at 30000 chars before sending

// Replace generateDirectoryOverview()
async generateDirectoryOverview(
  dirName: string,
  fileSummaries: Array<{name: string; summary: string}>,
  childAbstracts: Array<{name: string; abstract: string}>,
): Promise<string>
// Build numbered file list: "[1] filename: summary"
// Build children string: "- dirname/: abstract"
// Use overviewGenerationPrompt()
// Post-process: replace [N] refs back with actual filenames (regex: /\[(\d+)\]/ → file_index_map)

// New: memory extraction with full prompt
async extractMemoriesFromSession(
  user: string,
  messages: Array<{role: string; content: string}>,
  outputLanguage?: string,
): Promise<Array<CandidateMemory>>
// Format messages as "[role]: content" lines
// Use memoryExtractionPrompt()
// Parse JSON response: {memories: [...]}
// Map to CandidateMemory, default invalid category to 'patterns'

// New: merge existing memory content
async mergeMemory(
  existingContent: string,
  newContent: string,
  category: string,
  outputLanguage?: string,
): Promise<string>
// Use memoryMergePrompt()

// New: dedup decision
async decideDeduplicate(
  candidate: CandidateMemory,
  existingMemories: Array<{id: string; abstract: string; overview: string; content: string}>,
): Promise<{decision: 'skip'|'create'|'none'; actions: Array<{id: string; action: 'merge'|'delete'}>}>
// Use dedupDecisionPrompt()
// Parse JSON response

// New: intent analysis
async analyzeIntent(
  recentMessages: string,
  currentMessage: string,
  compressionSummary?: string,
  contextType?: string,
  targetAbstract?: string,
): Promise<QueryPlan>
// Use intentAnalysisPrompt()
// Parse JSON response: {reasoning: string, queries: [{query, context_type, intent, priority}]}
// Map to QueryPlan / TypedQuery[]
```

### Update `SessionExtractorService`

Wire to `LlmService.extractMemoriesFromSession()` instead of the ad-hoc prompt.
Detect output language from messages (dominant language detection — port `_detect_output_language()` from `memory_extractor.py`).

---

## Fix 2 — IntentAnalyzer + `/search/search` session awareness

### Create `packages/server/src/search/intent-analyzer.service.ts`

```typescript
export interface TypedQuery {
  query: string;
  contextType: 'memory' | 'resource' | 'skill' | null;  // null = all types
  intent: string;
  priority: number;  // 1-5, 1 = highest
  targetDirectories: string[];
}

export interface QueryPlan {
  reasoning: string;
  queries: TypedQuery[];
}

@Injectable()
export class IntentAnalyzerService {
  // Max recent messages to include in context
  readonly MAX_RECENT_MESSAGES = 5;
  readonly MAX_COMPRESSION_SUMMARY_CHARS = 30000;

  async analyze(opts: {
    compressionSummary: string;
    messages: Array<{role: string; content: string}>;
    currentMessage: string;
    contextType?: 'memory' | 'resource' | 'skill';
    targetAbstract?: string;
    targetUri?: string;
  }): Promise<QueryPlan>
  // 1. Take last MAX_RECENT_MESSAGES messages
  // 2. Format as "[role]: content" lines
  // 3. Call LlmService.analyzeIntent()
  // 4. If targetUri set: force targetDirectories on all queries
  // 5. Fallback: if LLM fails, return single TypedQuery with original query
}
```

### Update `SearchService`

```typescript
// search() — session-aware path
async search(opts: {
  query: string;
  targetUri?: string;
  sessionId?: string;       // if provided → load session, run intent analysis
  limit?: number;
  scoreThreshold?: number;
  filter?: Record<string, any>;
}): Promise<FindResult>

// Implementation:
// 1. If sessionId: load session messages from DB → build session_info
// 2. If session_info has content:
//    a. Run IntentAnalyzerService.analyze() → QueryPlan
//    b. Execute each TypedQuery through HierarchicalRetriever concurrently
//    c. Merge results → FindResult{memories, resources, skills}
// 3. If no session_info:
//    - infer contextType from targetUri (memory/resource/skill/null)
//    - run single query per contextType (all three if null)
//    - merge → FindResult
```

### Session context for search

Add method to `SessionService`:
```typescript
async getContextForSearch(sessionId: string): Promise<{summaries: string[]; recent_messages: Array<{role: string; content: string}>}>
// Returns last N messages as recent_messages
// Returns [] summaries (archive summary retrieval is P1)
```

---

## Fix 3 — FindResult response shape

### Update `SearchService` return type

```typescript
export interface FindResult {
  memories: MatchedContextResponse[];
  resources: MatchedContextResponse[];
  skills: MatchedContextResponse[];
  total: number;
}
```

### Update `SearchController`

Both `find` and `search` endpoints return `FindResult` directly:
```typescript
// POST /search/find → { status: 'ok', result: { memories: [...], resources: [...], skills: [...], total: N } }
// POST /search/search → same shape
```

Categorise by `context_type` field on each `MatchedContextResponse`.

---

## Tests

- `test/llm.service.spec.ts` — verify `summarizeFile()` uses correct prompt per file type, `extractMemoriesFromSession()` parses 8-category response, `mergeMemory()` calls merge prompt, `decideDeduplicate()` parses dedup JSON
- `test/intent-analyzer.service.spec.ts` — `analyze()` returns QueryPlan with typed queries, falls back gracefully on LLM failure, respects MAX_RECENT_MESSAGES cap
- `test/search.controller.spec.ts` (update) — `POST /search/find` returns `{memories, resources, skills}`, `POST /search/search` with sessionId calls intent analyzer
- `test/session-extractor.service.spec.ts` (update) — now uses `extractMemoriesFromSession()` not ad-hoc prompt

---

## Acceptance criteria

1. All existing 388 tests pass
2. `LlmService.summarizeFile()` sends the exact `semantic.file_summary` prompt body
3. `LlmService.generateDirectoryOverview()` sends the exact `semantic.overview_generation` prompt body with file numbering
4. `LlmService.extractMemoriesFromSession()` sends the full 8-category `compression.memory_extraction` prompt
5. `POST /search/find` returns `{memories[], resources[], skills[]}`
6. `POST /search/search` with `session_id` runs `IntentAnalyzerService` → produces multi-type QueryPlan
7. `IntentAnalyzerService` gracefully falls back if LLM returns invalid JSON

---

## PR

- branch: `feature/phase5-prompt-fidelity`
- base: `feature/phase4-sessions`
- title: `feat: Phase 5 — prompt fidelity, intent analysis, FindResult shape (P0 parity fixes)`
