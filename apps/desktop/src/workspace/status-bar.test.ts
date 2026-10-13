// The status bar's items (W-11): a table over document snapshots, with the labels from the Source frame's facts (no second
// formatter), the word counter against the library's own, the line count against the editor's, and the caret against the
// frame's. No DOM; test/status-bar.test.mjs draws the bar in WebKit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Text } from '@codemirror/state';
import { createBuffer } from '@marxy/core/src/buffer/buffer.ts';
import { measureText } from '@marxy/core/src/index-model/query-eval.ts';
import { KINDS, type Kind } from '@marxy/core/src/contracts/kinds.ts';
import { encodingFact, lineCountOf } from '../source/frame-facts.ts';
import {
  OPENS,
  PROSE_KINDS,
  type StatusInput,
  caretOf,
  countWords,
  createWordCounter,
  isButton,
  kindLabel,
  lineCountOfBytes,
  measureFor,
  sectionAt,
  statusItems,
  themeLabel,
} from './status-facts.ts';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A snapshot of a document as the bar reads it. */
function snapshot(over: {
  kind: Kind | null;
  path: string;
  text?: string | Uint8Array;
  words?: number | null;
  caret?: { line: number; column: number } | null;
  heading?: string | null;
  indexing?: boolean;
}): StatusInput {
  const bytes = typeof over.text === 'string' || over.text === undefined ? bytesOf(over.text ?? 'one two three\n') : over.text;
  const buffer = createBuffer(over.path, bytes);
  const lines = lineCountOfBytes(buffer.bytes, buffer.eol, buffer.bom);
  return {
    document: {
      kind: over.kind,
      path: over.path,
      words: over.words === undefined ? countWords(buffer.text) : over.words,
      lines,
      caret: over.caret ?? null,
      heading: over.heading ?? null,
      encoding: encodingFact(buffer),
      eol: buffer.eol,
      rows: buffer.eol === 'none' ? 1 : lines + 1,
    },
    theme: 'Night',
    textSize: 20,
    indexing: over.indexing ?? false,
  };
}

const textsOf = (input: StatusInput): Record<string, string> => Object.fromEntries(statusItems(input).map((i) => [i.id, i.text]));

test('a report says words; a Rust file says lines and its language', () => {
  const report = textsOf(snapshot({ kind: 'report', path: '/r/Plan.md', text: 'One two three four.\n\nFive six.\n' }));
  assert.equal(report.kind, 'Report');
  assert.equal(report.measure, '6 words');
  const rust = textsOf(snapshot({ kind: 'code', path: '/r/src/main.rs', text: 'fn main() {\n    println!("hi");\n}\n' }));
  assert.equal(rust.kind, 'Code · Rust');
  assert.equal(rust.measure, '3 lines');
});

test('every kind has a measure: words for the seven prose kinds, lines for the rest', () => {
  assert.deepEqual([...PROSE_KINDS].sort(), ['article', 'book', 'docs', 'notes', 'readme', 'report', 'transcript']);
  for (const kind of KINDS) assert.equal(measureFor(kind), PROSE_KINDS.has(kind) ? 'words' : 'lines', kind);
  for (const kind of ['log', 'data', 'terminal', 'diff', 'html', 'changelog'] as const) {
    const t = textsOf(snapshot({ kind, path: '/r/x.txt', text: 'a\nb\n' }));
    assert.equal(t.measure, '2 lines', kind);
  }
  assert.equal(textsOf(snapshot({ kind: 'log', path: '/r/build.log', text: 'a\n' })).kind, 'Log');
});

test('a single word and a single line are not plural; a count of thousands has commas', () => {
  assert.equal(textsOf(snapshot({ kind: 'article', path: '/r/a.md', text: 'word' })).measure, '1 word');
  assert.equal(textsOf(snapshot({ kind: 'code', path: '/r/a.py', text: 'x = 1' })).measure, '1 line');
  assert.equal(textsOf(snapshot({ kind: 'article', path: '/r/a.md', words: 12345 })).measure, '12,345 words');
  assert.equal(textsOf(snapshot({ kind: 'article', path: '/r/a.md', words: null })).measure, 'Counting words…');
});

