// A code file the reader put in Source: code lands in Read, and a reader who switched one to Source finds it there
// again. Set only by the reader's own switch (`RenderedViewDeps.modeChosen`), never by where a file landed, so a file
// opened before this choice existed lands as code does. Kept in readings.json (`source`); nothing here reads the file.
const chosen = new Set<string>();
const listeners = new Set<(path: string) => void>();

export function sourceChosen(path: string): boolean {
  return chosen.has(path);
}

export function setSourceChosen(path: string, on: boolean): void {
  if (chosen.has(path) === on) return;
  if (on) chosen.add(path);
  else chosen.delete(path);
  for (const cb of [...listeners]) cb(path);
}

export function onSourceChoice(cb: (path: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function sourceChoicesNow(): string[] {
  return [...chosen].sort();
}

/** Replaces the choices with `paths` (readings.json as read at launch), but for the paths in `keep`, chosen since. */
export function restoreSourceChoices(paths: readonly string[], keep: ReadonlySet<string> = new Set()): void {
  const next = new Set(paths.filter((p) => !keep.has(p)));
  for (const p of keep) if (chosen.has(p)) next.add(p);
  chosen.clear();
  for (const p of next) chosen.add(p);
}
