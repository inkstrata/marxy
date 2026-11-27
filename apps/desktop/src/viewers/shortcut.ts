// A Windows shortcut's facts for the file card: its bytes are read once, parsed by core, and the card shows where it
// points. Nothing here follows the target or hands it to the system.
import { readShortcut, shortcutRows, SHORTCUT_READ_MAX } from '@marxy/core/src/viewer/shortcut.ts';
import type { AppShell } from '../app-types.ts';
import type { CardAbout } from './card.ts';
import type { ViewedFile } from './file.ts';

/** What the shortcut says, for the card, or why the card cannot show it (the same `why` the card says for a page it could not make). */
export async function openShortcutFor(shell: AppShell, file: ViewedFile): Promise<{ readonly about: CardAbout } | { readonly kicker: string; readonly line: string }> {
  let bytes: Uint8Array;
  try {
    bytes = await shell.readRange(file.path, 0, Math.min(file.size, SHORTCUT_READ_MAX));
  } catch {
    bytes = file.head;
  }
  const read = readShortcut(bytes);
  if (!read.ok) return { kicker: 'A shortcut the app cannot read', line: read.reason };
  return {
    about: {
      kicker: 'A Windows shortcut',
      rows: shortcutRows(read.facts),
      note: 'The app reads it and changes nothing. It shows where the shortcut points and never follows it; the bytes are beside it.',
      shownAs: 'a Windows shortcut · a file card and the bytes',
    },
  };
}
