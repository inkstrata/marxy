// The handshake is one table: `pnpm done KEY` copies it into the result file, `--open` reads it
// again before letting `gh` run, and a body check-pr would reject never reaches `gh` (MARXY-121).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceFromBody, checkAcceptance, mergeResult, openSteps, runOpen } from '../scripts/done.mjs';
import { openPr } from '../scripts/open-pr.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** A house-shaped PR body with the given acceptance rows filled into the table. */
function fixtureBody(rows, { key = 'MARXY-121', extraSections = true } = {}) {
  const table = rows.map(([c, b]) => `| ${c} | ${b} |`).join('\n');
  return `<!-- Title: chore(ops): one command from green to In Review (${key}) -->

## Summary

This makes the criterion → check table the single source. Filling it once now writes the
result file's acceptance array and opens the pull request.

## Changes

- chore(ops): one command from green to In Review (${key})

${extraSections ? `## Verification

\`\`\`
✓ story boundary (whole branch)
✓ precheck
\`\`\`
` : ''}
## For the reviewer

No trade-offs beyond what the story names.

<details>
<summary>Agent detail</summary>

**Acceptance criteria → checks**

| Criterion | Checked by |
| --- | --- |
${table}

**Files by path**

- \`scripts/done.mjs\`

**Result**

\`\`\`json
{}
\`\`\`

</details>

## Checklist

- [x] Only the story's listed paths are touched
- [x] Every acceptance criterion has a test or gate in this PR
- [x] \`CHANGELOG.md\` has an entry under \`Unreleased\` (${key})
- [ ] Queue entry in \`docs/taste-review/queue.md\` if anything visible changed
- [ ] No contract files changed, or an ADR is included
- [x] No attribution trailers
`;
}

const FILLED_ROWS = [
  ['pnpm done KEY writes the table into acceptance', 'orchestration/done.test.mjs'],
  ['a TODO row stays TODO and exits 1', 'orchestration/done.test.mjs'],
];

test('acceptanceFromBody reads every filled row from the table', () => {
  const body = fixtureBody(FILLED_ROWS);
  assert.deepEqual(acceptanceFromBody(body), [
    { criterion: FILLED_ROWS[0][0], checkedBy: FILLED_ROWS[0][1] },
    { criterion: FILLED_ROWS[1][0], checkedBy: FILLED_ROWS[1][1] },
  ]);
});

test('a fully filled table has no TODO row', () => {
  const { acceptance, todo } = checkAcceptance(fixtureBody(FILLED_ROWS));
  assert.equal(acceptance.length, 2);
  assert.equal(todo, undefined);
});

test('one row still TODO is named and stays TODO in the acceptance array', () => {
  const rows = [...FILLED_ROWS, ['a third criterion nobody checked yet', 'TODO']];
  const { acceptance, todo } = checkAcceptance(fixtureBody(rows));
  assert.equal(acceptance.length, 3);
  assert.ok(todo, 'expected a TODO row');
  assert.equal(todo.criterion, 'a third criterion nobody checked yet');
  // the row is reported, not dropped — "still TODO" is a value in the array, not an omission
  assert.deepEqual(acceptance.at(-1), { criterion: 'a third criterion nobody checked yet', checkedBy: 'TODO' });
});

test('an empty or unfilled checked-by cell also counts as TODO', () => {
  for (const bad of ['', ' ', 'no']) {
    const { todo } = checkAcceptance(fixtureBody([['a criterion', bad]]));
    assert.ok(todo, JSON.stringify(bad));
  }
});

test('mergeResult writes acceptance and pr without disturbing other fields', () => {
  const existing = {
    key: 'MARXY-121', status: 'done', branch: 'chore/MARXY-121-slug',
    gates: { precheck: 'ok' }, acceptance: [{ criterion: 'old', checkedBy: 'TODO' }],
    outsidePaths: [], needsAdr: false, queueEntry: false, notes: 'kept as written by hand',
  };
  const withAcceptance = mergeResult(existing, { acceptance: [{ criterion: 'new', checkedBy: 'orchestration/done.test.mjs' }] });
  assert.deepEqual(withAcceptance.acceptance, [{ criterion: 'new', checkedBy: 'orchestration/done.test.mjs' }]);
  assert.equal(withAcceptance.notes, 'kept as written by hand');
  assert.equal(withAcceptance.status, 'done');
  const withPr = mergeResult(withAcceptance, { pr: 42 });
  assert.equal(withPr.pr, 42);
  assert.equal(withPr.notes, 'kept as written by hand');
});

/** A `gh`/`jiraRun` double that records every call it receives and returns a canned result. */
function recorder(result) {
  const calls = [];
  const fn = argv => { calls.push(argv); return result; };
  fn.calls = calls;
  return fn;
}

