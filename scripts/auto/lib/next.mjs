// What a run should do next. nextSteps() is pure; the rest turns the repository into its facts.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { localParts, POLICY } from './governor.mjs';
import { lastReset } from './merge-policy.mjs';
import { readJsonl } from './state.mjs';

const TOP_UP_ROWS = 2;
const WAITS = /waits for|after |held|parked/i;
const NEEDS_BUILDER = /^changes requested|^failed checks|merge state is (BEHIND|DIRTY|CONFLICTING)/;
const TUESDAY = 2;

// An empty queue used to mean "stop" and a night did nothing; now it means "look for work", in a fixed order.
// Skipping is still the right answer when nothing is needed.
export function nextSteps(f) {
  const steps = [];
  const prs = f.prsNeedingBuilder || [];
  const unstarted = f.queueUnstarted || [];
  const ready = f.readyRows || [];
  if (prs.length) steps.push({ step: 'carry-over', reason: `${prs.length} pull request(s) need a builder`, prs });
  if (unstarted.length) steps.push({ step: 'queue', reason: `${unstarted.length} unstarted piece(s) in the week's queue`, pieces: unstarted });
  // A run that has already topped up does not do it twice: the rows it took are in flight.
  if (unstarted.length < 2 && ready.length && !f.topUpsThisRun) {
    steps.push({ step: 'top-up', reason: `only ${unstarted.length} unstarted piece(s), ${ready.length} ready row(s)${f.sweep ? ' (sweep)' : ''}`, rows: ready.slice(0, TOP_UP_ROWS) });
  }
  const quiet = f.daysSinceHunt == null || f.daysSinceHunt >= 2;
  // Tuesday has its own full hunt, so a small one would only crowd it.
  if (f.weekday !== TUESDAY && ready.length < 3 && (f.huntsThisWeek || 0) < 2 && quiet && !f.smallHuntsThisRun) {
    steps.push({ step: 'small-hunt', reason: `only ${ready.length} ready row(s), ${f.huntsThisWeek || 0} hunt(s) this week, last hunt ${f.daysSinceHunt ?? 'never'} day(s) ago` });
  }
  if (f.weekday === TUESDAY) steps.push({ step: 'hunt', reason: "Tuesday's regular hunt" });
  if (!steps.length) {
    const why = f.finalSweep || f.sweep ? 'sweep night with no ready rows and no hunt due' : 'queue empty, no ready rows, no hunt due';
    steps.push({ step: 'stop', reason: why });
  }
  return steps;
}

// A queue piece is unstarted when nothing in git or GitHub shows anyone began it.
export function unstartedPieces(queueRows, openPRs, mergedPRs, branches) {
  const head = (b) => { const s = String(b || '').replace(/`/g, '').trim(); return s.startsWith('agent/') ? s : `agent/${s}`; };
  return queueRows.filter((r) => r[4]).map((r) => ({ n: r[0], rows: r[1], branch: head(r[4]) }))
    .filter((p) => !openPRs.some((x) => x.headRefName === p.branch) && !mergedPRs.some((x) => x.headRefName === p.branch) && !branches.includes(p.branch));
}

// Rows in Next, Structure and Big files with an empty Branch cell that do not say they wait on something.
export function readyRows(todoMd, sections = ['Next', 'Structure', 'Big files']) {
  const lines = String(todoMd).split(/\r?\n/);
  const out = [];
  for (const name of sections) {
    const at = lines.findIndex((l) => l.trim().toLowerCase() === `## ${name}`.toLowerCase());
    if (at < 0) continue;
    const end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
    for (const l of lines.slice(at + 1, end < 0 ? undefined : end)) {
      if (!l.trim().startsWith('|')) continue;
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.length < 5 || /^(#|:?-+:?)$/.test(cells[0])) continue;
      if (cells[cells.length - 1] === '' && !WAITS.test(cells.slice(1).join(' '))) out.push({ id: cells[0], section: name, what: cells[1].slice(0, 120), why: cells[2] });
    }
  }
  // The README's "Order of work": cause rows (most findings covered first), then data loss, then S1 to S3; Array.sort is stable, so tracker order breaks ties.
  return out.sort((a, b) => rank(a) - rank(b));
}

const covered = (r) => (/^Covers:([^;]*)/i.exec(r.why || '')?.[1].match(/\b[A-Z]{1,4}-?\d+\b/g) || []).length;
const rank = (r) => (/^Covers:/i.test(r.why || '') ? -1000 - covered(r)
  : /data loss|corruption/i.test(r.why) ? -4 : /\bS([123])\b/.test(r.why || '') ? -3 + Number(/\bS([123])\b/.exec(r.why)[1]) : 1);

export const needsBuilder = (pr) => String(pr.headRefName).startsWith('agent/') && (pr.reasons || []).some((r) => NEEDS_BUILDER.test(r))
  && !(pr.reasons || []).some((r) => /^labelled hold|^draft/.test(r));

const ptDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: POLICY.tz }).format(d);
const dayNumber = (s) => Date.parse(`${s}T00:00:00Z`) / 86400e3;

