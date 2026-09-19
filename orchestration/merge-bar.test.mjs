import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from './merge-bar.mjs';

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

test('MARXY_MERGE_UNREVIEWED skips only the approval clause', () => {
  const d = evaluate(clean({ approval: { ok: false, why: 'not reviewed (no results/KEY.approved)' }, mergeUnreviewed: true }));
  assert.equal(d.action, 'merge');
  assert.deepEqual(d.reasons, []);
});

test('reviewer prompt requires a signed approval and forbids merging', () => {
  const text = readFileSync(join(here, 'prompts/reviewer.md'), 'utf8');
  assert.match(text, /results\/KEY\.approved/);
  assert.match(text, /approve\.mjs/);
  assert.match(text, /[Dd]o not run[\s\S]*gh pr merge/);
});

test('implementor prompt forbids writing KEY.approved', () => {
  const text = readFileSync(join(here, 'prompts/implementor.md'), 'utf8');
  assert.match(text, /KEY\.approved/);
});

test('orchestrator prompt lands merges through the cycle, not gh pr merge', () => {
  const text = readFileSync(join(here, 'prompts/orchestrator.md'), 'utf8');
  assert.match(text, /approve\.mjs/);
  assert.match(text, /cycle\.mjs/);
  assert.doesNotMatch(text, /gh pr merge/);
});

test('cycle.mjs enables GitHub auto-merge when the bar says so', () => {
  const text = readFileSync(join(here, 'cycle.mjs'), 'utf8');
  assert.match(text, /decision\.action === 'auto-merge'/);
  assert.match(text, /'--auto'/);
});
