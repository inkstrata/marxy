// The guess mark of a pane as it stands: what the head names and the Reading card lists (model/guess.ts).
import { fileTypeFor } from '@marxy/core/src/kind/registry.ts';
import { readingOf } from '@marxy/core/src/reading/index.ts';
import { partsNow } from '../render/parts.ts';
import { kindLabel } from './model/facts.ts';
import { guessMark, guessPlaces, type GuessInput, type GuessMark, type GuessPlace } from './model/guess.ts';
import type { FramePane } from './types.ts';

/** The kinds a plain-text name is read by its shape for (core reading/index.ts PROSE_KINDS). */
const PROSE_KINDS = new Set(['article', 'notes', 'book', 'report', 'readme', 'docs', 'changelog']);

export function guessInputOf(pane: FramePane): GuessInput | null {
  const path = pane.path();
  const detected = pane.content.detected();
  const store = pane.content.store();
  if (path === null || !detected || !store) return null;
  const snap = store.snapshot();
  const bytes = snap.buffer.bytes;
  const reading = readingOf(path, bytes, pane.kind());
  const type = fileTypeFor(path);
  const family = type.kind === 'markdown' || type.reading === 'prose';
  const parts = !reading && store.parsed() ? partsNow(path, snap.ast, bytes) : [];
  return {
    detected,
    reading,
    family,
    markdownGuessed: !reading && type.reading === 'prose' && PROSE_KINDS.has(detected.kind),
    kindName: kindLabel(detected.kind, path),
    parts,
  };
}

export function guessMarkOf(pane: FramePane): GuessMark | null {
  const input = guessInputOf(pane);
  return input ? guessMark(input) : null;
}

export function guessPlacesOf(pane: FramePane): GuessPlace[] {
  const input = guessInputOf(pane);
  return input ? guessPlaces(input) : [];
}
