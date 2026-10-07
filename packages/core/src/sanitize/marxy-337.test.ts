// MARXY-337: defects found in the sanitiser's URL, writer, comment and reserved-attribute rules.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderSafeHtml } from '../render/pipeline.ts';
import { DEFAULT_POLICY } from './policy.ts';
import { sanitizeHtml } from './sanitize-html.ts';
import { sanitizeUrl } from './urls.ts';

test('a scheme without slashes is absolute: https:evil.example is a remote image, not a local one', () => {
  for (const value of ['https:evil.example/x.png', 'HTTPS:/evil.example/x.png', 'https:\\\\evil.example/x.png']) {
    const decision = sanitizeUrl(value, 'subresource', DEFAULT_POLICY);
    assert.equal(decision.allowed, false, value);
    assert.equal(decision.absolute, true, value);
    assert.equal(decision.scheme, 'https', value);
  }
  const link = sanitizeUrl('mailto:someone@example.invalid', 'link', DEFAULT_POLICY);
  assert.equal(link.absolute, true);
  assert.equal(sanitizeUrl('javascript:alert(1)', 'link', DEFAULT_POLICY).allowed, false);
});

test('https:host/x.png in markdown and in raw HTML img is blocked and reported', () => {
  for (const md of ['![a](https:evil.example/x.png)', '![a](HTTPS:/evil.example/x.png)', '<img src="https:evil.example/x.png" alt="a">', '<p><img src="HTTPS:/evil.example/x.png"></p>']) {
    const result = renderSafeHtml(md);
    assert.doesNotMatch(result.html, /\ssrc=/, md);
    assert.equal(result.blockedImages.length, 1, md);
    assert.equal(result.blockedImages[0]!.host, 'evil.example', md);
  }
});

test('a close tag with nothing open is O(1): 40000 stray closes do not go quadratic', () => {
  const n = 40000;
  const start = performance.now();
  const out = sanitizeHtml('<b>'.repeat(n) + '</i>'.repeat(n)).html;
  const ms = performance.now() - start;
  assert.equal(out, '<b>'.repeat(n) + '</b>'.repeat(n));
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
});

test('close tags still close the nearest matching open element', () => {
  assert.equal(sanitizeHtml('<b><i>x</b>y</i>').html, '<b><i>x</i></b>y');
});

test('an author-written data-marxy-remote is refused on an inline img', () => {
  const result = renderSafeHtml('a <img src="local.png" alt="x" data-marxy-remote="https://evil.example/t.png"> b');
  assert.doesNotMatch(result.html, /data-marxy-remote/);
  const island = renderSafeHtml('<img src="a.png" data-marxy-remote="https://evil.example/t.png">\n');
  assert.doesNotMatch(island.html, /data-marxy-remote/);
  // a marker the block-island pass wrote itself still reaches the reader
  assert.match(renderSafeHtml('<img src="https://x.invalid/p.png" alt="a">\n').html, /data-marxy-remote="https:\/\/x\.invalid\/p\.png"/);
  // the renderer's own deferral is unaffected
  assert.match(renderSafeHtml('![a](https://evil.example/x.png)').html, /data-marxy-remote="https:\/\/evil\.example\/x\.png"/);
});

test('ol start of 10000 and above survives', () => {
  assert.match(sanitizeHtml('<ol start="123456"><li>x</li></ol>').html, /start="123456"/);
  assert.match(renderSafeHtml('10000. a\n10001. b').html, /start="10000"/);
});

test('<!--> and <!---> are empty comments, not unterminated ones', () => {
  assert.equal(sanitizeHtml('a<!-->b').html, 'ab');
  assert.equal(sanitizeHtml('a<!--->b').html, 'ab');
  assert.equal(sanitizeHtml('a<!---->b').html, 'ab');
  assert.equal(sanitizeHtml('a<!-- x -->b').html, 'ab');
  // inside a removed element too
  assert.equal(sanitizeHtml('<script>x</script>a<video><!-->y</video>b').html, 'ab');
});

test('an end tag name stops at a solidus: </a/> closes the a', () => {
  assert.equal(sanitizeHtml('<a href="x.md">t</a/>u').html, '<a href="x.md">t</a>u');
});
