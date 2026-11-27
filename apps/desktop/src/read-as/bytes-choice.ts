// A text file read as its bytes (Read as › Bytes): the floor chosen for a file that has a reading. Kept in
// readings.json (`bytes`) beside the other reading choices; the choice is the file's, so every pane showing it reads it
// alike. A file with no reading is its bytes already and needs no choice. Nothing here reads the file.
const chosen = new Set<string>();
const listeners = new Set<(path: string) => void>();

export function bytesChosen(path: string): boolean {
  return chosen.has(path);
}

export function setBytesChosen(path: string, on: boolean): void {
  if (chosen.has(path) === on) return;
  if (on) chosen.add(path);
  else chosen.delete(path);
  for (const cb of [...listeners]) cb(path);
}

export function onBytesChoice(cb: (path: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function bytesChoicesNow(): string[] {
  return [...chosen].sort();
}

/** Replaces the choices with `paths` (readings.json as read at launch), but for the paths in `keep`, chosen since. */
export function restoreBytesChoices(paths: readonly string[], keep: ReadonlySet<string> = new Set()): void {
  const next = new Set(paths.filter((p) => !keep.has(p)));
  for (const p of keep) if (chosen.has(p)) next.add(p);
  chosen.clear();
  for (const p of next) chosen.add(p);
}
