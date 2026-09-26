// The story state machine and the board it folds from the event log (ADR-0034).
//
// The board is not stored; it is `fold(events)`. Every change is an event appended by whoever
// decided it — the reconciler for machine decisions, `fleet.mjs` for a person's — and an event that
// names the status it expects (`from`) or the run it expects to still own the story (`ifRun`) is
// rejected by the fold when that no longer holds. That is the fencing: a worker that was timed out,
// a reviewer that returned a story a second too late, or a human command racing a cycle cannot move
// a story out of a state it has already left. Rejections are kept on the board so they can be read.
//
// Status names are the ones Jira and every reader already know. What changed is that each non-final
// status has an owner and a way out that fires without anyone noticing it: STATES below, and
// machine.test.mjs fails if a status is added without one.
import { existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { append, readEvents, repoHome, fleetPath, readJsonOr, CODE_ROOT } from './store.mjs';
import { applyJiraRenames } from './lib.mjs';

/**
 * Owner: the one actor that moves a story out. exit: what moves it out when that owner does nothing.
 * `attention: true` means a person owns it and the story is listed under "Needs you" until they act.
 */
export const STATES = {
  todo: {
    owner: 'reconciler',
    exit: 'readiness is recomputed every cycle from the plan and the board; the one reason it waits is printed',
  },
  in_progress: {
    owner: 'its run (a worker process) or its claim (a person or an in-app agent)',
    exit: 'a run ends at its deadline or after stallMinutes without output; a claim lapses at its expiry',
  },
  in_review: {
    owner: 'the review pipeline',
    exit: 'every sub-state has a run deadline, a try limit, or a hold age that raises attention',
  },
  blocked: { owner: 'a person', attention: true, exit: 'node orchestration/fleet.mjs unpark KEY' },
  escalate: { owner: 'the planner, then a person', attention: true, exit: 'the planner splits it, or fleet.mjs retry KEY' },
  done: { terminal: true },
};

/** Timings and limits. models.json may override any of them by the same name. */
export const TIMING = {
  attemptMinutes: 45,
  stallMinutes: 25,
  runGraceMinutes: 5,
  claimHours: 4,
  activeWorktreeMinutes: 30,
  holdAttentionMinutes: 30,
  redGraceMinutes: 20,
  maxAttempts: 2,
  escalationAttempts: 1,
  reviewTries: 3,
  resolveTries: 3,
  ghostLimit: 2,
  plannerCooldownMinutes: 240,
  reviewLanes: 4,
};

/** Top-level models.json settings the fleet reads; anything else is a typo that would be silently ignored. */
export const MODEL_KEYS = ['compute', 'modes', 'cliEffortFlag', 'lanes', 'mergeQueue', 'plannerEveryMerges', 'plannerEveryDays', ...Object.keys(TIMING)];

/** Settings in a models.json object that nothing reads (a misspelt timing, say). `_`-prefixed notes are fine. */
export const unknownModelKeys = raw => Object.keys(raw ?? {}).filter(k => !k.startsWith('_') && !MODEL_KEYS.includes(k));

export function timing(m = {}) {
  const t = { ...TIMING };
  for (const k of Object.keys(TIMING)) if (Number.isFinite(m[k]) && m[k] > 0) t[k] = m[k];
  return t;
}

export const emptyBoard = () => ({
  seq: 0, merges: 0, lastPlan: null, mergesAtLastPlan: 0, stories: {}, runs: {}, planner: {}, rejected: [],
});

const asList = v => (v == null ? null : Array.isArray(v) ? v : [v]);

function applyStory(b, e) {
  const rec = b.stories[e.key] ?? { status: 'todo', attempts: 0 };
  const from = asList(e.from);
  const refuse = why => {
    b.rejected.push({ at: e.at, key: e.key, by: e.by, why, event: e.why ?? e.to ?? '' });
    if (b.rejected.length > 50) b.rejected.shift();
  };
  if (from && !from.includes(rec.status)) return refuse(`expected ${from.join('|')}, was ${rec.status}`);
  if (e.ifRun !== undefined && (rec.run ?? null) !== e.ifRun) return refuse(`run ${e.ifRun ?? 'none'} no longer owns it (now ${rec.run ?? 'none'})`);
  for (const k of e.unset ?? []) delete rec[k];
  Object.assign(rec, structuredClone(e.set ?? {}));
  for (const [k, n] of Object.entries(e.inc ?? {})) rec[k] = Math.max(0, (rec[k] ?? 0) + n);
  if (e.to && e.to !== rec.status) {
    rec.status = e.to;
    rec.since = e.at;
  }
  rec.since ??= e.at;
  if (e.why) rec.why = e.why;
  b.stories[e.key] = rec;
}

/** The old planner lease's start, so the planner's cooldown carries across the switch. */
function legacyPlanner(home) {
  const lease = readJsonOr(join(home, 'orchestration', 'results', 'planner.lease'));
  return lease?.started ? { run: null, started: lease.started, lastEnded: lease.started, lastOutcome: 'imported' } : {};
}

/** Legacy state.json in_progress rows had leases or nothing; they become claims that lapse. */
function importBoard(b, e) {
  const s = e.board ?? {};
  b.planner = { ...(s.planner ?? {}) };
  b.merges = s.merges ?? 0;
  b.lastPlan = s.lastPlan ?? null;
  b.mergesAtLastPlan = s.mergesAtLastPlan ?? 0;
  b.stories = structuredClone(s.stories ?? {});
  const lapse = new Date(Date.parse(e.at) + 2 * 3_600_000).toISOString();
  for (const rec of Object.values(b.stories)) {
    rec.attempts ??= 0;
    rec.since ??= rec.started ?? rec.adopted ?? e.at;
    if (rec.status === 'in_progress') rec.claim = { by: 'imported from state.json', until: lapse };
    delete rec.lease;
  }
}

/** One event onto the board. Pure; mutates `b`. */
export function apply(b, e) {
  b.seq += 1;
  switch (e.type) {
    case 'imported': importBoard(b, e); break;
    case 'story': applyStory(b, e); break;
    case 'run': b.runs[e.run] = { ...(b.runs[e.run] ?? { id: e.run }), ...structuredClone(e.set ?? {}) }; break;
    case 'board': {
      for (const [k, v] of Object.entries(e.set ?? {})) {
        if (k === 'planner') b.planner = { ...b.planner, ...v };
        else b[k] = v;
      }
      for (const [k, n] of Object.entries(e.inc ?? {})) b[k] = (b[k] ?? 0) + n;
      break;
    }
    default: break; // notes and unknown types are history only
  }
  return b;
}

/** The board from a list of events, with Jira renames applied (a placeholder key becomes its real one). */
export function fold(events, { renames = {} } = {}) {
  const b = emptyBoard();
  for (const e of events) apply(b, e);
  const { stories } = applyJiraRenames(b.stories, renames);
  b.stories = stories;
  return b;
}

/** Copy the hand-off files a checkout's old orchestration/results/ held, once, without overwriting. */
function importLegacyResults(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (!/^MARXY-\d+\.(json|approved|notes\.md)$/.test(f)) continue;
    const to = fleetPath('results', f);
    if (existsSync(to)) continue;
    copyFileSync(join(dir, f), to);
    n++;
  }
  return n;
}

