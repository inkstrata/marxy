// The Metadata tab's pure parts: the hidden characters and the places Read reshapes, the front matter read from a store that
// has not been parsed. What the reader
// sees, the typing, Mod+Z and the margin preview are metadata.test.mjs, in WebKit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuffer } from '@marxy/core';
import { parseMarkdown } from '@marxy/core/src/parse/parse.ts';
import { openDocumentStore, type StoreIo } from '../../document/store.ts';

import { hasMarks, spokenText } from './metadata-marks.ts';
import { FRONT_MATTER_READ_LIMIT, frontMatterEnd, frontMatterOf, modifiedWords, reshapedPlaces, scanHidden, sizeFact } from './metadata.ts';

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
  assert.match(modifiedWords(Date.UTC(2026, 9, 13, 12, 0)), /^1[23] Oct 2026, \d\d:\d\d$/);
});

test('the panel and a folder say a time in the file card\'s one form', async () => {
  const { dateWords } = await import('../../viewers/file.ts');
  const ms = Date.UTC(2026, 0, 5, 9, 7);
  assert.equal(modifiedWords(ms), dateWords(ms));
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

test('frontMatterOf: a head of 544 KB in a store not parsed is read whole, not cut at 256 KB and called no front matter', async () => {
  const lines: string[] = [];
  for (let size = 0, i = 0; size < 544 * 1024; i++) {
    const line = `key${i}: value number ${i} in a head that is long`;
    lines.push(line);
    size += line.length + 1;
  }
  const text = `---\n${lines.join('\n')}\n---\n\n# Body\n\n${'Paragraph.\n\n'.repeat(2000)}`;
  assert.ok(enc.encode(lines.join('\n')).length > 544 * 1024);
  const store = open('/r/long.md', text, true);
  assert.equal(store.parsed(), false);
  const found = frontMatterOf(store)!;
  assert.ok(found !== null, 'the long head is a front matter');
  assert.equal(found.values.values.length, lines.length);
  assert.equal(found.values.values.at(-1)!.key, `key${lines.length - 1}`);
  assert.equal(store.parsed(), false, 'and the document was not parsed to find it');
});

test('frontMatterEnd: the closing line of the opening fence, for LF, CRLF, a BOM and trailing blanks; none where it never closes', () => {
  const end = (t: string) => frontMatterEnd(enc.encode(t));
  assert.equal(end('---\na: 1\n---\nBody'), 13);
  assert.equal(end('---\r\na: 1\r\n---\r\nBody'), 16);
  assert.equal(end('\ufeff---\na: 1\n--- \t\nBody'), 3 + 4 + 5 + 6);
  assert.equal(end('+++\na = 1\n+++\n'), 14);
  assert.equal(end('---\na: 1\n+++\nBody'), 0, 'the fence is the opening\'s own');
  assert.equal(end('---\na: 1\nBody without a closing rule\n'), 0);
  assert.equal(end('# no front matter\n---\n'), 0);
  assert.equal(end('---\na: 1\n---'), 12, 'a closing rule with no line break after it');
});

test('frontMatterOf: a head past the limit is listed as too long to read here, never as no front matter', () => {
  const filler = 'k: v\n'.repeat(Math.ceil((FRONT_MATTER_READ_LIMIT + 1024) / 5));
  const store = open('/r/huge.md', `---\n${filler}---\nBody\n`, true);
  const found = frontMatterOf(store);
  assert.ok(found !== null);
  assert.deepEqual(found.values.values, []);
  assert.match(found.values.unreadable ?? '', /too long to read here/);
});

test('metadata marks: a bidi control or a zero-width character is a visible mark with a spoken name, and plain text is left as text', () => {
  assert.equal(hasMarks('exe.txt'), false);
  assert.equal(hasMarks('\u202eexe.txt'), true);
  assert.equal(hasMarks('a\u200bb'), true);
  assert.equal(hasMarks('caf\u00e9'), false);
  assert.equal(spokenText('\u202etxt.exe'), ' U+202E txt.exe');
  assert.equal(spokenText('plain'), 'plain');
});
