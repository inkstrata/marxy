// Per-file-type default mode (MARXY-37 acceptance: .rs/.ts/.py/.css → Source, .md → Rendered).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultModeForPath, extensionOf } from './default-mode.ts';

const cases = [
  ['fixtures/corpus/04-source.rs', 'source'],
  ['fixtures/corpus/04-source.ts', 'source'],
  ['fixtures/corpus/04-source.py', 'source'],
  ['fixtures/corpus/04-source.css', 'source'],
  ['fixtures/corpus/01-long-technical.md', 'rendered'],
  ['README.md', 'rendered'],
  ['notes.txt', 'rendered'],
  ['post.mdx', 'rendered'],
];

for (const [path, mode] of cases) {
  test(`defaultModeForPath(${path}) → ${mode}`, () => {
    assert.equal(defaultModeForPath(path), mode);
  });
}

test('a backslash in a folder name does not change the file name', () => {
  assert.equal(defaultModeForPath('/repo/a\\b.rs/readme.md'), 'rendered');
});

// K-05a (ADR-0060 item 8): an extension-less README, CONTRIBUTING, CHANGELOG, CHANGES or HISTORY opens Rendered.
for (const name of ['README', 'readme', 'CONTRIBUTING', 'CHANGELOG', 'CHANGES', 'HISTORY']) {
  test(`defaultModeForPath(/repo/${name}) -> rendered (the extension-less text family)`, () => {
    assert.equal(defaultModeForPath(`/repo/${name}`), 'rendered');
  });
}

for (const path of ['/repo/LICENSE', '/repo/AUTHORS', '/repo/Makefile', '/repo/README.rst', '/repo/README.org', '/repo/README.html', '/repo/.gitignore', '/repo/READMEFIRST', '/repo/notes/README/data.json']) {
  test(`defaultModeForPath(${path}) -> source (not the text family; as before)`, () => {
    assert.equal(defaultModeForPath(path), 'source');
  });
}

// No other file's opening mode changes: every file in the corpus opens as the rule that was here before K-05a said.
test('every corpus file opens in the mode it did before K-05a, but a log (K-08)', () => {
  // K-08: a log is read, so `.log` opens Rendered; nothing else in the corpus changed.
  const before = (path) => (['.md', '.markdown', '.mdx', '.txt', '.log'].includes(extensionOf(path)) ? 'rendered' : 'source');
  const dir = fileURLToPath(new URL('../../../../fixtures/corpus/', import.meta.url));
  const names = readdirSync(dir);
  assert.ok(names.length > 20);
  for (const name of names) assert.equal(defaultModeForPath(`${dir}${name}`), before(`${dir}${name}`), name);
});

// V-09: the mode comes from the one file-type table, so the index's other Markdown and text names open Rendered too.
for (const path of ['/r/a.mdown', '/r/a.mkd', '/r/a.text', '/r/A.MDOWN']) {
  test(`defaultModeForPath(${path}) -> rendered (the index classes it markdown or text)`, () => {
    assert.equal(defaultModeForPath(path), 'rendered');
  });
}

// K-08: a log, and an `.out` that is usually one, open in Read; the other files the table calls source still open in Source.
for (const path of ['/r/build.log', '/r/BUILD.LOG', '/r/make.out']) {
  test(`defaultModeForPath(${path}) -> rendered (a log is read)`, () => {
    assert.equal(defaultModeForPath(path), 'rendered');
  });
}
for (const path of ['/r/data.csv', '/r/rows.tsv', '/r/events.jsonl', '/r/a.html']) {
  test(`defaultModeForPath(${path}) -> source (not read by this story)`, () => {
    assert.equal(defaultModeForPath(path), 'source');
  });
}
