// Summoned palette: empty MRU, fuzzy typing, operations stub (design §07; ADR-0011).

import type { IndexEntry, IndexHit } from '@marxy/core';
import { jumpForHit, paletteResults, type PreparedIndex } from './search.ts';
import type { PaletteSession } from './session.ts';

/** Which slice of results the list shows while the reader types. */
export type PaletteListSection = 'documents' | 'headings' | 'operations';

/** Empty query, fuzzy hits, or the operations stub (MARXY-42 wires real ops later). */
export type PalettePhase = 'empty' | 'typing' | 'operations';

export const PALETTE_ROW_LIMIT = 12;

export interface PaletteModel {
  readonly phase: PalettePhase;
  readonly section: PaletteListSection;
  readonly query: string;
  readonly hits: readonly IndexHit[];
  readonly selected: number;
  readonly notice?: string;
}

export interface PaletteQueryInput {
  readonly query: string;
  readonly section: PaletteListSection;
  readonly entries: readonly IndexEntry[];
  readonly session: PaletteSession;
  readonly prepared?: PreparedIndex;
  readonly truncated?: boolean;
}

/** Derive phase from the query string and whether operations mode is active. */
export function palettePhase(query: string, section: PaletteListSection): PalettePhase {
  if (section === 'operations') return 'operations';
  const trimmed = query.trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.startsWith('>')) return 'operations';
  return 'typing';
}

/** Tab toggles documents ↔ headings while typing; operations is entered via `>` or Mod+P. */
export function toggleListSection(
  section: PaletteListSection,
  phase: PalettePhase,
): PaletteListSection {
  if (phase === 'operations' || section === 'operations') return section;
  return section === 'documents' ? 'headings' : 'documents';
}

/** Every keystroke queries; no debounce (design §07). */
export function queryPalette(input: PaletteQueryInput): PaletteModel {
  const raw = input.query;
  const phase = palettePhase(raw, input.section);
  if (phase === 'operations') {
    return {
      phase: 'operations',
      section: 'operations',
      query: raw,
      hits: [],
      selected: 0,
      notice: 'No operations yet',
    };
  }

  const query = raw.trim();
  const hits = paletteResults(query, input.entries, input.session, {
    prepared: input.prepared,
    limit: 50,
  });
  const filtered = filterHits(hits, phase === 'empty' ? 'documents' : input.section);
  const rows = filtered.slice(0, PALETTE_ROW_LIMIT);
  const notice =
    input.truncated === true
      ? 'Index limited to the 50,000 most recently changed files'
      : undefined;

  return {
    phase,
    section: phase === 'empty' ? 'documents' : input.section,
    query: raw,
    hits: rows,
    selected: 0,
    notice,
  };
}

function filterHits(hits: readonly IndexHit[], section: PaletteListSection): readonly IndexHit[] {
  if (section === 'headings') return hits.filter((hit) => hit.heading !== undefined);
  if (section === 'documents') return hits.filter((hit) => hit.heading === undefined);
  return hits;
}

/** Resolve navigation for Enter on the current row. Heading hits carry a byte offset. */
export function openHit(hit: IndexHit): ReturnType<typeof jumpForHit> {
  return jumpForHit(hit);
}

export { mountPalette, hasTabBar, createPaletteDocument, type PaletteViewState } from './view.ts';
