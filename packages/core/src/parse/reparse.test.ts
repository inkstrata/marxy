// the reparse after a change equals the whole file's parse, node for node and range for range,
// for structured random documents and edits, for random edits over the corpus and for the cases a
// review found, and parses only a region when it can.
//
// The structured property runs a fixed number of seeds on every CI run. A stress run takes more:
// `REPARSE_SEEDS=1500 node --test --experimental-strip-types packages/core/src/parse/reparse.test.ts`.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Document } from '../contracts/ast.ts';
import { lineStartAt } from '../sourcemap/line-starts.ts';
import { definitionIndex, holdsDefinitions } from './from-mdast.ts';
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

/**
 * The definitions a parse carries for the next reparse: every entry where it sits, and micromark's labels (as
 * sets, since only membership is asked of them). A reparse hands its own on, so it must be the whole parse's.
 */
function definitionsOf(document: Document): string {
  const index = definitionIndex(document);
  if (index === undefined || index === 'unknown') return String(index);
  const sorted = (labels: readonly string[]): string[] => [...new Set(labels)].sort();
  return JSON.stringify({ entries: index.entries, targets: [...index.targets], links: sorted(index.links), footnotes: sorted(index.footnotes) });
}

/** The two parses as the same JSON, with the same definitions, and the same line starts at every line. */
function assertSameParse(actual: Document, expected: Document, bytes: Uint8Array, where: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    let i = 0;
    while (i < a.length && a[i] === e[i]) i++;
    assert.fail(`${where}: the reparse differs from the whole parse at JSON index ${i}:\n  reparse ${a.slice(Math.max(0, i - 120), i + 120)}\n  whole   ${e.slice(Math.max(0, i - 120), i + 120)}`);
  }
  assert.equal(definitionsOf(actual), definitionsOf(expected), `${where}: the definitions it carries`);
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