test('the encoding and the line endings are the bytes: LF, CRLF, mixed, CR, a BOM, and bytes that are not UTF-8', () => {
  const enc = (text: string | Uint8Array): string => textsOf(snapshot({ kind: 'article', path: '/r/a.md', text })).encoding!;
  assert.equal(enc('a\nb\n'), 'UTF-8 · LF');
  assert.equal(enc('a\r\nb\r\n'), 'UTF-8 · CRLF');
  assert.equal(enc('a\r\nb\nc\n'), 'UTF-8 · Mixed');
  assert.equal(enc('a\rb\r'), 'UTF-8 · CR');
  assert.equal(enc('no break'), 'UTF-8', 'a file with no line break has none to name');
  assert.equal(enc(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0a])), 'UTF-8 with BOM · LF');
  assert.equal(enc(new Uint8Array([0x61, 0xff, 0x0a])), 'Not valid UTF-8 · 1 byte · LF');
});

test('where you are: Ln, Col in Source; the section in Read; nothing above the first heading', () => {
  const source = statusItems(snapshot({ kind: 'article', path: '/r/a.md', caret: { line: 23, column: 14 } }));
  assert.equal(source.find((i) => i.id === 'where')!.text, 'Ln 23, Col 14');
  assert.equal(statusItems(snapshot({ kind: 'article', path: '/r/a.md', caret: { line: 1234, column: 1 } })).find((i) => i.id === 'where')!.text, 'Ln 1,234, Col 1');
  const read = statusItems(snapshot({ kind: 'article', path: '/r/a.md', heading: 'Method' }));
  assert.equal(read.find((i) => i.id === 'where')!.text, 'Method');
  assert.equal(statusItems(snapshot({ kind: 'article', path: '/r/a.md', heading: null })).some((i) => i.id === 'where'), false);
});

test('the theme and the text size are the right-hand items, in that order, and the document items are absent with no document', () => {
  const items = statusItems(snapshot({ kind: 'article', path: '/r/a.md' }));
  assert.deepEqual(items.filter((i) => i.end).map((i) => [i.id, i.text]), [['theme', 'Night'], ['size', '20 px']]);
  assert.deepEqual(items.filter((i) => !i.end).map((i) => i.id), ['kind', 'measure', 'encoding']);
  const none = statusItems({ document: null, theme: 'Paper', textSize: 24, indexing: false });
  assert.deepEqual(none.map((i) => [i.id, i.text, i.end]), [['theme', 'Paper', true], ['size', '24 px', true]]);
});

test('slow work: the progress item is there only while it is asked for', () => {
  const on = statusItems(snapshot({ kind: 'article', path: '/r/a.md', indexing: true }));
  assert.equal(on.find((i) => i.id === 'progress')!.text, 'Indexing…');
  assert.equal(on.find((i) => i.id === 'progress')!.end, false);
  assert.equal(statusItems(snapshot({ kind: 'article', path: '/r/a.md' })).some((i) => i.id === 'progress'), false);
});

test('an item is a button only where something is behind it', () => {
  assert.deepEqual(Object.keys(OPENS).sort(), ['theme', 'where']);
  const none = new Set<string>();
  const outline = new Set(['links', 'outline']);
  assert.equal(isButton('where', none, false, true), false, 'no Outline tab registered: not a button');
  assert.equal(isButton('where', outline, false, true), true);
  assert.equal(isButton('where', outline, true, true), false, 'the inspector cannot be shown (narrow window over Source): the door is shut');
  assert.equal(isButton('theme', none, false, true), true);
  assert.equal(isButton('theme', none, false, false), false, 'no palette to open');
  for (const id of ['kind', 'measure', 'encoding', 'progress', 'size'] as const) assert.equal(isButton(id, outline, false, true), false, id);
});

test('the themes are named as the palette names them, half by half', () => {
  assert.equal(themeLabel(null, 'dark'), 'Night');
  assert.equal(themeLabel(null, 'light'), 'Paper');
  assert.equal(themeLabel('warm', 'dark'), 'Dusk');
  assert.equal(themeLabel('warm', 'light'), 'Sepia');
  assert.equal(themeLabel('ink', 'dark'), 'Ink');
  assert.equal(themeLabel('fjord', 'dark'), 'Fjord');
  assert.equal(themeLabel('high-contrast', 'light'), 'High contrast');
  assert.equal(themeLabel('folder', 'dark'), 'Theme folder');
});

