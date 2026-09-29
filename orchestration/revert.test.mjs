// Revert first (ADR-0043): finding the first red commit, opening its revert, and reopening its story.
// The git half runs against a temp repository with a bare origin; the GitHub half against a fake gh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseSubject, revertTitle, revertBranch, alreadyReverted, withoutReverted, firstRedCommit, openRevert, revertBody, revertFirst,
} from './revert.mjs';
import { lintPrBody } from '../scripts/check-pr.mjs';
import { verifyRevert } from './merge-bar.mjs';
import { snapshotFrom } from './github.mjs';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null' };
const git = (args, { cwd } = {}) => {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: ENV });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

/** A clone of a bare origin, with a helper to land a commit on main the way a squash merge does. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-revert-test-'));
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  git(['init', '-q', '--bare', '-b', 'main', origin]);
  git(['clone', '-q', origin, work]);
  const io = { git: (args, opts = {}) => git(args, { cwd: work, ...opts }), gh: () => ({ ok: true, out: '', err: '' }) };
  const land = (subject, files) => {
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(join(work, f, '..'), { recursive: true });
      if (text === null) io.git(['rm', '-q', f]); else writeFileSync(join(work, f), text);
    }
    io.git(['add', '-A']);
    io.git(['commit', '-q', '-m', subject]);
    io.git(['push', '-q', 'origin', 'HEAD:main']);
    return io.git(['rev-parse', 'HEAD']).out;
  };
  land('chore(repo): seed (MARXY-1) (#1)', {
    'src/a.txt': 'one\ntwo\nthree\n', 'src/b.txt': 'b\n', 'docs/plan/jira-issues.csv': 'Key\nMARXY-1\n', 'orchestration/deps.json': '{}\n', '.github/CODEOWNERS': '# nobody owns anything here\n',
  });
  io.git(['fetch', '-q', 'origin']);
  const lastLog = () => io.git(['log', 'origin/main', '--first-parent', '--format=%H%x09%P%x09%s']).out.split('\n')
    .map(l => { const [sha, parent, ...s] = l.split('\t'); return { sha, parent: parent.split(' ')[0], subject: s.join('\t') }; });
  const sync = () => io.git(['fetch', '-q', 'origin']);
  return { io, work, origin, land, lastLog, sync };
}

const STORY = 'feat(x): change a line (MARXY-7) (#12)';
const storyFiles = { 'src/a.txt': 'one\nTWO\nthree\n', 'changelog.d/MARXY-7.md': 'Lines can be changed (MARXY-7)\n', 'docs/plan/jira-issues.csv': 'Key\nMARXY-1\nMARXY-7\n', 'orchestration/deps.json': '{"7":1}\n' };
const run = (conclusion, headSha, n = 1) => ({ conclusion, headSha, url: `https://github.com/inkstrata/marxy/actions/runs/${n}` });
const RUN = run('FAILURE', 'f'.repeat(40), 9);

test('the subject names the story and its pull request, and a revert title is the squash subject without the (#n)', () => {
  assert.deepEqual(parseSubject(STORY), { key: 'MARXY-7', pr: 12, text: 'feat(x): change a line (MARXY-7)', isRevert: false });
  assert.equal(parseSubject('revert: feat(x): y (MARXY-7) (#20)').isRevert, true);
  assert.equal(parseSubject('no key here').key, null);
  assert.equal(revertTitle(STORY), 'revert: feat(x): change a line (MARXY-7)');
  const long = `feat(orchestration): ${'word '.repeat(30)}(MARXY-7) (#12)`;
  assert.ok(revertTitle(long).length <= 100 && revertTitle(long).endsWith('(MARXY-7)'));
  assert.equal(revertBranch(STORY), 'revert/MARXY-7-change-a-line');
});

test('a story whose newest subject is a revert is not landed; one that landed again is', () => {
  const subjects = ['feat(x): fix it again (MARXY-7) (#30)', 'revert: feat(x): change a line (MARXY-7) (#20)', STORY, 'feat(x): other (MARXY-8) (#13)'];
  assert.deepEqual(withoutReverted(subjects), subjects, 'landing again keeps the story');
  assert.deepEqual(withoutReverted(subjects.slice(1)), ['feat(x): other (MARXY-8) (#13)'], 'a story whose newest subject is a revert is dropped whole');
  assert.equal(alreadyReverted(STORY, subjects), true);
  assert.equal(alreadyReverted(STORY, [STORY]), false);
});

test('first red commit: green, red, red names the first red one', () => {
  const runs = [run('FAILURE', 'c3'), run('FAILURE', 'c2'), run('SUCCESS', 'c1')];
  const r = firstRedCommit(runs, { parentOf: s => ({ c3: 'c2', c2: 'c1' })[s] });
  assert.deepEqual([r.red, r.sha, r.exact, r.greenRun.headSha], [true, 'c2', true, 'c1']);
});

test('first red commit: a green newest run means main is fine, whatever is older', () => {
  assert.equal(firstRedCommit([run('SUCCESS', 'c3'), run('FAILURE', 'c2'), run('SUCCESS', 'c1')]).red, false);
  assert.equal(firstRedCommit([]).red, false);
});

test('first red commit: a cancelled run is skipped, wherever it sits', () => {
  const parentOf = s => ({ c5: 'c4', c4: 'c3', c3: 'c2' })[s];
  const newest = firstRedCommit([run('CANCELLED', 'c6'), run('FAILURE', 'c5'), run('CANCELLED', 'c4'), run('FAILURE', 'c3'), run('SUCCESS', 'c2')], { parentOf });
  assert.deepEqual([newest.red, newest.sha, newest.exact], [true, 'c3', true]);
  assert.equal(firstRedCommit([run('CANCELLED', 'c2'), run('SUCCESS', 'c1')]).red, false, 'a cancelled newest run is not red');
});

test('first red commit: a commit with no completed run between green and red is not certain', () => {
  const r = firstRedCommit([run('FAILURE', 'c4'), run('CANCELLED', 'c3'), run('SUCCESS', 'c2')], { parentOf: s => ({ c4: 'c3' })[s] });
  assert.deepEqual([r.red, r.sha, r.exact], [true, 'c4', false]);
  assert.match(r.why, /no completed ci run/);
  const none = firstRedCommit([run('FAILURE', 'c2'), run('FAILURE', 'c1')]);
  assert.equal(none.exact, false);
  assert.match(none.why, /no green ci run/);
});

test('the same commit run twice counts once, newest run first', () => {
  const r = firstRedCommit([run('FAILURE', 'c2', 5), run('SUCCESS', 'c2', 4), run('SUCCESS', 'c1', 3)], { parentOf: () => 'c1' });
  assert.deepEqual([r.sha, r.exact], ['c2', true]);
});

test('the revert body is the house template and passes check-pr', () => {
  const body = revertBody({ key: 'MARXY-7', sha: 'a'.repeat(40), subject: 'feat(x): thing (MARXY-7)', run: RUN, jobs: ['fast', 'browser'] });
  assert.deepEqual(lintPrBody(body, { key: 'MARXY-7' }), []);
  assert.match(body, /failing jobs: fast, browser/);
});

test('a clean revert: one branch off main, exactly the inverse plus the fragment, the board rows kept, pushed, one PR', () => {
  const r = repo();
  const sha = r.land(STORY, storyFiles);
  r.sync();
  const calls = [];
  const io = { ...r.io, gh: args => { calls.push(args); return { ok: true, out: 'https://github.com/inkstrata/marxy/pull/40', err: '' }; } };
  const out = openRevert({ io, sha, subject: STORY, run: RUN, jobs: ['fast'] });
  assert.deepEqual([out.ok, out.branch, out.number], [true, 'revert/MARXY-7-change-a-line', 40]);
  r.sync();
  const head = r.io.git(['rev-parse', 'origin/revert/MARXY-7-change-a-line']).out;
  assert.equal(r.io.git(['show', `${head}:src/a.txt`]).out, 'one\ntwo\nthree');
  assert.equal(r.io.git(['show', `${head}:changelog.d/MARXY-7.md`]).out, 'Reverted: Lines can be changed (MARXY-7)');
  assert.match(r.io.git(['show', `${head}:docs/plan/jira-issues.csv`]).out, /MARXY-7/, 'the story keeps its board row');
  assert.match(r.io.git(['log', '-1', '--format=%s', head]).out, /^revert: feat\(x\): change a line \(MARXY-7\)$/);
  assert.match(r.io.git(['log', '-1', '--format=%B', head]).out, new RegExp(`This reverts commit ${sha}`));
  const create = calls.find(a => a[0] === 'pr' && a[1] === 'create');
  assert.deepEqual(create.slice(2, 8), ['--base', 'main', '--head', 'revert/MARXY-7-change-a-line', '--title', 'revert: feat(x): change a line (MARXY-7)']);
  assert.ok(create.includes('--body-file') && !create.includes('--body'));
  assert.deepEqual(verifyRevert({ sha, key: 'MARXY-7', head, git: r.io.git }), { ok: true });
  assert.equal(r.io.git(['worktree', 'list']).out.split('\n').length, 1, 'the throwaway worktree is gone');
  assert.equal(r.io.git(['branch', '--list', 'revert/*']).out, '', 'and so is the local branch');
});

test('a revert that conflicts with a later change is aborted: nothing pushed, no PR, a reason', () => {
  const r = repo();
  const sha = r.land(STORY, storyFiles);
  r.land('feat(x): change it more (MARXY-8) (#13)', { 'src/a.txt': 'one\nTWO!\nthree\n' });
  r.sync();
  const calls = [];
  const out = openRevert({ io: { ...r.io, gh: a => { calls.push(a); return { ok: true, out: '', err: '' }; } }, sha, subject: STORY, run: RUN });
  assert.deepEqual([out.ok, out.conflict, out.files], [false, true, ['src/a.txt']]);
  assert.match(out.why, /does not apply cleanly/);
  assert.deepEqual(calls, []);
  r.sync();
  assert.equal(r.io.git(['branch', '-r', '--list', 'origin/revert/*']).out, '');
  assert.equal(r.io.git(['worktree', 'list']).out.split('\n').length, 1);
});

test('later rows appended to the board files do not stop a revert; the story keeps its own row', () => {
  const r = repo();
  const sha = r.land(STORY, storyFiles);
  r.land('feat(x): another story (MARXY-9) (#14)', { 'docs/plan/jira-issues.csv': 'Key\nMARXY-1\nMARXY-7\nMARXY-9\n' });
  r.sync();
  const out = openRevert({ io: { ...r.io, gh: () => ({ ok: true, out: 'https://github.com/x/y/pull/41', err: '' }) }, sha, subject: STORY, run: RUN });
  assert.equal(out.ok, true);
  r.sync();
  assert.match(r.io.git(['show', 'origin/revert/MARXY-7-change-a-line:docs/plan/jira-issues.csv']).out, /MARXY-9/);
});

// ── the cycle's step, against a fake world ──

const STORIES = () => ({ 'MARXY-7': { status: 'done', pr: 12, attempts: 1 } });
function step({ b = { stories: STORIES() }, open = [], recent = [], mainRed = null, runs = null, log = [], over = {} } = {}) {
  const events = [], said = [], needs = [], notes = [], created = [];
  const io = {
    mainLog: () => log, mainCiRuns: () => runs, runJobs: () => ['fast'],
    board: () => (events[0]?.type === 'story' ? { stories: { [events[0].key]: { status: events[0].to, reopened: events[0].set.reopened } } } : b), writeNotes: (k, t) => notes.push([k, t]),
    git: () => ({ ok: false, out: '', err: '' }), gh: a => { created.push(a); return { ok: true, out: '', err: '' }; }, ...over,
  };
  const snap = snapshotFrom(open, recent);
  revertFirst({
    io, snap, b, mainRed, nowIso: '2026-09-29T10:00:00.000Z', t: { maxAttempts: 2, escalationAttempts: 1 },
    say: l => said.push(l), need: (k, why) => needs.push([k, why]), commitAll: e => events.push(...e),
  });
  return { events, said, needs, notes, created, snap };
}
const LOG = [{ sha: 'c2', parent: 'c1', subject: STORY }, { sha: 'c1', parent: 'c0', subject: 'chore(repo): seed (MARXY-1) (#1)' }];
const REDRUNS = [run('FAILURE', 'c2', 2), run('SUCCESS', 'c1', 1)];

test('main red at a commit the cycle cannot revert (no story key, or itself a revert) asks a person, and opens nothing', () => {
  const noKey = step({ mainRed: RUN, runs: REDRUNS, log: [{ sha: 'c2', parent: 'c1', subject: 'a hand-made commit' }, LOG[1]] });
  assert.match(noKey.needs[0][1], /not a story's squash commit/);
  const rev = step({ mainRed: RUN, runs: REDRUNS, log: [{ sha: 'c2', parent: 'c1', subject: 'revert: feat(x): y (MARXY-7) (#20)' }, LOG[1]] });
  assert.match(rev.needs[0][1], /not a story's squash commit/);
  const unsure = step({ mainRed: RUN, runs: [run('FAILURE', 'c2'), run('SUCCESS', 'c0')], log: LOG });
  assert.match(unsure.needs[0][1], /not certain/);
});

test('a revert already on main is waited for, not opened again', () => {
  const s = step({ mainRed: RUN, runs: REDRUNS, log: [{ sha: 'c3', parent: 'c2', subject: 'revert: feat(x): change a line (MARXY-7) (#20)' }, ...LOG] });
  assert.deepEqual([s.needs, s.created], [[], []]);
  assert.ok(s.said.some(l => /already reverted/.test(l)));
});

test('a merged revert reopens its story with the failure named and the shas kept, and hides itself from settling', () => {
  const b = { stories: { 'MARXY-7': { ...STORIES()['MARXY-7'], revert: { sha: 'c2', pr: 20, subject: 'feat(x): change a line (MARXY-7)', runUrl: RUN.url, jobs: ['fast', 'browser'], originalPr: 12 } } } };
  const log = [{ sha: 'c3', parent: 'c2', subject: 'revert: feat(x): change a line (MARXY-7) (#20)' }, ...LOG];
  const s = step({ b, log, recent: [{ number: 20, headRefName: 'revert/MARXY-7-change-a-line', state: 'MERGED' }, { number: 12, headRefName: 'feat/MARXY-7-x', state: 'MERGED' }] });
  const [e] = s.events;
  assert.deepEqual([e.key, e.from, e.to], ['MARXY-7', 'done', 'todo']);
  assert.match(e.set.returned.why, /ci run https:\/\/github.com\/inkstrata\/marxy\/actions\/runs\/9; failing jobs: fast, browser/);
  assert.deepEqual([e.set.reopened.sha, e.set.reopened.revertSha, e.set.reopened.revertPr], ['c2', 'c3', 20]);
  assert.match(s.notes[0][1], /Do not discard the earlier work/);
  assert.equal(s.snap.recent.length, 0, 'the merged revert PR is not settled as the story again');
  // once reopened (revert unset), the same merged PR reopens nothing more
  const again = step({ b: { stories: { 'MARXY-7': { status: 'done', pr: 30, attempts: 2 } } }, log, recent: [{ number: 20, headRefName: 'revert/MARXY-7-change-a-line', state: 'MERGED' }] });
  assert.deepEqual(again.events, []);
});

test('a story nothing dispatches is blocked for a person instead of todo, and its old PRs are hidden while it is', () => {
  const b = { stories: { 'MARXY-7': { status: 'done', pr: 12, attempts: 1, revert: { sha: 'c2', pr: 20, subject: 's (MARXY-7)', runUrl: RUN.url, jobs: [], originalPr: 12 } } } };
  let dispatchable = false;
  const events = [];
  const snap = snapshotFrom([], [{ number: 20, headRefName: 'revert/MARXY-7-x', state: 'MERGED' }]);
  revertFirst({ io: { mainLog: () => [], board: () => ({ stories: { 'MARXY-7': { status: 'blocked', reopened: { originalPr: 12, revertPr: 20 } } } }), writeNotes() {} }, snap, b, nowIso: 'n', t: { maxAttempts: 2, escalationAttempts: 1 }, dispatchable: () => dispatchable, say() {}, need() {}, commitAll: e => events.push(...e) });
  assert.equal(events[0].to, 'blocked');
  assert.match(events[0].set.parkedReason, /nothing dispatches this story/);
});

test('main red: the revert is opened once, then landed while main is red only because it is the exact inverse', () => {
  const r = repo();
  const sha = r.land(STORY, storyFiles);
  r.sync();
  const created = [], merged = [], said = [], needs = [], events = [];
  const gh = args => {
    if (args[1] === 'create') { created.push(args); return { ok: true, out: 'https://github.com/inkstrata/marxy/pull/40', err: '' }; }
    merged.push(args);
    return { ok: true, out: '', err: '' };
  };
  const b = { stories: STORIES() };
  const green = r.lastLog()[1].sha;
  const call = ({ open = [], mainRed = RUN } = {}) => revertFirst({
    io: { ...r.io, gh, mainLog: r.lastLog, mainCiRuns: () => [run('FAILURE', sha, 2), run('SUCCESS', green, 1)], runJobs: () => ['fast'], board: () => b, writeNotes() {} },
    snap: snapshotFrom(open, []), b, mainRed, nowIso: 'n', t: { maxAttempts: 2, escalationAttempts: 1 },
    say: l => said.push(l), need: (k, why) => needs.push([k, why]), commitAll: e => events.push(...e),
  });
  call();
  assert.equal(created.length, 1);
  assert.deepEqual(events[0].set.revert, { sha, pr: 40, subject: 'feat(x): change a line (MARXY-7)', runUrl: 'https://github.com/inkstrata/marxy/actions/runs/2', jobs: ['fast'], originalPr: 12, at: 'n' });

  r.sync();
  const head = r.io.git(['rev-parse', 'origin/revert/MARXY-7-change-a-line']).out;
  const pr = { number: 40, title: 'revert: feat(x): change a line (MARXY-7)', headRefName: 'revert/MARXY-7-change-a-line', headRefOid: head, state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: '', latestReviews: [], statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }], files: [{ path: 'src/a.txt' }, { path: 'changelog.d/MARXY-7.md' }] };
  call({ open: [pr] });
  assert.equal(created.length, 1, 'an open revert PR is not opened again');
  assert.deepEqual(merged[0].slice(0, 4), ['pr', 'merge', '40', '--squash']);
  assert.ok(merged[0].includes('--match-head-commit') && merged[0].includes(head), 'pinned to the head that was checked');

  // A PR that is not the inverse of the first red commit waits for a person, however green it is.
  merged.length = 0;
  const other = r.land('feat(x): unrelated (MARXY-8) (#13)', { 'src/b.txt': 'changed\n' });
  r.sync();
  call({ open: [{ ...pr, headRefOid: other }] });
  assert.deepEqual(merged, []);
  assert.match(needs.at(-1)[1], /not the exact inverse/);

  // Main went green by itself: an open revert is named, never merged.
  needs.length = 0;
  call({ open: [pr], mainRed: null });
  assert.match(needs[0][1], /main is green again/);
});
