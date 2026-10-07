// The aesthetics gate's render entry (B-01): the real app, started with startApp over a memory shell,
// renders one corpus file at a given width, variant and text size, and reports layout shift on the page
// a reader sees (highlighting, KaTeX, notices and all). Loaded only by gate.html, never by main.ts.
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { startApp } from '../app.ts';
import { type Call, createMemoryShell } from '../shell/memory.ts';
import {
  assertCanObserveShift,
  awaitArticleFonts,
  awaitReservedImages,
  type BlockRect,
  finishShift,
  type LayoutShift,
  movedFraction,
  snapshotBlocks,
} from './layout-shift.ts';

export interface GateRenderOpts {
  readonly variant: 'dark' | 'light' | 'auto';
  readonly width: number;
  readonly size?: number;
  /** A theme stylesheet adopted over the default theme, as a user theme would be. */
  readonly theme?: string;
  /** `fixtures/corpus/image.png` as base64; when absent it is fetched beside the page, if served. */
  readonly image?: string;
  /**
   * A second document, opened as soon as the first has shown its first text, while a large first
   * document's later chunks are still pending; the render then measures this one. Tests use it to
   * see that a stale document's typesetter never marks `typeset_done` (B-02).
   */
  readonly reopen?: string;
}

export interface GateRenderResult {
  readonly stats: LayoutShift;
}

/** Where the document and its sibling image live in the memory shell, so `image.png` resolves. */
const DOCUMENT = '/corpus/document.md';
const IMAGE = '/corpus/image.png';
const SECOND = '/corpus/second.md';
/** The memory shell's `configPaths().config`. */
const CONFIG = '/config';
/** How long the typesetter may take to consider every paragraph before the render is refused. */
const TYPESET_DONE_CAP_MS = 10_000;
/** Past app.ts's SNAP_INTERVAL_MS (250), so the last coalesced grid snap is scheduled before this fires. */
const SNAP_SETTLE_MS = 300;

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function imageBytes(opts: GateRenderOpts): Promise<Uint8Array | null> {
  if (opts.image !== undefined) return decodeBase64(opts.image);
  try {
    const res = await fetch(new URL('image.png', location.href));
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function configToml(opts: GateRenderOpts): string {
  const lines = [`variant = "${opts.variant}"`];
  if (opts.size !== undefined) lines.push(`size = ${opts.size}`);
  return `${lines.join('\n')}\n`;
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function frames(): Promise<void> {
  await frame();
  await frame();
}

function takeSnapshot(article: HTMLElement, snaps: BlockRect[][]): void {
  void article.offsetHeight;
  const snap = snapshotBlocks(article);
  if (snaps.length === 0 && article.childElementCount > 0 && snap.length === 0) {
    throw new Error('layout shift: article has children but no block rects; cannot observe');
  }
  snaps.push(snap);
}

/** Polls once a frame until the shell has recorded one of `names`; refuses after the cap. */
async function awaitMark(calls: readonly Call[], names: readonly string[]): Promise<void> {
  const t0 = performance.now();
  while (!calls.some((c) => c.method === 'mark' && names.includes(c.args[0] as string))) {
    if (performance.now() - t0 > TYPESET_DONE_CAP_MS) {
      throw new Error(`gate render: no ${names.join(' or ')} mark within ${TYPESET_DONE_CAP_MS} ms`);
    }
    await frame();
  }
}

let rendered = false;
let recorded: readonly Call[] = [];

/**
 * One render per page: the app keeps module state, so the gate loads a fresh page for each. Resolves
 * once the whole document is in the article, its fonts and reserved images are loaded and the
 * typesetter has considered every paragraph. The snapshot windows are the ones the gate has always scored.
 */
async function render(source: string, opts: GateRenderOpts): Promise<GateRenderResult> {
  if (rendered) throw new Error('gate render: one render per page; load gate.html again');
  rendered = true;
  assertCanObserveShift();

  const files: Record<string, Uint8Array> = {
    [DOCUMENT]: new TextEncoder().encode(source),
    [CONFIG]: new TextEncoder().encode(configToml(opts)),
  };
  if (opts.reopen !== undefined) files[SECOND] = new TextEncoder().encode(opts.reopen);
  const image = await imageBytes(opts);
  if (image !== null) files[IMAGE] = image;
  const shell = createMemoryShell(files);
  recorded = shell.calls;

  const main = document.getElementById('marxy-main');
  if (main === null) throw new Error('gate render: #marxy-main is missing');
  main.style.width = `${opts.width}px`;
  if (opts.theme) adoptRuntimeSheet(document, 'marxy-theme-override', opts.theme);

  const handle = await startApp(shell, { argv: [DOCUMENT] });
  await handle.ready;
  if (opts.reopen !== undefined) await handle.open(SECOND);
  // A large document is appended in idle chunks after first text (A-02); measure the whole article.
  await handle.contentComplete();

  const article = document.getElementById('doc');
  if (article === null) throw new Error('gate render: #doc is missing');
  const snaps: BlockRect[][] = [];
  await awaitArticleFonts(article);
  await awaitReservedImages(article);
  takeSnapshot(article, snaps);

  await document.fonts.ready;
  takeSnapshot(article, snaps);

  // A document with no text (11-empty.md) is the app's `no_text`: nothing is typeset, so nothing is done.
  await awaitMark(shell.calls, ['typeset_done', 'no_text']);
  // The typesetter's background passes are put on the grid by a coalesced snap: a timer of at most
  // SNAP_INTERVAL_MS (250 ms in app.ts), then a frame. A timer with a later deadline fires after it,
  // and the frames after that one follow the snap's frame, so the page measured is the settled page
  // whatever the load. Without this, a loaded machine measured 15-prose-volume.md before its last snap.
  await new Promise((resolve) => setTimeout(resolve, SNAP_SETTLE_MS));
  await frames();
  await frames();
  takeSnapshot(article, snaps);
  await frames();
  takeSnapshot(article, snaps);
  return { stats: finishShift(snaps) };
}

declare global {
  interface Window {
    marxyGate: {
      render: typeof render;
      /** The measurement helpers, for the gate's crafted layout-shift selftest on this page. */
      layoutShift: {
        snapshot: typeof snapshotBlocks;
        movedFraction: typeof movedFraction;
        assertCanObserve: typeof assertCanObserveShift;
        finishShift: typeof finishShift;
      };
      /** The memory shell's recorded calls for the render on this page, for tests. */
      calls(): readonly Call[];
    };
  }
}

window.marxyGate = {
  render,
  layoutShift: { snapshot: snapshotBlocks, movedFraction, assertCanObserve: assertCanObserveShift, finishShift },
  calls: () => recorded,
};
