// One reconcile cycle (ADR-0034). Level-triggered and idempotent: each cycle reads the whole world,
// compares it with the board (a fold of the event log), and takes the next step for every story that
// has one. Missing a cycle loses nothing, because the next one sees the same level and acts on it.
//
//   1. observe  — fetch; the plan on origin/main; the board; one GitHub snapshot; runs; worktrees
//   2. runs     — every run that ended (or outlived its deadline) is finished: what it meant is
//                 decided in runs.mjs, and its story moves on
//   3. PRs      — merged PRs settle Done; open PRs naming a key the board does not have in review are
//                 adopted; claims past their expiry lapse
//   4. review   — each In Review PR takes exactly one step: resolve a conflict, return it to its
//                 implementor, start a reviewer, update the branch at the head of the order, enable
//                 auto-merge, merge, or wait — and a wait older than its limit is named under
//                 "Needs you" instead of holding silently
//   5. plan     — start the planner when it is due, off cooldown and not already running
//   6. dispatch — start an implementor for every ready story
//   7. mirror   — Jira follows the board (best effort, bounded; never blocks)
//   8. report   — status.md, and only what changed to the loop log
//
// Every non-final status has an owner and a way out that fires on its own (machine.mjs STATES). This
// file is the only one that merges, and merge-bar.mjs is the only thing it asks whether it may.
// usage: node orchestration/cycle.mjs [--no-merge] [--dry-run] [--low|--minimal|--high|--compute=NAME]
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { models, laneBudget, hasLabel } from './lib.mjs';
import {
  board as readBoard, commit, story, runEvent, boardEvent, timing, returnEvents,
} from './machine.mjs';
import {
  CODE_ROOT, resultPath, approvalPath, notesPath, runFile, writeJsonAtomic, writeTextAtomic, readJsonOr, cycleLockPath,
} from './store.mjs';
import { planAt, showAt, CSV_PATH, DEPS_PATH } from './plan.mjs';
import { observeWorktrees, observeRuns, pathHolds, fetchOrigin } from './observe.mjs';
import { selectReady } from './ready.mjs';
import { buildSpec, claimEvents, finishRun } from './runs.mjs';
import { gh, read, run as runProc, spawnDetached, killGroup, LIMIT } from './proc.mjs';
import { acquireLock, releaseLock } from './lease.mjs';
import { verify } from './approve.mjs';
import { evaluate, mergeArgs } from './merge-bar.mjs';
import { computeOrder } from './review-order.mjs';
import { allowedFor, fileAllowed, validateResult } from './review.mjs';
import { loadSnapshot, prime, snapshotFrom } from './github.mjs';
import { adoptions, adoptionEvent, keyOfPr, settlements } from './adopt.mjs';
import { runWorktreePrune, inProgressBranches } from './worktrees.mjs';
import { plannerReasons, blocksDispatch } from './planner-trigger.mjs';
import { writeReport } from './report.mjs';
import { defaultCanvasDir, gatherCanvasData, writeCanvases } from './canvases.mjs';
import { BOARD_FILES, reviewBoundary } from '../scripts/lib/own-row.mjs';

/** A landed PR whose files add a plan delta is the planner's own output (MARXY-200). */
export const landsPlanDelta = files => (files ?? []).some(f => f.startsWith('docs/plan/deltas/'));

/**
 * What a merge-bar hold reason is about, which decides who owns the wait:
 *   wait     CI still running, or not started yet            — nobody; attention after a long wait
 *   review   no signed approval for this head                  — a reviewer run
 *   red      a check failed                                   — the implementor, after redGraceMinutes
 *   return   outside its paths, an attribution trailer, no CHANGELOG line — the implementor, now
 *   human    CODEOWNERS, changes requested, no board row        — a person, now
 *   result   no implementor result file                        — a person, after holdAttentionMinutes
 *   other    anything else                                    — a person, after holdAttentionMinutes
 */
