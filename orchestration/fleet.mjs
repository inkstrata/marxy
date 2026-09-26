// The fleet's command line, for people and for agents (ADR-0034). Every command that changes a
// story appends one guarded event; if the story is no longer where the command expects, the fold
// refuses it and the refusal is printed and shown under "Needs you". Nothing here edits a tracked file.
//
//   node orchestration/fleet.mjs status                     the last status.md
//   node orchestration/fleet.mjs why KEY                    the story, its wait, its runs, its last events
//   node orchestration/fleet.mjs events [KEY] [-n 30]       the event log
//   node orchestration/fleet.mjs claim KEY [--hours 4] [--note "…"] [--paths "a, b"]
//                                                           reserve a story for work outside the fleet
//   node orchestration/fleet.mjs release KEY                give a claim back
//   node orchestration/fleet.mjs verdict KEY merge|return|escalate --notes FILE [--head SHA]
//                                                           a reviewer's decision; merge writes and signs
//   node orchestration/fleet.mjs return KEY --why "…"       send a story back (a person's call)
//   node orchestration/fleet.mjs park KEY "reason"          block a story until someone unparks it
//   node orchestration/fleet.mjs unpark KEY                 blocked → todo
//   node orchestration/fleet.mjs retry KEY [--fresh]        escalate → todo (one more escalation attempt,
//                                                           or --fresh: attempts start again)
//   node orchestration/fleet.mjs report KEY blocked|failed "why"
//                                                           an implementor's result when it cannot finish
//   node orchestration/fleet.mjs path result|approved|notes KEY
//   node orchestration/fleet.mjs doctor                     the fleet's health, one line per problem
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { userInfo } from 'node:os';
import { models, readJson, here } from './lib.mjs';
import { board, commit, story, timing, returnEvents, unknownModelKeys } from './machine.mjs';
import { planAt } from './plan.mjs';
import {
  approvalPath, notesPath, resultPath, fleetPath, readEvents, readJsonOr, writeJsonAtomic, writeTextAtomic,
  loopLeasePath, cycleLockPath, eventsPath, fleetDir,
} from './store.mjs';
import { signApproval, approvalHoldReason } from './approve.mjs';
import { gh, read, stillRunning, LIMIT } from './proc.mjs';
import { readLease, leaseHeld } from './lease.mjs';

const who = () => process.env.MARXY_ACTOR ?? `${userInfo().username} via fleet.mjs`;

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fresh' || a === '--json' || a === '--force') out[a.slice(2)] = true;
    else if (a === '-n') out.n = Number(argv[++i]);
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

/** Append and report whether the fold accepted it. */
function apply(events, key) {
  const before = board().rejected.length;
  commit(events);
  const b = board();
  const refused = b.rejected.slice(before).filter(r => r.key === key);
  if (refused.length) {
    console.error(`✗ ${key}: refused — ${refused.map(r => r.why).join('; ')}`);
    process.exitCode = 1;
    return null;
  }
  return b.stories[key];
}

const need = (cond, msg) => { if (!cond) { console.error(msg); process.exit(2); } };
const isKey = k => /^MARXY-\d+$/.test(k ?? '');

/**
 * Whether a key names real work: on the board, or a row on origin/main. A typo must not create a
 * phantom claim that reserves nothing and lapses unnoticed. `--force`, or a claim that names its own
 * `--paths` (out-of-plan work whose row is only on its branch), skips the check.
 */
function known(key, o = {}) {
  if (o.force || o.paths) return true;
  if (board().stories[key]) return true;
  try { return planAt().byKey.has(key); } catch { return true; }
}
const needKnown = (key, o) => need(known(key, o), `✗ ${key} is not on the board and has no row on origin/main; check the key, or pass --force`);

