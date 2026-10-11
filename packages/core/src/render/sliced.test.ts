// D-15: the render in slices is the whole render, byte for byte and removal for removal, for the corpus and
// for structured random documents cut into the smallest slices; and it declines the documents whose render
// reaches across blocks (a footnote, raw HTML left open) so the caller renders those whole.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { generated, random } from '../parse/testing/structured.ts';
import { renderDocumentSafeHtml, renderDocumentSafeHtmlInSlices } from './pipeline.ts';

const SEEDS = Number(process.env.SLICED_SEEDS ?? 200);
const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const files = readdirSync(corpus).filter((name) => name.endsWith('.md')).sort();
const yieldNow = (): Promise<void> => Promise.resolve();
// A budget no slice can meet, so each slice is the smallest (four blocks) and a document is cut many times.
const SMALLEST = 1e-9;

async function same(text: string | Uint8Array, where: string): Promise<'sliced' | 'declined'> {
  const document = parseMarkdown(text, { file: '/s.md' });
  const sliced = await renderDocumentSafeHtmlInSlices(document, { yieldNow, budgetMs: SMALLEST });
  if (sliced === null) return 'declined';
  const whole = renderDocumentSafeHtml(document);
  assert.equal(sliced.html, whole.html, `${where}: html`);
  assert.deepEqual(sliced.removed, whole.removed, `${where}: removed`);
  assert.deepEqual(sliced.blockedImages, whole.blockedImages, `${where}: blocked images`);
  assert.equal(sliced.pieces.join('\n'), whole.html, `${where}: pieces`);
  return 'sliced';
}

test('the render in slices equals the whole render for every corpus file', async () => {
  let sliced = 0;
  for (const name of files) if ((await same(new Uint8Array(readFileSync(new URL(name, corpus))), name)) === 'sliced') sliced++;
  assert.ok(sliced > files.length / 2, `${sliced} of ${files.length} corpus files were rendered in slices`);
});

test('the render in slices equals the whole render for structured random documents', async () => {
  const counts = { sliced: 0, declined: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) counts[await same(generated(random(seed)), `structured seed ${seed}`)]++;
  assert.ok(counts.sliced > counts.declined, `sliced ${counts.sliced}, declined ${counts.declined}`);
});

test('a repeated heading is numbered by what came before it, across slices', async () => {
  const text = Array.from({ length: 30 }, () => '# Same\n\ntext\n').join('\n');
  assert.equal(await same(text, 'repeated headings'), 'sliced');
  const document = parseMarkdown(text, { file: '/s.md' });
  const out = await renderDocumentSafeHtmlInSlices(document, { yieldNow, budgetMs: SMALLEST });
  assert.match(out!.html, /id="same-29"/);
});

test('a footnote, or raw HTML that leaves an element open past its block, is declined', async () => {
  assert.equal(await same('a[^1]\n\n[^1]: note\n', 'footnote'), 'declined');
  assert.equal(await same('<b>open in this paragraph\n\nand never closed\n', 'open tag'), 'declined');
});
