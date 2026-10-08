// B-23: the reparse after a change equals the whole file's parse, node for node and range for range,
// for structured random documents and edits, for random edits over the corpus and for the cases a
// review found, and parses only a region when it can.
//
// The structured property runs a fixed number of seeds on every pull request. A stress run takes more:
// `REPARSE_SEEDS=1500 node --test --experimental-strip-types packages/core/src/parse/reparse.test.ts`.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Document } from '../contracts/ast.ts';
import { lineStartAt } from '../sourcemap/line-starts.ts';
import { parseMarkdown } from './parse.ts';
import { lastReparse, reparseMarkdown } from './reparse.ts';

/** Seeds of the structured property: 25 chained edits over one generated document each. */
const SEEDS = Number(process.env.REPARSE_SEEDS ?? 100);
/** Rounds of random edits over the corpus. */
const ROUNDS = Number(process.env.REPARSE_ROUNDS ?? 1);

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const files = readdirSync(corpus).filter((name) => name.endsWith('.md')).sort();
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, corpus)));
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A small deterministic generator (mulberry32), so a failure names a seed that reproduces it. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What an edit writes: the constructs that reach across lines and blocks (fences, lists, quotes,
 * setext underlines, tables, HTML, math, lazy lines, indentation), line endings of every kind, a
 * definition, a byte-order mark mid-file, multi-byte text and a stray byte that is not UTF-8.
 */
const FRAGMENTS: readonly (string | Uint8Array)[] = [
  '\n', '\n\n', '\r\n', '\r', ' ', '  ', '    ', '\t', 'x', 'word ', 'é', '日本', '🙂',
  '```\n', '```js\n', '~~~\n', '- ', '- item\n', '* ', '1. ', '2) ', '  - nested\n', '> ', '> quoted\n',
  '===\n', '---\n', '***\n', '# ', '## Heading\n', '| a | b |\n|---|---|\n', '| c |\n', '<div>\n', '</div>\n',
  '<!-- ', ' -->\n', '<pre>\n', '$$\n', '$x$', '`', '**', '_', '[x] ', '- [ ] task\n', '[link](http://a.example)',
  '[ref]: http://r.example\n', '[^1]', '[^1]: note\n', '﻿', 'lazy continuation\n', '+++\n',
  new Uint8Array([0xff]), new Uint8Array([0xe2, 0x82]),
];

/** The fragments without a definition, for a file that should stay one the reparse can take in part. */
const NO_DEFINITIONS = FRAGMENTS.filter((f) => typeof f !== 'string' || !f.includes(']:'));

function fragment(next: () => number, pool: readonly (string | Uint8Array)[]): Uint8Array {
  const f = pool[Math.floor(next() * pool.length)]!;
  return typeof f === 'string' ? encode(f) : f;
}

/** One random edit: an insertion at a line start or anywhere, a deletion, or a replacement. */
function edit(bytes: Uint8Array, next: () => number, pool: readonly (string | Uint8Array)[]): Uint8Array {
  let at = Math.floor(next() * (bytes.length + 1));
  const kind = next();
  if (kind < 0.3) {
    while (at > 0 && bytes[at - 1] !== 0x0a) at--; // a line start, where most structure begins
  }
  const span = kind < 0.55 ? 0 : Math.min(bytes.length - at, Math.floor(next() * (next() < 0.8 ? 12 : 400)));
  const insert = kind > 0.75 && kind < 0.85 ? new Uint8Array(0) : fragment(next, pool);
  const out = new Uint8Array(bytes.length - span + insert.length);
  out.set(bytes.subarray(0, at));
  out.set(insert, at);
  out.set(bytes.subarray(at + span), at + insert.length);
  return out;
}

