// Stories that can start now: earlier phases settled, deps done, paths disjoint, definition of
// ready. Pure over the plan and the board; every todo story that cannot start carries the one reason
// it waits (`waits`), so "nothing is ready" is always explained (MARXY-9).
//
// What reserves paths (ADR-0034): a story In Progress under a live run or an unexpired claim, a story
// In Review (its PR is waiting to land), and `claims` — worktrees someone is working in right now
// (activity within activeWorktreeMinutes) and claims that carry their own paths. A worktree that is
// merely dirty reserves nothing: that inference had no expiry, and on 2026-09-26 it held every todo
// story with nobody working. Review load never gates dispatch; reviewLanes caps concurrent reviewers
// instead (ADR-0034, amending ADR-0025 §1).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pathsOf, overlap, laneBudget, hasLabel, models } from './lib.mjs';
import { occupies } from './machine.mjs';

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

const phaseOfIn = (d, key) => {
  for (const [phase, keys] of Object.entries(d.phases ?? {})) if ((keys ?? []).includes(key)) return Number(phase);
  return null;
};

/** True when any story in a lower numbered phase is still todo or in_progress. */
function earlierPhaseOpen(phase, d, statusOf) {
  if (phase == null || !Number.isFinite(phase)) return false;
  for (const [p, keys] of Object.entries(d.phases ?? {})) {
    // A non-numeric phase (`ops`) is a lane beside the numbered phases, not an earlier one.
    if (!Number.isFinite(Number(p)) || Number(p) >= phase) continue;
    if ((keys ?? []).some(k => ['todo', 'in_progress'].includes(statusOf(k)))) return true;
  }
  return false;
}

/**
 * Classify every todo story and pick those that may start.
 * `all` rows, `s` the board, `d` deps/phases, `cap` the dispatch WIP limit (Infinity = uncapped),
 * `claims` path holds that are not board statuses: `{ key, paths, path?, why? }`.
 */
