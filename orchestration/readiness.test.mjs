// Fixture board for the readiness table: same evaluate as merge-bar, same order as 80/81,
// and Ian's CODEOWNERS PRs wait for Ian even when CI is green (MARXY-92).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate as mergeBarEvaluate } from './merge-bar.mjs';
import { computeOrder } from './review-order.mjs';
import {
  evaluate,
  collect,
  tableRows,
  formatText,
  formatJson,
  codeOwnerPatterns,
  ownedBy,
} from './readiness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = '2026-09-18T12:00:00.000Z';
const CREATED = '2026-09-17T12:00:00.000Z';
const green = [
  { name: 'gates (macos-latest)', conclusion: 'SUCCESS' },
  { name: 'gates (ubuntu-latest)', conclusion: 'SUCCESS' },
];

function pr(over = {}) {
  return {
    number: over.number ?? 1,
    title: over.title ?? `feat: x (${over.key ?? 'MARXY-1'})`,
    url: over.url ?? `https://example.test/${over.number ?? 1}`,
    headRefName: over.headRefName ?? `feat/${over.key ?? 'MARXY-1'}`,
    headRefOid: HEAD,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: green,
    createdAt: CREATED,
    author: over.author ?? { login: 'bot' },
    files: over.files ?? [{ path: 'packages/core/src/parse.ts' }, { path: 'CHANGELOG.md' }],
    ...over,
  };
}

function story(key, paths) {
  return { Key: key, Paths: paths, Acceptance: 'observable', Labels: 'phase-0' };
}