/** The two parses as the same JSON, and the same line starts at every line. */
function assertSameParse(actual: Document, expected: Document, bytes: Uint8Array, where: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    let i = 0;
    while (i < a.length && a[i] === e[i]) i++;
    assert.fail(`${where}: the reparse differs from the whole parse at JSON index ${i}:\n  reparse ${a.slice(Math.max(0, i - 120), i + 120)}\n  whole   ${e.slice(Math.max(0, i - 120), i + 120)}`);
  }
  for (let b = 0; b <= bytes.length; b += Math.max(1, Math.floor(bytes.length / 50))) {
    assert.equal(lineStartAt(actual, b), lineStartAt(expected, b), `${where}: line start at byte ${b}`);
  }
}

/** Runs `edits` chained edits over `bytes`, each reparsed from the reparse before it. */
function check(name: string, bytes: Uint8Array, edits: number, seed: number, pool = FRAGMENTS): { region: number; whole: number } {
  const next = random(seed);
  const file = `/corpus/${name}`;
  let before = bytes;
  let previous = parseMarkdown(before, { file });
  const counts = { region: 0, whole: 0 };
  for (let n = 0; n < edits; n++) {
    const after = edit(before, next, pool);
    const where = `${name} seed ${seed} edit ${n}`;
    const reparsed = reparseMarkdown(previous, before, after, { file });
    counts[lastReparse().kind]++;
    assertSameParse(reparsed, parseMarkdown(after, { file }), after, where);
    before = after;
    previous = reparsed;
  }
  return counts;
}

/** The corpus's agent transcript, as many turns as make about `bytes`: a long file with no definitions. */
function transcript(bytes: number): Uint8Array {
  const turn = new TextDecoder().decode(read('18-agent-transcript.md'));
  let out = '';
  for (let n = 1; out.length < bytes; n++) out += `## Turn ${n}\n\n${turn}\n`;
  return encode(out);
}

test('a reparse equals the whole parse for random edits over every corpus file (B-23)', () => {
  let region = 0;
  let whole = 0;
  for (let round = 0; round < ROUNDS; round++) {
    for (const [index, name] of files.entries()) {
      const bytes = read(name);
      const counts = check(name, bytes, bytes.length > 100_000 ? 6 : 20, 1000 * (round + 1) + index, NO_DEFINITIONS);
      region += counts.region;
      whole += counts.whole;
    }
  }
  // Not a vacuous pass: most edits took the region path (the rest are in files that hold a definition).
  assert.ok(region > whole, `region ${region}, whole ${whole}`);
});

test('a reparse equals the whole parse for many random edits over a long transcript (B-23)', () => {
  const bytes = transcript(40_000);
  for (let seed = 1; seed <= 2 * ROUNDS; seed++) {
    const counts = check('transcript', bytes, 60, seed, NO_DEFINITIONS);
    assert.ok(counts.region > counts.whole, `seed ${seed}: region ${counts.region}, whole ${counts.whole}`);
  }
});

test('one line written into a long transcript parses a few blocks, not the file (B-23)', () => {
  const before = transcript(200_000);
  const text = new TextDecoder().decode(before);
  const at = encode(text.slice(0, text.indexOf('## Turn 2\n'))).length;
  const line = encode('One line an outside editor wrote.\n\n');
  const after = new Uint8Array(before.length + line.length);
  after.set(before.subarray(0, at));
  after.set(line, at);
  after.set(before.subarray(at), at + line.length);
  const file = '/t.md';
  const reparsed = reparseMarkdown(parseMarkdown(before, { file }), before, after, { file });
  assert.equal(lastReparse().kind, 'region');
  assert.ok(lastReparse().parsed < 10_000, `parsed ${lastReparse().parsed} bytes`);
  assertSameParse(reparsed, parseMarkdown(after, { file }), after, 'one line near the top');
});

test('a change that opens a fence grows the region until the parse closes, or parses whole (B-23)', () => {
  const before = transcript(30_000);
  const text = new TextDecoder().decode(before);
  const file = '/t.md';
  for (const opener of ['```\n', '<pre>\n', '$$\n', '<!--\n']) {
    const at = encode(text.slice(0, text.indexOf('## Turn 3\n'))).length;
    const after = new Uint8Array([...before.subarray(0, at), ...encode(opener), ...before.subarray(at)]);
    const reparsed = reparseMarkdown(parseMarkdown(before, { file }), before, after, { file });
    assertSameParse(reparsed, parseMarkdown(after, { file }), after, `opening ${JSON.stringify(opener)}`);
  }
});

