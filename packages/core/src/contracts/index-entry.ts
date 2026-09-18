/** The index contract. FROZEN (ADR-0012). What the palette searches; never contents. */
export interface IndexEntry {
  readonly path: string;
  readonly root: string;
  readonly title: string;
  readonly headings: readonly { readonly level: number; readonly text: string; readonly byteOffset: number }[];
  readonly mtimeMs: number;
  readonly size: number;
  readonly lastReadMs?: number;
  readonly kind: 'markdown' | 'text' | 'source' | 'theme';
}
export interface IndexQuery { readonly text: string; readonly root?: string; readonly limit?: number; }
export interface IndexHit { readonly entry: IndexEntry; readonly heading?: number; readonly score: number; }
export const INDEX_LIMITS = { entriesPerRoot: 50_000, recentRoots: 12 } as const;
