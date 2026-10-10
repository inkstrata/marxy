// loadTheme warnings and clamping (docs/design/05-theme.md §Tests). MARXY-47.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { avgCharWarnings, loadTheme, V2_COLOUR_ROLES } from './loader.ts';

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

test('a contract above 2 yields a warning and still loads css', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "c3"\ncontract = 3\nvariants = ["light"]\n')],
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
  assert.equal(manifest.contract, 3);
  assert.match(css, /--marxy-measure/);
  assert.ok(warnings.some((w) => w.includes('targets contract 3; marxy speaks 2')));
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

// H-03: contract 2 (ADR-0059). The loader's half of the contract; tokens.css is the other.

const tokensCss = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');
const baseCss = readFileSync(fileURLToPath(new URL('./base.css', import.meta.url)), 'utf8');

/** `:root` custom properties as the cascade leaves them: later declarations win, var() resolves, a cycle is invalid (undefined). */
function resolveRoot(...sheets: string[]): (name: string) => string | undefined {
  const decls = new Map<string, string>();
  for (const sheet of sheets) {
    for (const m of sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--marxy-[\w-]+)\s*:\s*([^;}]+)/g)) decls.set(m[1]!, m[2]!.trim());
  }
  const resolve = (name: string, seen: readonly string[] = []): string | undefined => {
    const raw = decls.get(name);
    if (raw === undefined || seen.includes(name)) return undefined;
    let failed = false;
    const out = raw.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (_m, ref: string) => {
      const got = resolve(ref, [...seen, name]);
      if (got === undefined) failed = true;
      return got ?? '';
    });
    return failed ? undefined : out;
  };
  return (name) => resolve(name);
}

async function loadSheet(sheet: string, toml = 'name = "t"\ncontract = 2\nvariants = ["dark"]\n') {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode(toml)],
    ['theme.css', new TextEncoder().encode(sheet)],
  ]);
  return loadTheme(dir, (rel) => Promise.resolve(files.get(rel)!), (p) => p);
}

const V2_NAMES = [
  ...V2_COLOUR_ROLES,
  '--marxy-shadow-surface',
  '--marxy-face-book',
  '--marxy-face-article',
  '--marxy-face-sans',
  '--marxy-face-readme',
  '--marxy-face-mono',
  '--marxy-face-chrome',
  '--marxy-size-chrome',
];

test('tokens.css declares the 27 contract-2 names and the system-owned root copies (ADR-0059 items 1, 2, 7)', () => {
  assert.equal(V2_NAMES.length, 27);
  const get = resolveRoot(tokensCss);
  for (const name of V2_NAMES) assert.notEqual(get(name), undefined, `${name} is not declared and resolvable`);
  for (const name of ['size-body', 'size-code', 'size-caption', 'line-box', 'line-box-code', 'lh-h1', 'lh-h2']) {
    const root = get(`--marxy-root-${name}`);
    assert.equal(root, get(`--marxy-${name}`), `--marxy-root-${name} holds the :root value`);
    assert.match(tokensCss, new RegExp(`--marxy-root-${name}:\\s*var\\(--marxy-${name}\\)`));
  }
  assert.equal(get('--marxy-face-chrome'), 'system-ui, sans-serif');
  assert.equal(get('--marxy-size-chrome'), '13px');
  assert.equal(get('--marxy-shadow-surface'), 'none');
});

