// layout.json envelope: the remembered split. Same version and quarantine discipline as positions.json:
// corrupt bytes are quarantined, a newer version is returned unchanged so the writer
// can refuse to overwrite it.

import { normalizePath } from '../index-model/paths.ts';
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
  /**
   * The window's row of tabs in order, each path once; every column's path is in it. A file written
   * before the row was kept has none: it is read as the columns' paths, which is the row their restore gave.
   */
  readonly tabs: readonly string[];
}

/** The most tabs kept: the window's own cap (apps/desktop frame/window-tabs.ts). */
export const LAYOUT_TABS_MAX = 48;

export type LoadLayoutResult =
  | { readonly kind: 'ok'; readonly envelope: LayoutEnvelope; readonly quarantineBytes?: Uint8Array }
  | { readonly kind: 'quarantined'; readonly envelope: LayoutEnvelope; readonly quarantineBytes: Uint8Array };

export function emptyLayoutEnvelope(): LayoutEnvelope {
  return { version: LAYOUT_FILE_VERSION, columns: [], ratio: DEFAULT_RATIO, focused: 0, tabs: [] };
}

/** The row as kept: `tabs` in order, each once, then any column's path it lacks; at most LAYOUT_TABS_MAX, columns kept. */
export function layoutTabs(tabs: readonly unknown[] | undefined, columns: readonly LayoutColumn[]): string[] {
  const out: string[] = [];
  for (const t of tabs ?? []) if (typeof t === 'string' && t !== '' && !out.includes(t)) out.push(t);
  for (const c of columns) if (!out.includes(c.path)) out.push(c.path);
  const shown = new Set(columns.map((c) => c.path));
  while (out.length > LAYOUT_TABS_MAX) {
    const i = out.findIndex((p) => !shown.has(p));
    if (i < 0) break;
    out.splice(i, 1);
  }
  return out;
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
      // Normalised: builds before the shell spelled Windows paths with slashes kept backslashes.
      columns.push({ path: normalizePath(e.path), mode: e.mode === 'source' ? 'source' : 'rendered' });
      if (columns.length === MAX_COLUMNS) break;
    }
  }

  const r = obj.ratio;
  const ratio = typeof r === 'number' && Number.isFinite(r) && r >= RATIO_MIN && r <= RATIO_MAX ? r : DEFAULT_RATIO;

  const f = obj.focused;
  const focusedRaw = typeof f === 'number' && Number.isFinite(f) ? Math.floor(f) : 0;
  const focused = Math.max(0, Math.min(focusedRaw, columns.length - 1));

  const version = obj.version > LAYOUT_FILE_VERSION ? obj.version : LAYOUT_FILE_VERSION;
  const tabs = layoutTabs(Array.isArray(obj.tabs) ? obj.tabs.map((t) => (typeof t === 'string' && t !== '' ? normalizePath(t) : t)) : undefined, columns);
  return { kind: 'ok', envelope: { version, columns, ratio, focused, tabs } };
}

export function serializeLayoutFile(envelope: LayoutEnvelope): Uint8Array {
  const body = JSON.stringify(envelope, null, 2);
  return new TextEncoder().encode(`${body}\n`);
}
