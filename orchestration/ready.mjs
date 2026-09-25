// Stories that can start now: earlier phases settled, deps done, paths disjoint, definition of
// ready. Reports blockedByDeps / blockedByPaths / blockedByLanes instead of a single mislabelled
// wait, and names the rule that excluded a story (MARXY-9).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  state, stories, deps, pathsOf, overlap, laneBudget, hasLabel, phaseOf, earlierPhaseOpen,
  models,
} from './lib.mjs';
import { liveClaims, readLiveEntries, defaultRowsOf } from './worktrees.mjs';

/** Named definition-of-ready refusals, so a test can assert the exact rule. */
export const RULE = {
  HUMAN_GATED: 'human-gated',
  DROPPED: 'dropped',
  NO_DISPATCH: 'no-dispatch',
  EMPTY_ACCEPTANCE: 'empty Acceptance',
  EMPTY_PATHS: 'empty Paths',
  LANE_LIMIT: 'lane limit',
  YIELDS_TO_PRODUCT: 'yields to product',
  WORKTREE_HOLDS: 'worktree holds',
};

function resolveClaims(opts, s) {
  if (opts.claims !== undefined) return opts.claims;
  // Fixture-board tests inject `all` or `s`; only the CLI's bare `selectReady()` reads git.
  if (opts.all !== undefined || opts.s !== undefined) return [];
  const isDone = k => s.stories[k]?.status === 'done';
  return liveClaims(readLiveEntries(), { rowsOf: defaultRowsOf(), isDone });
}

