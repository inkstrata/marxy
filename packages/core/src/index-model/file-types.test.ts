// V-09: one table. Every extension the old tables listed resolves the same, and the Tauri associations follow it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify } from './kinds.ts';
import { fileTypeOf, tableExtensions } from './file-types.ts';

// The allow-list as kinds.ts held it before V-09.
const OLD_MARKDOWN = ['md', 'mdx', 'markdown', 'mdown', 'mkd'];
const OLD_TEXT = ['txt', 'text'];
const OLD_SOURCE = 'ts tsx js jsx mjs cjs mts cts rs py go java kt kts c h cc cpp cxx hpp hh rb php swift sh bash zsh json toml yaml yml html htm xml sql graphql lua r ex exs hs vue svelte css scss log csv tsv jsonl'.split(' ');
// K-08: a log is read, not edited; its kind stays `source`, so the index and the Tauri associations are as they were.
const READ_FIRST = ['log', 'out', 'diff', 'patch'];
// BY_EXT in apps/desktop/src/source/language.ts before V-09: extension -> CodeMirror id.
const OLD_CM: Record<string, string> = {
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', txt: 'markdown', ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  mjs: 'javascript', cjs: 'javascript', rs: 'rust', py: 'python', css: 'css', json: 'json', yaml: 'yaml', yml: 'yaml', html: 'html', htm: 'html',
  // V-14: grammars added.
  go: 'go', java: 'java', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', sh: 'shell', bash: 'shell', zsh: 'shell', toml: 'toml',
};

test('every old allow-list extension keeps its kind and mode', () => {
  for (const [list, kind, mode] of [[OLD_MARKDOWN, 'markdown', 'rendered'], [OLD_TEXT, 'text', 'rendered'], [OLD_SOURCE, 'source', 'source']] as const) {
    for (const ext of list) {
      const t = fileTypeOf(`/r/file.${ext}`);
      assert.equal(t?.kind, kind, ext);
      assert.equal(t?.mode, READ_FIRST.includes(ext) ? 'rendered' : mode, ext);
      assert.equal(classify(`/r/file.${ext}`), kind, ext);
    }
  }
  assert.equal(tableExtensions().length, OLD_MARKDOWN.length + OLD_TEXT.length + OLD_SOURCE.length + 3, '`.out` (K-08), `.diff` and `.patch` (K-09) are the extensions added since');
});

test('a .log and an .out open in Read, as logs (K-08); no other source file does', () => {
  for (const name of ['a.log', 'a.out', 'A.LOG', '/r/dir.d/build.out']) {
    const t = fileTypeOf(`/r/${name}`);
    assert.equal(t?.mode, 'rendered', name);
    assert.equal(t?.kind, 'source', name);
    assert.equal(t?.shiki, 'log', name);
    assert.equal(t?.indexed, true, name);
  }
  for (const ext of OLD_SOURCE.filter((e) => !READ_FIRST.includes(e))) assert.equal(fileTypeOf(`/r/f.${ext}`)?.mode, 'source', ext);
});

test('a .diff and a .patch open in Read, as diffs (K-09); on main neither was in the table', () => {
  for (const name of ['a.diff', 'x.patch', 'A.PATCH', '/r/dir.d/change.diff']) {
    const t = fileTypeOf(`/r/${name}`);
    assert.equal(t?.mode, 'rendered', name);
    assert.equal(t?.kind, 'source', name);
    assert.equal(t?.shiki, 'diff', name);
    assert.equal(t?.indexed, true, name);
    assert.equal(classify(`/r/${name}`), 'source', name);
  }
});

test('every old BY_EXT extension keeps its CodeMirror id, V-14 adds Go, C, C++, Java, shell and TOML; only .mdown, .mkd and .text gain one (as .txt has)', () => {
  for (const ext of tableExtensions()) assert.equal(fileTypeOf(`/r/f.${ext}`)?.cm, OLD_CM[ext] ?? (['mdown', 'mkd', 'text'].includes(ext) ? 'markdown' : undefined), ext);
});

test('exact names and the extension-less text family', () => {
  assert.equal(classify('/r/theme.css'), 'theme');
  assert.equal(classify('/r/theme.toml'), 'theme');
  assert.equal(classify('/r/Makefile'), 'source');
  assert.equal(classify('/r/Dockerfile'), 'source');
  assert.equal(fileTypeOf('/r/Makefile')?.mode, 'source');
  for (const n of ['README', 'readme', 'CONTRIBUTING', 'CHANGELOG', 'CHANGES', 'HISTORY']) {
    assert.equal(fileTypeOf(`/r/${n}`)?.mode, 'rendered', n);
    assert.equal(classify(`/r/${n}`), undefined, `${n} stays out of the index allow-list`);
  }
  for (const n of ['LICENSE', 'READMEFIRST', 'README.rst', '.md', 'toString', 'constructor']) assert.equal(fileTypeOf(`/r/${n}`), undefined, n);
});

test('the Tauri file associations list what the table calls markdown, text and source', () => {
  const conf = JSON.parse(readFileSync(new URL('../../../../apps/desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const assoc = conf.bundle.fileAssociations as { ext: string[] }[];
  const listed = assoc.flatMap((a) => a.ext).sort();
  const wanted = tableExtensions().sort();
  assert.deepEqual(listed, wanted);
});
