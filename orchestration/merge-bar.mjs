// The quality bar a PR must clear before an agent may land it. cycle.mjs is the only
// caller that merges; this module only decides. The clauses live in docs/sdlc.md.
import { codeOwnerStatus } from './codeowners.mjs';
import { hasEntry, fragmentPath, validFragment } from '../scripts/lib/changelog.mjs';
import { BOARD_FILES } from '../scripts/lib/own-row.mjs';

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
  revert,
}) {
  // A revert pull request that is exactly the inverse of its commit (`verifyRevert`) needs neither a
  // reviewer's signature nor a result file nor a story's paths: nothing in it is new. Any other
  // revert is held to the whole bar, plus the reason it is not one.
  const inverse = Boolean(revert?.ok);
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
    revert && !inverse && `not the exact inverse of ${String(revert.sha ?? '').slice(0, 7)}: ${revert.why}`,
    !inverse && outside.length && `files outside the story's paths: ${outside.join(', ')}`,
    !inverse && !result && 'no implementor result file',
    !inverse && result && result.status !== 'done' && `result says ${result.status}`,
    // The hold text stays exactly this string: cycle.mjs matches on it (docs/ci-contract.md).
    // `result?.key` names the fragment to look for; without one (no result file yet) any
    // fragment or CHANGELOG.md counts, the same loose read as before fragments existed.
    files?.length && !hasEntry(files, inverse ? revert.key : result?.key) && 'no CHANGELOG entry',
    !inverse && !mergeUnreviewed && !approval?.ok && (approval?.why ?? 'not reviewed (no results/KEY.approved)'),
  ].filter(Boolean);
}

export function evaluate(input) {
  const reasons = holdReasons(input);
  return { action: mergeAction(reasons), reasons, approval: input.approval, landsOnRedMain: Boolean(input.revert?.ok) };
}

const namesOf = out => String(out ?? '').split('\n').filter(Boolean);

/**
 * Whether a pull request's head is exactly the inverse of commit `sha` (ADR-0043), so that landing it
 * needs no reviewer and may happen while main is red. The expected tree is the one `git revert` makes:
 * `sha`'s parent merged into the PR's base with `sha` as the merge base. The head may differ from it in
 * two places only, both repaired on purpose: the story's changelog fragment (a revert would delete the
 * entry every pull request must have) and the two board files (a revert would delete the story's row,
 * and the story is about to be dispatched again). Those files must be a valid fragment and
 * byte-identical to the base respectively. `git(args) → { ok, out }` is injected.
 */
export function verifyRevert({ sha, key, head, main = 'origin/main', git }) {
  const no = why => ({ ok: false, why });
  if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !/^[0-9a-f]{40}$/.test(head ?? '')) return no('no commit or head to compare');
  const base = git(['merge-base', main, head]);
  if (!base.ok || !base.out) return no('the branch has no merge base with main');
  if (!git(['merge-base', '--is-ancestor', sha, base.out]).ok) return no(`${sha.slice(0, 7)} is not in main's history`);
  const fragment = fragmentPath(key);
  const free = [fragment, ...BOARD_FILES];
  // Exit 1 is a conflict; the conflicted names follow the tree id. Only the free files may conflict.
  const merged = git(['merge-tree', '--write-tree', '--name-only', `--merge-base=${sha}`, base.out, `${sha}^`]);
  const [tree, ...rest] = String(merged.out ?? '').split('\n');
  if (!/^[0-9a-f]{40}$/.test(tree ?? '')) return no('git could not compute the revert');
  const conflicted = merged.ok ? [] : rest.slice(0, rest.includes('') ? rest.indexOf('') : rest.length);
  const blocking = conflicted.filter(f => !free.includes(f));
  if (blocking.length) return no(`the revert conflicts with main in ${blocking.join(', ')}`);
  const differs = namesOf(git(['diff', '--name-only', tree, head]).out).filter(f => !free.includes(f));
  if (differs.length) return no(`the tree differs from a plain revert in ${differs.slice(0, 5).join(', ')}`);
  if (namesOf(git(['diff', '--name-only', base.out, head, '--', ...BOARD_FILES]).out).length) return no('the pull request changes the board files');
  const frag = git(['show', `${head}:${fragment}`]);
  if (!frag.ok || !validFragment(frag.out, key)) return no(`${fragment} is not one line ending in (${key})`);
  return { ok: true };
}

/**
 * The arguments for every merge the cycle runs. `--match-head-commit` pins the merge to the head
 * the bar was evaluated against: without it, a push between evaluation and merge lands a tree
 * nobody reviewed, which is the one thing a signed approval exists to prevent.
 */
export function mergeArgs(number, headRefOid, { auto = false, queue = false, subject } = {}) {
  if (!/^[0-9a-f]{40}$/.test(headRefOid ?? '')) throw new Error(`refusing to merge PR #${number} without a head to pin`);
  // `--auto` is how `gh` both enables classic auto-merge and enqueues onto a merge queue.
  // When `queue` is on, every land goes through that path so GitHub tests the PR on top of
  // those ahead of it instead of merging a head that was never rebased onto main.
  // `--subject` is the squash headline. The open title may carry `[human]` or `(signed)`;
  // those are display and must not become the commit subject.
  const headline = subject ? ['--subject', subject] : [];
  return ['pr', 'merge', String(number), '--squash', ...headline, ...(auto || queue ? ['--auto'] : []), '--delete-branch', '--match-head-commit', headRefOid];
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
