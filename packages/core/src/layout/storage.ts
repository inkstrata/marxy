// layout.json envelope: the remembered split. Same version and quarantine discipline as positions.json
// (07 §4.6, §6.5): corrupt bytes are quarantined, a newer version is returned unchanged so the writer
// can refuse to overwrite it.

import { quarantinePathFor } from '../position/storage.ts';
import { DEFAULT_RATIO, MAX_COLUMNS } from './geometry.ts';

export { quarantinePathFor };

export const LAYOUT_FILE_VERSION = 1;
const RATIO_MIN = 0.2;
const RATIO_MAX = 0.8;

export interface LayoutColumn {
  readonly path: string;
  readonly mode: 'rendered' | 'source';
}

export interface LayoutEnvelope {
  readonly version: number;
  readonly columns: readonly LayoutColumn[];
  readonly ratio: number;
  readonly focused: number;
}

export type LoadLayoutResult =
  | { readonly kind: 'ok'; readonly envelope: LayoutEnvelope; readonly quarantineBytes?: Uint8Array }
  | { readonly kind: 'quarantined'; readonly envelope: LayoutEnvelope; readonly quarantineBytes: Uint8Array };

export function emptyLayoutEnvelope(): LayoutEnvelope {
  return { version: LAYOUT_FILE_VERSION, columns: [], ratio: DEFAULT_RATIO, focused: 0 };
}

export function parseLayoutFile(bytes: Uint8Array): LoadLayoutResult {
  const fresh = emptyLayoutEnvelope();
  const bad = (): LoadLayoutResult => ({ kind: 'quarantined', envelope: fresh, quarantineBytes: bytes.slice() });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return bad();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return bad();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return bad();
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== 'number' || !Number.isFinite(obj.version)) return bad();

  const columns: LayoutColumn[] = [];
  if (Array.isArray(obj.columns)) {
    for (const entry of obj.columns) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.path !== 'string') continue;
      columns.push({ path: e.path, mode: e.mode === 'source' ? 'source' : 'rendered' });
    }
    columns.length = Math.min(columns.length, MAX_COLUMNS);
  }

  const r = obj.ratio;
  const ratio = typeof r === 'number' && Number.isFinite(r) && r >= RATIO_MIN && r <= RATIO_MAX ? r : DEFAULT_RATIO;

  const f = obj.focused;
  const focusedRaw = typeof f === 'number' && Number.isFinite(f) ? Math.floor(f) : 0;
  const focused = Math.max(0, Math.min(focusedRaw, columns.length - 1));

  const version = obj.version > LAYOUT_FILE_VERSION ? obj.version : LAYOUT_FILE_VERSION;
  return { kind: 'ok', envelope: { version, columns, ratio, focused } };
}

export function serializeLayoutFile(envelope: LayoutEnvelope): Uint8Array {
  const body = JSON.stringify(envelope, null, 2);
  return new TextEncoder().encode(`${body}\n`);
}
