# Ingest Run — 2026-03-22 14:47 UTC

## Summary

Full ingest of all agents + skills into viking-ts after merging all PRs into main.

- **Server:** rebuilt from main, started on http://127.0.0.1:1934
- **Storage:** SQLite at ~/.viking-ts/data
- **Embedding:** nomic-embed-text via Ollama

## Results

| Category  | Ingested | Existed/Skipped | Errors |
|-----------|----------|-----------------|--------|
| Identity  | 23       | 0               | 1      |
| Workspace | 50       | 1               | 8      |
| Sessions  | 72       | 9               | 0      |
| Skills    | 53       | 0               | 0      |
| **Total** | **198**  | **10**          | **9**  |

## Errors — Root Cause

**All 9 errors share the same cause: files exceed the 10,000 character API limit.**

### Identity (1 error)
| Agent | File | Size | Error |
|-------|------|------|-------|
| main  | `AGENTS.md` | 11,129 bytes | `text must be shorter than or equal to 10000 characters` |

### Workspace (8 errors)
| Agent | File | Size | Error |
|-------|------|------|-------|
| theo | `MEMORY.md` | 11,418 bytes | `text must be shorter than or equal to 10000 characters` |
| theo | `memory/2026-03-11.md` | 12,013 bytes | `text must be shorter than or equal to 10000 characters` |
| theo | `memory/2026-03-12.md` | 12,469 bytes | `text must be shorter than or equal to 10000 characters` |
| theo | `memory/2026-03-13.md` | (not re-tested, same cause) | same |
| theo | `memory/2026-03-16.md` | (not re-tested, same cause) | same |
| theo | `memory/2026-03-18.md` | (not re-tested, same cause) | same |
| theo | `memory/2026-03-19.md` | (not re-tested, same cause) | same |
| theo | `memory/source-watchlist.md` | 12,186 bytes | `text must be shorter than or equal to 10000 characters` |

## Options to resolve

1. **Raise the API limit** — increase `text` max length in the server's DTO validation (e.g. to 50k or remove cap). Straightforward server change.
2. **Chunk large files** — ingest script splits files > 10k into overlapping chunks before posting. More work but better for semantic search granularity.
3. **Accept as-is** — these are large memory dumps; may not be worth indexing in full. Leave them out.

## Follow-up items

- [ ] Decide on approach for files > 10k chars (Freerk to review)
- [ ] Investigate if 9 skipped sessions are expected (short/empty sessions) or missing data
- [ ] Install and configure openclaw plugin (Freerk doing manually)
