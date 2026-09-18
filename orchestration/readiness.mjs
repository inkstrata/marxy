// Merge readiness for every open pull request, as a table sorted in merge order. Every approval run
// ends with it, so whoever reads the run sees what lands next and who each PR is waiting on.
// usage: node orchestration/readiness.mjs [--json] [--results DIR]
// --results reads approvals from another checkout's results/ (they are local scratch, gitignored),
// so a run from a worktree can report on the primary checkout's reviews.
//
// It asks the same question cycle.mjs asks (merge-bar.mjs `evaluate`, approve.mjs `verify`) and
// adds the one GitHub asks that the bar cannot see: a PR opened from the maintainer's account never
// gets reviewDecision REVIEW_REQUIRED, but branch protection still wants a code owner, so a PR that
// touches a CODEOWNERS path waits for Ian however green it is (MARXY-92).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { ROOT, here, readJson, stories, deps, pathsOf } from './lib.mjs';
import { verify } from './approve.mjs';
import { evaluate } from './merge-bar.mjs';

// Who has to act next, in the order a PR moves through them. The merge order sorts on this first.
export const TIERS = ['merge now', 'waiting on CI', 'Ian', 'update branch', 'reviewer', 'implementor', 'planner'];

// Files every PR touches, so sharing them says nothing about which PR disturbs which (MARXY-80).
export const SHARED = f => ['CHANGELOG.md', 'docs/taste-review/queue.md', 'pnpm-lock.yaml'].includes(f) || /^orchestration\/results\//.test(f);

