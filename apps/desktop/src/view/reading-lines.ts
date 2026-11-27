// A big log, text or code file in Read, as lines (core's `reading/lines.ts`): only the lines on screen and a screen either
// side are on the page, between a gap above and a gap below that stand for the rest at their height, so the page holds a
// few hundred rows however long the file, and a resize or a scroll restyles those rows, never the whole file. The same way
// as a long table's rows (`reading-rows.ts`), with one difference: a line wraps under itself, so rows differ in height.
// A line's height is worked out from its length and the column's width in characters, and corrected once it is drawn.
//
// Find and the level filter go through every line of the file, a slice at a time, the loop given back between slices.
// They change only the view: no byte of the file moves.
import { yieldToMain } from '../scheduler/index.ts';
import {
  LineHeights,
  lineOfByte,
  lineRanks,
  lineText,
  lineHtml,
  lineWindow,
  LINES_MAX_PX,
  rowAtScroll,
  scrollForLine,
  wrapRows,
  type ReadingLines,
} from '@marxy/core/src/reading/lines.ts';
import type { Pace } from '@marxy/core/src/data/table-view.ts';
import { scanHeadings, type ScannedHeadings } from '@marxy/core/src/reading/heading-scan.ts';
import { readingLine } from '@marxy/core/src/position/blocks.ts';
import type { ViewerFind } from '../viewers/types.ts';

/** A slice of finding or ranking holds the main thread about this long. */
const SLICE_MS = 8;
/** A slice of the heading scan holds the main thread about this long: under a long task, and few of them. */
const SCAN_SLICE_MS = 40;
/** Lines drawn past each edge of the screen. */
const OVERSCAN = 40;
/** Lines left past an edge before the window is drawn again further on. */
const MARGIN = 10;

/** A slice of work gives the loop back: the reader asked for what is being done. */
const yieldNow = (): Promise<void> => yieldToMain('input');

class Ints {
  data = new Int32Array(1024);
  length = 0;
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
}

/** The lines on the page: what find, the level filter and the reading place ask of them. */
export interface LinesView {
  readonly lines: ReadingLines;
  /** Always: the lines near the screen are all that is on the page. */
  windowed(): boolean;
  /** The line holding `byte` drawn where the page's scroll puts it, so the page can be scrolled to it. */
  ensureThrough(byte: number): void;
  /** The line holding `byte` drawn and brought to the reading line. */
  showByte(byte: number): void;
  /**
   * Keeps the lines ranked `min` and above (0 keeps every line); resolves how many it hides, or null when overtaken. The
   * page goes to its top, unless `keep`: then the line at the screen's top stays there, or the first kept after it.
   */
  setLevel(min: number, progress?: (fraction: number) => void, keep?: boolean): Promise<{ readonly hidden: number; readonly total: number } | null>;
  /** The level kept now: 0 for every line. */
  level(): number;
  /** Stops a change of level still reading the ranks: the level stays what it was. */
  cancel(): void;
  /** Find over every line the view keeps. */
  readonly find: ViewerFind;
  destroy(): void;
}

const views = new WeakMap<Element, LinesView>();

/** Who waits on each Markdown file's heading scan: one scan per index, whoever asked first. */
const scans = new WeakMap<ReadingLines, Set<() => void>>();
/** How many pages show each index now: a scan started under a page stops once none does. */
const shown = new WeakMap<ReadingLines, number>();

/**
 * A Markdown file's headings read as lines, scanned from its lines a slice at a time (`heading-scan.ts`): null until they
 * are, and `ready` is called then. The page starts the scan once its first lines are drawn, so the Outline usually finds
 * it made. A scan started while a page showed the lines stops when the last such page goes, its listeners with it; the
 * next ask starts it again. The result, once made, is kept on the index.
 */
export function markdownHeadings(lines: ReadingLines, ready?: () => void): ScannedHeadings | null {
  if (lines.headings) return lines.headings;
  let waiting = scans.get(lines);
  if (!waiting) {
    const heard = new Set<() => void>();
    waiting = heard;
    scans.set(lines, heard);
    const underPage = (shown.get(lines) ?? 0) > 0;
    const aborted = (): boolean => scans.get(lines) !== heard || (underPage && (shown.get(lines) ?? 0) === 0);
    // Longer slices than find's: the whole scan is a few hundred milliseconds of work, and each slice given back waits
    // behind whatever else the open set going, so short ones made it several times slower.
    void scanHeadings(lines, { yieldNow, budgetMs: SCAN_SLICE_MS, aborted }).then((made) => {
      if (scans.get(lines) === heard) scans.delete(lines);
      if (made) for (const cb of [...heard]) cb();
      heard.clear();
    });
  }
  if (ready) waiting.add(ready);
  return null;
}

