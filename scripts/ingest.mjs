#!/usr/bin/env node
/**
 * ingest.mjs
 * Comprehensive ingest + sync CLI for viking-ts.
 * Replaces ingest-simon.mjs with multi-agent support, resources, and skills.
 *
 * Idempotent by default: checks existing URIs before posting.
 * Use --force to skip dedup checks and re-ingest everything.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, relative, dirname } from 'path';
import { homedir } from 'os';
import { parseArgs } from 'util';

const HOME = homedir();
const DELAY_MS = 200;
const IDENTITY_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'USER.md'];

const counters = {
  identity: { ingested: 0, skipped: 0, existed: 0, errors: 0 },
  workspace: { ingested: 0, skipped: 0, existed: 0, errors: 0 },
  sessions: { ingested: 0, skipped: 0, errors: 0 },
  resources: { ingested: 0, skipped: 0, existed: 0, errors: 0 },
  skills: { ingested: 0, skipped: 0, existed: 0, errors: 0 },
  skillSync: { deleted: 0, kept: 0 },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readFile(path) {
  return readFileSync(path, 'utf-8').trim();
}

function walkFiles(dir, exts = ['.md']) {
  const results = [];
  if (!existsSync(dir)) return results;
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...walkFiles(full, exts));
      } else if (exts.some((e) => entry.endsWith(e))) {
        results.push(full);
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return results;
}

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    options: {
      agent: { type: 'string' },
      user: { type: 'string' },
      'no-workspace': { type: 'boolean', default: false },
      'no-sessions': { type: 'boolean', default: false },
      'no-identity': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      resources: { type: 'string', multiple: true, default: [] },
      'resource-prefix': { type: 'string' },
      skills: { type: 'string', multiple: true, default: [] },
      'sync-skills': { type: 'boolean', default: false },
      'base-url': { type: 'string', default: 'http://localhost:1934' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  return values;
}

function printHelp() {
  console.log(`Usage: node scripts/ingest.mjs [options]

Options:
  --agent <id>            Only ingest for this agent (default: all agents)
  --user <id>             Set X-OpenViking-User header (default: "default")
  --no-workspace          Skip workspace MEMORY.md + memory/*.md
  --no-sessions           Skip session .jsonl files
  --no-identity           Skip SOUL.md, IDENTITY.md, AGENTS.md, USER.md
  --force                 Skip dedup checks, re-ingest everything (default: idempotent)
  --resources <dir>       Ingest directory as resources (repeatable)
  --resource-prefix <p>   URI prefix for --resources (default: viking://resources/<dirname>)
  --skills <dir>          Ingest directory of SKILL.md files into /api/v1/skills (repeatable)
  --sync-skills           Delete skills in viking-ts that no longer exist on disk
  --base-url <url>        Server URL (default: http://localhost:1934)
  --dry-run               Print plan, don't POST/DELETE
  --help                  Show this help message

Examples:
  # First-time full ingest for all agents + skills
  node scripts/ingest.mjs --skills ~/apps/openclaw/skills

  # Re-run safely (skips what's already ingested)
  node scripts/ingest.mjs --skills ~/apps/openclaw/skills

  # Force re-ingest everything
  node scripts/ingest.mjs --force --skills ~/apps/openclaw/skills

  # Only Simon, with Whisperline project docs
  node scripts/ingest.mjs --agent simon --resources ~/.openclaw/workspace/projects/whisperline

  # Sync skills after removing one from OpenClaw
  node scripts/ingest.mjs --skills ~/apps/openclaw/skills --sync-skills

  # Dry-run to preview
  node scripts/ingest.mjs --dry-run --agent simon`);
}

function loadAgents(filterAgentId) {
  const configPath = join(HOME, '.openclaw/openclaw.json');
  if (!existsSync(configPath)) {
    console.error('Cannot find ~/.openclaw/openclaw.json');
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const defaultWorkspace = config.agents?.defaults?.workspace ?? join(HOME, '.openclaw/workspace');
  let agents = config.agents?.list ?? [];

  if (filterAgentId) {
    agents = agents.filter((a) => a.id === filterAgentId);
    if (agents.length === 0) {
      console.error(`Agent "${filterAgentId}" not found in openclaw.json`);
      process.exit(1);
    }
  }

  return agents.map((a) => ({
    id: a.id,
    name: a.name ?? a.id,
    workspace: a.workspace ?? (a.id === 'main' ? defaultWorkspace : undefined),
    sessionsDir: join(HOME, `.openclaw/agents/${a.id}/sessions`),
  }));
}

/** Identity headers injected into every request. Set in main(). */
let identityHeaders = {};

