// Colour by language: every language's palette reaches its floor against every ground a code token sits
// on, in every bundled theme and variant, with and without more contrast (4.5 : 1, or 7 : 1 with more contrast or in the
// high-contrast theme); every language's accent reaches 3 : 1 (4.5 : 1 there) against the grounds its name sits on. The
// grounds are resolved from the theme files as gate-contrast resolves them, and each ratio is measured again here, not
// taken from the solver.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HIGH_CONTRAST_THEMES, findThemes, flatten, moreOverrides, parseColour, parseRules, ratio, scopeTokens } from '../../../scripts/gate-contrast.mjs';
import {
  LANG_PALETTES,
  LINGUIST,
  PALETTE_ALIASES,
  PALETTE_ROLES,
  SYNTAX_ROLES,
  accentGrounds,
  solveAccent,
  solvePalette,
  syntaxCss,
  tokenGrounds,
} from '../src/lang-palettes.ts';

const FRAME = parseRules(flatten(fileURLToPath(new URL('../src/frame.css', import.meta.url))));

/** Each theme, variant and contrast with a resolver for its colour properties (frame.css's chrome mixes included). */
function looks() {
  const out = [];
  for (const theme of findThemes()) {
    const rules = parseRules(theme.css);
    for (const variant of theme.variants) {
      for (const more of [false, true]) {
        const tokens = { ...scopeTokens(FRAME, variant, null), ...scopeTokens(rules, variant, null, more ? moreOverrides() : null) };
        const cache = new Map();
        const colour = (name) => {
          if (cache.has(name)) return cache.get(name);
          if (!(name in tokens)) return undefined;
          const c = parseColour(tokens[name], colour);
          cache.set(name, c);
          return c;
        };
        const high = HIGH_CONTRAST_THEMES.includes(theme.name) || more;
        out.push({ where: `${theme.name} · ${variant}${more ? ' · more contrast' : ''}`, colour, floor: high ? 7 : 4.5, accentFloor: high ? 4.5 : 3 });
      }
    }
  }
  return out;
}

const rgb = (hex) => parseColour(hex);

test('the roles restate core\'s MarxyRole', () => {
  const src = readFileSync(new URL('../../core/src/highlight/roles.ts', import.meta.url), 'utf8');
  const union = /export type MarxyRole =([^;]+);/.exec(src)[1];
  assert.deepEqual([...union.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort(), [...SYNTAX_ROLES].sort());
});

test('every palette reaches its floor against every token ground, in every theme, variant and contrast', () => {
  const all = looks();
  assert.ok(all.length >= 16, `${all.length} looks`);
  let checked = 0;
  for (const look of all) {
    const grounds = tokenGrounds(look.colour);
    assert.ok(grounds.length >= 4, `${look.where}: ${grounds.length} grounds`);
    for (const lang of [...Object.keys(LANG_PALETTES), ...Object.keys(PALETTE_ALIASES)]) {
      const p = solvePalette(lang, grounds, look.floor);
      for (const role of PALETTE_ROLES) {
        for (const g of grounds) {
          const r = ratio(rgb(p[role].hex), [...g, 1]);
          assert.ok(r >= look.floor, `${look.where} · ${lang} ${role} ${p[role].hex}: ${r.toFixed(2)} < ${look.floor}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000, `${checked} pairs`);
});

test('a palette keeps its language\'s hue: no role falls to black or white in any look', () => {
  for (const look of looks()) {
    const grounds = tokenGrounds(look.colour);
    for (const lang of Object.keys(LANG_PALETTES)) {
      const p = solvePalette(lang, grounds, look.floor);
      for (const role of PALETTE_ROLES) assert.ok(!['#000000', '#ffffff'].includes(p[role].hex), `${look.where} · ${lang} ${role} fell to ${p[role].hex}`);
    }
  }
});

test('every accent reaches 3 : 1 (4.5 : 1 in high contrast) against every ground its name sits on', () => {
  let checked = 0;
  for (const look of looks()) {
    const grounds = accentGrounds(look.colour);
    assert.ok(grounds.length >= 4, `${look.where}: ${grounds.length} accent grounds`);
    for (const [lang, hex] of Object.entries(LINGUIST)) {
      const a = solveAccent(hex, grounds, look.accentFloor);
      for (const g of grounds) {
        const r = ratio(rgb(a.hex), [...g, 1]);
        assert.ok(r >= look.accentFloor, `${look.where} · ${lang} accent ${a.hex}: ${r.toFixed(2)} < ${look.accentFloor}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 1000, `${checked} pairs`);
});

test('an accent already at 3 : 1 is the Linguist colour itself', () => {
  assert.equal(solveAccent('#dea584', [rgb('#0f1113')]).hex, '#dea584');
  const lifted = solveAccent('#012456', [rgb('#0f1113')]);
  assert.notEqual(lifted.hex, '#012456');
  assert.ok(lifted.ratio >= 3);
});

test('the stylesheet: palettes under :where, the reader\'s colours above a theme\'s scope, the accent only when on', () => {
  const look = looks()[0];
  const base = { tokenGrounds: tokenGrounds(look.colour), accentGrounds: accentGrounds(look.colour), floor: 4.5 };
  const css = syntaxCss({ ...base, byLanguage: true, accent: false, overrides: { rust: { keyword: '#ff0000', nonsense: '#00ff00', string: 'red' }, 'bad"lang': { keyword: '#ff0000' } } });
  assert.match(css, /:where\(\[data-marxy-lang="rust"\]\) \{ --marxy-tok-keyword: #[0-9a-f]{6};/);
  assert.match(css, /:where\(\[data-marxy-lang="tsx"\]\)/);
  assert.match(css, /--marxy-tok-self: var\(--marxy-tok-keyword\);/);
  assert.match(css, /:root \[data-marxy-lang="rust"\]\[data-marxy-lang="rust"\] \{ --marxy-tok-keyword: #ff0000; \}/);
  assert.doesNotMatch(css, /nonsense|bad"lang|: red/);
  assert.doesNotMatch(css, /--marxy-lang:/);
  const off = syntaxCss({ ...base, byLanguage: false, accent: true, overrides: { rust: { keyword: '#ff0000' } } });
  assert.doesNotMatch(off, /--marxy-tok-/);
  assert.match(off, /:where\(\[data-marxy-lang="rust"\]\) \{ --marxy-lang: #[0-9a-f]{6}; \}/);
  assert.match(off, /\.marxy-fence-lang\[data-marxy-lang\]/);
});
