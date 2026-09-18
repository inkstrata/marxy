import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const ROOT = new URL('../', import.meta.url).pathname;
export const here = p => `${ROOT}orchestration/${p}`;
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
export const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

const ROLE_KEYS = ['orchestrator', 'planner', 'implementor', 'implementorEscalation', 'reviewer'];
const COMPUTE_ALIASES = { 'low-compute': 'low', cheap: 'low', min: 'minimal' };

export function computeFromArgv(argv = process.argv) {
  if (argv.includes('--low')) return 'low';
  if (argv.includes('--minimal')) return 'minimal';
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
export const pathsOf = st => st.Paths.split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\*.*$/, '').replace(/\/$/, ''));
export const overlap = (a, b) => a.some(x => b.some(y => x === y || x.startsWith(y + '/') || y.startsWith(x + '/') || x.startsWith(y) && y.endsWith('.json') === false && x.split('/')[0] === y.split('/')[0] && (x.startsWith(y) || y.startsWith(x))));
export const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export const typeOf = st => /research/.test(st.Labels) ? 'research' : /release|agent-loop/.test(st.Labels) ? 'chore' : 'feat';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const m = models();
  const roles = Object.fromEntries(ROLE_KEYS.map(k => [k, m[k]]));
  console.log(JSON.stringify({ compute: m.compute, ...roles }, null, 2));
}
