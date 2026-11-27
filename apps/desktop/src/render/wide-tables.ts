// A table wider than its room never shows a number cut through: its box runs to the pane's edge through a column of
// words when enough of it shows, else ends between two columns; the side with more fades, and its own note line says how
// many columns are past the edge (a Markdown table's line under its rows, a reading's foot). A drawn diagram wider than its
// room scrolls in its own box and fades on the side with more. Measured when the page is set, when the pane resizes, and
// said again as the box scrolls sideways. None of it is the file's: the box is narrowed by a property and the words are
// drawn by CSS from an attribute (base.css).

const DIAGRAMS = '.marxy-diagram-scroll';
const DRAWABLE = 'pre[data-marxy-part="diagram"]';
const BOXES = `table:not(.marxy-reading-table), .marxy-reading-scroll, ${DIAGRAMS}`;
export const CUT = 'data-marxy-cut';
export const MORE = 'data-marxy-more';
export const MORE_COLS = 'data-marxy-more-cols';

/** A cell that reads as a figure: a number (signs, grouping, currency, percent, a unit), a date or time, or a size. */
const FIGURE = /^[-+−~<>≈]?[$€£¥]?\s?(\d[\d,._  ]*|\.\d+)\s?(%|[a-zA-Zµ]{1,4}(\/[a-zA-Z]{1,3})?)?$|^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[-+]\d{2}:?\d{2})?)?$|^\d{1,2}:\d{2}(:\d{2})?$/;
export const isFigure = (text: string): boolean => FIGURE.test(text.trim());

/** The least of a column of words, in px, worth showing at the room's edge rather than keeping it wholly past it. */
export const PART_SHOWN = 64;

/**
 * How wide a box may be. The whole room when the column crossing its edge is words (not `figures`, aligned to the end)
 * and at least PART_SHOWN of it shows; else the end of the last column within the room, or the room if none is.
 */
export function cutAt(ends: readonly number[], room: number, figures: readonly boolean[] = []): number {
  let cut = 0;
  let next = -1;
  for (let i = 0; i < ends.length; i++) {
    if (ends[i]! <= room + 0.5) cut = ends[i]!;
    else if (next < 0) next = i;
  }
  if (cut === 0) return room;
  if (next >= 0 && !figures[next] && room - cut >= PART_SHOWN) return Math.floor(room);
  return Math.floor(cut);
}

/** What the note line says: the columns past the right edge, else those before the left one, else nothing. */
export function moreWords(ends: readonly number[], left: number, width: number): string {
  const past = ends.filter((end) => end > left + width + 1).length;
  if (past > 0) return `${past} more column${past === 1 ? '' : 's'} →`;
  let before = 0;
  for (let i = 0; i < ends.length; i++) if ((i === 0 ? 0 : ends[i - 1]!) < left - 1) before++;
  return before > 0 ? `← ${before} column${before === 1 ? '' : 's'} before` : '';
}

/** The side or sides with more to scroll to. */
export function moreSides(left: number, max: number): 'start' | 'end' | 'both' | null {
  const start = left > 1;
  const end = left < max - 1;
  return start && end ? 'both' : start ? 'start' : end ? 'end' : null;
}

/**
 * Where each column ends, from the box's start edge (its left, or its right when it reads right to left) with no scroll, read from the row with the most cells near the top,
 * and which columns hold figures: set to the end, or every filled cell of the first data rows reads as a number, date or size
 * (Markdown figures are start-aligned unless the author asked otherwise).
 */
function columnsOf(box: HTMLElement): { ends: number[]; figures: boolean[] } {
  let row: HTMLTableRowElement | null = null;
  let seen = 0;
  for (const r of box.querySelectorAll('tr')) {
    if (!row || r.cells.length > row.cells.length) row = r;
    if (++seen >= 4) break;
  }
  if (!row) return { ends: [], figures: [] };
  const width = row.cells.length;
  const rows = [...box.querySelectorAll('tr')].slice(0, 9).filter((r) => r.cells.length === width && r.querySelector('td'));
  const edge = box.getBoundingClientRect();
  // Right to left, the first column is at the right and `scrollLeft` is zero there and negative as the box scrolls on.
  const rtl = getComputedStyle(box).direction === 'rtl';
  const origin = rtl ? edge.right - (box.offsetWidth - box.clientWidth - box.clientLeft) - box.scrollLeft : edge.left + box.clientLeft - box.scrollLeft;
  return {
    ends: [...row.cells].map((cell) => {
      const at = cell.getBoundingClientRect();
      return rtl ? origin - at.left : at.right - origin;
    }),
    figures: [...row.cells].map((_, i) => {
      if (rows[0] && /^(right|end)$/.test(getComputedStyle(rows[0].cells[i]!).textAlign)) return true;
      const filled = rows.map((r) => r.cells[i]!.textContent?.trim() ?? '').filter((t) => t !== '');
      return filled.length > 0 && filled.every(isFigure);
    }),
  };
}

/** The line a box's count is said on: a Markdown table's own, under its rows; a reading's foot. */
const noteOf = (box: HTMLElement): HTMLElement | null =>
  box.matches('table') ? box : (box.parentElement?.querySelector<HTMLElement>(':scope > .marxy-reading-foot') ?? null);

