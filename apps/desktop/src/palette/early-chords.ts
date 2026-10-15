// The palette's summoning chords, heard before its code has loaded (F-111). The palette is its own chunk, read
// after first text, so for a moment `Mod+P`, `Mod+K`, `Mod+Shift+P` and `Mod+/` have no listener. This one is
// installed at launch, takes the press the way the palette would (so the browser or the editor never sees it),
// remembers each one, and hands them over when the palette mounts. Nothing here loads the palette.
import { paletteChordFor, type PaletteChord } from './chords.ts';

export interface HeldChords {
  /** Stops listening. Returns every chord pressed meanwhile, in order (none: empty). */
  release(): readonly PaletteChord[];
}

export function holdPaletteChords(): HeldChords {
  let held: PaletteChord[] = [];
  const onKey = (event: KeyboardEvent): void => {
    const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
    if (!(mac ? event.metaKey : event.ctrlKey) || event.altKey) return;
    const chord = paletteChordFor(event.key, event.shiftKey);
    if (!chord) return;
    event.preventDefault();
    if (chord.key === '/') event.stopPropagation();
    held.push(chord);
  };
  if (typeof window === 'undefined') return { release: () => [] };
  window.addEventListener('keydown', onKey, true);
  return {
    release() {
      window.removeEventListener('keydown', onKey, true);
      const chords = held;
      held = [];
      return chords;
    },
  };
}

/** What the palette opens on for a chord: the query it is summoned with (`undefined` is the document list). */
export function queryFor(chord: PaletteChord): string | undefined {
  return chord.opens === 'documents' ? undefined : chord.opens === 'transforms' ? '>Transform' : '>';
}

/** True when something other than the palette holds the screen: an open dialog or a modal (a sheet, the settings) that opened while the palette's chunk was on its way. */
export function modalOpenOutsidePalette(doc: Document = document): boolean {
  return doc.querySelector('dialog[open]:not(#marxy-palette), [aria-modal="true"]:not(#marxy-palette)') !== null;
}

/**
 * What the chords held before the palette mounted come to (W-13.2): each press does what it would have done with the
 * palette there, so two presses of `Mod+K` open it and shut it again. `null` is nothing open; otherwise the query it
 * stands open on (`undefined` is the document list). With a dialog or modal up, nothing is replayed.
 */
export function replayedOpening(chords: readonly PaletteChord[], modalOpen: boolean): { query: string | undefined } | null {
  if (modalOpen) return null;
  type Open = { query: string | undefined };
  let state = null as Open | null;
  for (const chord of chords) {
    const query = queryFor(chord);
    // The same rule as the live listener: a documents chord toggles; a commands chord closes only when already open on its query.
    const closes: boolean = state !== null && (chord.opens === 'documents' || state.query === query);
    state = closes ? null : { query };
  }
  return state;
}