test('readiness.mjs binds evaluate to merge-bar.mjs, and a fixture fails if collect calls another', () => {
  const src = readFileSync(join(here, 'readiness.mjs'), 'utf8');
  assert.match(src, /import\s*\{[^}]*\bevaluate\b[^}]*\}\s*from\s*['"]\.\/merge-bar\.mjs['"]/);
  assert.doesNotMatch(src, /function\s+evaluate\s*\(/);
  assert.equal(evaluate, mergeBarEvaluate);

  let calls = 0;
  const spy = input => {
    calls += 1;
    return mergeBarEvaluate(input);
  };
  const rows = collect({
    prs: [pr({ number: 1, key: 'MARXY-1', title: 'feat: x (MARXY-1)' })],
    evaluate: spy,
    verify: () => ({ ok: true, head: HEAD }),
    computeOrder: () => ({ order: [], excluded: [] }),
    readResult: () => ({ status: 'done' }),
    stories: [story('MARXY-1', 'packages/core/src/parse.ts')],
    codeownersText: '',
  });
  assert.equal(calls, 1);
  assert.equal(rows[0].action, 'merge');
});

test('three open PRs print one row each, in the review/merge order 80/81 compute', () => {
  const board = {
    stories: {
      'MARXY-1': { status: 'in_review', pr: 1 },
      'MARXY-2': { status: 'in_review', pr: 2 },
      'MARXY-3': { status: 'in_review', pr: 3 },
    },
  };
  const d = { phases: { 0: ['MARXY-1', 'MARXY-2', 'MARXY-3'] } };
  const pulls = {
    1: { files: ['a.ts', 'CHANGELOG.md'], mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', createdAt: CREATED },
    2: { files: ['a.ts', 'b.ts', 'CHANGELOG.md'], mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', createdAt: CREATED },
    3: { files: ['b.ts', 'CHANGELOG.md'], mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', createdAt: CREATED },
  };
  const readPr = n => pulls[n];
  const now = Date.parse(NOW);
  const expected = computeOrder({ s: board, d, readPr, now });
  const prs = [1, 3, 2].map(n =>
    pr({
      number: n,
      key: `MARXY-${n}`,
      title: `feat: x (MARXY-${n})`,
      url: `https://example.test/${n}`,
      files: pulls[n].files.map(path => ({ path })),
    }),
  );
  const rows = collect({
    prs,
    evaluate,
    verify: () => ({ ok: true, head: HEAD }),
    computeOrder,
    state: board,
    deps: d,
    readPr,
    now,
    readResult: () => ({ status: 'done' }),
    stories: [story('MARXY-1', 'a.ts'), story('MARXY-2', 'a.ts, b.ts'), story('MARXY-3', 'b.ts')],
    codeownersText: '',
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.key), expected.order.map(r => r.key));
  assert.deepEqual(expected.order.map(r => r.key), ['MARXY-2', 'MARXY-1', 'MARXY-3']);
  for (const row of rows) {
    assert.equal(typeof row.url, 'string');
    assert.equal(row.ci, 'green');
    assert.equal(row.mergeable, 'MERGEABLE');
    assert.equal(typeof row.approval, 'string');
    assert.equal(typeof row.waitingOn, 'string');
    assert.equal(typeof row.next, 'string');
  }
});

test('--json prints the same rows as the text table', () => {
  const rows = collect({
    prs: [
      pr({ number: 2, key: 'MARXY-2', title: 'feat: x (MARXY-2)', url: 'https://example.test/2' }),
      pr({ number: 1, key: 'MARXY-1', title: 'feat: x (MARXY-1)', url: 'https://example.test/1' }),
    ],
    evaluate,
    verify: () => ({ ok: true, head: HEAD }),
    computeOrder: () => ({ order: [{ key: 'MARXY-1' }, { key: 'MARXY-2' }], excluded: [] }),
    readResult: () => ({ status: 'done' }),
    stories: [story('MARXY-1', 'packages/core/src/parse.ts'), story('MARXY-2', 'packages/core/src/parse.ts')],
    codeownersText: '',
  });
  const cells = tableRows(rows);
  const parsed = JSON.parse(formatJson(rows));
  const text = formatText(rows);
  assert.deepEqual(parsed, cells);
  assert.equal(parsed.length, 2);
  for (const c of parsed) {
    assert.ok(text.includes(c.url));
    assert.ok(text.includes(c.ci));
    assert.ok(text.includes(c.mergeable));
    assert.ok(text.includes(c.approval));
    assert.ok(text.includes(c.waitingOn));
    assert.ok(text.includes(c.next));
  }
});

test('a PR from Ian touching a CODEOWNERS path waits for Ian even if CI is green', () => {
  const ian = pr({
    number: 9,
    key: 'MARXY-9',
    title: 'feat: x (MARXY-9)',
    author: { login: 'inkstrata' },
    files: [{ path: '.github/workflows/ci.yml' }, { path: 'CHANGELOG.md' }],
    reviewDecision: '',
  });
  const rows = collect({
    prs: [ian],
    evaluate,
    verify: () => ({ ok: true, head: HEAD }),
    computeOrder: () => ({ order: [], excluded: [] }),
    readResult: () => ({ status: 'done' }),
    stories: [story('MARXY-9', '.github/workflows')],
    codeownersText: '/.github/ @inkstrata\n',
  });
  const decision = mergeBarEvaluate({
    pr: ian,
    files: ['.github/workflows/ci.yml', 'CHANGELOG.md'],
    outside: [],
    result: { status: 'done' },
    attribution: false,
    approval: { ok: true, head: HEAD },
  });
  assert.equal(decision.action, 'merge');
  assert.equal(rows[0].ci, 'green');
  assert.equal(rows[0].waitingOn, 'Ian');
  assert.match(rows[0].next, /Ian/);
});

test('CODEOWNERS patterns match directories by prefix and files exactly', () => {
  const p = codeOwnerPatterns('# comment\n/packages/core/src/sanitize/   @inkstrata\n/orchestration/approve.mjs @inkstrata\n');
  assert.ok(ownedBy(p, 'packages/core/src/sanitize/x.ts'));
  assert.ok(ownedBy(p, 'orchestration/approve.mjs'));
  assert.ok(!ownedBy(p, 'orchestration/approve.mjs.bak'));
  assert.ok(!ownedBy(p, 'packages/core/src/parse.ts'));
});

test('the reviewer prompt says to print the table at the end of a merge verdict', () => {
  const text = readFileSync(join(here, 'prompts/reviewer.md'), 'utf8');
  assert.match(text, /readiness\.mjs/);
  assert.match(text, /end of a merge verdict/i);
});
