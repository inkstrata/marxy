// The quality bar a PR must clear before an agent may land it. cycle.mjs is the only
// caller that merges; this module only decides. The clauses live in docs/sdlc.md.
import { codeOwnerStatus } from './codeowners.mjs';

const RED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ERROR']);
const PENDING = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED']);

export function classifyChecks(rollup = []) {
  const checks = (rollup ?? []).map(c => ({ name: c.name ?? c.context, state: c.conclusion ?? c.state ?? c.status }));
  return {
    checks,
    red: checks.filter(c => RED.has(c.state)),
    pending: checks.filter(c => !c.state || PENDING.has(c.state)),
  };
}

/** `merge` — land now. `auto-merge` — enable GitHub auto-merge and wait on CI. `hold` — print reasons. */
export function mergeAction(reasons) {
  if (reasons.length === 0) return 'merge';
  if (reasons.every(r => r.startsWith('pending:'))) return 'auto-merge';
  return 'hold';
}

export function holdReasons({
  pr,
  files,
  outside = [],
  result,
  attribution = false,
  approval,
  mergeUnreviewed = false,
  codeowners,
}) {
  const { checks, red, pending } = classifyChecks(pr.statusCheckRollup);
  // `codeowners` is the text of .github/CODEOWNERS on main. A caller that could not read it passes
  // null, and one that forgot it passes nothing: both hold, because ownership went unchecked.
  const ownership = typeof codeowners === 'string'
    ? codeOwnerStatus({ files, codeowners, reviews: pr.latestReviews, headRefOid: pr.headRefOid })
    : null;
  const needsOwner = pr.reviewDecision === 'REVIEW_REQUIRED' || ownership?.unapproved.length > 0;
  return [
    pr.state !== 'OPEN' && `PR is ${pr.state}`,
    !files?.length && 'could not compute the branch diff, so no boundary check ran',
    attribution && 'an attribution trailer is in a commit message (AGENTS.md)',
    pr.mergeable === 'CONFLICTING' && 'conflicts with main',
    !checks.length && 'no checks have run at all (a PR in conflict never gets a check suite)',
    red.length && `red: ${red.map(c => c.name).join(', ')}`,
    pending.length && `pending: ${pending.map(c => c.name).join(', ')}`,
    pr.reviewDecision === 'CHANGES_REQUESTED' && 'changes requested',
    !ownership && 'could not read .github/CODEOWNERS, so code ownership was not checked',
    needsOwner && `human review required (CODEOWNERS)${ownership?.unapproved.length ? `: ${ownership.unapproved.join(', ')}` : ''}`,
    outside.length && `files outside the story's paths: ${outside.join(', ')}`,
    !result && 'no implementor result file',
    result && result.status !== 'done' && `result says ${result.status}`,
    files?.length && !files.includes('CHANGELOG.md') && 'no CHANGELOG entry',
    !mergeUnreviewed && !approval?.ok && (approval?.why ?? 'not reviewed (no results/KEY.approved)'),
  ].filter(Boolean);
}

export function evaluate(input) {
  const reasons = holdReasons(input);
  return { action: mergeAction(reasons), reasons, approval: input.approval };
}

/**
 * The arguments for every merge the cycle runs. `--match-head-commit` pins the merge to the head
 * the bar was evaluated against: without it, a push between evaluation and merge lands a tree
 * nobody reviewed, which is the one thing a signed approval exists to prevent.
 */
export function mergeArgs(number, headRefOid, { auto = false, queue = false } = {}) {
  if (!/^[0-9a-f]{40}$/.test(headRefOid ?? '')) throw new Error(`refusing to merge PR #${number} without a head to pin`);
  // `--auto` is how `gh` both enables classic auto-merge and enqueues onto a merge queue.
  // When `queue` is on, every land goes through that path so GitHub tests the PR on top of
  // those ahead of it instead of merging a head that was never rebased onto main.
  return ['pr', 'merge', String(number), '--squash', ...(auto || queue ? ['--auto'] : []), '--delete-branch', '--match-head-commit', headRefOid];
}

/**
 * Which one BEHIND pull request to bring up to date this cycle, or null.
 *
 * With strict branch protection every merge puts every other PR behind main. Updating all of them
 * reruns CI for each and moves every head, so the queue spends its CI on PRs that are not next.
 * Only a PR that would otherwise land (nothing held but pending checks) is worth refreshing, and
 * only one at a time, oldest first: it merges, the next one is refreshed, and so on.
 * `candidates` are `{ key, number, reasons, live }` for PRs whose mergeStateStatus is BEHIND.
 */
export function chooseUpdate(candidates = [], { queue = false } = {}) {
  if (queue) return null;
  const eligible = candidates
    .filter(c => !c.live && (c.reasons ?? []).every(r => r.startsWith('pending:')))
    .sort((a, b) => a.number - b.number);
  return eligible[0] ?? null;
}

/**
 * Whether someone is still working in a story's worktree. A directory that exists is not
 * evidence: worktrees outlive their implementors until the merge removes them, so treating
 * existence as life held every PR with a leftover worktree behind main forever. Uncommitted
 * changes, or git activity inside the attempt window, are.
 */
export function worktreeLive({ exists, dirty, lastActivityMs, nowMs = Date.now(), windowMinutes = 45 }) {
  if (!exists) return false;
  if (dirty) return true;
  return lastActivityMs != null && nowMs - lastActivityMs < windowMinutes * 60_000;
}
