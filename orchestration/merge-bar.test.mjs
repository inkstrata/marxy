import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, mergeArgs, chooseUpdate, worktreeLive, verifyRevert } from './merge-bar.mjs';
import { fileAllowed, allowedFor } from './review.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const green = [
  { name: 'gates (macos-latest)', conclusion: 'SUCCESS' },
  { name: 'gates (ubuntu-latest)', conclusion: 'SUCCESS' },
];

function clean(over = {}) {
  return {
    pr: {
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      reviewDecision: '',
      statusCheckRollup: green,
      headRefOid: HEAD,
      ...over.pr,
    },
    files: ['packages/core/src/parse.ts', 'CHANGELOG.md', `orchestration/results/MARXY-79.json`],
    outside: [],
    result: { status: 'done' },
    attribution: false,
    approval: { ok: true, head: HEAD },
    mergeUnreviewed: false,
    codeowners: '',
    ...over,
  };
}

test('a PR that meets every clause of the quality bar is mergeable', () => {
  const d = evaluate(clean());
  assert.equal(d.action, 'merge');
  assert.deepEqual(d.reasons, []);
});

test('pending CI alone, with a signed approval, enables auto-merge', () => {
  const d = evaluate(clean({
    pr: {
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      reviewDecision: '',
      headRefOid: HEAD,
      statusCheckRollup: [
        { name: 'gates (macos-latest)', conclusion: 'SUCCESS' },
        { name: 'gates (ubuntu-latest)', status: 'IN_PROGRESS' },
      ],
    },
  }));
  assert.equal(d.action, 'auto-merge');
  assert.deepEqual(d.reasons, ['pending: gates (ubuntu-latest)']);
});

test('each missing clause is held and names that clause', () => {
  const cases = [
    [{ pr: { state: 'CLOSED', mergeable: 'MERGEABLE', reviewDecision: '', statusCheckRollup: green, headRefOid: HEAD } }, 'PR is CLOSED'],
    [{ files: [] }, 'could not compute the branch diff, so no boundary check ran'],
    [{ attribution: true }, 'an attribution trailer is in a commit message (AGENTS.md)'],
    [{ pr: { state: 'OPEN', mergeable: 'CONFLICTING', reviewDecision: '', statusCheckRollup: green, headRefOid: HEAD } }, 'conflicts with main'],
    [{ pr: { state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: '', statusCheckRollup: [], headRefOid: HEAD } }, 'no checks have run at all (a PR in conflict never gets a check suite)'],
    [{ pr: { state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: '', statusCheckRollup: [{ name: 'gates (macos-latest)', conclusion: 'FAILURE' }], headRefOid: HEAD } }, 'red: gates (macos-latest)'],
    [{ pr: { state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: green, headRefOid: HEAD } }, 'changes requested'],
    [{ pr: { state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: green, headRefOid: HEAD } }, 'human review required (CODEOWNERS)'],
    [{ outside: ['packages/theme/src/tokens.css'] }, "files outside the story's paths: packages/theme/src/tokens.css"],
    [{ result: null }, 'no implementor result file'],
    [{ result: { status: 'blocked' } }, 'result says blocked'],
    [{ files: ['packages/core/src/parse.ts'] }, 'no CHANGELOG entry'],
    [{ approval: { ok: false, why: 'not reviewed (no results/KEY.approved)' } }, 'not reviewed (no results/KEY.approved)'],
    [{ approval: { ok: false, why: 'the approval is unsigned; run node orchestration/approve.mjs KEY' } }, 'the approval is unsigned; run node orchestration/approve.mjs KEY'],
    [{ approval: { ok: false, why: `the approval is for bbbbbbb, and the PR head is ${HEAD.slice(0, 7)}` } }, `the approval is for bbbbbbb, and the PR head is ${HEAD.slice(0, 7)}`],
  ];
  for (const [over, named] of cases) {
    const d = evaluate(clean(over));
    assert.equal(d.action, 'hold', named);
    assert.ok(d.reasons.includes(named), `expected ${JSON.stringify(d.reasons)} to include ${named}`);
  }
});

