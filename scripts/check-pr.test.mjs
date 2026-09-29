// check-pr.mjs's range check accepts a changelog.d/ fragment, or the transitional CHANGELOG.md
// line, as a story's changelog entry (MARXY-315). Body-shape checks live in
// orchestration/pr-body.test.mjs; this file is the range half's fragment coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintPrRange, checkPr } from './check-pr.mjs';

test('a changelog.d fragment for this key satisfies the range check, with no CHANGELOG.md diff', () => {
  const problems = lintPrRange({
    key: 'MARXY-104',
    changed: ['changelog.d/MARXY-104.md', 'packages/core/src/x.ts'],
    changelogDiff: '',
    readFragment: f => (f === 'changelog.d/MARXY-104.md' ? 'A reader-facing line (MARXY-104)' : null),
  });
  assert.deepEqual(problems.filter(p => /changelog/i.test(p)), []);
});

test('a fragment that is not a single line ending in (KEY) is flagged even though the file exists', () => {
  const problems = lintPrRange({
    key: 'MARXY-104',
    changed: ['changelog.d/MARXY-104.md'],
    changelogDiff: '',
    readFragment: () => 'two lines\nof text (MARXY-104)',
  });
  assert.ok(problems.some(p => /changelog\.d\/MARXY-104\.md is not one reader-facing line/.test(p)));
});

test('a fragment naming the wrong key does not satisfy this story\'s clause', () => {
  const problems = lintPrRange({
    key: 'MARXY-104',
    changed: ['changelog.d/MARXY-1.md'],
    changelogDiff: '',
  });
  assert.ok(problems.some(p => /no changelog entry for MARXY-104/.test(p)));
});

test('during the transition, a CHANGELOG.md Unreleased line still satisfies the range check', () => {
  const problems = lintPrRange({
    key: 'MARXY-104',
    changed: ['CHANGELOG.md'],
    changelogDiff: '- a line for this story (MARXY-104)\n',
  });
  assert.deepEqual(problems.filter(p => /changelog/i.test(p)), []);
});

test('neither a fragment nor a CHANGELOG.md diff line fails with a fix for the fragment path', () => {
  const problems = lintPrRange({ key: 'MARXY-104', changed: ['packages/core/src/x.ts'], changelogDiff: '' });
  assert.ok(problems.some(p => /no changelog entry for MARXY-104/.test(p) && /changelog\.d\/MARXY-104\.md/.test(p)));
});

test('checkPr --range reads a fragment straight off disk when no readFragment is injected', () => {
  const { problems } = checkPr(['--key', 'MARXY-104', '--range'], {
    body: '## Summary\n\nNothing to see. Nothing at all here.\n\n## Changes\n\n- x\n\n## Verification\n\n```\nok\n```\n\n## For the reviewer\n\nMARXY-104\n\n<details>\n\nAcceptance criteria\n\n| Criterion | Checked by |\n| --- | --- |\n| a | a real check |\n\n</details>\n\n## Checklist\n',
    changed: ['packages/core/src/x.ts'],
    changelogDiff: '',
    readFragment: () => null,
  });
  assert.ok(problems.some(p => /no changelog entry for MARXY-104/.test(p)));
});