test('a theme-less page and the default theme resolve every v1 token alike, and no v1 token reads a v2 name', () => {
  const v1 = [...tokensCss.matchAll(/^\s*(--marxy-[\w-]+)\s*:\s*([^;]+);/gm)]
    .map((m) => ({ name: m[1]!, value: m[2]! }))
    .filter((d) => !V2_NAMES.includes(d.name) && !d.name.startsWith('--marxy-root-'));
  assert.ok(v1.length >= 55, `${v1.length} v1 tokens`);
  const bare = resolveRoot(tokensCss);
  const withDefault = resolveRoot(tokensCss, readFileSync(fileURLToPath(new URL('../default/theme.css', import.meta.url)), 'utf8').replace(/:root\[data-marxy-variant="light"\]\s*\{[^}]*\}/, ''));
  for (const { name, value } of v1) {
    assert.equal(withDefault(name), bare(name), name);
    assert.notEqual(bare(name), undefined, `${name} resolves`);
    assert.doesNotMatch(value, /--marxy-(?:root-|color-(?:surface|text-strong|text-faint|edge|accent-(?:strong|fg|wash)|status|rule-strong)|tok-(?:marker|heading|link)|face-|shadow-|size-chrome)/, `${name} reads a v2 name`);
  }
});

test('a contract-1 theme that sets only --marxy-color-text gets its own text colour as --marxy-color-text-strong', async () => {
  const sheet = ':root{--marxy-color-text:#102030;--marxy-color-text-secondary:#405060;--marxy-color-accent:#a0b0c0;--marxy-color-bg:#ffffff;}';
  const { css, warnings } = await loadSheet(sheet, 'name = "v1"\ncontract = 1\nvariants = ["dark"]\n');
  const get = resolveRoot(tokensCss, css);
  assert.equal(get('--marxy-color-text-strong'), '#102030');
  assert.equal(get('--marxy-color-text-faint'), '#405060');
  assert.equal(get('--marxy-color-accent-strong'), '#a0b0c0');
  assert.equal(get('--marxy-color-accent-fg'), '#ffffff');
  assert.equal(get('--marxy-tok-link'), '#a0b0c0');
  assert.ok(warnings.includes("Theme 'v1' targets contract 1; its contract-2 roles use their fallbacks."), warnings.join('\n'));
  assert.ok(!warnings.some((w) => w.includes('unset')), 'a contract-1 theme is not asked for the roles');
});

