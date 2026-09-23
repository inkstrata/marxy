// One read of GitHub per cycle (MARXY-191).
//
// A cycle used to ask `gh` about each pull request three times — board-check for its state, the review
// queue for the merge bar, the review order for files and mergeability — and once more per worktree
// for the prune. That is 3N + W + 1 round trips a cycle, each a second or so. Two list calls carry
// everything: every open PR with the fields all three readers need, and the state of every recent
// PR by branch for the prune. A reader that finds a number missing (a PR merged or closed since)
// falls back to one `gh pr view`.
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib.mjs';

export const OPEN_FIELDS = [
  'number', 'title', 'url', 'headRefName', 'headRefOid', 'isDraft', 'state', 'mergeable', 'mergeStateStatus',
  'reviewDecision', 'latestReviews', 'statusCheckRollup', 'autoMergeRequest', 'files', 'createdAt', 'author',
].join(',');

const defaultGh = args => execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });

/** Build a snapshot from the two lists. Pure, so a fixture can drive it. */
export function snapshotFrom(open = [], recent = []) {
  const byNumber = new Map(open.map(pr => [pr.number, pr]));
  const statesByBranch = new Map();
  for (const pr of [...recent, ...open]) {
    if (!pr?.headRefName) continue;
    if (!statesByBranch.has(pr.headRefName)) statesByBranch.set(pr.headRefName, new Set());
    statesByBranch.get(pr.headRefName).add(pr.state);
  }
  return {
    open,
    recent,
    byNumber,
    /** OPEN beats MERGED beats CLOSED, as worktrees.mjs pickPrState decides for one branch. */
    branchState: branch => ['OPEN', 'MERGED', 'CLOSED'].find(s => statesByBranch.get(branch)?.has(s)) ?? null,
  };
}

/** Read both lists. Throws when `gh` fails, so the caller can fall back to per-PR reads. */
export function loadSnapshot({ gh = defaultGh } = {}) {
  const open = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '200', '--json', OPEN_FIELDS]));
  const recent = JSON.parse(gh(['pr', 'list', '--state', 'all', '--limit', '300', '--json', 'number,headRefName,state']));
  return snapshotFrom(open, recent);
}

let current = null;
/** Make a snapshot the one every reader in this process consults. */
export function prime(snapshot) { current = snapshot; }
export function primed() { return current; }
