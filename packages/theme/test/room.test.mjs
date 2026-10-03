// B-03: --marxy-room is measured against the article's container, not the window, so wide code
// and tables stay inside one pane of a split. Reader Typography ch.4 (margins) sets the gutter floor.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8');

test('B-03: --marxy-room uses container units, not viewport units', () => {
  const room = css.match(/--marxy-room:\s*([^;]+);/);
  assert.ok(room, '--marxy-room is declared');
  assert.match(room[1], /100cqi/);
  assert.doesNotMatch(room[1], /100vw/);
});

test('B-03: #marxy-main is an inline-size container', () => {
  assert.match(css, /#marxy-main\s*\{[^}]*container-type:\s*inline-size/);
});

test('B-03: the viewport gutter step is kept and a narrow container overrides it', () => {
  assert.match(css, /@media\s*\(\s*min-width:\s*30em\s*\)\s*\{[^}]*--marxy-gutter:\s*24px/);
  const media = css.indexOf('@media (min-width: 30em)');
  const container = css.search(/@container\s*\(\s*max-width:\s*30em\s*\)\s*\{[^}]*--marxy-gutter:\s*16px/);
  assert.ok(container > media, 'the @container rule comes after the media rule so it wins');
});