// Hunt folders are `<date>-hunt-<nn>`. A hunt belongs to this week when its date is after the reset's date.
export function huntFacts(folderNames, now) {
  const dates = folderNames.map((n) => /^(\d{4}-\d{2}-\d{2})-hunt-\d+/.exec(n)?.[1]).filter(Boolean).sort();
  const today = ptDay(now);
  const since = ptDay(lastReset(now));
  return { daysSinceHunt: dates.length ? dayNumber(today) - dayNumber(dates.at(-1)) : null, huntsThisWeek: dates.filter((d) => d > since).length };
}

// Notes of this run only, counted from its start so an earlier run with the same id prefix never counts.
export function runCounts(rows, runId) {
  const starts = rows.map((r, i) => (r.event === 'start' && (!runId || r.run === runId) ? i : -1)).filter((i) => i >= 0);
  const from = starts.length ? starts.at(-1) : 0;
  const mine = rows.slice(from).filter((r) => r.event === 'note' && (!runId || r.run === runId));
  return { topUpsThisRun: mine.filter((r) => r.kind === 'top-up').length, smallHuntsThisRun: mine.filter((r) => r.kind === 'small-hunt').length };
}

function originBranches(root) {
  const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try { return git(['ls-remote', '--heads', 'origin', 'agent/*']).split('\n').map((l) => l.split('refs/heads/')[1]).filter(Boolean); } catch { /* offline: use what was fetched last */ }
  try { return git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/agent']).split('\n').map((s) => s.replace(/^origin\//, '')).filter(Boolean); } catch { return []; }
}

// `collected` is the dashboard's collect() result: open PRs with the gate's reasons, merged PRs, the queue.
export function gatherFacts(collected, { root, now = new Date(), runId } = {}) {
  const read = (p) => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return ''; } };
  let hunts = [];
  try { hunts = fs.readdirSync(path.join(root, 'work', 'runs')); } catch { /* none yet */ }
  const queued = new Set((collected.queue?.rows || []).flatMap((r) => String(r[1]).split(/[^A-Za-z0-9]+/)));
  const l = localParts(now);
  const finalSweep = l.weekday === POLICY.finalSweep.weekday && l.hour >= POLICY.finalSweep.from && l.hour < POLICY.finalSweep.until;
  return {
    prsNeedingBuilder: collected.prs.filter(needsBuilder).map((p) => ({ number: p.number, reason: p.reasons.find((r) => NEEDS_BUILDER.test(r)) })),
    queueUnstarted: unstartedPieces(collected.queue?.rows || [], collected.prs, collected.merged, originBranches(root)),
    // A row the week's queue already names is that piece's, not spare work.
    readyRows: readyRows(read('work/todo.md')).filter((r) => !queued.has(r.id)),
    ...huntFacts(hunts, now),
    ...runCounts(readJsonl('runs'), runId),
    weekday: l.weekday,
    sweep: l.weekday === 4 || (l.weekday === 5 && l.hour < POLICY.lastBlockEnd),
    finalSweep,
  };
}
