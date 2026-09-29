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

test('userinfo in the visible link text is a mismatch even when the host matches', () => {
  assert.ok(linkHostMismatchLabel('https://paypal.com@evil.com', 'https://evil.com'));
  const html = stripProv(renderSafeHtml('[https://paypal.com@evil.com](https://evil.com)\n', { file: 't.md' }).html);
  assert.match(html, /marxy-link-mismatch/);
  assert.match(html, /title="evil\.com"/);
});

test('differing explicit ports are a mismatch; default ports are not', () => {
  assert.ok(linkHostMismatchLabel('https://a.com:8443', 'https://a.com'));
  assert.equal(linkHostMismatchLabel('https://a.com:443', 'https://a.com'), null);
  assert.equal(linkHostMismatchLabel('https://a.com:8080', 'https://a.com:8080'), null);
});

test('non-web destinations get no label, class or empty title', () => {
  assert.equal(linkDestinationLabel('mailto:a@b'), null);
  assert.equal(linkDestinationLabel('#frag'), null);
  assert.equal(linkDestinationLabel('./x.md'), null);
  assert.equal(linkHostMismatchLabel('a.com', 'mailto:a@b'), null);
  const html = stripProv(renderSafeHtml('[a.com](mailto:a@b)\n', { file: 't.md' }).html);
  assert.ok(!html.includes('marxy-link-mismatch'));
  assert.ok(!html.includes('title='));
});

test('an address-shaped link text to its own host is not a mismatch (MARXY-337)', () => {
  assert.equal(linkHostMismatchLabel('user@example.com', 'https://example.com'), null);
  assert.notEqual(linkHostMismatchLabel('paypal.com@evil.com', 'https://evil.com'), null);
  assert.notEqual(linkHostMismatchLabel('https://paypal.com@evil.com', 'https://evil.com'), null);
});
