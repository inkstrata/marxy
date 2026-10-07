// The lead merges a pull request once it is ready, without waiting for the author
// (docs/plan/roadmap-2026-10/00-orchestration.md §6). Ready means: open, not a draft, based on main,
// no conflicts, every check finished green (the required `ci` among them), no changes requested, and
// a lead verdict of merge that names the current head commit. A push after the verdict makes it stale.
// usage: node scripts/lead-merge.mjs <pr> [--verdict FILE] [--dry-run]
//   --verdict FILE  post FILE as the review comment, with the marker line for the current head
//   --dry-run       print whether the PR is ready and why; merge nothing
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The line a verdict comment carries; the sha binds the verdict to the head it judged. */
export const MARKER_RE = /^lead-verdict:\s*(merge|hold)\s+([0-9a-f]{7,40})\s*$/gim;

export function markerLine(verdict, sha) {
  return `lead-verdict: ${verdict} ${sha}`;
}

const GREEN = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

/** The latest verdict in the comments that names `headSha`, or null. */
export function verdictFor(comments, headSha) {
  let found = null;
  for (const c of comments ?? []) {
    for (const m of String(c.body ?? '').matchAll(MARKER_RE)) {
      if (headSha.startsWith(m[2].toLowerCase())) found = m[1].toLowerCase();
    }
  }
  return found;
}

/** Why a PR (as `gh pr view --json` returns it) is not ready to merge; an empty list means ready. */
export function blockers(pr) {
  const out = [];
  if (pr.state !== 'OPEN') out.push(`state is ${pr.state}`);
  if (pr.isDraft) out.push('it is a draft');
  if (pr.baseRefName !== 'main') out.push(`base is ${pr.baseRefName}, not main (rebase it --onto origin/main and retarget)`);
  if (pr.mergeable !== 'MERGEABLE') out.push(`mergeable is ${pr.mergeable} (conflicts, or GitHub has not computed it yet)`);
  if (pr.reviewDecision === 'CHANGES_REQUESTED') out.push('a review requested changes');
  const checks = pr.statusCheckRollup ?? [];
  const name = c => c.name ?? c.context ?? '?';
  const result = c => (c.conclusion || c.state || c.status || '').toUpperCase();
  const pending = checks.filter(c => c.status && c.status !== 'COMPLETED' || result(c) === 'PENDING' || result(c) === 'EXPECTED');
  if (pending.length) out.push(`checks still running: ${pending.map(name).join(', ')}`);
  const red = checks.filter(c => !pending.includes(c) && !GREEN.has(result(c)));
  if (red.length) out.push(`checks not green: ${red.map(c => `${name(c)} ${result(c)}`).join(', ')}`);
  const ci = checks.find(c => name(c) === 'ci');
  if (!ci) out.push('the required check `ci` has not reported');
  const verdict = verdictFor(pr.comments, pr.headRefOid ?? '');
  if (verdict === null) out.push(`no lead verdict names the head ${String(pr.headRefOid).slice(0, 8)} (a push after the review needs a new one)`);
  else if (verdict !== 'merge') out.push(`the lead verdict for this head is ${verdict}`);
  return out;
}

const FIELDS = 'number,title,state,isDraft,baseRefName,mergeable,reviewDecision,headRefOid,statusCheckRollup,comments';

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function main(argv) {
  const pr = argv.find(a => /^\d+$/.test(a));
  if (!pr) {
    console.error('usage: node scripts/lead-merge.mjs <pr> [--verdict FILE] [--dry-run]');
    return 2;
  }
  const dry = argv.includes('--dry-run');
  const vi = argv.indexOf('--verdict');
  // GitHub computes `mergeable` lazily: the first read after a push is often UNKNOWN.
  const fetchView = () => {
    let v = JSON.parse(gh(['pr', 'view', pr, '--json', FIELDS]));
    for (let i = 0; i < 6 && v.mergeable === 'UNKNOWN'; i++) {
      execFileSync('sleep', ['5']);
      v = JSON.parse(gh(['pr', 'view', pr, '--json', FIELDS]));
    }
    return v;
  };
  let view = fetchView();
  if (vi >= 0) {
    const body = `${readFileSync(argv[vi + 1], 'utf8').trimEnd()}\n\n${markerLine('merge', view.headRefOid)}\n`;
    gh(['pr', 'comment', pr, '--body-file', '-'], { input: body, stdio: ['pipe', 'pipe', 'inherit'] });
    view = fetchView();
  }
  const why = blockers(view);
  if (why.length) {
    console.log(`#${pr} not ready:\n${why.map(w => `  - ${w}`).join('\n')}`);
    return 1;
  }
  if (dry) {
    console.log(`#${pr} ready: ${view.title}`);
    return 0;
  }
  // --match-head-commit refuses the merge if anything was pushed after the checks above.
  gh(['pr', 'merge', pr, '--squash', '--match-head-commit', view.headRefOid]);
  console.log(`#${pr} merged: ${view.title}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)));