/** The lines view in `article`, if its page is lines. */
export function linesViewIn(article: Element): LinesView | null {
  const body = article.querySelector('[data-marxy-lines]');
  return body ? (views.get(body) ?? null) : null;
}

export interface LinesOptions {
  readonly lines: ReadingLines;
  /** The element the rows are drawn in (`[data-marxy-lines]`). */
  readonly body: HTMLElement;
  /** The element the page scrolls in now (it changes when panes are split). */
  readonly scroller: () => HTMLElement;
  /** After rows were drawn again: the page's block list is made again from them. */
  readonly onDrawn: () => void;
  /** Scrolls the page to `top` as the reader's own move: whatever the page was holding (the end, a place) lets go. */
  readonly scrollTo: (top: number) => void;
  /**
   * The level a view of the same file kept before this one was made (a reload): nothing is drawn until the lines it keeps
   * are known, so no frame shows a line the level hides.
   */
  readonly level?: number;
}

export function mountLines(o: LinesOptions): LinesView {
  const { lines, body } = o;
  let destroyed = false;
  /** Lines in the view's order (the level filter's); null is every line. */
  let order: Int32Array | null = null;
  let min = 0;
  let generation = 0;
  let rowPx = 0;
  /** Characters a row of the text column holds. */
  let perRow = 0;
  let heights: LineHeights | null = null;
  let drawn: { first: number; last: number } | null = null;
  let frame = 0;
  /** A carried level is being put back: nothing is drawn, and a place asked for meanwhile is gone to once it is. */
  let held = (o.level ?? 0) > 0;
  let heldByte: number | null = null;

  const viewCount = (): number => (order ? order.length : lines.count);
  const lineAtView = (k: number): number => (order ? order[k]! : k);
  const modelRows = (k: number): number => {
    const i = lineAtView(k);
    return wrapRows(lines.ends[i]! - lines.starts[i]!, perRow);
  };

  const gap = (): HTMLDivElement => {
    const div = document.createElement('div');
    div.className = 'marxy-lines-gap';
    div.setAttribute('aria-hidden', 'true');
    return div;
  };
  const top = gap();
  const bottom = gap();
  const template = document.createElement('template');
  // A row no one sees, for the face's row height and advance: the text column's width over the advance is how many
  // characters a row holds. Its own row, so the view can measure with no line drawn (a level that keeps none, or held).
  const probeRow = document.createElement('div');
  probeRow.className = 'marxy-lines-row';
  probeRow.setAttribute('aria-hidden', 'true');
  probeRow.style.cssText = 'position: absolute; inset-inline: 0; visibility: hidden;';
  const probeNo = document.createElement('span');
  probeNo.className = 'marxy-lines-no';
  const probeText = document.createElement('span');
  probeText.className = 'marxy-lines-text';
  const probe = document.createElement('span');
  probe.className = 'marxy-lines-probe';
  probe.textContent = '0'.repeat(64);
  probeText.append(probe);
  probeRow.append(probeNo, probeText);
  // What stands for the lines when the level keeps none of them.
  const none = document.createElement('p');
  none.className = 'marxy-lines-none';
  none.textContent = 'No lines at this level';

  body.style.setProperty('--marxy-lines-digits', String(String(lines.count).length));

  function put(first: number, last: number, topPx: number, bottomPx: number): void {
    if (viewCount() === 0) {
      body.replaceChildren(none);
      drawn = { first: 0, last: 0 };
      return;
    }
    const parts: string[] = [];
    for (let k = first; k < last; k++) parts.push(lineHtml(lines, lineAtView(k)));
    template.innerHTML = parts.join('');
    top.style.height = `${topPx}px`;
    bottom.style.height = `${bottomPx}px`;
    body.replaceChildren(top, template.content, bottom);
    drawn = { first, last };
  }

  /** The face's row height and the column's width in characters, from the row no one sees. */
  function measure(): boolean {
    body.append(probeRow);
    const lh = parseFloat(getComputedStyle(probeText).lineHeight);
    const advance = probe.getBoundingClientRect().width / 64;
    const width = probeText.clientWidth;
    probeRow.remove();
    if (!(lh > 0) || !(advance > 0) || width === 0) return false;
    rowPx = lh;
    perRow = Math.max(1, Math.floor(width / advance));
    heights = new LineHeights(viewCount(), modelRows);
    return true;
  }

  /** Where the rows begin in the scroller's content. The page's own scroller is the viewport, whose box moves as it scrolls. */
  function rowsTop(sc: HTMLElement): number {
    const origin = sc === document.documentElement || sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top;
    return body.getBoundingClientRect().top - origin + sc.scrollTop;
  }

  function place(): { readonly y: number; readonly vh: number } {
    const sc = o.scroller();
    return { y: sc.scrollTop - rowsTop(sc), vh: sc.clientHeight };
  }

  /** Each drawn row's height in rows, as laid out, put in the heights where the length guessed wrong; the gap below follows. */
  function correct(): void {
    if (!heights || !drawn) return;
    let k = drawn.first;
    let changed = false;
    for (const el of body.children) {
      if (el === top || el === bottom || el === none) continue;
      const rows = Math.max(1, Math.round(el.getBoundingClientRect().height / rowPx));
      if (rows !== heights.rowsOf(k)) {
        heights.set(k, rows);
        changed = true;
      }
      k++;
    }
    if (!changed || heights.total() * rowPx > LINES_MAX_PX) return;
    const drawnPx = (heights.before(drawn.last) - heights.before(drawn.first)) * rowPx;
    bottom.style.height = `${Math.max(0, heights.total() * rowPx - parseFloat(top.style.height || '0') - drawnPx)}px`;
  }

  /** The rows on the page made right for the scroll now (or as if at `y`). `force` draws them again whatever. */
  function draw(force = false, at?: number): void {
    if (destroyed || held || !body.isConnected) return;
    if (!heights) {
      if (!measure()) return;
      force = true;
    }
    const h = heights!;
    const sc = o.scroller();
    const atEnd = sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
    const { y, vh } = place();
    const want = at ?? y;
    const scaled = h.total() * rowPx > LINES_MAX_PX;
    if (!force && !scaled && drawn) {
      const seeFirst = h.lineAt(Math.max(0, want) / rowPx);
      const seeLast = h.lineAt((Math.max(0, want) + vh) / rowPx);
      const n = viewCount();
      const covered = (seeFirst >= drawn.first + MARGIN || drawn.first === 0) && (seeLast < drawn.last - MARGIN || drawn.last === n);
      if (covered) return;
    }
    const w = lineWindow(h, want, vh, rowPx, OVERSCAN);
    put(w.first, w.last, w.topPx, w.bottomPx);
    correct();
    // A reader at the end stays at the end: the last lines drawn may wrap to more rows than their length said.
    if (atEnd && at === undefined) sc.scrollTop = sc.scrollHeight;
    o.onDrawn();
    paintFind();
  }

  const onScroll = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Node) || !target.contains(body) || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  // A new width changes how many characters a row holds, so every line's height is worked out again from its length, and
  // the line at the screen's top stays there. Only the width is watched: the body's height changes with every draw. The work
  // waits for the next frame, as changing the body's size inside the observer's own callback would ask it again.
  let seenWidth = -1;
  let resizeFrame = 0;
  function rewidth(): void {
    resizeFrame = 0;
    const width = body.clientWidth;
    if (width === seenWidth || width === 0) return;
    const first = seenWidth < 0;
    seenWidth = width;
    if (first || !heights) {
      draw(true);
      return;
    }
    const sc = o.scroller();
    const { y, vh } = place();
    const r0 = rowAtScroll(heights, y, vh, rowPx);
    const k = heights.lineAt(r0);
    const into = (r0 - heights.before(k)) * rowPx;
    if (!measure()) return;
    const ny = scrollForLine(heights!, k, vh, rowPx) + into;
    draw(true, ny);
    sc.scrollTop = rowsTop(sc) + ny;
  }
  const resize = new ResizeObserver(() => {
    if (resizeFrame === 0 && body.clientWidth !== seenWidth) resizeFrame = requestAnimationFrame(rewidth);
  });
  resize.observe(body);
  // A taller or shorter window needs only the window of rows drawn for it.
  const onWindowResize = (): void => {
    if (frame === 0) frame = requestAnimationFrame(() => ((frame = 0), draw()));
  };
  window.addEventListener('resize', onWindowResize);

  // ---- the level filter ------------------------------------------------------------------------------------------

  /** Says to find that its matches went with the order they were found in (`ViewerFind.stale`). */
  const staleHeard = new Set<() => void>();

  async function setLevel(
    next: number,
    progress?: (fraction: number) => void,
    keep = false,
  ): Promise<{ readonly hidden: number; readonly total: number } | null> {
    const gen = ++generation;
    // The file's line at the screen's top before the change: with `keep`, the page stays on it or the first kept after it.
    const topByte = heldByte ?? (heights && drawn ? lines.starts[lineAtView(Math.min(viewCount() - 1, topLine()))] ?? 0 : 0);
    if (next <= 0) {
      min = 0;
      order = null;
    } else {
      const pace: Pace = { yieldNow, budgetMs: SLICE_MS, aborted: () => destroyed || gen !== generation, onSlice: progress };
      const ranks = await lineRanks(lines, pace);
      if (!ranks || gen !== generation) return null;
      let kept = 0;
      for (let i = 0; i < ranks.length; i++) if (ranks[i]! >= next) kept++;
      const out = new Int32Array(kept);
      let at = 0;
      for (let i = 0; i < ranks.length; i++) if (ranks[i]! >= next) out[at++] = i;
      min = next;
      order = out;
    }
    findGen++;
    matches = null;
    current = -1;
    clearMarks();
    if (heights) heights = new LineHeights(viewCount(), modelRows);
    drawn = null;
    held = false;
    heldByte = null;
    const sc = o.scroller();
    if (keep && viewCount() > 0) {
      if (!heights) draw(true);
      if (heights) {
        const y = scrollForLine(heights, viewOfByte(topByte), sc.clientHeight, rowPx);
        draw(true, y);
        sc.scrollTop = rowsTop(sc) + y;
      }
    } else {
      o.scrollTo(rowsTop(sc));
      draw(true, 0);
    }
    // A copy: a listener told here may hear again under a new name before the loop ends.
    for (const heard of [...staleHeard]) heard();
    return { hidden: lines.count - viewCount(), total: lines.count };
  }

  // ---- find --------------------------------------------------------------------------------------------------

  /** Matches as view positions and UTF-16 offsets in their line's text, in order; grown while a run reads on. */
  let matches: { at: Ints; from: Ints; to: Ints } | null = null;
  let current = -1;
  let findGen = 0;

  function highlightApi(): { registry: Map<string, unknown>; make(ranges: Range[]): unknown } | null {
    const css = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
    const ctor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!css?.highlights || typeof ctor !== 'function') return null;
    return { registry: css.highlights, make: (ranges) => new ctor(...ranges) };
  }

  function clearMarks(): void {
    const api = highlightApi();
    api?.registry.delete('marxy-find');
    api?.registry.delete('marxy-find-current');
  }

  /** A Range over `[from, to)` of a row's text, walking its text nodes. */
  function rangeIn(el: HTMLElement, from: number, to: number): Range | null {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let at = 0;
    let started = false;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const len = node.data.length;
      if (!started && from <= at + len) {
        range.setStart(node, from - at);
        started = true;
      }
      if (started && to <= at + len) {
        range.setEnd(node, to - at);
        return range;
      }
      at += len;
    }
    return null;
  }

  function lowerBound(a: Int32Array, n: number, v: number): number {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The matches in the rows on the page marked, the current one apart. */
  function paintFind(): void {
    const api = highlightApi();
    if (!api || !matches || !drawn) return;
    const all: Range[] = [];
    const now: Range[] = [];
    const texts = body.querySelectorAll<HTMLElement>('.marxy-lines-text');
    const { at, from, to } = matches;
    for (let i = lowerBound(at.data, at.length, drawn.first); i < at.length && at.data[i]! < drawn.last; i++) {
      const el = texts[at.data[i]! - drawn.first];
      const range = el ? rangeIn(el, from.data[i]!, to.data[i]!) : null;
      if (range) (i === current ? now : all).push(range);
    }
    api.registry.set('marxy-find', api.make(all));
    api.registry.set('marxy-find-current', api.make(now));
  }

  /** The view position at the screen's top. */
  function topLine(): number {
    if (!heights) return 0;
    const { y, vh } = place();
    return heights.lineAt(rowAtScroll(heights, y, vh, rowPx));
  }

  /** View position `k` drawn and on the reading line. */
  function showView(k: number): void {
    if (!heights) draw(true);
    if (!heights) return;
    const sc = o.scroller();
    const vh = sc.clientHeight;
    const y = scrollForLine(heights, k, vh, rowPx, readingLine(vh));
    draw(true, y);
    o.scrollTo(rowsTop(sc) + y);
    draw(true);
    // The lines around it were placed by heights guessed from their length (long prose wraps by words, not characters):
    // once drawn, the line itself is put on the reading line by where it stands.
    for (let pass = 0; pass < 3; pass++) {
      if (!drawn || k < drawn.first || k >= drawn.last) break;
      const el = body.children[1 + k - drawn.first];
      if (!(el instanceof HTMLElement)) break;
      const origin = sc === document.documentElement || sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top;
      const off = el.getBoundingClientRect().top - origin - readingLine(vh);
      if (Math.abs(off) < 2) break;
      o.scrollTo(sc.scrollTop + off);
      draw();
    }
  }

  const find: ViewerFind = {
    async run(re, progress) {
      const gen = ++findGen;
      matches = null;
      current = -1;
      if (!re) {
        find.clear();
        return 0;
      }
      const got = { at: new Ints(), from: new Ints(), to: new Ints() };
      matches = got;
      const n = viewCount();
      let k = 0;
      while (k < n) {
        if (destroyed || gen !== findGen) return 0;
        const t0 = performance.now();
        let block = 0;
        for (; k < n; k++) {
          if (++block === 256) {
            block = 0;
            if (performance.now() - t0 >= SLICE_MS) break;
          }
          const text = lineText(lines, lineAtView(k));
          re.lastIndex = 0;
          for (let m = re.exec(text); m; m = re.exec(text)) {
            if (m[0].length === 0) {
              re.lastIndex++;
              continue;
            }
            got.at.push(k);
            got.from.push(m.index);
            got.to.push(m.index + m[0].length);
          }
        }
        progress(got.at.length);
        if (k < n) await yieldNow();
      }
      if (gen !== findGen) return 0;
      paintFind();
      return got.at.length;
    },
    first() {
      if (!matches || matches.at.length === 0) return -1;
      const i = lowerBound(matches.at.data, matches.at.length, topLine());
      return i < matches.at.length ? i : 0;
    },
    show(i) {
      if (!matches || i < 0 || i >= matches.at.length) return;
      current = i;
      showView(matches.at.data[i]!);
      paintFind();
    },
    clear() {
      findGen++;
      matches = null;
      current = -1;
      clearMarks();
    },
    stale(heard) {
      staleHeard.add(heard);
      return () => staleHeard.delete(heard);
    },
  };

  // ---- the reading place --------------------------------------------------------------------------------------------

  /** The view position of the line holding `byte`, or of the first line kept after it when the filter hides it. */
  function viewOfByte(byte: number): number {
    const i = lineOfByte(lines, byte);
    if (!order) return i;
    return Math.max(0, Math.min(order.length - 1, lowerBound(order, order.length, i)));
  }

  function ensureThrough(byte: number): void {
    if (held) {
      heldByte = byte;
      return;
    }
    if (!heights) draw(true);
    if (!heights) return;
    const vh = o.scroller().clientHeight;
    draw(true, scrollForLine(heights, viewOfByte(byte), vh, rowPx, readingLine(vh)));
  }

  const view: LinesView = {
    lines,
    windowed: () => true,
    ensureThrough,
    showByte: (byte) => showView(viewOfByte(byte)),
    setLevel,
    level: () => min,
    cancel: () => void generation++,
    find,
    destroy() {
      if (!destroyed) {
        const left = (shown.get(lines) ?? 1) - 1;
        shown.set(lines, left);
        // The last page showing these lines is gone: a scan it started stops, and whoever waited on it is not told.
        if (left === 0 && !lines.headings) scans.delete(lines);
      }
      destroyed = true;
      generation++;
      findGen++;
      staleHeard.clear();
      document.removeEventListener('scroll', onScroll, { capture: true });
      resize.disconnect();
      window.removeEventListener('resize', onWindowResize);
      if (frame !== 0) cancelAnimationFrame(frame);
      if (resizeFrame !== 0) cancelAnimationFrame(resizeFrame);
      views.delete(body);
    },
  };
  views.set(body, view);
  shown.set(lines, (shown.get(lines) ?? 0) + 1);
  if (held) void setLevel(o.level!, undefined, true).then((done) => {
    // Overtaken, or the ranks could not be read: the page is drawn with every line rather than left empty.
    if (done === null && !destroyed && held) {
      held = false;
      draw(true);
    }
  });
  else draw(true);
  // The headings are scanned after the first lines have painted, never before them.
  if (lines.markdown && !lines.headings) {
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (!destroyed) markdownHeadings(lines);
      }, 0),
    );
  }
  return view;
}
