// The article, mounted progressively (A-02). One per article: the per-article view of Phase B
// (`RenderedView`, ADR-0037 as amended) owns it as it stands, and until then app.ts keeps the one for
// `#doc` beside the typesetter.
//
// A large document is still parsed and rendered once (ADR-0003); what changes is how much of the
// rendered HTML is in the page before first text. Only the blocks that fill the first screens (or the
// screens from a landing byte down) go in at once; the rest is appended below in idle-time chunks, and
// the grid pass, the typesetter and the reading position work on the part that is there. The reason is
// the style and layout of the whole article, which at 1 MB cost seconds before anything could paint
// (docs/research/audit-2026-10/05-performance-audit.md §11.2), and the restyle the bundled fonts force
// when they arrive, which scales with what is in the article when they do.
//
// Under the threshold, which every corpus file but the long reference is, the HTML is assigned in one
// step exactly as before and `complete` resolves at once.

import { whenIdle } from '../startup/idle-work.ts';

export interface ProgressiveMount {
  /** Resolves when every top-level block is in the article, or when the mount is cancelled. */
  readonly complete: Promise<void>;
  /** True when the whole document is in the article. */
  isComplete(): boolean;
  /** Appends synchronously until the block containing `byte` and `screens` screens below it are in. */
  ensureThrough(byte: number): void;
  /** Stops appending; nothing more is added (a new open, a teardown). */
  cancel(): void;
}

export interface ProgressiveOptions {
  /**
   * Under this `html.length` the whole of it is assigned in one step, as before. Despite the name it
   * counts UTF-16 code units of the rendered HTML, not source bytes: 64 KiB of HTML is about 53 KB of
   * prose source (15-prose-volume.md renders to 62,496 and stays under), and every corpus file but
   * 32-long-reference.md (478,964) is under it.
   */
  readonly thresholdBytes?: number;
  /** How many screens of blocks go in before first text, below the landing block when there is one. */
  readonly screens?: number;
  /** A byte offset that must be in the first append, with `screens` screens below its block. */
  readonly landing?: number;
  /**
   * Run once on the parsed blocks before any of them reaches the page (the image pass that drops a
   * `src` that is not a local asset, so nothing is fetched). Under the threshold it runs on the article.
   */
  readonly prepare?: (parsed: HTMLElement) => void;
  /** Idle chunks start only once this settles (the app holds them until first text has painted). */
  readonly start?: Promise<unknown>;
  /** After each append past the first: the top-level elements it added, in order. */
  readonly onChunk?: (added: readonly HTMLElement[]) => void;
}

export const DEFAULT_THRESHOLD = 65_536;
const DEFAULT_SCREENS = 2;
/** Nodes moved between height reads while the first screens fill: one layout per batch, not per node. */
const FILL_BATCH = 16;
/** Each idle chunk's budget, its moves and the layout they cost together (A-02). */
const CHUNK_MS = 8;

export function mountProgressively(article: HTMLElement, html: string, opts: ProgressiveOptions = {}): ProgressiveMount {
  const threshold = opts.thresholdBytes ?? DEFAULT_THRESHOLD;
  if (html.length < threshold) {
    article.innerHTML = html;
    opts.prepare?.(article);
    return whole();
  }
  // An inert document: nothing in it loads, runs or is styled until it is moved into the page.
  const parsed = document.implementation.createHTMLDocument('').body;
  parsed.innerHTML = html;
  opts.prepare?.(parsed);
  article.replaceChildren();

  const screens = opts.screens ?? DEFAULT_SCREENS;
  let cancelled = false;
  let done = false;
  let resolveComplete!: () => void;
  const complete = new Promise<void>((resolve) => { resolveComplete = resolve; });
  const finish = (): void => {
    if (done) return;
    done = true;
    resolveComplete();
  };

  /** Moves the next node into the article; returns it when it is an element. */
  const moveOne = (): HTMLElement | null => {
    const node = parsed.firstChild!;
    article.appendChild(node);
    return node instanceof HTMLElement ? node : null;
  };

  /** The top-level element holding `byte`: the first whose range ends past it (a gap lands on the next). */
  const reaches = (el: HTMLElement, byte: number): boolean => {
    const end = el.getAttribute('data-marxy-e');
    return end !== null && Number(end) > byte;
  };

  /**
   * Appends until the block holding `byte` (or the article's start) is in with `screens` screens of
   * blocks below it. Up to that block nothing is measured; past it, one height read per batch.
   */
  const fill = (byte: number | undefined): HTMLElement[] => {
    const added: HTMLElement[] = [];
    let target: HTMLElement | null = null;
    if (byte !== undefined) {
      // Already in? Then that block is the target and only the screens below it may be missing.
      for (const el of article.children) {
        if (el instanceof HTMLElement && reaches(el, byte)) {
          target = el;
          break;
        }
      }
      while (target === null && parsed.firstChild !== null) {
        const el = moveOne();
        if (el === null) continue;
        added.push(el);
        if (reaches(el, byte)) target = el;
      }
    }
    const need = screens * window.innerHeight;
    while (parsed.firstChild !== null) {
      const last = article.lastElementChild;
      if (last !== null) {
        const top = (target ?? article).getBoundingClientRect().top;
        if (last.getBoundingClientRect().bottom - top >= need) break;
      }
      for (let i = 0; i < FILL_BATCH && parsed.firstChild !== null; i++) {
        const el = moveOne();
        if (el !== null) added.push(el);
      }
    }
    return added;
  };

  fill(opts.landing);
  if (parsed.firstChild === null) finish();

  let perChunk = 32;
  const step = (): void => {
    if (cancelled || done) return;
    const t0 = performance.now();
    const added: HTMLElement[] = [];
    for (let i = 0; i < perChunk && parsed.firstChild !== null; i++) {
      const el = moveOne();
      if (el !== null) added.push(el);
    }
    // The layout of what was moved is paid here, inside the chunk's budget, not in the next frame.
    void article.lastElementChild?.getBoundingClientRect();
    const spent = performance.now() - t0;
    // Size the next chunk so moving and laying it out take about the budget.
    perChunk = Math.max(4, Math.min(4096, Math.round(perChunk * (CHUNK_MS / Math.max(spent, 0.5)))));
    if (added.length > 0) opts.onChunk?.(added);
    if (parsed.firstChild === null) finish();
    else void whenIdle(step);
  };
  if (!done) void Promise.resolve(opts.start).then(() => whenIdle(step), () => whenIdle(step));

  return {
    complete,
    isComplete: () => done && !cancelled,
    ensureThrough(byte) {
      if (cancelled || done) return;
      const added = fill(byte);
      if (added.length > 0) opts.onChunk?.(added);
      if (parsed.firstChild === null) finish();
    },
    cancel() {
      if (done) return;
      cancelled = true;
      parsed.replaceChildren();
      finish();
    },
  };
}

/** The whole document is already in: nothing to append. */
function whole(): ProgressiveMount {
  return {
    complete: Promise.resolve(),
    isComplete: () => true,
    ensureThrough() {},
    cancel() {},
  };
}
