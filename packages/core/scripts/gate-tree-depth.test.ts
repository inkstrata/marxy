// Criterion 2–4 of MARXY-84: the case list is pinned, the writer-close-late mutant fails, and the
// no-network gate must spawn this harness with no opt-out env var.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  applyWriterMutation,
  depthViolations,
  snapshotsFromHtml,
  WRITER_CLOSE_LATE_MUTATION,
} from './gate-tree-depth.ts';
import {
  TREE_DEPTH_CASES,
  TREE_DEPTH_CASE_COUNT,
} from './tree-depth-cases.ts';
import { sanitizeHtml } from '../src/sanitize/sanitize-html.ts';

const gateAssertions = readFileSync(new URL('./gate-assertions.test.ts', import.meta.url), 'utf8');
const gateTreeDepthMjs = readFileSync(new URL('./gate-tree-depth.mjs', import.meta.url), 'utf8');

test('the case list is exactly 35 shapes, asserted by value', () => {
  assert.equal(TREE_DEPTH_CASES.length, TREE_DEPTH_CASE_COUNT);
  assert.equal(TREE_DEPTH_CASES.length, 35);
  assert.deepEqual(
    TREE_DEPTH_CASES.map((treeCase) => treeCase.id),
    [
      'solidus-anchor-tail',
      'solidus-blockquote-tail',
      'anchor-slash-form',
      'unclosed-anchor-before-paragraph',
      'unclosed-anchor-paragraph-heading',
      'unclosed-em',
      'unclosed-strong',
      'paragraph-in-paragraph',
      'list-item-in-list-item',
      'unordered-list-unclosed-item',
      'ordered-list-unclosed-item',
      'table-cell-only',
      'table-row-and-cell',
      'table-body-row-cell',
      'table-head-row-header',
      'table-foot-row-cell',
      'row-cell-only',
      'cell-only',
      'body-cell-only',
      'table-head-body-row-cell',
      'blockquote-paragraph',
      'definition-list',
      'heading-in-paragraph',
      'table-paragraph-in-cell',
      'nested-emphasis',
      'anchor-emphasis-in-paragraph',
      'table-row-multiple-cells',
      'table-header-cell-row',
      'unclosed-table',
      'list-paragraph-item',
      'horizontal-rule-between-paragraphs',
      'line-break-in-paragraph',
      'table-data-header-same-row',
      'nested-table-in-cell',
      'table-row-unclosed-cell',
    ],
  );
});

test(`mutation ${WRITER_CLOSE_LATE_MUTATION}: a late anchor close is caught by name`, () => {
  const input = '<a href="https://example.com/">t<p>b</p>';
  const { html } = sanitizeHtml(input);
  const live = snapshotsFromHtml(html);
  const mutated = snapshotsFromHtml(applyWriterMutation(html, WRITER_CLOSE_LATE_MUTATION));
  const violations = depthViolations(live, mutated);
  assert.ok(
    violations.some((line) => line.includes('<p>') && line.includes('<a>')),
    `expected a depth violation naming a formatting ancestor, got ${JSON.stringify(violations)}`,
  );
  assert.notDeepEqual(mutated, live, 'the mutant must change the written tree');
});

test('the no-network gate spawns the tree-depth harness with no skip env var', () => {
  assert.match(
    gateAssertions,
    /gate-tree-depth\.mjs/,
    'gate-assertions.test.ts must spawn packages/core/scripts/gate-tree-depth.mjs',
  );
  assert.ok(
    !gateTreeDepthMjs.includes('MARXY_84_SKIP') && !gateTreeDepthMjs.includes('process.env.SKIP'),
    'the harness must not define a skip path that can become the silent default',
  );
  assert.match(gateTreeDepthMjs, /\[webkit, chromium\]/, 'both engines must be driven');
});

test(`mutation ${WRITER_CLOSE_LATE_MUTATION} fails the browser harness with the mutation named in the output`, () => {
  const repoRoot = new URL('../../../', import.meta.url).pathname;
  const depth = spawnSync(process.execPath, ['packages/core/scripts/gate-tree-depth.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, MARXY_84_MUTATION: WRITER_CLOSE_LATE_MUTATION },
  });
  const combined = `${depth.stdout ?? ''}${depth.stderr ?? ''}`;
  assert.notEqual(depth.status, 0, 'the harness must fail when the writer-close-late mutation is active');
  assert.match(combined, new RegExp(`mutation ${WRITER_CLOSE_LATE_MUTATION}`));
});

test('sanitised output is balanced on every pinned shape', () => {
  for (const treeCase of TREE_DEPTH_CASES) {
    const { html } = sanitizeHtml(treeCase.html);
    const open: string[] = [];
    for (const match of html.matchAll(/<(\/?)([A-Za-z][^\s/>]*)[^>]*>/g)) {
      const name = match[2]!.toLowerCase();
      if (match[1] === '/') {
        assert.equal(open.at(-1), name, `${treeCase.id}: </${name}> does not close the open element`);
        open.pop();
        continue;
      }
      if (!['br', 'hr', 'img', 'input', 'wbr', 'col'].includes(name) && !/\/\s*>$/.test(match[0]!)) {
        open.push(name);
      }
    }
    assert.deepEqual(open, [], `${treeCase.id}: elements left open: ${open.join(', ')}`);
  }
});
