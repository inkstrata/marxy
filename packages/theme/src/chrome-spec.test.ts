// One chrome for every summoned surface and every menu (W-04): the rules of the raised surfaces, the menu rows and find
// carry no literal shadow colour, radius or font face. The numbers live once, in the `.marxy-surface` / `.marxy-menu-row` block
// of base.css, as ratios of the chrome size; the palette and outline sheets (runtime sheets in two TypeScript files) and the
// verb menu keep layout only. The computed half is apps/desktop/test/chrome-surfaces.test.mjs.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (rel: string): string => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule { readonly selector: string; readonly decls: ReadonlyMap<string, string> }

/** Every `selector { declarations }` in `css`, nested at-rules flattened. A naive reader, enough for these flat sheets. */
export function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  for (const m of strip(css).matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const d of m[2]!.matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)) decls.set(d[1]!, d[2]!.trim());
    out.push({ selector: m[1]!.trim().replace(/\s+/g, ' '), decls });
  }
  return out;
}

const CLASSES = [
  'marxy-surface', 'marxy-surface-md', 'marxy-surface-lg', 'marxy-menu-row', 'marxy-menu-key',
  'marxy-verb-menu', 'marxy-verb-menu-item', 'marxy-verb-menu-title', 'marxy-verb-menu-key',
  'marxy-find',
];
const RUNTIME_ROOTS = ['#marxy-palette', '#marxy-outline'];

/** True for a rule that styles one of the unified surfaces: any comma-separated selector naming one of those classes (whole class name) or a runtime root. */
function isChromeRule(selector: string): boolean {
  return selector.split(',').some((part) => {
    const s = part.trim();
    if (RUNTIME_ROOTS.some((root) => s === root || s.startsWith(`${root} `) || s.startsWith(`${root}:`) || s.startsWith(`${root}[`))) return true;
    return CLASSES.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(s));
  });
}

