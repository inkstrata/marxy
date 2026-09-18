// One orchestrator cycle, safe to run repeatedly: mirror the board into Jira, land the pull
// requests that are provably finished, say what should be dispatched next, ask whether the
// planner is due, and write the status report. Everything a machine can decide, it decides;
// everything else it names. usage: node orchestration/cycle.mjs [--no-merge] [--dry-run]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { ROOT, here, readJson, stories, state, saveState, models, pathsOf } from './lib.mjs';

const args = process.argv.slice(2);
const NO_MERGE = args.includes('--no-merge'), DRY = args.includes('--dry-run');
const log = [];
const say = m => { console.log(m); log.push(m); };
const sh = (cmd, a, opts = {}) => { try { return execFileSync(cmd, a, { cwd: ROOT, encoding: 'utf8', ...opts }).trim(); } catch (e) { return { error: (e.stdout ?? '') + (e.stderr ?? e.message) }; } };
const gh = a => { const r = sh('gh', a); return typeof r === 'string' ? r : null; };
const node = a => spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8' });

// 1. Jira is the board of record; make it agree before anything else changes.
const push = node([here('jira.mjs'), 'push']);
say(`jira: ${(push.stdout || push.stderr || '').trim().split('\n').pop() || 'unavailable'}`);

// 2. Land what is finished. A PR merges only when every one of these holds, and the reason it
// did not is printed, because an unexplained unmerged PR is how a fleet quietly stalls.
const s = state();
const held = [];
for (const [key, rec] of Object.entries(s.stories)) {
  if (rec.status !== 'in_review' || !rec.pr) continue;
  const view = gh(['pr', 'view', String(rec.pr), '--json', 'state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,headRefName']);
  if (!view) { held.push(`${key}: PR #${rec.pr} could not be read`); continue; }
  const pr = JSON.parse(view);
  // A branch cut before main moved was tested against a main that no longer exists. Refresh it and
  // let the next cycle read the honest result rather than merging on a stale green.
  if (pr.state === 'OPEN' && pr.mergeStateStatus === 'BEHIND' && !DRY) {
    const r = sh('gh', ['pr', 'update-branch', String(rec.pr)]);
    held.push(`${key}: PR #${rec.pr} was behind main — ${typeof r === 'string' ? 'updated; CI is re-running' : `update failed: ${r.error.split('\n')[0]}`}`);
    continue;
  }
  const checks = (pr.statusCheckRollup ?? []).map(c => ({ name: c.name ?? c.context, state: c.conclusion ?? c.state }));
  const red = checks.filter(c => ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ERROR'].includes(c.state));
  const pending = checks.filter(c => !c.state || ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED'].includes(c.state));
  const result = existsSync(here(`results/${key}.json`)) ? readJson(here(`results/${key}.json`)) : null;
  const story = stories().find(x => x.Key === key);
  const files = story && pr.headRefName ? (() => { const r = sh('git', ['diff', '--name-only', `origin/main...origin/${pr.headRefName}`]); return typeof r === 'string' ? r.split('\n').filter(Boolean) : []; })() : [];
  const allowed = story ? [...pathsOf(story), 'CHANGELOG.md', 'docs/taste-review/queue.md', 'pnpm-lock.yaml', `orchestration/results/${key}.json`] : [];
  const outside = files.filter(f => !allowed.some(a => f === a || f.startsWith(a.replace(/\/$/, '') + '/')));
  const why = [
    pr.state !== 'OPEN' && `PR is ${pr.state}`,
    pr.mergeable === 'CONFLICTING' && 'conflicts with main',
    red.length && `red: ${red.map(c => c.name).join(', ')}`,
    pending.length && `pending: ${pending.map(c => c.name).join(', ')}`,
    pr.reviewDecision === 'CHANGES_REQUESTED' && 'changes requested',
    pr.reviewDecision === 'REVIEW_REQUIRED' && 'human review required (CODEOWNERS)',
    outside.length && `files outside the story's paths: ${outside.join(', ')}`,
    !result && 'no implementor result file',
    result && result.status !== 'done' && `result says ${result.status}`,
    !files.includes('CHANGELOG.md') && 'no CHANGELOG entry',
    // Green gates say the code works, not that it does what the story asked. A human or the
    // orchestrator records that judgement by writing results/KEY.approved; nothing merges without it.
    !existsSync(here(`results/${key}.approved`)) && process.env.MARXY_MERGE_UNREVIEWED !== '1' && 'not reviewed (no results/KEY.approved)',
  ].filter(Boolean);
  if (why.length) { held.push(`${key}: PR #${rec.pr} held — ${why.join('; ')}`); continue; }
  if (NO_MERGE || DRY) { held.push(`${key}: PR #${rec.pr} is mergeable and clean (not merging: ${NO_MERGE ? '--no-merge' : '--dry-run'})`); continue; }
  const merged = sh('gh', ['pr', 'merge', String(rec.pr), '--squash', '--delete-branch']);
  if (typeof merged !== 'string') { held.push(`${key}: merge failed — ${merged.error.split('\n')[0]}`); continue; }
  say(`merged ${key} (PR #${rec.pr})`);
  node([here('state.mjs'), 'done', key]);
  if (rec.worktree && existsSync(`${ROOT}${rec.worktree.replace(/^\.\.\//, '../')}`)) sh('git', ['worktree', 'remove', '--force', rec.worktree]);
}
held.forEach(say);

// 3. What should start next. Headless dispatch needs the Cursor CLI; without it the in-app
// orchestrator is the dispatcher, so name the keys rather than pretending to start them.
const ready = JSON.parse(node([here('ready.mjs')]).stdout || '{"ready":[],"lanesFree":0,"inProgress":[]}');
const hasCli = typeof sh('sh', ['-c', 'command -v cursor-agent']) === 'string';
if (ready.ready.length && hasCli && !DRY) {
  say(`dispatching ${ready.ready.map(r => r.key).join(' ')} headlessly`);
  node([here('dispatch.mjs'), ...ready.ready.map(r => r.key)]);
} else if (ready.ready.length) {
  say(`dispatch ${ready.ready.length} story(ies) into ${ready.lanesFree} free lane(s): ${ready.ready.map(r => r.key).join(' ')}` + (hasCli ? '' : ' (cursor-agent absent: dispatch as in-app implementor subagents)'));
} else {
  say(`no story ready; ${ready.inProgress.length} in progress (${ready.inProgress.join(', ') || 'none'})`);
}

// 4. Is the plan stale?
const plan = node([here('planner-trigger.mjs')]);
say(`planner: ${plan.status === 0 ? 'due —' : 'not due'} ${(plan.stdout || '').trim().replace(/\n/g, ' ')}`.trim());

// 5. The report. Overwritten every cycle; the durable record is the PRs and Jira.
const byStatus = {};
for (const [k, v] of Object.entries(state().stories)) (byStatus[v.status] ??= []).push(k);
const human = existsSync(here('needs-human.md')) ? readFileSync(here('needs-human.md'), 'utf8').split('\n').filter(l => l.startsWith('- [ ]')).length : 0;
writeFileSync(here('status.md'), `# Status — ${new Date().toISOString()}

Written by \`orchestration/cycle.mjs\`. ${human} open item(s) in \`needs-human.md\`.

## Board

${Object.entries(byStatus).map(([k, v]) => `- **${k}** (${v.length}): ${v.join(', ')}`).join('\n')}

## This cycle

${log.map(l => `- ${l}`).join('\n')}
`);
say(`status written; ${human} open item(s) for a human`);
