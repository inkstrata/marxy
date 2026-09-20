// Shared board helpers. pathsOf keeps glob segments so a path like packages/*/package.json
// is not collapsed to packages (MARXY-9).
import { readFileSync, writeFileSync, existsSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Cursor Agent CLI for headless implementors. Honors CURSOR_AGENT, then PATH, then ~/.local/bin. */
export function cursorAgentBin(env = process.env, home = homedir()) {
  const named = env.CURSOR_AGENT?.trim();
  if (named) {
    if (named.includes('/') && executable(named)) return named;
    const w = spawnSync('sh', ['-c', `command -v ${JSON.stringify(named)}`], { encoding: 'utf8', env });
    const p = w.stdout?.trim();
    if (p && executable(p)) return p;
  }
  const onPath = spawnSync('sh', ['-c', 'command -v cursor-agent'], { encoding: 'utf8', env }).stdout?.trim();
  if (onPath && executable(onPath)) return onPath;
  const local = resolve(home, '.local/bin/cursor-agent');
  if (executable(local)) return local;
  return null;
}
export const ROOT = new URL('../', import.meta.url).pathname;
export const here = p => `${ROOT}orchestration/${p}`;
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
export const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

const ROLE_KEYS = ['orchestrator', 'planner', 'implementor', 'implementorEscalation', 'reviewer'];
const COMPUTE_ALIASES = { 'low-compute': 'low', cheap: 'low', min: 'minimal' };

export function computeFromArgv(argv = process.argv) {
  if (argv.includes('--low')) return 'low';
  if (argv.includes('--minimal')) return 'minimal';
  if (argv.includes('--high')) return 'high';
  const i = argv.findIndex(x => x === '--compute' || x.startsWith('--compute='));
  if (i < 0) return null;
  const raw = argv[i].includes('=') ? argv[i].slice('--compute='.length) : argv[i + 1];
  return raw || null;
}

/** Concurrent in-progress stories dispatch may start. null / 0 / omitted → uncapped. */
export function laneBudget(m = models()) {
  const n = m.lanes;
  if (n == null || n === 0) return Infinity;
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid lanes ${n}`);
  return n;
}

export function models(raw = readJson(here('models.json')), argv = process.argv, env = process.env) {
  const requested = (computeFromArgv(argv) || env.MARXY_COMPUTE || raw.compute || 'default').toLowerCase();
  const compute = COMPUTE_ALIASES[requested] ?? requested;
  if (raw.modes) {
    if (!raw.modes[compute]) throw new Error(`unknown compute mode "${compute}"; known: ${Object.keys(raw.modes).join(', ')}`);
  } else if (compute !== 'default') {
    throw new Error(`unknown compute mode "${compute}"; models.json has no modes`);
  }
  const roles = raw.modes?.[compute] ?? Object.fromEntries(ROLE_KEYS.map(k => [k, raw[k]]));
  return { ...raw, ...roles, compute };
}

export const deps = () => readJson(here('deps.json'));
export function parseCsv(t) { const rows = []; let row = [], cell = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c; } if (cell || row.length) { row.push(cell); rows.push(row); } const [h, ...rest] = rows; return rest.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
export function stories() {
  const csv = parseCsv(readFileSync(`${ROOT}docs/plan/jira-issues.csv`, 'utf8')).filter(r => r.Type === 'Story');
  const research = Object.entries(deps().research || {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => ({ Key: k, Type: 'Research', Summary: v.summary, Paths: v.paths, Acceptance: 'A decision note committed at the path named in the summary, with measurements.', Labels: 'research', Parent: '' }));
  return [...csv, ...research];
}
export function state() {
  const p = here('state.json');
  if (!existsSync(p)) { const s = { updated: new Date().toISOString(), merges: 0, lastPlan: null, stories: {} }; for (const st of stories()) s.stories[st.Key] = { status: 'todo', attempts: 0 }; writeJson(p, s); }
  return readJson(p);
}
export function saveState(s) { s.updated = new Date().toISOString(); writeJson(here('state.json'), s); }
/** Listed paths as written. A glob keeps every segment, including `*`. */
export function pathsOf(st) {
  return String(st?.Paths ?? '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\/$/, ''));
}

/** Whether `file` sits on an allowed path, including a mid-path glob. */
export function pathMatches(file, allowedPath) {
  const q = String(allowedPath ?? '').replace(/\/$/, '');
  if (!q) return false;
  if (q.includes('*')) {
    const re = new RegExp('^' + q.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '(/|$)');
    return re.test(file);
  }
  return file === q || file.startsWith(q + '/');
}

/** Whether two path segments match, treating a `*` on either side as one segment (MARXY-119). */
function segmentEq(a, b) {
  if (a === b) return true;
  if (!a.includes('*') && !b.includes('*')) return false;
  const toRe = s => new RegExp('^' + s.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  if (a.includes('*') && toRe(a).test(b)) return true;
  if (b.includes('*') && toRe(b).test(a)) return true;
  return false;
}

/** Whether `x` and `y` name the same file, or one is a directory prefix of the other, glob-aware. */
function pathsOverlap(x, y) {
  const xs = x.replace(/\/$/, '').split('/');
  const ys = y.replace(/\/$/, '').split('/');
  const len = Math.min(xs.length, ys.length);
  for (let i = 0; i < len; i++) if (!segmentEq(xs[i], ys[i])) return false;
  return true;
}

/** The paths every story may touch regardless of its own Paths list (scripts/registry.json). */
export const extraAllowedPaths = () => readJson(`${ROOT}scripts/registry.json`).extraAllowedPaths ?? [];

/** Whether any path in `a` could touch the same file as any path in `b`, ignoring paths every
 * story is allowed anyway (MARXY-119). */
export function overlap(a, b) {
  const extra = new Set(extraAllowedPaths());
  const af = a.filter(x => !extra.has(x));
  const bf = b.filter(y => !extra.has(y));
  return af.some(x => bf.some(y => pathsOverlap(x, y)));
}
export const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export const typeOf = st => /research/.test(st.Labels) ? 'research' : /release|agent-loop/.test(st.Labels) ? 'chore' : 'feat';

/** Comma-separated Labels as a trimmed list. */
export const labelsOf = st => String(st?.Labels ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** Whether the story carries this exact label. */
export const hasLabel = (st, name) => labelsOf(st).includes(name);

/** Phase number from deps.json `phases`, or null if the key is unlisted. */
export function phaseOf(key, d = deps()) {
  for (const [phase, keys] of Object.entries(d.phases || {})) {
    if ((keys || []).includes(key)) return Number(phase);
  }
  return null;
}

/** True when any story in a lower numbered phase is still todo or in_progress. */
export function earlierPhaseOpen(phase, d, s) {
  if (phase == null || !Number.isFinite(phase)) return false;
  for (const [p, keys] of Object.entries(d.phases || {})) {
    // A non-numeric phase (`ops`) is a lane beside the numbered phases, not an earlier one.
    if (!Number.isFinite(Number(p)) || Number(p) >= phase) continue;
    if ((keys || []).some(k => {
      const status = s.stories[k]?.status ?? 'todo';
      return status === 'todo' || status === 'in_progress';
    })) return true;
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const m = models();
  const roles = Object.fromEntries(ROLE_KEYS.map(k => [k, m[k]]));
  console.log(JSON.stringify({ compute: m.compute, ...roles }, null, 2));
}
