// A backslash is part of a folder name on macOS and Linux (C-03.1): .editorconfig is found above `a\b`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorConfigCache, globMatch, resolveTabWidth } from './editorconfig.ts';
import { rootFor } from '../index/walk.ts';

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

const reader = (files, seen = []) => async (path) => {
  seen.push(path);
  if (path in files) return files[path];
  throw new Error('missing');
};

test('matching sections merge in file order, later wins, per key', async () => {
  const read = reader({ '/repo/.editorconfig': '[*]\nindent_size = 2\ntab_width = 6\n[*.go]\nindent_size = 8\n' });
  // tab_width from [*] survives; the later [*.go] only overrides indent_size.
  assert.equal(await resolveTabWidth('/repo/a.go', '/repo', read), 6);
  const read2 = reader({ '/repo/.editorconfig': '[*.go]\nindent_size = 8\n[*]\nindent_size = 2\n' });
  assert.equal(await resolveTabWidth('/repo/a.go', '/repo', read2), 2);
  const read3 = reader({ '/repo/.editorconfig': '[*]\nindent_size = 2\n[*.go]\nindent_size = 8\n' });
  assert.equal(await resolveTabWidth('/repo/a.go', '/repo', read3), 8);
});

test('a nearer file overrides one above it, key by key', async () => {
  const read = reader({
    '/repo/.editorconfig': '[*]\ntab_width = 3\n',
    '/repo/pkg/.editorconfig': '[*]\nindent_size = 5\n',
  });
  assert.equal(await resolveTabWidth('/repo/pkg/a.go', '/repo', read), 3);
  const read2 = reader({
    '/repo/.editorconfig': '[*]\ntab_width = 3\n',
    '/repo/pkg/.editorconfig': '[*]\ntab_width = 5\n',
  });
  assert.equal(await resolveTabWidth('/repo/pkg/a.go', '/repo', read2), 5);
});

test('root = true stops the walk', async () => {
  const seen = [];
  const read = reader({
    '/repo/.editorconfig': '[*]\ntab_width = 3\n',
    '/repo/pkg/.editorconfig': 'root = true\n[*.rs]\ntab_width = 7\n',
  }, seen);
  assert.equal(await resolveTabWidth('/repo/pkg/a.go', '/repo', read), 4);
  assert.ok(!seen.includes('/repo/.editorconfig'));
});

test('the walk never reads above the indexed root', async () => {
  const seen = [];
  const read = reader({ '/.editorconfig': '[*]\ntab_width = 3\n', '/Users/.editorconfig': '[*]\ntab_width = 3\n' }, seen);
  assert.equal(await resolveTabWidth('/Users/ian/repo/pkg/a.go', '/Users/ian/repo', read), 4);
  assert.deepEqual(seen, ['/Users/ian/repo/pkg/.editorconfig', '/Users/ian/repo/.editorconfig']);
});

test('one walk per directory per session', async () => {
  const seen = [];
  const read = reader({ '/repo/.editorconfig': '[*]\ntab_width = 3\n' }, seen);
  const cache = createEditorConfigCache();
  await resolveTabWidth('/repo/pkg/a.go', '/repo', read, cache);
  await resolveTabWidth('/repo/pkg/b.go', '/repo', read, cache);
  await resolveTabWidth('/repo/pkg/c.rs', '/repo', read, cache);
  assert.deepEqual(seen, ['/repo/pkg/.editorconfig', '/repo/.editorconfig']);
});

test('{a,b}, {n..m}, ** and path globs', async () => {
  assert.ok(globMatch('*.{go,rs}', 'x/y.rs'));
  assert.ok(!globMatch('*.{go,rs}', 'y.py'));
  assert.ok(globMatch('file{1..12}.txt', 'file11.txt'));
  assert.ok(!globMatch('file{1..12}.txt', 'file13.txt'));
  assert.ok(globMatch('file{-2..2}.txt', 'file-1.txt'));
  assert.ok(globMatch('src/**/*.go', 'src/a/b/c.go'));
  assert.ok(globMatch('src/**/*.go', 'src/c.go'));
  assert.ok(!globMatch('src/**/*.go', 'lib/c.go'));
  assert.ok(globMatch('/src/*.go', 'src/c.go'));
  assert.ok(!globMatch('/src/*.go', 'src/a/c.go'), '* does not cross a slash');
  assert.ok(!globMatch('src/*.go', 'x/src/c.go'), 'a slash anchors the pattern at the config folder');
  assert.ok(globMatch('Makefile', 'sub/Makefile'));
  assert.ok(globMatch('*.{go}', 'a.{go}'), 'a single-item brace is literal');
  assert.ok(globMatch('[ab].go', 'a.go'));
  assert.ok(globMatch('[!ab].go', 'c.go'));
});

test('[*.go] indent_size = 8 gives a tab-indented .go file 8', async () => {
  const read = reader({ '/repo/.editorconfig': 'root = true\n[*]\nindent_size = 2\n[*.go]\nindent_size = 8\n' });
  assert.equal(await resolveTabWidth('/repo/cmd/main.go', '/repo', read), 8);
  assert.equal(await resolveTabWidth('/repo/cmd/main.rs', '/repo', read), 2);
});

test('the index root of a checkout ends at its .git', async () => {
  const files = { '/Users/ian/repo/.git/HEAD': 'ref', '/Users/ian/repo/pkg/a.go': 'x' };
  const shell = {
    readDir: async (dir) => (dir === '/Users/ian/repo/pkg' ? [{ path: '/Users/ian/repo/pkg/a.go', size: 1, mtimeMs: 0, isDir: false }] : []),
    readFile: async (p) => { if (p in files) return new TextEncoder().encode(files[p]); throw new Error('missing'); },
  };
  assert.equal(await rootFor(shell, '/Users/ian/repo/pkg/a.go'), '/Users/ian/repo');
});
