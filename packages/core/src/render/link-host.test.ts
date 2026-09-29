// Host mismatch labels on links (handbook ch.7, MARXY-236).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { linkDestinationLabel, linkHostMismatchLabel, linkTextLooksLikeHost } from './link-host.ts';
import { renderSafeHtml } from './pipeline.ts';

const stripProv = (html: string): string => html.replace(/ data-marxy-[se]="[0-9]+"/g, '');

test('link text must look like a URL or host', () => {
  assert.equal(linkTextLooksLikeHost('click here'), false);
  assert.equal(linkTextLooksLikeHost('https://a.com'), true);
  assert.equal(linkTextLooksLikeHost('docs.example.com'), true);
});

test('mismatch label only when hosts differ', () => {
  assert.deepEqual(linkHostMismatchLabel('https://a.com', 'https://a.com/path'), null);
  const label = linkHostMismatchLabel('https://a.com', 'https://b.com/x');
  assert.ok(label);
  assert.equal(label!.text, 'b.com');
});

test('homograph href shows punycode and Unicode in the label', () => {
  const href = 'https://xn--pple-43d.com/';
  const label = linkHostMismatchLabel('https://apple.com', href);
  assert.ok(label);
  assert.match(label!.text, /xn--pple-43d\.com/);
  assert.match(label!.text, /apple\.com|аpple/);
  const html = stripProv(renderSafeHtml('[https://apple.com](https://xn--pple-43d.com/)\n', { file: 't.md' }).html);
  assert.match(html, /marxy-link-mismatch/);
  assert.match(html, /xn--pple-43d\.com/);
});

test('[https://a.com](https://b.com) renders host label b.com', () => {
  const html = stripProv(renderSafeHtml('[https://a.com](https://b.com)\n', { file: 't.md' }).html);
  assert.match(html, /marxy-link-mismatch/);
  assert.match(html, /title="b\.com"/);
  assert.ok(!html.includes('marxy-link-dest'));
});

test('click here to evil does not get a mismatch label', () => {
  const html = stripProv(renderSafeHtml('[click here](https://evil.example)\n', { file: 't.md' }).html);
  assert.ok(!html.includes('marxy-link-mismatch'));
});

test('destination label parses hosts', () => {
  assert.equal(linkDestinationLabel('https://b.com/x'), 'b.com');
});