const HOLD_CLASSES = [
  [/^pending:|^no checks have run/, 'wait'],
  [/not reviewed|approval is unsigned|the approval is for|signature does not match/, 'review'],
  [/^red:/, 'red'],
  [/files outside the story's paths|attribution trailer|no CHANGELOG entry/, 'return'],
  [/CODEOWNERS|changes requested|no board row/, 'human'],
  [/no implementor result file|result says|result file problems/, 'result'],
];
export const holdClass = reason => HOLD_CLASSES.find(([re]) => re.test(reason))?.[1] ?? 'other';
const PRECEDENCE = ['return', 'red', 'human', 'result', 'other', 'review', 'wait'];

/** The one hold that decides what happens next, and the reason text that goes with it. */
export function primaryHold(reasons) {
  const classed = reasons.map(r => ({ reason: r, class: holdClass(r) }));
  for (const c of PRECEDENCE) {
    const hit = classed.find(x => x.class === c);
    if (hit) return hit;
  }
  return null;
}

/**
 * The single next step for one In Review story whose PR is open. Pure.
 * `decision` is merge-bar's evaluate(); `rec.hold` is the hold this story has been in since when.
 */
export function reviewStep({ rec, pr, decision, t, nowMs, dispatchable, activeRun = null, noRow = false }) {
  if (activeRun) return { step: 'wait', why: `${activeRun.role} run in progress (until ${activeRun.deadline})`, hold: rec.hold ?? null };
  const conflicted = pr.mergeStateStatus === 'DIRTY' || pr.mergeable === 'CONFLICTING';
  if (conflicted) {
    const hold = { class: 'conflict', reason: 'conflicts with main' };
    if ((rec.resolveTries ?? 0) >= t.resolveTries) return { step: 'park', why: `still conflicts with main after ${rec.resolveTries} resolution runs`, hold };
    return { step: 'resolve', why: 'conflicts with main', hold };
  }
  const reasons = noRow
    ? ['no board row on main or on its branch, so no boundary check can run; add one in the branch: node orchestration/out-of-plan.mjs row KEY --paths "…" --acceptance "…"', ...decision.reasons]
    : decision.reasons;
  const primary = primaryHold(reasons);
  const hold = primary ? { class: primary.class, reason: primary.reason } : null;
  const since = rec.hold?.class === hold?.class && rec.hold?.since ? Date.parse(rec.hold.since) : nowMs;
  const ageMin = (nowMs - since) / 60_000;
  const behind = pr.mergeStateStatus === 'BEHIND';
  const giveBack = why => (dispatchable ? { step: 'return', why, hold } : { step: 'attention', why: `${why} (not dispatchable, so a person fixes it)`, hold });

  if (!primary) return behind ? { step: 'update', why: 'behind main, otherwise ready', hold: null } : { step: 'merge', why: 'every clause of the merge bar holds', hold: null };
  switch (primary.class) {
    case 'return': return giveBack(primary.reason);
    case 'red': return ageMin >= t.redGraceMinutes ? giveBack(primary.reason) : { step: 'wait', why: `${primary.reason} (returned after ${t.redGraceMinutes} min if still red)`, hold };
    case 'human': return { step: 'attention', why: primary.reason, hold };
    case 'result':
    case 'other': return ageMin >= t.holdAttentionMinutes ? { step: 'attention', why: primary.reason, hold } : { step: 'wait', why: primary.reason, hold };
    case 'review':
      if ((rec.reviewTries ?? 0) >= t.reviewTries) return { step: 'attention', why: `a reviewer ran ${rec.reviewTries} times without recording a verdict`, hold };
      return { step: 'review', why: primary.reason, hold };
    case 'wait':
    default:
      if (behind && reasons.every(r => holdClass(r) === 'wait')) return { step: 'update', why: 'behind main; CI will rerun on the update', hold };
      if (ageMin >= 4 * t.holdAttentionMinutes) return { step: 'attention', why: `${primary.reason} for ${Math.round(ageMin)} min`, hold };
      if (decision.action === 'auto-merge' && !behind) return { step: pr.autoMergeRequest ? 'wait' : 'auto-merge', why: primary.reason, hold };
      return { step: 'wait', why: primary.reason, hold };
  }
}

/** Whether a story can be sent back to an implementor: it has a plan row that dispatch would take. */
export const dispatchable = row => Boolean(row) && !['no-dispatch', 'human-gated', 'dropped'].some(l => hasLabel(row, l));

/** The last `bytes` of a run's output. */
function tailOf(path, bytes = 4096) {
  if (!existsSync(path)) return '';
  const size = statSync(path).size;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(bytes, size));
    readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
    return buf.toString('utf8');
  } finally { closeSync(fd); }
}

const ATTRIBUTION_RE = /co-authored-by:.*(cursor|claude|gpt|grok|copilot|anthropic|openai)|generated with/i;

