// Board verbs from before the fleet store (ADR-0034), kept so old prompts and habits still work.
// Each verb is one guarded event, exactly what fleet.mjs appends; prefer fleet.mjs.
// usage: node orchestration/state.mjs <show|start|review|done|plan-landed|return|escalate|block|planned> [KEY] [PR|reason…]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { models } from './lib.mjs';
import { board, commit, story, boardEvent, timing, returnEvents, STATES } from './machine.mjs';

/** The events one verb appends. Pure, so a test can check the mapping without a store. */
export function verbEvents(cmd, key, rest, b, { now = new Date().toISOString(), t = timing(), by = 'state.mjs' } = {}) {
  const rec = b.stories[key] ?? { status: 'todo', attempts: 0 };
  switch (cmd) {
    case 'start': return [story(key, { from: 'todo', to: 'in_progress', set: { claim: { by, until: new Date(Date.parse(now) + t.claimHours * 3_600_000).toISOString() } }, why: 'claimed with state.mjs start' })];
    case 'review': return [story(key, { from: ['todo', 'in_progress'], to: 'in_review', set: { pr: Number(rest[0]) }, unset: ['claim', 'run'], why: `PR #${rest[0]} recorded by hand` })];
    case 'done': return [story(key, { to: 'done', set: { finished: now }, unset: ['run', 'claim', 'hold'], why: 'recorded done by hand' }), boardEvent(null, { merges: 1 })];
    case 'plan-landed': return [story(key, { to: 'done', set: { finished: now, planLanded: true }, why: 'plan delta landed' }), boardEvent({ lastPlan: now, mergesAtLastPlan: (b.merges ?? 0) + 1 }, { merges: 1 })];
    case 'return': return returnEvents(key, rec, { why: rest.join(' ') || 'returned with state.mjs', t, now, from: ['in_review', 'in_progress'], by });
    case 'escalate': return [story(key, { to: 'escalate', set: { blockedAt: now }, unset: ['run', 'claim'], why: 'escalated by hand' })];
    case 'block': return [story(key, { to: 'blocked', set: { blockedAt: now, ...(rest.length ? { parkedReason: rest.join(' ') } : {}) }, unset: ['run', 'claim'], why: 'blocked by hand' })];
    case 'planned': return [boardEvent({ lastPlan: now, mergesAtLastPlan: b.merges ?? 0 })];
    default: return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [cmd, key, ...rest] = process.argv.slice(2);
  const b = board();
  if (!cmd || cmd === 'show' || cmd === 'init') {
    const counts = Object.fromEntries(Object.keys(STATES).map(s => [s, Object.values(b.stories).filter(r => r.status === s).length]));
    console.log(JSON.stringify({ merges: b.merges, lastPlan: b.lastPlan, ...counts }, null, 2));
    process.exit(0);
  }
  const events = verbEvents(cmd, key, rest, b, { t: timing(models()) });
  if (!events || (cmd !== 'planned' && !/^MARXY-\d+$/.test(key ?? ''))) {
    console.error('usage: state.mjs <show|start|review KEY PR|done|plan-landed|return|escalate|block KEY [reason]|planned> [KEY]');
    process.exit(2);
  }
  const before = b.rejected.length;
  commit(events);
  const after = board();
  const refused = after.rejected.slice(before);
  if (refused.length) { console.error(`✗ ${key}: refused — ${refused.map(r => r.why).join('; ')}`); process.exit(1); }
  if (key) console.log(key, '→', after.stories[key]?.status, `(attempts ${after.stories[key]?.attempts ?? 0}); Jira follows on the next cycle`);
}
