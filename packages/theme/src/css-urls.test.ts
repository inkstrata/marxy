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

// F-16: a raster data: URL broken by a raw line break must not hide a remote rule from the scanner.
const EVIL = '}b{background:url(https://evil.example/p.png)}';

function hidden(brk: string): Record<string, string> {
  const body = `data:image/png,(AA${brk})${EVIL}`;
  return {
    'double-quoted': `x { background: url("${body}"); }`,
    'single-quoted': `x { background: url('${body}'); }`,
    unquoted: `x { background: url(${body}); }`,
    padded: `x { background: url( "${body}" ); }`,
    'image-set': `x { background: image-set(url("${body}") 1x); }`,
  };
}

for (const [name, brk] of [['\\n', '\n'], ['\\r', '\r'], ['\\f', '\f']] as const) {
  for (const [form, sheet] of Object.entries(hidden(brk))) {
    test(`a data: url broken by a raw ${name} cannot hide a remote url (${form})`, () => {
      const { css, warnings } = rewriteUrls(sheet, { base, assetUrl });
      assert.doesNotMatch(css, /evil\.example/);
      assert.doesNotMatch(css, /https?:/);
      assert.ok(warnings.length >= 1);
    });
  }
}

test('a data: body with a quote, parenthesis or backslash is refused', () => {
  for (const body of ['a"b', "a'b", 'a(b', 'a)b', 'a\\\\b']) {
    const q = body.includes('"') ? "'" : '"';
    const { css, warnings } = rewriteUrls(`x { background: url(${q}data:image/png;base64,${body}${q}); }`, { base, assetUrl });
    assert.equal(css, 'x { background: ; }', body);
    assert.equal(warnings.length, 1);
  }
});

test('ordinary base64 and percent-encoded rasters pass unchanged', () => {
  const b64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const pct = 'data:image/gif,GIF89a%01%00%01%00%80%00%00%FF%FF%FF%00%00%00%2C';
  for (const d of [b64, pct]) {
    const sheet = `x { background: url("${d}"); }`;
    const { css, warnings } = rewriteUrls(sheet, { base, assetUrl });
    assert.equal(css, sheet);
    assert.deepEqual(warnings, []);
  }
});

test('an uppercase DATA: svg is still removed, and a relative path with a line break keeps no raw newline', () => {
  const svg = rewriteUrls('x { background: url("DATA:image/svg+xml,<svg/>"); }', { base, assetUrl });
  assert.equal(svg.css, 'x { background: ; }');
  const rel = rewriteUrls(`x { background: url("DATA:image/svg+xml,(\n)${EVIL}"); }`, { base, assetUrl });
  assert.doesNotMatch(rel.css, /[\n\r\f]/);
  assert.doesNotMatch(rel.css, /evil\.example/);
  assert.ok(rel.warnings.length >= 1);
  const path = rewriteUrls('x { background: url("a\n.png"); }', { base, assetUrl });
  assert.doesNotMatch(path.css, /[\n\r\f]/);
  assert.ok(path.warnings.length >= 1);
});

test('a parenthesis inside a quoted string does not hide a later remote url', () => {
  const { css, warnings } = rewriteUrls('x { background: url("a(.png"); } y { background: url(https://evil.example/p.png); }', { base, assetUrl });
  assert.doesNotMatch(css, /evil\.example/);
  assert.ok(warnings.length >= 1);
});

// F-16 review: removing a reference must not splice a fresh url( together.
test('removing an empty url() cannot splice a remote url together', () => {
  const { css, warnings } = rewriteUrls('body{background:urlurl()(https://evil.example/p.png)}', { base, assetUrl });
  assert.doesNotMatch(css, /evil\.example/);
  assert.ok(warnings.length >= 1);
});

test('removing an @import cannot splice a remote url together', () => {
  const { css, warnings } = rewriteUrls('a{background:url@import x;(https://evil.example/p.png)}', { base, assetUrl });
  assert.doesNotMatch(css, /evil\.example/);
  assert.ok(warnings.length >= 2);
});

test('repeated removal cannot splice a remote url together', () => {
  const { css } = rewriteUrls('body{background:urlurlurl()()(https://evil.example/p.png)}', { base, assetUrl });
  assert.doesNotMatch(css, /evil\.example/);
});

test('removing an image-set candidate cannot splice a remote url together', () => {
  const { css } = rewriteUrls('a{background:image-set(urlurl()(https://evil.example/p.png) 1x)}', { base, assetUrl });
  assert.doesNotMatch(css, /evil\.example/);
});