export function selectReady({ all, s, d, cap = Infinity, claims = [], nowMs = Date.now(), extraAllowed } = {}) {
  const rec = k => s.stories?.[k];
  const statusOf = k => rec(k)?.status ?? 'todo';
  const done = k => statusOf(k) === 'done';
  const busyRec = k => occupies(rec(k) ?? { status: 'todo' }, { nowMs });
  const ov = (a, b) => overlap(a, b, extraAllowed);
  const inProgress = all.filter(st => statusOf(st.Key) === 'in_progress');
  const busy = all.filter(st => busyRec(st.Key));
  const heldBy = claims.filter(c => c.paths?.length && !busyRec(c.key));
  const busyPaths = [...busy.flatMap(pathsOf), ...heldBy.flatMap(c => c.paths)];
  const claimBlocker = stPaths => heldBy.find(c => ov(stPaths, c.paths))?.key ?? null;
  const uncapped = !Number.isFinite(cap);
  const free = uncapped ? Infinity : Math.max(0, cap - inProgress.length);

  const blockedByDeps = [];
  const blockedByPaths = [];
  const blockedByLanes = [];
  const excluded = [];
  const eligible = [];
  const waits = {};

  const refusal = st => {
    if (hasLabel(st, 'human-gated')) return RULE.HUMAN_GATED;
    if (hasLabel(st, 'dropped')) return RULE.DROPPED;
    // Work that arrives with its own PR is adopted and landed, never dispatched (MARXY-190).
    if (hasLabel(st, 'no-dispatch')) return RULE.NO_DISPATCH;
    if (!String(st.Acceptance ?? '').trim()) return RULE.EMPTY_ACCEPTANCE;
    if (pathsOf(st).length === 0) return RULE.EMPTY_PATHS;
    return null;
  };
  const inPhase = st => Number.isFinite(phaseOfIn(d, st.Key));
  const phaseOpen = st => hasLabel(st, 'cross-phase') || !earlierPhaseOpen(phaseOfIn(d, st.Key), d, statusOf);
  const depsOf = key => d.deps?.[key] ?? [];

  // Product-over-ops (MARXY-107, MARXY-170): a product story that is ready, or waits only on work
  // already under way, reserves its paths against ops work; one waiting on a story that has not
  // started reserves nothing, so an ops story it depends on is never held by it.
  const underway = k => done(k) || busyRec(k);
  const reserved = all.filter(st => inPhase(st) && statusOf(st.Key) === 'todo' && !refusal(st) && phaseOpen(st)
    && depsOf(st.Key).every(underway));

  for (const st of all) {
    if (statusOf(st.Key) !== 'todo') continue;
    const rule = refusal(st);
    if (rule) {
      excluded.push({ key: st.Key, rule });
      waits[st.Key] = rule;
      continue;
    }
    if (!phaseOpen(st)) {
      blockedByDeps.push(st.Key);
      waits[st.Key] = `phase ${phaseOfIn(d, st.Key)} waits on an earlier phase`;
      continue;
    }
    const pending = depsOf(st.Key).filter(k => !done(k));
    if (pending.length) {
      blockedByDeps.push(st.Key);
      waits[st.Key] = `waits on ${pending.join(', ')}`;
      continue;
    }
    if (ov(pathsOf(st), busyPaths)) {
      blockedByPaths.push(st.Key);
      const by = claimBlocker(pathsOf(st));
      if (by) excluded.push({ key: st.Key, rule: RULE.WORKTREE_HOLDS, by });
      const holder = by ?? busy.find(b => ov(pathsOf(st), pathsOf(b)))?.Key;
      waits[st.Key] = `paths held by ${holder ?? 'work in flight'}`;
      continue;
    }
    if (!inPhase(st)) {
      const to = reserved.filter(p => ov(pathsOf(st), pathsOf(p))).map(p => p.Key);
      if (to.length) {
        blockedByPaths.push(st.Key);
        excluded.push({ key: st.Key, rule: RULE.YIELDS_TO_PRODUCT, to });
        waits[st.Key] = `yields to product ${to.join(', ')}`;
        continue;
      }
    }
    eligible.push(st);
  }

  // Product phases pick first among what remains, so a lane cap cannot starve the page. Stable sort.
  eligible.sort((a, b) => Number(inPhase(b)) - Number(inPhase(a)));
  const picked = [];
  const pickedPaths = [];
  for (const st of eligible) {
    if (ov(pathsOf(st), pickedPaths)) {
      blockedByPaths.push(st.Key);
      waits[st.Key] = `paths overlap ${picked.find(p => ov(pathsOf(st), pathsOf(p)))?.Key}, starting this cycle`;
      continue;
    }
    if (picked.length >= free) {
      blockedByLanes.push(st.Key);
      excluded.push({ key: st.Key, rule: RULE.LANE_LIMIT });
      waits[st.Key] = RULE.LANE_LIMIT;
      continue;
    }
    picked.push(st);
    pickedPaths.push(...pathsOf(st));
  }

  return {
    lanes: uncapped ? 'uncapped' : cap,
    lanesFree: uncapped ? null : free,
    inProgress: inProgress.map(b => b.Key),
    ready: picked.map(p => ({ key: p.Key, summary: p.Summary, paths: p.Paths })),
    blockedByDeps,
    blockedByPaths,
    blockedByLanes,
    excluded,
    waits,
    claims: claims.map(c => ({ key: c.key, ...(c.path ? { path: c.path } : {}), ...(c.why ? { why: c.why } : {}) })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { planAt } = await import('./plan.mjs');
  const { board, timing } = await import('./machine.mjs');
  const { pathHolds, observeWorktrees } = await import('./observe.mjs');
  const plan = planAt();
  const b = board();
  const m = models();
  const claims = pathHolds({ board: b, plan, worktrees: observeWorktrees(), t: timing(m) });
  console.log(JSON.stringify(selectReady({
    all: plan.rows, s: b, d: plan.deps, cap: laneBudget(m), claims, extraAllowed: plan.extraAllowed,
  }), null, 2));
}
