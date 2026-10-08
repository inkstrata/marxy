// The webview half of the tree watch (C-05): every shell watch emits on the one `fs-watch` channel,
// tagged with its table key, and each `Shell.watch` keeps only its own key's events.

import type { WatchEvent } from '@marxy/shell-api';

const KINDS: ReadonlySet<string> = new Set(['modified', 'created', 'removed', 'renamed']);

/**
 * The events of an `fs-watch` payload (`{ key, events }`) whose key is `key`, else `[]`. Anything
 * malformed yields nothing: a payload that is not that shape, and any event in it that is not a
 * `WatchEvent`.
 */
export function eventsForWatch(payload: unknown, key: string): WatchEvent[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const { key: from, events } = payload as { key?: unknown; events?: unknown };
  if (from !== key || !Array.isArray(events)) return [];
  const out: WatchEvent[] = [];
  for (const event of events as unknown[]) {
    if (typeof event !== 'object' || event === null) continue;
    const { kind, path, to } = event as { kind?: unknown; path?: unknown; to?: unknown };
    if (typeof kind !== 'string' || !KINDS.has(kind) || typeof path !== 'string') continue;
    if (to !== undefined && typeof to !== 'string') continue;
    out.push(to === undefined ? { kind: kind as WatchEvent['kind'], path } : { kind: kind as WatchEvent['kind'], path, to });
  }
  return out;
}

/**
 * The reason an `fs-watch` payload gives for ending the watch under `key` (`{ key, events: [],
 * refused }`), else undefined: another watch's payload, an ordinary batch, or anything malformed.
 */
export function refusalForWatch(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { key: from, refused } = payload as { key?: unknown; refused?: unknown };
  return from === key && typeof refused === 'string' ? refused : undefined;
}