/** The open PR for a key, or null. */
function openPrFor(key) {
  const out = read('gh', ['pr', 'list', '--state', 'open', '--search', key, '--json', 'number,headRefOid,headRefName,mergeStateStatus,title'], { timeoutMs: LIMIT.gh });
  const prs = JSON.parse(out ?? '[]').filter(p => p.title.includes(key) || p.headRefName.includes(key));
  return prs.length === 1 ? prs[0] : null;
}

const commands = {
  status() {
    const p = fleetPath('status.md');
    console.log(existsSync(p) ? readFileSync(p, 'utf8') : 'no status yet: run node orchestration/cycle.mjs');
  },

  why(o) {
    const key = o._[0];
    need(isKey(key), 'usage: fleet.mjs why KEY');
    const b = board();
    const rec = b.stories[key];
    console.log(rec ? JSON.stringify(rec, null, 2) : `${key}: not on the board (todo by default if it has a row on main)`);
    const runs = Object.values(b.runs).filter(r => r.key === key).slice(-5);
    for (const r of runs) console.log(`run ${r.id}: ${r.role} ${r.model ?? ''} started ${r.started}${r.ended ? `, ended ${r.ended} (${r.outcome})` : `, until ${r.deadline}`}`);
    const { events } = readEvents();
    for (const e of events.filter(e => e.key === key).slice(-(o.n || 12))) {
      console.log(`${e.at} ${e.by} ${e.type}${e.to ? ` → ${e.to}` : ''}${e.why ? ` — ${e.why}` : ''}`);
    }
    for (const r of b.rejected.filter(r => r.key === key).slice(-3)) console.log(`refused ${r.at}: ${r.why} (${r.event})`);
  },

  events(o) {
    const { events, skipped } = readEvents();
    const key = o._[0];
    const list = key ? events.filter(e => e.key === key || e.run?.startsWith(key)) : events;
    for (const e of list.slice(-(o.n || 30))) console.log(JSON.stringify(e));
    if (skipped) console.error(`(${skipped} unreadable line(s) skipped in ${eventsPath()})`);
  },

  claim(o) {
    const key = o._[0];
    need(isKey(key), 'usage: fleet.mjs claim KEY [--hours 4] [--note "…"] [--paths "a, b"]');
    needKnown(key, o);
    const t = timing(models());
    const hours = Number(o.hours) > 0 ? Number(o.hours) : t.claimHours;
    const claim = {
      by: who(), until: new Date(Date.now() + hours * 3_600_000).toISOString(),
      ...(o.note ? { note: o.note } : {}),
      ...(o.paths ? { paths: o.paths.split(',').map(s => s.trim()).filter(Boolean) } : {}),
    };
    const rec = board().stories[key];
    const renew = rec?.status === 'in_progress' && rec.claim && !rec.run;
    const got = apply([story(key, renew
      ? { from: 'in_progress', ifRun: null, set: { claim }, why: `claim renewed until ${claim.until}` }
      : { from: 'todo', to: 'in_progress', set: { claim }, why: `claimed by ${claim.by}` })], key);
    if (got) console.log(`${key}: ${renew ? 'claim renewed' : 'claimed'} until ${claim.until}; its paths are reserved until then`);
  },

  release(o) {
    const key = o._[0];
    need(isKey(key), 'usage: fleet.mjs release KEY');
    if (apply([story(key, { from: 'in_progress', ifRun: null, to: 'todo', unset: ['claim'], why: `released by ${who()}` })], key)) console.log(`${key}: released`);
  },

  verdict(o) {
    const [key, verdict] = o._;
    need(isKey(key) && ['merge', 'return', 'escalate'].includes(verdict), 'usage: fleet.mjs verdict KEY merge|return|escalate --notes FILE [--head SHA]');
    need(o.notes && existsSync(o.notes), `--notes FILE is required and must exist (the numbered review notes)`);
    const notes = readFileSync(o.notes, 'utf8').trim();
    const b = board();
    const rec = b.stories[key];
    need(rec?.status === 'in_review', `✗ ${key} is ${rec?.status ?? 'not on the board'}, not in review`);
    const pr = o.head ? { headRefOid: o.head, mergeStateStatus: '' } : openPrFor(key);
    need(pr?.headRefOid, `✗ could not find ${key}'s open PR; pass --head SHA`);
    if (verdict === 'merge') {
      const hold = approvalHoldReason({ mergeStateStatus: pr.mergeStateStatus });
      need(!hold, `✗ ${key}: not signing — ${hold}`);
      writeTextAtomic(approvalPath(key), `${notes}\n`);
      signApproval(key, pr.headRefOid);
      console.log(`${key}: approved and signed for ${pr.headRefOid.slice(0, 7)}; the cycle lands it once the rest of the merge bar holds`);
      return;
    }
    const prior = existsSync(notesPath(key)) ? readFileSync(notesPath(key), 'utf8').trimEnd() + '\n\n' : '';
    writeTextAtomic(notesPath(key), `${prior}## Review ${new Date().toISOString()} (${verdict})\n\n${notes}\n`);
    const t = timing(models());
    const events = verdict === 'return'
      ? returnEvents(key, rec, { why: `reviewer: ${notes.split('\n')[0].slice(0, 160)}`, head: pr.headRefOid, t, by: who() })
      : [story(key, { from: 'in_review', to: 'escalate', set: { blockedAt: new Date().toISOString(), returned: { at: new Date().toISOString(), head: pr.headRefOid, why: 'escalated by review' } }, unset: ['hold', 'run'], why: 'reviewer escalated' })];
    const got = apply(events, key);
    if (got) console.log(`${key}: ${verdict} recorded → ${got.status}; notes in ${notesPath(key)}`);
  },

  return(o) {
    const key = o._[0];
    need(isKey(key) && o.why, 'usage: fleet.mjs return KEY --why "what would satisfy you"');
    const rec = board().stories[key];
    const prior = existsSync(notesPath(key)) ? readFileSync(notesPath(key), 'utf8').trimEnd() + '\n\n' : '';
    writeTextAtomic(notesPath(key), `${prior}## Returned ${new Date().toISOString()} by ${who()}\n\n${o.why}\n`);
    const got = apply(returnEvents(key, rec, { why: o.why, t: timing(models()), by: who(), from: ['in_review', 'in_progress'] }), key);
    if (got) console.log(`${key}: returned → ${got.status}`);
  },

  park(o) {
    const [key, ...why] = o._;
    need(isKey(key) && why.length, 'usage: fleet.mjs park KEY "reason"');
    needKnown(key, o);
    const reason = why.join(' ');
    const got = apply([story(key, { from: ['todo', 'in_progress', 'in_review', 'escalate'], ifRun: board().stories[key]?.run ?? null, to: 'blocked', set: { parkedReason: reason, blockedAt: new Date().toISOString() }, unset: ['claim', 'run'], why: `parked by ${who()}` })], key);
    if (got) console.log(`${key}: parked — ${reason}`);
  },

  unpark(o) {
    const key = o._[0];
    need(isKey(key), 'usage: fleet.mjs unpark KEY');
    const got = apply([story(key, { from: 'blocked', to: 'todo', unset: ['parkedReason', 'ghosts', 'setupFails', 'resolveTries', 'reviewTries'], why: `unparked by ${who()}` })], key);
    if (got) console.log(`${key}: todo again`);
  },

  retry(o) {
    const key = o._[0];
    need(isKey(key), 'usage: fleet.mjs retry KEY [--fresh]');
    const t = timing(models());
    const rec = board().stories[key];
    const attempts = o.fresh ? 0 : Math.min(rec?.attempts ?? 0, t.maxAttempts + t.escalationAttempts - 1);
    const got = apply([story(key, { from: ['escalate', 'blocked'], to: 'todo', set: { attempts }, unset: ['lastFailure', 'repeats', 'parkedReason'], why: `retry by ${who()}${o.fresh ? ' (fresh)' : ''}` })], key);
    if (got) console.log(`${key}: todo again; the next attempt is attempt ${attempts + 1}`);
  },

  report(o) {
    const [key, status, ...why] = o._;
    need(isKey(key) && ['blocked', 'failed'].includes(status) && why.length, 'usage: fleet.mjs report KEY blocked|failed "what you tried and what you need"');
    needKnown(key, o);
    const prior = readJsonOr(resultPath(key), {});
    writeJsonAtomic(resultPath(key), { ...prior, key, status, notes: why.join(' ') });
    console.log(`${key}: result recorded (${status}) at ${resultPath(key)}`);
  },

  path(o) {
    const [kind, key] = o._;
    const paths = { result: resultPath, approved: approvalPath, notes: notesPath };
    need(paths[kind] && isKey(key), 'usage: fleet.mjs path result|approved|notes KEY');
    console.log(paths[kind](key));
  },

  doctor() {
    const problems = [];
    const loop = readLease(loopLeasePath());
    if (!loop || leaseHeld(loop) !== true) problems.push(`the loop is not running: ./orchestration/loop.sh start`);
    const lock = readLease(cycleLockPath());
    if (lock && leaseHeld(lock) === false) problems.push(`a dead cycle left ${cycleLockPath()}; the next cycle takes it over`);
    if (!read('sh', ['-c', 'command -v cursor-agent'])) problems.push('cursor-agent is not on PATH: runs cannot start headlessly');
    if (!gh(['auth', 'status'], { timeoutMs: LIMIT.quick }).ok) problems.push('gh is not authenticated: gh auth login');
    const { events, skipped } = readEvents();
    if (skipped) problems.push(`${skipped} unreadable line(s) in ${eventsPath()} (skipped; the rest of the log is intact)`);
    if (events.length > 200_000) problems.push(`the event log holds ${events.length} events; compact it (ADR-0034, "How we would know this was wrong" 4)`);
    const report = readJsonOr(fleetPath('report.json'));
    const ageMin = report?.at ? (Date.now() - Date.parse(report.at)) / 60_000 : null;
    if (loop && leaseHeld(loop) === true && (ageMin == null || ageMin > 10)) problems.push(`the loop is running but the last cycle report is ${ageMin == null ? 'missing' : `${Math.round(ageMin)} min old`}: every cycle is failing or hanging — tail ${fleetPath('loop.log')}`);
    let unknown = [];
    try { unknown = unknownModelKeys(readJson(here('models.json'))); } catch (e) { problems.push(`models.json does not parse: ${e.message}`); }
    if (unknown.length) problems.push(`models.json has settings nothing reads (misspelt?): ${unknown.join(', ')}`);
    const b = board();
    const now = Date.now();
    for (const [id, r] of Object.entries(b.runs)) {
      if (r.ended) continue;
      const alive = stillRunning({ pid: r.pid, match: r.match });
      if (!alive) problems.push(`run ${id} has no live worker; the next cycle finishes it`);
      else if (now > Date.parse(r.deadline) + 10 * 60_000) problems.push(`run ${id} is past its deadline and still running; the next cycle stops it`);
    }
    const status = existsSync(fleetPath('status.md')) ? readFileSync(fleetPath('status.md'), 'utf8') : '';
    const needs = status.split('## Needs you')[1]?.split('\n## ')[0]?.split('\n').filter(l => l.startsWith('- ') && l !== '- nothing') ?? [];
    console.log(`fleet store: ${fleetDir()}`);
    for (const p of problems) console.log(`✗ ${p}`);
    for (const n of needs) console.log(`· needs you ${n.slice(2)}`);
    if (!problems.length) console.log('✓ loop, lock, CLI, gh and runs look healthy');
    process.exitCode = problems.length ? 1 : 0;
  },
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const fn = commands[cmd];
  if (!fn) {
    console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//   node')).map(l => l.slice(3)).join('\n'));
    process.exit(2);
  }
  fn(flags(rest));
}

export { commands };
