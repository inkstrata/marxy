// §01 test table, the public API, lineOf, contentHash, and the no-normalise / boundary checks.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Source } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import {
  bytesOf,
  byteToUtf16,
  contentHash,
  createBuffer,
  eolString,
  fromText,
  lineOf,
  splice,
  textOf,
  utf16ToByte,
} from './buffer.ts';
import { History } from './history.ts';
import {
  bytesOf as exportedBytesOf,
  byteToUtf16 as exportedByteToUtf16,
  contentHash as exportedContentHash,
  createBuffer as exportedCreateBuffer,
  eolString as exportedEolString,
  fromText as exportedFromText,
  History as ExportedHistory,
  lineOf as exportedLineOf,
  splice as exportedSplice,
  textOf as exportedTextOf,
  utf16ToByte as exportedUtf16ToByte,
} from '../index.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, corpus)));
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const range = (file: string, start: number, end: number): Source => ({ file, start, end });

const corpusFiles = readdirSync(corpus)
  .filter((name) => name !== 'check-prose-volume.mjs' && !name.startsWith('.'))
  .sort();

test('every §01 API function exists with the task-card signature', () => {
  const empty = createBuffer('untitled', new Uint8Array());
  assert.equal(empty.path, 'untitled');
  assert.equal(empty.bytes.length, 0);
  assert.equal(empty.text, '');
  assert.equal(empty.bom, false);
  assert.equal(empty.eol, 'none');
  assert.equal(empty.version, 0);
  assert.equal(typeof empty.offsets.at, 'function');

  assert.equal(typeof createBuffer, 'function');
  assert.equal(typeof bytesOf, 'function');
  assert.equal(typeof textOf, 'function');
  assert.equal(typeof splice, 'function');
  assert.equal(typeof fromText, 'function');
  assert.equal(typeof byteToUtf16, 'function');
  assert.equal(typeof utf16ToByte, 'function');
  assert.equal(typeof contentHash, 'function');
  assert.equal(typeof eolString, 'function');
  assert.equal(typeof lineOf, 'function');
  assert.equal(typeof History, 'function');

  const src = range('untitled', 0, 0);
  assert.ok(bytesOf(empty, src) instanceof Uint8Array);
  assert.equal(textOf(empty, src), '');
  assert.equal(splice(empty, src, '').version, 1);
  assert.equal(fromText('untitled', '', empty).path, 'untitled');
  assert.equal(byteToUtf16(empty, 0), 0);
  assert.equal(utf16ToByte(empty, 0), 0);
  assert.equal(typeof contentHash(empty.bytes), 'string');
  assert.equal(eolString(empty), '\n');
  assert.equal(lineOf(empty, 0), 1);
});

test('the package index re-exports the buffer surface', () => {
  assert.equal(exportedCreateBuffer, createBuffer);
  assert.equal(exportedBytesOf, bytesOf);
  assert.equal(exportedTextOf, textOf);
  assert.equal(exportedSplice, splice);
  assert.equal(exportedFromText, fromText);
  assert.equal(exportedByteToUtf16, byteToUtf16);
  assert.equal(exportedUtf16ToByte, utf16ToByte);
  assert.equal(exportedContentHash, contentHash);
  assert.equal(exportedEolString, eolString);
  assert.equal(exportedLineOf, lineOf);
  assert.equal(ExportedHistory, History);
});

test('12-crlf-and-bom.md: BOM, CRLF, text[0] is U+FEFF, empty splice is byte-identical', () => {
  const bytes = read('12-crlf-and-bom.md');
  const buffer = createBuffer('12-crlf-and-bom.md', bytes);
  assert.equal(buffer.bom, true);
  assert.equal(buffer.eol, 'crlf');
  assert.equal(buffer.text[0], '\uFEFF');
  const same = splice(buffer, range(buffer.path, 0, 0), '');
  assert.deepEqual([...same.bytes], [...buffer.bytes]);
  assert.equal(same.version, buffer.version + 1);
});

test('13-no-trailing-newline.md: lf, last byte is not LF, a splice elsewhere leaves it', () => {
  const bytes = read('13-no-trailing-newline.md');
  const buffer = createBuffer('13-no-trailing-newline.md', bytes);
  assert.equal(buffer.eol, 'lf');
  assert.notEqual(buffer.bytes[buffer.bytes.length - 1], 0x0a);
  const spliced = splice(buffer, range(buffer.path, 0, 0), 'X');
  assert.deepEqual([...spliced.bytes.subarray(1)], [...buffer.bytes]);
  assert.notEqual(spliced.bytes[spliced.bytes.length - 1], 0x0a);
});

test('07-cjk.md: textOf a heading is the heading source; byteToUtf16 ∘ utf16ToByte is identity', () => {
  const bytes = read('07-cjk.md');
  const buffer = createBuffer('07-cjk.md', bytes);
  const document = parseMarkdown(bytes, { file: '07-cjk.md' });
  const heading = document.children.find((block) => block.type === 'heading');
  assert.ok(heading);
  assert.equal(textOf(buffer, heading.src), '# 東アジアの文字と組版');
  for (let cu = 0; cu <= buffer.text.length; cu++) {
    assert.equal(byteToUtf16(buffer, utf16ToByte(buffer, cu)), cu, `code unit ${cu}`);
  }
});

