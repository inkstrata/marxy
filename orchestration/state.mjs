// Board operations: node state.mjs <init|show|start|done|return|escalate|block> [KEY]
// Jira is the board of record, so every transition here is mirrored there; a Jira failure
// is reported, never fatal, because the local board must stay usable offline.
import { spawnSync } from 'node:child_process';
import { state, saveState, stories, here } from './lib.mjs';
const [cmd, key] = process.argv.slice(2);
const s = state();
const known = new Set(stories().map(x => x.Key));
if (key && !known.has(key)) { console.error(`unknown story ${key}`); process.exit(2); }
const st = key ? (s.stories[key] ??= { status: 'todo', attempts: 0 }) : null;
switch (cmd) {
  case 'init': case 'show': { const by = {}; for (const [k, v] of Object.entries(s.stories)) (by[v.status] ??= []).push(k); console.log(JSON.stringify({ merges: s.merges, lastPlan: s.lastPlan, ...by }, null, 2)); break; }
  case 'start': st.status = 'in_progress'; st.attempts += 1; st.started = new Date().toISOString(); break;
  case 'review': st.status = 'in_review'; if (process.argv[4]) st.pr = Number(process.argv[4]); break;
  case 'done': st.status = 'done'; st.finished = new Date().toISOString(); s.merges += 1; break;
  case 'return': st.status = st.attempts >= 2 ? 'escalate' : 'todo'; break;
  case 'escalate': st.status = 'escalate'; break;
  case 'block': st.status = 'blocked'; break;
  case 'planned': s.lastPlan = new Date().toISOString(); s.mergesAtLastPlan = s.merges; break;
  default: console.error('usage: state.mjs <show|start|review KEY PR|done|return|escalate|block|planned> [KEY]'); process.exit(2);
}
saveState(s);
if (key) {
  console.log(key, '→', st.status, `(attempts ${st.attempts})`);
  const jira = spawnSync(process.execPath, [here('jira.mjs'), 'move', key, st.status], { encoding: 'utf8' });
  const out = (jira.stdout ?? '') + (jira.stderr ?? '');
  if (jira.status === 0) console.log(out.trim());
  else console.error(`jira: not mirrored (exit ${jira.status}). Run: node orchestration/jira.mjs move ${key} ${st.status}\n${out.trim()}`);
}
