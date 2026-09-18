// The palette is a summoned dialog. No tab bar exists in the DOM (ADR-0011).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry, IndexHit } from '@marxy/core';
import { createPaletteDocument, hasTabBar, mountPalette } from './view.ts';

function hit(
  path: string,
  title: string,
  heading?: { text: string; byteOffset: number },
): IndexHit {
  const entry: IndexEntry = {
    path,
    root: '/repo',
    title,
    headings: heading ? [{ level: 2, text: heading.text, byteOffset: heading.byteOffset }] : [],
    mtimeMs: 1,
    size: 1,
    kind: 'markdown',
  };
  return { entry, heading: heading ? 0 : undefined, score: 1 };
}

test('no tab bar exists when the palette is dismissed or summoned', () => {
  const doc = createPaletteDocument();
  const host = doc.createElement('body');
  const view = mountPalette(host, doc, { open: false, query: '', hits: [], selected: 0 });

  assert.equal(view.root.getAttribute('role'), 'dialog');
  assert.equal(view.root.getAttribute('hidden'), '');
  assert.equal(hasTabBar(host), false);
  assert.equal(host.querySelector('[role="tablist"]'), null);
  assert.equal(host.querySelector('[role="tab"]'), null);
  assert.equal(host.querySelector('[data-tab-bar]'), null);
  assert.equal(host.querySelector('.tab-bar'), null);
  assert.equal(host.querySelector('#tab-bar'), null);

  view.update({
    open: true,
    query: 'accept',
    hits: [hit('/repo/long.md', 'Long', { text: 'Acceptance', byteOffset: 240 })],
    selected: 0,
  });

  assert.equal(view.root.getAttribute('hidden'), null);
  assert.equal(host.querySelector('[data-marxy-palette]')?.getAttribute('role'), 'dialog');
  assert.equal(host.querySelector('[role="listbox"]')?.tagName, 'OL');
  assert.equal(
    host.querySelector('[data-heading-offset]')?.getAttribute('data-heading-offset'),
    '240',
  );
  assert.equal(hasTabBar(host), false);
  assert.equal(host.querySelector('[role="tablist"]'), null);
  assert.equal(host.querySelector('[role="tab"]'), null);
  assert.equal(host.querySelectorAll('[role="tab"]').length, 0);

  view.destroy();
  assert.equal(host.querySelector('[data-marxy-palette]'), null);
  assert.equal(hasTabBar(host), false);
});
