// The sanitiser's own behaviour: the allow-list decides, decoding happens before the decision, and
// the output means the same thing to the parser that reads it as it did to the code that wrote it.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decodeReferences, escapeAttribute, escapeText } from './escape.ts';
import { DEFAULT_POLICY, FOREIGN_ROOTS, RAW_TEXT_ELEMENTS, withProvenance } from './policy.ts';
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

test('MARXY-96: https images defer to data-marxy-remote with a full-url removal; http images refuse both attributes', () => {
  const https = sanitizeHtml('<img src="https://a/b.png" alt="a">');
  assert.equal(https.html, '<img data-marxy-remote="https://a/b.png" alt="a" />');
  assert.ok(https.removed.some((removal) => removal.url === 'https://a/b.png' && removal.reason === 'remote image, not loaded'));
  const http = sanitizeHtml('<img src="http://a/b.png" alt="a">');
  assert.equal(http.html, '<img alt="a" />');
  assert.ok(http.removed.some((removal) => removal.url === 'http://a/b.png' && removal.reason.includes('plain http')));
});

test('MARXY-96: reserved marxy- ids go on islands; renderer footnote ids stay', () => {
  assert.equal(clean('<a id="marxy-fnref-1">x</a>'), '<a>x</a>');
  assert.equal(clean('<a name="MARXY-x">x</a>'), '<a>x</a>');
  const footnote = sanitizeHtml(
    '<sup><a href="#marxy-fn-1" id="marxy-fnref-1" data-marxy-deadbeef-s="1" data-marxy-deadbeef-e="2">1</a></sup>',
    withProvenance(DEFAULT_POLICY, { start: 'data-marxy-deadbeef-s', end: 'data-marxy-deadbeef-e' }),
    { provenanceNames: { start: 'data-marxy-deadbeef-s', end: 'data-marxy-deadbeef-e' } },
  );
  assert.match(footnote.html, /id="marxy-fnref-1"/);
});

test('a link may be remote, because a reader has to act on it, and a subresource may not', () => {
  assert.equal(clean('<a href="https://example.com/p">x</a>'), '<a href="https://example.com/p">x</a>');
  assert.equal(clean('<a href="mailto:a@example.com">x</a>'), '<a href="mailto:a@example.com">x</a>');
  assert.equal(
    clean('<img src="https://example.com/p.png" alt="a">'),
    '<img data-marxy-remote="https://example.com/p.png" alt="a" />',
  );
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
  const policy = withProvenance(DEFAULT_POLICY);
  const once = sanitizeHtml('<div style="x"><p onclick="a">t</p><script>s</script><img src="https://x.invalid/p.png"></div>', policy).html;
  assert.equal(sanitizeHtml(once, policy).html, once);
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
  // Both values valid, so the guard is what decides — with the earlier test alone, the second value
  // was refused by the URL rule anyway and dropping the guard changed nothing.
  assert.equal(clean('<a href="./a" href="./b">x</a>'), '<a href="./a">x</a>');
  assert.equal(clean('<a href="./a" HREF="./b">x</a>'), '<a href="./a">x</a>');
  assert.equal(clean('<a href="./a" href="javascript:alert(1)">x</a>'), '<a href="./a">x</a>');
});

