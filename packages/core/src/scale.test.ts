// How the work on a whole document grows with the document. Each case times one function that takes a whole file
// (a parse, a render, a reading, an index, a splice, a diff) on an input and on one four times bigger, and holds the
// growth exponent under a bound: about 1 is linear, 2 is a pass over the whole input for every part of it. A file of
// 1 to 5 MB is ordinary, so work that grows faster than the file is a freeze waiting for the reader who opens one.
//
// A case that is known to grow too fast is marked `todo` with what it does; the fix flips it. A new function that
// takes a whole document, or a new shape of input that a reader meets, gets a case here (docs/big-files.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBuffer, splice } from './buffer/buffer.ts';
import { diffLines } from './diff/lines.ts';
import { parseMarkdown } from './parse/parse.ts';
import { reparseMarkdown } from './parse/reparse.ts';
import { BLOCKS } from './parse/testing/structured.ts';
import { indexLines } from './reading/lines.ts';
import { readingOf } from './reading/index.ts';
import { byteScale, parseScale } from './scale/record.ts';
import { renderDocumentSafeHtml } from './render/pipeline.ts';
import { sanitizeHtml } from './sanitize/sanitize-html.ts';
import { describeGrowth, type Growth, growth } from './testing/growth.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** `unit(i)` repeated until `bytes` is reached. */
function fill(bytes: number, unit: (i: number) => string): string {
  const parts: string[] = [];
  let n = 0;
  for (let i = 0; n < bytes; i++) {
    const u = unit(i);
    parts.push(u);
    n += u.length;
  }
  return parts.join('');
}

const WORDS = 'the reader keeps every byte as written and draws only what the page asks for while the rest waits'.split(' ');
const words = (i: number, n: number): string => Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(' ');

/** The shapes of Markdown a reader opens: each stresses a different part of the parse. */
export const MARKDOWN: Record<string, (bytes: number) => string> = {
  prose: (b) => fill(b, (i) => (i % 12 === 0 ? `## Section ${i}\n\n` : `${words(i, 60)}.\n\n`)),
  blocks: (b) => fill(b, (i) => `${BLOCKS[i % BLOCKS.length]}\n`),
  headings: (b) => fill(b, (i) => `${'#'.repeat(1 + (i % 4))} Heading ${i}\n\n${words(i, 12)}.\n\n`),
  tables: (b) => fill(b, (i) => `| id | name | value |\n| --- | --- | --- |\n${Array.from({ length: 20 }, (_, r) => `| ${i * 20 + r} | ${WORDS[r % WORDS.length]} | ${r} |`).join('\n')}\n\n`),
  fences: (b) => fill(b, (i) => `Step ${i}.\n\n\`\`\`ts\nconst x${i} = ${i};\nfunction f${i}() { return x${i} * 2; }\n\`\`\`\n\n`),
  // A file that may hold a definition is parsed whole, so its notes and references reach across it.
  references: (b) => {
    const body = fill(b * 0.85, (i) => `Paragraph ${i} cites [a source][ref-${i}] and a note.[^n${i}] ${words(i, 20)}.\n\n`);
    const n = Math.floor(body.length / 80);
    const defs = Array.from({ length: n }, (_, i) => `[ref-${i}]: https://example.org/${i}\n[^n${i}]: Note ${i}.\n`).join('');
    return `${body}\n${defs}`;
  },
  lists: (b) => fill(b, (i) => `- item ${i} ${words(i, 8)}\n  - nested ${i}\n`),
};

const SMALL = 24 * 1024;
/** Linear work measures about 1.0 to 1.2 here; a whole-input pass per part measures near 2. */
const BOUND = 1.45;

/**
 * Measures with one timed run of each size; a reading over the bound is measured again with three before it fails, so a
 * pause on a shared runner does not fail linear work, while work that really grows too fast fails both times.
 */
function holds(what: string, measure: (runs: number) => Growth): void {
  let g = measure(1);
  if (g.exponent >= BOUND) g = measure(3);
  assert.ok(g.exponent < BOUND, `${describeGrowth(what, g)}; the bound is ${BOUND}`);
}

for (const [shape, make] of Object.entries(MARKDOWN)) {
  test(`parsing Markdown (${shape}) grows with the file, not faster`, () => {
    holds(`parse ${shape}`, (runs) => growth((n) => enc(make(n)), (bytes) => parseMarkdown(bytes, { file: 'big.md' }), { small: SMALL, runs }));
  });
}

