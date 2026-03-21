# OpenClaw Integration Guide

viking-ts provides a context-engine plugin for [OpenClaw](https://github.com/openclaw/openclaw), giving your AI agents persistent semantic memory with automatic recall and capture.

## Overview

The plugin sits in the `contextEngine` slot of the OpenClaw plugin system. It provides:

- **Auto-recall**: before each conversation turn, the plugin searches for relevant memories and injects them as context
- **Auto-capture**: after each turn, the plugin sends the conversation to the LLM for memory extraction
- **Agent tools**: `commit_memory` and `search_memories` for explicit memory control

## Installation

The plugin is part of the viking-ts monorepo:

```bash
cd viking-ts
npm install
npm run build
```

The built plugin lives at `packages/openclaw-plugin/dist/`.

## Plugin manifest

The `openclaw.plugin.json` declares the plugin identity and configuration:

```json
{
  "id": "viking-ts",
  "kind": "context-engine",
  "name": "Viking TS Context Engine",
  "version": "0.1.0"
}
```

## Deployment modes

### Remote mode (recommended)

Connect to a viking-ts server running as a separate process or service:

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

Start the server separately:

```bash
cd viking-ts
npm run start
```

### Local mode

The plugin spawns the server as a subprocess automatically:

```json
{
  "pluginId": "viking-ts",
  "mode": "local",
  "params": {
    "port": 1934,
    "storagePath": "~/.viking-ts/data"
  },
  "config": {
    "agentId": "my-agent",
    "autoRecall": true,
    "autoCapture": true
  }
}
```

In local mode, the plugin:
1. Spawns the server process with the configured port and storage path
2. Waits up to 15 seconds for the health check to pass
3. Connects the HTTP client
4. Stops the server on `shutdown()`

## Configuration options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `agentId` | string | `"default"` | Agent identifier for memory isolation |
| `autoRecall` | boolean | `true` | Search memories before each turn |
| `recallLimit` | number | `6` | Maximum memories to recall per turn |
| `recallScoreThreshold` | number | `0.01` | Minimum similarity score for recall |
| `autoCapture` | boolean | `true` | Extract memories after each turn |
| `captureMode` | string | `"semantic"` | Capture trigger: `"semantic"` or `"keyword"` |

### Capture modes

**Semantic** (default): captures all messages longer than 10 characters. Lets the LLM decide what is worth remembering.

**Keyword**: only captures messages that match trigger patterns:
- Explicit: "remember", "don't forget", "keep in mind", "for future reference"
- Identity: "my name is", "I am", "I work", "I live", "I prefer", "I like", "I hate", "I love", "I use", "I need"
- Signals: "important", "decided", "always", "never"
- Data: email addresses, phone numbers

## Agent tools

The plugin exposes two tools that the agent can call directly:

### commit_memory

Explicitly store a memory:

```json
{
  "tool": "commit_memory",
  "params": {
    "text": "User prefers monospace fonts in all code editors",
    "category": "preferences"
  }
}
```

Categories: `profile`, `preferences`, `entities`, `events`, `cases`, `patterns`, `general`.

### search_memories

Search the memory database:

```json
{
  "tool": "search_memories",
  "params": {
    "query": "font preferences",
    "limit": 5
  }
}
```

Returns a formatted text list of matching memories with similarity scores.

## agentId behavior

The `agentId` isolates memories per agent. Resolution priority:

1. **Per-call override**: `setAgentId("other-agent")` changes the agent for subsequent calls
2. **Config value**: `config.agentId` set during initialization
3. **Default**: `"default"` if nothing is configured

This allows a single viking-ts server to serve multiple agents, each with their own memory space.

## Lifecycle

### Initialization

```
OpenClaw starts
  → loads plugin manifest
  → calls init(config)
  → plugin connects to server (or spawns it)
  → health check passes
  → plugin is ready
```

### Per-turn flow

```
User message arrives
  → autoRecall(userMessage)
    → embed query → vector search → return top N memories
    → memories injected as context

Agent responds
  → autoCapture([userMessage, assistantResponse])
    → sanitize messages (strip metadata, timestamps, recursive memories)
    → filter by capture mode
    → POST /api/v1/sessions/capture
    → LLM extracts structured memories
    → memories stored with L0/L1/L2 tiers
```

### Shutdown

```
OpenClaw shuts down
  → calls shutdown()
  → plugin stops local server (if local mode)
  → cleanup complete
```

## Text sanitization

Before auto-capture, the plugin sanitizes messages to prevent noise:

- Strips `<relevant-memories>...</relevant-memories>` blocks (prevents recursive memory of recalled memories)
- Strips `<conversation-metadata>...</conversation-metadata>` blocks
- Removes ISO timestamps from line starts
- Normalizes whitespace

Messages are also filtered:
- Rejected if shorter than 10 characters
- Rejected if longer than 50,000 characters
- Rejected if starts with `/` (commands)
- Rejected if only punctuation

## Example: full OpenClaw config

```json
{
  "agents": {
    "list": [
      {
        "id": "simon",
        "name": "Simon",
        "workspace": "~/.openclaw/workspace-simon"
      }
    ]
  },
  "plugins": {
    "slots": {
      "contextEngine": {
        "pluginId": "viking-ts",
        "mode": "remote",
        "params": {
          "baseUrl": "http://localhost:1934"
        },
        "config": {
          "agentId": "simon",
          "autoRecall": true,
          "autoCapture": true,
          "recallLimit": 8,
          "recallScoreThreshold": 0.05,
          "captureMode": "semantic"
        }
      }
    }
  }
}
```

## Troubleshooting

**Plugin fails to initialize**: check that the server is running and reachable at the configured `baseUrl`. Run `curl http://localhost:1934/health` to verify.

**No memories recalled**: check that the server has memories stored (`curl http://localhost:1934/api/v1/memories`). Verify that `autoRecall` is `true` and `recallScoreThreshold` is not too high.

**Memories not captured**: check that `autoCapture` is `true`. In `keyword` mode, messages must match trigger patterns. Try `semantic` mode for broader capture.

**Wrong agent's memories**: verify `agentId` is set correctly in the config. Use `setAgentId()` for per-call overrides.
