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

/**
 * True when a history key belongs to something else: a handler that already claimed the event,
 * or a text field / editor, where Option+Arrow moves by word and Cmd+[ / ] indent. History travel
 * would otherwise swap the document away from under unsaved Source edits.
 */
export function historyKeyBelongsToEditor(
  event: { readonly defaultPrevented?: boolean; readonly target?: unknown },
  sourceVisible: boolean,
): boolean {
  if (event.defaultPrevented === true || sourceVisible) return true;
  const target = event.target as
    | { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown }
    | null
    | undefined;
  if (target === null || target === undefined || typeof target !== 'object') return false;
  // A dismissed palette keeps focus on its input; a field inside a closed <dialog> is typing nothing.
  if (typeof target.closest === 'function' && target.closest('dialog:not([open])') != null) return false;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable === true) return true;
  return typeof target.closest === 'function' && target.closest('.cm-content, .cm-editor') != null;
}
