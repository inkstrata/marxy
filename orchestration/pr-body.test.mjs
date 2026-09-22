// check-pr and open-pr must be able to fail: a Cursor-style body, an attribution line,
// and an unfilled acceptance table are the regressions this story exists to keep out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { lintPrBody, lintPrRange } from '../scripts/check-pr.mjs';
import { planOpenPr } from '../scripts/open-pr.mjs';

const HOUSE = `<!-- Title: chore(gates): refuse a PR without the house body (MARXY-104) -->

## Summary

A pull request cannot be opened unless its body follows the house template. The same check
rejects a foreign Test plan heading, an attribution line, and an unfilled acceptance table.

## Changes

- check-pr fails the bodies agents actually write
- open-pr is the only create path

## Verification

A person can feed a Cursor-style body to check-pr and watch it exit 1.

\`\`\`
pnpm test
\`\`\`

## For the reviewer

The create-time gate is the prevention; CI remains the backstop.

<details>
<summary>Agent detail</summary>

**Acceptance criteria → checks**

| Criterion | Checked by |
| --- | --- |
| Cursor-style body fails | orchestration/pr-body.test.mjs |

**Files by path**

- \`scripts/check-pr.mjs\`

**Result**

\`\`\`json
{ "key": "MARXY-104", "status": "done" }
\`\`\`

</details>

## Checklist

- [x] Only the story's listed paths are touched
`;

const CURSOR = `## Summary

Cold start is no longer a 500 ms promise.

## Why

The author ruled we should keep measuring it and resist inflation.

## Acceptance

- ADRs say observation, no ceiling

## Test plan

- [ ] gate:perf selftest stays green
`;

test('a house-template body with a filled table is accepted', () => {
  assert.deepEqual(lintPrBody(HOUSE, { key: 'MARXY-104' }), []);
});

test('a Cursor-style Why / Acceptance / Test plan body is rejected with a fix line', () => {
  const problems = lintPrBody(CURSOR, { key: 'MARXY-104' });
  assert.ok(problems.some(p => p.includes('missing section "## Changes"')));
  assert.ok(problems.some(p => p.includes('missing section "## Verification"')));
  assert.ok(problems.some(p => p.includes('foreign heading "## Test plan"')));
  assert.ok(problems.some(p => p.includes('foreign heading "## Why"')));
  assert.ok(problems.some(p => p.includes('foreign heading "## Acceptance"')));
  assert.ok(problems.some(p => /fix:.*pull_request_template/.test(p)));
});

test('Made with Cursor in an otherwise house body is rejected', () => {
  const problems = lintPrBody(`${HOUSE}\nMade with Cursor\n`, { key: 'MARXY-104' });
  assert.ok(problems.some(p => p.includes('AI attribution')));
});

test('an acceptance row whose Checked by is TODO is rejected', () => {
  const draft = HOUSE.replace(
    '| Cursor-style body fails | orchestration/pr-body.test.mjs |',
    '| Cursor-style body fails | TODO |',
  );
  const problems = lintPrBody(draft, { key: 'MARXY-104' });
  assert.ok(problems.some(p => p.includes('Checked by is unfilled')), problems.join('\n'));
});

test('open-pr does not produce a gh argv for a failing body', () => {
  const bad = planOpenPr({ body: CURSOR, key: 'MARXY-104', bodyFile: 'results/MARXY-104.pr.md' });
  assert.equal(bad.ok, false);
  assert.equal(bad.argv, null);
  const good = planOpenPr({ body: HOUSE, key: 'MARXY-104', title: 'chore(gates): subject (MARXY-104)', bodyFile: 'results/MARXY-104.pr.md' });
  assert.equal(good.ok, true);
  assert.deepEqual(good.argv.slice(0, 3), ['gh', 'pr', 'create']);
  assert.ok(good.argv.includes('--body-file'));
  assert.ok(!good.argv.includes('--body'));
});

test('the check-pr CLI exits 1 on a Cursor-style body and 0 on a house body', () => {
  const failRun = spawnSync(process.execPath, ['scripts/check-pr.mjs', '--key', 'MARXY-104'], {
    encoding: 'utf8',
    input: CURSOR,
  });
  assert.notEqual(failRun.status, 0, failRun.stderr + failRun.stdout);
  assert.match(failRun.stderr, /missing section "## Changes"/);
  assert.match(failRun.stderr, /fix: use \.github\/pull_request_template\.md/);
  const passRun = spawnSync(process.execPath, ['scripts/check-pr.mjs', '--key', 'MARXY-104'], {
    encoding: 'utf8',
    input: HOUSE,
  });
  assert.equal(passRun.status, 0, passRun.stderr + passRun.stdout);
  assert.match(passRun.stdout, /pr ok \(MARXY-104\)/);
});

test('the implementor prompt names open-pr and forbids gh pr create --body', () => {
  const text = readFileSync(new URL('./prompts/implementor.md', import.meta.url), 'utf8');
  assert.match(text, /open-pr\.mjs/);
  assert.match(text, /gh pr create --body/);
  assert.match(text, /Never `gh pr create --body`|never `gh pr create --body`/i);
});

test('a golden change without a queue row fails the range half', () => {
  const problems = lintPrRange({
    key: 'MARXY-104',
    changed: ['packages/core/goldens/01.ast.txt'],
    changelogDiff: '- a line (MARXY-104)\n',
  });
  assert.ok(problems.some(p => p.includes('golden/baseline')));
});