/** The world, as the live cycle sees it. A test passes its own. */
export function liveIo({ m, dry = false }) {
  const bin = process.env.CURSOR_AGENT && read('sh', ['-c', 'command -v "$1"', 'sh', process.env.CURSOR_AGENT]) ? process.env.CURSOR_AGENT : 'cursor-agent';
  const gitOut = args => read('git', args, { cwd: CODE_ROOT, timeoutMs: LIMIT.git });
  return {
    bin,
    now: () => new Date(),
    fetch: () => fetchOrigin(),
    plan: () => planAt('origin/main'),
    board: () => readBoard({ write: !dry }),
    snapshot: () => {
      const s = loadSnapshot({ gh: args => { const r = gh(args, { cwd: CODE_ROOT }); if (!r.ok) throw new Error(r.err); return r.out; } });
      prime(s);
      return s;
    },
    runs: b => observeRuns(b),
    worktrees: () => observeWorktrees(),
    hasCli: () => Boolean(read('sh', ['-c', 'command -v "$1"', 'sh', bin])),
    result: (key, sinceIso) => {
      const p = resultPath(key);
      if (!existsSync(p) || (sinceIso && statSync(p).mtimeMs < Date.parse(sinceIso) - 5_000)) return null;
      return readJsonOr(p);
    },
    logTail: id => tailOf(runFile(id, 'out.log')),
    prFacts: (key, pr, plan) => {
      const branch = pr.headRefName;
      const boundary = reviewBoundary(key, {
        baseCsv: showAt('origin/main', CSV_PATH) ?? '', headCsv: showAt(`origin/${branch}`, CSV_PATH) ?? '',
        baseDeps: showAt('origin/main', DEPS_PATH) ?? '{}', headDeps: showAt(`origin/${branch}`, DEPS_PATH) ?? '{}',
      });
      const row = boundary?.story ?? plan.byKey.get(key) ?? null;
      const diff = gitOut(['diff', '--name-only', `origin/main...origin/${branch}`]);
      const files = diff ? diff.split('\n').filter(Boolean) : [];
      const allowed = row ? allowedFor(row, key) : [];
      const outside = files
        .filter(f => /\.approved$/.test(f) || !(fileAllowed(f, allowed) || (boundary?.ownOnly && BOARD_FILES.includes(f))))
        .map(f => (boundary && !boundary.ownOnly && BOARD_FILES.includes(f) ? `${f} (edits ${boundary.others.join(', ')})` : f));
      const messages = gitOut(['log', `origin/main..origin/${branch}`, '--format=%B']) ?? '';
      const result = readJsonOr(resultPath(key));
      return {
        row, files, outside, boundary,
        attribution: ATTRIBUTION_RE.test(messages),
        approval: verify(approvalPath(key), pr.headRefOid, { fetch: false }),
        codeowners: showAt('origin/main', '.github/CODEOWNERS'),
        result,
        resultProblems: result ? validateResult(result) : [],
      };
    },
    prFiles: n => (read('gh', ['pr', 'view', String(n), '--json', 'files', '-q', '.files[].path'], { cwd: CODE_ROOT, timeoutMs: LIMIT.gh }) ?? '').split('\n').filter(Boolean),
    prState: n => read('gh', ['pr', 'view', String(n), '--json', 'state', '-q', '.state'], { cwd: CODE_ROOT, timeoutMs: LIMIT.gh }) ?? '',
    gh: args => gh(args, { cwd: CODE_ROOT }),
    commit: events => commit(events),
    writeSpec: spec => writeJsonAtomic(runFile(spec.id, 'run.json'), spec),
    writeExit: (id, record) => writeJsonAtomic(runFile(id, 'exit.json'), { ...record, endedAt: new Date().toISOString() }),
    spawnWorker: id => spawnDetached(process.execPath, [`${CODE_ROOT}orchestration/worker.mjs`, '--run', id], {
      cwd: CODE_ROOT, log: runFile(id, 'worker.log'), env: { ...process.env, MARXY_COMPUTE: m.compute },
    }),
    stopRun: (id, run) => {
      const agent = readJsonOr(runFile(id, 'agent.json'));
      if (agent?.pid) killGroup(agent.pid, 'SIGTERM');
      if (run?.pid) killGroup(run.pid, 'SIGTERM');
    },
    writeNotes: (key, text) => {
      const p = notesPath(key);
      const prior = existsSync(p) ? readFileSync(p, 'utf8').trimEnd() + '\n\n' : '';
      writeTextAtomic(p, `${prior}${text.trim()}\n`);
    },
    jira: args => runProc(process.execPath, [`${CODE_ROOT}orchestration/jira.mjs`, ...args], { cwd: CODE_ROOT, timeoutMs: LIMIT.jira }),
    prune: (snap, b) => runWorktreePrune({
      root: CODE_ROOT, branchState: snap.branchState, activeBranches: inProgressBranches(b), say: () => {},
    }).remove.map(e => `worktree removed ${e.path} — ${e.reason}`),
    report: r => {
      const out = writeReport(r);
      // The Cursor canvases follow the board when that project folder exists. Best effort: a canvas
      // is never worth a cycle.
      const dir = defaultCanvasDir();
      if (!r.dry && existsSync(dir)) {
        try { writeCanvases(gatherCanvasData({ board: r.board, health: { cycleLog: r.lines } }), dir); } catch { /* next cycle */ }
      }
      return out;
    },
  };
}