test('a contract-2 theme warns by name for each v2 colour role it leaves unset, per variant', async () => {
  const set = V2_COLOUR_ROLES.filter((r) => r !== '--marxy-color-edge' && r !== '--marxy-tok-link');
  const dark = `:root{${set.map((r) => `${r}:#123456;`).join('')}}`;
  const light = `:root[data-marxy-variant="light"]{${V2_COLOUR_ROLES.slice(0, 5).map((r) => `${r}:#654321;`).join('')}}`;
  const { warnings } = await loadSheet(dark + light, 'name = "two"\ncontract = 2\nvariants = ["dark", "light"]\n');
  const dk = warnings.find((w) => w.includes('in the dark variant'));
  assert.ok(dk?.includes('--marxy-color-edge') && dk.includes('--marxy-tok-link') && !dk.includes('--marxy-color-surface,'), dk);
  const lt = warnings.find((w) => w.includes('in the light variant'));
  assert.ok(lt?.includes('--marxy-color-edge') && lt.includes('--marxy-tok-link'), lt); // :root serves both variants
  const full = await loadSheet(`:root{${V2_COLOUR_ROLES.map((r) => `${r}:#123456;`).join('')}}`, 'name = "full"\ncontract = 2\nvariants = ["dark"]\n');
  assert.ok(!full.warnings.some((w) => w.includes('unset')), full.warnings.join('\n'));
});

test('a kind scope clamps the measure to 80 with a warning, and drops a global-only name with a warning naming it', async () => {
  const { css, warnings } = await loadSheet(
    ':root{--marxy-measure-chars:66}[data-marxy-kind="log"]{--marxy-measure-chars:120;--marxy-color-surface:#000000;--marxy-color-text:#ffffff}',
  );
  assert.match(css, /\[data-marxy-kind="log"\]\{--marxy-measure-chars:80;/);
  assert.doesNotMatch(css, /--marxy-color-surface/);
  assert.match(css, /--marxy-color-text:#ffffff/, 'a per-kind colour role stays');
  assert.ok(warnings.some((w) => w.includes('--marxy-measure-chars') && w.includes('clamped')), warnings.join('\n'));
  assert.ok(warnings.some((w) => w.includes('--marxy-color-surface') && w.includes("kind 'log'")), warnings.join('\n'));
  // the same name is fine on :root
  assert.match((await loadSheet(':root{--marxy-color-surface:#000000}')).css, /--marxy-color-surface:#000000/);
});

test('every global-only and system-owned name is dropped inside a kind scope', async () => {
  for (const name of [
    '--marxy-color-surface-glass', '--marxy-shadow-surface', '--marxy-face-chrome', '--marxy-size-chrome', '--marxy-color-divider',
    '--marxy-color-divider-focus', '--marxy-divider-hit', '--marxy-progress-rule', '--marxy-typeset', '--marxy-measure',
    '--marxy-weight-offset', '--marxy-lang', '--marxy-root-size-body',
  ]) {
    const { css, warnings } = await loadSheet(`[data-marxy-kind="book"][data-marxy-variant="light"]{${name}:1px}`);
    assert.ok(!css.includes(`${name}:`), name);
    assert.ok(warnings.some((w) => w.includes(name) && w.includes("kind 'book'")), name);
  }
});

test('a ratio for a size in a kind scope compiles to calc() over the root copy; an absolute length is rejected naming token and kind', async () => {
  const ok = await loadSheet('[data-marxy-kind="report"]{--marxy-size-body:0.85;--marxy-size-code:0.9em;--marxy-line-box:1.1}');
  assert.match(ok.css, /--marxy-size-body:calc\(0\.85 \* var\(--marxy-root-size-body\)\)/);
  assert.match(ok.css, /--marxy-size-code:calc\(0\.9 \* var\(--marxy-root-size-code\)\)/, 'em is compiled too, never reaching the DOM');
  assert.match(ok.css, /--marxy-line-box:round\(calc\(1\.1 \* var\(--marxy-root-line-box\)\), 2px\)/, 'a line box is rounded to an even pixel');
  assert.doesNotMatch(ok.css, /[\d.]em/);
  const big = await loadSheet('[data-marxy-kind="report"]{--marxy-size-body:3}');
  assert.match(big.css, /calc\(1\.4 \* var\(--marxy-root-size-body\)\)/);
  assert.ok(big.warnings.some((w) => w.includes('--marxy-size-body') && w.includes('clamped')));
  for (const bad of ['18px', '1.2rem', '66ch', 'calc(2px * 9)']) {
    const r = await loadSheet(`[data-marxy-kind="report"]{--marxy-size-body:${bad}}`);
    assert.doesNotMatch(r.css, /--marxy-size-body/, bad);
    assert.ok(r.warnings.some((w) => w.includes('--marxy-size-body') && w.includes("kind 'report'") && w.includes(bad)), `${bad}: ${r.warnings.join('|')}`);
  }
  // On :root the same names keep their v1 behaviour: px, clamped.
  assert.match((await loadSheet(':root{--marxy-size-body:40px}')).css, /--marxy-size-body:28px/);
});

test('a theme may not set the root copies anywhere', async () => {
  const { css, warnings } = await loadSheet(':root{--marxy-root-size-body:30px;--marxy-weight-offset:40}');
  assert.doesNotMatch(css, /--marxy-root-size-body|--marxy-weight-offset/);
  assert.equal(warnings.filter((w) => w.includes('cannot set it')).length, 2);
});

test('a slot pointed at a face role on :root alone is a theme error; in a kind scope it is valid', async () => {
  await assert.rejects(loadSheet(':root{--marxy-font-text:var(--marxy-face-sans)}'), /--marxy-font-text.*--marxy-face-sans/);
  await assert.rejects(loadSheet(':root[data-marxy-variant="light"]{--marxy-font-mono: var(--marxy-face-mono);}'), /--marxy-font-mono/);
  // the cycle is real: tokens.css derives the role from the slot
  assert.equal(resolveRoot(tokensCss, ':root{--marxy-font-text:var(--marxy-face-sans)}')('--marxy-font-text'), undefined);
  // set on :root, or in a kind scope, there is none
  assert.ok((await loadSheet(':root{--marxy-face-sans:"Inter",sans-serif;--marxy-font-text:var(--marxy-face-sans)}')).css);
  const kind = await loadSheet('[data-marxy-kind="report"]{--marxy-font-text:var(--marxy-face-sans)}');
  assert.match(kind.css, /--marxy-font-text:var\(--marxy-face-sans\)/);
});

test('the theme chrome size is held to 11-26 px', async () => {
  assert.match((await loadSheet(':root{--marxy-size-chrome:40px}')).css, /--marxy-size-chrome:26px/);
  assert.match((await loadSheet(':root{--marxy-size-chrome:8px}')).css, /--marxy-size-chrome:11px/);
});

test('the kind scope computes --marxy-measure where its own measure-chars apply; :root keeps the v1 declaration', () => {
  assert.match(tokensCss, /^\s*--marxy-measure:\s*calc\(var\(--marxy-measure-chars\) \* var\(--marxy-avg-char\) \* 1em\)/m);
  assert.match(baseCss, /\[data-marxy-kind\]\s*\{[^}]*--marxy-measure:\s*calc\(var\(--marxy-measure-chars\) \* var\(--marxy-avg-char\) \* 1em\)/);
});

test('a theme declaring 0.463 for a face that measures 0.52 warns once, naming theme, face and both numbers (H-06)', async () => {
  const css = ':root{--marxy-font-text:"Inter",sans-serif;--marxy-avg-char:0.463}';
  const warnings = await avgCharWarnings(css, 'sans', async (family) => (family.startsWith('"Inter"') ? 0.52 : null));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /Theme 'sans'.*0\.463.*Inter.*0\.52/);
});

test('a declared avg-char within 3 % of the measured one is silent; just past 3 % warns (H-06)', async () => {
  const css = (n: number) => `:root{--marxy-font-text:"Literata",serif;--marxy-avg-char:${n}}`;
  assert.deepEqual(await avgCharWarnings(css(0.463), 't', async () => 0.4725), []);
  assert.equal((await avgCharWarnings(css(0.463), 't', async () => 0.4775)).length, 1);
});

test('the avg-char warning follows a face role, and is silent without a number, a face or a measurement (H-06)', async () => {
  const roleCss = ':root{--marxy-face-article:"Source Serif 4",serif;--marxy-font-text:var(--marxy-face-article);--marxy-avg-char:0.4}';
  const seen: string[] = [];
  const w = await avgCharWarnings(roleCss, 't', async (f) => (seen.push(f), 0.5));
  assert.deepEqual(seen, ['"Source Serif 4",serif']);
  assert.equal(w.length, 1);
  assert.deepEqual(await avgCharWarnings(':root{--marxy-font-text:"X"}', 't', async () => 0.9), []);
  assert.deepEqual(await avgCharWarnings(':root{--marxy-avg-char:0.4}', 't', async () => 0.9), []);
  assert.deepEqual(await avgCharWarnings(':root{--marxy-font-text:"X";--marxy-avg-char:0.4}', 't', async () => null), []);
});

test('the avg-char check never rewrites the theme: loadTheme leaves the declared value as written (H-06)', async () => {
  const files = new Map<string, Uint8Array>([
    ['theme.toml', new TextEncoder().encode('name = "n"\ncontract = 2\n')],
    ['theme.css', new TextEncoder().encode(':root{--marxy-avg-char:0.9}')],
  ]);
  const { css } = await loadTheme(dir, (r) => Promise.resolve(files.get(r)!), (p) => p);
  assert.match(css, /--marxy-avg-char:0\.9\}/);
});