test('a definition anywhere sends the reparse to the whole file (B-23)', () => {
  const before = encode('# A\n\nSee [the ref].\n\nMore.\n');
  const after = encode('# A\n\nSee [the ref].\n\nMore.\n\n[the ref]: http://r.example\n');
  const file = '/d.md';
  const reparsed = reparseMarkdown(parseMarkdown(before, { file }), before, after, { file });
  assert.equal(lastReparse().kind, 'whole');
  assertSameParse(reparsed, parseMarkdown(after, { file }), after, 'definition appended');
});

test('a previous parse of other bytes or another name is not trusted (B-23)', () => {
  const before = encode('# A\n\ntext\n');
  const after = encode('# A\n\ntext, more\n');
  const reparsed = reparseMarkdown(parseMarkdown(before, { file: '/old.md' }), before, after, { file: '/new.md' });
  assert.equal(lastReparse().kind, 'whole');
  assertSameParse(reparsed, parseMarkdown(after, { file: '/new.md' }), after, 'renamed');
});

/**
 * The structured generator (from the review of #467): documents built from block constructs that reach
 * across lines and blank lines (lists with wide content indents and empty items, nested quotes and
 * lists, HTML blocks of types 1 to 7 and custom elements, fences, math, tables, setext headings), with
 * zero to two blank lines between, and edits that mix fragments written at a line start with whole blocks.
 */
const BLOCKS: readonly string[] = [
  'para one\n', 'para two\nlazy line\n', '# H\n', 'Setext\n===\n', 'Setext2\n---\n', '---\n', '***\n',
  '```\ncode\n```\n', '~~~js\na\n\nb\n~~~\n', '    indented\n    code\n', '- a\n- b\n', '- a\n\n- b\n', '1. one\n2. two\n',
  '* x\n  cont\n', '> quote\nlazy\n', '> q\n>\n> q2\n', '| a | b |\n|---|---|\n| 1 | 2 |\n', '<div>\nhtml\n</div>\n',
  '<!--\ncomment\n\nstill\n-->\n', '<pre>\nx\n\ny\n</pre>\n', '<script>\na\n\nb\n</script>\n', '<?php\n\n?>\n', '<!X\n\n>\n',
  '<![CDATA[\n\n]]>\n', '<custom-el>\n', '$$\nx^2\n\ny\n$$\n', '- [ ] task\n- [x] done\n', 'text with $m$ and `c`\n',
  '- a\n  - b\n\n    c\n', '1) x\n\n   y\n', 'Term\n: def?\n', '\\\n', 'a  \nb\n', '<del>x</del>\n', 'www.example.com\n',
  '+ p\n+ q\n', '> - a\n> - b\n', '- > a\n  > b\n', '| x |\n|:-:|\n', 'a | b\n-|-\n',
  '1.   wide\n\n    under\n', '-\n\n    after empty\n', '2.\n', ' -    b\n',
];
const PIECES: readonly string[] = [
  '\n', '\n\n', '\r\n', '\r', ' ', '   ', '    ', '\t', 'x', '```', '```\n', '~~~\n', '- ', '* ', '+ ', '1. ', '> ', '>', '===', '---',
  '--\n', '# ', '|', '|---|\n', '<div>', '</div>', '<!--', '-->', '<pre>', '</pre>', '<script>', '</script>', '<?', '?>', '<!X', '>',
  '<![CDATA[', ']]>', '$$', '$$\n', '$', '`', '[', ']', '(', ')', '\\', 'lazy\n', '  - n\n', '\n    code\n', '\n\n- item\n', '\n> q\n',
  '<a>\n', '</a>\n', '<x-y>\n', '[^1]', 'if xs[0]:', ' ', 'é', '日', '﻿',
];

