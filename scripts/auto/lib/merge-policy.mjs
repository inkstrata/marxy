// The deterministic merge gate's rules. No agent merges; this decides from the PR's own record.

import { localParts, zonedTime, POLICY } from './governor.mjs';
import { ownedFiles } from './codeowners.mjs';

const MARKER = /<!--\s*marxy-(author|review|intake)\b([\s\S]*?)-->/g;
const ATTR = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

export function parseMarkers(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(MARKER)) {
    const marker = { kind: m[1] };
    for (const a of m[2].matchAll(ATTR)) marker[a[1]] = a[2] ?? a[3] ?? a[4];
    out.push(marker);
  }
  return out;
}

// The most recent weekly reset (Friday 20:00 local) at or before now.
export function lastReset(now, policy = POLICY) {
  const l = localParts(now, policy.tz);
  const back = (l.weekday - policy.reset.weekday + 7) % 7;
  const t = zonedTime(l.year, l.month, l.day - back, policy.reset.hour, 0, policy.tz);
  return t <= now ? t : zonedTime(l.year, l.month, l.day - back - 7, policy.reset.hour, 0, policy.tz);
}

const isAutomation = (body) => String(body ?? '').includes('<!-- marxy-');
const time = (c) => new Date(c.createdAt).getTime();
// "sonnet", "Sonnet 5.5" and "claude-sonnet-5-5" are one model family for the independence rule.
const family = (m) => (String(m ?? '').toLowerCase().match(/opus|sonnet|haiku|fable/) ?? [String(m ?? '').toLowerCase()])[0];

function reviewReasons(pr, author) {
  if (!author) return ['no independent approval: the author is unknown'];
  const head = String(pr.headRefOid ?? '').toLowerCase();
  const reviews = [];
  for (const c of pr.comments ?? []) {
    for (const m of parseMarkers(c.body)) {
      if (m.kind === 'review' && String(m.head ?? '').toLowerCase() === head) reviews.push({ ...m, at: time(c) });
    }
  }
  const approvals = reviews.filter((r) => r.verdict === 'approve');
  if (!approvals.length) return ['no approval of the current head'];
  // A second look counts only from another run on another model.
  const independent = approvals.filter((r) => r.run !== author.run && family(r.model) !== family(author.model));
  if (!independent.length) return ['approval is not independent of the author (same run or model)'];
  const newestApproval = Math.max(...independent.map((r) => r.at));
  if (reviews.some((r) => r.verdict === 'changes' && r.at > newestApproval)) {
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

function planReasons(pr, now, lastResetAt) {
  // A plan is merged only once an intake made after the weekly reset has answered everything the owner
  // said on it; the planner opens it before the reset, so the intake is what holds it until then.
  const comments = pr.comments ?? [];
  const intakes = comments
    .flatMap((c) => parseMarkers(c.body).filter((m) => m.kind === 'intake').map((m) => ({ ...m, at: time(c) })))
    .sort((a, b) => a.at - b.at);
  const intake = intakes.at(-1);
  if (!intake) return ['plan has no intake'];
  const reasons = [];
  if (intake.at < lastResetAt.getTime()) reasons.push('plan intake is older than the weekly reset');
  if (String(intake.head ?? '').toLowerCase() !== String(pr.headRefOid ?? '').toLowerCase()) {
    reasons.push('plan intake is for an older head');
  }
  const owner = comments.filter((c) => !isAutomation(c.body)).map(time);
  if (owner.length && Math.max(...owner) >= intake.at) reasons.push('owner commented after the intake');
  return reasons;
}

export function evaluate(pr, { now = new Date(), ownerRules = [], lastResetAt } = {}) {
  const reasons = [];
  const labels = (pr.labels ?? []).map((l) => String(typeof l === 'string' ? l : l?.name).toLowerCase());
  const author = parseMarkers(pr.body).find((m) => m.kind === 'author') ?? null;

  if (String(pr.state ?? '').toUpperCase() !== 'OPEN') reasons.push('not open');
  if (pr.isDraft) reasons.push('draft');
  if (!String(pr.headRefName ?? '').startsWith('agent/')) reasons.push('head branch is not agent/*');
  if (!author) reasons.push('no author marker');
  reasons.push(...reviewReasons(pr, author));
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
    reasons.push(...planReasons(pr, now, lastResetAt ?? lastReset(now)));
  }

  return { merge: reasons.length === 0, reasons };
}
