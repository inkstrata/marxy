// Keeps the State and PR columns of docs/plan/roadmap-2026-10/waves.md equal to the ledger
// (progress.md), by story id, and touches no other byte of waves.md (X-20).
// A story the ledger has not caught up on can be listed in waves-github.json beside waves.md; the
// later of the two states wins, so an entry stops mattering once the ledger reaches it.
// usage: node scripts/waves.mjs [--check] [--root DIR]   (--check exits 1 when waves.md is stale)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, fix } from './lib/repo.mjs';

export const PLAN_DIR = 'docs/plan/roadmap-2026-10';
const PR_URL = 'https://github.com/inkstrata/marxy/pull/';
const ID = '[A-Z]+-\\d+[a-z]?(?:\\.\\d+)*';
const RANK = { ready: 0, running: 1, 'needs author': 2, returned: 3, 'in review': 3, merged: 4 };

/** Splits a table line into its trimmed cells (no leading or trailing empty cell). */
export function cells(line) {
  const parts = line.trim().split('|');
  return parts.slice(1, parts.length - 1).map(c => c.trim());
}

/** id -> { state, pr } from the ledger's table: Id | Title | Model | State | PR | ... */
export function parseProgress(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const c = cells(line);
    if (c.length < 5 || !new RegExp(`^${ID}$`).test(c[0])) continue;
    out.set(c[0], { state: c[3].toLowerCase(), pr: c[4].match(/#(\d+)/)?.[1] ?? null });
  }
  return out;
}

/** The ledger's entry, or the override when the override's state is further along. */
export function effective(id, progress, overrides = {}) {
  const base = progress.get(id) ?? null;
  const o = overrides[id];
  if (!o) return base;
  if (!base) return { state: o.state, pr: o.pr ? String(o.pr) : null };
  if ((RANK[o.state] ?? -1) > (RANK[base.state] ?? -1)) return { state: o.state, pr: o.pr ? String(o.pr) : base.pr };
  return base;
}

const prCell = pr => (pr ? `[#${pr}](${PR_URL}${pr})` : '—');

/**
 * waves.md with every table row's State and PR cells set from the ledger. A table is any block
 * whose header names Story, State and PR; a row is addressed by the id in its Story cell.
 * Returns { text, unknown } where `unknown` lists story ids the ledger has no entry for.
 */
export function updateWaves(waves, progress, overrides = {}) {
  const lines = waves.split('\n');
  const unknown = [];
  let cols = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) {
      cols = null;
      continue;
    }
    const c = cells(line);
    const head = ['Story', 'State', 'PR'].map(h => c.indexOf(h));
    if (head.every(x => x >= 0)) {
      cols = { story: head[0], state: head[1], pr: head[2] };
      continue;
    }
    if (!cols || /^:?-+:?$/.test(c[0] ?? '')) continue;
    const id = c[cols.story]?.match(new RegExp(`^\\[(${ID})\\]`))?.[1];
    if (!id) continue;
    const e = effective(id, progress, overrides);
    if (!e) {
      unknown.push(id);
      continue;
    }
    c[cols.state] = e.state;
    c[cols.pr] = prCell(e.pr);
    lines[i] = `| ${c.join(' | ')} |`;
  }
  return { text: lines.join('\n'), unknown };
}

/** Override ids the ledger has caught up with, so the entry can be deleted. */
export function redundantOverrides(progress, overrides = {}) {
  return Object.keys(overrides).filter(id => {
    const b = progress.get(id);
    return b && (RANK[b.state] ?? -1) >= (RANK[overrides[id].state] ?? -1);
  });
}

function main(argv) {
  const check = argv.includes('--check');
  const rootArg = argv.indexOf('--root');
  const root = rootArg >= 0 ? resolve(argv[rootArg + 1]) : ROOT;
  const dir = join(root, PLAN_DIR);
  const wavesPath = join(dir, 'waves.md');
  const progress = parseProgress(readFileSync(join(dir, 'progress.md'), 'utf8'));
  const ovPath = join(dir, 'waves-github.json');
  const overrides = existsSync(ovPath) ? JSON.parse(readFileSync(ovPath, 'utf8')).stories ?? {} : {};
  const before = readFileSync(wavesPath, 'utf8');
  const { text, unknown } = updateWaves(before, progress, overrides);
  for (const id of redundantOverrides(progress, overrides)) console.log(`note: progress.md has caught up with ${id}; delete it from waves-github.json`);
  if (unknown.length) {
    console.error(`${PLAN_DIR}/waves.md names stories the ledger does not have: ${unknown.join(', ')}${fix('add the row to progress.md, or correct the id in waves.md')}`);
    return 1;
  }
  if (text === before) {
    console.log('waves.md is current');
    return 0;
  }
  if (check) {
    console.error(`${PLAN_DIR}/waves.md is stale against progress.md${fix('run node scripts/waves.mjs and commit waves.md')}`);
    return 1;
  }
  writeFileSync(wavesPath, text);
  console.log('waves.md updated');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)));
