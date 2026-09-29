// Who owns a changed file, and whether an owner has approved it, decided here rather than read
// from GitHub. Live branch protection has `require_code_owner_reviews: true` with
// `required_approving_review_count: 0`; under that pairing GitHub never sets REVIEW_REQUIRED
// (MARXY-172), so the merge bar cannot wait for a signal that does not arrive.

import { onlyMainArrived } from './approve.mjs';

/** CODEOWNERS lines as `{ pattern, owners }` with the leading slash stripped, in file order. */
export function codeOwnerPatterns(text) {
  return String(text ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const [pattern, ...owners] = l.split(/\s+/);
      return { pattern: pattern.replace(/^\//, ''), owners: owners.map(o => o.replace(/^@/, '')) };
    })
    .filter(p => p.pattern);
}

function patternMatches(pattern, file) {
  if (pattern.includes('*')) {
    const esc = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // `/**/` also matches no directory at all, as in gitignore.
    const re = pattern
      .replace(/\/$/, '')
      .split('/**/')
      .map(seg => seg.split('**').map(part => part.split('*').map(esc).join('[^/]*')).join('.*'))
      .join('/(?:.*/)?');
    return new RegExp(`^${re}(/|$)`).test(file);
  }
  return pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern;
}

export function ownedBy(patterns, file) {
  return patterns.some(p => patternMatches(p.pattern, file));
}

/** GitHub takes the last matching line, so a later line can hand a path to someone else. */
export function ownersOf(patterns, file) {
  const hit = [...patterns].reverse().find(p => patternMatches(p.pattern, file));
  return hit ? hit.owners : [];
}

/**
 * An APPROVED review, by a login, of the head being merged or of a commit the head is that commit
 * merged with main (`onlyMainArrived`, MARXY-323). Branch protection no longer dismisses stale
 * reviews, so the fleet's own merges of main must not void a person's approval; any other change
 * since the review does. A review with no commit recorded never counts. `latestReviews` is one
 * review per reviewer, so a later CHANGES_REQUESTED or DISMISSED already replaced an approval.
 */
function approvers({ reviews = [], headRefOid, git }) {
  const opts = { fetch: false, ...(git ? { git } : {}) };
  const current = r => {
    const oid = r.commit?.oid;
    if (!oid || !headRefOid) return false;
    return oid === headRefOid || onlyMainArrived(oid, headRefOid, opts).ok;
  };
  return new Set(
    reviews
      .filter(r => r?.state === 'APPROVED' && current(r))
      .map(r => String(r.author?.login ?? '').toLowerCase())
      .filter(Boolean),
  );
}

/**
 * `owned` is every changed file some CODEOWNERS line covers; `unapproved` is the subset no listed
 * owner has approved. A team owner (`org/team`) cannot be matched to a login, so it never
 * satisfies a file: the bar holds and a person decides, which is the safe direction.
 */
export function codeOwnerStatus({ files = [], codeowners, reviews = [], headRefOid, git } = {}) {
  const patterns = codeOwnerPatterns(codeowners);
  const approved = approvers({ reviews, headRefOid, git });
  const owned = files.filter(f => ownedBy(patterns, f));
  const unapproved = owned.filter(f => !ownersOf(patterns, f).some(o => !o.includes('/') && approved.has(o.toLowerCase())));
  return { owned, unapproved };
}