test('a code file names its language; a kind that is not code names none', () => {
  assert.equal(kindLabel('code', '/r/a.ts'), 'Code · TypeScript');
  assert.equal(kindLabel('code', '/r/a.cpp'), 'Code · C++');
  assert.equal(kindLabel('code', '/r/Dockerfile'), 'Code · Dockerfile');
  assert.equal(kindLabel('code', '/r/unknown.zzz'), 'Code');
  assert.equal(kindLabel('data', '/r/a.json'), 'Data');
});

test('the word counter agrees with the library\'s words: count, over odd text and over any way of cutting it into chunks', () => {
  const samples = [
    '', ' ', 'one', 'one two', '  leading and trailing  ', 'a-b c_d e.f', '--- *** ___', '12 34, 5.6', 'café naïve',
    '你好 世界', '𝒜 𝒝', 'x y z　w﻿v', '# Title\n\nBody text here.\n\n- item\n- item two\n',
    'a b c', '\u{1F600} \u{1F600}a', 'tab\tseparated\tvalues',
  ];
  for (const text of samples) {
    assert.equal(countWords(text), measureText(text).words, JSON.stringify(text));
    for (const size of [1, 2, 3, 5]) {
      const counter = createWordCounter();
      for (let i = 0; i < text.length; i += size) counter.feed(text.slice(i, i + size));
      assert.equal(counter.done(), measureText(text).words, `${JSON.stringify(text)} in chunks of ${size}`);
    }
  }
});

test('the line count from the bytes is the editor\'s own count, for every ending and with or without a last break', () => {
  const cases: [string, string][] = [
    ['', 'empty'], ['\n', 'one break'], ['a', 'no break'], ['a\n', 'LF'], ['a\nb', 'LF, no last'], ['a\r\nb\r\n', 'CRLF'], ['a\r\nb', 'CRLF, no last'],
    ['a\rb\r', 'CR'], ['a\rb', 'CR, no last'], ['a\r\nb\nc', 'mixed'], ['a\nb\r\n', 'mixed, ends CRLF'], ['\n\n\n', 'blank lines'],
  ];
  for (const [text, name] of cases) {
    const buffer = createBuffer('/r/x.txt', bytesOf(text));
    // The editor's text and its separator, as Source builds them (`lineSeparatorFor`: CRLF and CR files keep theirs, anything else is LF).
    const separator = buffer.eol === 'crlf' ? '\r\n' : buffer.eol === 'cr' ? '\r' : '\n';
    const doc = Text.of(text.split(separator));
    assert.equal(lineCountOfBytes(buffer.bytes, buffer.eol, buffer.bom), lineCountOf(doc), name);
  }
  const bom = createBuffer('/r/x.txt', new Uint8Array([0xef, 0xbb, 0xbf]));
  assert.equal(lineCountOfBytes(bom.bytes, bom.eol, bom.bom), 0, 'a BOM alone is no line');
});

test('the caret is counted in characters: a pair is one, a tab is one', () => {
  const doc = Text.of(['first', 'a😀b\tc', 'third']);
  assert.deepEqual(caretOf(doc, 0), { line: 1, column: 1 });
  const start = doc.line(2).from;
  assert.deepEqual(caretOf(doc, start + 1), { line: 2, column: 2 });
  assert.deepEqual(caretOf(doc, start + 3), { line: 2, column: 3 }, 'after the pair');
  assert.deepEqual(caretOf(doc, start + 5), { line: 2, column: 5 }, 'after the tab');
  assert.deepEqual(caretOf(doc, doc.length), { line: 3, column: 6 });
});

test('the section under a byte offset is the last heading at or above it', () => {
  const entries = [
    { level: 1, text: 'Title', src: { file: 'a', start: 0, end: 7 } },
    { level: 2, text: 'Method', src: { file: 'a', start: 100, end: 110 } },
    { level: 2, text: 'Results', src: { file: 'a', start: 400, end: 410 } },
  ] as never;
  assert.equal(sectionAt([], 50), null);
  assert.equal(sectionAt(entries, 0), 'Title');
  assert.equal(sectionAt(entries, 99), 'Title');
  assert.equal(sectionAt(entries, 100), 'Method');
  assert.equal(sectionAt(entries, 399), 'Method');
  assert.equal(sectionAt(entries, 10_000), 'Results');
  const late = [{ level: 2, text: 'Late', src: { file: 'a', start: 100, end: 110 } }] as never;
  assert.equal(sectionAt(late, 50), null, 'nothing above the first heading');
});