test('--open --dry-run prints the four steps and calls neither gh nor jira', () => {
  const body = fixtureBody(FILLED_ROWS);
  const gh = recorder({ ok: true, number: 7, problems: [] });
  const jiraRun = recorder({ status: 0 });
  const outcome = runOpen({ key: 'MARXY-121', body, bodyFile: '/tmp/x.pr.md', dryRun: true, gh, jiraRun });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.dryRun, true);
  assert.deepEqual(outcome.steps, openSteps('MARXY-121'));
  assert.equal(outcome.steps.length, 4);
  assert.match(outcome.steps[0], /git push/);
  assert.match(outcome.steps[1], /open-pr\.mjs MARXY-121/);
  assert.match(outcome.steps[2], /record the PR number/);
  assert.match(outcome.steps[3], /jira\.mjs pr MARXY-121/);
  assert.equal(gh.calls.length, 0);
  assert.equal(jiraRun.calls.length, 0);
});

test('a body check-pr rejects stops --open before gh is invoked', () => {
  // missing house sections and an empty table: check-pr rejects this outright
  const body = '## Summary\n\nToo short.\n';
  const gh = recorder({ ok: true, number: 7, problems: [] });
  const jiraRun = recorder({ status: 0 });
  const outcome = runOpen({ key: 'MARXY-121', body, bodyFile: '/tmp/x.pr.md', gh, jiraRun });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.problems.length > 0);
  assert.equal(gh.calls.length, 0, 'gh must never be called for a body check-pr would reject');
  assert.equal(jiraRun.calls.length, 0);
});

test('a table with a TODO row also stops --open before gh is invoked', () => {
  const body = fixtureBody([...FILLED_ROWS, ['unchecked criterion', 'TODO']]);
  const gh = recorder({ ok: true, number: 7, problems: [] });
  const jiraRun = recorder({ status: 0 });
  const outcome = runOpen({ key: 'MARXY-121', body, gh, jiraRun });
  assert.equal(outcome.ok, false);
  assert.equal(gh.calls.length, 0);
});

test('--open opens the PR, then moves Jira with the PR number it got back', () => {
  const body = fixtureBody(FILLED_ROWS);
  const gh = recorder({ ok: true, number: 99, problems: [] });
  const jiraRun = recorder({ status: 0 });
  const outcome = runOpen({ key: 'MARXY-121', body, bodyFile: '/tmp/x.pr.md', gh, jiraRun });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.number, 99);
  assert.equal(gh.calls.length, 1);
  assert.deepEqual(gh.calls[0].slice(0, 3), ['gh', 'pr', 'create']);
  assert.equal(jiraRun.calls.length, 1);
  assert.deepEqual(jiraRun.calls[0], ['node', 'orchestration/jira.mjs', 'pr', 'MARXY-121', '99']);
});

test('when gh reports no PR number, jira is never called', () => {
  const body = fixtureBody(FILLED_ROWS);
  const gh = recorder({ ok: true, number: null, problems: [] });
  const jiraRun = recorder({ status: 0 });
  const outcome = runOpen({ key: 'MARXY-121', body, bodyFile: '/tmp/x.pr.md', gh, jiraRun });
  assert.equal(outcome.ok, false);
  assert.equal(jiraRun.calls.length, 0);
});

test('when jira exits non-zero, runOpen reports it but the PR was still opened', () => {
  const body = fixtureBody(FILLED_ROWS);
  const gh = recorder({ ok: true, number: 5, problems: [] });
  const jiraRun = recorder({ status: 1 });
  const outcome = runOpen({ key: 'MARXY-121', body, bodyFile: '/tmp/x.pr.md', gh, jiraRun });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.opened, true);
  assert.equal(outcome.number, 5);
});

test('open-pr.mjs openPr returns the number gh printed, via an injected gh', () => {
  const body = fixtureBody(FILLED_ROWS);
  const gh = argv => {
    assert.deepEqual(argv.slice(0, 3), ['gh', 'pr', 'create']);
    return { ok: true, number: 123, problems: [] };
  };
  const result = openPr({ body, key: 'MARXY-121', bodyFile: '/tmp/x.pr.md', gh });
  assert.equal(result.ok, true);
  assert.equal(result.number, 123);
});

test('openPr under --dry-run plans the gh invocation and never calls gh', () => {
  const body = fixtureBody(FILLED_ROWS);
  const gh = recorder({ ok: true, number: 1, problems: [] });
  const result = openPr({ body, key: 'MARXY-121', bodyFile: '/tmp/x.pr.md', dryRun: true, gh });
  assert.equal(result.ok, true);
  assert.equal(result.number, null);
  assert.ok(Array.isArray(result.argv));
  assert.equal(gh.calls.length, 0);
});

test('step 7 of the implementor prompt is the single command pnpm done KEY --open', () => {
  const implementor = readFileSync(join(here, 'prompts/implementor.md'), 'utf8');
  const step7 = implementor.split(/^7\./m)[1]?.split(/^8\./m)[0] ?? '';
  assert.ok(step7, 'implementor.md must have a numbered step 7');
  assert.match(step7, /`pnpm done \{\{KEY\}\} --open`/, 'step 7 must name the single command');
  assert.match(step7, /[Ff]ill(?:ing)?[\s\S]{0,120}table/, 'step 7 must say to fill the table first');
  assert.doesNotMatch(step7, /node scripts\/open-pr\.mjs \{\{KEY\}\}/, 'step 7 must not also tell the implementor to run open-pr.mjs separately');
});

