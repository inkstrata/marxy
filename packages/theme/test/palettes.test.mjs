// MARXY-46: the light palette is designed on its own ground — fixture match, no 255-complement of dark, baselines present.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveVariantPreference } from './resolve-variant.mjs';

const root = new URL('../../../', import.meta.url);
const palettes = JSON.parse(readFileSync(new URL('./palettes.json', import.meta.url), 'utf8'));

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Custom properties declared in the first `{…}` block whose selector contains `needle`. */
function propsInBlock(css, needle) {
  const stripped = stripComments(css);
  const re = new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*)\\{([^}]*)\\}`, 'm');
  const m = stripped.match(re);
  if (!m) return {};
  const out = {};
  for (const [, name, value] of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

function readDarkTokens() {
  const tokens = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');
  return propsInBlock(tokens, ':root');
}

function readLightBlock() {
  const theme = readFileSync(new URL('../default/theme.css', import.meta.url), 'utf8');
  return propsInBlock(theme, ':root[data-marxy-variant="light"]');
}

function complementHex(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `expected #rrggbb, got ${hex}`);
  const parts = hex.slice(1).match(/../g).map((x) => 255 - Number.parseInt(x, 16));
  return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function corpusStems() {
  const dir = new URL('fixtures/corpus/', root);
  return readdirSync(dir)
    .filter((f) => /^\d{2}-.+\.md$/.test(f))
    .map((f) => f.replace(/\.md$/, ''));
}

test('MARXY-46: dark tokens and the light block match docs/design/05-theme.md §Palettes (palettes.json)', () => {
  const dark = readDarkTokens();
  const light = readLightBlock();
  for (const [token, expected] of Object.entries(palettes.dark)) {
    assert.equal(dark[token], expected, `dark ${token}`);
  }
  for (const [token, expected] of Object.entries(palettes.light)) {
    assert.equal(light[token], expected, `light ${token}`);
  }
});

test('MARXY-46: no light colour is the 255-complement of its dark counterpart', () => {
  const dark = readDarkTokens();
  const light = readLightBlock();
  for (const token of Object.keys(palettes.light)) {
    const d = dark[token];
    const l = light[token];
    if (!d || !l || !/^#[0-9a-f]{6}$/i.test(d) || !/^#[0-9a-f]{6}$/i.test(l)) continue;
    assert.notEqual(l.toLowerCase(), complementHex(d.toLowerCase()), `${token} looks like an inversion of dark`);
  }
});

test('MARXY-46: resolveVariantPreference maps config.variant light and auto', () => {
  assert.equal(resolveVariantPreference('light', true), 'light');
  assert.equal(resolveVariantPreference('dark', false), 'dark');
  assert.equal(resolveVariantPreference('auto', true), 'dark');
  assert.equal(resolveVariantPreference('auto', false), 'light');
});

test('MARXY-46: committed screenshot baselines exist for light at 960 px (both engines)', () => {
  const stems = corpusStems();
  for (const engine of ['webkit-macos', 'webkit-linux']) {
    const base = join(new URL('fixtures/baselines/', root).pathname, engine);
    for (const stem of stems) {
      const shot = join(base, `${stem}-960-light.png`);
      assert.ok(existsSync(shot), `missing ${engine}/${stem}-960-light.png`);
    }
  }
});