const LITERAL_COLOUR = /rgba?\(|hsla?\(|#[0-9a-f]{3,8}\b|\b(?:black|white)\b/i;
const OK_RADIUS = /^(?:0|0px|50%|calc\(var\(--marxy-size-chrome\) \* \d+ \/ 13\))$/;

/** What is wrong with the rules of the unified surfaces: a literal shadow colour, a radius that is not a ratio of the chrome size, a font face that is not the chrome's. */
export function chromeViolations(css: string, source: string): string[] {
  const bad: string[] = [];
  for (const { selector, decls } of rulesOf(css)) {
    if (!isChromeRule(selector)) continue;
    for (const [prop, value] of decls) {
      if (prop === 'box-shadow' && LITERAL_COLOUR.test(value)) bad.push(`${source}: ${selector} { box-shadow: ${value} } — a literal colour; the elevation is var(--marxy-shadow-surface)`);
      if (/^border(?:-[a-z]+)*-radius$/.test(prop) && !OK_RADIUS.test(value)) bad.push(`${source}: ${selector} { ${prop}: ${value} } — a radius is 6, 9 or 13 at 13 px chrome, as a ratio of --marxy-size-chrome`);
      if (prop === 'font-family' && !/^(?:var\(--marxy-face-chrome\)|inherit)$/.test(value)) bad.push(`${source}: ${selector} { font-family: ${value} } — the face is var(--marxy-face-chrome)`);
      if (prop === 'font' && !/^(?:inherit|var\(--marxy-size-chrome\) var\(--marxy-face-chrome\))$/.test(value)) bad.push(`${source}: ${selector} { font: ${value} } — the face is var(--marxy-face-chrome)`);
    }
  }
  return bad;
}

/** The CSS text of the runtime sheet a TypeScript file adopts. */
const sheetOf = (rel: string): string => /adoptRuntimeSheet\([^`]*`([\s\S]*?)`\s*\)/.exec(read(rel))?.[1] ?? '';

const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['packages/theme/src/base.css', read('packages/theme/src/base.css')],
  ['apps/desktop/src/palette/view.ts', sheetOf('apps/desktop/src/palette/view.ts')],
  ['apps/desktop/src/outline/view.ts', sheetOf('apps/desktop/src/outline/view.ts')],
];

test('the sources are found (a reader that finds nothing proves nothing)', () => {
  for (const [source, css] of SOURCES) assert.ok(rulesOf(css).filter((r) => isChromeRule(r.selector)).length >= 3, source);
});

test('no rule of the raised surfaces, menus or find has a literal shadow colour, a literal radius or its own font face', () => {
  const bad = SOURCES.flatMap(([source, css]) => chromeViolations(css, source));
  assert.deepEqual(bad, []);
});

test('the checker fails on the literals the surfaces carried before W-04', () => {
  const before = `
    #marxy-palette { border-radius: 8px; box-shadow: 0 12px 40px rgb(0 0 0 / 35%); }
    .marxy-verb-menu { font-family: var(--marxy-font-text); border-radius: var(--marxy-code-radius); box-shadow: 0 6px 24px rgb(0 0 0 / 18%); }
    .marxy-find { border-radius: 6px; box-shadow: 0 0.25rem 1.5rem rgb(0 0 0 / 25%); }
    #marxy-outline { box-shadow: 0 0 40px rgb(0 0 0 / 25%); }`;
  const bad = chromeViolations(before, 'before');
  assert.equal(bad.length, 8, bad.join('\n'));
});

test('the one block states the spec: the surface roles, the chrome face and size, three radii, and a row of 28 padded 5 by 10 with an 8 gap, all ratios of the chrome size', () => {
  const rules = rulesOf(read('packages/theme/src/base.css'));
  const of = (sel: string): ReadonlyMap<string, string> => {
    const found = rules.find((r) => r.selector.split(',').map((p) => p.trim()).includes(sel) && !r.decls.has('border-color'));
    assert.ok(found, `a rule for ${sel}`);
    return found.decls;
  };
  const surface = rules.filter((r) => r.selector.split(',').map((p) => p.trim()).includes('.marxy-surface') && !r.decls.has('border-color'));
  const merged = new Map(surface.flatMap((r) => [...r.decls]));
  assert.equal(merged.get('font-family'), 'var(--marxy-face-chrome)');
  assert.equal(merged.get('font-size'), 'var(--marxy-size-chrome)');
  assert.equal(merged.get('background'), 'var(--marxy-color-surface)');
  assert.equal(merged.get('box-shadow'), 'var(--marxy-shadow-surface)');
  assert.equal(merged.get('border-radius'), 'calc(var(--marxy-size-chrome) * 6 / 13)');
  assert.equal(of('.marxy-surface-md').get('border-radius'), 'calc(var(--marxy-size-chrome) * 9 / 13)');
  assert.equal(of('.marxy-surface-lg').get('border-radius'), 'calc(var(--marxy-size-chrome) * 13 / 13)');
  const row = of('.marxy-menu-row');
  assert.equal(row.get('min-height'), 'round(calc(var(--marxy-size-chrome) * 28 / 13), 1px)');
  assert.equal(row.get('padding'), 'calc(var(--marxy-size-chrome) * 5 / 13) calc(var(--marxy-size-chrome) * 10 / 13)');
  assert.equal(row.get('gap'), 'calc(var(--marxy-size-chrome) * 8 / 13)');
  assert.equal(of('.marxy-menu-key').get('margin-inline-start'), 'auto');
});

test('under forced-colors every surface keeps a CanvasText border and no shadow', () => {
  const css = strip(read('packages/theme/src/base.css'));
  const block = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const rule = rulesOf(block).find((r) => r.selector.includes('.marxy-surface'));
  assert.ok(rule, 'a forced-colors rule for the surfaces');
  for (const sel of ['.marxy-surface', '.marxy-verb-menu', '.marxy-find']) assert.ok(rule.selector.includes(sel), sel);
  assert.equal(rule.decls.get('border-color'), 'CanvasText');
  assert.equal(rule.decls.get('box-shadow'), 'none');
});

test('the toolbar draws its checked, pressed, disabled and focus states from the roles, not from ARIA alone', () => {
  const rules = rulesOf(read('packages/theme/src/base.css'));
  const sel = (needle: string): Rule => {
    const found = rules.find((r) => r.selector.includes(needle) && r.selector.includes('.marxy-toolbar'));
    assert.ok(found, needle);
    return found;
  };
  for (const needle of ['[aria-checked="true"]', '[aria-pressed="true"]']) {
    const rule = sel(needle);
    assert.equal(rule.decls.get('background'), 'var(--marxy-color-accent-wash)');
    assert.match(rule.decls.get('box-shadow') ?? '', /var\(--marxy-color-accent\)/, 'a line, not colour alone');
  }
  assert.equal(sel('[aria-disabled="true"]').decls.get('color'), 'var(--marxy-color-text-secondary)');
  assert.match(sel(':focus-visible').decls.get('outline') ?? '', /var\(--marxy-color-accent\)/);
  assert.equal(sel('[data-marxy-toolbar-item="title"]').decls.get('min-width'), '5em', 'the title keeps a minimum');
});
