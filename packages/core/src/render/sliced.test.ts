// the render in slices is the whole render, byte for byte and removal for removal, for the corpus and
// for structured random documents cut into the smallest slices; it numbers footnotes across slices and draws their
// list once, at the end; and it declines the documents whose render reaches across blocks (raw HTML left open) so the
// caller renders those whole.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { makeChain } from '../parse/testing/footnote-chains.ts';
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

test('raw HTML that leaves an element open past its block is declined', async () => {
  assert.equal(await same('<b>open in this paragraph\n\nand never closed\n', 'open tag'), 'declined');
});

test('footnotes are numbered by the document across slices, and their list is drawn once, at the end', async () => {
  const fill = (n: number): string => Array.from({ length: n }, (_, i) => `filler ${i}`).join('\n\n');
  const cases: Record<string, string> = {
    'one note': 'a[^1]\n\n[^1]: note\n',
    'definitions at the top': `[^b]: note b\n\n[^a]: note a <span class="x">s</span>\n\n${fill(20)}\n\nsee[^a] and[^b] and[^a]\n\n${fill(20)}\n`,
    'definitions spread, a duplicate, a quoted one, one undefined': `x[^n]\n\n${fill(9)}\n\n[^n]: first\n\n${fill(9)}\n\n> [^q]: quoted\n\ny[^q] z[^none]\n\n[^N]: duplicate\n\n${fill(9)}\n\n[^m]: has # in it[^n]\n\n    second paragraph\n`,
    'a heading in a note': `# Same\n\n${fill(10)}\n\n[^h]: note\n\n    # Same\n\nref[^h]\n\n# Same\n`,
  };
  for (const [name, text] of Object.entries(cases)) assert.equal(await same(text, name), 'sliced', name);
});

test('a processing instruction or CDATA holding tags is rendered the same sliced and whole, or declined', async () => {
  for (const [name, opener] of [['processing instruction', '<?x > </p><em> ?>'], ['CDATA', '<![CDATA[ > </p><em> ]]>']]) {
    const fill = Array.from({ length: 7 }, (_, n) => `filler ${n}`);
    const after = Array.from({ length: 8 }, (_, n) => `after ${n}`);
    await same(`${[...fill, `A ${opener} end`, '<b>island</b>', ...after].join('\n\n')}\n`, name!);
  }
});

test('random documents with footnotes, cut at several sizes, render as a whole render does', async () => {
  const counts = { sliced: 0, declined: 0 };
  for (let seed = 1; seed <= Math.min(SEEDS, 120); seed++) {
    for (const text of makeChain(seed, 4).texts) {
      for (const budget of [SMALLEST, 0.05, 3]) {
        const document = parseMarkdown(text, { file: '/s.md' });
        const sliced = await renderDocumentSafeHtmlInSlices(document, { yieldNow, budgetMs: budget });
        if (sliced === null) {
          counts.declined++;
          continue;
        }
        counts.sliced++;
        const whole = renderDocumentSafeHtml(document);
        assert.equal(sliced.html, whole.html, `footnote chain ${seed}: html`);
        assert.deepEqual(sliced.removed, whole.removed, `footnote chain ${seed}: removed`);
      }
    }
  }
  assert.ok(counts.sliced > counts.declined, `sliced ${counts.sliced}, declined ${counts.declined}`);
});
