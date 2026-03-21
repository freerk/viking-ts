# Migrating from OpenClaw to viking-ts

You have OpenClaw running with agents, memories, workspace files, and skills. This guide walks you through replacing OpenClaw's built-in memory stack with viking-ts as the context engine. Nothing destructive happens along the way: your existing data stays intact, and you can roll back in one command.

## Prerequisites

Before you start, make sure you have:

- **Node.js v20+** installed (`node -v` to check)
- **OpenClaw** running with at least one configured agent
- **viking-ts** cloned and built:
  ```bash
  git clone https://github.com/openclaw/viking-ts.git ~/code/viking-ts
  cd ~/code/viking-ts
  npm install
  npm run build
  ```
- **One of** the following for embeddings:
  - **Ollama** running locally with `nomic-embed-text` pulled (recommended for local-only setups):
    ```bash
    ollama pull nomic-embed-text
    ```
  - **OpenAI API key** with access to `text-embedding-3-small`

## Step 1: Configure viking-ts

Create the config file at `~/.viking-ts/config.json`. Pick the option that matches your embedding provider.

### Option A: Local embeddings with Ollama (recommended)

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 1934
  },
  "storage": {
    "path": "~/.viking-ts/data"
  },
  "embedding": {
    "provider": "openai",
    "model": "nomic-embed-text",
    "apiKey": "ollama",
    "apiBase": "http://localhost:11434/v1",
    "dimension": 768
  },
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "YOUR_OPENAI_KEY",
    "apiBase": "https://api.openai.com/v1"
  }
}
```

Ollama exposes an OpenAI-compatible endpoint, so the embedding provider is set to `"openai"` with Ollama's base URL. The `apiKey` value doesn't matter for Ollama but the field must be present.

### Option B: OpenAI embeddings

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 1934
  },
  "storage": {
    "path": "~/.viking-ts/data"
  },
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "YOUR_OPENAI_KEY",
    "apiBase": "https://api.openai.com/v1",
    "dimension": 1536
  },
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "YOUR_OPENAI_KEY",
    "apiBase": "https://api.openai.com/v1"
  }
}
```

### LLM configuration

The `llm` section controls the model used for memory extraction (L0 abstracts and L1 overviews during session capture). `gpt-4o-mini` is the default and works well for this. If you prefer Anthropic:

```json
"llm": {
  "provider": "anthropic",
  "model": "claude-haiku-4-5-20251001",
  "apiKey": "YOUR_ANTHROPIC_KEY",
  "apiBase": "https://api.anthropic.com"
}
```

All config values can also be set via environment variables (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_API_BASE`, `EMBEDDING_DIMENSION`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_API_BASE`). Env vars take precedence over `config.json`.

### Start the server

```bash
npm run start --workspace=packages/server
```

### Verify it's running

```bash
curl http://localhost:1934/health
```

Expected response:

```json
{"status":"ok"}
```

## Step 2: Ingest existing OpenClaw data

The ingest script reads your `~/.openclaw/openclaw.json` to discover agents and their workspaces. It pulls in:

- **Identity files** per agent: `SOUL.md`, `IDENTITY.md`, `AGENTS.md`, `USER.md`
- **Workspace memory** per agent: `MEMORY.md` and everything under `memory/*.md`
- **Session history** per agent: `.jsonl` files from `~/.openclaw/agents/<id>/sessions/`
- **Skills** (shared, not per-agent): every `SKILL.md` found in the skills directory

### Preview first with --dry-run

```bash
cd ~/code/viking-ts
node scripts/ingest.mjs --dry-run --skills ~/apps/openclaw/skills
```

This prints everything it would do without making any changes. Review the output to confirm it found the right agents and files.

### Run the full ingest

To ingest all agents at once:

```bash
node scripts/ingest.mjs --skills ~/apps/openclaw/skills
```

To ingest a specific agent:

```bash
node scripts/ingest.mjs --agent main --skills ~/apps/openclaw/skills
node scripts/ingest.mjs --agent simon --skills ~/apps/openclaw/skills
```

The script is **idempotent by default**. It checks existing URIs before posting, so running it twice won't create duplicates. You'll see `(skipped, exists)` next to items that are already ingested.

### Force re-ingest

If you've updated your identity files or workspace memories and want to re-ingest everything from scratch:

```bash
node scripts/ingest.mjs --force --skills ~/apps/openclaw/skills
```

`--force` skips all dedup checks and re-posts every item.

### Ingest project resources

If you have project-specific docs you want searchable:

```bash
node scripts/ingest.mjs --agent simon --resources ~/.openclaw/workspace/projects/whisperline
```

### Verify the ingest

Search for something you know exists in your memories:

```bash
curl "http://localhost:1934/api/v1/memories/search?q=user+preferences"
```

You should see results with `score`, `text`, and `uri` fields matching your ingested data.

## Step 3: Install the OpenClaw plugin

```bash
openclaw plugins install ~/code/viking-ts/packages/openclaw-plugin
```

Verify the plugin is registered:

```bash
openclaw plugins list
```

You should see `viking-ts` (v0.1.0) in the output.

## Step 4: Configure OpenClaw to use viking-ts

Open `~/.openclaw/openclaw.json` and add the following to the top-level config:

