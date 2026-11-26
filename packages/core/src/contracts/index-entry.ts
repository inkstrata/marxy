import type { Kind } from './kinds.ts';

/** The index contract. Reviewed contract; limits are
 * tested in contracts.test.ts. What the palette searches; never contents. */
export interface IndexEntry {
  readonly path: string;
  readonly root: string;
  readonly title: string;
  readonly headings: readonly { readonly level: number; readonly text: string; readonly byteOffset: number }[];
  readonly mtimeMs: number;
  readonly size: number;
  readonly lastReadMs?: number;
  /** The file class the registry puts it in: what the walk and the content search decide on. Every file is
   * listed; a `binary` one is never read by Find. */
  readonly kind: 'markdown' | 'text' | 'source' | 'theme' | 'binary';
  /**
   * How the file is read, decided from its path alone (tiers 1 to 3), never from bytes. Not `kind`:
   * that names the file class above. Optional so a snapshot written before it still loads; absent means not yet decided.
   */
  readonly readerKind?: Kind;
}
export interface IndexQuery { readonly text: string; readonly root?: string; readonly limit?: number; }
export interface IndexHit { readonly entry: IndexEntry; readonly heading?: number; readonly score: number; }
export const INDEX_LIMITS = { entriesPerRoot: 50_000, recentRoots: 12 } as const;
