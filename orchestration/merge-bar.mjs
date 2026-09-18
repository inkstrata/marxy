// The quality bar a PR must clear before an agent may land it. cycle.mjs is the only
// caller that merges; this module only decides. The clauses live in docs/sdlc.md.
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
}) {
  const { checks, red, pending } = classifyChecks(pr.statusCheckRollup);
  return [
    pr.state !== 'OPEN' && `PR is ${pr.state}`,
    !files?.length && 'could not compute the branch diff, so no boundary check ran',
    attribution && 'an attribution trailer is in a commit message (AGENTS.md)',
    pr.mergeable === 'CONFLICTING' && 'conflicts with main',
    !checks.length && 'no checks have run at all (a PR in conflict never gets a check suite)',
    red.length && `red: ${red.map(c => c.name).join(', ')}`,
    pending.length && `pending: ${pending.map(c => c.name).join(', ')}`,
    pr.reviewDecision === 'CHANGES_REQUESTED' && 'changes requested',
    pr.reviewDecision === 'REVIEW_REQUIRED' && 'human review required (CODEOWNERS)',
    outside.length && `files outside the story's paths: ${outside.join(', ')}`,
    !result && 'no implementor result file',
    result && result.status !== 'done' && `result says ${result.status}`,
    files?.length && !files.includes('CHANGELOG.md') && 'no CHANGELOG entry',
    !mergeUnreviewed && !approval?.ok && (approval?.why ?? 'not reviewed (no results/KEY.approved)'),
  ].filter(Boolean);
}

export function evaluate(input) {
  const reasons = holdReasons(input);
  return { action: mergeAction(reasons), reasons };
}