test('a reparse equals the whole parse for random edits over every corpus file', () => {
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

test('a reparse equals the whole parse for many random edits over a long transcript', () => {
  const bytes = transcript(40_000);
  for (let seed = 1; seed <= 2 * ROUNDS; seed++) {
    const counts = check('transcript', bytes, 60, seed, NO_DEFINITIONS);
    assert.ok(counts.region > counts.whole, `seed ${seed}: region ${counts.region}, whole ${counts.whole}`);
  }
});

test('one line written into a long transcript parses a few blocks, not the file', () => {
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

test('a change that opens a fence grows the region until the parse closes, or parses whole', () => {
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

test('a definition added sends the reparse to the whole file', () => {
  const before = encode('# A\n\nSee [the ref].\n\nMore.\n');
  const after = encode('# A\n\nSee [the ref].\n\nMore.\n\n[the ref]: http://r.example\n');
  const file = '/d.md';
  const reparsed = reparseMarkdown(parseMarkdown(before, { file }), before, after, { file });
  assert.equal(lastReparse().kind, 'whole');
  assertSameParse(reparsed, parseMarkdown(after, { file }), after, 'definition appended');
});

/** The corpus files whose parse holds a link reference or footnote definition. */
const withDefinitions = files.filter((name) => holdsDefinitions(parseMarkdown(read(name), { file: name })) === true);

test('a reparse of a file with definitions equals the whole parse and parses a region, for random edits over the corpus', () => {
  assert.ok(withDefinitions.length >= 5, `corpus files with definitions: ${withDefinitions.join(', ')}`);
  let region = 0;
  let whole = 0;
  for (let round = 0; round < ROUNDS; round++) {
    for (const [index, name] of withDefinitions.entries()) {
      const bytes = read(name);
      // Edits that write no definition: most leave the file's definitions as they were.
      const away = check(name, bytes, bytes.length > 100_000 ? 8 : 25, 7000 * (round + 1) + index, NO_DEFINITIONS);
      region += away.region;
      whole += away.whole;
      // Edits that may write one: only the equality is asked of these.
      check(name, bytes, bytes.length > 100_000 ? 4 : 12, 9000 * (round + 1) + index, FRAGMENTS);
    }
  }
  assert.ok(region > 2 * whole, `region ${region}, whole ${whole}`);
});

test('a previous parse of other bytes or another name is not trusted', () => {
  const before = encode('# A\n\ntext\n');
  const after = encode('# A\n\ntext, more\n');
  const reparsed = reparseMarkdown(parseMarkdown(before, { file: '/old.md' }), before, after, { file: '/new.md' });
  assert.equal(lastReparse().kind, 'whole');
  assertSameParse(reparsed, parseMarkdown(after, { file: '/new.md' }), after, 'renamed');
});

/**
 * The structured generator: documents built from block constructs that reach
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

function structuredEdit(text: string, next: () => number, blocks = BLOCKS, pieces = PIECES): string {
  let out = text;
  for (let count = 1 + Math.floor(next() * 2); count > 0; count--) {
    let at = Math.floor(next() * (out.length + 1));
    const kind = next();
    if (kind < 0.4) while (at > 0 && out[at - 1] !== '\n') at--;
    if (kind > 0.8 && kind < 0.9) {
      out = out.slice(0, at) + out.slice(at + Math.floor(next() * 20));
      continue;
    }
    const piece = next() < 0.3 ? blocks[Math.floor(next() * blocks.length)]! : pieces[Math.floor(next() * pieces.length)]!;
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
  const same = JSON.stringify(reparsed) === JSON.stringify(whole) && definitionsOf(reparsed) === definitionsOf(whole);
  let lines = same;
  for (let at = 0; lines && at <= a.length; at++) lines = lineStartAt(reparsed, at) === lineStartAt(whole, at);
  if (!same || !lines) {
    assert.fail(`${where}: the reparse (${kind}) differs from the whole parse${same ? ' in its line starts' : ''}\n  before ${JSON.stringify(before)}\n  after  ${JSON.stringify(after)}`);
  }
  return kind;
}

test('a reparse equals the whole parse for structured random documents and edits', () => {
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

test('a list item open across a blank line does not leave a stale restart or witness', () => {
  // Under code that follows a list item, a line appended: the code is parsed under the list's state.
  assertCase('1.   item\n\n    one\n\na\n\nb\n\nc\n', '1.   item\n\n    one\n    two\n\na\n\nb\n\nc\n', 'indented line appended');
  // The list deleted: the code after it, split under the list, is one block once it is gone.
  assertCase('2.\n\n    indented\n    indented\n    code\n', '\n\n    indented\n    indented\n    code\n', 'empty item removed');
  assertCase('-\n\n    one\n    two\n\na\n\nb\n', '-\n\n    one\n    two!\n\na\n\nb\n', 'code after an empty item edited');
  assertCase(' -    b\n\n    indented\n', ' -    b\n\n    indented\n    code\n', 'code after a wide item grown');
  // A paragraph turned into the list's next item: the restart may not follow a list.
  assertCase('x\n\n- a\n\n-b\n\nc\n\nd\n', 'x\n\n- a\n\n- b\n\nc\n\nd\n', 'paragraph becomes the next item');
});

test('indented code carries state across blank lines, so no restart or witness follows it', () => {
  // After `    a` and a blank line, `-` then a line is a paragraph; alone, `-` is an empty list item.
  assertCase('    under\n\n-\n', '    under\n\n-\n~~~\nx\n~~~\n', 'a line after an empty item under indented code');
  assertCase('    under\n\n- x\n\nb\n', '    under\n\n-\nfoo\n\nb\n', 'an item emptied under indented code');
});

test('the witness is parsed with its line ending, as the whole file holds it', () => {
  assertCase('a\n\nh\n\n<x-y>\n\nb\n\nc\n\nd\n', 'a\n\n- h\n<x-y>\n\nb\n\nc\n\nd\n', 'a line retyped as an item over a custom element');
  assertCase('a\n\n# h\n<x-y>\n\nb\n\nc\n', 'a\n\n- h\n<x-y>\n\nb\n\nc\n', 'a heading retyped as an item');
  assertCase('a\n\nh\n\n<custom-el>\n\nb\n\nc\n', 'a\n\n- h\n<custom-el>\n\nb\n\nc\n', 'over <custom-el>');
  assertCase('a\n\n> quote\n<custom-el>\n\nb\n\nc\n', 'a\n\n- quote\n<custom-el>\n\nb\n\nc\n', 'a quote retyped as an item');
});

/** The reparse of `before` to `after` checked against the whole parse; the path it took. */
function run(before: string, after: string): 'region' | 'whole' {
  const file = '/d.md';
  const b = encode(before);
  const a = encode(after);
  const reparsed = reparseMarkdown(parseMarkdown(b, { file }), b, a, { file });
  const kind = lastReparse().kind;
  assertSameParse(reparsed, parseMarkdown(a, { file }), a, JSON.stringify(after.slice(0, 60)));
  return kind;
}

test('an edit that adds, removes or changes a definition sends the reparse to the whole file; text that only looks like one does not', () => {
  const code = '```python\nif xs[0]:\n    pass\n```\n\nindex: `[key: string]: T`\n\n';
  assert.equal(run(`${code}${PAD}`, `${code}${PAD}more\n`), 'region', '`]:` in code and text');
  assert.equal(run(`See [r].\n\n${PAD}`, `See [r].\n\n${PAD}\n[r]: http://r.example\n`), 'whole', 'a definition added');
  assert.equal(run(`See [r].\n\n[r]: http://r.example\n\n${PAD}`, `See [r].\n\n${PAD}`), 'whole', 'a definition removed');
  assert.equal(run(`See [r].\n\n[r]: http://r.example\n\n${PAD}`, `See [r].\n\n[r]: http://changed.example\n\n${PAD}`), 'whole', 'a target changed');
  assert.equal(run(`See [r].\n\n[r]: /r "a"\n\n${PAD}`, `See [r].\n\n[r]: /r "b"\n\n${PAD}`), 'whole', 'a title changed');
  assert.equal(run(`See [r].\n\n[r]: /r\n\n${PAD}`, `See [r].\n\n[s]: /r\n\n${PAD}`), 'whole', 'a label changed');
  assert.equal(run(`Note[^1].\n\n${PAD}`, `Note[^1].\n\n${PAD}\n[^1]: the note\n`), 'whole', 'a footnote definition added');
  assert.equal(run(`Note[^1].\n\n[^1]: the note\n\n${PAD}`, `Note[^1].\n\n${PAD}`), 'whole', 'a footnote definition removed');
  assert.equal(run(`Note[^1].\n\n[^1]: the note\n\n${PAD}`, `Note[^1].\n\n[^2]: the note\n\n${PAD}`), 'whole', 'a footnote label changed');
  // A definition cannot interrupt a paragraph: the blank line above it removed, it is the paragraph's text.
  assert.equal(run(`${PAD}\nSee [r].\n\n[r]: /r\n\n${PAD}`, `${PAD}\nSee [r].\n[r]: /r\n\n${PAD}`), 'whole', 'a definition joined to the paragraph above');
  assert.equal(run(`${PAD}\nSee [r].\n[r]: /r\n\n${PAD}`, `${PAD}\nSee [r].\n\n[r]: /r\n\n${PAD}`), 'whole', 'a paragraph line split into a definition');
  assert.equal(run(`${PAD}\nSee [r].\n\n[r]: /r\n\n${PAD}`, `${PAD}\nSee [r].\n\nx[r]: /r\n\n${PAD}`), 'whole', 'a definition turned into a paragraph');
  assert.equal(run(`${PAD}\nSee [r].\n\n[r] /r\n\n${PAD}`, `${PAD}\nSee [r].\n\n[r]: /r\n\n${PAD}`), 'whole', 'a paragraph turned into a definition');
  assert.equal(run(`${PAD}\n- a\n\n      [r]: /r\n\n${PAD}\n[r]`, `${PAD}\n- a\n\n  [r]: /r\n\n${PAD}\n[r]`), 'whole', 'indented code in an item re-indented into a definition');
});

test('an edit that leaves the file\'s definitions as they were parses a region, and its references resolve as in the whole parse', () => {
  const defs = '[r]: http://r.example "R"\n\n[img]: /i.png\n\n[^1]: the note\n\n[^two]: a note\n\n    of two paragraphs\n';
  // References above and below their definitions, of every form, with the edit beside them.
  for (const [before, after, name] of [
    ['See [r].\n', 'See [r] again.\n', 'a shortcut reference above its definition'],
    ['See [r][] and [x][r].\n', 'See [r][], [x][r] and [y][R].\n', 'collapsed and full references'],
    ['An ![alt][img] and ![img].\n', 'An ![other][img] and ![img].\n', 'image references'],
    ['See [r].\n', 'See [ R ].\n', 'a label that differs in case and space'],
    ['See [r].\n', 'See [nothing].\n', 'a reference changed to a label nobody defines'],
    ['See [nothing].\n', 'See [r].\n', 'a reference changed to a defined label'],
    ['Note[^1].\n', 'Note[^1] and[^two].\n', 'footnote references'],
    ['Note[^1].\n', 'Note[^missing].\n', 'a footnote reference to no definition'],
    ['# H [r]\n', '# Heading [r][]\n', 'a reference in a heading'],
    ['| a | b |\n|---|---|\n| [r] | [^1] |\n', '| a | b |\n|---|---|\n| [r] | [^two] |\n', 'references in a table'],
  ] as const) {
    assertCase(`${before}\n${defs}`, `${after}\n${defs}`, `${name}, before the definitions`);
    assertCase(`${defs}\n${before}`, `${defs}\n${after}`, `${name}, after the definitions`);
  }
  // Definitions inside containers reach the whole file too.
  assertCase('> [q]: /q\n\n- [l]: /l\n\nSee [q] and [l].\n', '> [q]: /q\n\n- [l]: /l\n\nSee [l] and [q].\n', 'definitions in a quote and a list');
  // The first definition of a label wins, wherever the edit is.
  assertCase('[a]: /one\n\n[A]: /two\n\nSee [a].\n', '[a]: /one\n\n[A]: /two\n\nSee [a] and [A].\n', 'a duplicated label');
  // Text directly above a definition, a blank line between: the definition stays one.
  assertCase('Above.\n\n[r]: /r\n\nSee [r].\n', 'Above, edited.\n\n[r]: /r\n\nSee [r].\n', 'text above a definition');
  // An edit inside a footnote's text that keeps its label, and inside a definition's own block.
  assertCase('Note[^1].\n\n[^1]: the note\n', 'Note[^1].\n\n[^1]: the note, corrected\n', 'a footnote\'s text');
  assertCase('See [r].\n\n> [r]: /r\n> quoted\n', 'See [r].\n\n> [r]: /r\n> quoted, edited\n', 'text beside a definition in a quote');
  // No text holds a bracket, so only the definition's own start can bring the file's labels in before the parse.
  assertCase('plain\n\n[^1]: a note\n', 'plain, edited\n\n[^1]: a note\n', 'a footnote definition nothing refers to');
  assertCase('plain\n\n[r]: /r\n', 'plain, edited\n\n[r]: /r\n', 'a link definition nothing refers to');
});

test('a definition between two blocks does not stop a region from starting or ending beside it', () => {
  // A definition after every paragraph: if one made the next block no fresh line, no restart or witness would exist and the region would be the file.
  const document = (middle: string): string => Array.from({ length: 60 }, (_, n) => `p${n}${n === 30 ? middle : ''}\n\n[r${n}]: /r${n}\n\n`).join('');
  assert.equal(run(document(''), document(' edited')), 'region');
  assert.ok(lastReparse().parsed < document('').length / 4, `parsed ${lastReparse().parsed} of ${document('').length} bytes`);
});

/** Link reference and footnote definitions in every place one can sit, and the references that use them. */
const DEFINITION_BLOCKS: readonly string[] = [
  '[foo]: http://f.example\n', '[Foo]: http://second.example "a duplicate, which loses"\n', "[ bar\tbaz ]: </b b> 't'\n",
  '[img]:\n  /i.png\n', '> [quoted]: /q\n', '- [listed]: /l\n', '- item\n\n  [inner]: /in\n', '1. [ordered]: /o "t"\n',
  '[^n]: a note\n', '[^N]: the same note in capitals, which loses\n', '[^m]: a note\n\n    with a second paragraph\n',
  '> [^q]: a quoted note\n', '- [^l]: a note in a list\n', '[^n]: a note again\n',
  'See [foo], [Foo][], [x][bar baz], ![i][img] and [quoted].\n', 'Notes[^n] and[^m] and [^q] and [^l] and [^missing].\n',
  '[listed] [inner] [ordered] [nope] [BAR   BAZ] ![img]\n', '# Heading [foo] with[^N]\n', '| [foo] | [^n] |\n|---|---|\n| ![img] | [x][foo] |\n',
  '> a quote with [foo] and[^q]\n', '- a list with [quoted][]\n', '[foo]\n===\n', 'text directly above\n[foo]: /never-a-definition\n',
  // Labels that fold or escape: `ß` folds to `SS`, an escaped bracket, a label over two lines, one inside a footnote.
  '[ß]: /sz\n', '[\\]]: /escaped\n', '[a\nb]: /two-lines\n', 'See [SS], [\\]], [a b] and[^ß].\n', '[^ß]: a folded note\n',
  '[^d]: [inside]: /in-a-note\n\n    see [inside]\n', '[foo]: /a\n===\n',
];
const DEFINITION_PIECES: readonly string[] = [
  ...PIECES, '[foo]', '[Foo][]', '[x][img]', '![a][foo]', '[^n]', '[^m]', '[^q]', ']:', ':', '^', 'foo', 'bar', '[foo]: /new\n',
  '[^n]: ', '\n[^z]: z\n', '[ref]: /r\n', '  ', '>',
];

/** `generated`, with definitions and references among the blocks and one definition at the top or the bottom. */
function generatedWithDefinitions(next: () => number): string {
  const blank = (): string => {
    const r = next();
    return r < 0.6 ? '\n' : r < 0.8 ? '' : r < 0.95 ? '\n\n' : '  \n';
  };
  let text = '';
  for (let count = 6 + Math.floor(next() * 30); count > 0; count--) {
    const pool = next() < 0.4 ? DEFINITION_BLOCKS : BLOCKS;
    text += pool[Math.floor(next() * pool.length)]! + blank();
  }
  if (next() < 0.5) text = `[foo]: http://top.example\n\n${text}`;
  else text = `${text}\n\n[^n]: a note at the bottom\n\n[bar baz]: /bottom\n`;
  if (next() < 0.1) text = `---\na: 1\n---\n${text}`;
  if (next() < 0.05) text = `﻿${text}`;
  if (next() < 0.15) text = text.replace(/\n/g, '\r\n');
  return text;
}

test('a reparse equals the whole parse for structured random documents with definitions, and parses a region for most edits', () => {
  const counts = { region: 0, whole: 0 };
  const file = '/s.md';
  for (let seed = 1; seed <= SEEDS; seed++) {
    const next = random(seed * 31 + 7);
    let text = generatedWithDefinitions(next);
    // Chained as a live reload chains them: each reparse starts from the one before and the definitions it carried.
    let previous = parseMarkdown(encode(text), { file });
    for (let n = 0; n < 25; n++) {
      const after = structuredEdit(text, next, DEFINITION_BLOCKS, DEFINITION_PIECES);
      const where = `definitions seed ${seed} edit ${n}`;
      counts[assertSameEverywhere(text, after, where)]++;
      const bytes = encode(after);
      const chained = reparseMarkdown(previous, encode(text), bytes, { file });
      assertSameParse(chained, parseMarkdown(bytes, { file }), bytes, `${where}, chained`);
      text = after;
      previous = chained;
    }
  }
  if (process.env.REPARSE_SEEDS !== undefined) console.log(`structured with definitions: ${SEEDS} seeds, ${counts.region + counts.whole} edits, region ${counts.region}, whole ${counts.whole}, failures 0`);
  assert.ok(counts.region > counts.whole, `region ${counts.region}, whole ${counts.whole}`);
});
