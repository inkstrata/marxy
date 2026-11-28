#!/usr/bin/env node
// Entry point for the standing automation: budget gate, merge gate, dashboard, results.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, appendJsonl, publish, attribution, stateDir } from './lib/state.mjs';

const out = (o) => console.log(JSON.stringify(o, null, 2));
const flag = (args, name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const first = (e) => String(e.stderr || e.message).split('\n')[0];
const newestUsage = () => readJsonl('usage', { limit: 20 }).filter((r) => r.usage).pop() || null;

async function decideNow(usage, job, now = new Date()) {
  const { decide } = await import('./lib/governor.mjs');
  const { lastReset } = await import('./lib/merge-policy.mjs');
  const ownerUsedPct = usage ? attribution(readJsonl('runs'), usage.weekly.pct, lastReset(now)).ownerPct : null;
  const d = decide({ now, usage, ownerUsedPct, profile: job });
  // The owner at the machine (typing, a game, a full-screen app) outranks the budget: start nothing new,
  // except in the Friday final sweep, where work continues in a light form.
  const { presence, withPresence } = await import('./lib/presence.mjs');
  out(withPresence(d, presence(), job));
}

async function usage(args) {
  const { fromGetUsage } = await import('./lib/governor.mjs');
  const src = flag(args, '--json') ?? '-';
  const raw = JSON.parse(fs.readFileSync(src === '-' ? 0 : src, 'utf8'));
  const u = fromGetUsage(raw.plan ?? raw);
  if (u) appendJsonl('usage', { at: new Date().toISOString(), usage: u });
  await decideNow(u, flag(args, '--job'));
}

// A reading older than 15 minutes is not trusted, so the governor runs blind.
async function gate(args = []) {
  const row = newestUsage();
  await decideNow(row && Date.now() - new Date(row.at) <= 15 * 60000 ? row.usage : null, flag(args, '--job'));
}

function run([event, ...args]) {
  const job = flag(args, '--job'), runId = flag(args, '--run');
  if (event === 'note') return note(job, runId, args);
  if (event !== 'start' && event !== 'end') throw new Error('run start|end|note --job <id> --run <run-id>');
  appendJsonl('runs', { at: new Date().toISOString(), event, job, run: runId, usage: newestUsage()?.usage ?? null });
  // A finished run has nothing to resume.
  if (event === 'end') fs.rmSync(path.join(stateDir(), 'run-state.json'), { force: true });
}

// Notes are how a run counts its own top-ups and small hunts; the state note also leaves a file so a restarted
// or compacted session can see which agents, worktrees and pull requests are in flight.
function note(job, runId, args) {
  const kind = flag(args, '--kind');
  if (!['hunt', 'top-up', 'small-hunt', 'targeted-hunt', 'state'].includes(kind)) throw new Error('run note --kind hunt|top-up|small-hunt|targeted-hunt|state --data <json>');
  const data = JSON.parse(flag(args, '--data') ?? 'null');
  const at = new Date().toISOString();
  appendJsonl('runs', { at, event: 'note', job, run: runId, kind, data });
  if (kind === 'state') fs.writeFileSync(path.join(stateDir(), 'run-state.json'), JSON.stringify({ at, job, run: runId, data }, null, 2));
}

async function status(args = []) {
  const { collect, newestWeek, ROOT } = await import('./lib/dashboard.mjs');
  const d = await collect();
  const { gatherFacts, nextSteps, resumable } = await import('./lib/next.mjs');
  const facts = gatherFacts(d, { root: ROOT, runId: flag(args, '--run') });
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(path.join(stateDir(), 'run-state.json'), 'utf8')); } catch { /* none saved */ }
  out({ prs: d.prs, devices: d.devices, plan: newestWeek(), resume: resumable(saved, readJsonl('runs'), flag(args, '--job')), next: { facts, steps: nextSteps(facts) } });
}

async function merge(args) {
  const dry = args.includes('--dry-run');
  const { evaluatedPRs } = await import('./lib/dashboard.mjs');
  const { mergePR } = await import('./lib/github.mjs');
  // One merge per tick: the next pull request is judged again against the new main half an hour later.
  let merged = false;
  for (const pr of await evaluatedPRs()) {
    const row = { at: new Date().toISOString(), number: pr.number, merge: pr.merge && !merged, reasons: pr.merge && merged ? ['one merge per tick'] : pr.reasons, dryRun: dry };
    if (row.merge && !dry) {
      try { mergePR(pr.number, pr.headRefOid); merged = true; } catch (e) { Object.assign(row, { merge: false, reasons: [`merge failed: ${first(e)}`] }); }
    } else if (row.merge) merged = true;
    if (!dry) appendJsonl('merge', row);
    console.log(`#${row.number} ${row.merge ? (dry ? 'would merge' : 'merged') : 'held'}${row.reasons.length ? `: ${row.reasons.join('; ')}` : ''}`);
  }
}

async function dashboard(args) {
  const { collect, render } = await import('./lib/dashboard.mjs');
  const md = render(await collect());
  if (args.includes('--dry-run')) return console.log(md);
  (await import('./lib/github.mjs')).upsertDashboardIssue(md);
  publish({ 'dashboard.md': md }, 'dashboard');
}

async function tick() {
  let failed = 0;
  for (const [name, step] of [['merge', merge], ['dashboard', dashboard]]) {
    try { await step([]); } catch (e) {
      failed++;
      console.error(`tick ${name}: ${first(e)}`);
      appendJsonl('logs/tick-errors', { at: new Date().toISOString(), step: name, error: first(e) });
    }
  }
  if (failed === 2) process.exitCode = 1;
}

function record([kind, file]) {
  if (!kind || !file) throw new Error('record <kind> <file>');
  const rel = `nights/${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())}-${kind}.md`;
  publish({ [rel]: fs.readFileSync(file, 'utf8') }, `record ${kind}`);
  console.log(rel);
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  usage, gate, run, status, merge, dashboard, tick, record,
  clean: async () => { (await import('./lib/clean.mjs')).cleanNow(); },
  nightly: async (a) => (await import('./device.mjs')).nightly(a),
  device: async (a) => (await import('./device.mjs')).device(a),
};
if (!commands[cmd]) {
  console.error(`usage: auto.mjs <${Object.keys(commands).join('|')}> [options]`);
  process.exit(2);
}
try { await commands[cmd](rest); } catch (e) { console.error(`${cmd}: ${first(e)}`); process.exit(1); }