test('opening pushes first: an explicit refspec unless origin/<branch> is current, and a failed push stops gh', async () => {
  const { pushBranch } = await import('../scripts/open-pr.mjs');
  const calls = [];
  const fake = answers => (cmd, args) => { calls.push(args.join(' ')); return answers(args) ?? { status: 0, stdout: '' }; };
  const on = (branch, upstream, ahead) => args =>
    args[0] === 'branch' ? { status: 0, stdout: `${branch}\n` }
    : args[0] === 'rev-parse' ? (upstream ? { status: 0, stdout: `${upstream}\n` } : { status: 128, stdout: '' })
    : args[0] === 'rev-list' ? { status: 0, stdout: `${ahead}\n` }
    : null;
  const refspec = 'push -q -u origin HEAD:refs/heads/fix/MARXY-1-x';
  calls.length = 0;
  assert.equal(pushBranch(fake(on('fix/MARXY-1-x', null, 0))).pushed, true, 'no upstream');
  assert.ok(calls.includes(refspec), calls.join(' | '));
  calls.length = 0;
  assert.equal(pushBranch(fake(on('fix/MARXY-1-x', 'origin/main', 0))).pushed, true, 'tracks origin/main (MARXY-209)');
  assert.ok(calls.includes(refspec), calls.join(' | '));
  assert.ok(!calls.some(c => c.startsWith('rev-list')), 'ahead of origin/main says nothing about the branch');
  calls.length = 0;
  assert.equal(pushBranch(fake(on('fix/MARXY-1-x', 'origin/fix/MARXY-1-x', 2))).pushed, true, 'ahead of its own upstream');
  assert.ok(calls.includes(refspec), calls.join(' | '));
  calls.length = 0;
  assert.equal(pushBranch(fake(on('fix/MARXY-1-x', 'origin/fix/MARXY-1-x', 0))).pushed, false, 'up to date');
  assert.ok(!calls.some(c => c.startsWith('push')));
  for (const branch of ['main', '']) {
    calls.length = 0;
    const r = pushBranch(fake(on(branch, null, 0)));
    assert.equal(r.ok, false, `refuses ${branch || 'detached HEAD'}`);
    assert.ok(!calls.some(c => c.startsWith('push')));
  }
  const ghCalls = [];
  const outcome = openPr({
    body: fixtureBody(FILLED_ROWS), key: 'MARXY-121', bodyFile: 'x',
    gh: argv => { ghCalls.push(argv); return { ok: true, number: 1, problems: [] }; },
    push: () => ({ ok: false, problems: ['git push failed: denied'] }),
  });
  assert.ok(outcome.argv, 'the fixture body passes check-pr, so only the push can stop it');
  assert.equal(outcome.ok, false);
  assert.deepEqual(ghCalls, []);
  assert.match(outcome.problems[0], /push failed/);
});

test('a story branch cut from origin/main, tracking it, still pushes to its own name (MARXY-209)', async () => {
  const { pushBranch } = await import('../scripts/open-pr.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'marxy-push-'));
  try {
    const git = (cwd, ...a) => {
      const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
      assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const remote = join(dir, 'remote.git');
    const work = join(dir, 'work');
    git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
    git(dir, 'clone', '-q', remote, work);
    writeFileSync(join(work, 'a'), 'a\n');
    git(work, 'add', 'a');
    git(work, 'commit', '-q', '-m', 'init');
    git(work, 'push', '-q', 'origin', 'HEAD:main');
    // What out-of-plan.mjs did before --no-track: the branch tracks origin/main, and plain `git push` is refused.
    git(work, 'checkout', '-q', '-b', 'fix/MARXY-1-x', '--track', 'origin/main');
    writeFileSync(join(work, 'b'), 'b\n');
    git(work, 'add', 'b');
    git(work, 'commit', '-q', '-m', 'work');
    const r = pushBranch((cmd, args) => spawnSync(cmd, args, { cwd: work, encoding: 'utf8' }));
    assert.deepEqual(r, { ok: true, pushed: true, problems: [] });
    assert.equal(git(remote, 'rev-parse', 'refs/heads/fix/MARXY-1-x'), git(work, 'rev-parse', 'HEAD'));
    assert.notEqual(git(remote, 'rev-parse', 'refs/heads/main'), git(work, 'rev-parse', 'HEAD'), 'main is untouched');
    assert.equal(git(work, 'rev-parse', '--abbrev-ref', '@{u}'), 'origin/fix/MARXY-1-x');
    assert.equal(pushBranch((cmd, args) => spawnSync(cmd, args, { cwd: work, encoding: 'utf8' })).pushed, false, 'second run is a no-op');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('story worktrees are cut from origin/main without tracking it (MARXY-209)', () => {
  for (const file of ['out-of-plan.mjs', 'dispatch.mjs']) {
    const src = readFileSync(join(here, file), 'utf8');
    const adds = src.match(/\['worktree', 'add'[^\]]*\]/g) ?? [];
    assert.ok(adds.length > 0, `${file} creates a worktree`);
    for (const a of adds) assert.match(a, /'--no-track'/, `${file}: ${a}`);
  }
});
