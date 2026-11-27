// The settings files as the app last wrote them this session (config.toml, a look's theme.css) and what each held just
// before, so a card can show the file with the lines the change made marked ("as it will be").
// Kept in memory only: nothing here is written, and a restart starts it empty.
import { diffLines } from '@marxy/core/src/diff/lines.ts';

const decoder = new TextDecoder();

export interface Written {
  readonly path: string;
  readonly text: string;
  /** Line indexes of `text` the last write put there. */
  readonly changed: ReadonlySet<number>;
}

const last = new Map<string, Written>();
const listeners = new Set<(path: string) => void>();

/** Notes a write of `after` over `before` at `path`, and tells the listeners. */
export function noteWritten(path: string, before: Uint8Array, after: Uint8Array): void {
  const text = decoder.decode(after);
  const changed = new Set<number>();
  for (const op of diffLines(decoder.decode(before), text) ?? []) {
    if (op.kind === 'insert') for (let i = op.bStart; i < op.bEnd; i++) changed.add(i);
  }
  last.set(path, { path, text, changed });
  for (const cb of [...listeners]) cb(path);
}

export const lastWritten = (path: string): Written | null => last.get(path) ?? null;

export function onWritten(cb: (path: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
