// The sanitiser's own behaviour: the allow-list decides, decoding happens before the decision, and
// the output means the same thing to the parser that reads it as it did to the code that wrote it.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decodeReferences, escapeAttribute, escapeText } from './escape.ts';
import { DEFAULT_POLICY } from './policy.ts';
import { sanitizeHtml } from './sanitize-html.ts';
import { sanitizeUrl } from './urls.ts';

const clean = (html: string): string => sanitizeHtml(html).html;

test('an allow-listed element keeps its allow-listed attributes and loses the rest', () => {
  assert.equal(
    clean('<a href="https://example.com/a" title="t" target="_blank" onclick="alert(1)">x</a>'),
    '<a href="https://example.com/a" title="t">x</a>',
  );
});

test('an element in neither list loses its subtree, not just its tags', () => {
  assert.equal(clean('<script>alert(1)</script>after'), 'after');
  assert.equal(clean('<custom-thing>hidden</custom-thing>after'), 'after');
  assert.equal(clean('<div><script>alert(1)</script>kept</div>'), 'kept');
});

test('a transparent wrapper loses its markup and keeps the prose a reader came for', () => {
  assert.equal(clean('<div align="center"><h1>Project</h1></div>'), '<h1>Project</h1>');
  assert.equal(clean('<details><summary>More</summary><p>body</p></details>'), 'More<p>body</p>');
});

test('nested elements of the same name are counted, so the right end tag ends the removal', () => {
  assert.equal(clean('<object><object>inner</object></object>kept'), 'kept');
});

test('a void element is removed alone: scanning for its end tag would eat the document', () => {
  assert.equal(clean('<meta http-equiv="refresh" content="0;url=https://x.invalid/">kept'), 'kept');
  assert.equal(clean('<link rel="stylesheet" href="https://x.invalid/t.css"><p>kept</p>'), '<p>kept</p>');
});

test('an unclosed removed element removes everything after it, and says so', () => {
  const result = sanitizeHtml('<p>before</p><script>alert(1)');
  assert.equal(result.html, '<p>before</p>');
  assert.ok(result.removed.some((removal) => removal.reason.includes('never closed')));
});

test('event handler attributes go however they are spelled or cased', () => {
  assert.equal(clean('<p OnMouseOver="a" onerror=b ONLOAD=\'c\' onFocus="d">x</p>'), '<p>x</p>');
});

test('a style attribute goes, with the url() it was carrying', () => {
  assert.equal(clean('<p style="background:url(https://x.invalid/b.gif)">x</p>'), '<p>x</p>');
});

test('a javascript: target goes, through whatever spelling reaches the parser', () => {
  for (const href of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    ' javascript:alert(1)',
    '&#106;avascript:alert(1)',
    'javascript&colon;alert(1)',
    '&amp;#106;avascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
  ]) {
    assert.equal(clean(`<a href="${href}">x</a>`), '<a>x</a>', `href ${JSON.stringify(href)} survived`);
  }
});

test('a link may be remote, because a reader has to act on it, and a subresource may not', () => {
  assert.equal(clean('<a href="https://example.com/p">x</a>'), '<a href="https://example.com/p">x</a>');
  assert.equal(clean('<a href="mailto:a@example.com">x</a>'), '<a href="mailto:a@example.com">x</a>');
  assert.equal(clean('<img src="https://example.com/p.png" alt="a">'), '<img alt="a" />');
  assert.equal(clean('<img src="//example.com/p.png" alt="a">'), '<img alt="a" />');
  assert.equal(clean('<img src="diagram.png" alt="a">'), '<img src="diagram.png" alt="a" />');
  assert.equal(clean('<img src="./deep/diagram.png" alt="a">'), '<img src="./deep/diagram.png" alt="a" />');
});

test('a scheme-relative link is refused too: it is remote without naming a scheme', () => {
  assert.equal(clean('<a href="//example.com/p">x</a>'), '<a>x</a>');
});

test('a data: image is refused: it cannot fetch, but it can carry a document', () => {
  assert.equal(clean('<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="a">'), '<img alt="a" />');
});

test('a fragment, a query and a relative path are local and stay', () => {
  assert.equal(clean('<a href="#section">x</a>'), '<a href="#section">x</a>');
  assert.equal(clean('<a href="./page.md?a=1&amp;b=2">x</a>'), '<a href="./page.md?a=1&amp;b=2">x</a>');
  assert.equal(clean('<a href="/absolute/path">x</a>'), '<a href="/absolute/path">x</a>');
});

test('a percent-encoded scheme is not a scheme, and is left as the relative path it is', () => {
  assert.equal(clean('<a href="%6aavascript:alert(1)">x</a>'), '<a href="%6aavascript:alert(1)">x</a>');
});

