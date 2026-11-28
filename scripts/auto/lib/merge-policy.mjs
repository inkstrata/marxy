// The deterministic merge gate's rules. No agent merges; this decides from the PR's own record.

import { localParts, zonedTime, POLICY } from './governor.mjs';
import { ownedFiles } from './codeowners.mjs';

// The one account that contributes to the repository. Its comments are the automation's and the owner's; anyone
// else can comment on a public repository, so nobody else's words approve, hold or veto anything.
export const CONTRIBUTOR = 'inkstrata';

// The kind must be a whole word, so "marxy-review-foo" is no review, and the attributes stop at the first "-->".
const KIND = String.raw`<!--\s*marxy-(author|review|intake)(?=\s|-->)((?:(?!-->)[\s\S])*)-->`;
const MARKER = new RegExp(KIND, 'g');
const MARKER_LINE = new RegExp(`^${KIND}$`);
const ATTR = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
const SHA = /^[0-9a-f]{40}$/i;

// A marker counts only with every field it needs present and well formed: one with a field missing proves nothing.
function wellFormed(m) {
  if (m.kind === 'review') return (m.verdict === 'approve' || m.verdict === 'changes') && SHA.test(m.head ?? '') && !!m.run && !!m.model;
  if (m.kind === 'author') return !!m.run && !!m.model;
  return SHA.test(m.head ?? '');
}

function toMarker(m) {
  const marker = { kind: m[1] };
  for (const a of m[2].matchAll(ATTR)) marker[a[1]] = a[2] ?? a[3] ?? a[4];
  return wellFormed(marker) ? marker : null;
}

export function parseMarkers(text) {
  return [...String(text ?? '').matchAll(MARKER)].map(toMarker).filter(Boolean);
}

// The first line of each kind of automation comment, as the review and night skills write them.
const OPENING = { review: 'Independent review:', intake: 'Intake:' };

/**
 * The marker of an automation comment, or null for any other comment. The automation's comments are known by their
 * shape: the opening line of their kind, and a last non-empty line that is exactly one well-formed marker. A comment
 * that quotes or mentions a marker anywhere else, a quote reply included, is a person's.
 */
