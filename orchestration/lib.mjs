import { readFileSync, writeFileSync, existsSync } from 'node:fs';
export const ROOT = new URL('../', import.meta.url).pathname;
export const here = p => `${ROOT}orchestration/${p}`;
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
export const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
export const models = () => readJson(here('models.json'));
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