function generated(next: () => number): string {
  const blank = (): string => {
    const r = next();
    return r < 0.6 ? '\n' : r < 0.8 ? '' : r < 0.95 ? '\n\n' : '  \n';
  };
  let text = '';
  for (let count = 6 + Math.floor(next() * 30); count > 0; count--) text += BLOCKS[Math.floor(next() * BLOCKS.length)]! + blank();
  if (next() < 0.1) text = `---\na: 1\n---\n${text}`;
  if (next() < 0.05) text = `﻿${text}`;
  if (next() < 0.15) text = text.replace(/\n/g, '\r\n');
  return text;
}

function structuredEdit(text: string, next: () => number): string {
  let out = text;
  for (let count = 1 + Math.floor(next() * 2); count > 0; count--) {
    let at = Math.floor(next() * (out.length + 1));
    const kind = next();
    if (kind < 0.4) while (at > 0 && out[at - 1] !== '\n') at--;
    if (kind > 0.8 && kind < 0.9) {
      out = out.slice(0, at) + out.slice(at + Math.floor(next() * 20));
      continue;
    }
    const piece = next() < 0.3 ? BLOCKS[Math.floor(next() * BLOCKS.length)]! : PIECES[Math.floor(next() * PIECES.length)]!;
    out = out.slice(0, at) + piece + out.slice(at + (kind > 0.9 ? Math.floor(next() * 6) : 0));
  }
  return out;
}

/** The two parses as the same JSON, and the same line start at every byte. */
function assertSameEverywhere(before: string, after: string, where: string): 'region' | 'whole' {
  const file = '/s.md';
  const b = encode(before);
  const a = encode(after);
  const reparsed = reparseMarkdown(parseMarkdown(b, { file }), b, a, { file });
  const kind = lastReparse().kind;
  const whole = parseMarkdown(a, { file });
  const same = JSON.stringify(reparsed) === JSON.stringify(whole);
  let lines = same;
  for (let at = 0; lines && at <= a.length; at++) lines = lineStartAt(reparsed, at) === lineStartAt(whole, at);
  if (!same || !lines) {
    assert.fail(`${where}: the reparse (${kind}) differs from the whole parse${same ? ' in its line starts' : ''}\n  before ${JSON.stringify(before)}\n  after  ${JSON.stringify(after)}`);
  }
  return kind;
}

test('a reparse equals the whole parse for structured random documents and edits (B-23)', () => {
  const counts = { region: 0, whole: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const next = random(seed);
    let text = generated(next);
    for (let n = 0; n < 25; n++) {
      const after = structuredEdit(text, next);
      counts[assertSameEverywhere(text, after, `structured seed ${seed} edit ${n}`)]++;
      text = after;
    }
  }
  if (process.env.REPARSE_SEEDS !== undefined) console.log(`structured: ${SEEDS} seeds, ${counts.region + counts.whole} edits, region ${counts.region}, whole ${counts.whole}, failures 0`);
  assert.ok(counts.region > counts.whole, `region ${counts.region}, whole ${counts.whole}`);
});

/** Forty short paragraphs, so a small case is a small part of its file and takes the region path. */
const PAD = Array.from({ length: 40 }, (_, n) => `p${n}\n`).join('\n');

/** Each case alone, after a long tail, and between two, all taking the region path. */
function assertCase(before: string, after: string, name: string): void {
  for (const [b, a, where] of [
    [`${before}\n${PAD}`, `${after}\n${PAD}`, 'at the top'],
    [`${PAD}\n${before}\n${PAD}`, `${PAD}\n${after}\n${PAD}`, 'in the middle'],
  ] as const) {
    assert.equal(assertSameEverywhere(b, a, `${name}, ${where}`), 'region', `${name}, ${where}: took the region path`);
  }
}

