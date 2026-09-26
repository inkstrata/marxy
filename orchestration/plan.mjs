// The plan the fleet acts on is the plan on origin/main, read from git objects — never from a
// working tree. A checkout that is behind, on another branch or carrying half an edit cannot change
// what is dispatched, so "board drift" is not a state the fleet can be in (ADR-0034; it replaces the
// MARXY-117 drift hold and the MARXY-223 park).
import { git } from './proc.mjs';
import { CODE_ROOT } from './store.mjs';
import { parseCsv, isPlaceholderKey, pathsOf } from './lib.mjs';

export const CSV_PATH = 'docs/plan/jira-issues.csv';
export const DEPS_PATH = 'orchestration/deps.json';
export const REGISTRY_PATH = 'scripts/registry.json';
export const MAP_PATH = 'orchestration/jira-map.json';

/** A file's text at a ref, or null. */
export function showAt(ref, path, { cwd = CODE_ROOT, show = (r, p) => git(['show', `${r}:${p}`], { cwd }) } = {}) {
  const r = show(ref, path);
  return r.ok ? r.out + '\n' : null;
}

/** Story rows from CSV text, plus deps.json research entries, minus placeholder rows. */
export function rowsFrom(csvText, depsJson = {}) {
  const csv = parseCsv(csvText ?? '').filter(r => r.Type === 'Story' && !isPlaceholderKey(r.Key));
  const research = Object.entries(depsJson.research ?? {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => ({ Key: k, Type: 'Research', Summary: v.summary, Paths: v.paths, Acceptance: 'A decision note committed at the path named in the summary, with measurements.', Labels: 'research', Parent: '' }));
  return [...csv, ...research];
}

const parseJson = (text, fallback) => { try { return JSON.parse(text ?? ''); } catch { return fallback; } };

/**
 * The plan at `ref` (origin/main by default): rows, deps, phases, the paths every story may touch,
 * and the Jira renames. `read(ref, path)` is injectable so a test never needs a repository.
 */
export function planAt(ref = 'origin/main', { read = (r, p) => showAt(r, p) } = {}) {
  const csv = read(ref, CSV_PATH);
  const deps = parseJson(read(ref, DEPS_PATH), { deps: {}, phases: {} });
  const registry = parseJson(read(ref, REGISTRY_PATH), {});
  const map = parseJson(read(ref, MAP_PATH), {});
  if (csv == null) throw new Error(`cannot read ${CSV_PATH} at ${ref}; is origin fetched?`);
  const rows = rowsFrom(csv, deps);
  return {
    ref,
    rows,
    byKey: new Map(rows.map(r => [r.Key, r])),
    deps: { deps: deps.deps ?? {}, phases: deps.phases ?? {}, research: deps.research ?? {} },
    extraAllowed: registry.extraAllowedPaths ?? [],
    renames: map.keys ?? {},
  };
}

/** The row a branch carries for its own key: how an out-of-plan PR's row is found before it lands. */
export function rowOnBranch(branch, key, { read = (r, p) => showAt(r, p) } = {}) {
  const csv = read(`origin/${branch}`, CSV_PATH);
  if (csv == null) return null;
  return rowsFrom(csv).find(r => r.Key === key) ?? null;
}

/** Phase number of a key, or null for the ops lane / unlisted. */
export function phaseIn(plan, key) {
  for (const [phase, keys] of Object.entries(plan.deps.phases)) {
    if ((keys ?? []).includes(key) && Number.isFinite(Number(phase))) return Number(phase);
  }
  return null;
}

export { pathsOf };
