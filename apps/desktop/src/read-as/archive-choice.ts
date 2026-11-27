// A book read as the archive it is packed in (Read as › An archive): the zip's page in place of the book's. The choice
// is the file's, so every pane showing it reads it alike; it lasts while the app runs, as the bytes floor a page of the
// app's own keeps does, and is never written. Nothing here reads the file.
import { fileTypeFor } from '@marxy/core/src/kind/registry.ts';

const chosen = new Set<string>();

/** Whether `path` is read as a book by default and can be read as its archive instead: an EPUB. */
export const readsAsArchive = (path: string): boolean => fileTypeFor(path).viewer === 'book';

export function archiveChosen(path: string): boolean {
  return chosen.has(path) && readsAsArchive(path);
}

export function setArchiveChosen(path: string, on: boolean): void {
  if (on) chosen.add(path);
  else chosen.delete(path);
}