/** CODEOWNERS patterns as repository-relative prefixes (a trailing `/` is a directory). */
export function codeOwnerPatterns(text) {
  return text.split('\n').map(l => l.trim().split(/\s+/)[0]).filter(p => p && !p.startsWith('#')).map(p => p.replace(/^\//, ''));
}
export const ownedBy = (patterns, file) => patterns.some(p => (p.endsWith('/') ? file.startsWith(p) : file === p));

/**
 * The first actor any hold reason names. A conflict or a red check is the implementor's before it is
 * anyone else's, because nothing downstream can read a tree that does not build or merge; but red on
 * a base main has since moved past is a stale verdict, so the branch is refreshed first.
 * `row` is { reasons, action, mergeStateStatus, ownedFiles }.
 */
export function tierOf(row) {
  const has = re => row.reasons.some(x => re.test(x));
  if (has(/files outside the story's paths|no story key/)) return 'planner';
  if (row.mergeStateStatus === 'BEHIND' && !has(/conflicts with main/)) return 'update branch';
  if (has(/conflicts with main|^red:|no implementor result|result says|no CHANGELOG|attribution|could not compute|no checks have run/)) return 'implementor';
  if (has(/not reviewed|approval|changes requested/)) return 'reviewer';
  if (row.ownedFiles.length || has(/human review required/)) return 'Ian';
  return row.action === 'merge' ? 'merge now' : 'waiting on CI';
}

/**
 * Sorts rows into merge order: tier, then the MARXY-80 review order — phase ascending, disturbance
 * descending (land what unblocks most others first), oldest first, key. MARXY-80 will own the
 * second half. Rows are { number, key, tier, phase, files, ageHours }; each gains `disturbs` and
 * `after`, the earlier PRs it shares a file with, which have to land before it can be resolved.
 */
export function mergeOrder(rows) {
  const own = row => row.files.filter(f => !SHARED(f));
  for (const row of rows) {
    const mine = own(row);
    row.disturbs = rows.filter(o => o !== row && own(o).some(f => mine.includes(f))).length;
  }
  rows.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.phase - b.phase
    || b.disturbs - a.disturbs || b.ageHours - a.ageHours || (a.key ?? '').localeCompare(b.key ?? ''));
  rows.forEach((row, i) => {
    const mine = own(row);
    row.after = rows.slice(0, i).filter(o => own(o).some(f => mine.includes(f))).map(o => o.number);
  });
  return rows;
}

function collect(resultsDir) {
  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
  const results = name => resultsDir ? `${resultsDir.replace(/\/$/, '')}/${name}` : here(`results/${name}`);
  const patterns = existsSync(`${ROOT}.github/CODEOWNERS`) ? codeOwnerPatterns(readFileSync(`${ROOT}.github/CODEOWNERS`, 'utf8')) : [];
  const phases = deps().phases ?? {};
  const phaseOf = key => Number(Object.entries(phases).find(([, keys]) => keys.includes(key))?.[0] ?? 99);
  const all = stories();
  sh('git', ['fetch', '-q', 'origin']);
  const prs = JSON.parse(sh('gh', ['pr', 'list', '--state', 'open', '--limit', '200', '--json',
    'number,title,url,headRefName,headRefOid,state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,createdAt,files']));
  return prs.map(pr => {
    const key = (pr.title.match(/MARXY-\d+/) ?? pr.headRefName.match(/MARXY-\d+/))?.[0] ?? null;
    const story = key && all.find(s => s.Key === key);
    const files = (pr.files ?? []).map(f => f.path);
    const allowed = story ? [...pathsOf(story), 'CHANGELOG.md', 'docs/taste-review/queue.md', 'pnpm-lock.yaml', `orchestration/results/${key}.json`] : null;
    const outside = allowed ? files.filter(f => !allowed.some(a => f === a || f.startsWith(a.replace(/\/$/, '') + '/'))) : [];
    const result = key && existsSync(results(`${key}.json`)) ? readJson(results(`${key}.json`)) : null;
    const approval = key ? verify(results(`${key}.approved`), pr.headRefOid) : { ok: false, why: 'no story key in the title or branch' };
    const { reasons } = evaluate({ pr, files, outside, result, approval });
    // Right after main moves GitHub reports UNKNOWN until it has tried the merge; that is not "clean".
    if (pr.mergeable === 'UNKNOWN') reasons.push('pending: GitHub is still working out whether it merges; re-run');
    const ownedFiles = files.filter(f => ownedBy(patterns, f));
    if (ownedFiles.length) reasons.push(`code owner: ${ownedFiles.length} file(s) under CODEOWNERS (${ownedFiles[0]}${ownedFiles.length > 1 ? ', …' : ''})`);
    const action = reasons.length === 0 ? 'merge' : reasons.every(r => r.startsWith('pending:')) ? 'auto-merge' : 'hold';
    const row = { number: pr.number, key, pr, files, approval, action, reasons, ownedFiles,
      mergeStateStatus: pr.mergeStateStatus, phase: key ? phaseOf(key) : 99,
      ageHours: Math.round((Date.now() - Date.parse(pr.createdAt)) / 36e5) };
    row.tier = tierOf(row);
    return row;
  });
}

const ci = row => {
  const states = (row.pr.statusCheckRollup ?? []).map(c => c.conclusion || c.state || c.status);
  if (!states.length) return 'none';
  if (states.some(s => ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ERROR'].includes(s))) return 'red';
  if (states.some(s => !s || ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED'].includes(s))) return 'pending';
  return 'green';
};
const approvalCell = ({ approval: a }) => a.ok ? `signed ${a.head.slice(0, 7)}` : /^not reviewed/.test(a.why) ? 'none' : /unsigned/.test(a.why) ? 'unsigned' : 'stale';
const next = row => {
  if (row.tier === 'merge now') return 'cycle.mjs merges it';
  if (row.tier === 'waiting on CI') return 'the next cycle merges it once CI is green';
  if (row.tier === 'update branch') return `behind main: \`gh pr update-branch ${row.number}\`, CI re-runs${row.approval.ok ? ', approval survives' : ''}`;
  if (row.tier === 'Ian' && row.reasons.every(r => /^code owner|^pending:|human review/.test(r))) return 'Ian merges (code-owner paths)';
  return row.reasons.find(r => !/^pending:/.test(r)) ?? row.reasons[0];
};

if (process.argv[1]?.endsWith('readiness.mjs')) {
  const flag = process.argv.indexOf('--results');
  const rows = mergeOrder(collect(flag > 0 ? process.argv[flag + 1] : null));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows.map((r, i) => ({ order: i + 1, pr: r.number, url: r.pr.url, key: r.key, tier: r.tier,
      phase: r.phase, disturbs: r.disturbs, ageHours: r.ageHours, after: r.after, ci: ci(r), mergeable: r.pr.mergeable,
      approval: approvalCell(r), reasons: r.reasons })), null, 2));
  } else {
    const esc = s => String(s).replace(/\|/g, '\\|');
    const title = t => t.replace(/\s*\(MARXY-\d+\)$/, '').replace(/^\w+(\([^)]*\))?:\s*/, '');
    console.log(`Merge readiness, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC: ${rows.length} open PRs in merge order\n`);
    console.log('| Order | PR | Story | Phase | CI | Mergeable | Approval | Waiting on | Next step | After |');
    console.log('| ---: | --- | --- | ---: | --- | --- | --- | --- | --- | --- |');
    rows.forEach((r, i) => console.log(`| ${i + 1} | [#${r.number}](${r.pr.url}) | ${esc(r.key ?? '—')}: ${esc(title(r.pr.title))} | ${r.phase === 99 ? '—' : r.phase} | ${ci(r)} | ${r.pr.mergeable === 'CONFLICTING' ? 'conflict' : r.pr.mergeable.toLowerCase()} | ${approvalCell(r)} | ${r.tier} | ${esc(next(r))} | ${r.after.map(n => `#${n}`).join(' ')} |`));
    const counts = TIERS.map(t => [t, rows.filter(r => r.tier === t).length]).filter(([, n]) => n);
    console.log(`\n${counts.map(([t, n]) => `${n} ${t}`).join(' · ')}. "After" names earlier PRs in this order that share a file with the row; they land first.`);
  }
}