test('a control character inside a reference is refused rather than guessed at', () => {
  // Not tab, newline or carriage return, which every parser deletes; these are the ones it would
  // percent-encode, and a value whose meaning depends on that is not one to emit.
  for (const href of ['./a\u0001b.png', './a\u007fb.png', './a\u0085b.png', './a\u009fb.png']) {
    assert.equal(sanitizeUrl(href, 'link', DEFAULT_POLICY).allowed, false, `${JSON.stringify(href)} survived`);
  }
  assert.equal(clean('<img src="a\u0001b.png" alt="x">'), '<img alt="x" />');
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
  // An unknown reference leaves bytes a scheme may not contain, so the parser reads the whole thing
  // as a path — a file next to the document, not a scheme. Allowed, and recorded as not absolute.
  assert.equal(sanitizeUrl('java&unknown;script:alert(1)', 'link', DEFAULT_POLICY).absolute, false);
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

// ---------------------------------------------------------------------------------------------
// The policy, asserted rather than consulted.
//
// A check that reads the policy to decide what to expect agrees with the policy however wrong the
// policy is: `onclick` on `p`, `svg` moved to the transparent list and a widened id pattern each
// passed 27 vectors and 178 tests. The assertions below are written against what the allow-list is
// *intended* to be, so a one-line widening has to be argued for here before it can ship, which is
// the property MARXY-26 and MARXY-44 need to hold as they grow it.
// ---------------------------------------------------------------------------------------------

test('the element list is exactly this, and growing it is a decision someone has to make here', () => {
  assert.deepEqual(Object.keys(DEFAULT_POLICY.elements).sort(), [
    'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'dl', 'dt', 'em', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'strong',
    'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
  ]);
});

test('the transparent list is exactly this: an element here keeps its contents, so it is a permission', () => {
  assert.deepEqual([...DEFAULT_POLICY.transparent].sort(), [
    'article', 'aside', 'center', 'details', 'div', 'figcaption', 'figure', 'font', 'footer',
    'header', 'hgroup', 'main', 'nav', 'picture', 'section', 'small', 'span', 'summary',
  ]);
});

test('no rule in the policy may permit an attribute whose name begins with on', () => {
  const rules = [
    ['(global)', DEFAULT_POLICY.globalAttributes] as const,
    ...Object.entries(DEFAULT_POLICY.elements).map(([element, rule]) => [element, rule.attributes ?? {}] as const),
  ];
  for (const [element, attributes] of rules) {
    for (const name of Object.keys(attributes)) {
      assert.ok(!name.toLowerCase().startsWith('on'), `${element}[${name}] is an event handler`);
    }
  }
});

test('the raw-text names are exactly these nine, because each one changes how its end is found', () => {
  // The parser reads these as text, so a `</name` inside a quoted attribute value really does end
  // them — measured in both engines for all nine. Anything added here stops being parsed as markup
  // and anything removed starts being, and either way the removal would end somewhere the browser
  // does not. `listing` is deliberately absent: both engines parse it like `pre`.
  assert.deepEqual([...RAW_TEXT_ELEMENTS].sort(), [
    'iframe', 'noembed', 'noframes', 'noscript', 'plaintext', 'script', 'style', 'textarea', 'title', 'xmp',
  ]);
  assert.ok(!RAW_TEXT_ELEMENTS.has('listing'));
});

test('the foreign-content roots are exactly these two, because only there does a solidus close a tag', () => {
  // Emptying this set makes `<svg/>` swallow the document (safe, but wrong), and adding to it makes
  // a self-closed HTML element stop swallowing (not safe). Both directions need a decision here.
  assert.deepEqual([...FOREIGN_ROOTS].sort(), ['math', 'svg']);
});

test('no element in either list changes what the parser does with the text inside it', () => {
  // Raw-text, foreign-content and template elements are parsed by different rules from everything
  // else, so allowing one — even transparently, which leaves no name in the output to notice —
  // would mean the sanitiser and the browser no longer read the same document.
  const different = new Set([...RAW_TEXT_ELEMENTS, ...FOREIGN_ROOTS, 'template', 'base', 'frame', 'frameset', 'object', 'embed', 'form', 'marquee']);
  for (const name of [...Object.keys(DEFAULT_POLICY.elements), ...DEFAULT_POLICY.transparent]) {
    assert.ok(!different.has(name), `${name} is parsed by rules of its own and may not be allow-listed`);
  }
});

test('a subresource may name no scheme at all, and a link may name exactly three', () => {
  assert.deepEqual(DEFAULT_POLICY.urlSchemes.subresource, []);
  assert.deepEqual([...DEFAULT_POLICY.urlSchemes.link].sort(), ['http', 'https', 'mailto']);
});

test('an id is pinned by example, not by whatever pattern the policy happens to hold', () => {
  for (const id of ['install', 'a.b:c_d', 'H2']) {
    assert.equal(clean(`<h2 id="${id}">x</h2>`), `<h2 id="${id}">x</h2>`, `${id} should be an id`);
  }
  for (const id of ['1', '-x', '#a', 'a/b', 'a b', '../x', '{}', 'a(b)', "a'b", 'a'.repeat(100)]) {
    assert.equal(clean(`<h2 id="${id}">x</h2>`), '<h2>x</h2>', `${id} should not be an id`);
  }
});

// ---------------------------------------------------------------------------------------------
// Regressions, each one an input that reached a host or swallowed a document in a real browser.
// ---------------------------------------------------------------------------------------------

test('a reference that names a host is refused however the host was introduced', () => {
  // `/\host` is `//host` to every URL parser under a special scheme, and this one fetched from
  // evil.example in WebKit and Chromium. The sanitiser decodes `&bsol;` itself, so it makes two of
  // these three spellings on its own.
  for (const src of ['/\\evil.example/pixel.png', '/&bsol;evil.example/pixel.png', '/&#x5c;evil.example/pixel.png', '\\\\evil.example/p.png', 'http:\\\\evil.example/p.png', '/\t\\evil.example/p.png', '\n//evil.example/p.png', '/\\\u0000evil.example/p.png']) {
    assert.equal(clean(`<img src="${src}" alt="badge">`), '<img alt="badge" />', `${JSON.stringify(src)} survived as a src`);
  }
  // A tab or newline on its own is deleted by every parser and leaves an ordinary local path, which
  // is what the browser will fetch; this is the case the sanitiser must *not* over-refuse.
  assert.equal(clean('<img src="/loc\tal.png" alt="a">'), '<img src="/local.png" alt="a" />');
  // In a link it is refused as well, though a link may be remote: the value names a host but no
  // scheme, so where it goes depends on how the shell happened to load the document, and a link
  // whose destination the sanitiser cannot state is not one a reader can be shown.
  assert.equal(clean('<a href="/\\evil.example/">x</a>'), '<a>x</a>');
  assert.equal(clean('<a href="https://evil.example/">x</a>'), '<a href="https://evil.example/">x</a>');
});

test('a solidus does not close an element the parser would leave open', () => {
  assert.equal(clean('<a href="https://evil.example/" />para'), '<a href="https://evil.example/">para</a>');
  assert.equal(clean('<blockquote />textmore'), '<blockquote>textmore</blockquote>');
  assert.equal(clean('<a/href="http://x.example/" title="z" />y</a>'), '<a href="http://x.example/" title="z">y</a>');
  assert.equal(clean('<br/>after'), '<br />after');
});

test('an unclosed formatting element stops at the block it was opened in', () => {
  // Otherwise the rest of the document is inside the anchor and every click navigates to its host.
  assert.equal(
    clean('<a href="https://evil.example/" />para<p>a paragraph</p><h2>a heading</h2>'),
    '<a href="https://evil.example/">para</a><p>a paragraph</p><h2>a heading</h2>',
  );
});

test('a removed element ends where the parser would end it, not at a close tag inside an attribute', () => {
  // An ordinary element's attribute values are parsed, so `</custom-el>` written inside one is not
  // an end tag — the browser keeps `inside` within the element, and so does the removal.
  assert.equal(clean('<custom-el title="</custom-el>">inside</custom-el>after<img src="r.png" alt="a">'), 'after<img src="r.png" alt="a" />');
  assert.equal(clean('<custom-el><custom-el></custom-el></custom-el>after'), 'after');
  // The same close tag one level down, which is the shape the reviewer used: both engines keep
  // `smuggled` inside the element, so the removal must take it and leave only `after`.
  assert.equal(clean('<custom-el><b title="</custom-el>">smuggled</b></custom-el>after'), 'after');
  assert.equal(clean('<custom-el><b title="</custom-el>"><img src="x.png" alt="s"></custom-el>after'), 'after');
  // A solidus does not close a removed element either: both engines read this as a script element
  // whose text is `alert(1)`, so the removal has to run to the end tag.
  assert.equal(clean('<script/>alert(1)</script>after'), 'after');
  // A raw-text element is not parsed, so both engines really do end the style at the `</style>`
  // inside the quotes and the `<img>` after it is a live element there too. Matching the parser is
  // the point: what escapes still meets the allow-list, and a remote src does not survive it.
  assert.equal(clean('<style><b title="</style>"><img src="local.png" alt="s"></style>'), '"><img src="local.png" alt="s" />');
  assert.equal(clean('<title><b title="</title>"><img src="/\\evil.example/p.png" alt="x">'), '"><img alt="x" />');
});

test('a removed raw-text element ends exactly where both engines end it', () => {
  // Each expectation was measured in Chromium and WebKit with DOMParser: an <img> the engines keep
  // inside the element must not come out as an element, and one they make live may come out.
  // `</styled>` is not an end tag for style, so the image stays inside it.
  assert.equal(clean('<style></styled><img src="x.png" alt="y"></style>'), '');
  // A form feed is a delimiter, so this one is.
  assert.equal(clean('<style></style\f><img src="x.png" alt="y">'), '<img src="x.png" alt="y" />');
  // Nothing ends plaintext.
  assert.equal(clean('<plaintext></plaintext><img src="x.png" alt="y">'), '');
  // listing is parsed like pre, so a close tag inside a quoted value does not end it.
  assert.equal(clean('<listing><b title="</listing>"><img src="x.png" alt="y"></b></listing>after'), 'after');
});

test('a script is scanned through its escaped and double-escaped states', () => {
  // Inert in both engines: `<!--<script>` puts the first `</script>` inside a nested escape.
  assert.equal(clean('<script><!--<script>a</script><img src="x.png" alt="y"></script>after'), 'after');
  assert.equal(clean('<script><!--<script>a</script>--><img src="x.png" alt="y"></script>after'), 'after');
  assert.equal(clean('<script><!--><img src="x.png" alt="y"></script>after'), 'after');
  // Live in both engines: no nested `<script`, or a name that is not `script`, or `-->` first.
  assert.equal(clean('<script><!-- </script><img src="x.png" alt="y">'), '<img src="x.png" alt="y" />');
  assert.equal(clean('<script><!--<scripty></script><img src="x.png" alt="y">'), '<img src="x.png" alt="y" />');
  assert.equal(clean('<script><!--<script/></script>--></script><img src="x.png" alt="y">'), '<img src="x.png" alt="y" />');
  assert.equal(clean('<script><!--<script ><!--</script ></script><img src="x.png" alt="y">'), '<img src="x.png" alt="y" />');
  // Unclosed, the whole rest is the script's, and the reader is told.
  assert.equal(clean('<script><!--<script></script><img src="x.png" alt="y">'), '');
});

test('a never-closed removal is recorded as its own kind, because the reader lost the rest', () => {
  const { html, removed } = sanitizeHtml('before<script>alert(1)');
  assert.equal(html, 'before');
  const truncation = removed.find((removal) => removal.what === 'truncation');
  assert.ok(truncation !== undefined, 'a notice cannot tell a reader about a truncation it was not told about');
  assert.equal(truncation.name, 'script');
  // And an element that closes properly is not a truncation, or the notice would cry wolf.
  assert.ok(!sanitizeHtml('<script>alert(1)</script>after').removed.some((removal) => removal.what === 'truncation'));
});

test('a checkbox a document wrote cannot be toggled either', () => {
  assert.equal(clean('<input type=checkbox>'), '<input type="checkbox" disabled />');
  assert.equal(clean('<input type="checkbox" checked disabled>'), '<input type="checkbox" checked disabled />');
});

test('an absolute link is emitted in the form the browser will use, so a host reads as itself', () => {
  assert.equal(clean('<a href="https://g\u043eogle.com/">x</a>'), '<a href="https://xn--gogle-jye.com/">x</a>');
});