function buildIdentityHeaders(userId, agentId) {
  const headers = {};
  if (userId && userId !== 'default') {
    headers['X-OpenViking-User'] = userId;
  }
  if (agentId && agentId !== 'default') {
    headers['X-OpenViking-Agent'] = agentId;
  }
  return headers;
}

async function post(baseUrl, endpoint, body, dryRun) {
  if (dryRun) {
    console.log(`  [DRY-RUN] POST ${endpoint} → ${JSON.stringify(body).slice(0, 120)}...`);
    return { status: 'ok', result: { id: 'dry-run' } };
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...identityHeaders },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function httpDelete(baseUrl, endpoint, dryRun) {
  if (dryRun) {
    console.log(`  [DRY-RUN] DELETE ${endpoint}`);
    return;
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'DELETE',
    headers: { ...identityHeaders },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function httpGet(baseUrl, endpoint) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    headers: { ...identityHeaders },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Existing URI cache ───────────────────────────────────────────────────────

async function fetchExistingUris(baseUrl, force, dryRun) {
  const existing = {
    memories: new Map(),
    skills: new Set(),
    resources: new Set(),
  };

  if (force || dryRun) return existing;

  console.log('  Fetching existing items for dedup...');

  try {
    const memRes = await httpGet(baseUrl, '/api/v1/memories?limit=5000');
    const memories = memRes.result ?? memRes.data ?? [];
    for (const m of memories) {
      if (m.uri) {
        const key = `${m.agentId ?? ''}::${m.uri}`;
        existing.memories.set(key, true);
      }
    }
    console.log(`    Memories: ${existing.memories.size} existing URIs cached`);
  } catch (e) {
    console.warn(`    Warning: could not fetch existing memories: ${e.message}`);
  }

  try {
    const skillRes = await httpGet(baseUrl, '/api/v1/skills?limit=1000');
    const skills = skillRes.result ?? skillRes.data ?? [];
    for (const s of skills) {
      if (s.uri) existing.skills.add(s.uri);
    }
    console.log(`    Skills: ${existing.skills.size} existing URIs cached`);
  } catch (e) {
    console.warn(`    Warning: could not fetch existing skills: ${e.message}`);
  }

  try {
    const resRes = await httpGet(baseUrl, '/api/v1/resources?limit=5000');
    const resources = resRes.result ?? resRes.data ?? [];
    for (const r of resources) {
      if (r.uri) existing.resources.add(r.uri);
    }
    console.log(`    Resources: ${existing.resources.size} existing URIs cached`);
  } catch (e) {
    console.warn(`    Warning: could not fetch existing resources: ${e.message}`);
  }

  return existing;
}

function memoryExists(existing, agentId, uri) {
  return existing.memories.has(`${agentId ?? ''}::${uri}`);
}

// ─── Identity files ──────────────────────────────────────────────────────────

async function ingestIdentity(agent, baseUrl, dryRun, existing) {
  if (!agent.workspace) return;

  const labels = [];

  for (const fname of IDENTITY_FILES) {
    const file = join(agent.workspace, fname);
    let content;
    try {
      content = readFile(file);
    } catch {
      counters.identity.skipped++;
      continue;
    }
    if (!content || content.length < 10) {
      counters.identity.skipped++;
      continue;
    }

    const uri = `viking://agent/memories/identity/${fname}`;

    if (memoryExists(existing, agent.id, uri)) {
      labels.push(`${fname} (exists)`);
      counters.identity.existed++;
      continue;
    }

    try {
      await post(baseUrl, '/api/v1/memories', {
        text: content,
        type: 'agent',
        category: 'profile',
        agentId: agent.id,
        uri,
      }, dryRun);
      labels.push(fname);
      counters.identity.ingested++;
    } catch (e) {
      labels.push(`${fname} (error)`);
      counters.identity.errors++;
    }
    await sleep(DELAY_MS);
  }

  if (labels.length > 0) {
    const formatted = labels.map((l) => {
      if (l.includes('(exists)')) return `${l.replace(' (exists)', '')} (skipped, exists)`;
      if (l.includes('(error)')) return l;
      return `${l} \u2714`;
    });
    console.log(`  \uD83E\uDDEC identity: ${formatted.join('  ')}`);
  }
}

// ─── Workspace memory files ──────────────────────────────────────────────────

async function ingestWorkspace(agent, baseUrl, dryRun, existing) {
  if (!agent.workspace) return;

  const memoryDir = join(agent.workspace, 'memory');
  const files = [
    join(agent.workspace, 'MEMORY.md'),
    ...walkFiles(memoryDir).filter((f) => !f.endsWith('.json')),
  ];

  const labels = [];

  for (const file of files) {
    let content;
    try {
      content = readFile(file);
    } catch {
      counters.workspace.skipped++;
      continue;
    }
    if (!content || content.length < 10) {
      counters.workspace.skipped++;
      continue;
    }

    const label = relative(agent.workspace, file);
    const uri = `viking://agent/memories/workspace/${basename(file)}`;

    if (memoryExists(existing, agent.id, uri)) {
      labels.push(`${label} (skipped, exists)`);
      counters.workspace.existed++;
      continue;
    }

    try {
      await post(baseUrl, '/api/v1/memories', {
        text: content,
        type: 'agent',
        category: 'general',
        agentId: agent.id,
        uri,
      }, dryRun);
      labels.push(`${label} \u2714`);
      counters.workspace.ingested++;
    } catch (e) {
      labels.push(`${label} (error)`);
      counters.workspace.errors++;
    }
    await sleep(DELAY_MS);
  }

  if (labels.length > 0) {
    console.log(`  \uD83D\uDCDD workspace: ${labels.length} files`);
    for (const l of labels) {
      console.log(`    ${l}`);
    }
  }
}

// ─── Sessions ────────────────────────────────────────────────────────────────

async function ingestSessions(agent, baseUrl, dryRun) {
  console.log(`\n  Sessions for ${agent.id}...`);

  let sessionFiles;
  try {
    sessionFiles = readdirSync(agent.sessionsDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    console.log('    No sessions dir found');
    return;
  }

  for (const file of sessionFiles) {
    const full = join(agent.sessionsDir, file);
    let lines;
    try {
      lines = readFileSync(full, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
    } catch {
      counters.sessions.skipped++;
      continue;
    }

    const messages = [];
    for (const line of lines) {
      if (line.type !== 'message') continue;
      const msg = line.message;
      if (!msg) continue;
      const role = msg.role;
      if (!['user', 'assistant'].includes(role)) continue;

      let text = '';
      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text || '')
          .join('\n')
          .trim();
      }

      // Strip system envelope headers from user messages
      if (role === 'user') {
        text = text
          .replace(/^System:.*?\n\n/s, '')
          .replace(/^Conversation info[\s\S]*?```\n/gm, '')
          .trim();
      }

      if (text.length > 20) {
        messages.push({ role, content: text.slice(0, 2000) });
      }
    }

    if (messages.length < 2) {
      counters.sessions.skipped++;
      continue;
    }

    try {
      const result = await post(baseUrl, '/api/v1/sessions/capture', {
        messages,
        agentId: agent.id,
      }, dryRun);
      const count = dryRun ? '?' : (result.result?.memories?.length ?? 0);
      console.log(`    + ${file} -> ${count} memories (${messages.length} msgs)`);
      counters.sessions.ingested++;
    } catch (e) {
      console.error(`    x ${file}: ${e.message}`);
      counters.sessions.errors++;
    }
    await sleep(DELAY_MS);
  }
}

// ─── Resources ───────────────────────────────────────────────────────────────

async function ingestResources(dirs, resourcePrefix, baseUrl, dryRun, existing) {
  for (const dir of dirs) {
    const resolvedDir = dir.startsWith('/') ? dir : join(process.cwd(), dir);
    const dirName = basename(resolvedDir);
    const prefix = resourcePrefix ?? `viking://resources/${dirName}`;

    console.log(`\n  Resources from ${resolvedDir} (prefix: ${prefix})...`);

    const files = walkFiles(resolvedDir);
    for (const file of files) {
      let content;
      try {
        content = readFile(file);
      } catch {
        counters.resources.skipped++;
        continue;
      }
      if (!content || content.length < 20) {
        counters.resources.skipped++;
        continue;
      }

      const relPath = relative(resolvedDir, file);
      const uri = `${prefix}/${relPath}`;

      if (existing.resources.has(uri)) {
        console.log(`    = ${relPath} (skipped, exists)`);
        counters.resources.existed++;
        continue;
      }

      try {
        await post(baseUrl, '/api/v1/resources', {
          text: content,
          to: uri,
          reason: `resource from ${relPath}`,
        }, dryRun);
        console.log(`    + ${relPath}`);
        counters.resources.ingested++;
      } catch (e) {
        console.error(`    x ${relPath}: ${e.message}`);
        counters.resources.errors++;
      }
      await sleep(DELAY_MS);
    }
  }
}

// ─── Skills ──────────────────────────────────────────────────────────────────

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();
    // Handle arrays like [tag1, tag2]
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
    }
    meta[key] = val;
  }
  return { meta, body: match[2] };
}

function discoverSkillDirs(baseDir) {
  const skills = [];
  if (!existsSync(baseDir)) return skills;

  const entries = readdirSync(baseDir);
  for (const entry of entries) {
    const full = join(baseDir, entry);
    const stat = statSync(full);
    if (!stat.isDirectory()) continue;

    const skillFile = join(full, 'SKILL.md');
    if (existsSync(skillFile)) {
      skills.push({ dir: full, skillFile, dirName: entry });
    }
  }
  return skills;
}

async function ingestSkills(dirs, baseUrl, dryRun, existing) {
  const ingestedUris = new Set();

  for (const dir of dirs) {
    const resolvedDir = dir.startsWith('/') ? dir : join(process.cwd(), dir);

    console.log(`\n  Skills from ${resolvedDir}...`);

    const skillDirs = discoverSkillDirs(resolvedDir);
    for (const { skillFile, dirName } of skillDirs) {
      let content;
      try {
        content = readFile(skillFile);
      } catch {
        counters.skills.skipped++;
        continue;
      }
      if (!content || content.length < 20) {
        counters.skills.skipped++;
        continue;
      }

      const { meta } = parseFrontmatter(content);
      const name = meta.name || dirName;
      const description = meta.description || `Skill: ${name}`;
      const tags = Array.isArray(meta.tags) ? meta.tags : [];
      const uri = `viking://agent/skills/${name}/`;

      ingestedUris.add(uri);

      if (existing.skills.has(uri)) {
        console.log(`    = ${name} (skipped, exists)`);
        counters.skills.existed++;
        continue;
      }

      try {
        await post(baseUrl, '/api/v1/skills', {
          data: {
            name,
            description,
            content,
            tags,
          },
        }, dryRun);
        console.log(`    + ${name}`);
        counters.skills.ingested++;
      } catch (e) {
        console.error(`    x ${name}: ${e.message}`);
        counters.skills.errors++;
      }
      await sleep(DELAY_MS);
    }
  }

  return ingestedUris;
}

// ─── Skill sync ──────────────────────────────────────────────────────────────

async function syncSkills(ingestedUris, baseUrl, dryRun) {
  console.log('\n  Syncing skills (removing stale)...');

  let serverSkills;
  try {
    const response = await httpGet(baseUrl, '/api/v1/skills?limit=1000');
    serverSkills = response.result ?? [];
  } catch (e) {
    console.error(`    x Failed to list server skills: ${e.message}`);
    return;
  }

  for (const skill of serverSkills) {
    if (ingestedUris.has(skill.uri)) {
      counters.skillSync.kept++;
      continue;
    }

    try {
      await httpDelete(baseUrl, `/api/v1/skills/${skill.id}`, dryRun);
      console.log(`    - Deleted: ${skill.name} (${skill.uri})`);
      counters.skillSync.deleted++;
    } catch (e) {
      console.error(`    x Failed to delete ${skill.name}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseCliArgs();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const baseUrl = opts['base-url'] ?? 'http://localhost:1934';
  const dryRun = opts['dry-run'] ?? false;
  const force = opts.force ?? false;
  const skipWorkspace = opts['no-workspace'] ?? false;
  const skipSessions = opts['no-sessions'] ?? false;
  const skipIdentity = opts['no-identity'] ?? false;
  const resourceDirs = opts.resources ?? [];
  const resourcePrefix = opts['resource-prefix'];
  const skillDirs = opts.skills ?? [];
  const syncSkillsFlag = opts['sync-skills'] ?? false;
  const userId = opts.user ?? 'default';

  // Set global identity headers for all requests
  identityHeaders = buildIdentityHeaders(userId, opts.agent ?? 'default');

  console.log('viking-ts ingest');
  console.log(`  Target: ${baseUrl}`);
  if (dryRun) console.log('  Mode: DRY-RUN (no changes will be made)');
  if (force) console.log('  Mode: FORCE (skipping dedup checks)');

  // Health check (skip in dry-run)
  if (!dryRun) {
    try {
      const health = await fetch(`${baseUrl}/health`);
      if (!health.ok) throw new Error(`HTTP ${health.status}`);
      console.log('  Server: healthy');
    } catch (e) {
      console.error(`  Server not reachable at ${baseUrl}: ${e.message}`);
      process.exit(1);
    }
  }

  const agents = loadAgents(opts.agent);
  console.log(`  Agents: ${agents.map((a) => a.id).join(', ')}`);

  // Fetch existing URIs once for dedup
  const existing = await fetchExistingUris(baseUrl, force, dryRun);

  // Per-agent ingestion
  for (const agent of agents) {
    console.log(`\n--- Agent: ${agent.id} ---`);

    if (!skipIdentity) {
      await ingestIdentity(agent, baseUrl, dryRun, existing);
    }

    if (!skipWorkspace) {
      await ingestWorkspace(agent, baseUrl, dryRun, existing);
    }

    if (!skipSessions) {
      await ingestSessions(agent, baseUrl, dryRun);
    }
  }

  // Resources (not per-agent)
  if (resourceDirs.length > 0) {
    await ingestResources(resourceDirs, resourcePrefix, baseUrl, dryRun, existing);
  }

  // Skills (not per-agent)
  let ingestedSkillUris = new Set();
  if (skillDirs.length > 0) {
    ingestedSkillUris = await ingestSkills(skillDirs, baseUrl, dryRun, existing);
  }

  // Skill sync
  if (syncSkillsFlag && skillDirs.length > 0) {
    await syncSkills(ingestedSkillUris, baseUrl, dryRun);
  }

  // Summary
  const totalExisted = counters.identity.existed + counters.workspace.existed +
    counters.resources.existed + counters.skills.existed;
  const totalIngested = counters.identity.ingested + counters.workspace.ingested +
    counters.sessions.ingested + counters.resources.ingested + counters.skills.ingested;
  const totalErrors = counters.identity.errors + counters.workspace.errors +
    counters.sessions.errors + counters.resources.errors + counters.skills.errors;

  console.log('\n========================================');
  console.log('Summary:');
  console.log(`  Identity:  ingested=${counters.identity.ingested}  existed=${counters.identity.existed}  skipped=${counters.identity.skipped}  errors=${counters.identity.errors}`);
  console.log(`  Workspace: ingested=${counters.workspace.ingested}  existed=${counters.workspace.existed}  skipped=${counters.workspace.skipped}  errors=${counters.workspace.errors}`);
  console.log(`  Sessions:  ingested=${counters.sessions.ingested}  skipped=${counters.sessions.skipped}  errors=${counters.sessions.errors}`);
  console.log(`  Resources: ingested=${counters.resources.ingested}  existed=${counters.resources.existed}  skipped=${counters.resources.skipped}  errors=${counters.resources.errors}`);
  console.log(`  Skills:    ingested=${counters.skills.ingested}  existed=${counters.skills.existed}  skipped=${counters.skills.skipped}  errors=${counters.skills.errors}`);
  if (syncSkillsFlag) {
    console.log(`  Skill sync: deleted=${counters.skillSync.deleted}  kept=${counters.skillSync.kept}`);
  }

  console.log(`\n  Total: ${totalIngested} ingested, ${totalExisted} existed (skipped), ${totalErrors} errors`);
  if (dryRun) console.log('  (DRY-RUN: no actual changes were made)');
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
