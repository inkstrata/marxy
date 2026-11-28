// The standing dashboard: render() is pure Markdown from collected data; collect() gathers it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TZ = 'America/Los_Angeles';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OWNER_REASON = /owner|hold|reset|changes requested|review.*change|plan/i;
const ptDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));
const ptStamp = (d) => `${new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d))} PT`;

export function age(from, now) {
  const m = from ? Math.max(0, Math.round((new Date(now) - new Date(from)) / 60000)) : null;
  return m == null ? 'no data' : m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

const short = (s, n = 100) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);
const brief = (reasons) => short((reasons || []).slice(0, 2).join('; '), 90);
const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 10) / 10}%` : 'n/a');
// Cells of the first table under a heading, header and rule rows removed.
export function tableRows(markdown, heading) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  // A heading ending in a space matches by its start ("Waiting on " finds the owner's section whatever its name).
  const want = `## ${heading}`.toLowerCase();
  const at = lines.findIndex((l) => (want.endsWith(' ') ? l.trim().toLowerCase().startsWith(want) : l.trim().toLowerCase() === want));
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
  return lines.slice(at + 1, end < 0 ? undefined : end).filter((l) => l.trim().startsWith('|'))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c))).slice(1);
}

function queueState(branch, prs, merged) {
  const b = String(branch || '').replace(/`/g, '').trim();
  const head = b.startsWith('agent/') ? b : `agent/${b}`;
  const m = b && merged.find((p) => p.headRefName === head);
  const o = b && prs.find((p) => p.headRefName === head);
  if (m) return `merged #${m.number}`;
  if (o) return `PR #${o.number} open (${o.merge ? 'ready to merge' : brief(o.reasons) || 'held'})`;
  return 'not started';
}

const nextUp = (d) => (d.queue?.rows.length
  ? d.queue.rows.map((r) => `- ${r[0]} ${short(r[2] || '', 70)} (${r[3] || '?'}): ${queueState(r[4], d.prs, d.merged)}`) : ['none']);

function changelog(d) {
  const cutoff = new Date(d.now).getTime() - 7 * 86400e3;
  const rows = d.merged.filter((p) => new Date(p.mergedAt).getTime() >= cutoff).sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));
  const out = [];
  let day = '';
  for (const p of rows) {
    if (ptDay(p.mergedAt) !== day) { day = ptDay(p.mergedAt); out.push(`**${day}**`); }
    out.push(`- #${p.number} ${p.title}`);
  }
  return out.length ? out : ['none'];
}

function waiting(d) {
  const mine = (p) => (p.reasons || []).filter((r) => OWNER_REASON.test(r));
  const out = d.prs.filter((p) => !p.merge && mine(p).length).map((p) => `- PR #${p.number} ${short(p.title, 60)}: ${brief(mine(p))}`);
  for (const r of d.waitingOnOwner || []) out.push(`- ${r[0]} ${short((r[1] || '').replace(/`/g, ''), 100)}`);
  return out.length ? out : ['none'];
}

// One line per device: the install check, the Windows verify and its reruns, and whether a sleep spoiled it.
function deviceLine(os, r, now) {
  if (!r) return `- ${os}: no data yet`;
  const state = r.slept ? 'inconclusive (slept)' : r.skipped?.length ? `partial (skipped ${r.skipped.join(', ')}: owner using the machine)` : r.install?.skipped ? `skipped (${r.install.skipped})` : r.install?.ok ? 'ok' : 'failed';
  const real = (r.reruns || []).filter((x) => x.verdict === 'real').length;
  const verify = r.verify ? `, verify ${r.verify.ok ? 'ok' : 'failed'}${real ? ` (${real} real reds)` : ''}` : '';
  const note = r.install?.notes ? `, ${short(String(r.install.notes), 70)}` : '';
  return `- ${os}: ${state}${verify}, ${age(r.finishedAt, now)} ago${note}`;
}

function health(d) {
  return [
    d.ci ? `- main CI: ${d.ci.conclusion || d.ci.status || 'unknown'}, ${age(d.ci.createdAt, d.now)} ago` : '- main CI: no data yet',
    ...['windows', 'macos', 'linux'].map((os) => deviceLine(os, d.devices?.[os], d.now)),
  ];
}

// The issue is public, so it shows only the automation's own spending and state; the owner's usage meters
// stay in the local state folder.
function budget(d) {
  const b = d.budget;
  const jobs = (d.jobs || []).filter((j) => j.kind === 'agent');
  return [
    d.usage?.at ? `- last usage reading: ${age(d.usage.at, d.now)} ago` : '- last usage reading: none yet (runs are blind until one exists)',
    b?.autoPct != null ? `- automation this week: ${pct(b.autoPct)} of the weekly limit` : '- automation this week: no data yet',
    jobs.length ? `- next agent runs: ${jobs.map((j) => `${j.id} ${j.when}`).join(', ')} (PT)` : '- next agent runs: none',
  ];
}

export function render(d) {
  const section = (title, lines) => [`## ${title}`, ...lines, ''];
  return [
    '# Marxy dashboard',
    `Updated ${ptStamp(d.now)}. Week of ${d.queue?.week || 'no plan yet'}.`,
    '',
    ...section('Next up', nextUp(d)),
    ...section('Changelog', changelog(d)),
    ...section('Waiting for you', waiting(d)),
    ...section('Health', health(d)),
    ...section('Budget', budget(d)),
  ].join('\n');
}

