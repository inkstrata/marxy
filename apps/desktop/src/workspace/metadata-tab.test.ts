// The Metadata tab's pure parts (W-17): the hidden characters and the places Read reshapes, the front matter read from a store that
// has not been parsed, the value edit as one undo step (and the refusals that change nothing), the model's sections. What the reader
// sees, the typing, Mod+Z and the margin preview are metadata.test.mjs, in WebKit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuffer } from '@marxy/core';
import { parseMarkdown } from '@marxy/core/src/parse/parse.ts';
import { noteByte as noteByteOf } from './metadata-tab.ts';
import { openDocumentStore, type StoreIo } from '../document/store.ts';
import { applyFrontMatterEdit, frontMatterOf, metadataModelOf, modifiedWords, reshapedPlaces, scanHidden, sizeFact } from './metadata-tab.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const io: StoreIo = { writeFileAtomic: async () => {}, writeFileNew: async () => {}, recordRead: () => {} };
const open = (path: string, text: string, lazy = false) => openDocumentStore(io, path, enc.encode(text), undefined, { lazy });
const textOf = (store: ReturnType<typeof open>) => dec.decode(store.snapshot().buffer.bytes);

test('sizeFact and modifiedWords say a size and a time the same in every locale', () => {
  assert.equal(sizeFact(312), '312 bytes');
  assert.equal(sizeFact(1), '1 byte');
  assert.equal(sizeFact(3116), '3.0 KB · 3,116 bytes');
  assert.equal(sizeFact(2_500_000), '2.4 MB · 2,500,000 bytes');
  assert.match(modifiedWords(Date.UTC(2026, 9, 13, 12, 0)), /^2026-10-1[23] \d\d:\d\d$/);
});

test('scanHidden: invisible and bidirectional characters by the rules Read marks them by, with line and column', () => {
  const text = '# T\r\nzero\u200bwidth\r\n\r\nbidi \u202e here\n`a\u00a0b` and a\u00a0b\n\u{1F468}\u200d\u{1F469} stays\n';
  const buffer = createBuffer('f.md', enc.encode(text));
  const ast = parseMarkdown(buffer.bytes, { file: 'f.md' });
  const { items, total } = scanHidden(buffer, ast, false);
  assert.deepEqual(items.map((i) => [i.label, i.line, i.column]), [['U+200B', 2, 5], ['U+202E', 4, 6]]);
  assert.equal(total, 2);
  assert.equal(items[0]!.name, 'ZERO WIDTH SPACE');
  assert.equal(items[1]!.name, 'RIGHT-TO-LEFT OVERRIDE');
  // The byte is the character's own, for a jump.
  assert.equal(dec.decode(buffer.bytes.subarray(items[0]!.byte, items[0]!.byte + 3)), '\u200b');
  // A no-break space is hidden in code only; in a file read as code it is hidden everywhere.
  const inCode = scanHidden(createBuffer('f.md', enc.encode('x\u00a0y\n```\na\u00a0b\n```\n')), parseMarkdown(enc.encode('x\u00a0y\n```\na\u00a0b\n```\n'), { file: 'f.md' }), false);
  assert.deepEqual(inCode.items.map((i) => [i.label, i.line]), [['U+00A0', 3]]);
  const asCode = scanHidden(createBuffer('f.py', enc.encode('x\u00a0y\n')), null, true);
  assert.deepEqual(asCode.items.map((i) => i.label), ['U+00A0']);
});

test('scanHidden: a byte-order mark is the file\'s own, a tag run is listed, and the list is capped while the count is not', () => {
  const bom = createBuffer('f.md', enc.encode('\ufeffplain\n'));
  assert.deepEqual(scanHidden(bom, null, false).items, []);
  const tags = createBuffer('f.md', enc.encode('a\u{E0041}\u{E0042}b\n'));
  const found = scanHidden(tags, null, false);
  assert.equal(found.total, 1, 'one run, as Read marks it');
  assert.equal(found.items[0]!.name, 'TAG CHARACTERS ×2 spelling "AB"');
  const flag = createBuffer('f.md', enc.encode('\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}\n'));
  assert.equal(scanHidden(flag, null, false).total, 0, 'an emoji subdivision flag is not hidden text');
  const many = createBuffer('f.md', enc.encode('\u200b'.repeat(100) + '\n'));
  const capped = scanHidden(many, null, false, 10);
  assert.equal(capped.items.length, 10);
  assert.equal(capped.total, 100);
});