```json
"plugins": {
  "entries": {
    "viking-ts": {
      "enabled": true,
      "config": {
        "mode": "remote",
        "baseUrl": "http://127.0.0.1:1934",
        "autoRecall": true,
        "recallLimit": 6,
        "autoCapture": true
      }
    }
  },
  "slots": {
    "contextEngine": "viking-ts"
  }
}
```

**You do not need to set `agentId` in the plugin config.** OpenClaw passes the active agent's ID dynamically via the `setAgentId()` call when switching agents. The plugin resolves agent identity in this order:

1. Per-call override from OpenClaw (via `setAgentId`)
2. `agentId` in plugin config (if set)
3. `"default"` as last resort

### Plugin config options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `"local"` \| `"remote"` | required | `"remote"` connects to an existing server; `"local"` spawns one |
| `baseUrl` | string | - | Server URL (required in remote mode) |
| `autoRecall` | boolean | `true` | Automatically search memories on each user message |
| `recallLimit` | number | `6` | Max memories returned per recall |
| `autoCapture` | boolean | `true` | Automatically extract memories from conversations |
| `captureMode` | `"semantic"` \| `"keyword"` | `"semantic"` | How to filter messages for capture |
| `apiKey` | string | - | API key if your server requires auth |

### Restart the gateway

```bash
openclaw gateway restart
```

## Step 5: Verify it works

### Check recall in a session

Start a new OpenClaw session and ask something related to your ingested memories. The agent should surface relevant context from viking-ts. Look for recall results in the session's context panel.

### Check server logs

The viking-ts server logs every incoming request. Watch for `/api/v1/memories/search` (recall) and `/api/v1/sessions/capture` (capture) requests:

```bash
# If running in the foreground, you'll see logs directly.
# Otherwise, check the server output for lines like:
#   POST /api/v1/memories/search 200
#   POST /api/v1/sessions/capture 200
```

### Query the API directly

```bash
curl "http://localhost:1934/api/v1/memories/search?q=test"
```

If you get results back, the data is there and searchable.

## Rollback

To switch back to OpenClaw's built-in memory at any time:

```bash
openclaw config set plugins.slots.contextEngine legacy
openclaw gateway restart
```

Your viking-ts data is preserved. Nothing is deleted. You can switch back to viking-ts later by resetting the slot to `"viking-ts"` and restarting the gateway.

## Keeping skills in sync

When you add, remove, or update skills in OpenClaw, re-run the ingest with `--sync-skills` to keep viking-ts in sync:

```bash
node scripts/ingest.mjs --skills ~/apps/openclaw/skills --sync-skills
```

`--sync-skills` does two things:

1. Ingests any new or updated skills from disk
2. Deletes skills from viking-ts that no longer exist on disk

To automate this, add a cron job:

```bash
crontab -e
```

```
# Sync viking-ts skills every hour
0 * * * * cd ~/code/viking-ts && node scripts/ingest.mjs --skills ~/apps/openclaw/skills --sync-skills >> /tmp/viking-skill-sync.log 2>&1
```

## Troubleshooting

### Server won't start

**Port conflict:** Another process is using port 1934. Either stop it or change the port in `~/.viking-ts/config.json` and update your plugin's `baseUrl` to match.

```bash
lsof -i :1934
```

**Missing API key:** If using OpenAI embeddings, the server will fail on the first request that needs an embedding. Check that `embedding.apiKey` is set in `config.json` or via `EMBEDDING_API_KEY`.

**Ollama not running:** If using local embeddings, make sure Ollama is started and the model is pulled:

```bash
ollama list | grep nomic-embed-text
```

### Ingest errors

**"Cannot find ~/.openclaw/openclaw.json":** The ingest script reads agent config from this file. Make sure OpenClaw is installed and has been run at least once.

**"Agent X not found in openclaw.json":** The `--agent` value must match an `id` in the `agents.list` array of your `openclaw.json`. Check spelling and case.

**Files skipped:** The script skips files shorter than 10 characters (identity/workspace) or 20 characters (resources/skills). This filters out empty or placeholder files.

### No recall in sessions

**Plugin not active:** Verify `plugins.slots.contextEngine` is set to `"viking-ts"` in `openclaw.json`. Run `openclaw plugins list` to confirm it's installed and enabled.

**Wrong base URL:** If the server is running on a non-default port, make sure the plugin's `baseUrl` matches.

**autoRecall disabled:** Check that `autoRecall` is `true` (or absent, since it defaults to `true`) in the plugin config.

**No data ingested:** Run a direct search to confirm data exists:

```bash
curl "http://localhost:1934/api/v1/memories/search?q=hello"
```

If this returns an empty array, the ingest didn't populate any memories. Re-run the ingest and check the summary output.

### Embedding dimension mismatch

If you switch embedding providers after the initial ingest (e.g., from OpenAI's 1536-dim to Ollama's 768-dim), existing vectors become incompatible. You need to:

1. Stop the server
2. Delete the vector index: `rm -rf ~/.viking-ts/data/vectors`
3. Update `config.json` with the new provider and dimension
4. Start the server
5. Re-ingest everything with `--force`:
   ```bash
   node scripts/ingest.mjs --force --skills ~/apps/openclaw/skills
   ```

The metadata (SQLite) is preserved. Only the vector embeddings are regenerated.
