// One orchestrator cycle, safe to run repeatedly. The order matters and is the point of the file:
//   1. sync     — fetch, fast-forward the orchestrator's main, make Jira agree with the board
//   2. land     — merge what is provably finished, pinned to the head that was evaluated
//   3. refresh  — bring at most one BEHIND PR up to date, unless models.mergeQueue is on
//   4. review   — name every PR waiting on a reviewer, since in_review stories hold their paths
//   5. plan     — ask whether the planner is due; only 'never planned' or an unread escalation
//                 holds dispatch — a cadence reason (merge count, weekly age, ops-majority) names
//                 the planner as due without stalling the fleet for however long it takes to run
//                 (MARXY-200)
//   6. reap     — return in_progress stories whose worker is gone (MARXY-208)
//   7. dispatch — name (or start) what is ready; started work runs detached and outlives this cycle
//   8. report   — status.md, and the Cursor canvases when that directory exists
// Only one cycle runs at a time: results/cycle.lock holds a lease, and a lock whose holder died is
// taken over rather than obeyed (MARXY-208).
// Everything a machine can decide, it decides; everything else it names.
// usage: node orchestration/cycle.mjs [--no-merge] [--dry-run] [--low|--minimal|--high|--compute=NAME]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, readJson, stories, state, updateState, models } from './lib.mjs';
import { boardDrift, gatherBoardCheckInput, boardTotals, BLOCKS_DISPATCH } from './board-check.mjs';
import { verify } from './approve.mjs';
import { evaluate, mergeArgs, chooseUpdate, worktreeLive as worktreeIsLive } from './merge-bar.mjs';
import { computeOrder, readPullRequest } from './review-order.mjs';
import { allowedFor, fileAllowed } from './review.mjs';
import { runWorktreePrune, parseWorktreeList } from './worktrees.mjs';
import { loadSnapshot, prime } from './github.mjs';
import { adoptions, applyAdoption, settlements, keyOfPr } from './adopt.mjs';
import { BOARD_FILES, reviewBoundary } from '../scripts/lib/own-row.mjs';
import { plannerReasons, blocksDispatch } from './planner-trigger.mjs';
import { acquireLock, releaseLock, CYCLE_LOCK } from './lease.mjs';
import { runReap } from './reap.mjs';
import { defaultCanvasDir, gatherCanvasData, writeCanvases } from './canvases.mjs';

/** A landed PR's own files self-record as the planner's output when they touch a plan delta. */
export const landsPlanDelta = files => (files ?? []).some(f => f.startsWith('docs/plan/deltas/'));

/** Which state.mjs verb finishes a landed PR from its merged file list (MARXY-200 AC1). */
export function mergeLandingVerb(files) {
  return landsPlanDelta(files) ? 'plan-landed' : 'done';
}

/** Whether step 6 must wait on the planner before starting ready stories (MARXY-200 AC3). */
export function holdsReadyDispatch({ boardHold, planDue }) {
  return Boolean(boardHold || planDue);
}

/** Whether step 5 should spawn plan-dispatch.mjs headlessly (MARXY-200 AC4). */
export function shouldSpawnHeadlessPlanner({ planDueAny, hasCli, dry }) {
  return Boolean(planDueAny && hasCli && !dry);
}

/** Apply the landing stamp the cycle uses after a merge (MARXY-200 AC1). */
export function recordMergeLanding(key, files, node) {
  node([here('state.mjs'), mergeLandingVerb(files), key]);
}

/** Hold-reason fragments cycle.mjs can print. The before-list is a fixture; this must stay a superset. */
export const HOLD_REASON_STRINGS = [
  'could not be read',
  'is behind main but',
  'the implementor merges it',
  'was behind main —',
  'updated; CI is re-running',
  'update failed:',
  'auto-merge cancelled —',
  'held —',
  'waiting on CI and would auto-merge',
  'mergeable and clean',
  '(not merging:',
  'auto-merge failed —',
  'merge failed —',
  'behind main; waiting its turn in the review order (position ',
  'merge queue tests it on top of those ahead',
  'the branch is not updated',
];

export function waitingTurn(position) {
  return `behind main; waiting its turn in the review order (position ${position})`;
}

function pathsFromView(pr) {
  return (pr.files ?? []).map(f => (typeof f === 'string' ? f : f.path)).filter(Boolean);
}

