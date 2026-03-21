# Project Retrospective

How viking-ts was built, the decisions behind it, and what we learned.

## The problem

AI agents need memory. Without persistent context, every conversation starts from zero. The agent forgets user preferences, past decisions, project context, and lessons learned. OpenViking solved this with a sophisticated memory layer, but it was built in Python with Rust extensions, making it heavy to deploy and impossible to embed in a TypeScript-native toolchain.

We needed a memory system that:
- Runs anywhere Node.js runs, with zero native compilation headaches
- Works with any embedding/LLM provider (OpenAI, Ollama, Anthropic, Azure)
- Integrates directly into the OpenClaw agent platform
- Supports multi-agent memory isolation
- Can be self-hosted on minimal hardware

## Why TypeScript

The decision to rewrite in TypeScript was not about language preference. It was about deployment surface.

OpenClaw is a TypeScript project. Its plugins are TypeScript. The agents it orchestrates run in Node.js. Adding a Python/Rust memory backend meant managing a separate runtime, virtual environments, native compilation, and cross-platform build issues.

TypeScript gave us:
- **Single runtime**: everything runs on Node.js, no polyglot deployment
- **Type safety across the stack**: plugin client, server API, and agent tools share the same types
- **npm ecosystem**: better-sqlite3, vectra, and the OpenAI SDK are all pure npm packages
- **Embeddable**: the plugin can spawn the server as a subprocess, no Docker or systemd required

The only native dependency is better-sqlite3, which provides pre-built binaries for all major platforms.

## Architecture decisions

### vectra over pgvector

We chose vectra (a pure TypeScript vector DB) over PostgreSQL with pgvector for the initial implementation:

- **Zero infrastructure**: no database server to install or manage
- **Pure TypeScript**: no native bindings beyond SQLite
- **Embedded**: stores vectors as JSON files on disk, runs in-process
- **Good enough**: for personal/small-team use (thousands of memories), vectra's brute-force KNN is fast enough

The tradeoff: vectra does not scale to millions of vectors. For large-scale deployments, a pgvector backend could be added later. The storage layer is abstracted behind `VectorStoreService`, making this swap straightforward.

### SQLite for metadata

SQLite was the obvious choice for structured metadata:
- WAL mode for concurrent reads
- Foreign keys for session/message relationships
- Fast filtering by agentId, category, type
- Pagination with LIMIT/OFFSET
- Zero configuration, single file on disk

The combination of SQLite (structured queries) + vectra (semantic search) gives us the best of both worlds without any external services.

### L0/L1/L2 tiered abstraction

The three-tier system was inspired by how human memory works: you remember the gist (L0), the key details (L1), and can recall the full story if needed (L2).

For AI agents, this solves a practical problem: vector search quality degrades with long, noisy text. By embedding a concise L0 abstract instead of the full content, search results are more relevant. L1 provides enough context for the agent to decide if this memory matters, without loading potentially thousands of tokens.

The tiers are generated concurrently on record creation. If the LLM is unavailable, the system falls back to simple text truncation. No data is lost; L2 always stores the full original text.

### Viking URI scheme

Every piece of content gets a `viking://` URI, creating a navigable namespace:

```
viking://agent/memories/identity/SOUL.md
viking://agent/skills/code-review/
viking://resources/docs/api.md
```

This was inspired by how filesystems and package registries work. The URI scheme makes content addressable, browsable (via `ls` and `tree` endpoints), and dedup-able (the ingest CLI uses URIs as dedup keys).

The scopes (`resources`, `user`, `agent`, `session`, `queue`, `temp`) mirror how different types of context flow through an agent system.

### NestJS for the server

NestJS was chosen for:
- **Module system**: clean separation of concerns (memory, resource, skill, storage, embedding, LLM)
- **Dependency injection**: global singletons for shared services (storage, embedding, LLM)
- **Swagger integration**: auto-generated API docs from decorators
- **Validation pipeline**: class-validator DTOs with automatic request validation
- **Familiar patterns**: controllers, services, modules follow well-understood conventions

The entire server is ~30 files, small enough to understand in a single sitting.

## The OpenClaw plugin

The plugin was the forcing function for the entire project. We needed a context engine that:

1. **Auto-recalls** relevant memories before each conversation turn
2. **Auto-captures** new memories after each turn
3. **Exposes tools** for the agent to explicitly store and search memories
4. **Manages its own lifecycle** (spawn server, health check, shutdown)

The plugin implements the OpenClaw context-engine interface with a thin HTTP client (`VikingClient`) backed by Zod schemas for response validation. It can run in local mode (spawning the server as a subprocess) or remote mode (connecting to an existing server).

The `ProcessManager` handles local server lifecycle: spawning the process, capturing stderr for diagnostics, polling the health endpoint, and clean shutdown via SIGTERM.

## The ingest system

The ingest CLI (`scripts/ingest.mjs`) evolved through three iterations:

1. **First version**: hardcoded paths, single agent, no dedup. Good enough to prove the concept.
2. **Second version**: multi-agent support, identity/workspace/sessions, but still no dedup.
3. **Current version**: full CLI with flags, idempotent dedup, skill sync, resource ingestion, dry-run mode, bash completion.

Key design decisions:
- **Idempotent by default**: the script fetches existing items and skips duplicates. Safe to re-run.
- **Force mode**: `--force` skips dedup for when you want to re-ingest everything.
- **Skill sync**: `--sync-skills` deletes skills from the server that no longer exist on disk. This closes the loop: disk is the source of truth.
- **Phase-based**: identity, workspace, sessions, resources, skills run in order. Each phase can be skipped independently.

## Learnings

### Graceful degradation matters

The LLM might be unavailable, slow, or return garbage. Every LLM call in viking-ts has a fallback: text truncation for L0/L1, empty array for memory extraction. The system never fails because the LLM is down. It just stores less rich abstractions.

### Dedup is not optional

The first ingest script had no dedup. Running it twice doubled every memory. The current version fetches existing URIs before ingesting and skips duplicates. This seems obvious in hindsight, but the pattern of "fetch existing, check, skip" is worth building in from the start.

### Text sanitization prevents recursive memory

Without sanitization, auto-capture would store the recalled memories as new memories, which would get recalled, which would get stored again. The `<relevant-memories>` stripping in `text-utils.ts` breaks this cycle. Any system that both reads and writes memories needs this kind of hygiene.

### Small codebase, big surface area

The entire server is ~2000 lines of TypeScript. The plugin is ~500 lines. The ingest script is ~400 lines. Yet it covers memory CRUD, semantic search, session capture, resource management, skill management, URI navigation, OpenClaw integration, and bulk ingestion. Keeping the codebase small was intentional: every module does one thing, shared services handle cross-cutting concerns, and there is no abstraction for abstraction's sake.

### Provider agnosticism pays off

Using the OpenAI SDK with a configurable `baseURL` was a single design decision that unlocked compatibility with Ollama, Azure OpenAI, LiteLLM, vLLM, and any other OpenAI-compatible endpoint. No provider-specific code, no adapter pattern, just one SDK with a different base URL.

## What could be improved

- **PostgreSQL + pgvector backend**: for large-scale deployments with millions of vectors
- **Streaming session capture**: process conversations incrementally instead of batch
- **Memory consolidation**: merge similar memories over time to prevent bloat
- **Access control**: per-agent or per-user API keys with actual enforcement
- **Webhook notifications**: notify other systems when memories are created or updated
- **Memory decay**: reduce relevance of old memories over time unless reinforced
