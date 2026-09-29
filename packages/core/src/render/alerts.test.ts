// GitHub alert blockquotes: run-in label, no marker text, no decorative colour (MARXY-234).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderSafeHtml } from './pipeline.ts';

const html = (markdown: string): string =>
  renderSafeHtml(markdown, { file: 'alerts.md' }).html.replace(/ data-marxy-[se]="[0-9]+"/g, '');

const TYPES = [
  ['NOTE', 'Note'],
  ['TIP', 'Tip'],
  ['IMPORTANT', 'Important'],
  ['WARNING', 'Warning'],
  ['CAUTION', 'Caution'],
] as const;

for (const [marker, word] of TYPES) {
  test(`${marker}: run-in label without the marker text`, () => {
    const out = html(`> [!${marker}]\n> Body.\n`);
    assert.match(out, new RegExp(`<strong>${word}</strong>`));
    assert.ok(!out.includes(`[!${marker}]`));
  });
}

test('a custom title replaces the type word in the label', () => {
  const out = html('> [!NOTE] Pay attention\n> Details.\n');
  assert.match(out, /<strong>Pay attention<\/strong>/);
  assert.ok(!/<strong>Note<\/strong>/.test(out));
  assert.ok(!out.includes('[!NOTE]'));
});

test('legacy bold Note syntax is left as authored', () => {
  const out = html('> **Note**\n> Legacy.\n');
  assert.match(out, /<strong>Note<\/strong>/);
  assert.ok(!out.includes('[!'));
});

test('alerts do not set colour, background, border or icon styles', () => {
  const out = html('> [!WARNING]\n> Careful.\n');
  assert.ok(!/style=/.test(out));
  assert.ok(!/<svg/.test(out));
  assert.ok(!/background|border|color:/i.test(out));
});

test('a soft break after inline nodes is kept; only the one after the marker is dropped', () => {
  const out = html('> [!NOTE] see [docs](u) now\n> hi\n');
  assert.match(out, /now\nhi/);
  assert.doesNotMatch(out, /nowhi/);
});
