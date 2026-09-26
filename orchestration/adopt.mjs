// The cycle adopts open pull requests the board does not know are in review (MARXY-190).
//
// The review queue walks the board, and only In Review entries with a PR number. Out-of-plan work
// never had an entry, so its PRs were invisible to the cycle and every one was merged by hand; a
// planned story whose PR opened without `state.mjs review` sat In Progress with the same effect.
// Adoption closes both: any open, non-draft PR whose title or branch names a Jira key becomes
// In Review with its number, once. It never moves a story backwards, never touches a done, blocked
// or escalated story (those are a person's call), never takes a story an implementor run owns (the
// run's end moves it), never takes a second PR for a key that has one, and never takes back a PR
// that was returned until something new is pushed to it (ADR-0034; MARXY-217 by construction).
import { story } from './machine.mjs';

/** The Jira key a PR names: title first (the commit-msg hook keeps it honest), then the branch. */
export function keyOfPr(pr) {
  return String(pr?.title ?? '').match(/MARXY-\d+/)?.[0] ?? String(pr?.headRefName ?? '').match(/MARXY-\d+/)?.[0] ?? null;
}

const ADOPTABLE = new Set([undefined, 'todo', 'in_progress']);

/** GitHub says this pull request cannot merge into main. */
export function prConflicts(pr) {
  return pr?.mergeStateStatus === 'DIRTY' || pr?.mergeable === 'CONFLICTING';
}

/**
 * `{ adopt: [{ key, pr, branch, from, phase, onMain }], skipped: [{ key, pr, why }] }`.
 * `phaseOf(key, pr)` answers the key's phase on main, else on the PR's branch, else null.
 */
export function adoptions({ openPrs = [], stories = {}, mainKeys = new Set(), phaseOf = () => null } = {}) {
  const adopt = [], skipped = [];
  const claimed = new Set();
  for (const pr of [...openPrs].sort((a, b) => a.number - b.number)) {
    const key = keyOfPr(pr);
    if (!key) continue;
    if (pr.isDraft) { skipped.push({ key, pr: pr.number, why: 'draft' }); continue; }
    const rec = stories[key];
    if (rec?.status === 'in_review' && Number(rec.pr) === pr.number) continue;
    if (rec?.status === 'in_progress' && rec.run) { skipped.push({ key, pr: pr.number, why: 'an implementor run owns it; the run\'s end records the PR' }); continue; }
    if (rec?.returned?.head && rec.returned.head === pr.headRefOid) { skipped.push({ key, pr: pr.number, why: 'returned' }); continue; }
    if (claimed.has(key) || (rec?.status === 'in_review' && rec.pr)) {
      skipped.push({ key, pr: pr.number, why: `${key} already has PR #${rec?.pr ?? adopt.find(a => a.key === key)?.pr} in review` });
      continue;
    }
    if (!ADOPTABLE.has(rec?.status)) { skipped.push({ key, pr: pr.number, why: `${key} is ${rec.status}; a person decides` }); continue; }
    claimed.add(key);
    adopt.push({ key, pr: pr.number, branch: pr.headRefName, from: rec?.status ?? null, phase: phaseOf(key, pr) ?? 'ops', onMain: mainKeys.has(key) });
  }
  return { adopt, skipped };
}

/**
 * Keys to record Done: a `no-dispatch` row (work that brought its own PR) not yet done whose PR has
 * merged, however it merged — by the cycle, by hand while the cycle was stopped, or before the cycle
 * ever adopted it. Without this such a row sat `todo` on the board forever.
 */
export function settlements({ rows = [], stories = {}, recentPrs = [] } = {}) {
  const merged = new Set(recentPrs.filter(pr => pr.state === 'MERGED').map(keyOfPr).filter(Boolean));
  return rows
    .filter(r => String(r.Labels ?? '').split(',').map(s => s.trim()).includes('no-dispatch'))
    .filter(r => stories[r.Key]?.status !== 'done' && merged.has(r.Key))
    .map(r => r.Key);
}

/** The event that adopts one PR. Attempts are left alone: adoption is not a dispatch. */
export function adoptionEvent(a, now = new Date().toISOString()) {
  return story(a.key, {
    from: ['todo', 'in_progress'], to: 'in_review', why: `adopted PR #${a.pr}`,
    set: { pr: a.pr, branch: a.branch, adopted: now, ...(a.onMain ? {} : { outOfPlan: true, phase: a.phase }) },
    unset: ['claim', 'hold', 'returned', 'resolveTries', 'reviewTries'],
  });
}
