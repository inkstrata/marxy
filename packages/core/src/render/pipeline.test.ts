// MARXY-96: island removals carry byte provenance; renderer-pass removals do not.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAX_NESTING_DEPTH } from '../parse/from-mdast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { reparseMarkdown } from '../parse/reparse.ts';
import { renderDocumentSafeHtml, renderDocumentSafeHtmlInSlices, renderSafeHtml } from './pipeline.ts';

const readmePath = new URL('../../../../fixtures/corpus/02-readme-real-world.md', import.meta.url);

test('an island removal in 02-readme-real-world.md carries that island src', () => {
  const bytes = readFileSync(readmePath);
  const document = parseMarkdown(bytes, { file: '02-readme-real-world.md' });
  const { removed } = renderDocumentSafeHtml(document);
  const island = removed.find((removal) => removal.src !== undefined);
  assert.ok(island !== undefined, 'expected at least one island removal from the README header block');
  const block = document.children.find((child) => child.type === 'htmlBlock');
  assert.ok(block?.type === 'htmlBlock');
  assert.equal(island.src?.start, block.src.start);
  assert.equal(island.src?.end, block.src.end);
});

test('a renderer-pass image removal has no island src', () => {
  const document = parseMarkdown('![x](https://example.invalid/x.png)\n', { file: 't.md' });
  const { removed } = renderDocumentSafeHtml(document);
  const image = removed.find((removal) => removal.what === 'attribute' && removal.name === 'src' && removal.on === 'img');
  assert.ok(image !== undefined);
  assert.equal(image.src, undefined);
  assert.equal(image.url, 'https://example.invalid/x.png');
});

// MARXY-337: a document nested past the stack degrades to escaped source instead of throwing.
test('a deeply nested document renders as an escaped <pre> rather than throwing a RangeError', () => {
  for (const source of ['>'.repeat(20000) + ' x <b>y</b> & z', '> '.repeat(20000) + 'x']) {
    const result = renderSafeHtml(source);
    assert.match(result.html, /^<pre data-marxy-s="0" data-marxy-e="\d+">/);
    assert.match(result.html, /&lt;b&gt;y&lt;\/b&gt; &amp; z|x<\/pre>$/);
    assert.doesNotMatch(result.html, /<b>/);
    assert.equal(result.removed.some((r) => r.what === 'structure'), true);
    assert.equal(result.html.includes(`data-marxy-e="${new TextEncoder().encode(source).length}"`), true);
  }
});

// F-54: past MAX_NESTING_DEPTH levels of quote or list a document is shown as its source and says so.
const inlineQuotes = (n: number): string => `${'> '.repeat(n)}word\n`;
const inlineLists = (n: number): string => `${'- '.repeat(n)}word\n`;
const indentedLists = (n: number): string => `${Array.from({ length: n }, (_, i) => `${'  '.repeat(i)}- level ${i + 1}`).join('\n')}\n`;
const sourceFallback = (html: string): boolean => /^<pre data-marxy-s="0" data-marxy-e="\d+">/.test(html);

for (const [name, make] of [['quotes', inlineQuotes], ['lists', inlineLists], ['indented lists', indentedLists]] as const) {
  test(`${MAX_NESTING_DEPTH + 1} nested ${name} render as the source, with a notice`, () => {
    const source = make(MAX_NESTING_DEPTH + 1);
    const document = parseMarkdown(source, { file: 'deep.md' });
    const result = renderDocumentSafeHtml(document);
    assert.equal(sourceFallback(result.html), true, result.html.slice(0, 80));
    assert.equal(result.html.includes(`data-marxy-e="${new TextEncoder().encode(source).length}"`), true);
    assert.deepEqual(result.removed.map((r) => [r.what, r.name]), [['structure', 'document']]);
    assert.match(result.removed[0]!.reason ?? '', /nested more than 64 levels deep/);
    assert.equal(renderSafeHtml(source).html, result.html);
    assert.equal(document.src.end, new TextEncoder().encode(source).length);
    assert.equal(document.children.length, 1, 'every byte is in the tree, as one block');
  });

  test(`${MAX_NESTING_DEPTH} nested ${name} still render as markup`, () => {
    const result = renderSafeHtml(make(MAX_NESTING_DEPTH));
    assert.equal(sourceFallback(result.html), false);
    assert.equal(result.removed.length, 0);
    assert.match(result.html, name === 'quotes' ? /<blockquote/ : /<ul/);
  });
}

test('a 12,000-level list neither throws nor overflows, and does not wait for micromark', () => {
  const source = inlineLists(12000);
  const started = performance.now();
  // The parse itself, as the app calls it, not only `renderSafeHtml`'s net under it.
  assert.equal(parseMarkdown(source, { file: 'list.md' }).children.length, 1);
  const result = renderSafeHtml(source);
  assert.equal(sourceFallback(result.html), true);
  assert.equal(result.removed[0]?.name, 'document');
  // micromark alone takes seconds for this file; the text scan answers in a few milliseconds.
  assert.ok(performance.now() - started < 1500, `took ${Math.round(performance.now() - started)} ms`);
});

test('a 508-quote tower, the hunt\'s, renders as the source', () => {
  assert.equal(sourceFallback(renderSafeHtml(inlineQuotes(508)).html), true);
});

test('quotes and lists count together, and a list item is not a level of its own', () => {
  const mixed = (n: number): string => `${'> - '.repeat(n / 2)}word\n`;
  assert.equal(sourceFallback(renderSafeHtml(mixed(MAX_NESTING_DEPTH)).html), false);
  assert.equal(sourceFallback(renderSafeHtml(mixed(MAX_NESTING_DEPTH + 2)).html), true);
});

test('a long run of rule markers is a thematic break, not a nesting', () => {
  for (const source of [`${'- '.repeat(300)}-\n`, `${'* '.repeat(300)}\n`]) {
    const result = renderSafeHtml(source);
    assert.equal(sourceFallback(result.html), false);
    assert.match(result.html, /<hr/);
  }
});

test('a document too deep to draw is not cut into slices, and its edit reparses to the same', () => {
  const source = inlineQuotes(MAX_NESTING_DEPTH + 1);
  const document = parseMarkdown(source);
  const sliced = renderDocumentSafeHtmlInSlices(document, { yieldNow: async () => {} });
  return sliced.then((result) => assert.equal(result, null));
});

test('an edit that makes a document too deep, or shallow again, is parsed right', () => {
  const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
  const shallow = encode(`intro\n\n${inlineQuotes(3)}\noutro\n`);
  const deep = encode(`intro\n\n${inlineQuotes(MAX_NESTING_DEPTH + 1)}\noutro\n`);
  const before = parseMarkdown(shallow);
  const after = reparseMarkdown(before, shallow, deep);
  assert.equal(sourceFallback(renderDocumentSafeHtml(after).html), true);
  const back = reparseMarkdown(after, deep, shallow);
  assert.equal(sourceFallback(renderDocumentSafeHtml(back).html), false);
  assert.deepEqual(back, parseMarkdown(shallow));
});