for (const shape of ['prose', 'blocks', 'tables', 'references']) {
  test(`rendering and sanitising a parsed page (${shape}) grows with the page, not faster`, () => {
    const make = (n: number) => parseMarkdown(enc(MARKDOWN[shape]!(n)), { file: 'big.md' });
    holds(`render ${shape}`, (runs) => growth(make, (doc) => renderDocumentSafeHtml(doc), { small: SMALL, runs }));
  });
}

test('one small edit near the end of a long page is reparsed in no more than linear time', () => {
  const make = (n: number) => {
    const before = enc(MARKDOWN.prose!(n));
    const after = enc(`${MARKDOWN.prose!(n)}One more paragraph.\n`);
    return { before, after, previous: parseMarkdown(before, { file: 'big.md' }) };
  };
  holds('reparse after an append', (runs) => growth(make, ({ before, after, previous }) => reparseMarkdown(previous, before, after, { file: 'big.md' }), { small: SMALL, runs }));
});

test('a buffer is made and spliced in linear time', () => {
  const make = (n: number) => createBuffer('/big.md', enc(MARKDOWN.prose!(n)));
  holds('splice', (runs) => growth(make, (buffer) => splice(buffer, { file: '/big.md', start: 10, end: 12 }, 'xy'), { small: SMALL * 4, runs }));
});

test('the line index of a big text file grows with the file', () => {
  const make = (n: number) => enc(fill(n, (i) => `${words(i, 13)}\n`));
  holds('indexLines', (runs) => growth(make, (bytes) => indexLines(bytes, false), { small: SMALL * 4, runs }));
});

for (const [shape, make] of Object.entries({
  lines: (n: number) => enc(fill(n, (i) => `${words(i, 13)}
`)),
  'CRLF lines': (n: number) => enc(fill(n, (i) => `${words(i, 13)}
`)),
  'one long line': (n: number) => enc(fill(n, (i) => `${words(i, 13)} `)),
})) {
  test(`the scale record's byte facts (${shape}) grow with the file`, () => {
    holds(`byteScale ${shape}`, (runs) => growth(make, (bytes) => byteScale(bytes), { small: SMALL * 4, runs }));
  });
}

for (const shape of ['prose']) {
  test(`the scale record's parse facts (${shape}) grow with the page`, () => {
    const make = (n: number) => parseMarkdown(enc(MARKDOWN[shape]!(n)), { file: 'big.md' });
    holds(`parseScale ${shape}`, (runs) => growth(make, (doc) => parseScale(doc), { small: 1024 * 1024, runs }));
  });
}

const READINGS: Record<string, (bytes: number) => string> = {
  'rows.csv': (b) => `id,word,value,phrase\n${fill(b, (i) => `${i},${WORDS[i % 19]},${i * 1.5},"${words(i, 5)}"\n`)}`,
  'records.jsonl': (b) => fill(b, (i) => `${JSON.stringify({ t: i, level: ['info', 'warn'][i % 2], msg: words(i, 9) })}\n`),
  'build.log': (b) => fill(b, (i) => `2026-11-27T10:00:${String(i % 60).padStart(2, '0')}Z INFO worker-${i % 8} ${words(i, 10)}\n`),
  'data.json': (b) => `[${fill(b, (i) => `${i ? ',' : ''}{"id":${i},"name":"${words(i, 3)}","v":[${i},${i * 2}]}`)}]`,
  'notes.txt': (b) => fill(b, (i) => `${words(i, 13)}\n`),
};

for (const [path, make] of Object.entries(READINGS)) {
  test(`the reading of ${path.split('.').pop()} grows with the file, not faster`, () => {
    holds(`readingOf ${path}`, (runs) => growth((n) => enc(make(n)), (bytes) => readingOf(path, bytes), { small: SMALL, runs }));
  });
}

test('a line diff of two long texts with a few changes grows with the texts', () => {
  const make = (n: number) => {
    const a = fill(n, (i) => `${words(i, 10)} ${i}\n`);
    const b = a.replace(' 5\n', ' five\n').replace(/ 9\n$/, ' nine\n');
    return { a, b };
  };
  holds('diffLines', (runs) => growth(make, ({ a, b }) => diffLines(a, b), { small: SMALL, runs }));
});

test('sanitising a big HTML page grows with the page', () => {
  const make = (n: number) => fill(n, (i) => `<h2>Part ${i}</h2>\n<p>${words(i, 30)} <a href="#p${i}">link</a></p>\n<ul><li>${words(i, 4)}</li></ul>\n`);
  holds('sanitizeHtml', (runs) => growth(make, (html) => sanitizeHtml(html), { small: SMALL, runs }));
});
