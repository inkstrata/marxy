// Layout-shift measurement for the aesthetics gate (B-01): block snapshots keyed by provenance, the
// moved area between two of them, and the report the gate reads. Copied unchanged from
// render/headless.ts, which B-02 deletes once the gate renders through the app (gate-entry.ts).

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

export interface BlockRect {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const BLOCK_DISPLAYS: ReadonlySet<string> = new Set(['block', 'table', 'list-item', 'flow-root']);
/** Same 0.5 px band as the grid check — subpixel paint is not a shift. */
const MOVE_EPS = 0.5;

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

export function finishShift(snaps: readonly BlockRect[][]): LayoutShift {
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
