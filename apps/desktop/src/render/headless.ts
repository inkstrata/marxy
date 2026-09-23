// Headless render entry: one function a Playwright gate calls to typeset a document without Tauri.
import { parseMarkdown } from '@marxy/core';
import { renderDocumentSafeHtml, type RenderResult } from '@marxy/core/src/render/index.ts';
import { attach, snapToGrid, type TypesetStats } from '@marxy/typeset';
import { resolveVariantPreference, type VariantPreference } from '@marxy/theme';
import { applyWeightOffset, platformOf } from '../theme/offset.ts';
import { buildBlocks, buildNodeMap } from './post.ts';
import { createStubShell } from './stub.ts';

export interface MarxyRenderOpts {
  theme?: string;
  /** Resolved palette: `auto` follows `prefers-color-scheme` (docs/design/05-theme.md §Loader). */
  variant: VariantPreference;
  width: number;
  size?: number;
  typeset?: boolean;
}

/** In-page layout-shift report. `observed` is never implied by `cls === 0`. */
export interface LayoutShift {
  readonly cls: number;
  readonly observed: boolean;
  readonly snapshots: number;
  readonly reason?: string;
  /** snaps[0]→[1]; unexpected font/image movement after size and grid have settled. */
  readonly fontWindow?: number;
  /** Last two snapshots; unexpected movement after typeset has painted. */
  readonly settleWindow?: number;
}

export interface MarxyRenderResult {
  readonly removed: RenderResult['removed'];
  readonly stats: TypesetStats & LayoutShift;
}

export interface BlockRect {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Body size → even line box, same table as packages/theme/test/grid.test.mjs, so half a line is whole pixels. */
const LINE_BOX: Readonly<Record<number, number>> = { 16: 24, 20: 30, 24: 36, 28: 42 };
const BLOCK_DISPLAYS: ReadonlySet<string> = new Set(['block', 'table', 'list-item', 'flow-root']);
/** Same 0.5 px band as the grid check — subpixel paint is not a shift. */
const MOVE_EPS = 0.5;

function emptyStats(): TypesetStats {
  return { paragraphs: 0, typeset: 0, fallbacks: 0, short: 0, viewportMs: 0, hyphenationLoadMs: 0, reasons: {} };
}

/** WebKit does not implement PerformanceObserver `layout-shift`; claiming that API would silently report 0. */
export function assertCanObserveShift(): void {
  if (typeof Element === 'undefined' || typeof Element.prototype.getBoundingClientRect !== 'function') {
    throw new Error('layout shift: getBoundingClientRect is missing; cannot observe block movement');
  }
  if (typeof document.fonts === 'undefined' || document.fonts.ready == null) {
    throw new Error('layout shift: document.fonts.ready is missing; cannot observe font-swap shift');
  }
}

function viewport(): { w: number; h: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!(w > 0 && h > 0)) throw new Error('layout shift: viewport has no area; cannot observe');
  return { w, h };
}

/** Provenance-keyed boxes of every block-level element the grid check also walks. */
export function snapshotBlocks(root: Element): BlockRect[] {
  assertCanObserveShift();
  const out: BlockRect[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[data-marxy-s]')) {
    const display = getComputedStyle(el).display;
    if (!BLOCK_DISPLAYS.has(display)) continue;
    const r = el.getBoundingClientRect();
    out.push({
      key: `${el.getAttribute('data-marxy-s')}-${el.getAttribute('data-marxy-e')}-${el.tagName}`,
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
    });
  }
  return out;
}

function moved(a: BlockRect, b: BlockRect): boolean {
  return (
    Math.abs(a.x - b.x) > MOVE_EPS ||
    Math.abs(a.y - b.y) > MOVE_EPS ||
    Math.abs(a.w - b.w) > MOVE_EPS ||
    Math.abs(a.h - b.h) > MOVE_EPS
  );
}

function unionRect(a: BlockRect, b: BlockRect): BlockRect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  return {
    key: a.key,
    x: x1,
    y: y1,
    w: Math.max(a.x + a.w, b.x + b.w) - x1,
    h: Math.max(a.y + a.h, b.y + b.h) - y1,
  };
}

