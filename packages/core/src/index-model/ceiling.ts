// 50,000 entries per root; beyond that, keep newest by mtime and emit a summoned notice (ADR-0012).

import { INDEX_LIMITS } from '../contracts/index-entry.ts';

/** Palette-summoned notice. Not a standing banner — chrome at rest is zero. */
export interface IndexNotice {
  readonly kind: 'ceiling';
  readonly limit: number;
  readonly omitted: number;
}

export interface CeilingResult<T> {
  readonly kept: readonly T[];
  readonly notice?: IndexNotice;
}

/**
 * Caps a list at `INDEX_LIMITS.entriesPerRoot`, keeping the newest mtimes when it overflows.
 * The notice is data for the palette; this function never renders anything.
 */
export function applyCeiling<T extends { readonly mtimeMs: number }>(items: readonly T[]): CeilingResult<T> {
  const limit = INDEX_LIMITS.entriesPerRoot;
  if (items.length <= limit) return { kept: items };
  const ranked = items
    .map((item, order) => ({ item, order }))
    .sort((a, b) => b.item.mtimeMs - a.item.mtimeMs || a.order - b.order);
  const kept = ranked.slice(0, limit).map((row) => row.item);
  return {
    kept,
    notice: { kind: 'ceiling', limit, omitted: items.length - limit },
  };
}
