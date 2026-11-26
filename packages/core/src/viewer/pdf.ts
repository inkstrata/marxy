// A PDF's page: its pages laid down one column at a zoom, which of them are near the view, the
// place in it as a page and a fraction (so a zoom or a reload keeps it), the Document card's words from the file's own
// fields, the text Find reads and Export writes, and the ranges a read is cut into. Pure: pdf.js and the DOM are the
// app's (`apps/desktop/src/viewers/pdf.ts`).

/** CSS pixels to a PDF point at 100 %: a page is shown at its printed size. */
export const PX_PER_PT = 96 / 72;

/** The steps + and − move through; Fit width and Fit page may land between them. */
export const PDF_ZOOMS: readonly number[] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
export const PDF_ZOOM_MIN = PDF_ZOOMS[0]!;
export const PDF_ZOOM_MAX = PDF_ZOOMS[PDF_ZOOMS.length - 1]!;

/** The gap between pages and around the column, in CSS pixels. */
export const PAGE_GAP = 16;

export type PdfFit = 'width' | 'page';

const clampZoom = (z: number): number => Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, z));

/** The next step from `current` in `dir`, or the end of the steps. */
export function stepPdfZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return PDF_ZOOMS.find((z) => z > current + 1e-6) ?? PDF_ZOOM_MAX;
  return [...PDF_ZOOMS].reverse().find((z) => z < current - 1e-6) ?? PDF_ZOOM_MIN;
}

/** A page's size in points, as shown (its rotation applied). */
export interface PageSize {
  readonly w: number;
  readonly h: number;
}

/**
 * The zoom at which `page` fills the room: its width (`width`), or the whole page (`page`). `room` is the stage's inner
 * size in CSS pixels, less the gap around the column.
 */
export function fitZoom(fit: PdfFit, roomW: number, roomH: number, page: PageSize): number {
  if (page.w <= 0 || page.h <= 0) return 1;
  const w = Math.max(1, roomW - 2 * PAGE_GAP) / (page.w * PX_PER_PT);
  if (fit === 'width') return clampZoom(w);
  const h = Math.max(1, roomH - 2 * PAGE_GAP) / (page.h * PX_PER_PT);
  return clampZoom(Math.min(w, h));
}

/** The column at a zoom: each page's top and size in CSS pixels, and the column's height and width. */
export interface PageLayout {
  readonly tops: readonly number[];
  readonly widths: readonly number[];
  readonly heights: readonly number[];
  readonly height: number;
  readonly width: number;
}

export function layoutPages(sizes: readonly PageSize[], zoom: number): PageLayout {
  const tops: number[] = [];
  const widths: number[] = [];
  const heights: number[] = [];
  let y = PAGE_GAP;
  let width = 0;
  for (const s of sizes) {
    const w = Math.max(1, Math.round(s.w * PX_PER_PT * zoom));
    const h = Math.max(1, Math.round(s.h * PX_PER_PT * zoom));
    tops.push(y);
    widths.push(w);
    heights.push(h);
    y += h + PAGE_GAP;
    width = Math.max(width, w);
  }
  return { tops, widths, heights, height: y, width: width + 2 * PAGE_GAP };
}

