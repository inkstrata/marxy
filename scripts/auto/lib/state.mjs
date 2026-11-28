// Local run state (jsonl logs) and the orphan `auto-state` branch that carries results between devices.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ghToken } from './github.mjs';

const REMOTE = 'https://github.com/inkstrata/marxy.git';
const BRANCH = 'auto-state';
const README = '# auto-state\n\nData branch for the standing automation, no source code: `dashboard.md` and `nights/` results.\n';

// MARXY_STATE_DIR exists so tests never touch the real state.
export function stateDir() {
  const dir = process.env.MARXY_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'fleet', 'marxy');
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  return dir;
}

const jsonlPath = (name) => path.join(stateDir(), name.endsWith('.jsonl') ? name : `${name}.jsonl`);

export const appendJsonl = (name, obj) => fs.appendFileSync(jsonlPath(name), `${JSON.stringify(obj)}\n`);

export function readJsonl(name, { limit } = {}) {
  let text;
  try { text = fs.readFileSync(jsonlPath(name), 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn last line is skipped */ }
  }
  return limit ? rows.slice(-limit) : rows;
}

// The token travels in the child's environment and is read by a credential helper, never put on a command line.
function git(cwd, args, { remote } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (remote && /^https?:/.test(remote)) {
    const token = ghToken();
    if (token) {
      // The empty first helper clears any inherited one; the second answers with the token.
      Object.assign(env, {
        MARXY_GIT_TOKEN: token, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '', GIT_CONFIG_KEY_1: 'credential.helper',
        GIT_CONFIG_VALUE_1: '!f() { echo username=x-access-token; echo password=$MARXY_GIT_TOKEN; }; f',
      });
    }
  }
  const ident = ['-c', 'user.name=marxy-auto', '-c', 'user.email=inkstrata@users.noreply.github.com'];
  return execFileSync('git', [...ident, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Only publish() may create the branch; readers just return nothing when it is absent.
function ensureClone(dir, remote, create = true) {
  if (fs.existsSync(path.join(dir, '.git'))) return;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    git(path.dirname(dir), ['clone', '--branch', BRANCH, '--single-branch', remote, dir], { remote });
    return;
  } catch { /* branch missing on the remote */ }
  if (!create) throw new Error('no auto-state branch');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', BRANCH]);
  git(dir, ['remote', 'add', 'origin', remote]);
  fs.writeFileSync(path.join(dir, 'README.md'), README);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'Start the auto-state branch']);
  git(dir, ['push', '-u', 'origin', BRANCH], { remote });
}

function opts(o = {}) {
  return { remote: o.remoteUrl || REMOTE, dir: o.dir || path.join(stateDir(), 'auto-state') };
}

// Returns true when a commit was pushed, false when nothing changed.
export function publish(files, message, o) {
  const { remote, dir } = opts(o);
  ensureClone(dir, remote);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      git(dir, ['pull', '--rebase', 'origin', BRANCH], { remote });
      for (const [rel, text] of Object.entries(files)) {
        const target = path.join(dir, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
      }
      git(dir, ['add', '-A']);
      if (!git(dir, ['status', '--porcelain']).trim()) return false;
      git(dir, ['commit', '-m', message]);
      git(dir, ['push', 'origin', BRANCH], { remote });
      return true;
    } catch (e) {
      lastErr = e;
      // A rejected push leaves our commit local; the next pull --rebase replays it, so just retry.
      try { git(dir, ['rebase', '--abort']); } catch { /* none in progress */ }
    }
  }
  throw new Error(`publish failed: ${String(lastErr?.stderr || lastErr?.message || lastErr).split('\n')[0]}`);
}

// Readers pull but never create the branch; they return the fallback when it is absent.
function fromClone(o, read, fallback) {
  const { remote, dir } = opts(o);
  try {
    ensureClone(dir, remote, false);
    git(dir, ['pull', '--rebase', 'origin', BRANCH], { remote });
    return read(dir);
  } catch { return fallback; }
}

export const readPublished = (rel, o) => fromClone(o, (dir) => fs.readFileSync(path.join(dir, rel), 'utf8'), null);
export const listPublished = (relDir, o) => fromClone(o, (dir) => fs.readdirSync(path.join(dir, relDir)).sort(), []);

// Owner share of the week: weekly percent used now, minus what the automation's runs added.
// Each run start/end pair carries the newest usage snapshot at that moment, so the growth of
// the weekly meter between them is attributed to automation. Pairs before the last reset are ignored.
export function attribution(runs, weeklyNow, lastResetAt) {
  const open = new Map();
  let auto = 0;
  for (const r of runs) {
    if (new Date(r.at) < lastResetAt) continue;
    const pct = r.usage?.weekly?.pct;
    if (typeof pct !== 'number') continue;
    if (r.event === 'start') open.set(r.run, pct);
    else if (r.event === 'end' && open.has(r.run)) {
      auto += Math.max(0, pct - open.get(r.run));
      open.delete(r.run);
    }
  }
  const total = typeof weeklyNow === 'number' ? weeklyNow : null;
  return { autoPct: auto, ownerPct: total == null ? null : Math.max(0, total - auto), totalPct: total };
}
