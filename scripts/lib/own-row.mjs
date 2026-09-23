// A branch may edit the board for its own story and no other (MARXY-190).
//
// The board is two files: a story's row in docs/plan/jira-issues.csv and its phase and deps entry in
// orchestration/deps.json. An out-of-plan change carries its own row in its own pull request, and a
// story may widen its own Paths in review, so neither needs a second PR. What a branch may never do
// is change somebody else's row: that is the planner's job, and a planner PR lists the board files in
// its Paths explicitly. The comparison is by parsed row, not by text, so re-quoting a cell is not an
// edit. CI (check-story) and the cycle's merge bar both ask this module, so the two cannot disagree.
import { parseCsv, pathsOf } from './repo.mjs';

export const BOARD_FILES = ['docs/plan/jira-issues.csv', 'orchestration/deps.json'];

function rowsByKey(text) {
  return new Map(parseCsv(text ?? '').map(r => [r.Key, JSON.stringify(r)]));
}

function parseJson(text) {
  try { return JSON.parse(text ?? '{}'); } catch { return null; }
}

/** One comparable string per key: its phase and its dependency list. */
function depsByKey(d) {
  const out = new Map();
  for (const [phase, keys] of Object.entries(d?.phases ?? {})) {
    for (const k of keys ?? []) out.set(k, { phase, deps: null });
  }
  for (const [k, list] of Object.entries(d?.deps ?? {})) {
    out.set(k, { ...(out.get(k) ?? { phase: null }), deps: [...(list ?? [])].sort() });
  }
  return new Map([...out].map(([k, v]) => [k, JSON.stringify(v)]));
}

/** Everything in deps.json that is not a story's own entry (the note, research, and so on). */
function depsRest(d) {
  const { phases: _p, deps: _d, ...rest } = d ?? {};
  return JSON.stringify(rest);
}

function changedKeys(a, b) {
  const out = new Set();
  for (const k of new Set([...a.keys(), ...b.keys()])) if (a.get(k) !== b.get(k)) out.add(k);
  return out;
}

/**
 * What a branch changed on the board, measured against the base.
 * `{ touched, others, own, added, widened, before, after }`:
 * - `others`: keys other than `key` whose row or deps entry changed; non-empty means the branch
 *   edits somebody else's story. An edit to deps.json outside any story counts as `(deps.json)`.
 * - `widened`: paths the branch added to its own row.
 * - `after`: the branch's own row (parsed), or null.
 */
export function boardEdits(key, { baseCsv = '', headCsv = '', baseDeps = '{}', headDeps = '{}' } = {}) {
  const touched = changedKeys(rowsByKey(baseCsv), rowsByKey(headCsv));
  const bd = parseJson(baseDeps), hd = parseJson(headDeps);
  if (!bd || !hd) touched.add('(deps.json)');
  else {
    for (const k of changedKeys(depsByKey(bd), depsByKey(hd))) touched.add(k);
    if (depsRest(bd) !== depsRest(hd)) touched.add('(deps.json)');
  }
  const before = parseCsv(baseCsv ?? '').find(r => r.Key === key) ?? null;
  const after = parseCsv(headCsv ?? '').find(r => r.Key === key) ?? null;
  const had = new Set(pathsOf(before));
  return {
    touched: [...touched],
    others: [...touched].filter(k => k !== key),
    own: touched.has(key),
    added: !before && Boolean(after),
    widened: pathsOf(after).filter(p => !had.has(p)),
    before,
    after,
  };
}

/**
 * The row a branch is judged against, and whether its board edits are allowed.
 * If the branch touches only its own story, its own row (as the branch leaves it) governs: that is
 * how an out-of-plan PR brings its row and how a story widens its own Paths. Otherwise the base row
 * governs and the board files are outside the story unless its Paths list them.
 */
export function reviewBoundary(key, texts) {
  const edits = boardEdits(key, texts);
  const ownOnly = edits.others.length === 0;
  return {
    ...edits,
    ownOnly,
    story: ownOnly ? (edits.after ?? edits.before) : edits.before,
  };
}
