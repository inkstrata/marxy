// Shared helpers for the check scripts. No dependencies beyond Node.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const registry = () => JSON.parse(readFileSync(join(ROOT, 'scripts/registry.json'), 'utf8'));
export const sh = (cmd, opts = {}) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim(); } catch (e) { if (opts.soft) return ''; throw e; } };

// `.claude` can hold worktrees nested inside a checkout: whole second copies of the tree, git-excluded,
// whose files would otherwise be judged as this checkout's. `work` holds tracking and run records (logs, probes,
// copies of old code under review), which are not the software and answer to none of its rules.
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.git', '.claude', 'results', 'out', '.venv', 'goldens', 'baselines', 'work']);
// The Reader Typography Handbook: a research corpus whose lab pages are experiments, not the app.
export const SKIP_PATHS = new Set(['docs/research']);
export function walk(dir, pred = () => true, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name).split(sep).join('/');
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !SKIP_PATHS.has(rel(full))) walk(full, pred, out); }
    else if (pred(full)) out.push(full);
  }
  return out;
}
export const rel = p => relative(ROOT, p).split(sep).join('/');
export const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/**
 * The staged files a commit is answerable for.
 *
 * In a merge commit that is not everything staged: a merge stages every file the other side brought.
 * What the author is answerable for is what they resolved, the files that differ from *both* parents.
 */
export function stagedNames({ cwd = ROOT } = {}) {
  const names = r => new Set(sh(`git diff --cached --name-only --diff-filter=ACMR ${r}`, { cwd, soft: true }).split('\n').filter(Boolean));
  const merging = sh('git rev-parse -q --verify MERGE_HEAD', { cwd, soft: true }).trim();
  const head = names('HEAD');
  if (!merging) return [...head].join('\n');
  const other = names('MERGE_HEAD');
  return [...head].filter(f => other.has(f)).join('\n');
}

/** Files changed in the working tree and the index, plus untracked ones; or only the staged ones. */
export function changedFiles({ staged = false } = {}) {
  const set = new Set();
  const add = out => out.split('\n').filter(Boolean).forEach(f => set.add(f));
  if (staged) { add(stagedNames()); return [...set]; }
  add(sh('git diff --name-only --diff-filter=ACMR', { soft: true }));
  add(sh('git diff --cached --name-only --diff-filter=ACMR', { soft: true }));
  add(sh('git ls-files --others --exclude-standard', { soft: true }));
  return [...set];
}

export function fail(lines) { if (!lines.length) return false; for (const l of lines) console.error(`✗ ${l}`); return true; }
export const fix = s => `\n    fix: ${s}`;
