// A PDF as a page of the reader's: its pages drawn by pdf.js down one column, only those near
// the view (a canvas each, and a text layer over it so a selection copies and Find reaches the words); Page n of N, zoom,
// Fit width and Fit page in the bar; the paper as authored, white in Night too. The panel's fourth card is
// Pages (a thumbnail each, and the outline when the file has one), its metadata slot Document, read from the file's own
// fields. Source is the bytes, the hex view, as for any file that is not text. The bytes come a range at a
// time through the shell, so a large PDF is never read whole. Export writes the file, its text, or that text as Markdown.
import { accountKey } from '../frame/account.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import {
  PX_PER_PT,
  currentPage,
  fitZoom,
  flattenOutline,
  layoutPages,
  madeByWords,
  matchesIn,
  pageAsked,
  pageText,
  pagesNear,
  paperWords,
  pdfDateWords,
  pdfMarkdown,
  pdfPlainText,
  piecesOf,
  placeAt,
  scrollFor,
  stepPdfZoom,
  type OutlineNode,
  type PageLayout,
  type PageSize,
  type PdfFit,
} from '@marxy/core/src/viewer/pdf.ts';
import { percent } from '@marxy/core/src/viewer/image.ts';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppShell } from '../app-types.ts';
import { el, factRow, segmented } from '../frame/dom.ts';
import { icon } from '../frame/icons.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { FIND_CURRENT_HIGHLIGHT, FIND_HIGHLIGHT } from '../find/view.ts';
import { fileCardElement } from './card.ts';
import { byteCard, factsCard, readingCard } from './cards.ts';
import type { ViewedFile } from './file.ts';
import { createHexView, type HexView } from './hex.ts';
import { PasswordException, TextLayer, openPdf, type OpenedPdf, type PdfPage, type PdfTextContent } from './pdf-engine.ts';
import { PdfMatches, keptPdf } from './pdf-state.ts';
import { viewerChanged } from './signal.ts';
import type { PaneViewer, PartTree, PartUnit, ViewMode, ViewerExport, ViewerFind } from './types.ts';
import { pdfBlocks, type PdfBlock, type TextRun } from './pdf-blocks.ts';
import css from './pdf.css?inline';
import { maxOf, minOf } from '@marxy/core/src/util/spread.ts';

/** The most pixels one page's canvas holds; past it a page is drawn softer rather than not at all. */
const CANVAS_MAX_PIXELS = 16_777_216;
/** Pages drawn beyond the view, above and below, as a share of its height. */
const MARGIN_SCREENS = 1;
/** Pages whose size is asked for at a time in the background, between which the page answers. */
const SIZE_BATCH = 25;
/** Pages whose own size is learned, behind and ahead of the page shown. */
const SIZE_BEHIND = 50;
const SIZE_AHEAD = 200;
/** Thumbnails drawn in the Pages card at most; past them, the pages are listed by number. */
const THUMBS_MAX = 200;

/** What a PDF is, read once as it opens: the document, its pages' first size, its fields and its outline. */
export interface PdfSetup {
  readonly opened: OpenedPdf;
  readonly pages: number;
  readonly first: PageSize;
  readonly info: Readonly<Record<string, unknown>>;
  readonly outline: readonly OutlineNode[] | null;
  readonly scripts: boolean;
  readonly firstHasText: boolean;
}

/** Why a PDF could not be opened, in the card's words. */
export interface PdfRefusal {
  readonly kicker: string;
  readonly line: string;
}

