// Revert first, then fix (ADR-0043): when main's ci turns red, the cycle finds the first red commit,
// opens a pull request that reverts it, merges that pull request without waiting for a reviewer when
// (and only when) it is exactly the inverse of that commit, and reopens the commit's story with its
// work kept. Everything that reaches outside the process goes through `io`, so revert.test.mjs runs
// the git half against a temp repository and the GitHub half against a fake `gh`.
//
//   io.git(args, { cwd })   → { ok, out, err }     git, in the main checkout unless `cwd` says otherwise
//   io.gh(args)             → { ok, out, err }     gh, in the main checkout
//   io.mainCiRuns()         → runs, newest first   `gh run list --branch main --workflow ci --status completed`
//   io.mainLog()            → commits, newest first  { sha, parent, subject } on origin/main, first parent
//   io.runJobs(run)         → names of the jobs that failed in a run
//   io.writeNotes(key, text)                       the note the next implementor is given
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slug } from './lib.mjs';
import { story, reopenEvents } from './machine.mjs';
import { evaluate, mergeArgs, verifyRevert } from './merge-bar.mjs';
import { bareTitle } from './pr-mark.mjs';
import { snapshotFrom } from './github.mjs';
import { BOARD_FILES } from '../scripts/lib/own-row.mjs';
import { fragmentPath, validFragment } from '../scripts/lib/changelog.mjs';
import { lintPrBody } from '../scripts/check-pr.mjs';