/** The page (0-based) whose box holds `y`, or the last one starting above it; 0 above the first. */
export function pageAt(layout: PageLayout, y: number): number {
  const { tops } = layout;
  let lo = 0;
  let hi = tops.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The pages (0-based, inclusive) that touch the view from `top` for `height`, widened by `margin` on both sides. */
export function pagesNear(layout: PageLayout, top: number, height: number, margin: number): readonly [number, number] {
  const n = layout.tops.length;
  if (n === 0) return [0, -1];
  const first = pageAt(layout, top - margin);
  const last = pageAt(layout, top + height + margin);
  // The page above `top - margin` may end before it.
  const from = layout.tops[first]! + layout.heights[first]! < top - margin ? Math.min(n - 1, first + 1) : first;
  return [from, Math.max(from, last)];
}

/** A place in the column that survives a zoom and a reload: a page (0-based) and how far down it the line sits. */
export interface PdfPlace {
  readonly page: number;
  /** 0..1 of the page's height, at the line `lead` pixels below the view's top. */
  readonly fraction: number;
}

/** The place at the view's top (plus `lead`). */
export function placeAt(layout: PageLayout, scrollTop: number, lead = 0): PdfPlace {
  if (layout.tops.length === 0) return { page: 0, fraction: 0 };
  const y = scrollTop + lead;
  const page = pageAt(layout, y);
  const fraction = Math.min(1, Math.max(0, (y - layout.tops[page]!) / layout.heights[page]!));
  return { page, fraction };
}

/** The scroll offset that puts `place` back at the view's top (plus `lead`). */
export function scrollFor(layout: PageLayout, place: PdfPlace, lead = 0): number {
  const n = layout.tops.length;
  if (n === 0) return 0;
  const page = Math.min(n - 1, Math.max(0, place.page));
  return Math.max(0, Math.round(layout.tops[page]! + place.fraction * layout.heights[page]! - lead));
}

/** The page the bar names: the one holding the line a third of the way down the view. */
export function currentPage(layout: PageLayout, scrollTop: number, viewHeight: number): number {
  return pageAt(layout, scrollTop + viewHeight / 3);
}

/** "Page n" typed in the bar, as a 0-based page, or null when it names none. */
export function pageAsked(typed: string, count: number): number | null {
  const n = Number.parseInt(typed.trim(), 10);
  if (!Number.isFinite(n) || count === 0) return null;
  return Math.min(count, Math.max(1, n)) - 1;
}

// ---- the file's own fields ------------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A PDF date (`D:20250302180000+00'00'`, any tail missing) in the card's words: "2 Mar 2025, 18:00", with the zone it
 * was written in when it says one. Null for a field that is not a date.
 */
export function pdfDateWords(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(?:D:)?(\d{4})(\d\d)?(\d\d)?(\d\d)?(\d\d)?(\d\d)?\s*(Z|[+-]\d\d'?\d\d'?)?/.exec(raw.trim());
  if (!m) return null;
  const month = m[2] ? Number(m[2]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  const day = m[3] ? Number(m[3]) : null;
  const date = [day, month !== null ? MONTHS[month - 1] : null, m[1]].filter((x) => x !== null).join(' ');
  const time = m[4] ? `${m[4]}:${m[5] ?? '00'}` : '';
  const zone = !m[7] ? '' : m[7] === 'Z' || /^[+-]00'?00'?$/.test(m[7]) ? ' UTC' : ` UTC${m[7].replace(/'/g, '').replace(/^([+-]\d\d)(\d\d)$/, '$1:$2')}`;
  return time ? `${date}, ${time}${zone}` : date;
}

/** Paper sizes the card names, in millimetres (portrait). */
const PAPERS: readonly (readonly [string, number, number])[] = [
  ['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210], ['A6', 105, 148], ['B5', 176, 250],
  ['Letter', 216, 279], ['Legal', 216, 356], ['Tabloid', 279, 432],
];

/** A page size in the card's words: "148 × 210 mm, A5", "279 × 216 mm, Letter, landscape". */
export function paperWords(page: PageSize): string {
  const mm = (pt: number): number => Math.round((pt / 72) * 25.4);
  const w = mm(page.w);
  const h = mm(page.h);
  const [s, l] = w <= h ? [w, h] : [h, w];
  const named = PAPERS.find(([, a, b]) => Math.abs(a - s) <= 1 && Math.abs(b - l) <= 1);
  const name = named ? `, ${named[0]}${w > h ? ', landscape' : ''}` : '';
  return `${w} × ${h} mm${name}`;
}

/** What made the file, from its Creator and Producer fields: one when they say the same, both when they differ. */
export function madeByWords(creator: string | null | undefined, producer: string | null | undefined): string | null {
  const c = creator?.trim() || null;
  const p = producer?.trim() || null;
  if (c && p && c !== p) return `${c} · ${p}`;
  return c ?? p;
}

// ---- text: Find and Export ------------------------------------------------------------------------------------------

/** A piece of a page's text as pdf.js gives it: its string, and whether a line ends after it. */
export interface TextPiece {
  readonly str?: string;
  readonly hasEOL?: boolean;
}

/**
 * A page's text, as Find reads it: each piece's string, a line break after a piece that ends a line. The k-th piece that
 * has a string (the order pdf.js's text layer makes its spans in) runs from `starts[k]` to `ends[k]`, so a match maps
 * back to the spans it covers.
 */
export function pageText(pieces: readonly TextPiece[]): { readonly text: string; readonly starts: readonly number[]; readonly ends: readonly number[] } {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (const p of pieces) {
    if (p.str === undefined) continue;
    starts.push(text.length);
    text += p.str;
    ends.push(text.length);
    if (p.hasEOL) text += '\n';
  }
  return { text, starts, ends };
}

/** A match of Find: its page (0-based) and its span of that page's text. */
export interface PdfMatch {
  readonly page: number;
  readonly start: number;
  readonly end: number;
}

/** Every match of `re` in one page's text, in order; an empty match is skipped. `re` must be global. */
export function matchesIn(text: string, page: number, re: RegExp): PdfMatch[] {
  const out: PdfMatch[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    out.push({ page, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The pieces a match covers (indices into `starts` and `ends`), each with the part of its own string the match takes. */
export function piecesOf(starts: readonly number[], ends: readonly number[], start: number, end: number): { piece: number; from: number; to: number }[] {
  const out: { piece: number; from: number; to: number }[] = [];
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k]!;
    const e = ends[k]!;
    if (e <= start) continue;
    if (s >= end) break;
    const from = Math.max(start, s) - s;
    const to = Math.min(end, e) - s;
    if (to > from) out.push({ piece: k, from, to });
  }
  return out;
}

/** The text layer as plain text: pages separated by a form feed. */
export function pdfPlainText(pages: readonly string[]): string {
  return `${pages.map((p) => p.trimEnd()).join('\n\f\n')}\n`;
}

/** A line of PDF text that Markdown would read as markup is written so it reads as itself. */
function asMarkdownLine(line: string): string {
  const escaped = line.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);
  return escaped.replace(/^(\s*)(#{1,6}|[>+-]|\d+[.)])(?=\s|$)/, (_m, sp: string, mark: string) => `${sp}${mark.replace(/[#>+\-.)]/, (c) => `\\${c}`)}`);
}

/** The text as Markdown: the title as a heading, each page's lines as written, a rule between pages. */
export function pdfMarkdown(title: string | null, pages: readonly string[]): string {
  const head = title?.trim() ? `# ${asMarkdownLine(title.trim())}\n\n` : '';
  const body = pages.map((p) => p.trimEnd().split('\n').map(asMarkdownLine).join('\n')).join('\n\n---\n\n');
  return `${head}${body}\n`;
}

// ---- reading -------------------------------------------------------------------------------------------------------

/** `[begin, end)` cut into pieces of at most `max` bytes, for a shell that answers a range of at most that. */
export function rangePieces(begin: number, end: number, max: number): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (let at = begin; at < end; at += max) out.push([at, Math.min(end, at + max)]);
  return out;
}

// ---- the outline ---------------------------------------------------------------------------------------------------

/** An outline entry as pdf.js gives it: its title, where it goes, and the entries under it. */
export interface OutlineNode<D = unknown> {
  readonly title: string;
  readonly dest: D;
  readonly items: readonly OutlineNode<D>[];
}

/** The outline flattened in reading order, each entry with its depth; at most `max` entries, deeper ones first to go. */
export function flattenOutline<D>(items: readonly OutlineNode<D>[], max = 500, maxDepth = 6): { title: string; depth: number; dest: D }[] {
  const out: { title: string; depth: number; dest: D }[] = [];
  const walk = (nodes: readonly OutlineNode<D>[], depth: number): void => {
    for (const n of nodes) {
      if (out.length >= max) return;
      out.push({ title: n.title.replace(/\s+/g, ' ').trim() || 'Untitled', depth, dest: n.dest });
      if (depth + 1 < maxDepth && n.items.length > 0) walk(n.items, depth + 1);
    }
  };
  walk(items, 0);
  return out;
}