test('comments, declarations and processing instructions are not content', () => {
  assert.equal(clean('<!-- secret --><p>x</p>'), '<p>x</p>');
  assert.equal(clean('<!doctype html><p>x</p>'), '<p>x</p>');
  // A CDATA section is a bogus comment to the HTML parser, which ends it at the first `>`; what
  // follows is inert text in both readings, and no element survives either way.
  assert.equal(clean('<![CDATA[<script>alert(1)</script>]]><p>x</p>'), 'alert(1)]]><p>x</p>');
  assert.equal(clean('<?php echo 1; ?><p>x</p>'), '<p>x</p>');
});

test('a namespaced name reaches the allow-list and is refused by it', () => {
  assert.equal(clean('<svg:script>alert(1)</svg:script>kept'), 'kept');
  assert.equal(clean('<a:b onclick="alert(1)">x</a:b>kept'), 'kept');
});

test('a `<` that starts nothing is text, as it is to the parser', () => {
  assert.equal(clean('a < b and 3<4'), 'a &lt; b and 3&lt;4');
});

test('a close tag with nothing open is dropped, and an open element is closed at the end', () => {
  assert.equal(clean('</p>text'), 'text');
  assert.equal(clean('<em>text'), '<em>text</em>');
});

test('the output is idempotent: one pass is the boundary, so a second changes nothing', () => {
  const once = clean('<div style="x"><p onclick="a">t</p><script>s</script><img src="https://x.invalid/p.png"></div>');
  assert.equal(clean(once), once);
});

test('class survives only as a token the renderer or the highlighter could have written', () => {
  assert.equal(clean('<code class="language-rust">x</code>'), '<code class="language-rust">x</code>');
  assert.equal(clean('<code class="steal-my-theme">x</code>'), '<code>x</code>');
  assert.equal(clean('<code class="language-rust steal">x</code>'), '<code class="language-rust">x</code>');
});

test('an id must look like an id', () => {
  assert.equal(clean('<h2 id="install">x</h2>'), '<h2 id="install">x</h2>');
  assert.equal(clean('<h2 id="a b&quot;c">x</h2>'), '<h2>x</h2>');
});

test('a checkbox is the only input, and only as a checkbox', () => {
  assert.equal(clean('<input type="checkbox" checked disabled>'), '<input type="checkbox" checked disabled />');
  assert.equal(clean('<input type="password" name="pw">'), '');
});

test('duplicate attributes resolve to the first, as the parser resolves them', () => {
  assert.equal(clean('<a href="./a" href="javascript:alert(1)">x</a>'), '<a href="./a">x</a>');
});

test('lang and dir survive on anything, because the corpus has documents that need them', () => {
  assert.equal(clean('<p dir="rtl" lang="ar">x</p>'), '<p dir="rtl" lang="ar">x</p>');
  assert.equal(clean('<p dir="sideways">x</p>'), '<p>x</p>');
});

test('the removal report names what went and why, for the notice that will read it', () => {
  const { removed } = sanitizeHtml('<iframe src="https://x.invalid/i"></iframe><p style="a">x</p>');
  assert.ok(removed.some((removal) => removal.what === 'element' && removal.name === 'iframe'));
  assert.ok(removed.some((removal) => removal.what === 'attribute' && removal.name === 'style' && removal.on === 'p'));
});

test('references are decoded to a fixed point, so a second parse cannot reveal a scheme', () => {
  assert.equal(decodeReferences('&amp;#106;avascript&colon;'), 'javascript:');
  assert.equal(decodeReferences('&#x6a;avascript&#58;'), 'javascript:');
  assert.equal(decodeReferences('plain &unknown; text'), 'plain &unknown; text');
});

test('escaping is exact: one decoding pass returns what was escaped', () => {
  assert.equal(escapeText('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
  assert.equal(escapeAttribute('a"b&c'), 'a&quot;b&amp;c');
});

test('the URL decision refuses what it cannot read rather than guessing', () => {
  assert.equal(sanitizeUrl('javascript&#x3a;alert(1)', 'link', DEFAULT_POLICY).allowed, false);
  assert.equal(sanitizeUrl('java&unknown;script:alert(1)', 'link', DEFAULT_POLICY).allowed, false);
  assert.equal(sanitizeUrl('', 'link', DEFAULT_POLICY).allowed, false);
  assert.equal(sanitizeUrl('https://example.com', 'subresource', DEFAULT_POLICY).allowed, false);
  assert.equal(sanitizeUrl('image.png', 'subresource', DEFAULT_POLICY).allowed, true);
});

test('the default policy names no bad thing: every rule in it is a permission', () => {
  const surface = JSON.stringify(DEFAULT_POLICY);
  for (const name of ['script', 'iframe', 'object', 'form', 'meta', 'style', 'srcdoc', 'onerror', 'javascript']) {
    assert.ok(!surface.includes(name), `the allow-list mentions ${name}; a deny-list has crept in`);
  }
  assert.deepEqual(DEFAULT_POLICY.urlSchemes.subresource, [], 'nothing may fetch by default');
});