/**
 * Land, hold, update or return In Review pull requests. `updateBranch` and the board writers
 * are injectable so a fixture board can assert one update and an attempts-unchanged return.
 */
export function processReviewQueue({
  board,
  dry = false,
  noMerge = false,
  viewPr,
  updateBranch,
  order = { order: [], excluded: [] },
  worktreeLive = () => false,
  readResult = () => null,
  writeResultNote = () => {},
  returnDirty = () => {},
  finish = () => {},
  reviewNote = () => '',
  diffFiles = () => [],
  codeOwners = () => null,
  commitMessages = () => '',
  storyOf = () => null,
  // `(key, pr) => reviewBoundary(...)` (scripts/lib/own-row.mjs): the row the PR is judged against,
  // which is its own row as the branch leaves it when it edits no other story's (MARXY-190).
  boundaryOf = null,
  verifyApproval = () => ({ ok: false }),
  mergeUnreviewed = false,
  disableAutoMerge = () => {},
  enableAutoMerge = () => ({ error: 'not wired' }),
  mergeNow = () => ({ error: 'not wired' }),
  removeWorktree = () => {},
  prState = () => '',
  say = () => {},
  mergeQueue = false,
} = {}) {
  const held = [];
  const updates = [];
  const needsReview = [];
  const behind = [];
  const firstBehindKey = (order.order ?? []).find(r => r.behind)?.key ?? null;

  for (const [key, rec] of Object.entries(board)) {
    if (rec.status !== 'in_review' || !rec.pr) continue;
    const pr = viewPr(rec.pr);
    if (!pr) { held.push(`${key}: PR #${rec.pr} could not be read`); continue; }
    if (pr.state === 'MERGED') { finish(key, rec, reviewNote(key), pathsFromView(pr)); continue; }

    if (pr.state === 'OPEN' && pr.mergeStateStatus === 'DIRTY') {
      const files = pathsFromView(pr);
      const note = `returned from review: DIRTY, conflicting files: ${files.join(', ') || '(none named)'}`;
      returnDirty(key, rec, files, note);
      writeResultNote(key, note);
      say(`${key}: PR #${rec.pr} returned — DIRTY, conflicting files: ${files.join(', ') || '(none named)'}`);
      continue;
    }

    const result = readResult(key, rec);
    const boundary = boundaryOf ? boundaryOf(key, pr) : null;
    const story = boundary ? boundary.story : storyOf(key);
    const files = story && pr.headRefName ? diffFiles(pr.headRefName) : [];
    // The same boundary rule the review packet shows the reviewer; a .approved file is never inside
    // a story, even when a listed directory would include it. The board files are inside when the
    // branch edits only its own story; otherwise they name whose rows it touched.
    const allowed = story ? allowedFor(story, key) : [];
    const outside = files
      .filter(f => /\.approved$/.test(f) || !(fileAllowed(f, allowed) || (boundary?.ownOnly && BOARD_FILES.includes(f))))
      .map(f => (boundary && !boundary.ownOnly && BOARD_FILES.includes(f) ? `${f} (edits ${boundary.others.join(', ')})` : f));
    if (boundary?.widened.length && !boundary.added) say(`${key}: PR #${rec.pr} widens its own Paths: ${boundary.widened.join(', ')}`);
    if (!story && boundaryOf) {
      if (pr.autoMergeRequest) disableAutoMerge(rec.pr);
      held.push(`${key}: PR #${rec.pr} held — no board row on main or on its branch, so no boundary check can run; add one there: node orchestration/out-of-plan.mjs row ${key}`);
      continue;
    }
    // A squash merge can carry a commit message onto main, so the trailer has to be blocked here and
    // not only by a local hook that a worktree cut from a branch without `.githooks` never ran.
    const messages = pr.headRefName ? commitMessages(pr.headRefName) : '';
    const trailer = typeof messages === 'string' && /co-authored-by:.*(cursor|claude|gpt|grok|copilot|anthropic|openai)|generated with/i.test(messages);
    const approval = verifyApproval(key, pr.headRefOid);
    if (!approval.ok) needsReview.push(`${key} (PR #${rec.pr}): ${approval.why ?? 'not reviewed (no results/KEY.approved)'}`);
    const decision = evaluate({
      pr,
      files,
      outside,
      result,
      attribution: trailer,
      approval,
      mergeUnreviewed,
      codeowners: codeOwners(),
    });

    // A branch cut before main moved was tested against a main that no longer exists. Refresh it and
    // let the next cycle read the honest result rather than merging on a stale green.
    // Never while an implementor is in the worktree: updating the branch ref under a working tree it
    // has checked out made one agent stage a revert of somebody else's merge.
    if (pr.state === 'OPEN' && pr.mergeStateStatus === 'BEHIND' && worktreeLive(rec)) {
      held.push(`${key}: PR #${rec.pr} is behind main but ${rec.worktree} is still checked out; the implementor merges it`);
      continue;
    }
    if (pr.state === 'OPEN' && pr.mergeStateStatus === 'BEHIND') {
      behind.push({
        key,
        number: rec.pr,
        reasons: decision.reasons,
        live: false,
        position: (order.order ?? []).findIndex(r => r.key === key) + 1,
      });
      continue;
    }

    if (decision.action === 'hold') {
      // Auto-merge is a decision taken now and executed later, on information that may have changed by
      // then. MARXY-63 landed that way: a cycle queued it while its checks ran, its approval was
      // withdrawn before they finished, and GitHub merged it regardless. A standing instruction that no
      // longer describes our judgement has to be cancelled, not merely left unrenewed.
      if (pr.autoMergeRequest) { disableAutoMerge(rec.pr); say(`${key}: auto-merge cancelled — ${decision.reasons[0]}`); }
      held.push(`${key}: PR #${rec.pr} held — ${decision.reasons.join('; ')}`);
      continue;
    }
    if (noMerge || dry) { held.push(`${key}: PR #${rec.pr} is ${decision.action === 'auto-merge' ? 'waiting on CI and would auto-merge' : 'mergeable and clean'} (not merging: ${noMerge ? '--no-merge' : '--dry-run'})`); continue; }
    if (decision.action === 'auto-merge') {
      const queued = enableAutoMerge(rec.pr, pr.headRefOid);
      if (typeof queued === 'string') say(`auto-merge enabled ${key} (PR #${rec.pr}) — waiting on CI`);
      else held.push(`${key}: auto-merge failed — ${queued.error.split('\n')[0]}`);
      continue;
    }
    // The worktree goes first: while it exists it holds the branch checked out, and gh reports the
    // whole merge as failed when only the branch deletion did.
    if (worktreeLive(rec)) {
      held.push(`${key}: PR #${rec.pr} is mergeable but ${rec.worktree} has uncommitted or recent work`);
      continue;
    }
    if (rec.worktree) removeWorktree(rec, pr.headRefName);
    const merged = mergeNow(rec.pr, pr.headRefOid);
    const landed = typeof merged === 'string' || prState(rec.pr) === 'MERGED';
    if (!landed) { held.push(`${key}: merge failed — ${merged.error.split('\n')[0]}`); continue; }
    if (decision.approval?.note) say(`${key}: ${decision.approval.note}`);
    finish(key, rec, reviewNote(key), files);
  }

  // One refresh: prefer the oldest PR that would otherwise land (chooseUpdate). When every BEHIND
  // PR has a hard hold — the fixture-board case — fall back to the first review-order entry so a
  // conflicted or unreviewed queue still moves (ADR-0025). The merge queue is the other path:
  // GitHub tests each PR on top of those ahead, so no branch is ever updated.
  const picked = chooseUpdate(behind, { queue: mergeQueue });
  const updateKey = mergeQueue ? null : (picked?.key ?? (behind.some(b => b.key === firstBehindKey) ? firstBehindKey : null));
  for (const b of behind) {
    if (mergeQueue) {
      held.push(`${b.key}: PR #${b.number} is behind main — merge queue tests it on top of those ahead; the branch is not updated`);
    } else if (b.key === updateKey && !dry) {
      const r = updateBranch(b.number);
      updates.push(b.number);
      held.push(`${b.key}: PR #${b.number} was behind main — ${typeof r === 'string' ? 'updated; CI is re-running' : `update failed: ${r.error.split('\n')[0]}`}`);
    } else if (b.key === updateKey) {
      held.push(`${b.key}: PR #${b.number} was behind main — updated; CI is re-running`);
    } else {
      held.push(`${b.key}: PR #${b.number} ${waitingTurn(b.position || '?')}`);
    }
  }
  return { held, updates, needsReview };
}

