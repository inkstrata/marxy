// positions.json envelope: parse, LRU cap, version guard, corrupt quarantine.

import type { ReadingPosition } from '../contracts/position.ts';
import { normalizePath } from '../index-model/paths.ts';

export const POSITIONS_FILE_VERSION = 1;
export const POSITIONS_LRU_CAP = 5000;

export interface StoredPosition {
  readonly byteOffset: number;
  readonly fraction: number;
  readonly mode: ReadingPosition['mode'];
  /** Unix ms when this path was last read; drives LRU eviction. */
  readonly at: number;
  /**
   * What the bytes the offset counts were, for a place in a page made from the file rather than in the file itself (a
   * book's Markdown): the place stands only while the page is made the same. Absent for a text document.
   */
  readonly stamp?: string;
}

export interface PositionsEnvelope {
  readonly version: number;
  readonly positions: Record<string, StoredPosition>;
}

export type LoadPositionsResult =
  | { readonly kind: 'ok'; readonly envelope: PositionsEnvelope; readonly quarantineBytes?: Uint8Array }
  | { readonly kind: 'quarantined'; readonly envelope: PositionsEnvelope; readonly quarantineBytes: Uint8Array };

export function emptyPositionsEnvelope(): PositionsEnvelope {
  return { version: POSITIONS_FILE_VERSION, positions: {} };
}

export function parsePositionsFile(bytes: Uint8Array): LoadPositionsResult {
  const fresh = emptyPositionsEnvelope();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() };
  }
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'number') {
    return { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() };
  }
  const raw = (parsed as { positions?: unknown }).positions;
  if (raw !== undefined && (typeof raw !== 'object' || raw === null)) {
    return { kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() };
  }
  const positions: Record<string, StoredPosition> = {};
  if (raw && typeof raw === 'object') {
    for (const [path, entry] of Object.entries(raw as Record<string, unknown>)) {
      const stored = normalizeEntry(entry);
      // Builds before the shell spelled Windows paths with slashes kept backslash keys; the later read wins a clash.
      const key = normalizePath(path);
      if (stored && !(positions[key] && positions[key].at >= stored.at)) positions[key] = stored;
    }
  }
  const envelopeVersion = version > POSITIONS_FILE_VERSION ? version : POSITIONS_FILE_VERSION;
  return { kind: 'ok', envelope: { version: envelopeVersion, positions } };
}

function normalizeEntry(entry: unknown): StoredPosition | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.byteOffset !== 'number' || typeof e.fraction !== 'number') return null;
  if (e.mode !== 'rendered' && e.mode !== 'source') return null;
  const at = typeof e.at === 'number' ? e.at : Date.now();
  const fraction = Math.min(1, Math.max(0, e.fraction));
  const stamp = typeof e.stamp === 'string' && e.stamp.length <= 64 ? e.stamp : undefined;
  return stamp === undefined ? { byteOffset: e.byteOffset, fraction, mode: e.mode, at } : { byteOffset: e.byteOffset, fraction, mode: e.mode, at, stamp };
}

export function serializePositionsFile(envelope: PositionsEnvelope): Uint8Array {
  const body = JSON.stringify(envelope, null, 2);
  return new TextEncoder().encode(`${body}\n`);
}

export function upsertStoredPosition(
  envelope: PositionsEnvelope,
  path: string,
  entry: Omit<StoredPosition, 'at'> & { readonly at?: number },
): PositionsEnvelope {
  const at = entry.at ?? Date.now();
  const positions = { ...envelope.positions, [path]: { ...entry, at } };
  const keys = Object.keys(positions);
  if (keys.length <= POSITIONS_LRU_CAP) return { ...envelope, positions };
  const drop = keys
    .sort((a, b) => positions[a].at - positions[b].at)
    .slice(0, keys.length - POSITIONS_LRU_CAP);
  for (const key of drop) delete positions[key];
  return { ...envelope, positions };
}

/**
 * Whether a stored coordinate is still valid for a file of `byteLength` bytes; for a place in a page made from the file,
 * only when the page's `stamp` is the one stored with it.
 */
export function canRestoreStored(byteLength: number, stored: StoredPosition, stamp?: string): boolean {
  return byteLength >= stored.byteOffset && stored.stamp === stamp;
}

export function readingPositionFromStored(
  path: string,
  stored: StoredPosition,
): ReadingPosition {
  return {
    path,
    byteOffset: stored.byteOffset,
    fraction: stored.fraction,
    mode: stored.mode,
  };
}

/**
 * A state file's read failed because there is no file: the only failure that may start the store empty. Any other
 * (a permission error, a passing lock) leaves the reader's file as it is, read-only for the session.
 */
export const isNotFound = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'not-found';

export function quarantinePathFor(positionsPath: string, nowMs = Date.now()): string {
  return `${positionsPath}.bad-${nowMs}`;
}
