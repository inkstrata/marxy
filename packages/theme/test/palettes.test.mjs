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
  // Night: the default theme's :root (H-04). tokens.css keeps the contract's fallbacks, not the default's values.
  const theme = readFileSync(new URL('../default/theme.css', import.meta.url), 'utf8');
  return propsInBlock(theme, ':root');
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
    // Text on an accent fill is black on Night's accent and white on Paper's by definition (Galley's own pair).
    if (token === '--marxy-color-accent-fg') continue;
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

test('L-11: the find edge is 3:1 on page and code grounds, current differs from other by 3:1, text on fills keeps 4.5:1', () => {
  const dark = { ...readDarkTokens(), ...palettes.dark };
  const light = { ...readLightBlock(), ...palettes.light };
  for (const [label, t] of [['dark', dark], ['light', light]]) {
    const rgb = (name) => parseHex(resolveColor(t[name], t));
    const edge = rgb('--marxy-color-find-edge');
    for (const ground of ['--marxy-color-bg', '--marxy-color-code-bg']) {
      const r = contrastRgb(edge, rgb(ground));
      assert.ok(r >= 3, `${label} find-edge on ${ground}: ${r} < 3:1`);
    }
    // The current match adds a code-text outline; it must differ from the other matches' edge by 3:1.
    const cur = contrastRgb(edge, rgb('--marxy-color-code-text'));
    assert.ok(cur >= 3, `${label} current outline vs other edge: ${cur} < 3:1`);
    for (const fill of ['--marxy-color-find', '--marxy-color-find-current']) {
      for (const fg of ['--marxy-color-text', '--marxy-color-code-text']) {
        const r = contrastRgb(rgb(fg), rgb(fill));
        assert.ok(r >= 4.5, `${label} ${fg} on ${fill}: ${r} < 4.5:1`);
      }
    }
  }
});

test('H-04: Night is the default dark and Paper the default light; Ink keeps the warm ground; both speak contract 2', () => {
  const night = readDarkTokens();
  const paper = readLightBlock();
  assert.equal(night['--marxy-color-bg'], '#000000');
  assert.equal(night['--marxy-weight-body'], '370');
  assert.equal(paper['--marxy-color-bg'], '#fbfaf8');
  assert.equal(paper['--marxy-weight-body'], '400');
  const ink = readFileSync(new URL('../ink/theme.css', import.meta.url), 'utf8');
  assert.equal(propsInBlock(ink, ':root')['--marxy-color-bg'], '#151412');
  assert.equal(propsInBlock(ink, ':root[data-marxy-variant="light"]')['--marxy-color-bg'], '#faf8f4');
  for (const dir of ['default', 'ink']) {
    assert.match(readFileSync(new URL(`../${dir}/theme.toml`, import.meta.url), 'utf8'), /^contract = 2$/m, dir);
  }
});

// ---- V-13 (ADR-0068): a hue per code role, built in OKLCH ------------------------------------------------------
// The roles are the names in the one role table (packages/core/src/highlight/roles.ts), read as text so this test
// needs no TypeScript loader.
const ROLE_NAMES = [...readFileSync(new URL('../../core/src/highlight/roles.ts', import.meta.url), 'utf8').matchAll(/^  (\w+): \{/gm)].map((m) => m[1]);

function toOklab(hex) {
  const lin = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s };
}

function variantTables() {
  return {
    dark: { ...readDarkTokens(), ...palettes.dark },
    light: { ...readDarkTokens(), ...readLightBlock(), ...palettes.light },
  };
}

test('V-13: the role table names the roles the default theme gives a value, in both variants', () => {
  assert.ok(ROLE_NAMES.length >= 21, ROLE_NAMES.join());
  for (const [label, table] of Object.entries(variantTables())) {
    for (const role of ROLE_NAMES) {
      assert.ok(table[`--marxy-tok-${role}`], `${label}: --marxy-tok-${role} has no value`);
    }
  }
});

test('V-13: every role is at least 4.5:1 on the code ground and on the page ground, in both variants', () => {
  for (const [label, table] of Object.entries(variantTables())) {
    for (const role of ROLE_NAMES) {
      const fg = parseHex(resolveColor(table[`--marxy-tok-${role}`], table));
      for (const ground of ['--marxy-color-code-bg', '--marxy-color-bg']) {
        const ratio = contrastRgb(fg, parseHex(resolveColor(table[ground], table)));
        assert.ok(ratio >= 4.5, `${label} ${role} on ${ground}: ${ratio.toFixed(2)} < 4.5:1`);
      }
    }
  }
});

test('V-13: roles that sit side by side in code differ in lightness as well as hue (OKLab L, at least 0.05)', () => {
  const pairs = [['keyword', 'function'], ['type', 'variable'], ['string', 'escape']];
  for (const [label, table] of Object.entries(variantTables())) {
    for (const [a, b] of pairs) {
      const la = toOklab(resolveColor(table[`--marxy-tok-${a}`], table)).L;
      const lb = toOklab(resolveColor(table[`--marxy-tok-${b}`], table)).L;
      assert.ok(Math.abs(la - lb) >= 0.05, `${label} ${a} / ${b}: ΔL ${Math.abs(la - lb).toFixed(3)} < 0.05`);
    }
  }
});

test('V-13: comments are read, not dimmed (5:1 on the code ground), and no two hue roles share a colour except where the table says', () => {
  const SHARED = [['number', 'constant'], ['function', 'tag'], ['property', 'attribute']];
  for (const [label, table] of Object.entries(variantTables())) {
    const ratio = contrastRgb(parseHex(resolveColor(table['--marxy-tok-comment'], table)), parseHex(resolveColor(table['--marxy-color-code-bg'], table)));
    assert.ok(ratio >= 5, `${label} comment: ${ratio.toFixed(2)} < 5:1`);
    const seen = new Map();
    for (const role of ['keyword', 'string', 'escape', 'number', 'constant', 'function', 'builtin', 'type', 'property', 'decorator', 'self', 'tag', 'attribute', 'operator']) {
      const hex = resolveColor(table[`--marxy-tok-${role}`], table).toLowerCase();
      const other = seen.get(hex);
      if (other) assert.ok(SHARED.some(([x, y]) => (x === other && y === role) || (y === other && x === role)), `${label}: ${role} and ${other} share ${hex}`);
      seen.set(hex, role);
    }
  }
});
