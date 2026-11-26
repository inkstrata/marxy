// Heading ids match github-slugger with duplicate suffixes; authored `{#id}` is kept.

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

test('a heading never takes an id the page reserves: a footnote\'s, or a name that shadows a global', () => {
  const ids = (md: string): string[] => [...renderSafeHtml(md, { file: 't.md' }).html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
  const footnoted = ids('# Marxy fn 1\n\nx[^a]\n\n[^a]: note\n');
  assert.equal(footnoted.filter((id) => id === 'marxy-fn-1').length, 1, footnoted.join());
  assert.ok(footnoted.includes('user-content-marxy-fn-1'), footnoted.join());
  assert.deepEqual(ids('# Location\n\n# Cookie\n\n# Forms\n'), ['user-content-location', 'user-content-cookie', 'user-content-forms']);
  assert.deepEqual(ids('# T {#cookie}\n\n# U {#marxy-fnref-1}\n\n# V {#Marxy-x}\n\n# W {#fine}\n'), ['t', 'u', 'v', 'fine']);
  assert.deepEqual(ids('# Location\n\n# Location\n'), ['user-content-location', 'user-content-location-1']);
});
