// Stories that can start now: earlier phases settled, deps done, paths disjoint, definition of
// ready. Reports blockedByDeps / blockedByPaths / blockedByLanes instead of a single mislabelled
// wait, and names the rule that excluded a story (MARXY-9).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  state, stories, deps, pathsOf, overlap, laneBudget, hasLabel, phaseOf, earlierPhaseOpen,
  models,
} from './lib.mjs';

/** Named definition-of-ready refusals, so a test can assert the exact rule. */
export const RULE = {
  HUMAN_GATED: 'human-gated',
  EMPTY_ACCEPTANCE: 'empty Acceptance',
  EMPTY_PATHS: 'empty Paths',
  LANE_LIMIT: 'lane limit',
};

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
export function selectReady({
  all = stories(),
  s = state(),
  d = deps(),
  cap = laneBudget(),
  reviewCap = reviewLaneBudget(),
} = {}) {
  const done = k => s.stories[k]?.status === 'done';
  const statusOf = k => s.stories[k]?.status ?? 'todo';
  // in_review holds files until the PR lands; it does not consume a lane (MARXY-102).
  const occupies = status => status === 'in_progress' || status === 'in_review';
  const inProgress = all.filter(st => statusOf(st.Key) === 'in_progress');
  const inReview = all.filter(st => statusOf(st.Key) === 'in_review');
  const busy = all.filter(st => occupies(statusOf(st.Key)));
  const busyPaths = busy.flatMap(pathsOf);
  const uncapped = !Number.isFinite(cap);
  const free = uncapped ? Infinity : Math.max(0, cap - inProgress.length);
  const reviewUncapped = !Number.isFinite(reviewCap);
  const reviewFull = !reviewUncapped && inReview.length >= reviewCap;

  const blockedByDeps = [];
  const blockedByPaths = [];
  const blockedByLanes = [];
  const excluded = [];
  const eligible = [];

  for (const st of all) {
    if (statusOf(st.Key) !== 'todo') continue;
    if (hasLabel(st, 'human-gated')) {
      excluded.push({ key: st.Key, rule: RULE.HUMAN_GATED });
      continue;
    }
    if (!String(st.Acceptance ?? '').trim()) {
      excluded.push({ key: st.Key, rule: RULE.EMPTY_ACCEPTANCE });
      continue;
    }
    if (pathsOf(st).length === 0) {
      excluded.push({ key: st.Key, rule: RULE.EMPTY_PATHS });
      continue;
    }
    const phase = phaseOf(st.Key, d);
    if (!hasLabel(st, 'cross-phase') && earlierPhaseOpen(phase, d, s)) {
      blockedByDeps.push(st.Key);
      continue;
    }
    if (!(d.deps[st.Key] ?? []).every(done)) {
      blockedByDeps.push(st.Key);
      continue;
    }
    if (overlap(pathsOf(st), busyPaths)) {
      blockedByPaths.push(st.Key);
      continue;
    }
    eligible.push(st);
  }

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
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(selectReady(), null, 2));
}
