// The plan the fleet acts on is the plan on origin/main, read from git objects — never from a
// working tree. A checkout that is behind, on another branch or carrying half an edit cannot change
// what is dispatched, so "board drift" is not a state the fleet can be in (ADR-0034; it replaces the
// MARXY-117 drift hold and the MARXY-223 park).
import { git } from './proc.mjs';
import { CODE_ROOT } from './store.mjs';
import { parseCsv, isPlaceholderKey, pathsOf } from './lib.mjs';
import { planFrom, gitSnapshot, storyRows, CSV_REL, DEPS_REL, EPICS_REL } from '../scripts/lib/plan.mjs';

export const CSV_PATH = CSV_REL;
export const DEPS_PATH = DEPS_REL;
export const REGISTRY_PATH = 'scripts/registry.json';
export const MAP_PATH = 'orchestration/jira-map.json';

/** A file's text at a ref, or null. */
export function showAt(ref, path, { cwd = CODE_ROOT, show = (r, p) => git(['show', `${r}:${p}`], { cwd }) } = {}) {
  const r = show(ref, path);
  return r.ok ? r.out + '\n' : null;
}

/** Story rows from CSV text, plus deps.json research entries, minus placeholder rows. */
export function rowsFrom(csvText, depsJson = {}) {
  return storyRows(parseCsv(csvText ?? ''), depsJson.research, isPlaceholderKey);
}

const parseJson = (text, fallback) => { try { return JSON.parse(text ?? ''); } catch { return fallback; } };

/**
 * The reader for a ref: the story files and epics when the ref has them, else the CSV and deps.json,
 * from git objects (one `ls-tree`, one `cat-file --batch`). `read(ref, path)` and `list(ref, dir)` are
 * injectable so a test never needs a repository; with neither, only the CSV form can be read.
 */
function readerAt(ref, { read, list }, extra = [CSV_PATH, DEPS_PATH, EPICS_REL, REGISTRY_PATH, MAP_PATH]) {
  if (read) return { read: p => read(ref, p), list: list ? d => list(ref, d) : () => [] };
  return gitSnapshot(ref, { cwd: CODE_ROOT, extra });
}

/**
 * The plan at `ref` (origin/main by default): rows, deps, phases, the paths every story may touch,
 * and the Jira renames.
 */
export function planAt(ref = 'origin/main', opts = {}) {
  const r = readerAt(ref, opts);
  const registry = parseJson(r.read(REGISTRY_PATH), {});
  const map = parseJson(r.read(MAP_PATH), {});
  const plan = planFrom(r);
  if (!plan?.all.length) throw new Error(`cannot read ${CSV_PATH} at ${ref}; is origin fetched?`);
  const deps = plan.deps;
  const rows = storyRows(plan.all, deps.research, isPlaceholderKey);
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
export function rowOnBranch(branch, key, opts = {}) {
  const r = readerAt(`origin/${branch}`, opts, [CSV_PATH, DEPS_PATH, EPICS_REL]);
  const plan = planFrom({ read: p => r.read(p), list: r.list });
  if (!plan) return null;
  return storyRows(plan.all).find(x => x.Key === key) ?? null;
}

/** Phase number of a key, or null for the ops lane / unlisted. */
export function phaseIn(plan, key) {
  for (const [phase, keys] of Object.entries(plan.deps.phases)) {
    if ((keys ?? []).includes(key) && Number.isFinite(Number(phase))) return Number(phase);
  }
  return null;
}

export { pathsOf };
