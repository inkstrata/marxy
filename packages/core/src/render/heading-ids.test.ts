// Heading ids match github-slugger with duplicate suffixes; authored `{#id}` is kept (MARXY-240).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { authoredHeadingId, HeadingIdSlugger, headingIdsForDocument } from './heading-ids.ts';
import { renderSafeHtml } from './pipeline.ts';

test('github-slugger duplicate suffixes are -1 then -2', () => {
  const slugger = new HeadingIdSlugger();
  assert.equal(slugger.slug('Install'), 'install');
  assert.equal(slugger.slug('Install'), 'install-1');
  assert.equal(slugger.slug('Install'), 'install-2');
});

test('authored {#id} on a heading is kept', () => {
  const doc = parseMarkdown('## Setup {#my-setup}\n', { file: 't.md' });
  const ids = headingIdsForDocument(doc);
  const heading = doc.children.find((b) => b.type === 'heading');
  assert.ok(heading);
  const key = `${heading.src.start}-${heading.src.end}`;
  assert.equal(ids.get(key), 'my-setup');
});

test('renderSafeHtml emits heading ids and marks external links', () => {
  const { html } = renderSafeHtml('# Title\n\nSee [x](https://example.invalid/).\n', { file: 't.md' });
  assert.match(html, /<h1 id="title"/);
  assert.match(html, /class="marxy-external"/);
});

test('authoredHeadingId parses the suffix from inline text', () => {
  const doc = parseMarkdown('## Hello {#custom}\n', { file: 't.md' });
  const heading = doc.children.find((b) => b.type === 'heading');
  assert.ok(heading && heading.type === 'heading');
  assert.equal(authoredHeadingId(heading.children), 'custom');
});
