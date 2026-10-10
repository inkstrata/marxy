// F-29: the two-pane harness finds the real <body>, not the text "<body>" in a comment or <style>.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { shippedSkeleton, skeletonOf } from './support/two-pane.mjs';

const page = (css) => `<!doctype html><html><head>
<!-- marxy:default-theme -->
<style>${css}</style></head>
<body class="x"><article id="doc"></article><script>const s = '<body>';</script></body></html>`;

test('a <style> comment mentioning <body> does not become the body', () => {
  const { body, style } = skeletonOf(page('/* the <body> is dark */ a { color: red }'));
  assert.equal(body, '<article id="doc"></article>');
  assert.match(style, /a \{ color: red \}/);
});

test('an HTML comment before the body, and a </body> in a script, are skipped', () => {
  const html = page('a{}').replace('<head>', '<head><!-- <body><p>decoy</p></body> -->');
  assert.equal(skeletonOf(html).body, '<article id="doc"></article>');
});

test('the shipped index.html still yields its skeleton', () => {
  assert.match(shippedSkeleton().body, /id="doc"/);
});
