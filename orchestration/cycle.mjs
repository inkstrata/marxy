// One orchestrator cycle, safe to run repeatedly. The order matters and is the point of the file:
//   1. sync     — fetch, fast-forward the orchestrator's main, make Jira agree with the board
//   2. land     — merge what is provably finished, pinned to the head that was evaluated
//   3. refresh  — bring at most one BEHIND PR up to date: the oldest one that would otherwise land
//   4. review   — name every PR waiting on a reviewer, since in_review stories hold their paths
//   5. plan     — ask whether the planner is due, before anything new starts on a stale plan
//   6. dispatch — name (or start) what is ready
//   7. report   — status.md
// Everything a machine can decide, it decides; everything else it names.
// usage: node orchestration/cycle.mjs [--no-merge] [--dry-run] [--low|--minimal|--compute=NAME]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, here, readJson, stories, state, models } from './lib.mjs';
import { verify } from './approve.mjs';
import { evaluate, mergeArgs, chooseUpdate, worktreeLive } from './merge-bar.mjs';
import { allowedFor, fileAllowed } from './review.mjs';

const args = process.argv.slice(2);
const NO_MERGE = args.includes('--no-merge'), DRY = args.includes('--dry-run');
const m = models();
process.env.MARXY_COMPUTE = m.compute;
const log = [];
const say = line => { console.log(line); log.push(line); };
say(`compute: ${m.compute} — orchestrator ${m.orchestrator.model} ${m.orchestrator.effort}; implementor ${m.implementor.model} ${m.implementor.effort}; reviewer ${m.reviewer.model}`);
const sh = (cmd, a, opts = {}) => { try { return execFileSync(cmd, a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim(); } catch (e) { return { error: (e.stdout ?? '') + (e.stderr ?? e.message) }; } };
const ok = r => typeof r === 'string';
const gh = a => { const r = sh('gh', a); return ok(r) ? r : null; };
const node = a => spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8' });
const firstLine = r => (r.error ?? '').split('\n').find(Boolean) ?? 'unknown error';

// 1. Sync. Every diff below is against origin/main, and ready.mjs reads the board from this
// checkout, so both have to describe the main that exists now.
sh('git', ['fetch', '-q', 'origin']);
if (sh('git', ['branch', '--show-current']) === 'main' && !DRY) {
  const ff = sh('git', ['merge', '--ff-only', '-q', 'origin/main']);
  if (!ok(ff)) say(`main: could not fast-forward to origin/main (${firstLine(ff)}); the board below may be stale`);
}
const push = node([here('jira.mjs'), 'push']);
say(`jira: ${(push.stdout || push.stderr || '').trim().split('\n').pop() || 'unavailable'}`);

/** Whether an implementor (or a person) is still working in this story's worktree. */
function live(rec) {
  if (!rec.worktree) return false;
  const wt = resolve(ROOT, rec.worktree);
  if (!existsSync(wt)) return false;
  // Read the activity time before asking for status; --no-optional-locks keeps our own status call
  // from refreshing the index and making every worktree look busy.
  const index = sh('git', ['-C', wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index']);
  let lastActivityMs = null;
  try { if (ok(index)) lastActivityMs = statSync(index).mtimeMs; } catch { /* no index yet */ }
  const status = sh('git', ['--no-optional-locks', '-C', wt, 'status', '--porcelain']);
  return worktreeLive({ exists: true, dirty: !ok(status) || status.length > 0, lastActivityMs, windowMinutes: m.attemptMinutes });
}

// 2. Land what is finished. A PR merges only when every clause holds, and the reason it did not is
// printed, because an unexplained unmerged PR is how a fleet quietly stalls.
const s = state();
const held = [];
const behind = [];
const needsReview = [];
for (const [key, rec] of Object.entries(s.stories)) {
  if (rec.status !== 'in_review' || !rec.pr) continue;
  const view = gh(['pr', 'view', String(rec.pr), '--json', 'number,state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,headRefName,headRefOid,autoMergeRequest']);
  if (!view) { held.push(`${key}: PR #${rec.pr} could not be read`); continue; }
  const pr = JSON.parse(view);
  const reviewNote = () => existsSync(here(`results/${key}.approved`)) ? readFileSync(here(`results/${key}.approved`), 'utf8').trim() : '';
  const finish = () => {
    say(`merged ${key} (PR #${rec.pr})`);
    node([here('state.mjs'), 'done', key]);
    const note = reviewNote();
    if (note) node([here('jira.mjs'), 'comment', key, `Merged as PR #${rec.pr}. Review that allowed it:\n\n${note}`]);
  };
  // Auto-merge lands between cycles; close the board when GitHub has already done the squash.
  if (pr.state === 'MERGED') { finish(); continue; }

  const result = existsSync(here(`results/${key}.json`)) ? readJson(here(`results/${key}.json`)) : null;
  const story = stories().find(x => x.Key === key);
  const diff = story && pr.headRefName ? sh('git', ['diff', '--name-only', `origin/main...origin/${pr.headRefName}`]) : '';
  const files = ok(diff) ? diff.split('\n').filter(Boolean) : [];
  // The same boundary rule the review packet shows the reviewer; two copies had drifted apart.
  const allowed = story ? allowedFor(story, key) : [];
  const outside = files.filter(f => !fileAllowed(f, allowed));
  // A squash merge can carry a commit message onto main, so the trailer has to be blocked here and
  // not only by a local hook that a worktree cut from a branch without `.githooks` never ran.
  const messages = pr.headRefName ? sh('git', ['log', `origin/main..origin/${pr.headRefName}`, '--format=%B']) : '';
  const trailer = ok(messages) && /co-authored-by:.*(cursor|claude|gpt|grok|copilot|anthropic|openai)|generated with/i.test(messages);
  const approval = verify(here(`results/${key}.approved`), pr.headRefOid);
  if (!approval.ok) needsReview.push(`${key} (PR #${rec.pr}): ${approval.why}`);
  const decision = evaluate({
    pr, files, outside, result, attribution: trailer, approval,
    mergeUnreviewed: process.env.MARXY_MERGE_UNREVIEWED === '1',
  });

  if (decision.action === 'hold' || pr.mergeStateStatus === 'BEHIND') {
    // Auto-merge is a decision taken now and executed later, on information that may have changed by
    // then. MARXY-63 landed that way: a cycle queued it while its checks ran, its approval was
    // withdrawn before they finished, and GitHub merged it regardless. A standing instruction that no
    // longer describes our judgement has to be cancelled, not merely left unrenewed.
    if (decision.action === 'hold' && pr.autoMergeRequest && !DRY) {
      sh('gh', ['pr', 'merge', String(rec.pr), '--disable-auto']);
      say(`${key}: auto-merge cancelled — ${decision.reasons[0]}`);
    }
    if (pr.state === 'OPEN' && pr.mergeStateStatus === 'BEHIND') {
      behind.push({ key, number: pr.number, reasons: decision.reasons, live: live(rec) });
      continue;
    }
    held.push(`${key}: PR #${rec.pr} held — ${decision.reasons.join('; ')}`);
    continue;
  }
  if (NO_MERGE || DRY) { held.push(`${key}: PR #${rec.pr} is ${decision.action === 'auto-merge' ? 'waiting on CI and would auto-merge' : 'mergeable and clean'} (not merging: ${NO_MERGE ? '--no-merge' : '--dry-run'})`); continue; }
  if (decision.action === 'auto-merge') {
    const queued = sh('gh', mergeArgs(rec.pr, pr.headRefOid, { auto: true }));
    if (ok(queued)) say(`auto-merge enabled ${key} (PR #${rec.pr} at ${pr.headRefOid.slice(0, 7)}) — waiting on CI`);
    else held.push(`${key}: auto-merge failed — ${firstLine(queued)}`);
    continue;
  }
  // The worktree goes first: while it exists it holds the branch checked out, and gh reports the
  // whole merge as failed when only the branch deletion did. Never while someone is working in it.
  if (live(rec)) { held.push(`${key}: PR #${rec.pr} is mergeable but ${rec.worktree} has uncommitted or recent work`); continue; }
  if (rec.worktree && existsSync(resolve(ROOT, rec.worktree))) { sh('git', ['worktree', 'remove', rec.worktree]); sh('git', ['branch', '-D', pr.headRefName]); }
  const merged = sh('gh', mergeArgs(rec.pr, pr.headRefOid));
  const landed = ok(merged) || (gh(['pr', 'view', String(rec.pr), '--json', 'state', '-q', '.state']) ?? '') === 'MERGED';
  if (!landed) { held.push(`${key}: merge failed — ${firstLine(merged)}`); continue; }
  if (decision.approval?.note) say(`${key}: ${decision.approval.note}`);
  finish();
}

// 3. Refresh one. Updating every BEHIND PR on every merge reran CI for all of them and moved every
// head; only the PR that would land next is worth a CI run.
const next = chooseUpdate(behind);
for (const b of behind) {
  if (b === next && !DRY) {
    const r = sh('gh', ['pr', 'update-branch', String(b.number)]);
    held.push(`${b.key}: PR #${b.number} was behind main — ${ok(r) ? 'updated; it lands when CI is green' : `update failed: ${firstLine(r)}`}`);
  } else if (b === next) {
    held.push(`${b.key}: PR #${b.number} is behind main and next to be updated (--dry-run)`);
  } else if (b.live) {
    held.push(`${b.key}: PR #${b.number} is behind main and its worktree has uncommitted or recent work`);
  } else if (b.reasons.every(r => r.startsWith('pending:'))) {
    held.push(`${b.key}: PR #${b.number} is behind main and waits its turn behind PR #${next?.number}`);
  } else {
    held.push(`${b.key}: PR #${b.number} is behind main, not updated until it is otherwise ready — ${b.reasons.join('; ')}`);
  }
}
held.forEach(say);

// 4. Review. In-review stories hold their paths, so an unreviewed PR blocks dispatch silently
// unless it is named.
if (needsReview.length) say(`review needed (spawn the reviewer with orchestration/prompts/reviewer.md): ${needsReview.join(' | ')}`);

// 5. Plan before starting new work, so nothing is dispatched onto a plan about to change.
const plan = node([here('planner-trigger.mjs')]);
const planDue = plan.status === 0;
say(`planner: ${planDue ? 'due —' : 'not due'} ${(plan.stdout || '').trim().replace(/\n/g, ' ')}`.trim());

// 6. Dispatch. Headless dispatch needs the Cursor CLI; without it the in-app orchestrator is the
// dispatcher, so name the keys rather than pretending to start them.
const ready = JSON.parse(node([here('ready.mjs')]).stdout || '{"ready":[],"lanesFree":0,"inProgress":[]}');
const hasCli = ok(sh('sh', ['-c', 'command -v cursor-agent']));
const keys = ready.ready.map(r => r.key).join(' ');
if (ready.ready.length && planDue) {
  say(`ready but not dispatched until the planner has run: ${keys}`);
} else if (ready.ready.length && hasCli && !DRY) {
  say(`dispatching ${keys} headlessly`);
  node([here('dispatch.mjs'), ...ready.ready.map(r => r.key)]);
} else if (ready.ready.length) {
  const laneNote = ready.lanes === 'uncapped' || ready.lanesFree == null ? 'uncapped lanes' : `${ready.lanesFree} free lane(s)`;
  say(`dispatch ${ready.ready.length} story(ies) into ${laneNote}: ${keys}` + (hasCli ? '' : ' (cursor-agent absent: dispatch as in-app implementor subagents)'));
} else {
  say(`no story ready; ${ready.inProgress.length} in progress (${ready.inProgress.join(', ') || 'none'})`);
}

// 7. The report. Overwritten every cycle; the durable record is the PRs and Jira.
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
