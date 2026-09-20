// Standard back/forward keys. The palette is the tab manager; these walk history (ADR-0011).

export type HistoryDirection = 'back' | 'forward';

/** The subset of a keyboard event the palette reads. */
export interface PaletteKey {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Map a key event to history travel. Cmd/Ctrl+[ and ] are the Mac and editor convention;
 * Alt+ArrowLeft/Right are the Windows/Linux browser convention. Plain arrows stay with the
 * document and with the palette list, so they are not history.
 */
export function historyDirection(event: PaletteKey): HistoryDirection | undefined {
  if (event.key === 'BrowserBack') return 'back';
  if (event.key === 'BrowserForward') return 'forward';
  if (event.shiftKey) return undefined;
  const chord = event.metaKey || event.ctrlKey;
  if (chord && !event.altKey) {
    if (event.key === '[') return 'back';
    if (event.key === ']') return 'forward';
  }
  if (event.altKey && !chord) {
    if (event.key === 'ArrowLeft') return 'back';
    if (event.key === 'ArrowRight') return 'forward';
  }
  return undefined;
}
