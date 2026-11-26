// A bundled theme is one definition: each sheet under packages/theme/<theme>/ is what
// scripts/write-theme-sheets.mjs writes from its look, and Night and Paper's look carries the values of the hand-written
// base sheet, default/theme.css. Run `node packages/theme/scripts/write-theme-sheets.mjs` after changing a look.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SHEET_LOOKS, manifestFor, sheetFor } from '../scripts/write-theme-sheets.mjs';
import { LOOKS } from '../src/looks.ts';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('every bundled sheet is what its look writes', () => {
  assert.ok(SHEET_LOOKS.length >= 9, String(SHEET_LOOKS.length));
  for (const look of SHEET_LOOKS) {
    assert.equal(read(`${look.theme}/theme.css`), sheetFor(look), `${look.theme}/theme.css: run node packages/theme/scripts/write-theme-sheets.mjs`);
    assert.equal(read(`${look.theme}/theme.toml`), manifestFor(look), `${look.theme}/theme.toml`);
  }
});

const ROLE = {
  bg: 'bg', text: 'text', 'text-strong': 'strong', 'text-secondary': 'second', 'text-faint': 'faint', accent: 'accent', 'accent-strong': 'accentStrong',
  'accent-fg': 'accentFg', 'accent-wash': 'wash', rule: 'rule', 'rule-strong': 'ruleStrong', edge: 'edge', 'quote-rule': 'quoteRule', surface: 'surface',
  'surface-glass': 'glass', 'code-bg': 'codeBg', 'code-text': 'codeText', selection: 'selection', find: 'find', 'find-current': 'findCurrent',
  'find-edge': 'findEdge', 'status-ok': 'ok', 'status-warn': 'warn', 'status-err': 'err', 'status-ok-wash': 'okWash', 'status-warn-wash': 'warnWash',
  'status-err-wash': 'errWash', 'diff-add': 'diffAdd', 'diff-del': 'diffDel', 'diff-add-word': 'diffAddWord', 'diff-del-word': 'diffDelWord',
};
function declarations(css, selector) {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').split(selector)[1]?.split('}')[0] ?? '';
  return Object.fromEntries([...body.matchAll(/(--marxy-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

test('Night and Paper’s look carries the hand-written base sheet’s colours, night and day', () => {
  const look = LOOKS.find((l) => l.id === 'night-paper');
  const css = read('default/theme.css');
  for (const [scheme, selector] of [['night', ':root {'], ['day', ':root[data-marxy-variant="light"] {']]) {
    const d = declarations(css, selector);
    const pins = look.pins[scheme];
    for (const [k, v] of Object.entries(d)) {
      if (k.startsWith('--marxy-color-')) {
        const role = ROLE[k.slice(14)];
        if (!role || v.startsWith('var(')) continue;
        assert.equal(pins[role], v, `${scheme} ${k}`);
      } else if (k.startsWith('--marxy-tok-') && !v.startsWith('var(')) assert.equal(pins.tok[k.slice(12)], v, `${scheme} ${k}`);
    }
  }
});
