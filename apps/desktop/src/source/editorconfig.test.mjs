// A backslash is part of a folder name on macOS and Linux (C-03.1): .editorconfig is found above `a\b`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTabWidth } from './editorconfig.ts';

test('an .editorconfig above a folder named a\\b is found', async () => {
  const read = async (path) => {
    if (path === '/repo/.editorconfig') return '[*]\nindent_size = 2\n';
    throw new Error('missing');
  };
  assert.equal(await resolveTabWidth('/repo/a\\b/x.rs', '/repo', read), 2);
});

test('a .editorconfig inside a folder named a\\b is read from that folder', async () => {
  const seen = [];
  const read = async (path) => {
    seen.push(path);
    if (path === '/repo/a\\b/.editorconfig') return '[*]\nindent_size = 8\n';
    throw new Error('missing');
  };
  assert.equal(await resolveTabWidth('/repo/a\\b/x.rs', '/repo', read), 8);
  assert.equal(seen[0], '/repo/a\\b/.editorconfig');
});