/**
 * One cycle against `io`. Returns the report it wrote. Every decision below is level-triggered: it
 * depends on the board and the world as they are now, never on having seen an earlier event.
 */
export function reconcile({ io, m = models(), dry = false, noMerge = false }) {
  const t = timing(m);
  const now = io.now();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const lines = [];
  const attention = [];
  const jiraCalls = [];
  const say = l => lines.push(l);
  const need = (key, why, extra = {}) => attention.push({ key, why, ...extra });
  const commitAll = events => (dry ? events : io.commit(events));
  // One bad story, run or API answer must never stop the cycle: that is how the old loop stalled every
  // two minutes. A failed step is logged, named under "Needs you", and retried next cycle.
  const guard = (label, key, fn) => {
    try { return fn(); } catch (e) {
      const msg = String(e?.message ?? e).split('\n')[0];
      say(`${label}${key ? ` (${key})` : ''} failed: ${msg}`);
      need(key ?? 'fleet', `the cycle's ${label} step failed${key ? ` for ${key}` : ''}: ${msg} — retried every cycle; everything else carries on`);
      return undefined;
    }
  };

  // 1. Observe.
  const fetchErr = io.fetch();
  if (fetchErr) say(fetchErr);
  let plan = null;
  try { plan = io.plan(); } catch (e) { say(`plan: ${e.message}; nothing is dispatched this cycle`); }
  let b = io.board();
  let snap = null;
  try { snap = io.snapshot(); } catch (e) { say(`github: ${String(e.message ?? e).split('\n')[0]}; PR steps skipped this cycle`); }
  const hasCli = io.hasCli();
  const worktrees = io.worktrees();
  const wtOf = key => worktrees.find(w => w.key === key) ?? null;
  const openByNumber = snap?.byNumber ?? new Map();
  const openForKey = key => (snap?.open ?? []).find(pr => !pr.isDraft && keyOfPr(pr) === key) ?? null;

  // 2. Finish runs.
  const runObs = io.runs(b);
  for (const [id, obs] of Object.entries(runObs)) guard('finish run', b.runs[id]?.key ?? id, () => {
    const run = b.runs[id];
    const overdue = obs.alive && nowMs > Date.parse(run.deadline) + t.runGraceMinutes * 60_000;
    // A run whose story no longer names it (a person parked or returned it) has nothing left to do.
    const orphaned = obs.alive && run.key && run.role !== 'plan' && b.stories[run.key]?.run !== id;
    if (obs.alive && !overdue && !orphaned) return;
    if (!dry) io.stopRun(id, run);
    const rec = run.key ? b.stories[run.key] : null;
    const result = run.role === 'implement' ? io.result(run.key, run.started) : null;
    const wt = run.key ? wtOf(run.key) : null;
    const out = finishRun({
      id, run, obs, rec, result, t, now: nowIso,
      prOpen: run.role === 'implement' ? openForKey(run.key) : null,
      evidence: { ahead: wt?.ahead ?? 0, dirty: wt?.dirty ?? false },
      logTail: io.logTail(id),
    });
    commitAll(out.events);
    out.lines.forEach(say);
    out.attention.forEach(a => need(a.key, a.why));
    if (out.events.some(e => e.to === 'in_review')) jiraCalls.push(['pr', run.key, String(out.events.find(e => e.to === 'in_review').set.pr)]);
  });
  b = io.board();

  // 3. Settle merged PRs, adopt open ones, lapse claims.
  if (snap) guard('settle and adopt', null, () => {
    const recent = snap.recent ?? [];
    const mergedNumbers = new Set(recent.filter(p => p.state === 'MERGED').map(p => p.number));
    const closedNumbers = new Set(recent.filter(p => p.state === 'CLOSED').map(p => p.number));
    const settle = [];
    for (const [key, rec] of Object.entries(b.stories)) {
      if (rec.status === 'done' || !(Number(rec.pr) > 0)) continue;
      if (mergedNumbers.has(Number(rec.pr))) settle.push({ key, pr: Number(rec.pr) });
      else if (rec.status === 'in_review' && closedNumbers.has(Number(rec.pr)) && !openByNumber.has(Number(rec.pr))) {
        commitAll([story(key, { from: 'in_review', to: 'todo', unset: ['pr', 'hold', 'run'], why: `PR #${rec.pr} was closed without merging` })]);
        need(key, `PR #${rec.pr} was closed without merging; the story is todo again`);
      }
    }
    for (const key of plan ? settlements({ rows: plan.rows, stories: b.stories, recentPrs: recent }) : []) {
      if (!settle.some(s => s.key === key)) settle.push({ key, pr: recent.find(p => keyOfPr(p) === key && p.state === 'MERGED')?.number });
    }
    for (const { key, pr } of settle) guard('settle', key, () => {
      const files = pr ? io.prFiles(pr) : [];
      const planned = landsPlanDelta(files);
      commitAll([
        story(key, { to: 'done', set: { finished: nowIso, ...(planned ? { planLanded: true } : {}) }, unset: ['run', 'hold', 'claim'], why: `PR #${pr} merged` }),
        boardEvent(planned ? { lastPlan: nowIso, mergesAtLastPlan: (b.merges ?? 0) + 1 } : null, { merges: 1 }),
      ]);
      say(`merged ${key} (PR #${pr})${planned ? ' — a plan delta; recorded as the planner\'s output' : ''}`);
    });
    b = io.board();
    const { adopt, skipped } = adoptions({ openPrs: snap.open, stories: b.stories, mainKeys: new Set(plan?.rows.map(r => r.Key) ?? []), phaseOf: key => (plan ? Object.entries(plan.deps.phases).find(([, ks]) => ks.includes(key))?.[0] : null) ?? null });
    for (const x of skipped) {
      if (x.why === 'draft' || x.why === 'returned' || /implementor run owns it/.test(x.why)) continue;
      // A PR naming a key the board has settled cannot land under that key: a person gives it its own.
      if (/is (done|blocked|escalate); a person decides/.test(x.why)) need(x.key, `PR #${x.pr} names ${x.key}, which is ${b.stories[x.key]?.status}; give the PR its own key (node orchestration/out-of-plan.mjs row) or ${b.stories[x.key]?.status === 'done' ? 'close it' : `unpark ${x.key}`}`);
      else say(`adopt: PR #${x.pr} skipped — ${x.why}`);
    }
    for (const a of adopt) {
      commitAll([adoptionEvent(a, nowIso)]);
      jiraCalls.push(['pr', a.key, String(a.pr)]);
      say(`adopt: ${a.key} PR #${a.pr} → in review${a.onMain ? '' : ' (its row is on its branch)'}`);
    }
  });
  // Worktrees whose PR merged or closed are removed; one with uncommitted work is never removed.
  if (snap && !dry && io.prune) guard('worktree prune', null, () => io.prune(snap, b).forEach(say));
  for (const [key, rec] of Object.entries(b.stories)) {
    if (rec.status !== 'in_progress' || rec.run) continue;
    const lapsed = !rec.claim || Date.parse(rec.claim.until) <= nowMs;
    if (!lapsed) continue;
    commitAll([story(key, { from: 'in_progress', to: 'todo', unset: ['claim'], why: rec.claim ? `claim by ${rec.claim.by} lapsed` : 'in progress with no run and no claim' })]);
    const wt = wtOf(key);
    if (wt?.dirty || wt?.ahead) need(key, `claim lapsed with work left in ${wt.path}; open its PR, or \`node orchestration/fleet.mjs claim ${key}\` to keep it`);
  }
  b = io.board();

  // 4. The review pipeline: one step per In Review story.
  let order = [];
  try {
    order = computeOrder({ s: b, d: plan?.deps ?? { phases: {}, deps: {} }, readPr: n => {
      const pr = openByNumber.get(Number(n));
      if (!pr) throw new Error('not open');
      return { files: (pr.files ?? []).map(f => f.path ?? f), mergeStateStatus: pr.mergeStateStatus, mergeable: pr.mergeable, createdAt: pr.createdAt };
    } }).order;
  } catch (e) { say(`review order: ${e.message}`); }
  const position = key => { const i = order.findIndex(o => o.key === key); return i < 0 ? Infinity : i; };
  const steps = [];
  for (const [key, rec] of Object.entries(b.stories)) {
    if (rec.status !== 'in_review' || !snap || !plan) continue;
    const pr = openByNumber.get(Number(rec.pr));
    if (!pr) continue; // merged or closed: settled above, or next cycle once the snapshot shows it
    guard('review step', key, () => {
      const activeRun = rec.run ? b.runs[rec.run] : null;
      const facts = activeRun ? null : io.prFacts(key, pr, plan);
      const decision = facts ? evaluate({
        pr, files: facts.files, outside: facts.outside, result: facts.result, attribution: facts.attribution,
        approval: facts.approval, codeowners: facts.codeowners, mergeUnreviewed: false,
      }) : { action: 'hold', reasons: [] };
      // A result that does not match orchestration/schema/result.schema.json is not a result.
      if (facts?.resultProblems?.length) {
        decision.reasons.push(`result file problems: ${facts.resultProblems.join('; ')} (re-run pnpm done ${key} in its worktree)`);
        decision.action = 'hold';
      }
      const step = reviewStep({ rec, pr, decision, t, nowMs, dispatchable: dispatchable(plan.byKey.get(key)), activeRun, noRow: facts && !facts.row });
      steps.push({ key, rec, pr, step, facts, decision });
    });
  }
  steps.sort((a, z) => position(a.key) - position(z.key));
  let updated = false;
  let reviewSlots = t.reviewLanes - Object.values(b.runs).filter(r => !r.ended && r.role === 'review').length;
  const spawns = [];
  for (const { key, rec, pr, step, facts, decision } of steps) guard(`review ${step.step}`, key, () => {
    // The hold is recorded when its class changes, so its age is honest and the log is not noise.
    if ((step.hold?.class ?? null) !== (rec.hold?.class ?? null)) {
      commitAll([step.hold
        ? story(key, { from: 'in_review', set: { hold: { ...step.hold, since: nowIso } } })
        : story(key, { from: 'in_review', unset: ['hold'] })]);
    }
    // A standing auto-merge that no longer matches the judgement is cancelled, not left to fire (MARXY-63).
    if (pr.autoMergeRequest && !['auto-merge', 'wait', 'merge'].includes(step.step) && !dry) io.gh(['pr', 'merge', String(pr.number), '--disable-auto']);
    const tag = `${key} PR #${pr.number}`;
    switch (step.step) {
      case 'merge': {
        if (noMerge || dry) { say(`${tag}: mergeable (not merging: ${dry ? '--dry-run' : '--no-merge'})`); break; }
        const r = io.gh(mergeArgs(pr.number, pr.headRefOid, { queue: Boolean(m.mergeQueue) }));
        const landed = r.ok || io.prState(pr.number) === 'MERGED';
        if (!landed) { say(`${tag}: merge failed — ${r.err.split('\n')[0]}`); break; }
        const planned = landsPlanDelta(facts.files);
        commitAll([
          story(key, { from: 'in_review', to: 'done', set: { finished: nowIso, ...(planned ? { planLanded: true } : {}) }, unset: ['hold', 'run'], why: `merged PR #${pr.number}` }),
          boardEvent(planned ? { lastPlan: nowIso, mergesAtLastPlan: (b.merges ?? 0) + 1 } : null, { merges: 1 }),
        ]);
        if (decision.approval?.note) say(`${key}: ${decision.approval.note}`);
        const review = existsSync(approvalPath(key)) ? readFileSync(approvalPath(key), 'utf8').trim() : '';
        if (review) jiraCalls.push(['comment', key, `Merged as PR #${pr.number}. Review that allowed it:\n\n${review}`]);
        say(`merged ${key} (PR #${pr.number})`);
        break;
      }
      case 'auto-merge': {
        if (noMerge || dry) { say(`${tag}: waiting on CI; would enable auto-merge`); break; }
        const r = io.gh(mergeArgs(pr.number, pr.headRefOid, { auto: true, queue: Boolean(m.mergeQueue) }));
        say(r.ok ? `${tag}: auto-merge enabled, waiting on CI` : `${tag}: auto-merge failed — ${r.err.split('\n')[0]}`);
        break;
      }
      case 'update': {
        // One branch update per cycle, at the head of the order (ADR-0025 §4). An approval survives it:
        // approve.mjs accepts a head that is the approved commit merged with main (onlyMainArrived).
        if (m.mergeQueue) { say(`${tag}: behind main; the merge queue tests it on top of those ahead`); break; }
        if (updated) { say(`${tag}: behind main; waiting its turn in the review order (position ${position(key) + 1})`); break; }
        updated = true;
        if (dry) { say(`${tag}: behind main; would update the branch`); break; }
        const r = io.gh(['pr', 'update-branch', String(pr.number)]);
        say(r.ok ? `${tag}: behind main — updated; CI is re-running` : `${tag}: update failed — ${r.err.split('\n')[0]}`);
        break;
      }
      case 'review':
        if (reviewSlots <= 0) { say(`${tag}: waiting for a reviewer (all ${t.reviewLanes} review lanes busy)`); break; }
        reviewSlots--;
        spawns.push({ role: 'review', key, rec, pr: pr.number });
        break;
      case 'resolve':
        spawns.push({ role: 'resolve', key, rec, pr: pr.number });
        break;
      case 'return': {
        const note = `Returned by the cycle at ${nowIso} (PR #${pr.number}, head ${pr.headRefOid.slice(0, 7)}):\n\n- ${step.why}`;
        if (!dry) io.writeNotes(key, note);
        commitAll(returnEvents(key, rec, { why: step.why, head: pr.headRefOid, t, now: nowIso, by: 'cycle' }));
        say(`${tag}: returned — ${step.why}`);
        break;
      }
      case 'park':
        commitAll([story(key, { from: 'in_review', to: 'blocked', set: { parkedReason: step.why, blockedAt: nowIso }, why: step.why })]);
        say(`${tag}: parked — ${step.why}`);
        break;
      case 'attention':
        need(key, `PR #${pr.number}: ${step.why}`, { gate: /CODEOWNERS/.test(step.why) });
        say(`${tag}: needs a person — ${step.why}`);
        break;
      default:
        say(`${tag}: ${step.why}`);
    }
  });

  // 5. The planner.
  let planBlocks = false;
  if (plan) guard('planner', null, () => {
    b = io.board();
    const reasons = plannerReasons({ s: b, m, all: plan.rows, d: plan.deps, now: nowMs });
    planBlocks = blocksDispatch(reasons);
    const p = b.planner ?? {};
    const cooling = p.started && (nowMs - Date.parse(p.started)) / 60_000 < t.plannerCooldownMinutes;
    if (reasons.length) {
      say(`planner: due — ${reasons.join('; ')}${planBlocks ? ' (dispatch waits for it)' : ''}`);
      if (p.run) say(`planner: running since ${p.started}`);
      else if (cooling) say(`planner: next run after the ${t.plannerCooldownMinutes}-minute cooldown from ${p.started}`);
      else spawns.push({ role: 'plan', key: null, rec: {} });
    }
    if (planBlocks && p.started && (nowMs - Date.parse(p.started)) / 3_600_000 > 24) need('planner', `dispatch has waited on the planner for over a day (${reasons.join('; ')})`);
  });

  // 6. Dispatch.
  b = io.board();
  let readyReport = null;
  if (plan && !planBlocks) guard('dispatch', null, () => {
    const claims = pathHolds({ board: b, plan, worktrees, t, nowMs });
    const r = selectReady({ all: plan.rows, s: b, d: plan.deps, cap: laneBudget(m), claims, nowMs, extraAllowed: plan.extraAllowed });
    for (const x of r.ready) spawns.push({ role: 'implement', key: x.key, rec: b.stories[x.key] ?? {}, row: plan.byKey.get(x.key) });
    if (!r.ready.length) say(`nothing ready; ${Object.values(b.stories).filter(s => s.status === 'todo').length} todo — see status.md for each one's wait`);
    readyReport = r;
  });
  else if (plan) {
    say('dispatch waits for the planner (never planned, or an escalation it has not read)');
  }
  // Worktrees with work in them that nothing owns are named, so they are neither lost nor silently holding.
  for (const w of worktrees) {
    const rec = b.stories[w.key];
    // A parked story's worktree is part of its parked reason, already listed; done ones are pruned.
    if (!(w.dirty || w.ahead) || ['in_progress', 'in_review', 'done', 'blocked', 'escalate'].includes(rec?.status)) continue;
    const idle = w.lastActivityMs ? Math.round((nowMs - w.lastActivityMs) / 3_600_000) : null;
    if (idle != null && idle * 60 <= t.activeWorktreeMinutes) continue;
    need(w.key, `${w.path} has ${w.ahead ? `${w.ahead} commit(s) and ` : ''}${w.dirty ? 'uncommitted work' : 'no uncommitted work'}${idle != null ? `, idle ${idle} h` : ''}, and nothing owns it: open its PR, \`node orchestration/fleet.mjs claim ${w.key}\`, or remove the worktree`, { quiet: true });
  }

  // Start everything decided above. The claim is appended before the worker exists, and the worker
  // is started only if the fold accepted the claim, so a story a person moved a moment ago is left alone.
  for (const s of spawns) guard(`start ${s.role}`, s.key, () => {
    if (!hasCli || dry) { say(`${s.key ?? 'planner'}: would start ${s.role}${dry ? ' (--dry-run)' : ' (cursor-agent is not on PATH; run it in-app)'}`); return; }
    const spec = buildSpec({ role: s.role, key: s.key, row: s.row, rec: s.rec, pr: s.pr, m, t, now, bin: io.bin });
    if (s.role === 'plan') spec.mergesAtStart = b.merges ?? 0;
    io.writeSpec(spec);
    commitAll(claimEvents(spec));
    b = io.board();
    const owned = s.role === 'plan' ? b.planner?.run === spec.id : b.stories[s.key]?.run === spec.id;
    if (!owned) {
      commitAll([runEvent(spec.id, { ended: nowIso, outcome: 'not-started', why: 'the story moved before the worker started' })]);
      say(`${s.key}: ${s.role} not started — the story moved`);
      return;
    }
    const pid = io.spawnWorker(spec.id);
    if (pid) {
      commitAll([runEvent(spec.id, { pid, match: `worker.mjs --run ${spec.id}` })]);
      if (s.role === 'implement') jiraCalls.push(['move', s.key, 'in_progress']);
      say(`${s.key ?? 'planner'}: ${s.role} started (${spec.model}, until ${spec.deadline.slice(11, 16)}Z)`);
    } else {
      io.writeExit(spec.id, { outcome: 'setup', why: 'the worker process could not be started' });
      say(`${s.key ?? 'planner'}: ${s.role} could not start its worker`);
    }
  });

  // 7. Mirror to Jira. Bounded, best effort, never blocking, and never read back as an input.
  if (!dry) guard('jira mirror', null, () => {
    for (const args of [...jiraCalls, ['push']]) {
      const r = io.jira(args);
      if (!r.ok) {
        say(`jira: ${args[0]} ${args[1] ?? ''} not mirrored${r.timedOut ? ' (timed out)' : ''}; the next cycle's push retries`);
        if (r.code === 3) break; // no credentials: every later call fails the same way
      }
    }
  });

  // 8. Report.
  b = io.board();
  return io.report({ at: nowIso, compute: m.compute, models: m, t, board: b, plan, lines, attention, ready: readyReport, worktrees, dry });
}

