// Fixtures for each cards-vs-rows failure class (MARXY-126).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cardsAndRows, filesFromCard } from './check-cards.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

const row = (Key, Paths) => ({ Key, Paths });
const card = (key, depends, files, path = `docs/plan/tasks/${key}.md`) => ({
  key,
  depends,
  files,
  path,
});

test('fixture: card with no CSV row names the key', () => {
  const problems = cardsAndRows({
    cards: { 'MARXY-999': card('MARXY-999', [], ['scripts/foo.mjs']) },
    rows: [],
    deps: { phases: {}, deps: {} },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /MARXY-999/);
  assert.match(problems[0], /docs\/plan\/tasks\/MARXY-999\.md/);
});

test('fixture: row Paths miss a card file names the key and the file', () => {
  const problems = cardsAndRows({
    cards: {
      'MARXY-1': card('MARXY-1', [], ['packages/core/src/buffer/index.ts', 'scripts/gate.mjs']),
    },
    rows: [row('MARXY-1', 'packages/core/src/buffer')],
    deps: { phases: { 0: ['MARXY-1'] }, deps: { 'MARXY-1': [] } },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /MARXY-1/);
  assert.match(problems[0], /scripts\/gate\.mjs/);
});

test('fixture: deps.json key with no CSV row names the key', () => {
  const problems = cardsAndRows({
    cards: {},
    rows: [],
    deps: { phases: { ops: ['MARXY-888'] }, deps: { 'MARXY-888': [] } },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /MARXY-888/);
  assert.match(problems[0], /deps\.json/);
});

test('fixture: card depends disagrees with deps.json names both lists', () => {
  const problems = cardsAndRows({
    cards: { 'MARXY-2': card('MARXY-2', ['MARXY-1'], ['a/b.ts']) },
    rows: [row('MARXY-2', 'a')],
    deps: { phases: { 0: ['MARXY-2'] }, deps: { 'MARXY-2': ['MARXY-3'] } },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /MARXY-2/);
  assert.match(problems[0], /MARXY-1/);
  assert.match(problems[0], /MARXY-3/);
});

test('filesFromCard ignores bullets whose first token has no slash or dot', () => {
  const text = `## Files and signatures
- \`OPERATIONS\` — registry name only
- \`packages/core/x.ts\` — real path
`;
  assert.deepEqual(filesFromCard(text), ['packages/core/x.ts']);
});

test('check-cards.mjs is green over the committed tree', () => {
  const run = spawnSync(process.execPath, ['scripts/check-cards.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /cards ok \(\d+ task cards\)/);
});