test('a list item open across a blank line does not leave a stale restart or witness (B-23, review of #467)', () => {
  // Under code that follows a list item, a line appended: the code is parsed under the list's state.
  assertCase('1.   item\n\n    one\n\na\n\nb\n\nc\n', '1.   item\n\n    one\n    two\n\na\n\nb\n\nc\n', 'indented line appended');
  // The list deleted: the code after it, split under the list, is one block once it is gone.
  assertCase('2.\n\n    indented\n    indented\n    code\n', '\n\n    indented\n    indented\n    code\n', 'empty item removed');
  assertCase('-\n\n    one\n    two\n\na\n\nb\n', '-\n\n    one\n    two!\n\na\n\nb\n', 'code after an empty item edited');
  assertCase(' -    b\n\n    indented\n', ' -    b\n\n    indented\n    code\n', 'code after a wide item grown');
  // A paragraph turned into the list's next item: the restart may not follow a list.
  assertCase('x\n\n- a\n\n-b\n\nc\n\nd\n', 'x\n\n- a\n\n- b\n\nc\n\nd\n', 'paragraph becomes the next item');
});

test('indented code carries state across blank lines, so no restart or witness follows it (B-23)', () => {
  // After `    a` and a blank line, `-` then a line is a paragraph; alone, `-` is an empty list item.
  assertCase('    under\n\n-\n', '    under\n\n-\n~~~\nx\n~~~\n', 'a line after an empty item under indented code');
  assertCase('    under\n\n- x\n\nb\n', '    under\n\n-\nfoo\n\nb\n', 'an item emptied under indented code');
});

test('the witness is parsed with its line ending, as the whole file holds it (B-23, review of #467)', () => {
  assertCase('a\n\nh\n\n<x-y>\n\nb\n\nc\n\nd\n', 'a\n\n- h\n<x-y>\n\nb\n\nc\n\nd\n', 'a line retyped as an item over a custom element');
  assertCase('a\n\n# h\n<x-y>\n\nb\n\nc\n', 'a\n\n- h\n<x-y>\n\nb\n\nc\n', 'a heading retyped as an item');
  assertCase('a\n\nh\n\n<custom-el>\n\nb\n\nc\n', 'a\n\n- h\n<custom-el>\n\nb\n\nc\n', 'over <custom-el>');
  assertCase('a\n\n> quote\n<custom-el>\n\nb\n\nc\n', 'a\n\n- quote\n<custom-el>\n\nb\n\nc\n', 'a quote retyped as an item');
});

test('only a definition in either parse sends the reparse to the whole file, not text that looks like one (B-23)', () => {
  const file = '/d.md';
  const run = (before: string, after: string): string => {
    const b = encode(before);
    const a = encode(after);
    const reparsed = reparseMarkdown(parseMarkdown(b, { file }), b, a, { file });
    assertSameParse(reparsed, parseMarkdown(a, { file }), a, JSON.stringify(after.slice(0, 40)));
    return lastReparse().kind;
  };
  const code = '```python\nif xs[0]:\n    pass\n```\n\nindex: `[key: string]: T`\n\n';
  assert.equal(run(`${code}${PAD}`, `${code}${PAD}more\n`), 'region', '`]:` in code and text');
  assert.equal(run(`See [r].\n\n${PAD}`, `See [r].\n\n${PAD}\n[r]: http://r.example\n`), 'whole', 'a definition added');
  assert.equal(run(`See [r].\n\n[r]: http://r.example\n\n${PAD}`, `See [r].\n\n${PAD}`), 'whole', 'a definition removed');
  assert.equal(run(`See [r].\n\n[r]: http://r.example\n\n${PAD}`, `See [r].\n\n[r]: http://r.example\n\n${PAD}x\n`), 'whole', 'a definition kept');
  assert.equal(run(`Note[^1].\n\n${PAD}`, `Note[^1].\n\n${PAD}\n[^1]: the note\n`), 'whole', 'a footnote definition added');
  assert.equal(run(`Note[^1].\n\n[^1]: the note\n\n${PAD}`, `Note[^1].\n\n${PAD}`), 'whole', 'a footnote definition removed');
});
