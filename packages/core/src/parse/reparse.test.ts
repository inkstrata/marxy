// B-23: the reparse after a change equals the whole file's parse, node for node and range for range,
// for random edits over the corpus, and parses only a region when it can.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Document } from '../contracts/ast.ts';
import { lineStartAt } from '../sourcemap/line-starts.ts';
import { parseMarkdown } from './parse.ts';
import { lastReparse, reparseMarkdown } from './reparse.ts';

/** More seeds for a longer local run: `REPARSE_SEEDS=50 node --test …`. */
const SEEDS = Number(process.env.REPARSE_SEEDS ?? 1);

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
  for (let round = 0; round < SEEDS; round++) {
    for (const [index, name] of files.entries()) {
      const bytes = read(name);
      const counts = check(name, bytes, bytes.length > 100_000 ? 6 : 60, 1000 * (round + 1) + index, NO_DEFINITIONS);
      region += counts.region;
      whole += counts.whole;
    }
  }
  // Not a vacuous pass: most edits took the region path (the rest hold `]:` and are parsed whole).
  assert.ok(region > whole, `region ${region}, whole ${whole}`);
});

test('a reparse equals the whole parse for many random edits over a long transcript (B-23)', () => {
  const bytes = transcript(40_000);
  for (let seed = 1; seed <= 3 * SEEDS; seed++) {
    const counts = check('transcript', bytes, 100, seed, NO_DEFINITIONS);
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
