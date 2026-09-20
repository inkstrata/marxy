// Shared helpers for the hygiene scripts. No dependencies beyond Node.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const registry = () => JSON.parse(readFileSync(join(ROOT, 'scripts/registry.json'), 'utf8'));
export const sh = (cmd, opts = {}) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim(); } catch (e) { if (opts.soft) return ''; throw e; } };

export const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.git', 'results', 'out', '.venv', 'goldens', 'baselines']);
export function walk(dir, pred = () => true, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, pred, out); }
    else if (pred(full)) out.push(full);
  }
  return out;
}
export const rel = p => relative(ROOT, p);
export const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/** Files changed on this branch relative to origin/main, plus working-tree changes; or only the staged ones. */
/**
 * The staged files a commit is answerable for.
 *
 * In a merge commit that is not everything staged: a merge stages every file the other side brought,
 * and against the story's paths those read as a hundred violations the author never wrote. What the
 * author is answerable for is what they resolved — the files that differ from *both* parents. Without
 * this, every branch that falls behind can only get back to mergeable through `--no-verify`, which
 * skips the checks that do matter, and a guard that teaches people to bypass guards is worse than none.
 */
export function stagedNames({ cwd = ROOT } = {}) {
  const names = r => new Set(sh(`git diff --cached --name-only --diff-filter=ACMR ${r}`, { cwd, soft: true }).split('\n').filter(Boolean));
  const merging = sh('git rev-parse -q --verify MERGE_HEAD', { cwd, soft: true }).trim();
  const head = names('HEAD');
  if (!merging) return [...head].join('\n');
  const other = names('MERGE_HEAD');
  return [...head].filter(f => other.has(f)).join('\n');
}

export function changedFiles({ staged = false } = {}) {
  const set = new Set();
  const add = out => out.split('\n').filter(Boolean).forEach(f => set.add(f));
  if (staged) { add(stagedNames()); return [...set]; }
  add(sh('git diff --name-only --diff-filter=ACMR origin/main...HEAD', { soft: true }));
  add(sh('git diff --name-only --diff-filter=ACMR', { soft: true }));
  add(sh('git diff --cached --name-only --diff-filter=ACMR', { soft: true }));
  add(sh('git ls-files --others --exclude-standard', { soft: true }));
  return [...set];
}

/** The story key for this branch: type/KEY-slug, or --key, or MARXY_STORY. */
export function storyKey(argv = process.argv) {
  const i = argv.indexOf('--key'); if (i >= 0) return argv[i + 1];
  if (process.env.MARXY_STORY) return process.env.MARXY_STORY;
  return keyFromBranch(branchName());
}

/**
 * The branch this change is on. A pull-request checkout is detached, so `rev-parse` answers "HEAD"
 * and no key can be read from it — which is why the CI story-boundary step could never pass and
 * was wrapped in `|| echo ::warning::` rather than fixed (MARXY-153). On a pull request the source
 * branch is GITHUB_HEAD_REF; GITHUB_REF_NAME covers a push. Local runs keep using the real branch.
 */
export function branchName(env = process.env) {
  const local = sh('git rev-parse --abbrev-ref HEAD', { soft: true });
  if (local && local !== 'HEAD') return local;
  return env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || local;
}

/** Exported so the detached-checkout case can be tested without a detached checkout. */
export function keyFromBranch(branch) {
  const m = /\/(MARXY-(?:\d+|[0-9A-Z]{3}|R\d+))-/.exec(branch ?? '') || /^(MARXY-\d+)/.exec(branch ?? '');
  return m ? m[1] : null;
}

function parseCsv(t) { const rows = []; let row = [], cell = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c; } if (cell || row.length) { row.push(cell); rows.push(row); } const [h, ...rest] = rows; return rest.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }

/** The CSV row for a key; resolves Jira keys through orchestration/jira-map.json when the CSV still uses plan ids, and vice versa. */
export function story(key) {
  if (!key) return null;
  const rows = parseCsv(readFileSync(join(ROOT, 'docs/plan/jira-issues.csv'), 'utf8'));
  let row = rows.find(r => r.Key === key);
  const mapPath = join(ROOT, 'orchestration/jira-map.json');
  if (!row && existsSync(mapPath)) {
    const map = JSON.parse(readFileSync(mapPath, 'utf8')).keys || {};
    const planId = Object.entries(map).find(([, v]) => v === key)?.[0];
    row = rows.find(r => r.Key === planId) || rows.find(r => r.Key === map[key]);
  }
  return row || null;
}
export const pathsOf = row => (row?.Paths || '').split(',').map(s => s.trim()).filter(Boolean);
export function allowedByPaths(file, paths) {
  return paths.some(p => {
    const q = p.replace(/\/$/, '');
    if (q.includes('*')) { const re = new RegExp('^' + q.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '(/|$)'); return re.test(file); }
    return file === q || file.startsWith(q + '/');
  });
}
export const isFrozen = (file, reg = registry()) => reg.frozen.some(f => file === f || file.startsWith(f));
export function fail(lines) { if (!lines.length) return false; for (const l of lines) console.error(`✗ ${l}`); return true; }
export const fix = s => `\n    fix: ${s}`;