test('pending CI plus any hard hold is held, not auto-merged', () => {
  const d = evaluate(clean({
    approval: { ok: false, why: 'not reviewed (no results/KEY.approved)' },
    pr: {
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      reviewDecision: '',
      headRefOid: HEAD,
      statusCheckRollup: [{ name: 'gates (macos-latest)', status: 'QUEUED' }],
    },
  }));
  assert.equal(d.action, 'hold');
  assert.ok(d.reasons.some(r => r.startsWith('pending:')));
  assert.ok(d.reasons.includes('not reviewed (no results/KEY.approved)'));
});

// MARXY-315: a fragment file counts too, keyed off the implementor result, and a fragment for
// a different story does not satisfy this one's clause.
test('a changelog.d fragment named for this result\'s key satisfies clause 8', () => {
  const d = evaluate(clean({
    files: ['packages/core/src/parse.ts', 'changelog.d/MARXY-79.md', 'orchestration/results/MARXY-79.json'],
    result: { status: 'done', key: 'MARXY-79' },
  }));
  assert.equal(d.action, 'merge');
  assert.deepEqual(d.reasons, []);
});

test('a changelog.d fragment for a different story does not satisfy this one\'s clause', () => {
  const d = evaluate(clean({
    files: ['packages/core/src/parse.ts', 'changelog.d/MARXY-1.md', 'orchestration/results/MARXY-79.json'],
    result: { status: 'done', key: 'MARXY-79' },
  }));
  assert.equal(d.action, 'hold');
  assert.ok(d.reasons.includes('no CHANGELOG entry'));
});

test('MARXY_MERGE_UNREVIEWED skips only the approval clause', () => {
  const d = evaluate(clean({ approval: { ok: false, why: 'not reviewed (no results/KEY.approved)' }, mergeUnreviewed: true }));
  assert.equal(d.action, 'merge');
  assert.deepEqual(d.reasons, []);
});

test('reviewer prompt records a signed verdict through fleet.mjs and forbids merging', () => {
  const text = readFileSync(join(here, 'prompts/reviewer.md'), 'utf8');
  assert.match(text, /fleet\.mjs verdict KEY merge/);
  assert.match(text, /sign/);
  assert.match(text, /[Dd]o not run[\s\S]*gh pr merge/);
});

test('implementor prompt forbids writing KEY.approved', () => {
  const text = readFileSync(join(here, 'prompts/implementor.md'), 'utf8');
  assert.match(text, /KEY\.approved/);
});

test('orchestrator prompt lands merges through the cycle, not gh pr merge', () => {
  const text = readFileSync(join(here, 'prompts/orchestrator.md'), 'utf8');
  assert.match(text, /fleet\.mjs verdict/);
  assert.match(text, /cycle\.mjs/);
  assert.doesNotMatch(text, /gh pr merge/);
});

test('every merge is pinned to the evaluated head, direct or auto', () => {
  const direct = mergeArgs(41, HEAD);
  const auto = mergeArgs(41, HEAD, { auto: true });
  for (const a of [direct, auto]) {
    const i = a.indexOf('--match-head-commit');
    assert.ok(i > 0, 'pinned');
    assert.equal(a[i + 1], HEAD);
    assert.ok(a.includes('--squash'));
  }
  assert.ok(auto.includes('--auto'));
  assert.ok(!direct.includes('--auto'));
  const queued = mergeArgs(41, HEAD, { queue: true });
  assert.ok(queued.includes('--auto'), 'queue lands through --auto so GitHub enqueues');
  assert.ok(queued.includes('--match-head-commit'));
  assert.throws(() => mergeArgs(41, ''), /without a head/);
});

