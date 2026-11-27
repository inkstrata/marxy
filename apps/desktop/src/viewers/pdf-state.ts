// What a PDF's page keeps while the app runs, and Find's matches over its pages. The place, the zoom and the card
// shown instead are kept per file in memory, as the archive page keeps its folds: a reload of the file or a tab opened
// on it again lands where the reader was. Never written: the fence holds (nothing kept of what was read).
import type { PdfFit, PdfMatch, PdfPlace } from '@marxy/core/src/viewer/pdf.ts';
import { pushAll } from '@marxy/core/src/util/spread.ts';

export interface KeptPdf {
  zoom: number;
  /** The fit the zoom follows as the pane is resized; null once the reader picks a zoom of their own. */
  fit: PdfFit | null;
  place: PdfPlace;
  /** The file card and the bytes are shown in place of the pages. */
  asCard: boolean;
}

const kept = new Map<string, KeptPdf>();
/** Files kept at once; the one longest unopened goes first. */
export const KEPT_MAX = 50;

/** The page's state for `path`: what was kept, or Fit width at the first page. */
export function keptPdf(path: string): KeptPdf {
  let k = kept.get(path);
  if (k) kept.delete(path);
  else k = { zoom: 1, fit: 'width', place: { page: 0, fraction: 0 }, asCard: false };
  kept.set(path, k);
  while (kept.size > KEPT_MAX) kept.delete(kept.keys().next().value!);
  return k;
}

/** Forgets every file's state (tests). */
export function forgetKeptPdfs(): void {
  kept.clear();
}

/** Find's matches, found a page at a time in page order. */
export class PdfMatches {
  readonly list: PdfMatch[] = [];
  /** Pages read so far; Find is done when it reaches the page count. */
  scanned = 0;

  readonly pages: number;

  constructor(pages: number) {
    this.pages = pages;
  }

  add(page: number, found: readonly PdfMatch[]): void {
    pushAll(this.list, found);
    this.scanned = Math.max(this.scanned, page + 1);
  }

  get done(): boolean {
    return this.scanned >= this.pages;
  }

  /** The first match on `page` or after it; with none, the first of all once every page is read, else -1 (not yet). */
  first(page: number): number {
    const at = this.list.findIndex((m) => m.page >= page);
    if (at >= 0) return at;
    return this.done && this.list.length > 0 ? 0 : -1;
  }

  /** The matches on one page, with their index in the whole list. */
  onPage(page: number): { readonly at: number; readonly match: PdfMatch }[] {
    const out: { at: number; match: PdfMatch }[] = [];
    this.list.forEach((match, at) => {
      if (match.page === page) out.push({ at, match });
    });
    return out;
  }
}