/** Diagrams last found scrolling, so a change either way is reported (the bar may take height). */
const scrolling = new WeakSet<HTMLElement>();
const endsOf = new WeakMap<HTMLElement, number[]>();

function say(box: HTMLElement, ends: readonly number[], left: number, width: number, max: number): void {
  const sides = moreSides(left, max);
  if (sides) box.setAttribute(MORE, sides);
  else box.removeAttribute(MORE);
  noteOf(box)?.setAttribute(MORE_COLS, moreWords(ends, left, width));
}

/**
 * Measures `boxes` in three steps, every write then every read then every write, so the page is laid out once: each box
 * wider than its room is cut at a column's end, the rest left as they are. Returns the boxes whose height may have moved.
 */
export function measureBoxes(boxes: readonly HTMLElement[]): HTMLElement[] {
  const had = boxes.map((box) => box.hasAttribute(CUT) || scrolling.has(box));
  for (const box of boxes) {
    box.removeAttribute(CUT);
    box.style.removeProperty('--marxy-table-cut');
  }
  const read = boxes.map((box) => {
    const room = box.clientWidth;
    if (room === 0 || box.scrollWidth <= room + 1) return null;
    const left = Math.abs(box.scrollLeft);
    if (box.matches(DIAGRAMS)) return { ends: [], figures: [], room, left, full: box.scrollWidth, drawing: true };
    const { ends, figures } = columnsOf(box);
    return ends.length < 2 ? null : { ends, figures, room, left, full: box.scrollWidth, drawing: false };
  });
  const moved: HTMLElement[] = [];
  boxes.forEach((box, i) => {
    const r = read[i];
    if (!r) {
      endsOf.delete(box);
      scrolling.delete(box);
      box.removeAttribute(MORE);
      noteOf(box)?.removeAttribute(MORE_COLS);
      if (had[i]) moved.push(box);
      return;
    }
    endsOf.set(box, r.ends);
    if (r.drawing) {
      say(box, r.ends, r.left, r.room, r.full - r.room);
      scrolling.add(box);
      if (!had[i]) moved.push(box);
      return;
    }
    const width = cutAt(r.ends, r.room, r.figures);
    box.setAttribute(CUT, '');
    box.style.setProperty('--marxy-table-cut', `${width}px`);
    say(box, r.ends, r.left, width, r.full - width);
    if (!had[i]) moved.push(box);
  });
  return moved;
}

/**
 * Keeps every wide table of `article` cut, faded and counted while the view lives. `changed` hears a table whose height
 * moved (its note line came or went), for the page's grid.
 */
export function installWideTables(article: HTMLElement, changed: (box: HTMLElement) => void): () => void {
  let frame = 0;
  let all = false;
  const added = new Set<HTMLElement>();
  const run = (): void => {
    frame = 0;
    const boxes = all ? [...article.querySelectorAll<HTMLElement>(BOXES)] : [...added].filter((box) => article.contains(box));
    all = false;
    added.clear();
    if (boxes.length === 0 || article.hidden || !article.isConnected) return;
    for (const box of measureBoxes(boxes)) changed(box);
  };
  const soon = (): void => {
    frame ||= requestAnimationFrame(run);
  };
  const onScroll = (e: Event): void => {
    const box = e.target;
    const ends = box instanceof HTMLElement ? endsOf.get(box) : undefined;
    if (box instanceof HTMLElement && ends) say(box, ends, Math.abs(box.scrollLeft), box.clientWidth, box.scrollWidth - box.clientWidth);
  };
  const again = (): void => {
    all = true;
    soon();
  };
  // Widths only: the article grows taller with every chunk, which moves no table's room.
  const widths = new WeakMap<Element, number>();
  const resized = new ResizeObserver((entries) => {
    let wider = false;
    for (const entry of entries) {
      // A diagram is drawn into its block after the page is set: any change of its size is measured again.
      if (entry.target instanceof HTMLElement && entry.target.matches(DRAWABLE)) {
        const scroller = entry.target.querySelector<HTMLElement>(DIAGRAMS);
        if (scroller) added.add(scroller);
        soon();
        continue;
      }
      if (widths.get(entry.target) !== entry.contentRect.width) wider = true;
      widths.set(entry.target, entry.contentRect.width);
    }
    if (wider) again();
  });
  resized.observe(article);
  for (const pre of article.querySelectorAll<HTMLElement>(DRAWABLE)) resized.observe(pre);
  const section = article.closest('section.marxy-pane');
  if (section) resized.observe(section);
  // A face arriving sets every cell again at its own widths.
  document.fonts?.addEventListener('loadingdone', again);
  // Only what a mount, a chunk or a reload put in is measured for it: a long page is not read again each chunk.
  const set = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(BOXES)) added.add(node);
        for (const box of node.querySelectorAll<HTMLElement>(BOXES)) added.add(box);
        if (node.matches(DRAWABLE)) resized.observe(node);
        for (const pre of node.querySelectorAll<HTMLElement>(DRAWABLE)) resized.observe(pre);
      }
    if (added.size > 0) soon();
  });
  set.observe(article, { childList: true });
  article.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    cancelAnimationFrame(frame);
    resized.disconnect();
    set.disconnect();
    document.fonts?.removeEventListener('loadingdone', again);
    article.removeEventListener('scroll', onScroll, { capture: true });
  };
}
