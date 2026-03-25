# viking-ts — Improvement Backlog

Post-parity improvements to consider once the faithful port is complete and validated.

---

## 1. Structured LLM output via function calling / tool use

**Current state**: All LLM prompts return plain JSON strings. The server parses them with `JSON.parse()` wrapped in try/catch. Malformed responses (missing fields, broken JSON) happen ~2-5% of the time, especially with smaller models.

**Improvement**: Use OpenAI function calling / Anthropic tool use to enforce structured output at the model level. The model is constrained to produce valid JSON matching a schema — no parsing errors, no missing required fields.

```typescript
// Instead of:
const raw = await llm.complete(systemPrompt, userPrompt);
const memories = JSON.parse(raw); // can fail

// With function calling:
const result = await llm.completeWithTool(systemPrompt, userPrompt, {
  name: 'store_memories',
  schema: memoriesSchema, // zod/JSON schema
});
const memories = result.toolCall.arguments; // guaranteed valid
```

**Tradeoff**: Ties you to providers that support function calling (OpenAI, Anthropic). Breaks compatibility with Ollama and other local models. Recommended approach: make it opt-in via `vlm.useToolCalling: true` in config, fall back to JSON parsing otherwise.

**Priority**: Medium. Improves reliability meaningfully, especially for categorization.

---

## 2. TypeORM + multi-database support

**Current state**: All storage uses raw `better-sqlite3` SQL in `DatabaseService` and `ContextVectorService`. There is a `database/` directory with TypeORM entities, DataSource, and Postgres migrations already scaffolded — but it's dead code, never wired in. The active code is SQLite-only.

**Why TypeORM is worth doing**:
- **Multi-database**: Switch between SQLite (dev/small), PostgreSQL (production), or other backends via config — no code changes
- **Repository pattern**: Typed queries, no raw SQL strings, automatic schema management via migrations
- **Relationships**: Proper foreign keys, lazy loading, cascades — currently managed manually
- **Existing foundation**: The `database/entities/` directory already has `Memory`, `Resource`, `Skill`, `Session`, `SessionMessage` entities ready

**Reference implementation**: The `whisperline-api` repo (`~/code/whisperline-api`) uses TypeORM with:

- **`ScopedRepository`** (`src/common/persistence/scoped-repository.ts`): Wraps TypeORM's `Repository<T>` and automatically injects `WHERE organisationId = ?` on every `find`, `save`, `update`, `delete` — prevents cross-tenant data access at the repository level. Every service uses `new ScopedRepository(this._repo, organisationId)` rather than raw repository. This is the pattern for viking-ts agent namespace isolation: replace `WHERE owner_space = ?` SQL strings with a `ScopedRepository` that injects `ownerSpace` automatically. **This wrapper is generic enough to publish as an npm package** (`@whisperline/nestjs-scoped-repository` or similar).

- **Embedding storage with `pgvector`**: Uses `pgvector.toSql(embedding)` to store and `pgvector.fromSql(row.embedding)` to read vectors. Column declared as `@Column('vector', { nullable: true })` on the entity. See `src/whispers/enrichment/semantic-embedding.service.ts` for the full pattern — `pgvector.toSql(response.embedding) as string` stored directly, no JSON serialization.

- **TypeORM entities**: All entities extend a clean base with `@PrimaryGeneratedColumn('uuid')`, proper `@Index()` decorators, `@ManyToOne`/`@OneToMany` relations. See `WhisperEntity`, `OrganisationEntity`.

**For vectors specifically**:
- Current: embeddings stored as `TEXT` (JSON array string) in SQLite, deserialized on every read, cosine similarity computed in Node.js (O(n) scan)
- With TypeORM + pgvector: `vector(768)` column type, `<=>` cosine distance operator, index-accelerated ANN search (IVFFlat or HNSW)
- The scaffolded Postgres migrations in `database/migrations/` already define `ivfflat` indexes

**Migration path**:
1. Activate the existing TypeORM entities and DataSource (currently unused)
2. Implement repository services that implement the same interfaces as current `ContextVectorService`
3. Config switch: `storage.backend: 'sqlite' | 'postgres'` — SQLite remains the default for easy local dev
4. For Postgres path: use `pgvector` extension, replace JSON embedding storage with native vector type

**The tenant guard as an npm package**: The `TenantGuard` pattern from whisperline-org is generalizable — a NestJS guard that reads `X-Tenant-ID` (or in viking-ts context: `X-OpenViking-User` + `X-OpenViking-Agent`), resolves the tenant/space, and injects it into the request context for all downstream repository calls. Worth extracting as `@whisperline/nestjs-tenant-guard` or similar.

**Priority**: High long-term. SQLite is fine for development but not for production multi-user deployments.

---

## 3. Vector search quality

**Current state**: Cosine similarity computed by iterating all vectors in Node.js. No approximate nearest neighbor index. Scales linearly — fine for hundreds of records, slow at tens of thousands.

**Improvements**:
- **pgvector** (with TypeORM, see above): IVFFlat or HNSW index for fast ANN search
- **Reranker**: Config stub exists (`rerank.*`) but not wired. Adding a reranker (Volcengine, Cohere, or OpenAI) would dramatically improve precision — retrieves top-50 by vector similarity, then reranks top-6 by cross-encoder. OpenViking supports this natively.
- **Better embedding model**: `nomic-embed-text` (768-dim, local) is convenient but lower quality than `text-embedding-3-small` (1536-dim, OpenAI) or `doubao-embedding-vision-250615` (1024-dim, Volcengine). The config supports switching — just a `.env` change.
- **Sparse + hybrid search**: OpenViking supports sparse vectors (BM25-style) alongside dense for hybrid retrieval. Viking-ts only has dense. Worth adding for keyword-heavy queries.

**Priority**: Medium. Reranker first (config already there), pgvector second (depends on TypeORM work).

---

## 4. Streaming LLM responses

**Current state**: All LLM calls block until the full response is received. For long memory extraction (large sessions), this adds latency.

**Improvement**: Use streaming for the semantic processing queue jobs — emit tokens as they arrive and parse incrementally. Less critical for batch processing (which happens async anyway) but matters if the client ever polls for extraction progress.

**Priority**: Low. The async queue already decouples latency from the request path.

---

## 5. Watch resources (incremental updates)

**Current state**: `POST /api/v1/resources` with `watch_interval` is accepted but not actually scheduled. The config field is parsed and ignored.

**Improvement**: Implement the watch scheduler — a NestJS `@Cron`-style job that re-ingests watched resources at the configured interval, then diffs against the existing tree and only re-processes changed files.

**Priority**: Low for initial use, medium for production use cases (monitoring live documentation, code repos).

---

## Summary priority order

| # | Improvement | Priority | Effort |
|---|---|---|---|
| 1 | TypeORM + Postgres | High (long-term) | Large |
| 2 | Reranker wiring | Medium | Small |
| 3 | Function calling for LLM output | Medium | Medium |
| 4 | Better embedding model | Low (config change) | Trivial |
| 5 | pgvector + ANN search | Medium (needs TypeORM) | Medium |
| 6 | Tenant guard as npm package | Medium | Medium |
| 7 | Streaming LLM | Low | Medium |
| 8 | Watch resource scheduler | Low | Medium |
