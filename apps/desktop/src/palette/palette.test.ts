// Palette phases, Tab sections, and the operations stub (design §07).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IndexEntry } from '@marxy/core';
import { emptySession } from './session.ts';
import {
  palettePhase,
  queryPalette,
  toggleListSection,
  type PaletteListSection,
} from './palette.ts';

function entry(path: string, title: string): IndexEntry {
  return {
    path,
    root: '/repo',
    title,
    headings: [],
    mtimeMs: 1,
    size: 1,
    kind: 'markdown',
  };
}

test('operations mode shows a placeholder until MARXY-42', () => {
  const model = queryPalette({
    query: '> copy',
    section: 'operations',
    entries: [],
    session: emptySession('/repo'),
  });
  assert.equal(model.phase, 'operations');
  assert.equal(model.notice, 'No operations yet');
  assert.deepEqual(model.hits, []);
});

test('Tab toggles documents and headings while typing', () => {
  let section: PaletteListSection = 'documents';
  section = toggleListSection(section, 'typing');
  assert.equal(section, 'headings');
  section = toggleListSection(section, 'typing');
  assert.equal(section, 'documents');
  assert.equal(toggleListSection('operations', 'operations'), 'operations');
});

test('empty query is the empty phase; a `>` prefix is operations', () => {
  assert.equal(palettePhase('', 'documents'), 'empty');
  assert.equal(palettePhase('  ', 'documents'), 'empty');
  assert.equal(palettePhase('> run', 'documents'), 'operations');
});

test('typing query returns at most twelve rows', () => {
  const entries = Array.from({ length: 40 }, (_, i) =>
    entry(`/repo/f-${i}.md`, `Find me ${i}`),
  );
  const model = queryPalette({
    query: 'find',
    section: 'documents',
    entries,
    session: emptySession('/repo'),
  });
  assert.equal(model.phase, 'typing');
  assert.ok(model.hits.length <= 12);
});