function runCycle(argv = process.argv.slice(2)) {
  const lockPath = cycleLockPath();
  const lock = acquireLock(lockPath, { match: 'cycle.mjs' });
  if (!lock.ok) {
    console.log(`cycle: another cycle holds ${lockPath} (pid ${lock.holder?.pid} since ${lock.holder?.started}); not running a second one`);
    return;
  }
  if (lock.tookOver) console.log(`cycle: took over the lock of a cycle that died (pid ${lock.tookOver.pid})`);
  try {
    const m = models();
    process.env.MARXY_COMPUTE = m.compute;
    const dry = argv.includes('--dry-run');
    try {
      reconcile({ io: liveIo({ m, dry }), m, dry, noMerge: argv.includes('--no-merge') });
    } catch (e) {
      // Even a cycle that cannot finish leaves a status that says so, never a stale one that looks fine.
      const why = String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ');
      console.error(`cycle: failed — ${why}`);
      let b = { stories: {}, runs: {}, planner: {}, rejected: [] };
      try { b = readBoard({ write: false }); } catch { /* the store itself is unreadable */ }
      writeReport({ at: new Date().toISOString(), compute: m.compute, board: b, plan: null, lines: [`cycle failed: ${why}`],
        attention: [{ key: 'fleet', why: `the cycle failed before finishing: ${why} — see ${cycleLockPath().replace(/cycle\.lock$/, 'loop.log')}`, gate: true }], ready: null, dry });
      process.exitCode = 1;
    }
  } finally {
    releaseLock(lockPath);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) runCycle();

export { snapshotFrom };
