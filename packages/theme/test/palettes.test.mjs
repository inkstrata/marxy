// MARXY-46: the light palette is designed on its own ground — fixture match, no 255-complement of dark, baselines present.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

function parseHex(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  return hex.slice(1).match(/../g).map((x) => Number.parseInt(x, 16));
}

function contrastRgb(fg, bg) {
  const lum = (c) => {
    const v = c.map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const [a, b] = [lum(fg), lum(bg)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
}

function resolveColor(value, table) {
  const v = value.trim();
  if (v.startsWith('#')) return v;
  const m = v.match(/var\((--[\w-]+)\)/);
  if (m) return resolveColor(table[m[1]] ?? '', table);
  return v;
}

test('MARXY-235: every Marxy foreground token is at least 4.5:1 on all four diff tints (both variants, unrounded)', () => {
  const dark = { ...readDarkTokens(), ...palettes.dark };
  const light = { ...readLightBlock(), ...palettes.light };
  const diffTokens = [
    '--marxy-color-diff-add',
    '--marxy-color-diff-del',
    '--marxy-color-diff-add-word',
    '--marxy-color-diff-del-word',
  ];
  const fgTokens = [
    '--marxy-color-text',
    '--marxy-color-text-secondary',
    '--marxy-color-code-text',
    '--marxy-tok-keyword',
    '--marxy-tok-string',
    '--marxy-tok-comment',
    '--marxy-tok-number',
    '--marxy-tok-function',
    '--marxy-tok-type',
    '--marxy-tok-variable',
    '--marxy-tok-operator',
    '--marxy-tok-punctuation',
    '--marxy-tok-constant',
    '--marxy-tok-tag',
    '--marxy-tok-attribute',
  ];
  for (const [label, table] of [['dark', dark], ['light', light]]) {
    for (const bgName of diffTokens) {
      const bg = parseHex(resolveColor(table[bgName], table));
      for (const fgName of fgTokens) {
        const fgRaw = table[fgName];
        if (!fgRaw || !/^#|var\(/.test(fgRaw)) continue;
        const fg = parseHex(resolveColor(fgRaw, table));
        const ratio = contrastRgb(fg, bg);
        assert.ok(ratio >= 4.5, `${label} ${fgName} on ${bgName}: ${ratio} < 4.5:1`);
      }
    }
  }
});

test('MARXY-46: committed screenshot baselines exist for light at 960 px (both engines)', () => {
  const stems = corpusStems();
  for (const engine of ['webkit-macos', 'webkit-linux']) {
    const base = join(fileURLToPath(new URL('fixtures/baselines/', root)), engine);
    for (const stem of stems) {
      const shot = join(base, `${stem}-960-light.png`);
      assert.ok(existsSync(shot), `missing ${engine}/${stem}-960-light.png`);
    }
  }
});
