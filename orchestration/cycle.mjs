// One orchestrator cycle, safe to run repeatedly: mirror the board into Jira, land the pull
// requests that are provably finished, say what should be dispatched next, ask whether the
// planner is due, and write the status report. Everything a machine can decide, it decides;
// everything else it names. usage: node orchestration/cycle.mjs [--no-merge] [--dry-run]
// [--low|--minimal|--compute=default|low|minimal]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { ROOT, here, readJson, stories, state, models, pathsOf } from './lib.mjs';
import { verify } from './approve.mjs';
import { evaluate } from './merge-bar.mjs';

const args = process.argv.slice(2);
const NO_MERGE = args.includes('--no-merge'), DRY = args.includes('--dry-run');
const m = models();
process.env.MARXY_COMPUTE = m.compute;
const log = [];
const say = line => { console.log(line); log.push(line); };
say(`compute: ${m.compute} — orchestrator ${m.orchestrator.model} ${m.orchestrator.effort}; implementor ${m.implementor.model} ${m.implementor.effort}`);
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
  const view = gh(['pr', 'view', String(rec.pr), '--json', 'state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,headRefName,headRefOid,autoMergeRequest']);
  if (!view) { held.push(`${key}: PR #${rec.pr} could not be read`); continue; }
  const pr = JSON.parse(view);
  const finish = note => {
    say(`merged ${key} (PR #${rec.pr})`);
    node([here('state.mjs'), 'done', key]);
    if (note) node([here('jira.mjs'), 'comment', key, `Merged as PR #${rec.pr}. Review that allowed it:\n\n${note}`]);
  };
  const reviewNote = () => existsSync(here(`results/${key}.approved`)) ? readFileSync(here(`results/${key}.approved`), 'utf8').trim() : '';
  // Auto-merge lands between cycles; close the board when GitHub has already done the squash.
  if (pr.state === 'MERGED') { finish(reviewNote()); continue; }
  // A branch cut before main moved was tested against a main that no longer exists. Refresh it and
  // let the next cycle read the honest result rather than merging on a stale green.
  // Never while an implementor is in the worktree: updating the branch ref under a working tree it
  // has checked out made one agent stage a revert of somebody else's merge.
  const live = rec.worktree && existsSync(`${ROOT}${rec.worktree}`);
  if (pr.state === 'OPEN' && pr.mergeStateStatus === 'BEHIND' && live) {
    held.push(`${key}: PR #${rec.pr} is behind main but ${rec.worktree} is still checked out; the implementor merges it`);
    continue;
  }
  if (pr.state === 'OPEN' && pr.mergeStateStatus === 'BEHIND' && !DRY) {
    const r = sh('gh', ['pr', 'update-branch', String(rec.pr)]);
    held.push(`${key}: PR #${rec.pr} was behind main — ${typeof r === 'string' ? 'updated; CI is re-running' : `update failed: ${r.error.split('\n')[0]}`}`);
    continue;
  }
  const result = existsSync(here(`results/${key}.json`)) ? readJson(here(`results/${key}.json`)) : null;
  const story = stories().find(x => x.Key === key);
  const files = story && pr.headRefName ? (() => { const r = sh('git', ['diff', '--name-only', `origin/main...origin/${pr.headRefName}`]); return typeof r === 'string' ? r.split('\n').filter(Boolean) : []; })() : [];
  const allowed = story ? [...pathsOf(story), 'CHANGELOG.md', 'docs/taste-review/queue.md', 'pnpm-lock.yaml', `orchestration/results/${key}.json`] : [];
  const outside = files.filter(f => !allowed.some(a => f === a || f.startsWith(a.replace(/\/$/, '') + '/')));
  // A squash merge can carry a commit message onto main, so the trailer has to be blocked here and
  // not only by a local hook that a worktree cut from a branch without `.githooks` never ran.
  const messages = pr.headRefName ? sh('git', ['log', `origin/main..origin/${pr.headRefName}`, '--format=%B']) : '';
  const trailer = typeof messages === 'string' && /co-authored-by:.*(cursor|claude|gpt|grok|copilot|anthropic|openai)|generated with/i.test(messages);
  const decision = evaluate({
    pr,
    files,
    outside,
    result,
    attribution: trailer,
    approval: verify(here(`results/${key}.approved`), pr.headRefOid),
    mergeUnreviewed: process.env.MARXY_MERGE_UNREVIEWED === '1',
  });
  if (decision.action === 'hold') {
    // Auto-merge is a decision taken now and executed later, on information that may have changed by
    // then. MARXY-63 landed that way: a cycle queued it while its checks ran, its approval was
    // withdrawn before they finished, and GitHub merged it regardless. A standing instruction that no
    // longer describes our judgement has to be cancelled, not merely left unrenewed.
    if (pr.autoMergeRequest) { sh('gh', ['pr', 'merge', String(rec.pr), '--disable-auto']); say(`${key}: auto-merge cancelled — ${decision.reasons[0]}`); }
    held.push(`${key}: PR #${rec.pr} held — ${decision.reasons.join('; ')}`);
    continue;
  }
  if (NO_MERGE || DRY) { held.push(`${key}: PR #${rec.pr} is ${decision.action === 'auto-merge' ? 'waiting on CI and would auto-merge' : 'mergeable and clean'} (not merging: ${NO_MERGE ? '--no-merge' : '--dry-run'})`); continue; }
  if (decision.action === 'auto-merge') {
    const queued = sh('gh', ['pr', 'merge', String(rec.pr), '--squash', '--auto', '--delete-branch']);
    if (typeof queued === 'string') say(`auto-merge enabled ${key} (PR #${rec.pr}) — waiting on CI`);
    else held.push(`${key}: auto-merge failed — ${queued.error.split('\n')[0]}`);
    continue;
  }
  // The worktree goes first: while it exists it holds the branch checked out, and gh reports the
  // whole merge as failed when only the branch deletion did.
  if (rec.worktree) { sh('git', ['worktree', 'remove', '--force', rec.worktree]); sh('git', ['branch', '-D', pr.headRefName]); }
  const merged = sh('gh', ['pr', 'merge', String(rec.pr), '--squash', '--delete-branch']);
  const landed = typeof merged === 'string' || (gh(['pr', 'view', String(rec.pr), '--json', 'state', '-q', '.state']) ?? '') === 'MERGED';
  if (!landed) { held.push(`${key}: merge failed — ${merged.error.split('\n')[0]}`); continue; }
  if (decision.approval?.note) say(`${key}: ${decision.approval.note}`);
  finish(reviewNote());
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
  const laneNote = ready.lanes === 'uncapped' || ready.lanesFree == null ? 'uncapped lanes' : `${ready.lanesFree} free lane(s)`;
  say(`dispatch ${ready.ready.length} story(ies) into ${laneNote}: ${ready.ready.map(r => r.key).join(' ')}` + (hasCli ? '' : ' (cursor-agent absent: dispatch as in-app implementor subagents)'));
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

Written by \`orchestration/cycle.mjs\`. Compute mode **${m.compute}**. ${human} open item(s) in \`needs-human.md\`.

## Board

${Object.entries(byStatus).map(([k, v]) => `- **${k}** (${v.length}): ${v.join(', ')}`).join('\n')}

## This cycle

${log.map(l => `- ${l}`).join('\n')}
`);
say(`status written; ${human} open item(s) for a human`);