test('reshapedPlaces: front matter shown as a head, a comment set aside, a footnote moved to the end, each with its line', () => {
  const text = '---\ntitle: T\n---\n\nText[^1].\n\n<!-- aside -->\n\nMore\n\n<!-- a --> and <!-- b -->\n\n[^1]: The note.\n';
  const buffer = createBuffer('f.md', enc.encode(text));
  const { items, total } = reshapedPlaces(buffer, parseMarkdown(buffer.bytes, { file: 'f.md' }));
  assert.equal(total, items.length);
  assert.deepEqual(items.map((i) => i.words), [
    'Front matter shown as a head, lines 1 to 3',
    'An HTML comment set aside, line 7',
    '2 HTML comments set aside, line 11',
    'Footnote 1 moved to the end, line 13',
  ]);
  assert.equal(dec.decode(buffer.bytes.subarray(items[1]!.byte, items[1]!.byte + 4)), '<!--');
  assert.deepEqual(reshapedPlaces(buffer, null).items, []);
});

test('frontMatterOf: from the AST of a parsed store, from the head of one not parsed (never forcing the parse), and null for what is not Markdown', () => {
  const md = '\ufeff---\ntitle: T\ntags: [a, b]\n---\n\n# H\n';
  const lazy = open('/r/a.md', md, true);
  assert.equal(lazy.parsed(), false);
  const fromLazy = frontMatterOf(lazy);
  assert.deepEqual(fromLazy!.values.values.map((v) => [v.key, v.value, v.refusal === null]), [['title', 'T', true], ['tags', '[a, b]', false]]);
  assert.equal(lazy.parsed(), false, 'asking for the front matter did not parse the document');
  assert.deepEqual(frontMatterOf(open('/r/a.md', md))!.values.values.map((v) => v.key), ['title', 'tags']);
  // A YAML data file that opens and closes with --- is a file of data, not a Markdown file with front matter.
  assert.equal(frontMatterOf(open('/r/data.yaml', '---\na: 1\n---\n')), null);
  assert.equal(frontMatterOf(open('/r/code.py', '---\na: 1\n---\n')), null);
  assert.equal(frontMatterOf(open('/r/none.md', '# no front matter\n')), null);
  assert.ok(frontMatterOf(open('untitled', '---\na: 1\n---\n')) !== null, 'a scratch document is Markdown until it is named');
});

test('applyFrontMatterEdit: one splice, one undo step, and the bytes are back after it', async () => {
  const text = '---\r\ntitle: "Old" # keep\r\nauthor: Ada\r\n---\r\n\r\nBody\r\n';
  const store = open('/r/a.md', text);
  const before = store.snapshot().buffer.bytes.slice();
  const done = await applyFrontMatterEdit(store, 'title', 'New "one"');
  assert.deepEqual(done, { applied: true, unchanged: false });
  assert.equal(textOf(store), '---\r\ntitle: "New \\"one\\"" # keep\r\nauthor: Ada\r\n---\r\n\r\nBody\r\n');
  assert.equal(store.snapshot().canUndo, true);
  await store.undo();
  assert.deepEqual(store.snapshot().buffer.bytes, before, 'one undo restores every byte');
  assert.equal(store.snapshot().canUndo, false, 'and it was the only step');
});