test('chooseUpdate refreshes one BEHIND PR, the oldest that would otherwise land', () => {
  const pick = chooseUpdate([
    { key: 'B', number: 30, reasons: [] },
    { key: 'A', number: 21, reasons: ['pending: ci'] },
    { key: 'C', number: 12, reasons: ['human review required (CODEOWNERS)'] },
    { key: 'D', number: 9, reasons: ['not reviewed (no results/KEY.approved)'] },
    { key: 'E', number: 5, reasons: [], live: true },
  ]);
  assert.equal(pick.key, 'A');
  assert.equal(chooseUpdate([{ key: 'C', number: 1, reasons: ['red: ci'] }]), null);
  assert.equal(chooseUpdate([]), null);
  assert.equal(chooseUpdate([{ key: 'A', number: 21, reasons: ['pending: ci'] }], { queue: true }), null);
});

test('a worktree is live only with uncommitted changes or recent git activity', () => {
  const now = 10 * 3_600_000;
  assert.equal(worktreeLive({ exists: false, dirty: true, nowMs: now }), false);
  assert.equal(worktreeLive({ exists: true, dirty: true, lastActivityMs: 0, nowMs: now }), true);
  assert.equal(worktreeLive({ exists: true, dirty: false, lastActivityMs: now - 60_000, nowMs: now, windowMinutes: 45 }), true);
  assert.equal(worktreeLive({ exists: true, dirty: false, lastActivityMs: now - 3_600_000, nowMs: now, windowMinutes: 45 }), false, 'a leftover worktree is not a live implementor');
  assert.equal(worktreeLive({ exists: true, dirty: false, lastActivityMs: null, nowMs: now }), false);
});

test('no branch may carry an approval file, whatever directory allows it', () => {
  const story = { Key: 'MARXY-1', Paths: 'orchestration/results, packages/core' };
  const allowed = allowedFor(story, 'MARXY-1');
  const cycle = readFileSync(join(here, 'cycle.mjs'), 'utf8');
  // review.mjs lists the results directory; cycle.mjs still treats .approved as outside.
  assert.match(cycle, /\/\\.approved\$\/\.test\(f\)/);
  assert.equal(fileAllowed('orchestration/results/MARXY-1.json', allowed), true);
  assert.equal(fileAllowed('packages/core/src/x.ts', allowed), true);
  assert.ok(!allowed.some(a => /\.approved$/.test(a)), 'allowedFor does not list a .approved path');
});

test('cycle.mjs judges boundaries with review.mjs fileAllowed and allowedFor, the packet the reviewer reads', () => {
  const text = readFileSync(join(here, 'cycle.mjs'), 'utf8');
  assert.match(text, /import \{ allowedFor, fileAllowed[^}]*\} from '\.\/review\.mjs'/);
  assert.match(text, /allowedFor\(row, key\)/);
  assert.match(text, /fileAllowed\(f, allowed\)/);
});

test('minimal compute still allows the same model for reviewer and implementor', () => {
  const models = JSON.parse(readFileSync(join(here, 'models.json'), 'utf8'));
  assert.equal(models.modes.minimal.reviewer.model, models.modes.minimal.implementor.model);
  assert.equal(existsSync(join(here, 'models.test.mjs')), false);
});

// Two-dot against origin/main (then main): an empty hunk must skip so a later
// PR is not required to re-add a finished story's CHANGELOG line.
const STORY_KEY = /MARXY-\d+/;

function storyKeyFromRef(ref) {
  const m = String(ref).match(STORY_KEY);
  return m ? m[0] : null;
}

// actions/checkout leaves HEAD detached, so rev-parse --abbrev-ref is the
// literal HEAD and not a MARXY-n key.
function storyRefForChangelog({ gitRef, env = process.env } = {}) {
  for (const ref of [env.GITHUB_HEAD_REF, env.GITHUB_REF_NAME, gitRef]) {
    if (ref && storyKeyFromRef(ref)) return String(ref);
  }
  return null;
}

function diffContentLines(diff, sign) {
  return String(diff).split('\n').filter(l => {
    if (sign === '+') return l.startsWith('+') && !l.startsWith('+++');
    return l.startsWith('-') && !l.startsWith('---');
  });
}

