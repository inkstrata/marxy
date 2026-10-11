// D-15: the parse in slices equals the whole file's parse, node for node and range for range, for the
// corpus, a long transcript, structured random documents cut into very small slices, and the cases the
// proof must refuse; and it splits where it can, and parses whole where it cannot.
//
// The structured property runs a fixed number of seeds on every pull request:
// `CHUNKED_SEEDS=1500 node --test --experimental-strip-types packages/core/src/parse/chunked.test.ts` takes more.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { lineStartAt } from '../sourcemap/line-starts.ts';
import { lastChunkedParse, parseMarkdownChunked } from './chunked.ts';
import { parseMarkdown } from './parse.ts';
import { generated, random } from './testing/structured.ts';

const SEEDS = Number(process.env.CHUNKED_SEEDS ?? 150);
const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const files = readdirSync(corpus).filter((name) => name.endsWith('.md')).sort();
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, corpus)));
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The slices' parse and the whole parse as the same JSON, and the same line start across the file. */
async function assertSame(bytes: Uint8Array, sliceBytes: number | undefined, where: string): Promise<'slices' | 'whole'> {
  const file = '/c.md';
  const sliced = await parseMarkdownChunked(bytes, { file, yieldNow, sliceBytes });
  const kind = lastChunkedParse().kind;
  const whole = parseMarkdown(bytes, { file });
  const a = JSON.stringify(sliced);
  const e = JSON.stringify(whole);
  if (a !== e) {
    let i = 0;
    while (i < a.length && a[i] === e[i]) i++;
    assert.fail(`${where}: the slices' parse (${kind}) differs from the whole parse at JSON index ${i}:\n  slices ${a.slice(Math.max(0, i - 120), i + 120)}\n  whole  ${e.slice(Math.max(0, i - 120), i + 120)}`);
  }
  for (let at = 0; at <= bytes.length; at += Math.max(1, Math.floor(bytes.length / 200))) {
    assert.equal(lineStartAt(sliced, at), lineStartAt(whole, at), `${where}: line start at byte ${at}`);
  }
  return kind;
}

test('the slices\' parse equals the whole parse for every corpus file, at the default size and at 1 KB', async () => {
  let slices = 0;
  for (const name of files) {
    const bytes = read(name);
    for (const size of [undefined, 1024]) if ((await assertSame(bytes, size, `${name} @${size ?? 'default'}`)) === 'slices') slices++;
  }
  // Not a vacuous pass: the corpus files without a definition really were cut.
  assert.ok(slices > files.length / 2, `${slices} parses in slices`);
});

test('a long transcript is cut into many slices and equals the whole parse', async () => {
  const turn = new TextDecoder().decode(read('18-agent-transcript.md'));
  let text = '';
  for (let n = 1; text.length < 300_000; n++) text += `## Turn ${n}\n\n${turn}\n`;
  if (/\]:/.test(text)) return; // the corpus transcript holds no definition today; if it gains one this case has nothing to say
  assert.equal(await assertSame(encode(text), undefined, 'transcript'), 'slices');
  assert.ok(lastChunkedParse().slices > 10, `slices ${lastChunkedParse().slices}`);
});

test('structured random documents cut into very small slices equal the whole parse', async () => {
  const counts = { slices: 0, whole: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const next = random(seed);
    const bytes = encode(generated(next));
    counts[await assertSame(bytes, 1 + Math.floor(next() * 200), `structured seed ${seed}`)]++;
  }
  assert.ok(counts.slices > counts.whole, `slices ${counts.slices}, whole ${counts.whole}`);
});

test('a definition, or frontmatter that never closes, parses the whole file', async () => {
  const pad = Array.from({ length: 80 }, (_, n) => `paragraph ${n}\n`).join('\n');
  assert.equal(await assertSame(encode(`[x]: http://x.example\n\n${pad}\n\nsee [x]\n`), 64, 'definition'), 'whole');
  assert.equal(await assertSame(encode(`---\na: 1\n\nb: 2\n\n${pad}`), 64, 'frontmatter never closed'), 'whole');
  assert.equal(await assertSame(encode(`---\na: 1\n\nb: 2\n---\n\n${pad}`), 64, 'frontmatter closed after a blank line'), 'slices');
});

test('a fence with blank lines inside is never cut, and a list is not split from its next item', async () => {
  const pad = Array.from({ length: 60 }, (_, n) => `paragraph ${n}\n`).join('\n');
  const fence = `\`\`\`\n${Array.from({ length: 40 }, (_, n) => `line ${n}\n`).join('\n')}\`\`\`\n`;
  await assertSame(encode(`${pad}\n${fence}\n${pad}`), 32, 'fence');
  const loose = Array.from({ length: 60 }, (_, n) => `- item ${n}\n`).join('\n');
  await assertSame(encode(`${pad}\n${loose}\n${pad}`), 32, 'loose list');
  await assertSame(encode(`    indented\n\n- x\n\n${pad}`), 16, 'indented code before a list marker');
});
