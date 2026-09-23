// One fixture per cardsAndRows failure class; each shown failing the check (MARXY-126).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cardsAndRows, csvRowProblems, loadBoardInput, parseCardMarkdown } from './check-cards.mjs';
import { fail } from './lib/repo.mjs';

const ROOT = process.cwd();

test('fixture: duplicate CSV Key fails and names the key', () => {
  const problems = csvRowProblems([
    { Key: 'MARXY-1', Paths: 'a' },
    { Key: 'MARXY-1', Paths: 'a' },
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /MARXY-1/);
  assert.match(problems[0], /duplicate Key/);
  assert.equal(fail(problems), true);
});

test('fixture: card with no CSV row fails and names the key', () => {
  const problems = cardsAndRows({
    cards: { 'MARXY-999': { depends: [], files: [] } },
    rows: {},
    deps: { phases: {}, deps: {} },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /MARXY-999/);
  assert.match(problems[0], /no row in docs\/plan\/jira-issues\.csv/);
  assert.equal(fail(problems), true);
});

test('fixture: row Paths miss a card file fails and names the key and file', () => {
  const problems = cardsAndRows({
    cards: { 'MARXY-1': { depends: [], files: ['apps/desktop/src/missing.ts'] } },
    rows: { 'MARXY-1': { Paths: 'packages/core' } },
    deps: { phases: { '0': ['MARXY-1'] }, deps: { 'MARXY-1': [] } },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /MARXY-1/);
  assert.match(problems[0], /apps\/desktop\/src\/missing\.ts/);
  assert.equal(fail(problems), true);
});

test('fixture: deps.json key with no CSV row fails and names the key', () => {
  const problems = cardsAndRows({
    cards: {},
    rows: {},
    deps: { phases: { ops: ['MARXY-888'] }, deps: { 'MARXY-888': [] } },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /MARXY-888/);
  assert.match(problems[0], /orchestration\/deps\.json/);
  assert.equal(fail(problems), true);
});

test('fixture: card depends ≠ deps.json fails and names both lists', () => {
  const problems = cardsAndRows({
    cards: { 'MARXY-2': { depends: ['MARXY-11'], files: [] } },
    rows: { 'MARXY-2': { Paths: 'scripts/' } },
    deps: { phases: { '0': ['MARXY-2'] }, deps: { 'MARXY-2': ['MARXY-12'] } },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /MARXY-2/);
  assert.match(problems[0], /MARXY-11/);
  assert.match(problems[0], /MARXY-12/);
  assert.equal(fail(problems), true);
});

test('the committed tree passes check-cards', () => {
  const run = spawnSync(process.execPath, ['scripts/check-cards.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(run.stdout, /check-cards ok/);
});

test('loadBoardInput covers every task card on disk', () => {
  const { cards } = loadBoardInput();
  assert.ok(cards['MARXY-126']);
});

test('card depends keeps MARXY-NEW placeholders so a new story may depend on another new one', () => {
  const card = parseCardMarkdown('---\nkey: MARXY-NEW-b\ndepends: [MARXY-NEW-a, MARXY-94]\n---\n# b\n');
  assert.deepEqual(card.depends, ['MARXY-NEW-a', 'MARXY-94']);
});