function gitChangelogDiff(cwd) {
  for (const base of ['origin/main', 'main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', base], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return execFileSync('git', ['diff', base, '--', 'CHANGELOG.md'], {
        cwd,
        encoding: 'utf8',
      });
    } catch {
      // shallow CI checkouts often have only one of these
    }
  }
  return null;
}

/** @returns {'skip' | 'ok'} */
function changelogHunkVerdict(diff, branch) {
  const added = diffContentLines(diff, '+');
  const deleted = diffContentLines(diff, '-');
  const addedStories = added.filter(l => STORY_KEY.test(l));
  if (addedStories.length === 0) return 'skip';
  const key = storyKeyFromRef(branch);
  assert.ok(key, `branch ${branch} has no MARXY-n key`);
  assert.ok(addedStories.some(l => l.includes(key)), `CHANGELOG hunk must add ${key}`);
  assert.equal(
    deleted.filter(l => STORY_KEY.test(l)).length,
    0,
    'CHANGELOG hunk must not delete a MARXY-n line',
  );
  return 'ok';
}

test('this file does not pin the CHANGELOG hunk to a hard-coded story key', () => {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.doesNotMatch(text, /added\.some\(\s*l\s*=>\s*\/MARXY-\d+\//);
});

test('an empty CHANGELOG hunk, or one with no added story line, skips', () => {
  assert.equal(changelogHunkVerdict('', 'fix/MARXY-99-slug'), 'skip');
  assert.equal(changelogHunkVerdict('diff --git a/CHANGELOG.md b/CHANGELOG.md\n', 'fix/MARXY-99-slug'), 'skip');
  const noStory = [
    '--- a/CHANGELOG.md',
    '+++ b/CHANGELOG.md',
    '@@ -1,1 +1,1 @@',
    '-# Changelog',
    '+# Changelog ',
  ].join('\n');
  assert.equal(changelogHunkVerdict(noStory, 'fix/MARXY-99-slug'), 'skip');
});

test('a CHANGELOG hunk with added lines requires the branch key and no deleted story line', () => {
  const ok = ['@@ -8,0 +9,1 @@', '+- A line for this story (MARXY-99)'].join('\n');
  assert.equal(changelogHunkVerdict(ok, 'fix/MARXY-99-stop-the-standing-check'), 'ok');
  const otherKey = ['@@ -8,0 +9,1 @@', '+- A line for another story (MARXY-12)'].join('\n');
  assert.throws(() => changelogHunkVerdict(otherKey, 'fix/MARXY-99-slug'), /MARXY-99/);
  const deleted = [
    '@@ -9,1 +9,1 @@',
    '-- A finished story (MARXY-12)',
    '+- This story (MARXY-99)',
  ].join('\n');
  assert.throws(() => changelogHunkVerdict(deleted, 'fix/MARXY-99-slug'), /delete/);
});

test('a detached checkout with a CHANGELOG story line accepts GITHUB_HEAD_REF', () => {
  const ok = ['@@ -8,0 +9,1 @@', '+- A line for this story (MARXY-99)'].join('\n');
  const branch = storyRefForChangelog({
    gitRef: 'HEAD',
    env: { GITHUB_HEAD_REF: 'fix/MARXY-99-slug', GITHUB_REF_NAME: 'HEAD' },
  });
  assert.equal(storyKeyFromRef(branch), 'MARXY-99');
  assert.equal(changelogHunkVerdict(ok, branch), 'ok');
});

test('GITHUB_REF_NAME supplies the key when HEAD is detached and GITHUB_HEAD_REF is empty', () => {
  const branch = storyRefForChangelog({
    gitRef: 'HEAD',
    env: { GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'fix/MARXY-99-slug' },
  });
  assert.equal(storyKeyFromRef(branch), 'MARXY-99');
});

test('storyRefForChangelog is null when neither git nor GitHub refs yield a MARXY-n key', () => {
  assert.equal(storyRefForChangelog({ gitRef: 'HEAD', env: {} }), null);
  assert.equal(
    storyRefForChangelog({ gitRef: 'HEAD', env: { GITHUB_HEAD_REF: '', GITHUB_REF_NAME: '42/merge' } }),
    null,
  );
});

test('CHANGELOG hunk adds this story and deletes no other story line', t => {
  const cwd = join(here, '..');
  const diff = gitChangelogDiff(cwd);
  if (diff === null) {
    t.skip('neither origin/main nor main is a resolvable git ref');
    return;
  }
  const gitRef = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const branch = storyRefForChangelog({ gitRef });
  if (!branch) {
    t.skip('no MARXY-n key from git or GITHUB_HEAD_REF / GITHUB_REF_NAME');
    return;
  }
  if (changelogHunkVerdict(diff, branch) === 'skip') {
    t.skip('no added CHANGELOG story line vs origin/main or main');
  }
});

// MARXY-172: live protection is require_code_owner_reviews: true with required_approving_review_count: 0.
// Under that pairing GitHub sets reviewDecision to '' (never REVIEW_REQUIRED), so the bar has to work
// out ownership itself.
const OWNERS = '/orchestration/merge-bar.mjs @inkstrata\n/.github/ @inkstrata\n/packages/core/src/sanitize/ @inkstrata\n';
const owned = files => ({ codeowners: OWNERS, files: [...files, 'CHANGELOG.md', 'orchestration/results/MARXY-79.json'] });
const review = (login, state, oid = HEAD) => ({ author: { login }, state, commit: { oid } });
// clean() replaces `pr` wholesale, so a test that varies one field needs the rest of a clean PR.
const prWith = extra => ({ state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: '', statusCheckRollup: green, headRefOid: HEAD, ...extra });

test('a CODEOWNERS path with no reviewDecision from GitHub still holds for a person', () => {
  const d = evaluate(clean(owned(['orchestration/merge-bar.mjs'])));
  assert.equal(d.action, 'hold');
  assert.equal(d.reasons.filter(r => /human review required/.test(r)).length, 1);
  assert.match(d.reasons.join('\n'), /human review required \(CODEOWNERS\): orchestration\/merge-bar\.mjs/);
});

test('an approval by the code owner on the merged head releases the hold', () => {
  const pr = prWith({ latestReviews: [review('inkstrata', 'APPROVED')] });
  assert.equal(evaluate(clean({ ...owned(['.github/workflows/ci.yml']), pr })).action, 'merge');
});

test('an owner approval is case-insensitive on the login', () => {
  const pr = prWith({ latestReviews: [review('InkStrata', 'APPROVED')] });
  assert.equal(evaluate(clean({ ...owned(['.github/workflows/ci.yml']), pr })).action, 'merge');
});

test('an owner approval of an older commit does not cover the head', () => {
  const pr = prWith({ latestReviews: [review('inkstrata', 'APPROVED', 'b'.repeat(40))] });
  assert.equal(evaluate(clean({ ...owned(['.github/workflows/ci.yml']), pr })).action, 'hold');
});

test('an approval by someone who is not an owner does not count', () => {
  const pr = prWith({ latestReviews: [review('some-agent', 'APPROVED')] });
  assert.equal(evaluate(clean({ ...owned(['packages/core/src/sanitize/x.ts']), pr })).action, 'hold');
});

test('the latest review being CHANGES_REQUESTED or DISMISSED is not an approval', () => {
  for (const state of ['CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED']) {
    const pr = prWith({ latestReviews: [review('inkstrata', state)] });
    assert.equal(evaluate(clean({ ...owned(['.github/workflows/ci.yml']), pr })).action, 'hold', state);
  }
});

test('a PR that touches no owned path is not held by CODEOWNERS', () => {
  assert.equal(evaluate(clean(owned(['packages/core/src/parse.ts']))).action, 'merge');
});

test('one unapproved owned file holds a PR that also touches unowned ones', () => {
  const d = evaluate(clean(owned(['packages/core/src/parse.ts', 'orchestration/merge-bar.mjs'])));
  assert.equal(d.action, 'hold');
  assert.match(d.reasons.join('\n'), /merge-bar\.mjs/);
  assert.doesNotMatch(d.reasons.join('\n'), /parse\.ts/);
});

test('an unreadable or missing CODEOWNERS holds instead of treating the repo as unowned', () => {
  for (const codeowners of [null, undefined]) {
    const d = evaluate(clean({ codeowners }));
    assert.equal(d.action, 'hold');
    assert.match(d.reasons.join('\n'), /could not read \.github\/CODEOWNERS/);
  }
});

test('MARXY_MERGE_UNREVIEWED waives the signed approval, never the code owner', () => {
  const d = evaluate(clean({ ...owned(['orchestration/merge-bar.mjs']), mergeUnreviewed: true, approval: { ok: false } }));
  assert.equal(d.action, 'hold');
  assert.match(d.reasons.join('\n'), /human review required/);
});

test('GitHub REVIEW_REQUIRED still holds, and is not reported twice beside our own reason', () => {
  const d = evaluate(clean({ ...owned(['orchestration/merge-bar.mjs']), pr: prWith({ reviewDecision: 'REVIEW_REQUIRED' }) }));
  assert.equal(d.reasons.filter(r => /human review required/.test(r)).length, 1);
  assert.equal(evaluate(clean({ pr: prWith({ reviewDecision: 'REVIEW_REQUIRED' }) })).action, 'hold');
});

test('the repo\'s real CODEOWNERS holds the files that decide a merge', () => {
  const real = readFileSync(join(here, '..', '.github', 'CODEOWNERS'), 'utf8');
  for (const file of ['orchestration/merge-bar.mjs', 'orchestration/cycle.mjs', 'orchestration/approve.mjs', '.github/workflows/ci.yml', 'packages/core/src/sanitize/index.ts']) {
    const d = evaluate(clean({ codeowners: real, files: [file, 'CHANGELOG.md'] }));
    assert.equal(d.action, 'hold', file);
  }
  assert.equal(evaluate(clean({ codeowners: real, files: ['packages/core/src/parse.ts', 'CHANGELOG.md'] })).action, 'merge');
});

// ── revert pull requests (ADR-0043) ──

test('an exact-inverse revert needs no signature, result file or story paths, and may land while main is red', () => {
  const d = evaluate(clean({
    approval: undefined, result: null, outside: ['src/a.txt'], files: ['src/a.txt', 'changelog.d/MARXY-7.md'],
    revert: { ok: true, sha: 'c'.repeat(40), key: 'MARXY-7' },
  }));
  assert.equal(d.action, 'merge');
  assert.equal(d.landsOnRedMain, true);
});

test('a revert that is not the exact inverse is held to the whole bar, and says why', () => {
  const d = evaluate(clean({ approval: undefined, result: null, outside: ['src/a.txt'], revert: { ok: false, sha: 'c'.repeat(40), key: 'MARXY-7', why: 'the tree differs from a plain revert in src/b.txt' } }));
  assert.equal(d.action, 'hold');
  assert.equal(d.landsOnRedMain, false);
  assert.deepEqual(d.reasons.filter(r => /inverse|outside|implementor result|reviewed/.test(r)).length, 4);
  assert.match(d.reasons.join('|'), /not the exact inverse of ccccccc: the tree differs/);
});

test('an exact-inverse revert still waits on red or pending checks, CODEOWNERS and its changelog line', () => {
  const inv = { ok: true, sha: 'c'.repeat(40), key: 'MARXY-7' };
  assert.match(evaluate(clean({ revert: inv, approval: undefined, pr: { statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE' }] } })).reasons.join(), /red: ci/);
  assert.equal(evaluate(clean({ revert: inv, approval: undefined, files: ['src/a.txt', 'changelog.d/MARXY-7.md'], pr: { state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: '', headRefOid: HEAD, statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS' }] } })).action, 'auto-merge');
  assert.match(evaluate(clean({ revert: inv, approval: undefined, files: ['src/a.txt'] })).reasons.join(), /no CHANGELOG entry/);
  assert.match(evaluate(clean({ revert: inv, approval: undefined, files: ['src/a.txt', 'changelog.d/MARXY-7.md'], codeowners: '/src/ @owner\n' })).reasons.join(), /CODEOWNERS/);
});

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' };
function revertRepo() {
  const cwd = mkdtempSync(join(tmpdir(), 'marxy-verify-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: ENV });
    return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
  };
  const write = files => { for (const [f, t] of Object.entries(files)) { mkdirSync(join(cwd, f, '..'), { recursive: true }); writeFileSync(join(cwd, f), t); } };
  const commit = (msg, files) => { write(files); git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD').out; };
  git('init', '-q', '-b', 'main');
  commit('seed', { 'src/a.txt': 'one\ntwo\n', 'src/b.txt': 'b\n', 'docs/plan/jira-issues.csv': 'Key\n', 'orchestration/deps.json': '{}\n' });
  const sha = commit('story', { 'src/a.txt': 'one\nTWO\n', 'changelog.d/MARXY-7.md': 'Two is loud (MARXY-7)\n', 'docs/plan/jira-issues.csv': 'Key\nMARXY-7\n' });
  git('update-ref', 'refs/remotes/origin/main', sha);
  /** A branch off main that reverts `sha` by hand, plus whatever `extra` writes on top. */
  const revertBranch = (name, extra = {}) => {
    git('checkout', '-q', '-b', name, sha);
    git('revert', '--no-commit', sha);
    git('checkout', 'HEAD', '--', 'docs/plan/jira-issues.csv');
    write({ 'changelog.d/MARXY-7.md': 'Reverted: Two is loud (MARXY-7)\n', ...extra });
    git('add', '-A');
    git('commit', '-q', '-m', 'revert');
    const head = git('rev-parse', 'HEAD').out;
    git('checkout', '-q', 'main');
    return head;
  };
  return { git: (args) => git(...args), sha, revertBranch };
}

test('verifyRevert: the inverse of the commit, with the fragment rewritten and the board rows kept, is exact', () => {
  const r = revertRepo();
  const head = r.revertBranch('ok');
  assert.deepEqual(verifyRevert({ sha: r.sha, key: 'MARXY-7', head, git: r.git }), { ok: true });
});

test('verifyRevert: anything else in the tree is refused, whatever it is called', () => {
  const r = revertRepo();
  const extra = r.revertBranch('extra', { 'src/b.txt': 'sneaky\n' });
  assert.match(verifyRevert({ sha: r.sha, key: 'MARXY-7', head: extra, git: r.git }).why, /differs from a plain revert in src\/b.txt/);
  const partial = r.revertBranch('partial', { 'src/a.txt': 'one\nTWO\n' });
  assert.match(verifyRevert({ sha: r.sha, key: 'MARXY-7', head: partial, git: r.git }).why, /src\/a.txt/);
  const board = r.revertBranch('board', { 'orchestration/deps.json': '{"7":[]}\n' });
  assert.match(verifyRevert({ sha: r.sha, key: 'MARXY-7', head: board, git: r.git }).why, /board files|differs/);
  const frag = r.revertBranch('frag', { 'changelog.d/MARXY-7.md': 'line one\nline two (MARXY-7)\n' });
  assert.match(verifyRevert({ sha: r.sha, key: 'MARXY-7', head: frag, git: r.git }).why, /not one line/);
});

test('verifyRevert: a different commit, or a head that is not a commit, is not the inverse of the named one', () => {
  const r = revertRepo();
  const head = r.revertBranch('ok2');
  const seed = r.git(['rev-parse', 'HEAD~1']).out;
  assert.equal(verifyRevert({ sha: seed, key: 'MARXY-7', head, git: r.git }).ok, false);
  assert.equal(verifyRevert({ sha: r.sha, key: 'MARXY-7', head: 'nope', git: r.git }).ok, false);
});
