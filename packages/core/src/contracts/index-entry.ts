import type { Kind } from './kinds.ts';

/** The index contract. Reviewed contract (ADR-0012, ADR-0045): changes by pull request; limits are
 * tested in contracts.test.ts. What the palette searches; never contents. */
export interface IndexEntry {
  readonly path: string;
  readonly root: string;
  readonly title: string;
  readonly headings: readonly { readonly level: number; readonly text: string; readonly byteOffset: number }[];
  readonly mtimeMs: number;
  readonly size: number;
  readonly lastReadMs?: number;
  /** The file class the allow-list put it in (ADR-0012): what the walk and the content search decide on. */
  readonly kind: 'markdown' | 'text' | 'source' | 'theme';
  /**
   * How the file is read (ADR-0060), decided from its path alone (tiers 1 to 3), never from bytes; K-06. Not `kind`:
   * that names the file class above. Optional so a snapshot written before K-06 still loads; absent means not yet decided.
   */
  readonly readerKind?: Kind;
}
export interface IndexQuery { readonly text: string; readonly root?: string; readonly limit?: number; }
export interface IndexHit { readonly entry: IndexEntry; readonly heading?: number; readonly score: number; }
export const INDEX_LIMITS = { entriesPerRoot: 50_000, recentRoots: 12 } as const;
