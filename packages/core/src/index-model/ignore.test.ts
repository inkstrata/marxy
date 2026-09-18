// Ignore rules: gitignore syntax, plus a deny list that a `!` cannot undo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIgnored, parseIgnore } from './index.ts';

test('an unanchored *.log rule matches in any directory', () => {
  const rules = parseIgnore('*.log\n');
  assert.equal(isIgnored('debug.log', false, rules), true);
  assert.equal(isIgnored('src/debug.log', false, rules), true);
  assert.equal(isIgnored('src/debug.md', false, rules), false);
});

test('a leading slash anchors the pattern at the ignore file', () => {
  const rules = parseIgnore('/secret.md\n');
  assert.equal(isIgnored('secret.md', false, rules), true);
  assert.equal(isIgnored('docs/secret.md', false, rules), false);
});

test('a trailing slash matches only a directory, and therefore its children', () => {
  const rules = parseIgnore('drafts/\n');
  assert.equal(isIgnored('drafts', true, rules), true);
  assert.equal(isIgnored('drafts/wip.md', false, rules), true);
  assert.equal(isIgnored('drafts.md', false, rules), false);
});

test('a later negation un-ignores a file, but not under a denied directory', () => {
  const rules = parseIgnore('*.md\n!keep.md\n');
  assert.equal(isIgnored('keep.md', false, rules), false);
  assert.equal(isIgnored('drop.md', false, rules), true);
});

test('node_modules stays ignored even when a gitignore tries to un-ignore it', () => {
  const rules = parseIgnore('!node_modules\n!node_modules/**\n');
  assert.equal(isIgnored('node_modules', true, rules), true);
  assert.equal(isIgnored('node_modules/left-pad/index.md', false, rules), true);
});

test('a nested gitignore only applies under its own directory', () => {
  const rules = parseIgnore('*.md\n', 'pkg');
  assert.equal(isIgnored('pkg/readme.md', false, rules), true);
  assert.equal(isIgnored('readme.md', false, rules), false);
});