function clipToViewport(r: BlockRect, vp: { w: number; h: number }): BlockRect | null {
  const x1 = Math.max(r.x, 0);
  const y1 = Math.max(r.y, 0);
  const x2 = Math.min(r.x + r.w, vp.w);
  const y2 = Math.min(r.y + r.h, vp.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { key: r.key, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Sweep-line union area of axis-aligned rects, so overlapping shifts are not counted twice. */
export function unionArea(rects: readonly BlockRect[]): number {
  if (rects.length === 0) return 0;
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < ys.length - 1; i++) {
    const y1 = ys[i];
    const y2 = ys[i + 1];
    const height = y2 - y1;
    if (height <= 0) continue;
    const xs: [number, number][] = [];
    for (const r of rects) {
      if (r.y < y2 && r.y + r.h > y1) xs.push([r.x, r.x + r.w]);
    }
    xs.sort((a, b) => a[0] - b[0]);
    let start = 0;
    let end = 0;
    let covering = false;
    for (const [x1, x2] of xs) {
      if (!covering) {
        start = x1;
        end = x2;
        covering = true;
        continue;
      }
      if (x1 > end) {
        area += (end - start) * height;
        start = x1;
        end = x2;
      } else {
        end = Math.max(end, x2);
      }
    }
    if (covering) area += (end - start) * height;
  }
  return area;
}

/** Union of moved block area between two snapshots, as a fraction of the viewport. */
export function movedFraction(before: readonly BlockRect[], after: readonly BlockRect[]): number {
  const vp = viewport();
  const prev = new Map(before.map((r) => [r.key, r]));
  const unions: BlockRect[] = [];
  for (const r of after) {
    const p = prev.get(r.key);
    if (!p || !moved(p, r)) continue;
    const u = clipToViewport(unionRect(p, r), vp);
    if (u) unions.push(u);
  }
  return unionArea(unions) / (vp.w * vp.h);
}

function takeSnapshot(article: HTMLElement, snaps: BlockRect[][]): void {
  void article.offsetHeight;
  const snap = snapshotBlocks(article);
  if (snaps.length === 0 && article.childElementCount > 0 && snap.length === 0) {
    throw new Error('layout shift: article has children but no block rects; cannot observe');
  }
  snaps.push(snap);
}

function frames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function fontLoadSpec(family: string, weight: string, style: string, size: string): string {
  return `${style} ${weight} ${size} ${family}`;
}

/** Every face the article's own elements report, so FreeType cannot swap after `fonts.ready` alone. */
export async function awaitArticleFonts(article: HTMLElement): Promise<void> {
  const specs = new Set<string>();
  const note = (el: Element) => {
    const cs = getComputedStyle(el);
    specs.add(fontLoadSpec(cs.fontFamily, cs.fontWeight, cs.fontStyle, cs.fontSize));
  };
  note(article);
  for (const el of article.querySelectorAll('*')) note(el);
  await Promise.all([...specs].map((font) => document.fonts.load(font)));
  await document.fonts.ready;
}

/** Reserved boxes only — unreserved images may still move the font/image window by design. */
export async function awaitReservedImages(article: HTMLElement): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const img of article.querySelectorAll<HTMLImageElement>('img[width][height][src]')) {
    if (img.complete && img.naturalWidth > 0) continue;
    if (typeof img.decode === 'function') {
      waits.push(img.decode().then(() => undefined, () => undefined));
    } else {
      waits.push(
        new Promise((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
      );
    }
  }
  await Promise.all(waits);
}

function applyGrid(article: HTMLElement, lineBox: number): void {
  snapToGrid(article, lineBox);
  void article.offsetHeight;
}

/**
 * Two grid passes with a layout flush between them, so padding applied on the first pass is
 * visible to the second. The measured CLS window starts after this, not during it.
 */
function settleGrid(article: HTMLElement, lineBox: number): void {
  applyGrid(article, lineBox);
  applyGrid(article, lineBox);
}

/**
 * Flush `--marxy-size-body` / `--marxy-line-box` and load the body face at that size before
 * innerHTML, so the first paint of the document is already at the matrix size. A 20 → 24
 * reflow after innerHTML is a harness artefact, not a page a reader of a 21 px document sees.
 */
async function settleSize(article: HTMLElement, size: number): Promise<number> {
  const expected = LINE_BOX[size] ?? LINE_BOX[20];
  if (expected === undefined) throw new Error(`layout shift: no line box token for size ${size}`);
  void document.documentElement.offsetHeight;
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.textContent = 'Hg';
  article.append(probe);
  void article.offsetHeight;
  await document.fonts.ready;
  const lineBox = parseFloat(getComputedStyle(article).lineHeight);
  const fontSize = parseFloat(getComputedStyle(article).fontSize);
  probe.remove();
  if (Math.abs(lineBox - expected) > 0.5 || Math.abs(fontSize - size) > 0.5) {
    throw new Error(
      `layout shift: size tokens did not settle (line-box ${lineBox}px, font ${fontSize}px; expected ${expected}px / ${size}px)`,
    );
  }
  return expected;
}

function finishShift(snaps: readonly BlockRect[][]): LayoutShift {
  if (snaps.length < 3) {
    throw new Error(
      `layout shift: ${snaps.length} snapshot(s); need after size/grid settle, fonts.ready and the last typeset pass`,
    );
  }
  // Counted intervals, in order:
  //   snaps[0]→[1]  font/image window (ADR-0014). Size tokens, content fonts, and the grid
  //                 have already settled; snapToGrid is not run again in this interval, so a
  //                 non-idempotent grid pass cannot masquerade as shift. A swap here is a
  //                 face that loaded after we thought fonts were ready, or a late image
  //                 whose box was not reserved. Removing the reservation loop still fails
  //                 --selftest (movedFraction on a late canvas image); observed:false still
  //                 fails. If this interval is often 0 on the corpus, that is the page a
  //                 reader of an already-sized document sees, not a dead check.
  //   typeset       excluded. The breaker may change a line count (14-marxy-plan at 960/1280);
  //                 ADR-0014's window is fonts and images, not Knuth–Plass. That paint is
  //                 flushed before the post-typeset snapshot so it does not leak into settle.
  //   last two      settle frame after the set page. A late image after typeset still fails.
  const fontSwap = movedFraction(snaps[0], snaps[1]);
  const last = snaps[snaps.length - 1];
  const afterTypeset = snaps.length >= 4 ? movedFraction(snaps[snaps.length - 2], last) : 0;
  return {
    cls: fontSwap + afterTypeset,
    observed: true,
    snapshots: snaps.length,
    fontWindow: fontSwap,
    settleWindow: afterTypeset,
  };
}

/**
 * Same post-passes as the app (node map, grid, typesetter) against a stub shell. Resolves after
 * fonts and — when typesetting — after every paragraph has been considered, so rag is measured on
 * the set page rather than the viewport-only first pass.
 */
export async function marxyRender(source: string, opts: MarxyRenderOpts): Promise<MarxyRenderResult> {
  assertCanObserveShift();
  const shell = createStubShell();

  const root = document.documentElement;
  const variant = resolveVariantPreference(
    opts.variant,
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  root.dataset.marxyVariant = variant;
  const size = opts.size ?? 20;
  const lineToken = LINE_BOX[size];
  if (size !== 20 && lineToken !== undefined) {
    root.style.setProperty('--marxy-size-body', `${size}px`);
    root.style.setProperty('--marxy-line-box', `${lineToken}px`);
  } else {
    root.style.removeProperty('--marxy-size-body');
    root.style.removeProperty('--marxy-line-box');
  }
  if (opts.theme) {
    let extra = document.getElementById('marxy-theme-override');
    if (extra === null) {
      extra = document.createElement('style');
      extra.id = 'marxy-theme-override';
      document.head.append(extra);
    }
    extra.textContent = opts.theme;
  }

  const main = document.getElementById('marxy-main');
  if (main) main.style.width = `${opts.width}px`;

  applyWeightOffset(root, platformOf(navigator.userAgent), null);

  const file = 'document.md';
  const ast = parseMarkdown(source, { file });
  const { html, removed } = renderDocumentSafeHtml(ast);
  const article = document.getElementById('doc');
  if (article === null) throw new Error('headless render: #doc is missing');

  const lineBox = await settleSize(article, size);
  article.innerHTML = html;

  // Reserve image boxes from the stub decoder before the first snapshot, so a data: image
  // cannot shift the page — the measurement then sees the page a reader would see.
  for (const img of article.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (src === null) continue;
    const url = src.startsWith('data:') ? src : shell.assetUrl(src);
    const box = await shell.imageSize(url);
    if (box === null) continue;
    img.setAttribute('width', String(box.width));
    img.setAttribute('height', String(box.height));
  }

  const nodeMap = buildNodeMap(ast);
  const snaps: BlockRect[][] = [];
  // Content faces (italic, mono, heading weights) load on innerHTML; wait for each face the
  // article uses and every reserved image decode before the first scored snapshot.
  await awaitArticleFonts(article);
  await awaitReservedImages(article);
  settleGrid(article, lineBox);
  await frames();
  settleGrid(article, lineBox);
  takeSnapshot(article, snaps);

  await document.fonts.ready;
  takeSnapshot(article, snaps);

  let stats: TypesetStats = emptyStats();
  if (opts.typeset !== false) {
    // Same option set as apps/desktop/src/app.ts typesetDocument (package defaults for hyphenate and hanging).
    const controller = attach(article, {
      lineBox,
      glueStretchEm: 0.6,
      lastLineMinWidth: 0.33,
      onPass: () => snapToGrid(article, lineBox),
    });
    await controller.ready;
    await controller.done;
    stats = controller.stats;
    // Flush the breaker's paint (and the grid pass it triggers) before the post-typeset
    // snapshot. That interval is excluded; leaking it into the settle frame would charge
    // Knuth–Plass as CLS. A late image after this still moves the last two snapshots.
    settleGrid(article, lineBox);
    await frames();
    settleGrid(article, lineBox);
  }

  takeSnapshot(article, snaps);
  await frames();
  takeSnapshot(article, snaps);
  buildBlocks(article, nodeMap);
  return { removed, stats: { ...stats, ...finishShift(snaps) } };
}

declare global {
  interface Window {
    marxyRender: typeof marxyRender;
    marxyLayoutShift: {
      snapshot: typeof snapshotBlocks;
      movedFraction: typeof movedFraction;
      assertCanObserve: typeof assertCanObserveShift;
      finishShift: typeof finishShift;
    };
  }
}

window.marxyRender = marxyRender;
window.marxyLayoutShift = {
  snapshot: snapshotBlocks,
  movedFraction,
  assertCanObserve: assertCanObserveShift,
  finishShift,
};
