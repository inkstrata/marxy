// The reader's choice to read a database without its write-ahead log: kept in
// readings.json beside the colour choice, and said in the head as the reader's. Light: readings-file.ts reads it at launch.

const alone = new Set<string>();
const listeners = new Set<(path: string) => void>();

/** Whether the reader chose to read `path` without its log. */
export function readAlone(path: string): boolean {
  return alone.has(path);
}

export function setReadAlone(path: string, on: boolean): void {
  if (alone.has(path) === on) return;
  if (on) alone.add(path);
  else alone.delete(path);
  for (const cb of [...listeners]) cb(path);
}

export function onAloneChoice(cb: (path: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function aloneChoicesNow(): string[] {
  return [...alone].sort();
}

/** Replaces the choices with `paths` (readings.json as read at launch), but for the paths in `keep`, chosen since. */
export function restoreAloneChoices(paths: readonly string[], keep: ReadonlySet<string> = new Set()): void {
  const next = new Set(paths.filter((p) => !keep.has(p)));
  for (const p of keep) if (alone.has(p)) next.add(p);
  const changed = [...new Set([...alone, ...next])].filter((p) => alone.has(p) !== next.has(p));
  alone.clear();
  for (const p of next) alone.add(p);
  for (const p of changed) for (const cb of [...listeners]) cb(p);
}