test('applyFrontMatterEdit: a refusal changes nothing and says why; the same value is not an edit', async () => {
  const text = '---\nblock: |\n  a\nanchored: &x v\nok: fine\n---\nBody\n';
  const store = open('/r/a.md', text);
  const version = store.snapshot().version;
  for (const [key, value, why] of [
    ['block', 'x', /block of text/],
    ['anchored', 'x', /anchor/],
    ['missing', 'x', /no key/],
    ['ok', 'two\nlines', /one line/],
  ] as const) {
    const result = await applyFrontMatterEdit(store, key, value);
    assert.equal(result.applied, false, key);
    assert.match((result as { why: string }).why, why, key);
  }
  assert.equal(textOf(store), text);
  assert.equal(store.snapshot().version, version, 'no transition was made');
  assert.deepEqual(await applyFrontMatterEdit(store, 'ok', 'fine'), { applied: true, unchanged: true });
  assert.equal(store.snapshot().version, version);
  assert.deepEqual(await applyFrontMatterEdit(open('/r/n.md', '# plain\n'), 'a', 'b'), { applied: false, why: 'This file has no front matter' });
});

test('applyFrontMatterEdit on a document opened in Source (not parsed) edits from the head and leaves the rest alone', async () => {
  const body = 'Body line\n'.repeat(5000);
  const store = open('/r/big.md', `---\ntitle: Old\n---\n${body}`, true);
  assert.equal(store.parsed(), false);
  assert.deepEqual(await applyFrontMatterEdit(store, 'title', 'New'), { applied: true, unchanged: false });
  assert.equal(textOf(store), `---\ntitle: New\n---\n${body}`);
});

test('metadataModelOf: the sections that have something, in the card\'s words', () => {
  const store = open('/r/a.md', '---\ntitle: T\n---\nBody\u200b\n');
  const model = metadataModelOf({ store, path: '/r/a.md', mtimeMs: Date.UTC(2026, 9, 13, 12, 0), detected: { kind: 'article', reasons: [] }, readAtMs: Date.UTC(2026, 9, 12, 8, 0), pinned: true });
  assert.deepEqual(model.file.map((f) => f.label), ['Path', 'Size', 'Modified', 'Encoding', 'Line endings']);
  assert.equal(model.file[0]!.value, '/r/a.md');
  assert.equal(model.file[3]!.value, 'UTF-8');
  assert.equal(model.file[4]!.value, 'LF');
  assert.deepEqual(model.frontMatter!.values.map((v) => v.key), ['title']);
  assert.equal(model.kind!.label, 'Article');
  assert.deepEqual(model.marxy.map((f) => f.label), ['Last read', 'Pinned']);
  assert.equal(model.hidden.total, 1);
  assert.equal(model.reshaped.total, 1);
  // A file with none of it has only what it has: no front matter, no pin, nothing hidden.
  const plain = metadataModelOf({ store: open('/r/b.md', '# Plain\n'), path: '/r/b.md', mtimeMs: null, detected: null, readAtMs: null, pinned: false });
  assert.deepEqual(plain.file.map((f) => f.label), ['Path', 'Size', 'Encoding', 'Line endings']);
  assert.equal(plain.frontMatter, null);
  assert.equal(plain.kind, null);
  assert.deepEqual(plain.marxy, []);
  assert.equal(plain.hidden.total + plain.reshaped.total, 0);
  const scratch = metadataModelOf({ store: open('untitled', 'x'), path: 'untitled', mtimeMs: null, detected: null, readAtMs: null, pinned: false });
  assert.equal(scratch.file[0]!.value, 'Not saved yet');
});

test('noteByte: a note\'s line and column in the editor\'s LF text are the byte of the CRLF file', () => {
  const buffer = createBuffer('f.md', enc.encode('é line one\r\nsecond ```\r\nthird\r\n'));
  const note = { kind: 'fence', start: 0, end: 0, byteStart: null, byteEnd: null, line: 2, column: 8, words: '' } as const;
  const byte = noteByteOf(buffer, note);
  assert.equal(dec.decode(buffer.bytes.subarray(byte, byte + 3)), '```');
});
