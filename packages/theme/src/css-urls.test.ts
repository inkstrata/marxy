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
