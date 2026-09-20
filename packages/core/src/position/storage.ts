// positions.json envelope: parse, LRU cap, version guard, corrupt quarantine (design §08, §11).

import type { ReadingPosition } from '../contracts/position.ts';

export const POSITIONS_FILE_VERSION = 1;
export const POSITIONS_LRU_CAP = 5000;

export interface StoredPosition {
  readonly byteOffset: number;
  readonly fraction: number;
  readonly mode: ReadingPosition['mode'];
  /** Unix ms when this path was last read; drives LRU eviction. */
  readonly at: number;
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
      if (stored) positions[path] = stored;
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
  return { byteOffset: e.byteOffset, fraction, mode: e.mode, at };
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

/** Whether a stored coordinate is still valid for a file of `byteLength` bytes. */
export function canRestoreStored(byteLength: number, stored: StoredPosition): boolean {
  return byteLength >= stored.byteOffset;
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

export function quarantinePathFor(positionsPath: string, nowMs = Date.now()): string {
  return `${positionsPath}.bad-${nowMs}`;
}