/** Concurrent In Review stories. null / 0 / omitted → uncapped. `lanes` is a different cap. */
export function reviewLaneBudget(m = models()) {
  const n = m.reviewLanes;
  if (n == null || n === 0) return Infinity;
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid reviewLanes ${n}`);
  return n;
}

/**
 * Classify every todo story and pick those that may start.
 * `cap` is the dispatch WIP limit from models.json; Infinity means uncapped.
 * `reviewCap` is the In Review WIP limit; dispatch is empty while that count is at or above it.
 */
export function selectReady(opts = {}) {
  const all = opts.all ?? stories();
  const s = opts.s ?? state();
  const d = opts.d ?? deps();
  const cap = opts.cap ?? laneBudget();
  const reviewCap = opts.reviewCap ?? reviewLaneBudget();
  const claimList = resolveClaims(opts, s);
  const done = k => s.stories[k]?.status === 'done';
  const statusOf = k => s.stories[k]?.status ?? 'todo';
  // in_review holds files until the PR lands; it does not consume a lane (MARXY-102).
  const occupies = status => status === 'in_progress' || status === 'in_review';
  const inProgress = all.filter(st => statusOf(st.Key) === 'in_progress');
  const inReview = all.filter(st => statusOf(st.Key) === 'in_review');
  const busy = all.filter(st => occupies(statusOf(st.Key)));
  const busyPathsFromState = busy.flatMap(pathsOf);
  const activeClaimPaths = claimList.filter(
    c => c.paths && !occupies(statusOf(c.key)),
  );
  const busyPaths = [...busyPathsFromState, ...activeClaimPaths.flatMap(c => c.paths)];
  const worktreeBlocker = stPaths => {
    for (const c of activeClaimPaths) {
      if (overlap(stPaths, c.paths)) return c.key;
    }
    return null;
  };
  const uncapped = !Number.isFinite(cap);
  const free = uncapped ? Infinity : Math.max(0, cap - inProgress.length);
  const reviewUncapped = !Number.isFinite(reviewCap);
  const reviewFull = !reviewUncapped && inReview.length >= reviewCap;

  const blockedByDeps = [];
  const blockedByPaths = [];
  const blockedByLanes = [];
  const excluded = [];
  const eligible = [];

  // The definition of ready that does not depend on the rest of the board. A dropped story is
  // settled, the same way plannerReasons treats the label (MARXY-120): checked before
  // empty-Acceptance/empty-Paths so a dropped row missing them is refused for being dropped, not
  // for looking like a badly written story.
  const refusal = st => {
    if (hasLabel(st, 'human-gated')) return RULE.HUMAN_GATED;
    if (hasLabel(st, 'dropped')) return RULE.DROPPED;
    // Work that arrives with its own PR (out-of-plan.mjs) is adopted and landed, never dispatched: a
    // row merged before the cycle adopted it must not send an implementor to redo it (MARXY-190).
    if (hasLabel(st, 'no-dispatch')) return RULE.NO_DISPATCH;
    if (!String(st.Acceptance ?? '').trim()) return RULE.EMPTY_ACCEPTANCE;
    if (pathsOf(st).length === 0) return RULE.EMPTY_PATHS;
    return null;
  };
  const inPhase = st => Number.isFinite(phaseOf(st.Key, d));
  const phaseOpen = st => hasLabel(st, 'cross-phase') || !earlierPhaseOpen(phaseOf(st.Key, d), d, s);

  // Product-over-ops (MARXY-107, MARXY-170). Sorting product first only decides between stories
  // that are eligible in the same cycle, and ops paths (orchestration/, scripts/) almost never
  // overlap product paths, so on its own the sort never fires: an ops story simply started first and
  // held the corpus or the shell while a product story waited its turn behind it. A product story
  // that is ready, or waits only on work already under way, therefore reserves its paths against
  // ops even while it is not startable itself. One waiting on a story that has not started reserves
  // nothing, so an ops story it depends on is never held by it.
  const underway = k => done(k) || occupies(statusOf(k));
  const reserved = all.filter(st => inPhase(st) && statusOf(st.Key) === 'todo' && !refusal(st) && phaseOpen(st)
    && (d.deps[st.Key] ?? []).every(underway));

  for (const st of all) {
    if (statusOf(st.Key) !== 'todo') continue;
    const rule = refusal(st);
    if (rule) {
      excluded.push({ key: st.Key, rule });
      continue;
    }
    if (!phaseOpen(st)) {
      blockedByDeps.push(st.Key);
      continue;
    }
    if (!(d.deps[st.Key] ?? []).every(done)) {
      blockedByDeps.push(st.Key);
      continue;
    }
    if (overlap(pathsOf(st), busyPaths)) {
      blockedByPaths.push(st.Key);
      const by = worktreeBlocker(pathsOf(st));
      if (by) excluded.push({ key: st.Key, rule: RULE.WORKTREE_HOLDS, by });
      continue;
    }
    if (!inPhase(st)) {
      const to = reserved.filter(p => overlap(pathsOf(st), pathsOf(p))).map(p => p.Key);
      if (to.length) {
        blockedByPaths.push(st.Key);
        excluded.push({ key: st.Key, rule: RULE.YIELDS_TO_PRODUCT, to });
        continue;
      }
    }
    eligible.push(st);
  }

  // Product phases still pick first among what remains, so a lane cap cannot starve the page either.
  // The sort is stable.
  eligible.sort((a, b) => Number(inPhase(b)) - Number(inPhase(a)));
  const picked = [];
  const pickedPaths = [];
  if (!reviewFull) {
    for (const st of eligible) {
      if (overlap(pathsOf(st), pickedPaths)) {
        blockedByPaths.push(st.Key);
        continue;
      }
      if (picked.length >= free) {
        blockedByLanes.push(st.Key);
        excluded.push({ key: st.Key, rule: RULE.LANE_LIMIT });
        continue;
      }
      picked.push(st);
      pickedPaths.push(...pathsOf(st));
    }
  }

  return {
    lanes: uncapped ? 'uncapped' : cap,
    lanesFree: uncapped ? null : free,
    inProgress: inProgress.map(b => b.Key),
    ready: picked.map(p => ({ key: p.Key, summary: p.Summary, paths: p.Paths })),
    blockedByDeps,
    blockedByPaths,
    blockedByLanes,
    blockedByReviewWip: reviewUncapped ? null : { count: inReview.length, cap: reviewCap },
    excluded,
    claims: claimList.map(c => ({
      key: c.key,
      path: c.path,
      ahead: c.ahead ?? 0,
      dirty: Boolean(c.dirty),
      ...(c.reason ? { reason: c.reason } : {}),
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(selectReady(), null, 2));
}
