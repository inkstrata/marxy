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

test('a backslash escapes a glob character, a leading !, and a trailing space', () => {
  assert.equal(isIgnored('x.md', false, parseIgnore('\\*.md\n')), false);
  assert.equal(isIgnored('*.md', false, parseIgnore('\\*.md\n')), true);
  assert.equal(isIgnored('!a.md', false, parseIgnore('\\!a.md\n')), true);
  assert.equal(isIgnored('a ', false, parseIgnore('a\\ \n')), true);
  assert.equal(isIgnored('a', false, parseIgnore('a\\ \n')), false);
  assert.equal(isIgnored('#n.md', false, parseIgnore('\\#n.md\n')), true);
});

test('[!a] is a negated class and never matches a slash', () => {
  const rules = parseIgnore('[!a].md\n');
  assert.equal(isIgnored('b.md', false, rules), true);
  assert.equal(isIgnored('a.md', false, rules), false);
  assert.equal(isIgnored('!.md', false, rules), true);
});

test('an invalid range drops that rule and leaves the others in force', () => {
  let rules: ReturnType<typeof parseIgnore> = [];
  assert.doesNotThrow(() => {
    rules = parseIgnore('[z-a].md\n*.log\nfoo\\\n');
  });
  assert.equal(isIgnored('a.md', false, rules), false);
  assert.equal(isIgnored('x.log', false, rules), true);
  assert.equal(isIgnored('foo', false, rules), false);
});