/** Opens the PDF and reads what its page needs first; a refusal says why it could not. */
export async function openPdfFor(shell: Pick<AppShell, 'readRange'>, file: ViewedFile): Promise<PdfSetup | PdfRefusal> {
  let opened: OpenedPdf;
  try {
    opened = await openPdf(shell, file.path, file.size);
  } catch (e) {
    if (e instanceof PasswordException || (e as { name?: string })?.name === 'PasswordException') {
      return { kicker: 'A PDF locked with a password', line: 'The app does not ask for PDF passwords: open it in your default app to read it.' };
    }
    return { kicker: 'A PDF the app cannot read', line: `pdf.js could not read it: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    const { doc } = opened;
    const [page, meta, outline, js] = await Promise.all([
      doc.getPage(1),
      doc.getMetadata().catch(() => null),
      doc.getOutline().catch(() => null),
      doc.getJSActions().catch(() => null),
    ]);
    const v = page.getViewport({ scale: 1 });
    const text = await page.getTextContent().catch(() => null);
    return {
      opened,
      pages: doc.numPages,
      first: { w: v.width, h: v.height },
      info: (meta?.info ?? {}) as Record<string, unknown>,
      outline: (outline as OutlineNode[] | null) ?? null,
      scripts: js !== null && Object.keys(js).length > 0,
      firstHasText: !!text && text.items.some((i) => 'str' in i && i.str.trim() !== ''),
    };
  } catch (e) {
    opened.destroy();
    return { kicker: 'A PDF the app cannot read', line: `pdf.js could not read its first page: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export interface PdfOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  readonly setup: PdfSetup;
  /** Drawn inside another page (an archive's preview): the host page's line of meta is the page's only one. */
  readonly embedded?: boolean;
}

interface Slot {
  readonly index: number;
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly text: HTMLElement;
  /** The zoom the canvas was last drawn at; 0 before it is drawn. */
  drawn: number;
  drawing: boolean;
  task: { cancel(): void } | null;
  layer: InstanceType<typeof TextLayer> | null;
  layerZoom: number;
}

interface PageWords {
  readonly content: PdfTextContent;
  readonly text: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function createPdfViewer(o: PdfOptions): PaneViewer {
  const { shell, file, setup } = o;
  const { doc } = setup.opened;
  const path = file.path;
  const count = setup.pages;
  const state = keptPdf(path);
  adoptRuntimeSheet(document, 'marxy-pdf-style', css);

  let host: HTMLElement | null = null;
  let mode: ViewMode = 'rendered';
  let hex: HexView | null = null;
  let destroyed = false;
  const sizes: PageSize[] = Array.from({ length: count }, () => setup.first);
  const learned = new Set<number>([0]);
  let learning = false;
  let layout: PageLayout = layoutPages(sizes, state.zoom);
  let page: { root: HTMLElement; stage: HTMLElement; sheets: HTMLElement; pageInput: HTMLInputElement; zoomValue: HTMLElement; fitSeg: HTMLElement } | null = null;
  const slots = new Map<number, Slot>();
  const words = new Map<number, Promise<PageWords>>();
  /** The same words once read, so the marks are painted without waiting. */
  const wordsNow = new Map<number, PageWords>();
  let resize: ResizeObserver | null = null;
  let frame = 0;
  let pumping = false;
  let shownPage = -1;
  let matches: PdfMatches | null = null;
  let findRun = 0;
  let currentMatch = -1;
  /** A match asked for whose page was not drawn yet: it is brought to the reading line once it is. */
  let pendingShow = -1;
  const thumbs = new Map<number, HTMLCanvasElement>();
  let thumbQueue: Promise<void> = Promise.resolve();

  const pane = (): HTMLElement | undefined => host?.closest<HTMLElement>('section.marxy-pane') ?? undefined;
  const ensureHex = (): HexView => (hex ??= createHexView(file, (offset, length) => shell.readRange(path, offset, length)));

  function textOf(i: number): Promise<PageWords> {
    let got = words.get(i);
    if (!got) {
      got = doc
        .getPage(i + 1)
        .then((p) => p.getTextContent({ includeMarkedContent: true }))
        .then((content) => {
          const w = { content, ...pageText(content.items as { str?: string; hasEOL?: boolean }[]) };
          wordsNow.set(i, w);
          return w;
        });
      words.set(i, got);
      got.catch(() => words.delete(i));
    }
    return got;
  }

  // ---- the column ---------------------------------------------------------------------------------------------------

  function room(): { w: number; h: number } {
    const s = page?.stage;
    return { w: s?.clientWidth ?? 800, h: s?.clientHeight ?? 600 };
  }

  /** The column laid out again at the kept zoom (or the fit's), the place held where it was. */
  function relayout(keepPlace = true): void {
    if (!page) return;
    const before = keepPlace ? placeAt(layout, page.stage.scrollTop) : state.place;
    if (state.fit) {
      const r = room();
      state.zoom = fitZoom(state.fit, r.w, r.h, sizes[Math.max(0, Math.min(count - 1, before.page))] ?? setup.first);
    }
    layout = layoutPages(sizes, state.zoom);
    page.sheets.style.height = `${layout.height}px`;
    page.sheets.style.width = `${layout.width}px`;
    for (const slot of slots.values()) place(slot);
    page.stage.scrollTop = scrollFor(layout, before);
    state.place = before;
    paintBar();
    update();
  }

  function place(slot: Slot): void {
    const i = slot.index;
    const w = layout.widths[i]!;
    const h = layout.heights[i]!;
    slot.el.style.top = `${layout.tops[i]}px`;
    slot.el.style.width = `${w}px`;
    slot.el.style.height = `${h}px`;
    slot.el.style.setProperty('--total-scale-factor', String(state.zoom * PX_PER_PT));
  }

  function makeSlot(i: number): Slot {
    const box = el('section', 'marxy-pdf-page');
    box.dataset.marxyPage = String(i);
    box.setAttribute('aria-label', `Page ${i + 1}`);
    const canvas = el('canvas', 'marxy-pdf-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const text = el('div', 'marxy-pdf-text');
    box.append(canvas, text);
    const slot: Slot = { index: i, el: box, canvas, text, drawn: 0, drawing: false, task: null, layer: null, layerZoom: 0 };
    markSlot(slot);
    place(slot);
    return slot;
  }

  function drop(slot: Slot): void {
    slot.task?.cancel();
    slot.layer?.cancel();
    slot.el.remove();
    slots.delete(slot.index);
    void doc
      .getPage(slot.index + 1)
      .then((p) => p.cleanup())
      .catch(() => {});
  }

  /** The pages near the view are made, the rest let go; the bar's page and the kept place follow the scroll. */
  function update(): void {
    frame = 0;
    if (!page || destroyed) return;
    const { stage, sheets } = page;
    const [first, last] = pagesNear(layout, stage.scrollTop, stage.clientHeight, stage.clientHeight * MARGIN_SCREENS);
    for (const slot of [...slots.values()]) if (slot.index < first || slot.index > last) drop(slot);
    for (let i = first; i <= last; i++) {
      if (slots.has(i)) continue;
      const slot = makeSlot(i);
      slots.set(i, slot);
      sheets.append(slot.el);
    }
    state.place = placeAt(layout, stage.scrollTop);
    const now = currentPage(layout, stage.scrollTop, stage.clientHeight);
    if (now !== shownPage) {
      shownPage = now;
      paintBar();
      markThumb();
      void learnSizes().catch(() => {});
    }
    void pump();
  }

  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(update);
  };

  /** Draws the pages that need it, the one nearest the bar's page first, one at a time. */
  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        if (destroyed || !page) return;
        const todo = [...slots.values()].filter((s) => !s.drawing && (s.drawn !== state.zoom || s.layerZoom !== state.zoom));
        if (todo.length === 0) return;
        todo.sort((a, b) => Math.abs(a.index - shownPage) - Math.abs(b.index - shownPage));
        await draw(todo[0]!);
      }
    } finally {
      pumping = false;
    }
  }

  async function draw(slot: Slot): Promise<void> {
    slot.drawing = true;
    const zoom = state.zoom;
    try {
      const p: PdfPage = await doc.getPage(slot.index + 1);
      if (!slots.has(slot.index)) return;
      const viewport = p.getViewport({ scale: zoom * PX_PER_PT });
      if (slot.drawn !== zoom) {
        const want = window.devicePixelRatio || 1;
        const ratio = Math.min(want, Math.sqrt(CANVAS_MAX_PIXELS / Math.max(1, viewport.width * viewport.height)));
        // Drawn off to the side, then swapped in, so the page never blanks while a zoom redraws it.
        const canvas = el('canvas', 'marxy-pdf-canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        const task = p.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
        slot.task = task;
        await task.promise;
        slot.task = null;
        if (!slots.has(slot.index)) return;
        slot.canvas.replaceWith(canvas);
        (slot as { canvas: HTMLCanvasElement }).canvas = canvas;
        slot.drawn = zoom;
      }
      if (slot.layerZoom !== zoom) {
        if (slot.layer) slot.layer.update({ viewport });
        else {
          const w = await textOf(slot.index);
          if (!slots.has(slot.index)) return;
          slot.text.replaceChildren();
          slot.layer = new TextLayer({ textContentSource: w.content, container: slot.text, viewport });
          await slot.layer.render();
        }
        slot.layerZoom = zoom;
        paintMarks();
        askBlocks(slot.index);
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== 'RenderingCancelledException') console.info(`marxy: page ${slot.index + 1} of ${basename(path)} was not drawn: ${String(e)}`);
      slot.drawn = zoom;
      slot.layerZoom = zoom;
    } finally {
      slot.drawing = false;
    }
  }

  /**
   * The own size of each page near the one shown, asked for in the background: a PDF's pages need not all be the first one's
   * size. Never the whole file: each `getPage` reads the page's dictionary, which in a big PDF is a range read of its own
   * (measured: every page of a 236 MB, 8,000-page file read its 64 KB chunk, the whole file, within seconds of opening).
   */
  async function learnSizes(): Promise<void> {
    if (learning) return;
    learning = true;
    try {
      while (!destroyed) {
        const at = Math.max(0, shownPage);
        const todo: number[] = [];
        for (let i = Math.max(0, at - SIZE_BEHIND); i < Math.min(count, at + SIZE_AHEAD) && todo.length < SIZE_BATCH; i++) if (!learned.has(i)) todo.push(i);
        if (todo.length === 0) return;
        let changed = false;
        for (const i of todo) {
          learned.add(i);
          const v = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
          const s = sizes[i]!;
          if (Math.abs(s.w - v.width) > 0.5 || Math.abs(s.h - v.height) > 0.5) {
            sizes[i] = { w: v.width, h: v.height };
            changed = true;
          }
        }
        if (destroyed) return;
        if (changed && page) relayout();
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      learning = false;
    }
  }

  // ---- zoom and going to a page --------------------------------------------------------------------------------------

  function zoomTo(z: number | PdfFit): void {
    if (typeof z === 'number') {
      state.fit = null;
      state.zoom = z;
    } else state.fit = z;
    relayout();
    viewerChanged();
  }

  function goTo(i: number, fraction = 0): void {
    if (!page) return;
    const at = Math.max(0, Math.min(count - 1, i));
    page.stage.scrollTop = scrollFor(layout, { page: at, fraction }) - 8;
    update();
  }

  function paintBar(): void {
    if (!page) return;
    if (document.activeElement !== page.pageInput) page.pageInput.value = String(Math.max(0, shownPage) + 1);
    page.zoomValue.textContent = percent(state.zoom);
    for (const b of page.fitSeg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.marxyZoom === state.fit));
  }

  function bar(): { el: HTMLElement; pageInput: HTMLInputElement; zoomValue: HTMLElement; fitSeg: HTMLElement; account: HTMLElement | null } {
    const b = el('div', 'marxy-pdfbar');
    const label = el('label', 'marxy-pdfbar-page');
    const pageInput = el('input', 'marxy-pdfbar-input');
    pageInput.type = 'text';
    pageInput.inputMode = 'numeric';
    pageInput.size = 3;
    pageInput.setAttribute('aria-label', 'Page number');
    pageInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const at = pageAsked(pageInput.value, count);
      if (at !== null) goTo(at);
      page?.stage.focus({ preventScroll: true });
    });
    pageInput.addEventListener('blur', () => paintBar());
    label.append('Page ', pageInput, ` of ${count.toLocaleString('en-GB')}`);
    const less = el('button', 'marxy-icon-button');
    less.type = 'button';
    less.title = 'Smaller (−)';
    less.setAttribute('aria-label', 'Smaller');
    less.append(icon('minus'));
    less.addEventListener('click', () => zoomTo(stepPdfZoom(state.zoom, -1)));
    const zoomValue = el('span', 'marxy-pdfbar-zoom');
    zoomValue.setAttribute('aria-live', 'polite');
    const more = el('button', 'marxy-icon-button');
    more.type = 'button';
    more.title = 'Larger (+)';
    more.setAttribute('aria-label', 'Larger');
    more.append(icon('plus'));
    more.addEventListener('click', () => zoomTo(stepPdfZoom(state.zoom, 1)));
    const fitSeg = segmented<PdfFit>('Fit', [['width', 'Fit width'], ['page', 'Fit page']], state.fit ?? 'width', (v) => zoomTo(v));
    const [w, p] = fitSeg.querySelectorAll('button');
    w?.setAttribute('data-marxy-zoom', 'width');
    p?.setAttribute('data-marxy-zoom', 'page');
    const version = str(setup.info.PDFFormatVersion);
    const facts = [version ? `PDF ${version}` : 'PDF', paperWords(setup.first).replace(/^.*mm, /, '').replace(/ mm$/, ' mm')].join(' · ');
    // The facts are the page's caption, and the key to its account at the row's end.
    const account = o.embedded ? null : accountKey(
      [
        'Drawn by pdf.js, inside Marxy, from the file’s own bytes. Scripts in it never run, forms are shown as drawn but cannot be filled, and nothing is fetched from the network.',
        'The text you select and find is the PDF’s own text layer; a scanned page may have none.',
      ],
      facts,
      'marxy-pdfbar-facts',
    );
    b.append(label, less, zoomValue, more, fitSeg, el('span', 'marxy-grow'), account?.key ?? el('span', 'marxy-pdfbar-facts', facts));
    return { el: b, pageInput, zoomValue, fitSeg, account: account?.body ?? null };
  }

  function drawPages(into: HTMLElement): void {
    const root = el('div', 'marxy-pdfpage');
    const made = bar();
    const stage = el('div', 'marxy-pdf-stage');
    stage.tabIndex = -1;
    stage.setAttribute('role', 'document');
    stage.setAttribute('aria-label', `${basename(path)}, ${count} ${count === 1 ? 'page' : 'pages'}`);
    const sheets = el('div', 'marxy-pdf-sheets');
    stage.append(sheets);
    root.append(made.el);
    if (made.account) root.append(made.account);
    root.append(stage);
    into.replaceChildren(root);
    slots.clear();
    page = { root, stage, sheets, pageInput: made.pageInput, zoomValue: made.zoomValue, fitSeg: made.fitSeg };
    stage.addEventListener('scroll', schedule, { passive: true });
    stage.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        zoomTo(stepPdfZoom(state.zoom, e.deltaY < 0 ? 1 : -1));
      },
      { passive: false },
    );
    resize?.disconnect();
    resize = new ResizeObserver(() => {
      if (state.fit) relayout();
      else schedule();
    });
    resize.observe(stage);
    shownPage = -1;
    // The place kept for the file (a reload, a tab opened again) is where the page opens.
    relayout(false);
  }

  function cardPage(): HTMLElement {
    const root = el('div', 'marxy-fcpage');
    const side = el('div', 'marxy-fchex');
    const view = ensureHex();
    side.append(view.el);
    root.append(fileCardElement({ shell, file, back: { words: 'Back to the pages', run: () => setCard(false) } }, pane), side);
    requestAnimationFrame(() => view.draw());
    return root;
  }

  function setCard(on: boolean): void {
    state.asCard = on;
    render();
    viewerChanged();
  }

  function render(): void {
    if (!host) return;
    if (page) state.place = placeAt(layout, page.stage.scrollTop);
    for (const slot of [...slots.values()]) drop(slot);
    page = null;
    resize?.disconnect();
    resize = null;
    if (mode === 'source' || state.asCard) {
      if (mode === 'source') {
        const view = ensureHex();
        const wrap = el('div', 'marxy-hexpage');
        wrap.append(view.el);
        host.replaceChildren(wrap);
        requestAnimationFrame(() => view.draw());
      } else host.replaceChildren(cardPage());
      return;
    }
    drawPages(host);
  }

  // ---- Find -----------------------------------------------------------------------------------------------------------

  function highlights(): { set(name: string, h: unknown): void; delete(name: string): boolean } | null {
    return (globalThis as { CSS?: { highlights?: { set(name: string, h: unknown): void; delete(name: string): boolean } } }).CSS?.highlights ?? null;
  }

  /** A Range for each piece of each match on the pages drawn; the current one marked apart. */
  function paintMarks(): void {
    const reg = highlights();
    const Ctor = (globalThis as { Highlight?: new (...r: Range[]) => { priority: number } }).Highlight;
    if (!reg || !Ctor) return;
    if (!matches || matches.list.length === 0) {
      reg.delete(FIND_HIGHLIGHT);
      reg.delete(FIND_CURRENT_HIGHLIGHT);
      return;
    }
    const all: Range[] = [];
    const now: Range[] = [];
    for (const slot of slots.values()) {
      if (!slot.layer) continue;
      const divs = slot.layer.textDivs;
      const known = wordsNow.get(slot.index);
      if (!known) continue;
      for (const { at, match } of matches.onPage(slot.index)) {
        for (const piece of piecesOf(known.starts, known.ends, match.start, match.end)) {
          const node = divs[piece.piece]?.firstChild;
          if (!node || !(node instanceof Text)) continue;
          const r = document.createRange();
          r.setStart(node, Math.min(piece.from, node.length));
          r.setEnd(node, Math.min(piece.to, node.length));
          (at === currentMatch ? now : all).push(r);
        }
      }
    }
    reg.set(FIND_HIGHLIGHT, new Ctor(...all));
    const cur = new Ctor(...now);
    cur.priority = 1;
    reg.set(FIND_CURRENT_HIGHLIGHT, cur);
    if (pendingShow >= 0 && now.length > 0 && matches.list[pendingShow]?.page !== undefined && slots.get(matches.list[pendingShow]!.page)?.layer) {
      pendingShow = -1;
      toReadingLine(now[0]!);
    }
  }

  function toReadingLine(r: Range): void {
    if (!page) return;
    const box = r.getBoundingClientRect();
    const stage = page.stage.getBoundingClientRect();
    page.stage.scrollTop += box.top - (stage.top + page.stage.clientHeight / 3);
  }

  const finder: ViewerFind = {
    async run(re, progress) {
      const run = ++findRun;
      currentMatch = -1;
      pendingShow = -1;
      if (!re) {
        matches = null;
        paintMarks();
        return 0;
      }
      const found = new PdfMatches(count);
      matches = found;
      for (let i = 0; i < count; i++) {
        let w: PageWords;
        try {
          w = await textOf(i);
        } catch {
          found.add(i, []);
          continue;
        }
        if (run !== findRun) return found.list.length;
        found.add(i, matchesIn(w.text, i, re));
        if (slots.has(i)) paintMarks();
        if (i % 8 === 7 || i === count - 1) progress(found.list.length);
      }
      progress(found.list.length);
      return found.list.length;
    },
    first() {
      if (!matches || !page) return -1;
      return matches.first(currentPage(layout, page.stage.scrollTop, page.stage.clientHeight));
    },
    show(i) {
      const m = matches?.list[i];
      if (!m || !page) return;
      currentMatch = i;
      pendingShow = i;
      const slot = slots.get(m.page);
      if (!slot?.layer || slot.layerZoom !== state.zoom) {
        const top = layout.tops[m.page]!;
        const bottom = top + layout.heights[m.page]!;
        const { scrollTop, clientHeight } = page.stage;
        if (top > scrollTop + clientHeight || bottom < scrollTop) goTo(m.page);
      }
      paintMarks();
    },
    clear() {
      findRun += 1;
      matches = null;
      currentMatch = -1;
      pendingShow = -1;
      paintMarks();
    },
  };

  // ---- the panel --------------------------------------------------------------------------------------------------------

  function markThumb(): void {
    for (const b of document.querySelectorAll<HTMLElement>('.marxy-pdf-thumbs [data-marxy-page]')) {
      if (Number(b.dataset.marxyPage) === shownPage) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  function thumbOf(i: number, into: HTMLElement): void {
    const have = thumbs.get(i);
    if (have) {
      into.replaceChildren(have);
      return;
    }
    thumbQueue = thumbQueue
      .then(async () => {
        if (destroyed || !into.isConnected) return;
        const p = await doc.getPage(i + 1);
        const v1 = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: (64 * (window.devicePixelRatio || 1)) / v1.width });
        const c = el('canvas', 'marxy-pdf-thumb-canvas');
        c.width = Math.max(1, Math.floor(viewport.width));
        c.height = Math.max(1, Math.floor(viewport.height));
        await p.render({ canvas: c, viewport }).promise;
        thumbs.set(i, c);
        if (into.isConnected) into.replaceChildren(c);
      })
      .catch(() => {});
  }

  const reading = readingCard({
    file,
    facts: () => null,
    shownAs: () => (state.asCard && mode === 'rendered' ? 'a file card and the bytes' : 'a PDF'),
    other: () =>
      mode === 'rendered'
        ? state.asCard
          ? { words: 'Show the pages instead', run: () => setCard(false) }
          : { words: 'Show the file card and the bytes instead', run: () => setCard(true) }
        : null,
  });

  const outline = setup.outline ? flattenOutline(setup.outline) : [];

  async function goToDest(dest: unknown): Promise<void> {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : (dest as unknown[] | null);
      const ref = explicit?.[0];
      if (ref === undefined || ref === null) return;
      const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]);
      goTo(index);
    } catch {
      // An entry whose destination names no page goes nowhere.
    }
  }

  const pagesCard: CardDef = {
    id: 'contents',
    title: () => 'Pages',
    detail: () => count.toLocaleString('en-GB'),
    relevant: () => true,
    render(body) {
      const grid = el('div', 'marxy-pdf-thumbs');
      const seen = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          seen.unobserve(e.target);
          const b = e.target as HTMLElement;
          thumbOf(Number(b.dataset.marxyPage), b.querySelector<HTMLElement>('.marxy-pdf-thumb-sheet')!);
        }
      });
      const drawn = Math.min(count, THUMBS_MAX);
      const s = setup.first;
      for (let i = 0; i < drawn; i++) {
        const b = el('button', 'marxy-pdf-thumb');
        b.type = 'button';
        b.dataset.marxyPage = String(i);
        b.setAttribute('aria-label', `Page ${i + 1}`);
        if (i === shownPage) b.setAttribute('aria-current', 'page');
        const sheet = el('span', 'marxy-pdf-thumb-sheet');
        sheet.style.aspectRatio = `${s.w} / ${s.h}`;
        b.append(sheet, el('span', 'marxy-pdf-thumb-n', String(i + 1)));
        b.addEventListener('click', () => goTo(i));
        grid.append(b);
        seen.observe(b);
      }
      body.append(grid);
      if (count > drawn) body.append(el('p', 'marxy-card-note', `The first ${drawn.toLocaleString('en-GB')} of ${count.toLocaleString('en-GB')} pages; Page n of ${count.toLocaleString('en-GB')} in the bar goes to any.`));
      if (outline.length > 0) {
        body.append(el('p', 'marxy-card-sub', 'Outline'));
        const list = el('div', 'marxy-pdf-outline');
        for (const entry of outline) {
          const b = el('button', 'marxy-pdf-outline-entry', entry.title);
          b.type = 'button';
          b.style.setProperty('--marxy-pdf-depth', String(entry.depth));
          b.addEventListener('click', () => void goToDest(entry.dest));
          list.append(b);
        }
        body.append(list);
      }
      return () => {
        seen.disconnect();
      };
    },
  };

  const documentCard: CardDef = {
    id: 'frontmatter',
    title: () => 'Document',
    detail: () => 'from the file’s own fields',
    relevant: () => true,
    render(body) {
      const i = setup.info;
      const quiet = (words: string): HTMLElement => el('span', 'marxy-fact-quiet', words);
      const title = str(i.Title);
      const author = str(i.Author);
      const made = madeByWords(str(i.Creator), str(i.Producer));
      const when = pdfDateWords(str(i.CreationDate));
      const forms = i.IsAcroFormPresent === true || i.IsXFAPresent === true;
      body.append(
        factRow('title', title ?? quiet('not set in the file')),
        factRow('author', author ?? quiet('not set in the file')),
        factRow('made by', made ?? quiet('not set in the file')),
        factRow('made', when ?? quiet('not set in the file')),
        factRow('page', `${paperWords(setup.first)} · ${count.toLocaleString('en-GB')} ${count === 1 ? 'page' : 'pages'}`),
        factRow('version', str(i.PDFFormatVersion) ? `PDF ${str(i.PDFFormatVersion)}` : 'not said'),
        factRow('text', setup.firstHasText ? 'a text layer: it selects and finds' : 'no text on its first page: a scan, perhaps; nothing there to select or find'),
        factRow('scripts', `${setup.scripts ? 'in the file, never run' : 'none'}; forms ${forms ? 'shown as drawn, not filled' : 'none'}`),
      );
      if (outline.length > 0) body.append(factRow('outline', `${outline.length.toLocaleString('en-GB')} ${outline.length === 1 ? 'entry' : 'entries'}, in Pages`));
    },
  };

  const facts = factsCard(file);
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });

  // ---- Export ----------------------------------------------------------------------------------------------------------

  async function allText(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push((await textOf(i).catch(() => null))?.text ?? '');
    return out;
  }

  const exportsOf: readonly ViewerExport[] = [
    {
      id: 'file',
      name: 'The PDF, as it is',
      sub: 'every byte, under a name you choose',
      extension: 'pdf',
      async build() {
        const bytes = await shell.readFile(path);
        return { bytes, preview: `${basename(path)}: ${bytes.length.toLocaleString('en-GB')} bytes, written unchanged.` };
      },
    },
    {
      id: 'text',
      name: 'Plain text',
      sub: 'its text layer, page by page',
      extension: 'txt',
      async build() {
        const text = pdfPlainText(await allText());
        return { bytes: new TextEncoder().encode(text), preview: text.slice(0, 4000) };
      },
    },
    {
      id: 'markdown',
      name: 'Markdown',
      sub: 'its text, the title as a heading',
      extension: 'md',
      async build() {
        const text = pdfMarkdown(str(setup.info.Title), await allText());
        return { bytes: new TextEncoder().encode(text), preview: text.slice(0, 4000) };
      },
    },
  ];

  // ---- the cursor's parts ------------------------------------------------------------------------------------------------

  /** The pages the cursor holds: marked here, since a page's element is made and let go as the column scrolls. */
  let marked: { head: number; from: number; to: number } | null = null;
  /** The text blocks the cursor holds, by their ids, when it is on blocks rather than pages. */
  let markedBlocks: { head: string; run: ReadonlySet<string> } | null = null;

  function markSlot(slot: Slot): void {
    const on = marked !== null && slot.index >= marked.from && slot.index <= marked.to;
    slot.el.classList.toggle('marxy-selected', on);
    slot.el.classList.toggle('marxy-cursor', on && slot.index === marked?.head);
    for (const box of slot.el.querySelectorAll('.marxy-pdf-block')) box.classList.remove('marxy-selected', 'marxy-cursor');
    for (const id of markedBlocks?.run ?? []) {
      const at = whereOf(id);
      if (at.page !== slot.index || at.block === null) continue;
      const box = blockBox(slot, at.block, true);
      box?.classList.add('marxy-selected');
      if (id === markedBlocks?.head) box?.classList.add('marxy-cursor');
    }
  }

  /** Each page's text blocks (viewers/pdf-blocks.ts), once its text and its size are read: the page's parts inside it. */
  const blocks = new Map<number, readonly PdfBlock[]>();
  const blockParts = new Map<number, PartUnit[]>();
  const blocksAsked = new Set<number>();
  function askBlocks(i: number): void {
    if (blocksAsked.has(i)) return;
    blocksAsked.add(i);
    void Promise.all([doc.getPage(i + 1), textOf(i)])
      .then(([p, w]) => {
        const runs = (w.content.items as Partial<TextRun>[]).filter((x): x is TextRun => typeof x.str === 'string' && Array.isArray(x.transform));
        blocks.set(i, pdfBlocks(runs, p.getViewport({ scale: 1 }).transform));
      })
      .catch(() => blocksAsked.delete(i));
  }

  /** Block `k` of the page in `slot`, as a box over its words: made when `make` asks, else only found. */
  function blockBox(slot: Slot, k: number, make: boolean): HTMLElement | null {
    const b = blocks.get(slot.index)?.[k];
    if (!b) return null;
    let box = slot.el.querySelector<HTMLElement>(`:scope > .marxy-pdf-block[data-marxy-block="${k}"]`);
    if (!box && make) {
      const s = sizes[slot.index] ?? setup.first;
      box = el('div', 'marxy-pdf-block');
      box.dataset.marxyBlock = String(k);
      box.style.left = `${(b.left / s.w) * 100}%`;
      box.style.top = `${(b.top / s.h) * 100}%`;
      box.style.width = `${((b.right - b.left) / s.w) * 100}%`;
      box.style.height = `${((b.bottom - b.top) / s.h) * 100}%`;
      slot.el.append(box);
    }
    return box;
  }

  /** The page and block an id names (`page=3`, `page=3/block=2`), 0-based. */
  function whereOf(id: string): { page: number; block: number | null } {
    const m = /^page=(\d+)(?:\/block=(\d+))?$/.exec(id);
    return { page: m ? Number(m[1]) - 1 : -1, block: m?.[2] ? Number(m[2]) - 1 : null };
  }

  function blockUnits(i: number): PartUnit[] | undefined {
    const list = blocks.get(i);
    if (!list || list.length === 0) return undefined;
    let made = blockParts.get(i);
    if (!made) {
      made = list.map((b, k) => ({
        id: `page=${i + 1}/block=${k + 1}`,
        label: 'block',
        address: `#page=${i + 1}/block=${k + 1}`,
        el() {
          if (!page) return null;
          if (!slots.has(i)) goTo(i);
          const slot = slots.get(i);
          return slot ? blockBox(slot, k, true) : null;
        },
        stored: () => b.text,
      }));
      blockParts.set(i, made);
    }
    return made;
  }

  const pageUnits: PartUnit[] = Array.from({ length: count }, (_, i) => ({
    id: `page=${i + 1}`,
    label: `page ${i + 1}`,
    address: `#page=${i + 1}`,
    el() {
      if (!page) return null;
      // Brought near the view first: only the pages near it have an element.
      if (!slots.has(i)) goTo(i);
      askBlocks(i);
      return slots.get(i)?.el ?? null;
    },
    // Its text blocks, once read: a page near the view has them asked for as it is drawn.
    get children() {
      return blockUnits(i);
    },
    // The text layer's words, read for this page alone when it has not been drawn yet.
    stored: async () => wordsNow.get(i)?.text ?? (await textOf(i).catch(() => null))?.text ?? '',
  }));
  const indexOf = (u: PartUnit): number => whereOf(u.id).page;

  const pagesTree: PartTree = {
    top: () => pageUnits,
    find(id) {
      const at = whereOf(id);
      const p = pageUnits[at.page];
      return !p ? null : at.block === null ? p : (blockUnits(at.page)?.[at.block] ?? null);
    },
    parent: (u) => (whereOf(u.id).block === null ? null : (pageUnits[indexOf(u)] ?? null)),
    readOnly: true,
    start: () => pageUnits[Math.max(0, shownPage)] ?? null,
    step: (from, dir) => pageUnits[Math.max(0, Math.min(count - 1, (from ? indexOf(from) : Math.max(0, shownPage)) + dir))] ?? null,
    drawn(u) {
      const at = whereOf(u.id);
      const slot = slots.get(at.page);
      return !slot ? null : at.block === null ? slot.el : blockBox(slot, at.block, false);
    },
    mark(head, run) {
      if (head && whereOf(head.id).block !== null) {
        marked = null;
        markedBlocks = { head: head.id, run: new Set(run.map((u) => u.id)) };
      } else {
        markedBlocks = null;
        const at = run.map(indexOf);
        marked = head ? { head: indexOf(head), from: minOf(at), to: maxOf(at) } : null;
      }
      for (const slot of slots.values()) markSlot(slot);
    },
  };

  // ---- the viewer ------------------------------------------------------------------------------------------------------

  void learnSizes().catch(() => {});

  return {
    path,
    kind: 'pdf',
    group: 'pdf',
    binary: true,
    owns: () => true,
    show(m, into) {
      mode = m;
      host = into;
      into.setAttribute('data-marxy-viewer', 'pdf');
      render();
    },
    hide() {
      if (page) state.place = placeAt(layout, page.stage.scrollTop);
      host = null;
    },
    cards(m) {
      if (m === 'source' || state.asCard) return { reading, facts };
      return { reading, contents: pagesCard, frontmatter: documentCard, facts };
    },
    passing: (m) => (m === 'source' || state.asCard ? [byte] : []),
    headSay: () => (file.guessed ? { text: 'PDF · guessed', tone: 'guess', title: 'Read from its first bytes: its name does not say what it is · Metadata says why' } : null),
    key(e, m) {
      if (m === 'source' || state.asCard) return hex?.key(e) ?? false;
      if (e.altKey || e.metaKey) return false;
      if (e.ctrlKey) {
        if (e.key === '=' || e.key === '+') zoomTo(stepPdfZoom(state.zoom, 1));
        else if (e.key === '-') zoomTo(stepPdfZoom(state.zoom, -1));
        else if (e.key === '0') zoomTo('width');
        else return false;
        return true;
      }
      switch (e.key) {
        case '+':
        case '=':
          zoomTo(stepPdfZoom(state.zoom, 1));
          return true;
        case '-':
          zoomTo(stepPdfZoom(state.zoom, -1));
          return true;
        case '0':
          zoomTo('width');
          return true;
        case '1':
          zoomTo(1);
          return true;
        case 'Home':
          goTo(0);
          return true;
        case 'End':
          goTo(count - 1);
          return true;
        case 'PageDown':
        case 'ArrowRight':
          goTo(Math.max(0, shownPage) + 1);
          return true;
        case 'PageUp':
        case 'ArrowLeft':
          goTo(Math.max(0, shownPage) - 1);
          return true;
        default:
          return false;
      }
    },
    parts: (m) => (m === 'source' || state.asCard ? ensureHex().parts() : page ? pagesTree : null),
    floor: { on: () => state.asCard, set: (on) => setCard(on) },
    panelKey: () => `${mode}:${state.asCard}:${hex?.selected() ?? ''}`,
    find: (m) => (m === 'rendered' && !state.asCard ? finder : null),
    exports: () => exportsOf,
    destroy() {
      destroyed = true;
      findRun += 1;
      if (frame) cancelAnimationFrame(frame);
      if (page) state.place = placeAt(layout, page.stage.scrollTop);
      for (const slot of [...slots.values()]) drop(slot);
      resize?.disconnect();
      hex?.destroy();
      hex = null;
      page = null;
      host = null;
      if (matches) {
        highlights()?.delete(FIND_HIGHLIGHT);
        highlights()?.delete(FIND_CURRENT_HIGHLIGHT);
      }
      setup.opened.destroy();
    },
  };
}
