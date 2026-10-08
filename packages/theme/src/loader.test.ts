// loadTheme warnings and clamping (docs/design/05-theme.md §Tests). MARXY-47.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTheme } from './loader.ts';

const loaderSrc = readFileSync(fileURLToPath(new URL('./loader.ts', import.meta.url)), 'utf8');

const dir = '/fixtures/quiet';

test('empty variants array is rejected with a warning naming the theme and file (MARXY-284)', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "bare"\ncontract = 1\nvariants = []\n')],
    ['theme.css', new TextEncoder().encode(':root { --marxy-measure: 68ch; }\n')],
  ]);
  const { manifest, warnings } = await loadTheme(
    dir,
    (rel) => Promise.resolve(files.get(rel)!),
    (p) => p,
  );
  assert.deepEqual(manifest.variants, ['dark', 'light']);
  assert.ok(warnings.some((w) => w.includes("Theme 'bare'") && w.includes('theme.toml')));
});

test('contract mismatch yields a warning and still loads css', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "c2"\ncontract = 2\nvariants = ["light"]\n')],
    ['theme.css', new TextEncoder().encode(':root { --marxy-measure: 68ch; }\n')],
  ]);
  const { manifest, css, warnings } = await loadTheme(
    dir,
    (rel) => {
      const b = files.get(rel);
      if (!b) throw new Error('missing');
      return Promise.resolve(b);
    },
    (p) => `asset://${p}`,
  );
  assert.equal(manifest.contract, 2);
  assert.match(css, /--marxy-measure/);
  assert.ok(warnings.some((w) => w.includes('contract 2')));
});

test('out-of-range measure is clamped with a warning', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "wide"\ncontract = 1\n')],
    ['theme.css', new TextEncoder().encode(':root { --marxy-measure: 120ch; }\n')],
  ]);
  const { css, warnings } = await loadTheme(
    dir,
    (rel) => Promise.resolve(files.get(rel)!),
    (p) => p,
  );
  assert.match(css, /--marxy-measure:\s*90ch/);
  assert.ok(warnings.some((w) => w.includes('clamped')));
});

test('remote url in theme css is stripped', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "net"\ncontract = 1\n')],
    ['theme.css', new TextEncoder().encode('x { background: url(https://evil.example/x); }\n')],
  ]);
  const { css, warnings } = await loadTheme(
    dir,
    (rel) => Promise.resolve(files.get(rel)!),
    (p) => p,
  );
  assert.doesNotMatch(css, /https:\/\/evil/);
  assert.ok(warnings.some((w) => w.includes('not loaded')));
});

test('an out-of-range measure in characters is clamped to 45–80 with a warning (ADR-0033)', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "wide"\ncontract = 1\n')],
    ['theme.css', new TextEncoder().encode(':root { --marxy-measure-chars: 120; }\n')],
  ]);
  const { css, warnings } = await loadTheme(
    dir,
    (rel) => Promise.resolve(files.get(rel)!),
    (p) => p,
  );
  assert.match(css, /--marxy-measure-chars:\s*80;/);
  assert.ok(warnings.some((w) => w.includes('--marxy-measure-chars')));
});

// 2026-09-26 review (MARXY-246).
async function cssOf(sheet: string): Promise<{ css: string; warnings: string[] }> {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "t"\ncontract = 1\n')],
    ['theme.css', new TextEncoder().encode(sheet)],
  ]);
  return loadTheme(dir, (rel) => Promise.resolve(files.get(rel)!), (p) => p);
}

test('clamping a value written without a semicolon keeps the closing brace', async () => {
  const { css } = await cssOf(':root{--marxy-measure: 40ch} p{color:red}');
  assert.equal(css, ':root{--marxy-measure: 45ch} p{color:red}');
});

test('applyTheme injects through adoptRuntimeSheet, not a <style> element', () => {
  assert.match(loaderSrc, /export function adoptRuntimeSheet/);
  assert.match(loaderSrc, /adoptRuntimeSheet\(doc, THEME_ID, css\)/);
  assert.doesNotMatch(loaderSrc, /createElement\s*\(\s*['"]style['"]\s*\)/);
});

test('rem is clamped as 16px, !important is kept, and calc() is dropped rather than misread', async () => {
  assert.match((await cssOf(':root{--marxy-size-body: 6rem;}')).css, /--marxy-size-body: 28px;/);
  assert.match((await cssOf(':root{--marxy-measure-chars: 200 !important;}')).css, /--marxy-measure-chars: 80 !important;/);
  const calc = await cssOf(':root{--marxy-line-box: calc(2px * 400);}');
  assert.doesNotMatch(calc.css, /--marxy-line-box/);
  assert.ok(calc.warnings.some((w) => /not a plain length/.test(w)));
});

test('a ch value on a px-bound property is dropped, not passed through unclamped', async () => {
  const { css, warnings } = await cssOf(':root{--marxy-line-box: 9999ch;}');
  assert.doesNotMatch(css, /--marxy-line-box/);
  assert.ok(warnings.some((w) => w.includes('--marxy-line-box') && w.includes('px units required')));
});

test('a px value on a ch-bound property is dropped, not passed through unclamped', async () => {
  const { css, warnings } = await cssOf(':root{--marxy-measure: 500px;}');
  assert.doesNotMatch(css, /--marxy-measure/);
  assert.ok(warnings.some((w) => w.includes('--marxy-measure') && w.includes('ch units required')));
});

test('a comment between a clamped property and its colon does not escape the clamp (MARXY-337)', async () => {
  for (const [prop, bad, kept] of [
    ['--marxy-size-body', '4px', '13px'],
    ['--marxy-line-box', '4px', '20px'],
    ['--marxy-measure', '4px', ''],
    ['--marxy-measure-chars', '200', '80'],
  ] as const) {
    for (const gap of ['/**/', ' /* c */ ', '/*a*//*b*/']) {
      const files = new Map<string, Uint8Array>([['theme.css', new TextEncoder().encode(`:root{${prop}${gap}:${bad}}`)]]);
      const { css } = await loadTheme(dir, (rel) => (files.has(rel) ? Promise.resolve(files.get(rel)!) : Promise.reject(new Error('x'))), (p) => p);
      assert.ok(!css.includes(`:${bad}}`), `${prop} ${JSON.stringify(gap)} -> ${css}`);
      if (kept !== '') assert.ok(css.includes(`${kept}`), css);
    }
  }
});

test('a raster data: url broken by a line break cannot carry a remote url past the loader (F-16)', async () => {
  const { css, warnings } = await cssOf(
    'x { background: url("data:image/png,(AA\n)}b{background:url(https://evil.example/p.png)}"); }\n',
  );
  assert.doesNotMatch(css, /evil\.example/);
  assert.ok(warnings.length >= 1);
});