test('textOf throws RangeError when start or end falls on a UTF-8 continuation byte', () => {
  const buffer = createBuffer('cjk.md', encode('東'));
  assert.equal(buffer.bytes.length, 3);
  assert.equal((buffer.bytes[1]! & 0xc0), 0x80);
  assert.throws(() => textOf(buffer, range('cjk.md', 1, 3)), RangeError);
  assert.throws(() => textOf(buffer, range('cjk.md', 0, 1)), RangeError);
  assert.throws(() => textOf(buffer, range('cjk.md', 2, 3)), RangeError);
  assert.equal(textOf(buffer, range('cjk.md', 0, 3)), '東');
});

test('splice then undo: bytes match the original and version only increases', () => {
  const original = createBuffer('doc.md', encode('# Hi\n'));
  const history = new History();
  const src = range('doc.md', 0, 4);
  const before = new Uint8Array(bytesOf(original, src));
  const next = splice(original, src, '# Ho');
  history.push({ range: src, before, after: encode('# Ho'), label: 'retitle' });
  assert.equal(next.version, original.version + 1);
  const undone = history.undo(next);
  assert.ok(undone);
  assert.deepEqual([...undone.bytes], [...original.bytes]);
  assert.ok(undone.version > next.version);
  assert.ok(next.version > original.version);
});

test('fromText with eol=crlf turns every LF into CRLF and restores the BOM', () => {
  const like = createBuffer('12-crlf-and-bom.md', read('12-crlf-and-bom.md'));
  const made = fromText('out.md', 'a\nb\r\nc', like);
  assert.equal(made.bom, true);
  assert.equal(made.eol, 'crlf');
  assert.equal(made.text[0], '\uFEFF');
  assert.equal(made.text.slice(1), 'a\r\nb\r\nc');
  assert.ok(!made.text.slice(1).includes('\n') || made.text.includes('\r\n'));
  assert.equal([...made.bytes].filter((b, i, all) => b === 0x0a && all[i - 1] !== 0x0d).length, 0);
});

test('lineOf is 1-based and counts CRLF once', () => {
  const lf = createBuffer('lf.md', encode('ab\ncd'));
  assert.equal(lineOf(lf, 0), 1);
  assert.equal(lineOf(lf, 2), 1);
  assert.equal(lineOf(lf, 3), 2);

  const crlf = createBuffer('crlf.md', encode('ab\r\ncd'));
  assert.equal(lineOf(crlf, 0), 1);
  assert.equal(lineOf(crlf, 2), 1);
  assert.equal(lineOf(crlf, 3), 1);
  assert.equal(lineOf(crlf, 4), 2);
});

test('contentHash is the FNV-1a 64 value for empty bytes and for 12-crlf-and-bom.md', () => {
  assert.equal(contentHash(new Uint8Array()), 'cbf29ce484222325');
  assert.equal(contentHash(read('12-crlf-and-bom.md')), '74638bba5e821f1e');
});

test('createBuffer normalises nothing: decode then encode matches the file bytes', () => {
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const encoder = new TextEncoder();
  for (const name of corpusFiles) {
    const bytes = read(name);
    const buffer = createBuffer(name, bytes);
    assert.deepEqual([...buffer.bytes], [...bytes], name);
    assert.deepEqual([...encoder.encode(buffer.text)], [...bytes], `${name} text round-trip`);
    assert.deepEqual([...encoder.encode(decoder.decode(bytes))], [...bytes], `${name} raw round-trip`);
  }

  const loneCr = Uint8Array.from([0x61, 0x0d, 0x62]);
  const buffer = createBuffer('lone-cr.md', loneCr);
  assert.deepEqual([...buffer.bytes], [...loneCr]);
  assert.deepEqual([...encoder.encode(buffer.text)], [...loneCr]);
  assert.equal(buffer.text, 'a\rb');
});

test('bytesOf is a view, not a copy', () => {
  const buffer = createBuffer('doc.md', encode('abcd'));
  const view = bytesOf(buffer, range('doc.md', 1, 3));
  assert.equal(view.buffer, buffer.bytes.buffer);
  assert.deepEqual([...view], [0x62, 0x63]);
});

test('eolString follows the buffer convention and the mixed line', () => {
  assert.equal(eolString(createBuffer('a', encode('a\nb'))), '\n');
  assert.equal(eolString(createBuffer('b', encode('a\r\nb'))), '\r\n');
  assert.equal(eolString(createBuffer('c', new Uint8Array())), '\n');
  const mixed = createBuffer('m', encode('a\nb\r\nc'));
  assert.equal(mixed.eol, 'mixed');
  assert.equal(eolString(mixed), '\n');
  assert.equal(eolString(mixed, 0), '\n');
  assert.equal(eolString(mixed, 3), '\r\n');
});

test('the three-dot diff contains no fidelity gate and no contract file', (t) => {
  let base: string | undefined;
  for (const ref of ['origin/main', 'main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', ref], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      base = ref;
      break;
    } catch {
      // try the next candidate
    }
  }
  if (!base) {
    t.skip('neither origin/main nor main is a resolvable git ref');
    return;
  }
  const names = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  assert.ok(!names.includes('scripts/gate-fidelity.mjs'));
  assert.deepEqual(
    names.filter((name) => name === 'packages/core/src/contracts' || name.startsWith('packages/core/src/contracts/')),
    [],
  );
});
