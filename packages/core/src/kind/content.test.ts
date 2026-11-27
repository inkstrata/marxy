// Content corrects the name. fixtures/detect/expected.json is shared with src-tauri/src/detect.rs, whose test checks
// each fixture's head gives the recorded signals; here each recorded signal set, under the fixture's name, lands on its
// row and its reading. Plus the registry fixes that came with it: globs below a Markdown extension, fence words that
// name an object's own properties.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { detectKind } from './detect.ts';
import {
  BINARY_FILE_TYPE,
  contentTypeFor,
  fileTypeFor,
  fileTypeOf,
  langOfFence,
  nameTypeOf,
  noteContent,
  parserOf,
  rowForWord,
  searchSkipReason,
  wantsContent,
  type ContentSignals,
} from './registry.ts';

interface Case { readonly detect: ContentSignals; readonly row: string; readonly reading: string }
const table = JSON.parse(readFileSync(new URL('../../../../fixtures/detect/expected.json', import.meta.url), 'utf8')) as { files: Record<string, Case> };

test('every fixture lands on its row and its reading', () => {
  const cases = Object.entries(table.files);
  assert.ok(cases.length >= 55, `about 60 fixtures, got ${cases.length}`);
  const wrong: string[] = [];
  for (const [name, c] of cases) {
    const row = contentTypeFor(`/fx/${name}`, c.detect);
    const id = row?.id ?? 'unknown';
    const reading = row?.reading ?? 'plain';
    if (id !== c.row || reading !== c.reading) wrong.push(`${name}: ${id}/${reading}, expected ${c.row}/${c.reading}`);
  }
  assert.deepEqual(wrong, []);
});

test('the table covers the layers: magic under wrong and missing names, BOMs and UTF-16, shebangs, modelines, heuristics', () => {
  const sig = Object.values(table.files).map((c) => c.detect);
  assert.ok(sig.filter((s) => s.class === 'binary' && s.format).length >= 15);
  assert.ok(sig.filter((s) => s.encoding?.startsWith('utf-16')).length >= 3);
  assert.ok(sig.filter((s) => s.shebang).length >= 12);
  assert.ok(sig.filter((s) => s.modeline).length >= 5);
  assert.ok(sig.filter((s) => s.lang).length >= 8);
});

test('a noted correction is what every reader of the registry sees, and forgetting it gives the name back', () => {
  const path = '/fx/tools/deploy';
  assert.equal(fileTypeOf(path), undefined);
  noteContent(path, { class: 'text', encoding: 'utf-8', shebang: 'python3' });
  assert.equal(fileTypeOf(path)?.id, 'python');
  assert.equal(parserOf(path), 'code');
  assert.equal(detectKind({ path, head: new Uint8Array() }).kind, 'code');
  // A head that agrees with the name keeps nothing.
  noteContent('/fx/a.py', { class: 'text', encoding: 'utf-8', shebang: 'python3' });
  assert.equal(fileTypeOf('/fx/a.py'), nameTypeOf('/fx/a.py'));
  // A PNG under a Markdown name is binary: not Markdown, not read by Find, and Show as cannot make it a page.
  noteContent('/fx/notes.md', { class: 'binary', format: 'png' });
  assert.equal(fileTypeFor('/fx/notes.md').kind, 'binary');
  assert.equal(searchSkipReason(fileTypeFor('/fx/notes.md')), 'binary');
  assert.equal(parserOf('/fx/notes.md', 'article'), 'text');
  noteContent(path, null);
  noteContent('/fx/notes.md', null);
  assert.equal(fileTypeOf(path), undefined);
  assert.equal(fileTypeOf('/fx/notes.md')?.id, 'markdown');
});

test('text under a binary name is text no row names; an empty file keeps its name', () => {
  assert.equal(contentTypeFor('/fx/a.png', { class: 'text', encoding: 'utf-8' }), null);
  assert.equal(contentTypeFor('/fx/a.md', { class: 'empty' })?.id, 'markdown');
  assert.equal(contentTypeFor('/fx/a.zzz', { class: 'binary' }), BINARY_FILE_TYPE);
});

test('an RTF file detection calls binary (raw bytes after \\bin) is still read on the office page, from its bytes', () => {
  const row = contentTypeFor('/fx/a.rtf', { class: 'binary' });
  assert.deepEqual([row?.id, row?.kind, row?.viewer], ['rtf', 'binary', 'office']);
  assert.equal(contentTypeFor('/fx/a.rtf', { class: 'text', encoding: 'utf-8' })?.kind, 'text');
});

test('a shebang does not overrule a code extension; a heuristic speaks only for a shared or missing one', () => {
  assert.equal(contentTypeFor('/fx/a.rb', { class: 'text', shebang: 'python3' })?.id, 'ruby');
  assert.equal(contentTypeFor('/fx/a.rs', { class: 'text', lang: 'cpp' })?.id, 'rust');
  assert.equal(contentTypeFor('/fx/a.h', { class: 'text', lang: 'cpp' })?.id, 'cpp');
});

test('the index reads the head only of a file whose name is silent or shared', () => {
  for (const p of ['/r/deploy', '/r/a.h', '/r/a.m', '/r/a.pl', '/r/a.zzz']) assert.equal(wantsContent(p), true, p);
  for (const p of ['/r/a.ts', '/r/a.md', '/r/README', '/r/a.png', '/r/Makefile']) assert.equal(wantsContent(p), false, p);
});

test('an extension in the Markdown or text family wins over a name glob', () => {
  assert.equal(fileTypeOf('/r/docs/Dockerfile.md')?.id, 'markdown');
  assert.equal(fileTypeOf('/r/.env.md')?.id, 'markdown');
  assert.equal(fileTypeOf('/r/notes.mk.txt')?.id, 'text');
  // The globs still name what they were for.
  assert.equal(fileTypeOf('/r/Dockerfile.dev')?.id, 'docker');
  assert.equal(fileTypeOf('/r/.env.local')?.id, 'dotenv');
  assert.equal(fileTypeOf('/r/rules.mk')?.id, 'make');
});

test('a fence word that names an object property names no language', () => {
  for (const word of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(langOfFence(word), word.toLowerCase(), word);
    assert.equal(typeof langOfFence(word), 'string');
    assert.equal(rowForWord(word), undefined, word);
  }
  assert.equal(langOfFence('rs'), 'rust');
  assert.equal(langOfFence('bash'), 'shellscript');
});