const quiet = (f, fallback) => { try { return f(); } catch (e) { console.error(`dashboard: ${String(e.message).split('\n')[0]}`); return fallback; } };

// Open PRs with the gate's verdict; shared by merge, status and the dashboard.
export async function evaluatedPRs({ root = ROOT, now = new Date() } = {}) {
  const gh = await import('./github.mjs');
  const policy = await import('./merge-policy.mjs');
  const co = await import('./codeowners.mjs');
  // The owner paths come from main as GitHub has it, never from a pull request or a stale checkout; if they
  // cannot be read the gate holds everything rather than treating every path as unowned.
  let rules = null;
  try {
    execFileSync('git', ['-C', root, 'fetch', '-q', 'origin', 'main'], { stdio: 'ignore' });
    rules = co.parseCodeowners(execFileSync('git', ['-C', root, 'show', 'origin/main:.github/CODEOWNERS'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    if (!rules.length) rules = null;
  } catch { /* held below */ }
  const lastResetAt = policy.lastReset(now);
  return gh.listOpenPRs().map((p) => {
    const v = policy.evaluate(p, { now, ownerRules: rules || [], lastResetAt });
    const extra = [];
    if (!rules) extra.push('CODEOWNERS on main could not be read');
    // GitHub's files API stops at 3,000 files, so a list that long may be missing an owner path.
    if (p.files.length >= 3000) extra.push('too many files to check every path');
    return extra.length ? { ...p, merge: false, reasons: [...v.reasons, ...extra] } : { ...p, ...v };
  });
}

export function newestWeek(root = ROOT) {
  try {
    const dir = path.join(root, 'work', 'weeks');
    const f = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort().pop();
    return f ? path.join(dir, f) : null;
  } catch { return null; }
}

export async function collect({ root = ROOT, now = new Date() } = {}) {
  const gh = await import('./github.mjs');
  const state = await import('./state.mjs');
  const policy = await import('./merge-policy.mjs');
  let prs = [];
  try { prs = await evaluatedPRs({ root, now }); } catch (e) { console.error(`dashboard: ${e.message.split('\n')[0]}`); }
  const weekFile = newestWeek(root);
  const read = (file, fallback) => quiet(() => fs.readFileSync(path.join(root, file), 'utf8'), fallback);
  // The nightly and device runs publish their newest result per OS as devices/<os>.json.
  const devices = {};
  for (const os of ['windows', 'macos', 'linux']) devices[os] = quiet(() => JSON.parse(state.readPublished(`devices/${os}.json`)), null);
  const usage = state.readJsonl('usage', { limit: 1 }).pop() || null;
  return {
    now: now.toISOString(),
    prs: prs.map(({ number, title, headRefName, merge, reasons }) => ({ number, title, headRefName, merge, reasons })),
    merged: quiet(() => gh.mergedSince(new Date(now.getTime() - 30 * 86400e3).toISOString().slice(0, 10)), []),
    queue: weekFile ? { week: path.basename(weekFile, '.md'), rows: tableRows(fs.readFileSync(weekFile, 'utf8'), 'Queue') } : null,
    waitingOnOwner: tableRows(read('work/todo.md', ''), 'Waiting on '),
    ci: quiet(() => gh.mainCi(), null),
    devices,
    usage,
    budget: state.attribution(state.readJsonl('runs'), usage?.usage?.weekly?.pct, policy.lastReset(now)),
    jobs: JSON.parse(read('scripts/auto/schedule.json', '{"jobs":[]}')).jobs,
  };
}
