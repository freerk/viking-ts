# OpenViking Plugin Analysis for viking-ts

## Endpoint compatibility

| Endpoint | Method | Plugin usage | viking-ts status |
|---|---|---|---|
| `/health` | GET | Health check on startup and precheck | ✅ Supported |
| `/api/v1/system/status` | GET | `getRuntimeIdentity()` — discovers userId | ✅ Fixed: now returns `user` and `agent` from request context |
| `/api/v1/search/find` | POST | `memory_recall` tool and auto-recall | ✅ Supported |
| `/api/v1/content/read` | GET | Full content fetch for memory injection | ✅ Supported |
| `/api/v1/sessions` | POST | `memory_store` tool — create temp session | ✅ Supported |
| `/api/v1/sessions/:id/messages` | POST | Add message to session | ✅ Supported |
| `/api/v1/sessions/:id/extract` | POST | Extract memories from session | ✅ Supported |
| `/api/v1/sessions/:id` | GET | Pre-extract workaround (AGFS visibility) | ✅ Supported |
| `/api/v1/sessions/:id` | DELETE | Cleanup temp session | ✅ Supported |
| `/api/v1/fs/ls` | GET | Scope space resolution (`resolveScopeSpace`) | ✅ Supported |
| `/api/v1/fs` | DELETE | `memory_forget` tool — delete by URI | ✅ Supported |

## The userId gap

### Problem

The plugin's `OpenVikingClient` computes `agent_space = md5(userId:agentId)[:12]` to isolate memories per user+agent pair. However:

1. The client only sent `X-OpenViking-Agent` but **not** `X-OpenViking-User`
2. `GET /api/v1/system/status` did not return the user identity from the request context
3. The config schema had no `userId` field

This meant all requests used `userId='default'`, making multi-user memory isolation impossible.

### Fix

**Server side** (`system.controller.ts`):
- `GET /api/v1/system/status` now injects `@VikingContext()` and returns `{ user, agent }` from the request headers

**Plugin client** (`client.ts`):
- Constructor accepts optional `userId` parameter (default: `'default'`)
- `request()` sends `X-OpenViking-User` header alongside `X-OpenViking-Agent`
- Added `setUserId()` / `getUserId()` methods (parallel to `setAgentId()` / `getAgentId()`)
- `getRuntimeIdentity()` uses local `userId` when explicitly set, falls back to server fetch

**Plugin config** (`config.ts`):
- Added `userId` to `MemoryOpenVikingConfig` type and `parse()` method
- Added uiHint with label and help text

**Plugin index** (`index.ts`):
- Both `remote` and `local` mode pass `cfg.userId` to `OpenVikingClient` constructor
- `before_prompt_build` hook calls `client.setUserId(cfg.userId)` alongside `setAgentId`

## Configuration for viking-ts

```json
{
  "mode": "remote",
  "baseUrl": "http://localhost:1934",
  "userId": "freerk",
  "agentId": "main",
  "apiKey": ""
}
```

### Port difference

| Server | Default port |
|---|---|
| OpenViking (Python) | 1933 |
| viking-ts (NestJS) | 1934 |

When connecting the plugin to viking-ts, set `baseUrl` to `http://localhost:1934` (or whichever port viking-ts is configured on).

### Per-agent configuration

For multi-agent setups, use a fixed `userId` and set `agentId` per agent:

```json
{
  "mode": "remote",
  "baseUrl": "http://localhost:1934",
  "userId": "freerk",
  "agentId": "research-agent"
}
```

The agent space hash `md5('freerk:research-agent')[:12]` isolates this agent's memories from other agents while keeping them under the same user namespace.
