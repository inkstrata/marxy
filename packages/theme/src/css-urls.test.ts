// rewriteUrls security and rewriting cases (MARXY-47 task card).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { rewriteUrls } from './css-urls.ts';

const base = '/themes/quiet';
const assetUrl = (abs: string) => `asset://${abs}`;

test('relative url() is rewritten under the theme directory', () => {
  const { css, warnings } = rewriteUrls('@font-face { src: url(fonts/a.woff2); }', { base, assetUrl });
  assert.equal(css, '@font-face { src: url("asset:///themes/quiet/fonts/a.woff2"); }');
  assert.deepEqual(warnings, []);
});

test('remote url() values are removed with a warning', () => {
  for (const spec of ['https://x', '//x', 'http://x']) {
    const { css, warnings } = rewriteUrls(`body { background: url(${spec}); }`, { base, assetUrl });
    assert.equal(css, 'body { background: ; }');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /not loaded/);
  }
});

test('@import is removed with a warning', () => {
  const { css, warnings } = rewriteUrls('@import "x.css"; @import url(https://x);', { base, assetUrl });
  assert.equal(css, ' ');
  assert.equal(warnings.length, 2);
});

test('paths that escape the theme directory are removed', () => {
  const { css, warnings } = rewriteUrls('x { background: url(../../etc/passwd); }', { base, assetUrl });
  assert.equal(css, 'x { background: ; }');
  assert.equal(warnings.length, 1);
});

test('data: urls are kept', () => {
  const data = 'data:image/png;base64,abc';
  const { css, warnings } = rewriteUrls(`x { background: url(${data}); }`, { base, assetUrl });
  assert.match(css, /data:image\/png/);
  assert.equal(warnings.length, 0);
});

test('an svg data: url is removed with a warning, since it can embed its own remote reference', () => {
  const data = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxpbWFnZSBocmVmPSJodHRwczovL2V2aWwuZXhhbXBsZS9waXhlbC5wbmciLz48L3N2Zz4=';
  const { css, warnings } = rewriteUrls(`x { background: url(${data}); }`, { base, assetUrl });
  assert.equal(css, 'x { background: ; }');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /remote reference/);
});

test('url() inside comments and strings is untouched', () => {
  const input = '/* url(https://x) */ .x { content: "url(https://y)"; }';
  const { css, warnings } = rewriteUrls(input, { base, assetUrl });
  assert.equal(css, input);
  assert.equal(warnings.length, 0);
});

test('image-set drops remote candidates', () => {
  const { css, warnings } = rewriteUrls('x { background: image-set("a.png" 1x, "https://x" 2x); }', { base, assetUrl });
  assert.match(css, /a\.png/);
  assert.doesNotMatch(css, /https:\/\/x/);
  assert.equal(warnings.length, 1);
});

// 2026-09-26 review (MARXY-246): every one of these used to pass through unchanged.
test('url(), @import and image-set() are matched in any case', () => {
  for (const sheet of [
    'a{background:URL(https://evil.example/a.png)}',
    '@IMPORT "https://evil.example/x.css";',
    'a{background:Image-Set("https://evil.example/d.png" 1x)}',
    'a{background:-webkit-image-set(url(https://evil.example/e.png) 1x)}',
  ]) {
    const { css, warnings } = rewriteUrls(sheet, { base, assetUrl });
    assert.doesNotMatch(css, /evil\.example/, sheet);
    assert.ok(warnings.length > 0, sheet);
  }
});

test('a CSS escape outside a string refuses the whole sheet', () => {
  for (const sheet of [
    'a{background:u\\72l(https://evil.example/b.png)}',
    'a{--x:\\"; background:url(https://evil.example/c.png)} b{content:"q"}',
  ]) {
    const { css, warnings } = rewriteUrls(sheet, { base, assetUrl });
    assert.equal(css, '', sheet);
    assert.match(warnings[0]!, /escape/);
  }
  // Escapes inside strings are ordinary and stay.
  assert.equal(rewriteUrls('q::before{content:"\\201C"}', { base, assetUrl }).css, 'q::before{content:"\\201C"}');
});

test('dropping a remote image-set candidate drops its descriptor with it', () => {
  const { css } = rewriteUrls('a{background:image-set(url(ok.png) 1x, url(https://evil.example/f.png) 2x)}', { base, assetUrl });
  assert.equal(css, 'a{background:image-set(url("asset:///themes/quiet/ok.png") 1x)}');
});

test('a string ends at an unescaped newline, so a url() after it is still rewritten (MARXY-337)', () => {
  const css = 'p { content: "x\n}\nbody { background: url(https://evil.example/nl.png) }\n/* " */';
  const { css: out, warnings } = rewriteUrls(css, { base, assetUrl });
  assert.ok(!out.includes('evil.example'));
  assert.ok(warnings.some((w) => w.includes('evil.example')));
  for (const nl of ['\r', '\f', '\r\n']) {
    const r = rewriteUrls(`a{content:'x${nl}}b{background:url(http://evil.example/a.png)}`, { base, assetUrl });
    assert.ok(!r.css.includes('evil.example'), JSON.stringify(nl));
  }
});

test('an escaped newline continues a string and an escaped quote does not end it', () => {
  const css = 'a{content:"x\\\ny\\"z"}b{content:"q\\\r\nr"}';
  assert.equal(rewriteUrls(css, { base, assetUrl }).css, css);
});

test('@import ends at a semicolon outside its string, so a following rule survives (MARXY-337)', () => {
  const { css, warnings } = rewriteUrls('@import "a;b.css" ;\nh1{color:red}', { base, assetUrl });
  assert.equal(css, '\nh1{color:red}');
  assert.equal(warnings.length, 1);
  assert.equal(rewriteUrls('@import url(a;b.css);p{}', { base, assetUrl }).css, 'p{}');
  assert.ok(!rewriteUrls('@import "x\n;a{background:url(http://evil.example/x.png)}', { base, assetUrl }).css.includes('evil.example'));
});