export function automationMarker(body) {
  const lines = String(body ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const m = MARKER_LINE.exec(lines.at(-1) ?? '');
  const marker = m && toMarker(m);
  return marker && OPENING[marker.kind] && lines[0].startsWith(OPENING[marker.kind]) ? marker : null;
}

/** The contributor's comments split into the automation's (each with its marker) and the owner's (their times). */
function sortComments(comments = []) {
  const automation = [];
  const owner = [];
  for (const c of comments) {
    if (String(c.author ?? '').toLowerCase() !== CONTRIBUTOR) continue;
    const marker = automationMarker(c.body);
    if (marker) automation.push({ ...marker, at: time(c) });
    else owner.push(time(c));
  }
  return { automation, owner };
}

// The most recent weekly reset (Friday 20:00 local) at or before now.
export function lastReset(now, policy = POLICY) {
  const l = localParts(now, policy.tz);
  const back = (l.weekday - policy.reset.weekday + 7) % 7;
  const t = zonedTime(l.year, l.month, l.day - back, policy.reset.hour, 0, policy.tz);
  return t <= now ? t : zonedTime(l.year, l.month, l.day - back - 7, policy.reset.hour, 0, policy.tz);
}

const time = (c) => new Date(c.createdAt).getTime();
// "sonnet", "Sonnet 5.5" and "claude-sonnet-5-5" are one model family for the independence rule.
const family = (m) => (String(m ?? '').toLowerCase().match(/opus|sonnet|haiku|fable/) ?? [String(m ?? '').toLowerCase()])[0];

function reviewReasons(pr, author, automation) {
  if (!author) return ['no independent approval: the author is unknown'];
  const head = String(pr.headRefOid ?? '').toLowerCase();
  const reviews = automation.filter((m) => m.kind === 'review' && m.head.toLowerCase() === head);
  const approvals = reviews.filter((r) => r.verdict === 'approve');
  if (!approvals.length) return ['no approval of the current head'];
  // A second look counts only from another run on another model.
  const independent = approvals.filter((r) => r.run !== author.run && family(r.model) !== family(author.model));
  if (!independent.length) return ['approval is not independent of the author (same run or model)'];
  const newestApproval = Math.max(...independent.map((r) => r.at));
  // GitHub's times are to the second, so a verdict in the same second as the approval is not provably older: it holds.
  if (reviews.some((r) => r.verdict === 'changes' && r.at >= newestApproval)) {
    return ['changes requested on the current head'];
  }
  return [];
}

function checkReasons(checks = []) {
  const reasons = [];
  const up = (s) => String(s ?? '').toUpperCase();
  if (!checks.some((c) => c.name === 'ci' && up(c.conclusion) === 'SUCCESS')) reasons.push('ci has not passed');
  const bad = checks.filter((c) => ['FAILURE', 'CANCELLED', 'TIMED_OUT'].includes(up(c.conclusion)));
  if (bad.length) reasons.push(`failed checks: ${bad.map((c) => c.name).join(', ')}`);
  return reasons;
}

function planReasons(pr, lastResetAt, { automation, owner }) {
  // A plan is merged only once an intake made after the weekly reset has answered everything the owner
  // said on it; the planner opens it before the reset, so the intake is what holds it until then.
  const intake = automation.filter((m) => m.kind === 'intake').sort((a, b) => a.at - b.at).at(-1);
  if (!intake) return ['plan has no intake'];
  const reasons = [];
  if (intake.at < lastResetAt.getTime()) reasons.push('plan intake is older than the weekly reset');
  if (String(intake.head ?? '').toLowerCase() !== String(pr.headRefOid ?? '').toLowerCase()) {
    reasons.push('plan intake is for an older head');
  }
  if (owner.length && Math.max(...owner) >= intake.at) reasons.push('owner commented after the intake');
  return reasons;
}

export function evaluate(pr, { now = new Date(), ownerRules = [], lastResetAt } = {}) {
  const reasons = [];
  const labels = (pr.labels ?? []).map((l) => String(typeof l === 'string' ? l : l?.name).toLowerCase());
  const author = parseMarkers(pr.body).find((m) => m.kind === 'author') ?? null;
  const comments = sortComments(pr.comments);

  if (String(pr.state ?? '').toUpperCase() !== 'OPEN') reasons.push('not open');
  if (pr.isDraft) reasons.push('draft');
  // A fork can name its branch agent/... too; only a branch pushed to this repository by the contributor is ours.
  // A record that does not say (an older caller) is refused rather than trusted.
  const headOwner = String(pr.headRepositoryOwner ?? '').toLowerCase();
  if (pr.isCrossRepository !== false || headOwner !== CONTRIBUTOR) reasons.push('pull request is not from this repository');
  if (!String(pr.headRefName ?? '').startsWith('agent/')) reasons.push('head branch is not agent/*');
  if (!author) reasons.push('no author marker');
  reasons.push(...reviewReasons(pr, author, comments.automation));
  reasons.push(...checkReasons(pr.checks));

  const owned = ownedFiles(pr.files ?? [], ownerRules);
  if (owned.length) {
    const more = owned.length > 3 ? ` and ${owned.length - 3} more` : '';
    reasons.push(`waits for the owner: CODEOWNERS paths ${owned.slice(0, 3).join(', ')}${more}`);
  }
  if (labels.includes('hold')) reasons.push('labelled hold');
  if (pr.mergeStateStatus !== 'CLEAN') reasons.push(`merge state is ${pr.mergeStateStatus ?? 'unknown'}, not CLEAN`);
  // A plan is known by its branch as well as its label, so a missing label cannot skip the intake rule.
  if (labels.includes('plan') || String(pr.headRefName ?? '').startsWith('agent/plan-')) {
    reasons.push(...planReasons(pr, lastResetAt ?? lastReset(now), comments));
  }

  return { merge: reasons.length === 0, reasons };
}
