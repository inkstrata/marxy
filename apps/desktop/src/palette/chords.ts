// The palette's summoning chords (W-19), in one place so the listener in view.ts and the keys table
// (test/keys-table.test.mjs) read the same list. `documents` opens on the document list; `commands` on
// `>` and `transforms` on `>Transform` (W-21).
export interface PaletteChord {
  /** The registry spelling, as a command's `key` is written. */
  readonly spec: string;
  /** Lower-case `event.key`. */
  readonly key: string;
  readonly shift: boolean;
  readonly opens: 'documents' | 'commands' | 'transforms';
}

export const PALETTE_CHORDS: readonly PaletteChord[] = [
  { spec: 'Mod+P', key: 'p', shift: false, opens: 'documents' },
  { spec: 'Mod+K', key: 'k', shift: false, opens: 'documents' },
  { spec: 'Mod+Shift+P', key: 'p', shift: true, opens: 'commands' },
  { spec: 'Mod+/', key: '/', shift: false, opens: 'transforms' },
];

export function paletteChordFor(key: string, shift: boolean): PaletteChord | undefined {
  return PALETTE_CHORDS.find((c) => c.key === key.toLowerCase() && c.shift === shift);
}
