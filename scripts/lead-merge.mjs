// The lead merges a pull request once it is ready, without waiting for the author
// (docs/plan/roadmap-2026-10/00-orchestration.md §6). Ready means: open, not a draft, based on main,
// no conflicts, no review required or changes requested, every check finished green with the `ci`
// workflow's check a success, and a merge verdict from the repository owner that names the current head
// commit. A push after the verdict makes it stale; an owner's hold holds whatever is pushed after it.
//
// usage: node scripts/lead-merge.mjs <pr> [--verdict FILE --sha SHA] [--dry-run]
//   --verdict FILE --sha SHA  post FILE as the review comment with the marker for SHA, the head the review
//                             read; refused if SHA is not the PR's head now
//   --dry-run                 say whether the PR is ready and why; post and merge nothing
// exit: 0 merged (or ready, with --dry-run) · 1 not ready · 2 usage · 3 the post or the merge failed
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** The line a verdict comment carries; the sha binds the verdict to the head it judged. */
export const MARKER_RE = /^lead-verdict:\s*(merge|hold)\s+([0-9a-f]{7,40})\s*$/gim;

export function markerLine(verdict, sha) {
  return `lead-verdict: ${verdict} ${sha}`;
}

const GREEN = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

/** Markers in a comment body, ignoring fenced code (a quoted example is not a verdict). */
function markersIn(body) {
  const text = String(body ?? '').replace(/^```[\s\S]*?^```/gm, '');
  return [...text.matchAll(MARKER_RE)].map(m => ({ verdict: m[1].toLowerCase(), sha: m[2].toLowerCase() }));
}

/**
 * The verdict that stands for `headSha`: the owner's latest marker wins. A hold holds any head; a merge
 * counts only for the head it names. Comments by anyone else count for nothing.
 */
export function verdictFor(comments, headSha, owner) {
  const own = (comments ?? []).filter(
    c => owner && c.author?.login && c.author.login.toLowerCase() === owner.toLowerCase(),
  );
  let last = null;
  for (const c of own) for (const m of markersIn(c.body)) last = m;
  if (last === null) return null;
  if (last.verdict === 'hold') return 'hold';
  return headSha.toLowerCase().startsWith(last.sha) ? 'merge' : null;
}

/** Why a PR (as `gh pr view --json` returns it) is not ready to merge; an empty list means ready. */
export function blockers(pr, owner) {
  const out = [];
  if (pr.state !== 'OPEN') out.push(`state is ${pr.state}`);
  if (pr.isDraft) out.push('it is a draft');
  if (pr.baseRefName !== 'main') out.push(`base is ${pr.baseRefName}, not main (rebase it --onto origin/main and retarget)`);
  if (pr.mergeable !== 'MERGEABLE') out.push(`mergeable is ${pr.mergeable} (conflicts, or GitHub has not computed it yet)`);
  if (pr.reviewDecision === 'CHANGES_REQUESTED') out.push('a review requested changes');
  if (pr.reviewDecision === 'REVIEW_REQUIRED') {
    out.push('GitHub requires a review (a code-owned path): this PR waits for the author');
  }
  const checks = pr.statusCheckRollup ?? [];
  const name = c => c.name ?? c.context ?? '?';
  const result = c => (c.conclusion || c.state || '').toUpperCase();
  const isPending = c =>
    (c.status && c.status !== 'COMPLETED') || ['PENDING', 'EXPECTED', ''].includes(result(c));
  const pending = checks.filter(isPending);
  if (pending.length) out.push(`checks still running: ${pending.map(name).join(', ')}`);
  const red = checks.filter(c => !isPending(c) && !GREEN.has(result(c)));
  if (red.length) out.push(`checks not green: ${red.map(c => `${name(c)} ${result(c)}`).join(', ')}`);
  const ci = checks.filter(c => c.__typename === 'CheckRun' && c.name === 'ci' && (c.workflowName ?? 'ci') === 'ci');
  if (ci.length === 0) out.push('the required check `ci` has not reported');
  else if (!ci.every(c => c.status === 'COMPLETED' && c.conclusion === 'SUCCESS')) {
    out.push(`the required check \`ci\` is ${ci.map(result).join(', ')}, not SUCCESS`);
  }
  const verdict = verdictFor(pr.comments, pr.headRefOid ?? '', owner);
  if (verdict === null) out.push(`no merge verdict from ${owner} names the head ${String(pr.headRefOid).slice(0, 8)} (a push after the review needs a new one)`);
  else if (verdict === 'hold') out.push(`${owner} holds this PR (lead-verdict: hold)`);
  return out;
}

const FIELDS = 'number,title,state,isDraft,baseRefName,mergeable,reviewDecision,headRefOid,statusCheckRollup,comments';

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function main(argv) {
  const pr = argv.find(a => /^\d+$/.test(a));
  const vi = argv.indexOf('--verdict');
  const si = argv.indexOf('--sha');
  const dry = argv.includes('--dry-run');
  if (!pr || (vi >= 0) !== (si >= 0) || (vi >= 0 && dry)) {
    console.error('usage: node scripts/lead-merge.mjs <pr> [--verdict FILE --sha SHA] [--dry-run]');
    return 2;
  }
  const owner = JSON.parse(gh(['repo', 'view', '--json', 'owner'])).owner.login;
  // GitHub computes `mergeable` lazily: the first read after a push is often UNKNOWN.
  const fetchView = () => {
    let v = JSON.parse(gh(['pr', 'view', pr, '--json', FIELDS]));
    for (let i = 0; i < 6 && v.mergeable === 'UNKNOWN'; i++) {
      sleep(5000);
      v = JSON.parse(gh(['pr', 'view', pr, '--json', FIELDS]));
    }
    return v;
  };
  let view = fetchView();
  if (vi >= 0) {
    const sha = String(argv[si + 1] ?? '').toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(sha) || !view.headRefOid.startsWith(sha)) {
      console.error(`#${pr}: the reviewed head ${sha || '(none)'} is not the PR's head ${view.headRefOid.slice(0, 8)}; review the new head`);
      return 3;
    }
    const body = `${readFileSync(argv[vi + 1], 'utf8').trimEnd()}\n\n${markerLine('merge', view.headRefOid)}\n`;
    try {
      gh(['pr', 'comment', pr, '--body-file', '-'], { input: body, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      console.error(`#${pr}: posting the verdict failed: ${String(e.stderr || e.message).trim()}`);
      return 3;
    }
    view = fetchView();
  }
  const why = blockers(view, owner);
  if (why.length) {
    console.log(`#${pr} not ready:\n${why.map(w => `  - ${w}`).join('\n')}`);
    return 1;
  }
  if (dry) {
    console.log(`#${pr} ready: ${view.title}`);
    return 0;
  }
  // --match-head-commit refuses the merge if anything was pushed after the checks above.
  try {
    gh(['pr', 'merge', pr, '--squash', '--match-head-commit', view.headRefOid]);
  } catch (e) {
    console.error(`#${pr}: the merge failed: ${String(e.stderr || e.message).trim()}`);
    return 3;
  }
  console.log(`#${pr} merged: ${view.title}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main(process.argv.slice(2)));
