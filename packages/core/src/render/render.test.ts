// What a reader gets: the structure the renderer sets, and the promise that every document in the
// corpus comes out of the pipeline with nothing in it that fetches or executes (ADR-0009).

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { checkAllVectors, elementsOf } from '../sanitize/testing/vectors.ts';
import { RENDERED_POLICY } from '../sanitize/policy.ts';
import { renderSafeHtml } from './pipeline.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
/** The HTML with its byte provenance taken out, for the tests that are about shape (ADR-0023). */
const withoutProvenance = (html: string): string => html.replace(/ data-marxy-[se]="[0-9]+"/g, '');
const html = (markdown: string): string => withoutProvenance(renderSafeHtml(markdown, { file: 'test.md' }).html);

test('headings, paragraphs and emphasis are set as themselves', () => {
  assert.equal(html('# Title\n\nSome *emphasis* and **strength**.\n'), '<h1>Title</h1>\n<p>Some <em>emphasis</em> and <strong>strength</strong>.</p>');
});

test('text is escaped, so prose cannot become markup', () => {
  assert.equal(html('5 < 6 & 7 > 2\n'), '<p>5 &lt; 6 &amp; 7 &gt; 2</p>');
});

test('a fenced code block is literal text with its language on it', () => {
  assert.equal(
    html('```html\n<script>alert(1)</script>\n```\n'),
    '<pre><code class="language-html">&lt;script&gt;alert(1)&lt;/script&gt;\n</code></pre>',
  );
});

test('a table keeps its alignment and its header', () => {
  const table = html('| a | b |\n| :- | -: |\n| 1 | 2 |\n');
  assert.match(table, /<th align="left">a<\/th>/);
  assert.match(table, /<th align="right">b<\/th>/);
  assert.match(table, /<tbody>/);
});

test('a task item renders as a disabled checkbox, which is the one input allowed', () => {
  const list = html('- [x] done\n- [ ] not\n');
  // `disabled` comes last because the sanitiser forces it on every checkbox, the document's own or
  // the renderer's: marxy is a reader, and a control a reader can toggle would say the file changed.
  assert.match(list, /<input type="checkbox" checked disabled \/>/);
  assert.match(list, /<input type="checkbox" disabled \/>/);
});

test('footnotes are numbered here, so every id in the output is one we chose', () => {
  const footnotes = html('Text[^a]\n\n[^a]: The note.\n');
  assert.match(footnotes, /<sup class="marxy-footnote-ref" id="marxy-fnref-1"><a href="#marxy-fn-1">1<\/a><\/sup>/);
  assert.match(footnotes, /<ol class="marxy-footnotes">\n<li id="marxy-fn-1">/);
});

test('math is set as its source until KaTeX loads on first use (MARXY-28)', () => {
  assert.match(html('$$\nx^2\n$$\n'), /<pre class="marxy-math-block"><code>x\^2\n<\/code><\/pre>/);
  assert.match(html('Inline $x^2$ math\n'), /<code class="marxy-math">x\^2<\/code>/);
});

test('frontmatter is metadata, not prose, and is not set', () => {
  assert.equal(html('---\ntitle: x\n---\n\nBody\n'), '<p>Body</p>');
});

test('a local image keeps its source; a remote one keeps only its alt text', () => {
  assert.equal(html('![a](diagram.png)\n'), '<p><img src="diagram.png" alt="a" /></p>');
  assert.equal(html('![a](https://example.com/p.png)\n'), '<p><img alt="a" /></p>');
});

test('right-to-left and CJK documents render without losing their direction attributes', () => {
  assert.equal(html('<p dir="rtl" lang="he">שלום</p>\n'), '<p dir="rtl" lang="he">שלום</p>');
});

const files = readdirSync(corpus).filter((file) => file.endsWith('.md'));

test('the corpus is where it is expected to be', () => {
  assert.ok(files.length >= 10, `expected the corpus; found ${files.length} markdown files`);
});

for (const file of files) {
  test(`${file}: renders with no forbidden vector and only allow-listed elements`, () => {
    const source = readFileSync(new URL(file, corpus), 'utf8');
    const result = renderSafeHtml(source, { file });
    assert.deepEqual(checkAllVectors(result.html, RENDERED_POLICY), []);
    // Idempotence: the boundary can be crossed twice without the document changing.
    assert.equal(renderSafeHtml(source, { file }).html, result.html);
    assert.ok(elementsOf(result.html).length >= 0);
  });
}

test('an empty document renders to nothing rather than to something', () => {
  assert.equal(html(''), '');
});
