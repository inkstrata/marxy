// Paragraph widont when inline code, math, images, or footnote refs end the paragraph (MARXY-296).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderSafeHtml } from './pipeline.ts';

const withoutProvenance = (html: string): string => html.replace(/ data-marxy-[se]="[0-9]+"/g, '');
const html = (markdown: string): string => withoutProvenance(renderSafeHtml(markdown, { file: 'test.md' }).html);

test('an eight-word paragraph ending in inline code binds the last word to the code span', () => {
  const out = html('one two three four five six seven `eight`\n');
  assert.match(out, /seven\u00a0<code>eight<\/code>/);
});

test('widont applies before inline math at the end of a long paragraph', () => {
  const out = html('one two three four five six seven $eight$\n');
  assert.match(out, /seven\u00a0<code class="marxy-math">eight<\/code>/);
});

test('widont applies before a trailing image in a long paragraph', () => {
  const out = html('one two three four five six seven eight ![pic](pic.png)\n');
  assert.match(out, /eight\u00a0<img[^>]*alt="pic"/);
});

test('widont applies on the last prose run before a footnote reference', () => {
  const out = html('one two three four five six seven eight[^n]\n\n[^n]: note.\n');
  assert.match(out, /seven\u00a0eight<sup class="marxy-footnote-ref"/);
});

test('emphasis before trailing inline code still receives widont on the last prose run', () => {
  const out = html('one two three four five six *seven* `eight`\n');
  assert.match(out, /seven<\/em>\u00a0<code>eight<\/code>/);
});
