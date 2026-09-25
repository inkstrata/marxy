// Board operations: node state.mjs <init|show|start|done|plan-landed|return|escalate|block> [KEY]
// Jira is the board of record, so every transition here is mirrored there; a Jira failure
// is reported, never fatal, because the local board must stay usable offline.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { state, updateState, stories, here } from './lib.mjs';
import { boardTotals } from './board-check.mjs';

/**
 * Apply one board verb to a story's entry (and, for `done`, the merges counter). `now` is
 * injected so a test can assert an exact stamp. Returns `false` for an unknown verb instead
 * of exiting, so the caller decides what "unknown" means.
 *
 * `block KEY [reason…]` records why as `parkedReason`; `start`, `done` and `return` clear it, since a
 * story that moves again is no longer parked (MARXY-173).
 *
 * `block` and `escalate` stamp `blockedAt`, and `return` stamps it when it lands on
 * `escalate`, so a ruling the planner has already read does not make it due again
 * (MARXY-120). Not backfilled: a story blocked before this landed has no stamp.
 *
 * `plan-landed` is `done` plus the planner's own bookkeeping, for a merge whose diff added a
 * `docs/plan/deltas/` file: it stamps `lastPlan`/`mergesAtLastPlan` itself, the way a person
 * used to have to after every plan PR, and tags the story `planLanded` so plannerReasons excludes
 * it from the ops-window count — a run of plan/board-sync landings must not pad the ops-majority
 * signal it is itself the answer to (MARXY-200).
 */
export function transition(cmd, s, st, { argv = process.argv, now = () => new Date().toISOString() } = {}) {
  switch (cmd) {
    case 'start': st.status = 'in_progress'; st.attempts += 1; st.started = now(); delete st.parkedReason; break;
    case 'review': st.status = 'in_review'; if (argv[4]) st.pr = Number(argv[4]); break;
    case 'done': st.status = 'done'; st.finished = now(); s.merges += 1; delete st.parkedReason; break;
    case 'plan-landed': {
      const stamp = now();
      st.status = 'done'; st.finished = stamp; s.merges += 1; delete st.parkedReason; st.planLanded = true;
      s.lastPlan = stamp; s.mergesAtLastPlan = s.merges;
      break;
    }
    case 'return':
      delete st.parkedReason;
      st.status = st.attempts >= 2 ? 'escalate' : 'todo';
      if (st.status === 'escalate') st.blockedAt = now();
      break;
    case 'escalate': st.status = 'escalate'; st.blockedAt = now(); break;
    case 'block': {
      st.status = 'blocked'; st.blockedAt = now();
      const reason = argv.slice(4).join(' ').trim();
      if (reason) st.parkedReason = reason;
      break;
    }
    default: return false;
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [cmd, key] = process.argv.slice(2);
  if (cmd === 'init' || cmd === 'show') {
    // state() seeds a missing board; neither verb changes one.
    const s = state();
    const { byStatus, orphans } = boardTotals(s.stories);
    console.log(JSON.stringify({ merges: s.merges, lastPlan: s.lastPlan, ...byStatus, ...(orphans.length ? { orphans } : {}) }, null, 2));
    process.exit(0);
  }
  // Checked, changed and saved under the board lock, so a worker or reap writing at the same moment
  // is not overwritten (MARXY-210). Nothing inside exits: an exit would leave the lock behind.
  const outcome = updateState(s => {
    // A key the board already tracks is known even before its row is on this checkout's main: the
    // cycle adopts an out-of-plan PR whose row is only on its branch, and records it done in the same
    // cycle that merges it, before the next fast-forward brings the row (MARXY-190).
    const known = new Set([...stories().map(x => x.Key), ...Object.keys(s.stories ?? {})]);
    if (key && !known.has(key)) return { unknown: true };
    const had = key && Object.hasOwn(s.stories, key);
    const st = key ? (s.stories[key] ??= { status: 'todo', attempts: 0 }) : null;
    if (cmd === 'planned') {
      s.lastPlan = new Date().toISOString();
      s.mergesAtLastPlan = s.merges;
    } else if (!transition(cmd, s, st)) {
      if (key && !had) delete s.stories[key];
      return { usage: true };
    }
    return { st };
  });
  if (outcome.unknown) { console.error(`unknown story ${key}: no CSV row and not on the board; out-of-plan work gets a row with node orchestration/out-of-plan.mjs`); process.exit(2); }
  if (outcome.usage) {
    console.error('usage: state.mjs <show|start|review KEY PR|done|plan-landed KEY|return|escalate|block KEY [reason]|planned> [KEY]');
    process.exit(2);
  }
  const { st } = outcome;
  if (key) {
    console.log(key, '→', st.status, `(attempts ${st.attempts})`);
    const jira = spawnSync(process.execPath, [here('jira.mjs'), 'move', key, st.status], { encoding: 'utf8' });
    const out = (jira.stdout ?? '') + (jira.stderr ?? '');
    if (jira.status === 0) console.log(out.trim());
    else console.error(`jira: not mirrored (exit ${jira.status}). Run: node orchestration/jira.mjs move ${key} ${st.status}\n${out.trim()}`);
  }
}
