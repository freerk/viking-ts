# Test Audit — 2026-03-24

## Summary

Audited test suite across `packages/server/test/` and `packages/server/src/**/*.spec.ts`.

**Before this change:** 45 test suites, 580 tests passing.
**After this change:** 45 test suites, 590 tests passing.

## Existing coverage

The test suite has strong coverage across:

- **Storage layer** — VFS, metadata store, vector store, context vectors, relations, directory initializer (6 suites)
- **Queue system** — embedding queue, semantic queue, async queue, semantic processor, text utils (5 suites)
- **API controllers** — memory, resource, session, system, health, tasks, viking-uri, skills, search, observer (10 suites)
- **Services** — memory, resource, embedding, LLM, intent analyzer, session extractor, memory deduplicator, session memory writer, hierarchical retriever (9 suites)
- **Shared** — API key guard, API response helper, request context, request context interceptor (4 suites)
- **Other** — config, swagger, MCP converter, parsers (4 suites)

## Gaps identified and addressed

### 1. Memory namespace isolation (added to `test/memory.service.spec.ts`)

`computeAgentSpace` produces `md5(userId:agentId)[:12]` and `listMemories` filters by `ownerSpace`. No tests verified that memories created with `userId='freerk', agentId='conor'` are invisible to queries with a different userId or no userId.

**Added 4 tests:** URI hash verification, matching filter finds memory, mismatched userId returns empty, default userId returns empty.

### 2. RequestContextInterceptor hash verification (added to `src/shared/request-context.interceptor.spec.ts`)

The interceptor tests covered header extraction but did not verify that `agentSpaceName()` on the constructed `UserIdentifier` produces the correct hash for a known input.

**Added 1 test:** Verifies `md5('alice:bob')[:12]` against computed hash.

### 3. Skill URI correctness (added to `src/skills/skill.controller.spec.ts`)

Existing tests verified MCP conversion and service call args but not the returned `uri` field in the response.

**Added 1 test:** Verifies returned URI is `viking://agent/skills/my-skill/`.

### 4. Resource pipeline input modes (added to `src/resource/resource.service.spec.ts`)

The resource tests covered file parsing (PDF, DOCX, etc.) and URL ingestion but not the `addResource` parameter validation (scope check, `to`+`parent` conflict, text-to-VFS write).

**Added 4 tests:** text-to-URI write, wrong scope rejection, `to`+`parent` conflict, URL fetch path.

### 5. Pack export/import round-trip (added to `test/pack.service.spec.ts`)

The pack tests covered export structure, import mechanics, conflict handling, and path validation, but no test exercised a full export-then-import cycle or verified `../escape` traversal.

**Added 3 tests:** `../escape` path rejection, full round-trip (export then import to VFS), round-trip with `vectorize=true` enqueuing embeddings.

## Remaining gaps (not addressed)

- No e2e tests exercising the full NestJS app with real SQLite
- No tests for the MCP server package (`packages/mcp-server`)
- Session context search tests exist but session flow integration is minimal
- No load/stress testing for the queue system
