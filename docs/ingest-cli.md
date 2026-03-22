# Ingest CLI

The ingest script (`scripts/ingest.mjs`) is a comprehensive CLI for bulk-importing data into viking-ts. It supports identity files, workspace memories, conversation sessions, resources, and skills, with multi-agent support and idempotent dedup.

## Usage

```bash
node scripts/ingest.mjs [flags]
```

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--agent <id>` | string | (all agents) | Only ingest for a specific agent |
| `--no-workspace` | boolean | `false` | Skip workspace MEMORY.md and memory/*.md files |
| `--no-sessions` | boolean | `false` | Skip session .jsonl files |
| `--no-identity` | boolean | `false` | Skip SOUL.md, IDENTITY.md, AGENTS.md, USER.md |
| `--resources <dir>` | string[] | `[]` | Ingest directories as resources (repeatable) |
| `--resource-prefix <p>` | string | auto | URI prefix for resources (default: `viking://resources/<dirname>`) |
| `--skills <dir>` | string[] | `[]` | Ingest skill directories (repeatable) |
| `--sync-skills` | boolean | `false` | Delete skills in viking-ts that no longer exist on disk |
| `--base-url <url>` | string | `http://localhost:1934` | Server URL |
| `--force` | boolean | `false` | Skip dedup checks, re-ingest everything |
| `--dry-run` | boolean | `false` | Print plan without making any requests |
| `--help` | boolean | `false` | Show help text |

## Agent discovery

The script reads agent configuration from `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "list": [
      {
        "id": "simon",
        "name": "Simon",
        "workspace": "~/.openclaw/workspace-simon"
      },
      {
        "id": "librarian",
        "name": "Librarian"
      }
    ]
  }
}
```

Each agent has:
- **id**: unique identifier (used as `agentId` in viking-ts)
- **name**: display name (defaults to id)
- **workspace**: path to workspace directory (defaults to `~/.openclaw/workspace` for the main agent)
- **sessionsDir**: computed as `~/.openclaw/agents/{agentId}/sessions`

When `--agent <id>` is specified, only that agent is processed.

## Ingestion phases

### Phase 1: Identity files (per agent)

Looks for these files in the agent's workspace directory:
- `SOUL.md`
- `IDENTITY.md`
- `AGENTS.md`
- `USER.md`

Each file is stored as a memory with:
- type: `agent`
- category: `profile`
- uri: `viking://agent/memories/identity/{filename}`
- agentId: the agent's id

Files shorter than 10 characters are skipped.

Skip with `--no-identity`.

### Phase 2: Workspace memories (per agent)

Ingests:
- `{workspace}/MEMORY.md`
- All `.md` files in `{workspace}/memory/`

Each file is stored as a memory with:
- type: `agent`
- category: `general`
- uri: `viking://agent/memories/workspace/{basename}`
- agentId: the agent's id

Files shorter than 10 characters are skipped.

Skip with `--no-workspace`.

### Phase 3: Sessions (per agent)

Reads `.jsonl` files from `~/.openclaw/agents/{agentId}/sessions/`.

Each JSONL file is parsed line by line:
- Filters for lines with `type: "message"`
- Extracts `role` (user/assistant) and `content`
- Strips system envelope headers from user messages
- Filters messages shorter than 20 characters
- Requires minimum 2 messages per session

Sessions are sent to `POST /api/v1/sessions/capture` which uses the LLM to extract structured memories.

Skip with `--no-sessions`.

### Phase 4: Resources (global)

Only runs when `--resources <dir>` is specified. Walks each directory for `.md` files.

Each file is stored as a resource with:
- title: derived from directory name and relative path
- text: file content
- uri: `{prefix}/{relative-path}` (default prefix: `viking://resources/{dirname}`)

Files shorter than 20 characters are skipped.

The `--resource-prefix` flag overrides the auto-generated URI prefix.

### Phase 5: Skills (global)

Only runs when `--skills <dir>` is specified. Discovers subdirectories in each skills directory.

Each skill directory must contain a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: code-review
description: Expert code review with TypeScript focus
tags:
  - typescript
  - quality
---

# Code Review Skill

When reviewing code, focus on...
```

The skill is stored with:
- name: from frontmatter (or directory name)
- description: from frontmatter (or auto-generated)
- content: full SKILL.md text
- tags: array from frontmatter
- uri: `viking://agent/skills/{name}/`

### Phase 6: Skill sync (global)

Only runs when both `--skills <dir>` and `--sync-skills` are specified.

After ingesting skills, fetches all skills from the server and deletes any that were not in the ingested set. This removes stale skills that no longer exist on disk.

## Idempotent dedup

By default, the script checks for existing items before ingesting:

1. Fetches all memories from the server (up to 5000) and caches their `{agentId}::{uri}` keys
2. Fetches all skills (up to 1000) and resources (up to 5000) and caches their URIs
3. During ingestion, skips items that already exist

This makes re-running the script safe. Only new items are created.

Use `--force` to skip dedup checks and re-ingest everything.

## Examples

```bash
# Full ingest for all agents with skills
node scripts/ingest.mjs --skills ~/apps/openclaw/skills

# Ingest only for a specific agent
node scripts/ingest.mjs --agent simon

# Add project documentation as resources
node scripts/ingest.mjs --agent simon \
  --resources ~/.openclaw/workspace/projects/whisperline

# Custom URI prefix for resources
node scripts/ingest.mjs \
  --resources /path/to/docs \
  --resource-prefix viking://resources/my-project

# Skip sessions (faster, no LLM calls for extraction)
node scripts/ingest.mjs --no-sessions --skills ~/apps/openclaw/skills

# Only resources and skills, nothing else
node scripts/ingest.mjs --no-identity --no-workspace --no-sessions \
  --resources /path/to/docs \
  --skills /path/to/skills

# Force re-ingest everything
node scripts/ingest.mjs --force --skills ~/apps/openclaw/skills

# Sync skills: delete stale entries not on disk
node scripts/ingest.mjs --skills ~/apps/openclaw/skills --sync-skills

# Dry run to see what would happen
node scripts/ingest.mjs --dry-run --agent simon --skills ~/apps/openclaw/skills

# Custom server URL
node scripts/ingest.mjs --base-url http://my-server:1934
```

## Output

The script prints a summary with counters:

```
--- Ingest Summary ---
identity:  ingested=3  existed=1  skipped=0  errors=0
workspace: ingested=5  existed=2  skipped=1  errors=0
sessions:  ingested=12 skipped=3  errors=0
resources: ingested=8  existed=0  skipped=2  errors=0
skills:    ingested=6  existed=1  skipped=0  errors=0
skillSync: deleted=2   kept=6
```

- **ingested**: successfully sent to the server
- **existed**: already present (dedup hit)
- **skipped**: filtered out (too short, invalid format)
- **errors**: failed to send

## Bash completion

Install bash completion for the ingest CLI:

```bash
# Add to ~/.bashrc or ~/.bash_profile
source /path/to/viking-ts/scripts/ingest-completion.bash
```

This enables tab completion for:
- All flag names (`--agent`, `--skills`, `--dry-run`, etc.)
- Agent IDs after `--agent` (read from `~/.openclaw/openclaw.json`)
- Directory completion after `--resources` and `--skills`

## Prerequisites

- Node.js >= 18
- viking-ts server running (unless `--dry-run`)
- `~/.openclaw/openclaw.json` with agent configuration
- Embedding and LLM API keys configured on the server (for L0/L1 generation and session extraction)