const RED = new Set(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const conclusionOf = r => String(r?.conclusion ?? '').toUpperCase();
const short = sha => String(sha ?? '').slice(0, 7);

/** A squash subject: `type(scope): text (MARXY-n) (#pr)`. `text` keeps the key, drops the `(#pr)`. */
export function parseSubject(subject) {
  const s = String(subject ?? '').trim();
  const m = /^(.*\((MARXY-\d+)\))(?: \(#(\d+)\))?$/.exec(s);
  if (!m) return { key: null, pr: null, text: s, isRevert: false };
  return { key: m[2], pr: m[3] ? Number(m[3]) : null, text: m[1], isRevert: /^revert(\([^)]*\))?!?: /i.test(s) };
}

/** The revert pull request's title, which is the squash subject once it lands: at most 100 characters, key last. */
export function revertTitle(subject) {
  const { key, text } = parseSubject(subject);
  const title = `revert: ${text}`;
  if (!key || title.length <= 100) return title;
  const room = 100 - 'revert: '.length - ` (${key})…`.length;
  return `revert: ${text.replace(/\s*\(MARXY-\d+\)$/, '').slice(0, room).trimEnd()}… (${key})`;
}

/** `revert/KEY-short-slug`: the branch a revert pull request comes from, and how one is recognised. */
export const revertBranch = subject => {
  const { key, text } = parseSubject(subject);
  return `revert/${key}-${slug(text.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').replace(/\s*\(MARXY-\d+\)$/, '')) || 'change'}`;
};
export const isRevertPr = pr => /^revert\/MARXY-\d+-/.test(String(pr?.headRefName ?? ''));
export const revertKeyOf = pr => String(pr?.headRefName ?? '').match(/^revert\/(MARXY-\d+)-/)?.[1] ?? null;

/** Whether main already carries a revert of this commit's subject (a `revert:` squash, newest first list). */
export const alreadyReverted = (subject, subjects) => subjects.some(s => s.startsWith(revertTitle(subject)));

/**
 * Subjects with every story whose newest subject is a revert removed, so `ready.mjs mergedOnMain`
 * does not read a reverted story's original squash as "landed". A story that lands again later has a
 * newer non-revert subject and is kept.
 */
export function withoutReverted(subjects) {
  const reverted = new Set();
  const seen = new Set();
  for (const s of subjects) {
    const { key, isRevert } = parseSubject(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isRevert) reverted.add(key);
  }
  return subjects.filter(s => !reverted.has(parseSubject(s).key));
}

/**
 * The first red commit on main. `runs` is `gh run list` output, newest first, one ci run per commit
 * (MARXY-334); a cancelled run says nothing and is skipped. The first red commit is the oldest red
 * run in the newest streak, and it is exact when the run before it is green and belongs to its
 * parent (`parentOf(sha)`); a commit with no completed run between them could be the culprit.
 * → `{ red: false }` | `{ red: true, sha, run, greenRun, exact, why }`.
 */
export function firstRedCommit(runs, { parentOf } = {}) {
  const seen = new Set();
  const list = (runs ?? []).filter(r => r?.conclusion && r.headSha && conclusionOf(r) !== 'CANCELLED' && !seen.has(r.headSha) && seen.add(r.headSha));
  if (!list.length || !RED.has(conclusionOf(list[0]))) return { red: false };
  let i = 0;
  while (i + 1 < list.length && RED.has(conclusionOf(list[i + 1]))) i++;
  const run = list[i];
  const greenRun = list[i + 1] ?? null;
  if (!greenRun) return { red: true, sha: run.headSha, run, greenRun, exact: false, why: `no green ci run before ${short(run.headSha)} in the ${list.length} runs read` };
  const parent = parentOf ? parentOf(run.headSha) : greenRun.headSha;
  const exact = parent === greenRun.headSha;
  return {
    red: true, sha: run.headSha, run, greenRun, exact,
    ...(exact ? {} : { why: `the last green run (${short(greenRun.headSha)}) is not the parent of the first red one (${short(run.headSha)}), so a commit with no completed ci run sits between them` }),
  };
}

/** The pull request body a revert opens with: the house template, in order, that `check-pr` accepts. */
export function revertBody({ key, sha, subject, run, jobs = [] }) {
  const failing = jobs.length ? `failing jobs: ${jobs.join(', ')}` : 'no failing job could be read';
  return `## Summary

Main's ci went red at ${short(sha)} (${subject}). This reverts that one commit so main is green again; ${key} is reopened afterwards with its work kept, so the fix starts from the code that shipped rather than from nothing.

## Changes

- Reverts ${sha} with \`git revert\`; nothing else in the tree changes.
- ${key}'s rows in \`docs/plan/jira-issues.csv\` and \`orchestration/deps.json\` stay on main, so the story can be dispatched again.
- \`changelog.d/${key}.md\` becomes a "Reverted:" line, because every pull request needs a changelog entry.

## Verification

\`\`\`
ci on main at ${short(sha)}: ${conclusionOf(run) || 'failure'} ${run?.url ?? ''}
${failing}
git revert --no-commit ${short(sha)}: applied
\`\`\`

## For the reviewer

- Opened by the cycle (ADR-0043). It merges without a signature only while its tree is exactly the inverse of ${short(sha)}, which \`merge-bar.mjs\` \`verifyRevert\` checks; anything else waits for a person.
- The board rows and the changelog fragment are the two files allowed to differ from a plain revert, and why.

<details>
<summary>Agent detail</summary>

**Acceptance criteria → checks**

| Criterion | Checked by |
| --- | --- |
| Main goes green again once this lands | the next completed ci run on main |
| The tree is the exact inverse of ${short(sha)} | merge-bar verifyRevert |

**Files by path**

- the files ${short(sha)} changed, and \`changelog.d/${key}.md\`

**Result**

\`\`\`json
{ "key": "${key}", "status": "done" }
\`\`\`

</details>

## Checklist

- [x] Only the reverted commit's files are touched
- [x] \`changelog.d/${key}.md\` has one line ending in \`(${key})\`
- [x] No contract files changed by this pull request itself
- [x] No attribution trailers
`;
}

const unmerged = (git, cwd) => (git(['diff', '--name-only', '--diff-filter=U'], { cwd }).out || '').split('\n').filter(Boolean);

/**
 * Open the revert pull request for `sha`: a fresh branch off origin/main in a throwaway worktree,
 * `git revert --no-commit`, the story's board rows and its changelog fragment fixed up (the two
 * things a plain revert would break), one commit, a push, `gh pr create`. A revert that does not
 * apply cleanly is aborted and reported, never forced. → `{ ok, branch, url, number }` | `{ ok: false, conflict, why, files }`.
 */
export function openRevert({ io, sha, subject, run, jobs = [], base = 'origin/main' }) {
  const { key } = parseSubject(subject);
  const branch = revertBranch(subject);
  const title = revertTitle(subject);
  const dir = mkdtempSync(join(tmpdir(), 'marxy-revert-'));
  const wt = join(dir, 'wt');
  const g = (args, opts = {}) => io.git(args, { cwd: wt, ...opts });
  let added = false;
  try {
    const add = io.git(['worktree', 'add', '--no-track', '-b', branch, wt, base]);
    if (!add.ok) return { ok: false, why: `git worktree add: ${add.err.split('\n')[0]}` };
    added = true;
    const rv = g(['revert', '--no-commit', sha]);
    const board = BOARD_FILES.filter(f => g(['cat-file', '-e', `HEAD:${f}`]).ok);
    const frag = fragmentPath(key);
    if (!rv.ok) {
      const files = unmerged(io.git, wt);
      // A story's board rows and fragment are ours to repair below; a conflict anywhere else is not.
      const other = files.filter(f => !board.includes(f) && f !== frag);
      if (!files.length || other.length) {
        g(['revert', '--abort']);
        return { ok: false, conflict: true, files: other.length ? other : files, why: `git revert ${short(sha)} does not apply cleanly to main${other.length ? `: ${other.join(', ')}` : `: ${rv.err.split('\n')[0]}`}` };
      }
    }
    // The rows stay on main so the reopened story can be dispatched; the fragment says it was reverted.
    if (board.length) g(['checkout', 'HEAD', '--', ...board]);
    const was = g(['show', `${sha}:${frag}`]);
    const said = was.ok && validFragment(was.out, key) ? was.out.trim().slice(0, -`(${key})`.length).trim() : parseSubject(subject).text.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').replace(/\s*\(MARXY-\d+\)$/, '');
    mkdirSync(join(wt, 'changelog.d'), { recursive: true });
    writeFileSync(join(wt, frag), `Reverted: ${said} (${key})\n`);
    g(['add', '-A']);
    const message = `${title}\n\nThis reverts commit ${sha} (${parseSubject(subject).text}), which turned main's ci red: ${run?.url ?? 'no run url'}.\n\nRefs: ${key}\n`;
    const commit = g(['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', message]);
    if (!commit.ok) return { ok: false, why: `git commit: ${(commit.err || commit.out).split('\n')[0]}` };
    const body = revertBody({ key, sha, subject: parseSubject(subject).text, run, jobs });
    const problems = lintPrBody(body, { key });
    if (problems.length) return { ok: false, why: `the revert body fails check-pr: ${problems[0]}` };
    const push = g(['push', 'origin', `${branch}:${branch}`]);
    if (!push.ok) return { ok: false, why: `git push: ${push.err.split('\n')[0]}` };
    const bodyFile = join(dir, 'body.md');
    writeFileSync(bodyFile, body);
    const pr = io.gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body-file', bodyFile]);
    if (!pr.ok) return { ok: false, why: `gh pr create: ${pr.err.split('\n')[0]}` };
    const url = pr.out.split('\n').pop().trim();
    return { ok: true, branch, url, number: Number(url.match(/\/pull\/(\d+)/)?.[1]) || null };
  } finally {
    if (added) io.git(['worktree', 'remove', '--force', wt]);
    io.git(['branch', '-D', branch]);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What the next implementor is told, and what `returned.why` says. */
export const failureText = ({ sha, subject, run, jobs }) =>
  `main went red at ${short(sha)} (${subject}); ci run ${run?.url ?? 'unknown'}; failing jobs: ${jobs?.length ? jobs.join(', ') : 'not readable'}`;

/**
 * The cycle's one revert step (ADR-0043), called once near the main guard. It does three things, each
 * level-triggered: reopens the story of a revert pull request that has merged; when main is red, opens
 * the revert of the first red commit unless one is open or already on main; and merges an open revert
 * pull request that is exactly that commit's inverse, even though main is red. Then it hides revert
 * pull requests from the rest of the cycle, which would otherwise adopt one under the reverted story's
 * key or settle that story Done again from the old squash.
 */
export function revertFirst({ io, snap, b, mainRed, dry = false, noMerge = false, nowIso, t, dispatchable = () => true, say, need, commitAll }) {
  const opens = (snap?.open ?? []).filter(isRevertPr);
  const recent = snap?.recent ?? [];
  const log = io.mainLog ? io.mainLog() : [];

  // 1. A merged revert reopens its story, with the failure and the work kept.
  for (const p of recent.filter(p => p.state === 'MERGED' && /^revert\/MARXY-\d+-/.test(p.headRefName ?? ''))) {
    const key = revertKeyOf(p);
    const rec = b.stories[key];
    if (rec?.status !== 'done' || Number(rec.revert?.pr) !== p.number) continue;
    const revertSha = log.find(c => { const s = parseSubject(c.subject); return s.key === key && s.isRevert; })?.sha ?? null;
    const because = failureText({ sha: rec.revert.sha, subject: rec.revert.subject, run: { url: rec.revert.runUrl }, jobs: rec.revert.jobs });
    commitAll(reopenEvents(key, rec, {
      why: because, t, now: nowIso, dispatchable: dispatchable(key),
      reopened: { at: nowIso, sha: rec.revert.sha, revertSha, revertPr: p.number, originalPr: rec.revert.originalPr ?? null, subject: rec.revert.subject },
    }));
    if (!dry) {
      io.writeNotes(key, `Reopened by the cycle at ${nowIso}: ${because}.\n\nThe change was reverted by PR #${p.number} to make main green. It is applied again on your branch; find what failed in that run, fix it, and open a new PR. Do not discard the earlier work.`);
    }
    say(`${key}: PR #${p.number} reverted ${short(rec.revert.sha)}; the story is reopened with its work kept`);
  }

  // 2. Main is red: revert the first red commit, once.
  const runs = mainRed && io.mainCiRuns ? io.mainCiRuns() : null;
  if (runs) {
    const parents = new Map(log.map(c => [c.sha, c.parent]));
    const first = firstRedCommit(runs, { parentOf: sha => parents.get(sha) });
    const commit = log.find(c => c.sha === first.sha);
    const subject = commit?.subject ?? '';
    const { key, pr: originalPr, isRevert } = parseSubject(subject);
    if (!first.red) { /* the newest completed run is not red after all */ }
    else if (!first.exact) need('main', `main is red, but its first red commit is not certain: ${first.why}; a person reverts or fixes it`);
    else if (!commit || !key || isRevert) need('main', `main went red at ${short(first.sha)}${subject ? ` (${subject})` : ''}, which is not a story's squash commit the cycle can revert; a person reverts or fixes it (${first.run.url})`);
    else if (alreadyReverted(subject, log.map(c => c.subject))) say(`main: ${short(first.sha)} (${key}) is already reverted; waiting for a green ci run`);
    else {
      const open = opens.find(p => revertKeyOf(p) === key);
      if (open) landRevert({ io, pr: open, sha: first.sha, key, dry, noMerge, say, need });
      else if (dry) say(`main: would open a revert of ${short(first.sha)} (${key})`);
      else {
        const jobs = io.runJobs ? io.runJobs(first.run) : [];
        const r = (io.openRevert ?? openRevert)({ io, sha: first.sha, subject, run: first.run, jobs });
        if (!r.ok) need(key, `main is red at ${short(first.sha)} and its revert could not be opened: ${r.why}; a person reverts it (${first.run.url})`);
        else {
          say(`main: opened ${r.url} to revert ${short(first.sha)} (${key})`);
          if (b.stories[key]) commitAll([story(key, { set: { revert: { sha: first.sha, pr: r.number, subject: parseSubject(subject).text, runUrl: first.run.url, jobs, originalPr, at: nowIso } } })]);
          else need(key, `${key} has no board record, so it will not be reopened when ${r.url} merges`);
        }
      }
    }
  } else if (!mainRed) {
    for (const p of opens) need(revertKeyOf(p), `PR #${p.number} reverts a commit but main is green again; close it, or leave it if the revert is still wanted`);
  }

  // 3. Revert pull requests, and the old PRs of reopened stories, are not the rest of the cycle's business.
  const stale = new Set(Object.values(io.board().stories).filter(r => r.reopened && r.status !== 'done').flatMap(r => [r.reopened.originalPr, r.reopened.revertPr]).filter(Boolean));
  const keptRecent = recent.filter(p => !/^revert\//.test(p.headRefName ?? '') && !stale.has(p.number));
  const fresh = snapshotFrom((snap?.open ?? []).filter(p => !isRevertPr(p)), keptRecent);
  for (const p of opens) snap.byNumber.delete(p.number);
  Object.assign(snap, { open: fresh.open, recent: fresh.recent, branchState: fresh.branchState });
}

/** Merge (or enable auto-merge on) an open revert pull request when it is exactly the inverse of `sha`. */
function landRevert({ io, pr, sha, key, dry, noMerge, say, need }) {
  const tag = `${key} revert PR #${pr.number}`;
  const verdict = (io.verifyRevert ?? verifyRevert)({ sha, key, head: pr.headRefOid, git: io.git });
  const codeowners = io.git(['show', 'origin/main:.github/CODEOWNERS']);
  const decision = evaluate({
    pr, files: (pr.files ?? []).map(f => f.path ?? f), codeowners: codeowners.ok ? codeowners.out : null,
    revert: { ...verdict, sha, key },
  });
  if (decision.action === 'hold') {
    say(`${tag}: waiting — ${decision.reasons.join('; ')}`);
    if (decision.reasons.some(r => /CODEOWNERS|not the exact inverse/.test(r))) need(key, `${tag}: ${decision.reasons.join('; ')}`, { gate: /CODEOWNERS/.test(decision.reasons.join(' ')) });
    return;
  }
  if (noMerge || dry) { say(`${tag}: mergeable (not merging: ${dry ? '--dry-run' : '--no-merge'})`); return; }
  const auto = decision.action === 'auto-merge';
  const r = io.gh(mergeArgs(pr.number, pr.headRefOid, { auto, subject: bareTitle(pr.title) }));
  say(r.ok ? `${tag}: ${auto ? 'auto-merge enabled, waiting on CI' : 'merged while main is red (exact inverse of ' + short(sha) + ')'}` : `${tag}: merge failed — ${r.err.split('\n')[0]}`);
}