function runCycle(argv = process.argv.slice(2)) {
  const lock = acquireLock(CYCLE_LOCK, { match: 'cycle.mjs' });
  if (!lock.ok) {
    console.log(`cycle: another cycle holds ${CYCLE_LOCK} (pid ${lock.holder?.pid} since ${lock.holder?.started}); not running a second one`);
    return;
  }
  if (lock.tookOver) console.log(`cycle: took over the lock of a cycle that died (pid ${lock.tookOver.pid} since ${lock.tookOver.started})`);
  try {
    runLockedCycle(argv);
  } finally {
    releaseLock(CYCLE_LOCK);
  }
}

function runLockedCycle(argv) {
  const NO_MERGE = argv.includes('--no-merge'), DRY = argv.includes('--dry-run');
  const m = models();
  process.env.MARXY_COMPUTE = m.compute;
  const log = [];
  const say = line => { console.log(line); log.push(line); };
  say(`compute: ${m.compute} — orchestrator ${m.orchestrator.model} ${m.orchestrator.effort}; implementor ${m.implementor.model} ${m.implementor.effort}`);
  const sh = (cmd, a, opts = {}) => { try { return execFileSync(cmd, a, { cwd: ROOT, encoding: 'utf8', ...opts }).trim(); } catch (e) { return { error: (e.stdout ?? '') + (e.stderr ?? e.message) }; } };
  const gh = a => { const r = sh('gh', a); return typeof r === 'string' ? r : null; };
  const node = a => spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8' });
  // 1. Sync. Every diff below is against origin/main, and ready.mjs reads the board from this
  // checkout, so both have to describe the main that exists now.
  sh('git', ['fetch', '-q', 'origin']);
  if (sh('git', ['branch', '--show-current']) === 'main' && !DRY) {
    const ff = sh('git', ['merge', '--ff-only', '-q', 'origin/main']);
    if (typeof ff !== 'string') say(`main: could not fast-forward to origin/main; the board below may be stale`);
  }
  // --dry-run means nothing outside this process changes, Jira included: push plans its moves and
  // makes none (MARXY-191). A dry cycle from a checkout with a stale state.json used to move real issues.
  const push = node([here('jira.mjs'), 'push', ...(DRY ? ['--dry-run'] : [])]);
  say(`jira: ${(push.stdout || push.stderr || '').trim().split('\n').pop() || 'unavailable'}`);

  // Board drift (MARXY-117). origin/main is the board of record and ready.mjs reads this
  // checkout, so a checkout behind it, off main, or carrying uncommitted edits under docs/plan
  // or orchestration must never seed dispatch: on 2026-09-19 exactly that state (14 commits
  // behind, uncommitted CSV/deps.json edits) dispatched from a board that lacked #71's ops lane.
  // One read of GitHub for the whole cycle (MARXY-191): board-check, the review queue, the review
  // order and the worktree prune all read this, and fall back to a single call per PR only for a PR
  // it does not hold (one merged or closed since).
  let snapshot = null;
  try { snapshot = loadSnapshot(); prime(snapshot); } catch (e) { say(`github: snapshot failed, reading PR by PR — ${String(e.message ?? e).split('\n')[0]}`); }
  const git = a => { const r = sh('git', a); return typeof r === 'string' ? r : null; };
  const headText = (branch, file) => git(['show', `origin/${branch}:${file}`]);
  const mainText = file => git(['show', `origin/main:${file}`]);
  const worktrees = parseWorktreeList(git(['worktree', 'list', '--porcelain']) ?? '');
  const worktreeOf = branch => worktrees.find(w => w.branch === branch)?.path ?? null;

  // Adoption (MARXY-190). Any open PR naming a key the board does not have In Review becomes In
  // Review here, so out-of-plan work and a PR opened without `state.mjs review` both reach the merge
  // bar instead of waiting for a person to merge them by hand.
  if (snapshot) {
    const mainKeys = new Set(stories().map(x => x.Key));
    const phaseIn = text => { try { const d = JSON.parse(text ?? ''); return key => Object.entries(d.phases ?? {}).find(([, ks]) => ks.includes(key))?.[0] ?? null; } catch { return () => null; } };
    const mainPhase = phaseIn(mainText('orchestration/deps.json'));
    const { adopt, skipped } = adoptions({
      openPrs: snapshot.open,
      stories: state().stories,
      mainKeys,
      phaseOf: (key, pr) => mainPhase(key) ?? phaseIn(headText(pr.headRefName, 'orchestration/deps.json'))(key),
    });
    for (const x of skipped) if (x.why !== 'draft') say(`adopt: skipped PR #${x.pr} — ${x.why}`);
    if (adopt.length && !DRY) {
      updateState(board => { for (const a of adopt) applyAdoption(board, a); });
    }
    for (const a of adopt) {
      say(`adopt${DRY ? ' (dry-run, not written)' : ''}: ${a.key} PR #${a.pr} → in_review${a.onMain ? '' : ` (out-of-plan, ${a.phase} lane, row on its branch)`}`);
      if (!DRY) node([here('jira.mjs'), 'pr', a.key, String(a.pr)]);
    }
    // A row that brought its own PR is Done once that PR merged, however it merged (MARXY-190).
    for (const key of settlements({ rows: stories(), stories: state().stories, recentPrs: snapshot.recent ?? [] })) {
      // Settled outside the review queue (merged by hand, or before adoption saw it), so `files`
      // was never read for it; one extra call names whether it was a plan landing too (MARXY-200).
      const prNum = (snapshot.recent ?? []).find(pr => keyOfPr(pr) === key)?.number;
      const settleFiles = prNum ? (gh(['pr', 'view', String(prNum), '--json', 'files', '-q', '.files[].path']) ?? '').split('\n').filter(Boolean) : [];
      const planLanding = landsPlanDelta(settleFiles);
      say(`settle${DRY ? ' (dry-run, not written)' : ''}: ${key} — its PR merged; recording it done${planLanding ? ' (plan landed)' : ''}`);
      if (!DRY) node([here('state.mjs'), planLanding ? 'plan-landed' : 'done', key]);
    }
  }

  const boardFindings = boardDrift(gatherBoardCheckInput({ snapshot }));
  for (const f of boardFindings) say(`board: ${f.kind} — ${f.detail}`);
  const boardHold = boardFindings.some(f => BLOCKS_DISPATCH.includes(f.kind));

  // 2. Land what is finished. A PR merges only when every one of these holds, and the reason it
  // did not is printed, because an unexplained unmerged PR is how a fleet quietly stalls.
  const s = state();
  let order = { order: [], excluded: [] };
  try {
    order = computeOrder({ readPr: readPullRequest });
  } catch (e) {
    say(`review-order: ${e.message}`);
  }

  const { held, needsReview } = processReviewQueue({
    board: s.stories,
    dry: DRY,
    noMerge: NO_MERGE,
    viewPr: pr => {
      const cached = snapshot?.byNumber.get(Number(pr));
      if (cached) return cached;
      const view = gh(['pr', 'view', String(pr), '--json', 'state,mergeable,mergeStateStatus,reviewDecision,latestReviews,statusCheckRollup,headRefName,headRefOid,autoMergeRequest,files']);
      return view ? JSON.parse(view) : null;
    },
    mergeQueue: Boolean(m.mergeQueue),
    updateBranch: pr => sh('gh', ['pr', 'update-branch', String(pr)]),
    order,
    worktreeLive: rec => {
      if (!rec.worktree) return false;
      const wt = resolve(ROOT, rec.worktree);
      if (!existsSync(wt)) return false;
      const index = sh('git', ['-C', wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index']);
      let lastActivityMs = null;
      try { if (typeof index === 'string') lastActivityMs = statSync(index).mtimeMs; } catch { /* no index yet */ }
      const status = sh('git', ['--no-optional-locks', '-C', wt, 'status', '--porcelain']);
      return worktreeIsLive({
        exists: true,
        dirty: typeof status !== 'string' || status.length > 0,
        lastActivityMs,
        windowMinutes: m.attemptMinutes,
      });
    },
    // The result file lives where `pnpm done` ran: this checkout for a dispatched story, the branch's
    // own worktree for work a person or another session did (MARXY-190).
    readResult: (key, rec) => {
      const candidates = [here(`results/${key}.json`)];
      const wt = rec?.branch ? worktreeOf(rec.branch) : null;
      if (wt) candidates.push(resolve(wt, `orchestration/results/${key}.json`));
      const found = candidates.find(p => existsSync(p));
      return found ? readJson(found) : null;
    },
    writeResultNote: (key, note) => {
      const path = here(`results/${key}.json`);
      const result = existsSync(path) ? readJson(path) : { key, notes: '' };
      result.notes = result.notes ? `${result.notes}\n${note}` : note;
      writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
    },
    returnDirty: (key, rec) => {
      updateState(board => {
        const cur = board.stories[key] ?? rec;
        cur.status = 'in_progress';
        board.stories[key] = cur;
      });
      node([here('jira.mjs'), 'move', key, 'in_progress']);
    },
    finish: (key, rec, note, files) => {
      say(`merged ${key} (PR #${rec.pr})`);
      recordMergeLanding(key, files, node);
      if (landsPlanDelta(files)) say(`planner: ${key} landed a plan delta — recorded planned, excluded from the ops window`);
      if (note) node([here('jira.mjs'), 'comment', key, `Merged as PR #${rec.pr}. Review that allowed it:\n\n${note}`]);
    },
    reviewNote: key => (existsSync(here(`results/${key}.approved`)) ? readFileSync(here(`results/${key}.approved`), 'utf8').trim() : ''),
    diffFiles: headRefName => {
      const r = sh('git', ['diff', '--name-only', `origin/main...origin/${headRefName}`]);
      return typeof r === 'string' ? r.split('\n').filter(Boolean) : [];
    },
    // The base branch's file is the one GitHub applies; a PR cannot rewrite its own reviewers.
    // null when unreadable, so the merge bar holds instead of treating the repo as unowned.
    codeOwners: () => { const r = sh('git', ['show', 'origin/main:.github/CODEOWNERS']); return typeof r === 'string' ? r : null; },
    commitMessages: headRefName => sh('git', ['log', `origin/main..origin/${headRefName}`, '--format=%B']),
    storyOf: key => stories().find(x => x.Key === key),
    boundaryOf: (key, pr) => reviewBoundary(key, {
      baseCsv: mainText(BOARD_FILES[0]) ?? '', headCsv: headText(pr.headRefName, BOARD_FILES[0]) ?? '',
      baseDeps: mainText(BOARD_FILES[1]) ?? '{}', headDeps: headText(pr.headRefName, BOARD_FILES[1]) ?? '{}',
    }),
    verifyApproval: (key, head) => verify(here(`results/${key}.approved`), head),
    mergeUnreviewed: process.env.MARXY_MERGE_UNREVIEWED === '1',
    disableAutoMerge: pr => { sh('gh', ['pr', 'merge', String(pr), '--disable-auto']); },
    enableAutoMerge: (pr, head) => { try { return sh('gh', mergeArgs(pr, head, { auto: true, queue: m.mergeQueue })); } catch (e) { return { error: e.message }; } },
    mergeNow: (pr, head) => { try { return sh('gh', mergeArgs(pr, head, { queue: m.mergeQueue })); } catch (e) { return { error: e.message }; } },
    removeWorktree: (rec, headRefName) => { sh('git', ['worktree', 'remove', '--force', rec.worktree]); sh('git', ['branch', '-D', headRefName]); },
    prState: pr => gh(['pr', 'view', String(pr), '--json', 'state', '-q', '.state']) ?? '',
    say,
  });
  held.forEach(say);

  // 2b. Drop story worktrees whose PR already landed elsewhere, and name strays we keep.
  runWorktreePrune({ dryRun: DRY, root: ROOT, say, ...(snapshot ? { branchState: snapshot.branchState } : {}) });

  // 3. Review. In-review stories hold their paths, so an unreviewed PR blocks dispatch silently
  // unless it is named.
  if (needsReview.length) say(`review needed (spawn the reviewer with orchestration/prompts/reviewer.md): ${needsReview.join(' | ')}`);

  // 3b. Reap. A story whose worker is gone holds its paths until something returns it, and nothing
  // but this does (MARXY-208). Before ready.mjs, so what it frees can start this cycle.
  const inflight = runReap({ apply: !DRY, say, m, jira: (key, to) => node([here('jira.mjs'), 'move', key, to]) });

  // 4. Plan before starting new work onto a plan about to change — but only for a reason that
  // means the plan is missing or wrong ('never planned', an unread escalation), not merely due
  // for a refresh. A cadence reason (merge count, weekly age, ops-majority) names the planner as
  // due without freezing the fleet for however long that run takes: MARXY-197 sat blocked for
  // hours on exactly that (MARXY-200). Spawned for its own reporting (kept in sync with
  // plannerReasons by construction); planDue itself is decided from the pure function so a
  // landed plan delta earlier in *this* cycle (see finish/settle above) is reflected immediately.
  const plan = node([here('planner-trigger.mjs')]);
  const reasons = plannerReasons();
  const planDueAny = plan.status === 0;
  const planDue = blocksDispatch(reasons);
  const advisoryOnly = planDueAny && !planDue;
  const hasCli = typeof sh('sh', ['-c', 'command -v cursor-agent']) === 'string';
  say(`planner: ${planDueAny ? 'due —' : 'not due'} ${(plan.stdout || '').trim().replace(/\n/g, ' ')}`.trim()
    + (advisoryOnly ? ' (advisory only — dispatch continues; run the planner when you can)' : ''));

  if (shouldSpawnHeadlessPlanner({ planDueAny, hasCli, dry: DRY })) {
    const started = node([here('plan-dispatch.mjs')]);
    say((started.stdout || started.stderr || 'planner: no output').trim().split('\n').pop());
  }

  // 5. What should start next. Headless dispatch needs the Cursor CLI; without it the in-app
  // orchestrator is the dispatcher, so name the keys rather than pretending to start them.
  const ready = JSON.parse(node([here('ready.mjs')]).stdout || '{"ready":[],"lanesFree":0,"inProgress":[]}');
  const keys = ready.ready.map(r => r.key).join(' ');
  if (ready.ready.length && holdsReadyDispatch({ boardHold, planDue })) {
    if (boardHold) say(`ready but not dispatched — board drift holds it (see "board:" lines above): ${keys}`);
    else say(`ready but not dispatched until the planner has run: ${keys}`);
  } else if (ready.ready.length && hasCli && !DRY) {
    // Returns once each worker is started and its claim written; the attempts run detached.
    say(`dispatching ${keys} headlessly`);
    const d = node([here('dispatch.mjs'), ...ready.ready.map(r => r.key)]);
    for (const line of `${d.stdout ?? ''}${d.stderr ?? ''}`.trim().split('\n').filter(Boolean)) say(line);
  } else if (ready.ready.length) {
    const laneNote = ready.lanes === 'uncapped' || ready.lanesFree == null ? 'uncapped lanes' : `${ready.lanesFree} free lane(s)`;
    say(`dispatch ${ready.ready.length} story(ies) into ${laneNote}: ${keys}` + (hasCli ? '' : ' (cursor-agent absent: dispatch as in-app implementor subagents)'));
  } else {
    const wip = ready.blockedByReviewWip;
    const wipNote = wip ? `; review WIP ${wip.count}/${wip.cap}` : '';
    say(`no story ready; ${ready.inProgress.length} in progress (${ready.inProgress.join(', ') || 'none'})${wipNote}`);
  }

  // 6. The report. Overwritten every cycle; the durable record is the PRs and Jira.
  // Every CSV story is on the board, not only the ones state.json happened to be seeded with: a row
  // added after the seed used to appear under no heading while ready.mjs treated it as todo.
  const reportBoard = { ...Object.fromEntries(stories().map(x => [x.Key, { status: 'todo' }])), ...state().stories };
  const { byStatus, orphans } = boardTotals(reportBoard);
  const human = existsSync(here('needs-human.md')) ? readFileSync(here('needs-human.md'), 'utf8').split('\n').filter(l => l.startsWith('- [ ]')).length : 0;
  writeFileSync(here('status.md'), `# Status — ${new Date().toISOString()}

Written by \`orchestration/cycle.mjs\`. Compute mode **${m.compute}**. ${human} open item(s) in \`needs-human.md\`.

## Board

${Object.entries(byStatus).map(([k, v]) => `- **${k}** (${v.length}): ${v.join(', ')}`).join('\n')}${orphans.length ? `\n- **not on the board, in no total** (${orphans.length}): ${orphans.join(', ')}` : ''}

## In flight

${inflight.length ? inflight.map(r => `- **${r.key}** ${r.to ? `${r.verdict} → ${r.to}` : r.verdict} — ${r.why}`).join('\n') : '- nothing in progress'}

## This cycle

${log.map(l => `- ${l}`).join('\n')}
`);
  say(`status written; ${human} open item(s) for a human`);

  // The Cursor canvases are the orchestrator's dashboards; they follow the board every cycle rather
  // than whenever someone remembers to refresh them. Best effort: a canvas is never worth a cycle.
  const canvases = defaultCanvasDir();
  if (!DRY && existsSync(canvases)) {
    try {
      writeCanvases(gatherCanvasData({ health: { inflight: inflight.map(({ rec, ...r }) => r), cycleLog: log } }), canvases);
    } catch (e) {
      console.log(`canvases: not refreshed — ${String(e.message ?? e).split('\n')[0]}`);
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) runCycle();
