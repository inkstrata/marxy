// MARXY-241: system-owned accessibility media queries live in base.css.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8');

test('MARXY-241: base.css contains forced-colors, prefers-contrast and prefers-reduced-motion rules', () => {
  assert.match(css, /@media\s*\(\s*forced-colors:\s*active\s*\)/);
  assert.match(css, /@media\s*\(\s*prefers-contrast:\s*more\s*\)/);
  assert.match(css, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
});