/**
 * The first read in a clone with no event log imports the old per-checkout state.json and results,
 * so switching to the store loses nothing. Later reads never look at those files again.
 */
export function importLegacy({ homes = legacyHomes() } = {}) {
  for (const home of homes) {
    const legacy = join(home, 'orchestration', 'state.json');
    if (!existsSync(legacy)) continue;
    const board = readJsonOr(legacy);
    if (!board?.stories) continue;
    const copied = importLegacyResults(join(home, 'orchestration', 'results'));
    append({ type: 'imported', from: legacy, results: copied, board: { ...board, planner: legacyPlanner(home) } });
    return legacy;
  }
  return null;
}

/** Where an old state.json may be. Under `node --test` only a test's own fixture home, never the real one. */
function legacyHomes() {
  const testing = Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.some(a => a === '--test' || a.startsWith('--test='));
  return testing ? [] : [repoHome(), CODE_ROOT];
}

let renamesCache = null;
function jiraRenames() {
  renamesCache ??= readJsonOr(join(CODE_ROOT, 'orchestration', 'jira-map.json'), {})?.keys ?? {};
  return renamesCache;
}

/**
 * The board now. Imports the legacy board on the first read in a clone with no log; with
 * `write: false` (a dry run) the import is folded in memory and nothing is appended.
 */