test('an unterminated string inside image-set is dropped with a warning', () => {
  const { css, warnings } = rewriteUrls('a{background:image-set("a.png\n" 1x)}', { base, assetUrl });
  assert.doesNotMatch(css, /a\.png/);
  assert.ok(warnings.length >= 1);
});

// F-16 review 2: the verification pass must not depend on, or call, the caller's assetUrl.
test('a local asset loads when assetUrl returns an http://asset.localhost url', () => {
  const { css, warnings } = rewriteUrls('@font-face{font-family:Lit;src:url(fonts/lit.woff2)}', {
    base,
    assetUrl: (p) => `http://asset.localhost/${encodeURIComponent(p)}`,
  });
  assert.equal(css, `@font-face{font-family:Lit;src:url("http://asset.localhost/${encodeURIComponent('/themes/quiet/fonts/lit.woff2')}")}`);
  assert.deepEqual(warnings, []);
});

test('assetUrl is called exactly once per real reference and never with anything else', () => {
  const real = new Set(['/themes/quiet/a.png', '/themes/quiet/b.woff2']);
  const calls: string[] = [];
  const { css } = rewriteUrls('x{background:url(a.png)} y{src:url(b.woff2)} z{background:image-set("a.png" 1x)}', {
    base,
    assetUrl: (p) => {
      calls.push(p);
      if (!real.has(p)) throw new Error('notFound');
      return `asset://${p}`;
    },
  });
  assert.deepEqual(calls, ['/themes/quiet/a.png', '/themes/quiet/b.woff2', '/themes/quiet/a.png']);
  assert.match(css, /asset:\/\/\/themes\/quiet\/b\.woff2/);
});

test('a theme cannot forge a placeholder to smuggle a path through', () => {
  const calls: string[] = [];
  const { css } = rewriteUrls('x{background:url("marxy-asset-0000-0")} y{background:url(a.png)}', {
    base,
    assetUrl: (p) => (calls.push(p), `asset://${p}`),
  });
  assert.deepEqual(calls, ['/themes/quiet/marxy-asset-0000-0', '/themes/quiet/a.png']);
  assert.doesNotMatch(css, /marxy-asset-[0-9a-f]{24}/);
});

// F-16.1: the caller's assetUrl result is escaped for a double-quoted CSS string.
function cssUnescape(s: string): string {
  return s.replace(/\\(?:([0-9a-fA-F]{1,6}) ?|([\s\S]))/g, (_m, hex?: string, ch?: string) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : (ch as string));
}

test('a backslash in an assetUrl result stays inside the url string', () => {
  const { css } = rewriteUrls('x{background:url(a.png)}', { base, assetUrl: () => 'a\\' });
  assert.equal(css, 'x{background:url("a\\\\")}');
  const m = /^x\{background:url\("((?:[^"\\\n]|\\[\s\S])*)"\)\}$/.exec(css);
  assert.ok(m, 'one url token');
  assert.equal(cssUnescape(m[1]), 'a\\');
});

test('a line break in an assetUrl result cannot end the string or open a rule', () => {
  const evil = 'a\nb){x:url(https://evil.example/q)}';
  for (const sheet of ['x{background:url(a.png)}', 'x{background:image-set("a.png" 1x)}']) {
    const { css } = rewriteUrls(sheet, { base, assetUrl: () => evil });
    assert.doesNotMatch(css, /[\n\r\f]/);
    assert.match(css, /a\\a b\)\{x:url\(https:\/\/evil\.example\/q\)\}"/);
    // everything after the opening quote up to the closing one is one string
    const m = /"((?:[^"\\]|\\[\s\S])*)"/.exec(css);
    assert.ok(m);
    assert.equal(cssUnescape(m[1]), evil);
    assert.equal(css.replace(/"(?:[^"\\]|\\[\s\S])*"/g, '""').includes('evil.example'), false);
  }
});

test('\\r, \\f and a quote in an assetUrl result are escaped', () => {
  const { css } = rewriteUrls('x{background:url(a.png)}', { base, assetUrl: () => 'a"\r\fb' });
  assert.equal(css, 'x{background:url("a\\"\\d \\c b")}');
});

test('image-set keeps the type() and dpi descriptors of a string candidate', () => {
  const { css } = rewriteUrls('a{background:image-set("a.avif" type("image/avif"), "b.png" 96dpi)}', { base, assetUrl });
  assert.equal(
    css,
    'a{background:image-set("asset:///themes/quiet/a.avif" type("image/avif"), "asset:///themes/quiet/b.png" 96dpi)}',
  );
});
