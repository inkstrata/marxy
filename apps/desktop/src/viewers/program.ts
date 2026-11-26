// A Windows program's claims for the file card: core reads them by range through the shell's readRange, and the card
// shows them as the file's own word. Nothing here starts, loads or verifies the file, and nothing asks the network.
import { programKicker, programRows, readProgram } from '@marxy/core/src/viewer/program.ts';
import type { AppShell } from '../app-types.ts';
import type { CardAbout } from './card.ts';
import type { ViewedFile } from './file.ts';

/**
 * What the program claims, for the card; why the card cannot show it; or `plain` when its bytes are not a program at all
 * (a text file renamed .exe), which is the plain file card.
 */
export async function openProgramFor(
  shell: AppShell,
  file: ViewedFile,
): Promise<{ readonly about: CardAbout } | { readonly why: { readonly kicker: string; readonly line: string } } | { readonly plain: true }> {
  const read = await readProgram((offset, length) => shell.readRange(file.path, offset, length), file.size);
  if (!read.ok) return read.notProgram ? { plain: true } : { why: { kicker: 'A program the app cannot read', line: read.reason } };
  return {
    about: {
      kicker: programKicker(read.facts),
      rows: programRows(read.facts),
      note: 'The app reads it and changes nothing. It shows what the file says of itself and never starts, loads or verifies it; the bytes are beside it.',
      shownAs: `${programKicker(read.facts).replace(/^A /, 'a ')} · a file card and the bytes`,
    },
  };
}