export function board({ renames = jiraRenames(), write = true } = {}) {
  let { events } = readEvents();
  if (!events.length && write && importLegacy()) ({ events } = readEvents());
  if (!events.length && !write) events = legacyEvents();
  return fold(events, { renames });
}

/** The import event a first read would append, without appending it. */
function legacyEvents({ homes = legacyHomes() } = {}) {
  for (const home of homes) {
    const b = readJsonOr(join(home, 'orchestration', 'state.json'));
    if (b?.stories) return [{ type: 'imported', at: new Date().toISOString(), by: 'dry-run', board: { ...b, planner: legacyPlanner(home) } }];
  }
  return [];
}

// ── Event builders. Everything that changes the board goes through one of these. ──

/** A story transition. `from` guards it; `ifRun` fences it to the run that still owns the story. */
export const story = (key, { to, from, why, set, unset, inc, ifRun, ...rest } = {}) => ({
  type: 'story', key,
  ...(to ? { to } : {}), ...(from ? { from } : {}), ...(why ? { why } : {}),
  ...(set ? { set } : {}), ...(unset ? { unset } : {}), ...(inc ? { inc } : {}),
  ...(ifRun !== undefined ? { ifRun } : {}), ...rest,
});

export const runEvent = (run, set) => ({ type: 'run', run, set });
export const boardEvent = (set, inc) => ({ type: 'board', ...(set ? { set } : {}), ...(inc ? { inc } : {}) });

/** Append events in order; returns them as written. */
export const commit = (events, opts) => events.filter(Boolean).map(e => append(e, opts));

/**
 * Send an In Review story back to be worked on: todo, or escalate once every attempt the implementor
 * and the escalation model get is spent. `returned.head` is the PR head it was returned at, so
 * adoption does not take the same PR straight back into review — only a new push does (MARXY-217 by
 * construction). `from` may be widened by a caller that returns from In Progress (a person's call).
 */
export function returnEvents(key, rec, { why, head = null, t, now = new Date().toISOString(), from = 'in_review', by } = {}) {
  const attempts = rec?.attempts ?? 0;
  const to = attempts >= t.maxAttempts + t.escalationAttempts ? 'escalate' : 'todo';
  return [story(key, {
    from, to, why: `returned: ${why}`,
    set: { returned: { at: now, head, why, ...(by ? { by } : {}) }, ...(to === 'escalate' ? { blockedAt: now } : {}) },
    unset: ['hold', 'run', 'claim'],
  })];
}

/** Whether a status is final. */
export const isTerminal = status => Boolean(STATES[status]?.terminal);

/** The stories whose paths are reserved: work under way, or a PR waiting to land. */
export function occupies(rec, { nowMs = Date.now() } = {}) {
  if (rec?.status === 'in_review') return true;
  if (rec?.status !== 'in_progress') return false;
  if (rec.run) return true;
  // A lapsed claim reserves nothing. In Progress with neither run nor claim is an orphan the next
  // cycle returns to todo; until then it is treated as occupied, since something may be writing.
  if (rec.claim) return Date.parse(rec.claim.until) > nowMs;
  return true;
}
