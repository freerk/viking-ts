# @viking-ts/openclaw-plugin

OpenClaw context-engine plugin for viking-ts. Provides AI agents with persistent semantic memory through auto-recall, auto-capture, and explicit memory tools.

## What it does

- **Auto-recall**: before each conversation turn, searches for relevant memories and injects them as context
- **Auto-capture**: after each turn, sends the conversation to the LLM for automatic memory extraction
- **Agent tools**: `commit_memory` and `search_memories` for explicit memory control
- **Multi-agent**: isolates memories per agent via `agentId`

## Plugin manifest

```json
{
  "id": "viking-ts",
  "kind": "context-engine",
  "name": "Viking TS Context Engine",
  "version": "0.1.0"
}
```

## Deployment modes

### Remote (recommended)

Connect to a running viking-ts server:

```json
{
  "pluginId": "viking-ts",
  "mode": "remote",
  "params": {
    "baseUrl": "http://localhost:1934",
    "apiKey": "optional-api-key"
  },
  "config": {
    "agentId": "my-agent",
    "autoRecall": true,
    "autoCapture": true
  }
}
```

### Local

The plugin spawns the server as a subprocess:

```json
{
  "pluginId": "viking-ts",
  "mode": "local",
  "params": {
    "port": 1934,
    "storagePath": "~/.viking-ts/data"
  },
  "config": {
    "agentId": "my-agent"
  }
}
```

## Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `agentId` | string | `"default"` | Agent identifier for memory isolation |
| `autoRecall` | boolean | `true` | Search memories before each turn |
| `recallLimit` | number | `6` | Max memories to recall |
| `recallScoreThreshold` | number | `0.01` | Minimum similarity (0-1) |
| `autoCapture` | boolean | `true` | Extract memories after each turn |
| `captureMode` | string | `"semantic"` | `"semantic"` (all text) or `"keyword"` (trigger words only) |

## Agent tools

### commit_memory

Store a memory explicitly:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Memory content |
| `category` | enum | Yes | `profile`, `preferences`, `entities`, `events`, `cases`, `patterns`, `general` |

### search_memories

Search the memory database:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `limit` | number | No | Max results (default: 6) |

## API

The plugin exports `createContextEngine()` which returns a `ContextEngine` object:

```typescript
import { createContextEngine } from '@viking-ts/openclaw-plugin';

const engine = createContextEngine();

await engine.init({
  mode: 'remote',
  params: { baseUrl: 'http://localhost:1934' },
  agentId: 'my-agent',
  autoRecall: true,
  autoCapture: true,
});

// Search memories
const memories = await engine.autoRecall('user preferences');

// Capture conversation
const count = await engine.autoCapture([
  { role: 'user', content: 'I prefer dark mode' },
  { role: 'assistant', content: 'Noted!' },
]);

// Change agent
engine.setAgentId('other-agent');

// Cleanup
await engine.shutdown();
```

## Architecture

```
OpenClaw Host
  └── ContextEngine (this plugin)
        └── VikingClient (HTTP + Zod validation)
              └── viking-ts server (local subprocess or remote)
```

### Components

- **index.ts**: plugin entry point, implements the context-engine interface
- **client.ts**: HTTP client with Zod response validation
- **process-manager.ts**: spawns and manages the server subprocess (local mode)
- **text-utils.ts**: sanitization (strips recalled memories from capture input) and capture filtering

## Text sanitization

Before auto-capture, messages are sanitized:
- `<relevant-memories>` blocks stripped (prevents recursive memory storage)
- `<conversation-metadata>` blocks stripped
- ISO timestamps removed
- Whitespace normalized

Messages are filtered out if: shorter than 10 chars, longer than 50,000 chars, start with `/`, or contain only punctuation.

## Development

```bash
# Build
npm run build

# Test
npm test

# Lint
npm run lint
```

## Dependencies

- `zod`: response schema validation (only runtime dependency)
