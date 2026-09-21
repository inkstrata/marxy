// Per-file-type default mode (MARXY-37 acceptance: .rs/.ts/.py/.css → Source, .md → Rendered).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultModeForPath } from './default-mode.ts';

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
