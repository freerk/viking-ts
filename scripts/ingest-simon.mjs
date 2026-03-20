#!/usr/bin/env node
/**
 * ingest-simon.mjs
 * Ingests Simon's memory files, session history, and Whisperline project docs
 * into the viking-ts server at http://localhost:1934
 *
 * Targets:
 *   - ~/.openclaw/workspace-simon/MEMORY.md         → memory (agent=simon)
 *   - ~/.openclaw/workspace-simon/memory/*.md        → memory (agent=simon)
 *   - ~/.openclaw/agents/simon/sessions/*.jsonl      → sessions/capture (agentId=simon)
 *   - ~/.openclaw/workspace/projects/whisperline/**  → resources (category=whisperline)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename, relative } from 'path';
import { homedir } from 'os';

const BASE_URL = 'http://localhost:1934';
const HOME = homedir();
const DELAY_MS = 300; // be gentle, rate limit

let ingested = 0;
let skipped = 0;
let errors = 0;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function post(endpoint, body) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function readFile(path) {
  return readFileSync(path, 'utf-8').trim();
}

function walkFiles(dir, exts = ['.md', '.txt']) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...walkFiles(full, exts));
      } else if (exts.some(e => entry.endsWith(e))) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

// ─── 1. Simon's workspace memory files ───────────────────────────────────────
async function ingestSimonMemory() {
  console.log('\n📂 Ingesting Simon workspace memory files...');

  const files = [
    join(HOME, '.openclaw/workspace-simon/MEMORY.md'),
    ...walkFiles(join(HOME, '.openclaw/workspace-simon/memory')),
  ];

  for (const file of files) {
    let content;
    try { content = readFile(file); } catch { skipped++; continue; }
    if (!content || content.length < 10) { skipped++; continue; }

    const label = relative(HOME, file);
    try {
      await post('/api/v1/memories', {
        text: content,
        type: 'agent',
        category: 'general',
        agentId: 'simon',
        uri: `viking://agent/memories/workspace/${basename(file)}`,
      });
      console.log(`  ✔ ${label}`);
      ingested++;
    } catch (e) {
      console.error(`  ✗ ${label}: ${e.message}`);
      errors++;
    }
    await sleep(DELAY_MS);
  }
}

// ─── 2. Simon's session conversations ────────────────────────────────────────
async function ingestSimonSessions() {
  console.log('\n💬 Ingesting Simon session conversations...');

  const sessionsDir = join(HOME, '.openclaw/agents/simon/sessions');
  let sessionFiles;
  try { sessionFiles = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl')); }
  catch { console.log('  No sessions dir found'); return; }

  for (const file of sessionFiles) {
    const full = join(sessionsDir, file);
    let lines;
    try {
      lines = readFileSync(full, 'utf-8')
        .split('\n')
        .filter(l => l.trim())
        .map(l => JSON.parse(l));
    } catch { skipped++; continue; }

    // Extract user/assistant message pairs
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
          .filter(c => c.type === 'text')
          .map(c => c.text || '')
          .join('\n')
          .trim();
      }

      // Strip system envelope headers from user messages
      if (role === 'user') {
        text = text.replace(/^System:.*?\n\n/s, '').replace(/^Conversation info[\s\S]*?```\n/gm, '').trim();
      }
      // Strip thinking blocks
      if (role === 'assistant') {
        // already filtered to type=text above, thinking is separate type
      }

      if (text.length > 20) {
        messages.push({ role, content: text.slice(0, 2000) });
      }
    }

    if (messages.length < 2) { skipped++; continue; }

    const sessionId = basename(file, '.jsonl');
    try {
      const result = await post('/api/v1/sessions/capture', {
        messages,
        agentId: 'simon',
      });
      const count = result.memories?.length ?? 0;
      console.log(`  ✔ ${file} → ${count} memories extracted (${messages.length} msgs)`);
      ingested++;
    } catch (e) {
      console.error(`  ✗ ${file}: ${e.message}`);
      errors++;
    }
    await sleep(DELAY_MS);
  }
}

// ─── 3. Whisperline project docs → resources ─────────────────────────────────
async function ingestWhisperlineProject() {
  console.log('\n📚 Ingesting Whisperline project docs as resources...');

  const projectDir = join(HOME, '.openclaw/workspace/projects/whisperline');
  const files = walkFiles(projectDir);

  for (const file of files) {
    let content;
    try { content = readFile(file); } catch { skipped++; continue; }
    if (!content || content.length < 20) { skipped++; continue; }

    const relPath = relative(projectDir, file);
    const uri = `viking://resources/whisperline/${relPath}`;

    try {
      await post('/api/v1/resources', {
        title: `whisperline > ${relPath.replace(/\//g, ' > ').replace('.md', '')}`,
        text: content,
        url: uri,
      });
      console.log(`  ✔ ${relPath}`);
      ingested++;
    } catch (e) {
      console.error(`  ✗ ${relPath}: ${e.message}`);
      errors++;
    }
    await sleep(DELAY_MS);
  }
}

// ─── 4. Simon's identity/soul files ──────────────────────────────────────────
async function ingestSimonIdentity() {
  console.log('\n🧬 Ingesting Simon identity files...');

  const identityFiles = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'USER.md'];
  const base = join(HOME, '.openclaw/workspace-simon');

  for (const fname of identityFiles) {
    const file = join(base, fname);
    let content;
    try { content = readFile(file); } catch { skipped++; continue; }
    if (!content || content.length < 10) { skipped++; continue; }

    try {
      await post('/api/v1/memories', {
        text: content,
        type: 'agent',
        category: 'profile',
        agentId: 'simon',
        uri: `viking://agent/memories/identity/${fname}`,
      });
      console.log(`  ✔ ${fname}`);
      ingested++;
    } catch (e) {
      console.error(`  ✗ ${fname}: ${e.message}`);
      errors++;
    }
    await sleep(DELAY_MS);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 viking-ts ingestion — Simon + Whisperline');
  console.log(`   Target: ${BASE_URL}`);

  // Health check
  const health = await fetch(`${BASE_URL}/health`);
  if (!health.ok) throw new Error('Server not reachable');
  console.log('   Server: ✔ healthy\n');

  await ingestSimonIdentity();
  await ingestSimonMemory();
  await ingestSimonSessions();
  await ingestWhisperlineProject();

  console.log('\n─────────────────────────────────────');
  console.log(`✅ Done. ingested=${ingested}  skipped=${skipped}  errors=${errors}`);

  // Quick search test
  console.log('\n🔍 Test search: "Simon sociology"');
  const res = await fetch(`${BASE_URL}/api/v1/memories/search?q=Simon+sociology&limit=3`);
  const results = await res.json();
  const items = Array.isArray(results) ? results : (results.items ?? results.data ?? []);
  for (const r of items) {
    console.log(`  [${(r.score * 100).toFixed(1)}%] ${(r.l0Abstract || r.text || '').slice(0, 100)}`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
