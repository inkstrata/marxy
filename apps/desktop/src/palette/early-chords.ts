// The palette's summoning chords, heard before its code has loaded (F-111). The palette is its own chunk, read
// after first text, so for a moment `Mod+P`, `Mod+K`, `Mod+Shift+P` and `Mod+/` have no listener. This one is
// installed at launch, takes the press the way the palette would (so the browser or the editor never sees it),
// remembers the last one, and hands it over when the palette mounts. Nothing here loads the palette.
import { paletteChordFor, type PaletteChord } from './chords.ts';

export interface HeldChords {
  /** Stops listening. Returns the chord pressed meanwhile, or null. */
  release(): PaletteChord | null;
}

export function holdPaletteChords(): HeldChords {
  let held: PaletteChord | null = null;
  const onKey = (event: KeyboardEvent): void => {
    const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
    if (!(mac ? event.metaKey : event.ctrlKey) || event.altKey) return;
    const chord = paletteChordFor(event.key, event.shiftKey);
    if (!chord) return;
    event.preventDefault();
    if (chord.key === '/') event.stopPropagation();
    held = chord;
  };
  if (typeof window === 'undefined') return { release: () => null };
  window.addEventListener('keydown', onKey, true);
  return {
    release() {
      window.removeEventListener('keydown', onKey, true);
      const chord = held;
      held = null;
      return chord;
    },
  };
}

/** What the palette opens on for a chord: the query it is summoned with (`undefined` is the document list). */
export function queryFor(chord: PaletteChord): string | undefined {
  return chord.opens === 'documents' ? undefined : chord.opens === 'transforms' ? '>Transform' : '>';
}
