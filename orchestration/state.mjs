// Board operations: node state.mjs <init|show|start|done|return|escalate|block> [KEY]
// Jira is the board of record, so every transition here is mirrored there; a Jira failure
// is reported, never fatal, because the local board must stay usable offline.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { state, saveState, stories, here } from './lib.mjs';
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
 */
export function transition(cmd, s, st, { argv = process.argv, now = () => new Date().toISOString() } = {}) {
  switch (cmd) {
    case 'start': st.status = 'in_progress'; st.attempts += 1; st.started = now(); delete st.parkedReason; break;
    case 'review': st.status = 'in_review'; if (argv[4]) st.pr = Number(argv[4]); break;
    case 'done': st.status = 'done'; st.finished = now(); s.merges += 1; delete st.parkedReason; break;
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
  const s = state();
  const known = new Set(stories().map(x => x.Key));
  if (key && !known.has(key)) { console.error(`unknown story ${key}`); process.exit(2); }
  const st = key ? (s.stories[key] ??= { status: 'todo', attempts: 0 }) : null;
  if (cmd === 'init' || cmd === 'show') {
    const { byStatus, orphans } = boardTotals(s.stories);
    console.log(JSON.stringify({ merges: s.merges, lastPlan: s.lastPlan, ...byStatus, ...(orphans.length ? { orphans } : {}) }, null, 2));
  } else if (cmd === 'planned') {
    s.lastPlan = new Date().toISOString();
    s.mergesAtLastPlan = s.merges;
  } else if (!transition(cmd, s, st)) {
    console.error('usage: state.mjs <show|start|review KEY PR|done|return|escalate|block KEY [reason]|planned> [KEY]');
    process.exit(2);
  }
  saveState(s);
  if (key) {
    console.log(key, '→', st.status, `(attempts ${st.attempts})`);
    const jira = spawnSync(process.execPath, [here('jira.mjs'), 'move', key, st.status], { encoding: 'utf8' });
    const out = (jira.stdout ?? '') + (jira.stderr ?? '');
    if (jira.status === 0) console.log(out.trim());
    else console.error(`jira: not mirrored (exit ${jira.status}). Run: node orchestration/jira.mjs move ${key} ${st.status}\n${out.trim()}`);
  }
}
