// The image page: an image shown whole, to fit and never enlarged past 100 %; 100 %; zoom by
// keys and the wheel, at the pointer; pan by dragging. Pixels draw square from 300 %, a grid sits between them past
// 800 %, and from 400 % the bar says the pixel under the pointer. Transparent pixels sit over checks, with Light and Dark
// grounds for the tab. An EXIF orientation is applied. ← and → step through the folder's images in the same tab, with
// Back; the strip shows when the folder holds three or more. The panel's fourth card is Image, the metadata slot EXIF.
// Source is the bytes: the hex view, or for an SVG its text. An image this system cannot draw falls to the file card.
// The cursor's parts are the picture (`#picture`) and the Image card's facts (`#facts/size`).
import { accountKey } from '../frame/account.ts';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { viewerOf } from '@marxy/core/src/kind/registry.ts';
import { extensionOf, hex2 } from '@marxy/core/src/viewer/bytes.ts';
import { fitScale, gridShown, orientedSize, percent, pixelsSquare, readoutShown, stepZoom } from '@marxy/core/src/viewer/image.ts';
import { svgScripts } from '@marxy/core/src/viewer/image-facts.ts';
import type { ImageFacts } from '@marxy/shell-api';
import type { AppShell } from '../app-types.ts';
import { el, segmented } from '../frame/dom.ts';
import { icon } from '../frame/icons.ts';
import { byteCard, exifCard, factsCard, imageCard, mayBeClear, readingCard } from './cards.ts';
import { createCardViewer } from './card.ts';
import { formatName, type ViewedFile } from './file.ts';
import { aimAt, aimedAt } from './aim.ts';
import { asItIs } from './exports.ts';
import { createHexView, type HexView } from './hex.ts';
import { viewerChanged, nextViewerId } from './signal.ts';
import { tabState } from './tab-state.ts';
import { treeParts } from '../parts/moves.ts';
import { bytesBox, textBox } from '../parts/xray-box.ts';
import { offsetLabel } from '@marxy/core/src/viewer/hex.ts';
import { imageStructure, type ImageStructure } from './image-chunks.ts';
import { kindRow, kindSection } from './kind-sections.ts';
import type { CardContext } from '../frame/cards/types.ts';
import type { PaneViewer, PartTree, PartUnit, ViewerPlace, ViewMode } from './types.ts';

export interface ImageOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  /** What the shell read of the image; null when it has no reader (the page draws what the webview loads). */
  readonly facts: ImageFacts | null;
  /** The pane the page is drawn in: its tab keeps the page's state. None for a page drawn inside another (an archive's preview): it steps through no folder. */
  readonly paneHost?: HTMLElement;
  /** An SVG's text, from its store: Read draws these bytes, so an edit in Source shows when Read is back. */
  readonly text?: () => Uint8Array;
  /** Where the reader was in the page this one replaces (the file changed on disk). */
  readonly place?: ViewerPlace;
  /** Drawn inside another page (an archive's preview): the host page's line of meta is the page's only one. */
  readonly embedded?: boolean;
}

/** Extensions the webview draws: a tile in the strip shows these as pictures, the rest by their name. */
const WEBVIEW_DRAWS = new Set(['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur', 'svg']);
/** The most of an SVG drawn from the page's own bytes; past it, from the file. */
const SVG_INLINE_MAX = 8 * 1024 * 1024;

/**
 * A query naming the file's bytes as they are now, so a page made again after a change on disk is not drawn from the
 * webview's copy of the old picture. Not for a blob or data URL, which already names its bytes and takes no query.
 */
const freshFor = (file: ViewedFile) => (url: string): string => (/^(blob|data):/.test(url) || file.mtimeMs === null ? '' : `v=${file.mtimeMs}-${file.size}`);

/** Per pane: its image folder as last listed. */
const listed = new WeakMap<HTMLElement, { readonly dir: string; readonly images: readonly string[] }>();

/** ← and → through the images in a file's folder, in its pane's tab, with Back: the image page's, and the file card's. */
export interface FolderSteps {
  /** The folder's images, sorted as the strip shows them, or null before `load`. */
  images(): readonly string[] | null;
  /** Reads the folder, once; `onListed` runs when a listing other than the one shown lands. */
  load(onListed?: () => void): void;
  /** Opens the image `by` along; false when the folder holds no other. */
  step(by: 1 | -1): boolean;
  go(next: string): void;
  /** A plain ← or → in Read steps; true when it did. */
  key(e: KeyboardEvent): boolean;
}

export function folderSteps(shell: AppShell, path: string, paneHost: HTMLElement): FolderSteps {
  const dir = dirname(path);
  const known = listed.get(paneHost);
  // The listing the last page in this pane read: a step pressed before this page has read the folder still steps.
  let images: readonly string[] | null = known?.dir === dir && known.images.includes(path) ? known.images : null;
  let asked = false;
  const go = (next: string): void => {
    if (next === path && aimedAt(paneHost) === undefined) return;
    aimAt(paneHost, next);
  };
  const step = (by: 1 | -1): boolean => {
    const all = images ?? [path];
    if (all.length < 2) return false;
    // Keys pressed faster than the pages open count from the image last asked for, not from the one still shown.
    const from = aimedAt(paneHost);
    const at = Math.max(0, all.indexOf(from !== undefined && all.includes(from) ? from : path));
    go(all[(at + by + all.length) % all.length]!);
    return true;
  };
  return {
    images: () => images,
    load(onListed) {
      if (asked) return;
      asked = true;
      images ??= [path];
      void shell
        .readDir(dir)
        .then((entries) => {
          const found = entries.filter((s) => !s.isDir && viewerOf(s.path) === 'image').map((s) => s.path);
          if (!found.includes(path)) found.push(path);
          const sorted = found.sort((a, b) => basename(a).localeCompare(basename(b), 'en', { sensitivity: 'base', numeric: true }));
          const same = images !== null && images.length === sorted.length && images.every((p, i) => p === sorted[i]);
          images = sorted;
          listed.set(paneHost, { dir, images: sorted });
          if (!same) onListed?.();
        })
        .catch(() => {});
      // The strip's pictures come from the folder: scoped for this session, as a document's images are.
      void shell.allowAssetScope(dir).catch(() => {});
    },
    step,
    go,
    key(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === 'ArrowRight') return step(1);
      if (e.key === 'ArrowLeft') return step(-1);
      return false;
    },
  };
}

/** A page with no pane of its own: the one image, no folder read and no step. */
function stillSteps(path: string): FolderSteps {
  return { images: () => [path], load() {}, step: () => false, go() {}, key: () => false };
}

function dataUrl(bytes: Uint8Array, type: string): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(s)}`;
}

export function createImageViewer(o: ImageOptions): PaneViewer {
  const { shell, file, facts, paneHost } = o;
  const path = file.path;
  // An SVGZ is drawn as the SVG the shell unpacks it to; its Source is still its packed bytes.
  const svg = facts?.format === 'svg' || facts?.format === 'svgz' || ['svg', 'svgz'].includes(extensionOf(path));
  const binary = o.text === undefined;
  // Embedded, the page's state is its own: tabState keeps it by this element, which no tab names.
  const stateHost = paneHost ?? document.createElement('div');
  const state = () => tabState(stateHost, path);
  const fresh = freshFor(file);

  let host: HTMLElement | null = null;
  let mode: ViewMode = 'rendered';
  const id = nextViewerId();
  let hex: HexView | null = null;
  let card: PaneViewer | null = null;
  let failed = false;
  const steps = paneHost ? folderSteps(shell, path, paneHost) : stillSteps(path);
  let natural: { w: number; h: number } | null = null;
  let shown: { z: number; fit: boolean } | null = null;
  let last = 0;
  let canvas: ImageData | null | 'none' = null;
  let resize: ResizeObserver | null = null;
  let page: {
    root: HTMLElement;
    stage: HTMLElement;
    box: HTMLElement;
    img: HTMLImageElement;
    grid: HTMLElement;
    zoomValue: HTMLElement;
    readout: HTMLElement;
    sizeSeg: HTMLElement;
  } | null = null;
  // Pixels lent across origins, for the readout. Off when the shell would not lend them: the picture still draws.
  let crossOrigin = true;
  /** The stage's scroll to put back once the picture is laid out at the kept zoom (the file changed on disk). */
  let scrollBack = o.place?.scroll ?? null;

  /**
   * The upright size the page draws: the facts' (sides swapped for orientations 5 to 8), else what the webview loaded. The
   * page never turns the pixels itself: the webview turns a JPEG by its EXIF, and a decoded PNG comes back upright, so
   * `orientation` is for the cards only.
   */
  function geometry(): { w: number; h: number } | null {
    if (facts && facts.width > 0 && facts.height > 0) return orientedSize(facts.width, facts.height, facts.orientation);
    return natural;
  }

  function source(): string {
    if (svg && o.text) {
      const bytes = o.text();
      if (bytes.length <= SVG_INLINE_MAX) return dataUrl(bytes, 'image/svg+xml');
    }
    const url = shell.fileUrl(path);
    const query = [facts?.show === 'decoded' ? 'decoded' : '', fresh(url)].filter(Boolean).join('&');
    return query ? `${url}?${query}` : url;
  }

  function folder(): void {
    steps.load(() => {
      if (mode === 'rendered' && host && page) draw();
    });
  }

  const step = (by: 1 | -1): void => void steps.step(by);
  const go = (next: string): void => steps.go(next);

  /** Whether a picture W by H spills the stage, which is what lets a drag pan it. */
  const overflows = (W: number, H: number): boolean => !!page && (W > Math.max(1, page.stage.clientWidth - 48) + 48 || H > Math.max(1, page.stage.clientHeight - 48) + 48);

  function apply(anchor?: { x: number; y: number }): void {
    if (!page) return;
    const g = geometry();
    if (!g) return;
    const st = state();
    const up = g;
    const room = { w: Math.max(1, page.stage.clientWidth - 48), h: Math.max(1, page.stage.clientHeight - 48) };
    const fit = fitScale(room.w, room.h, up.w, up.h);
    const z = st.zoom === 'fit' ? fit : st.zoom;
    const before = anchor && last > 0 ? { x: (page.stage.scrollLeft + anchor.x) / last, y: (page.stage.scrollTop + anchor.y) / last } : null;
    const W = Math.max(1, Math.round(up.w * z));
    const H = Math.max(1, Math.round(up.h * z));
    page.box.style.width = `${W}px`;
    page.box.style.height = `${H}px`;
    page.img.style.width = `${W}px`;
    page.img.style.height = `${H}px`;
    page.img.toggleAttribute('data-marxy-square', pixelsSquare(z) && !svg);
    const grid = gridShown(z) && !svg;
    page.grid.hidden = !grid;
    if (grid) page.grid.style.backgroundSize = `${z}px ${z}px`;
    page.zoomValue.textContent = percent(z);
    for (const b of page.sizeSeg.querySelectorAll('button')) {
      const v = b.dataset.marxyZoom;
      b.setAttribute('aria-checked', String(v === 'fit' ? st.zoom === 'fit' : st.zoom === 1));
    }
    page.root.toggleAttribute('data-marxy-zoomed', overflows(W, H));
    if (before && anchor) {
      page.stage.scrollLeft = before.x * z - anchor.x;
      page.stage.scrollTop = before.y * z - anchor.y;
    } else if (scrollBack) {
      page.stage.scrollLeft = scrollBack.left;
      page.stage.scrollTop = scrollBack.top;
      scrollBack = null;
    } else if (st.zoom !== 'fit') {
      page.stage.scrollLeft = (page.stage.scrollWidth - page.stage.clientWidth) / 2;
      page.stage.scrollTop = (page.stage.scrollHeight - page.stage.clientHeight) / 2;
    }
    if (!readoutShown(z)) page.readout.replaceChildren();
    last = z;
    const nowShown = { z, fit: st.zoom === 'fit' };
    if (!shown || shown.z !== nowShown.z || shown.fit !== nowShown.fit) {
      shown = nowShown;
      viewerChanged();
    }
  }

  function zoomTo(z: 'fit' | number, anchor?: { x: number; y: number }): void {
    state().zoom = z;
    apply(anchor);
  }
  const zoomBy = (dir: 1 | -1, anchor?: { x: number; y: number }): void => zoomTo(stepZoom(last || 1, dir), anchor);

  /** The pixel under the pointer, from 400 %: its x and y in the upright image and its colour, with alpha when not opaque. */
  function readPixel(e: PointerEvent): void {
    if (!page) return;
    const g = geometry();
    if (!g || svg || !readoutShown(last)) {
      page.readout.replaceChildren();
      return;
    }
    const r = page.box.getBoundingClientRect();
    const up = g;
    const x = Math.floor((e.clientX - r.left) / last);
    const y = Math.floor((e.clientY - r.top) / last);
    if (x < 0 || y < 0 || x >= up.w || y >= up.h) {
      page.readout.replaceChildren();
      return;
    }
    if (canvas === null) {
      canvas = 'none';
      void pixels().then((p) => {
        canvas = p ?? 'none';
      });
      return;
    }
    if (canvas === 'none') return;
    // The pixels as drawn, upright, at their own size: the pointer's pixel scaled to them.
    const px = Math.min(canvas.width - 1, Math.floor((x * canvas.width) / up.w));
    const py = Math.min(canvas.height - 1, Math.floor((y * canvas.height) / up.h));
    const i = (py * canvas.width + px) * 4;
    const [rr, gg, bb, aa] = [canvas.data[i]!, canvas.data[i + 1]!, canvas.data[i + 2]!, canvas.data[i + 3]!];
    const swatch = el('span', 'marxy-imgbar-swatch');
    swatch.style.background = `rgba(${rr}, ${gg}, ${bb}, ${aa / 255})`;
    page.readout.replaceChildren(`x ${x} · y ${y} · `, swatch, `#${hex2(rr)}${hex2(gg)}${hex2(bb)}${aa < 255 ? ` · alpha ${aa}` : ''}`);
  }

  /** The image's pixels as the webview draws them (upright), read once. */
  async function pixels(): Promise<ImageData | null> {
    if (!page) return null;
    const img = page.img;
    try {
      // Drawn as the webview draws it (from-image: turned by its EXIF); a webview without the option draws it plainly.
      const source = await createImageBitmap(img, { imageOrientation: 'from-image' }).catch(() => img);
      const w = source instanceof HTMLImageElement ? img.naturalWidth : source.width;
      const h = source instanceof HTMLImageElement ? img.naturalHeight : source.height;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx || w === 0 || h === 0) return null;
      ctx.drawImage(source, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h);
    } catch {
      // Pixels lent across origins without leave: the readout stays empty rather than guess.
      return null;
    }
  }


  /** The page's caption: the format, and the size once the facts say it. */
  function caption(): string {
    const size = facts && facts.width > 0 && facts.height > 0 ? orientedSize(facts.width, facts.height, facts.orientation) : null;
    const name = formatName(facts?.format ?? (extensionOf(path) || 'image'));
    return size ? `${name} · ${size.w} × ${size.h}` : name;
  }

  function bar(): { readonly el: HTMLElement; readonly zoomValue: HTMLElement; readonly readout: HTMLElement; readonly sizeSeg: HTMLElement; readonly account: HTMLElement | null } {
    const st = state();
    const b = el('div', 'marxy-imgbar');
    const sizeSeg = segmented('Size', [['fit', 'Fit'], ['one', '100 %']] as const, st.zoom === 'fit' ? 'fit' : 'one', (v) => zoomTo(v === 'fit' ? 'fit' : 1));
    const [fitB, oneB] = sizeSeg.querySelectorAll('button');
    fitB?.setAttribute('data-marxy-zoom', 'fit');
    oneB?.setAttribute('data-marxy-zoom', 'one');
    if (st.zoom !== 'fit' && st.zoom !== 1) oneB?.setAttribute('aria-checked', 'false');
    const less = el('button', 'marxy-icon-button');
    less.type = 'button';
    less.title = 'Smaller (−)';
    less.setAttribute('aria-label', 'Smaller');
    less.append(icon('minus'));
    less.addEventListener('click', () => zoomBy(-1));
    const zoomValue = el('span', 'marxy-imgbar-zoom');
    zoomValue.setAttribute('aria-live', 'polite');
    const more = el('button', 'marxy-icon-button');
    more.type = 'button';
    more.title = 'Larger (+)';
    more.setAttribute('aria-label', 'Larger');
    more.append(icon('plus'));
    more.addEventListener('click', () => zoomBy(1));
    b.append(sizeSeg, less, zoomValue, more);
    if (mayBeClear(facts)) {
      const ground = segmented('Under transparent pixels', [['checks', 'Checks'], ['light', 'Light'], ['dark', 'Dark']] as const, st.ground, (v) => {
        state().ground = v;
        page?.box.setAttribute('data-marxy-ground', v);
      });
      ground.classList.add('marxy-imgbar-ground');
      b.append(ground);
    }
    const readout = el('span', 'marxy-imgbar-px');
    readout.setAttribute('aria-live', 'off');
    b.append(readout, el('span', 'marxy-grow'));
    const all = steps.images() ?? [path];
    if (all.length > 1) {
      const at = all.indexOf(path);
      const prev = el('button', 'marxy-icon-button');
      prev.type = 'button';
      prev.title = 'The image before (←)';
      prev.setAttribute('aria-label', 'The image before');
      prev.append(icon('back'));
      prev.addEventListener('click', () => step(-1));
      const next = el('button', 'marxy-icon-button');
      next.type = 'button';
      next.title = 'The next image (→)';
      next.setAttribute('aria-label', 'The next image');
      next.append(icon('forward'));
      next.addEventListener('click', () => step(1));
      const strip = el('button', 'marxy-chip marxy-imgbar-strip', 'Strip');
      strip.type = 'button';
      strip.setAttribute('aria-pressed', String(stripOn()));
      strip.addEventListener('click', () => {
        state().strip = !stripOn();
        draw();
      });
      b.append(prev, el('span', 'marxy-imgbar-pos', `${at + 1} of ${all.length} in ${basename(dirname(path))}/`), next, strip);
    }
    const account = o.embedded ? null : accountKey(
      [
        'Drawn by the webview from the file’s own bytes, as an image. Nothing is fetched from the network, and the file is never changed.',
        svg ? 'An SVG is drawn as a picture, so any script or link in it never runs.' : '',
      ],
      caption(),
      'marxy-imgbar-facts',
    );
    if (account) b.append(account.key);
    return { el: b, zoomValue, readout, sizeSeg, account: account?.body ?? null };
  }

  const stripOn = (): boolean => {
    const st = state();
    return st.strip ?? (steps.images()?.length ?? 0) >= 3;
  };

  function strip(): HTMLElement | null {
    const all = steps.images() ?? [];
    if (all.length < 2 || !stripOn()) return null;
    const row = el('div', 'marxy-imgstrip');
    row.setAttribute('role', 'listbox');
    row.setAttribute('aria-label', `Images in ${basename(dirname(path))}/`);
    for (const p of all) {
      const on = p === path;
      const tile = el('button', 'marxy-imgthumb');
      tile.type = 'button';
      tile.setAttribute('role', 'option');
      tile.setAttribute('aria-selected', String(on));
      tile.title = basename(p);
      const label = (): void => tile.replaceChildren(el('span', '', extensionOf(p).toUpperCase() || '?'));
      if (WEBVIEW_DRAWS.has(extensionOf(p))) {
        const t = el('img');
        t.alt = '';
        t.loading = 'lazy';
        t.draggable = false;
        t.addEventListener('error', label, { once: true });
        try {
          t.src = p === path ? source() : shell.fileUrl(p);
          tile.append(t);
        } catch {
          label();
        }
      } else label();
      tile.addEventListener('click', () => go(p));
      row.append(tile);
    }
    requestAnimationFrame(() => row.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    return row;
  }

  function drawPage(into: HTMLElement): void {
    const st = state();
    const root = el('div', 'marxy-imgpage');
    const top = bar();
    const stage = el('div', 'marxy-imgstage');
    stage.tabIndex = 0;
    stage.setAttribute('aria-label', basename(path));
    const box = el('div', 'marxy-imgbox');
    if (mayBeClear(facts)) box.setAttribute('data-marxy-ground', st.ground);
    const img = el('img', 'marxy-imgpic');
    img.alt = basename(path);
    img.draggable = false;
    const grid = el('div', 'marxy-imggrid');
    grid.hidden = true;
    box.append(img, grid);
    stage.append(box);
    root.append(top.el);
    if (top.account) root.append(top.account);
    root.append(stage);
    const row = strip();
    if (row) root.append(row);
    page = { root, stage, box, img, grid, zoomValue: top.zoomValue, readout: top.readout, sizeSeg: top.sizeSeg };
    canvas = null;
    const url = source();
    const own = crossOrigin && /^https?:/.test(url);
    if (own) img.crossOrigin = 'anonymous';
    img.addEventListener('load', () => {
      natural = { w: img.naturalWidth, h: img.naturalHeight };
      apply();
      if (!facts) viewerChanged();
    });
    img.addEventListener('error', () => {
      if (own) {
        // The shell would not lend the pixels across origins: draw it plainly, with no readout.
        crossOrigin = false;
        draw();
        return;
      }
      failed = true;
      draw();
      viewerChanged();
    });
    img.src = url;
    wire(stage);
    into.replaceChildren(root);
    resize?.disconnect();
    resize = new ResizeObserver(() => {
      if (state().zoom === 'fit') apply();
      else {
        const g = geometry();
        if (page && g && last > 0) page.root.toggleAttribute('data-marxy-zoomed', overflows(Math.max(1, Math.round(g.w * last)), Math.max(1, Math.round(g.h * last))));
      }
    });
    resize.observe(stage);
    if (geometry()) apply();
  }

  function wire(stage: HTMLElement): void {
    stage.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        zoomBy(e.deltaY < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top });
      },
      { passive: false },
    );
    let drag: { x: number; y: number; l: number; t: number } | null = null;
    stage.addEventListener('pointerdown', (e) => {
      if (!page?.root.hasAttribute('data-marxy-zoomed') || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop };
      stage.setPointerCapture(e.pointerId);
      stage.setAttribute('data-marxy-grab', '');
    });
    const release = (): void => {
      drag = null;
      stage.removeAttribute('data-marxy-grab');
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointermove', (e) => {
      if (drag) {
        stage.scrollLeft = drag.l - (e.clientX - drag.x);
        stage.scrollTop = drag.t - (e.clientY - drag.y);
      }
      readPixel(e);
    });
    stage.addEventListener('pointerleave', () => page?.readout.replaceChildren());
  }

  /** The file card in place of the page: this system could not draw it, or the reader asked for the bytes. */
  function cardInstead(): PaneViewer {
    const asked = state().asCard.has(path) && !failed;
    // The shell said it draws this format, so a failure is the file's (damaged, cut short), not the system's.
    const drawable = failed && !facts?.why && (facts?.show === 'webview' || facts?.show === 'decoded');
    card ??= createCardViewer({
      shell,
      file,
      place: o.place,
      facts: failed ? { ...(facts ?? blankFacts(file)), show: 'none', why: facts?.why ?? (drawable ? undrawableWhy(facts) : 'This system could not draw it.') } : null,
      kicker: drawable ? 'An image that would not draw' : undefined,
      back: asked
        ? {
            words: 'Back to the image',
            run: () => {
              state().asCard.delete(path);
              card?.destroy();
              card = null;
              draw();
              viewerChanged();
            },
          }
        : undefined,
    });
    return card;
  }

  function ensureHex(): HexView {
    if (!hex) {
      hex = createHexView(file, (offset, length) => shell.readRange(file.path, offset, length));
      if (o.place?.hex) hex.restore(o.place.hex);
    }
    return hex;
  }

  const showsCard = (): boolean => mode === 'rendered' && (failed || state().asCard.has(path));

  function draw(): void {
    if (!host) return;
    if (mode === 'source') {
      // An SVG's Source is its text (the editor); only a binary image has the hex view.
      const view = ensureHex();
      const wrap = el('div', 'marxy-hexpage');
      wrap.append(view.el);
      host.replaceChildren(wrap);
      requestAnimationFrame(() => hex?.draw());
      return;
    }
    folder();
    if (showsCard()) {
      cardInstead().show('rendered', host);
      return;
    }
    drawPage(host);
  }

  const reading = readingCard({
    file,
    facts: () => facts,
    shownAs: () => `an image · ${formatName(facts?.format ?? (extensionOf(path) || 'image'))}`,
    other: () =>
      binary
        ? {
            words: 'Show the file card and the bytes instead',
            run: () => {
              state().asCard.add(path);
              card?.destroy();
              card = null;
              draw();
              viewerChanged();
            },
          }
        : null,
  });
  const image = imageCard({
    facts: () => facts,
    natural: () => natural,
    shown: () => shown,
    scripts: () => (svg && o.text ? svgScripts(new TextDecoder().decode(o.text().subarray(0, 1024 * 1024))) : null),
  });
  const exif = exifCard({
    facts: () => facts,
    revealed: () => state().revealed.has(path),
    reveal: (on) => {
      if (on) state().revealed.add(path);
      else state().revealed.delete(path);
      viewerChanged();
    },
  });
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });

  function setCard(on: boolean): void {
    if (on) state().asCard.add(path);
    else state().asCard.delete(path);
    card?.destroy();
    card = null;
    draw();
    viewerChanged();
  }

  /** The Image card's rows as it draws them (but the zoom, which is the page's and not the file's): `key`, `value`. */
  function factRows(): { key: string; value: string }[] {
    const body = el('div');
    // The Image card reads nothing of its context.
    image.render(body, undefined as unknown as CardContext);
    return [...body.querySelectorAll('.marxy-fact')].flatMap((row) => {
      const key = row.querySelector('.marxy-fact-k')?.textContent ?? '';
      const v = row.querySelector('.marxy-fact-v')?.cloneNode(true) as HTMLElement | undefined;
      if (!key || !v || key === 'shown at') return [];
      for (const br of v.querySelectorAll('br')) br.replaceWith(' · ');
      return [{ key, value: v.textContent ?? '' }];
    });
  }

  /** A row of the Image card in the left section's Outline, where it is shown. */
  const panelRow = (key: string | null): HTMLElement | null => {
    const sec = document.querySelector<HTMLElement>('.marxy-drawer [data-marxy-card="contents"]');
    if (!sec || key === null) return sec;
    return [...sec.querySelectorAll<HTMLElement>('.marxy-fact')].find((r) => r.querySelector('.marxy-fact-k')?.textContent === key) ?? null;
  };

  /** The picture's chunks or segments, walked from its bytes once, a range at a time; null until read or for GIF. */
  let structure: ImageStructure | null = null;
  let structureAsked = false;
  let structureBox: { box: HTMLElement; rows: Map<number, HTMLElement> } | null = null;
  const readRange = (at: number, n: number): Promise<Uint8Array> => shell.readRange(path, at, n);

  /** The structure drawn under the stage, on the cursor's first asking (the picture keeps the room it is fitted to till then). */
  function structureEl(at: number | null, make: boolean): HTMLElement | null {
    if (!structure || !page || mode !== 'rendered' || showsCard()) return null;
    if ((!structureBox || !structureBox.box.isConnected) && make) {
      const s = structure;
      const box = kindSection('Its structure', `${s.chunks.length.toLocaleString('en-GB')} ${s.word}s, at their offsets${s.stopped ? ` · ${s.stopped}` : ''}`, [s.word, 'at byte', 'bytes']);
      box.classList.add('marxy-imgparts');
      const rows = new Map<number, HTMLElement>();
      for (const c of s.chunks) {
        const row = kindRow(c.type, '', { at: `0x${offsetLabel(c.at, 4)}`, size: c.length.toLocaleString('en-GB') });
        rows.set(c.at, row);
        box.append(row);
      }
      page.root.append(box);
      structureBox = { box, rows };
    }
    if (!structureBox?.box.isConnected) return null;
    return at === null ? structureBox.box : (structureBox.rows.get(at) ?? null);
  }

  /**
   * The picture, then its facts, then its chunks or segments, walked from the file's
   * bytes here: core's facts reader walks them for the facts and keeps no list.
   */
  function pictureParts(): PartTree {
    if (binary && !structureAsked) {
      structureAsked = true;
      void imageStructure(file.head, file.size, readRange)
        .then((s) => {
          structure = s;
          if (s) viewerChanged();
        })
        .catch(() => {});
    }
    const HEAD = 256;
    const first = file.head.subarray(0, HEAD);
    const picture: PartUnit = {
      id: 'picture',
      label: 'picture',
      address: '#picture',
      at: 0,
      el: () => (mode === 'rendered' && !showsCard() ? (page?.stage ?? null) : null),
      stored: () =>
        binary ? `${[...first].map(hex2).join(' ')}${file.size > first.length ? ' …' : ''}` : new TextDecoder().decode(o.text?.() ?? first),
      xray: () =>
        binary
          ? bytesBox(`As stored · the file’s first bytes, 0–${(first.length - 1).toLocaleString('en-GB')} of ${file.size.toLocaleString('en-GB')}`, first, 0)
          : textBox('As written · the drawing’s first lines', new TextDecoder().decode((o.text?.() ?? first).subarray(0, 16 * 1024)).split(/\r?\n/).slice(0, 40)),
    };
    const rows = factRows();
    const kids: PartUnit[] = rows.map((r) => ({
      id: `facts/${r.key}`,
      label: `fact ${r.key}`,
      address: `#facts/${r.key}`,
      el: () => panelRow(r.key),
      stored: () => `${r.key}: ${r.value}`,
    }));
    const top: PartUnit[] = [picture];
    if (kids.length > 0) {
      top.push({
        id: 'facts',
        label: 'facts',
        address: '#facts',
        children: kids,
        el: () => panelRow(null),
        stored: () => rows.map((r) => `${r.key}: ${r.value}`).join('\n'),
      });
    }
    const s = structure;
    if (s && s.chunks.length > 0) {
      const chunks: PartUnit[] = s.chunks.map((c) => ({
        id: `@${c.at}`,
        label: `${s.word} ${c.type}`,
        address: `@0x${offsetLabel(c.at, 4)}`,
        at: c.at,
        el: () => structureEl(c.at, true),
        stored: () => `${c.type}\t0x${offsetLabel(c.at, 4)}\t${c.length.toLocaleString('en-GB')}`,
        xray: async () =>
          bytesBox(
            `As stored · the ${c.type} ${s.word} · bytes ${c.at.toLocaleString('en-GB')}–${(c.at + c.length - 1).toLocaleString('en-GB')}${c.length > 1024 ? ', its first 1,024' : ''}`,
            await readRange(c.at, Math.min(c.length, 1024)),
            c.at,
          ),
      }));
      top.push({
        id: 'structure',
        label: `${s.word}s`,
        address: '#structure',
        at: 0,
        children: chunks,
        el: () => structureEl(null, true),
        stored: async () => (await Promise.all(chunks.map((u) => u.stored()))).join('\n'),
      });
    }
    return {
      ...treeParts(top, { readOnly: true }),
      // A click finds the structure's rows only once they are drawn; it never draws them.
      drawn: (u) => (u.id === 'structure' ? structureEl(null, false) : u.id.startsWith('@') ? structureEl(u.at ?? -1, false) : u.el()),
    };
  }

  return {
    path,
    kind: 'image',
    group: 'image',
    binary,
    owns: (m) => binary || m === 'rendered',
    show(m, into) {
      mode = m;
      host = into;
      into.setAttribute('data-marxy-viewer', 'image');
      draw();
    },
    hide() {
      host = null;
    },
    refresh() {
      if (!svg) return;
      natural = null;
      if (host && mode === 'rendered') draw();
    },
    cards(m) {
      if (showsCard() && card) return card.cards(m);
      if (m === 'source') return { reading, facts: factsCard(file) };
      // A text file's Facts are the text's own (the panel's), read from its store.
      return binary ? { reading, contents: image, frontmatter: exif, facts: factsCard(file) } : { reading, contents: image, frontmatter: exif };
    },
    passing(m) {
      if (m === 'source' && binary) return [byte];
      if (showsCard() && card) return card.passing(m);
      return [];
    },
    headSay: () => (file.guessed ? { text: 'image · guessed', tone: 'guess', title: 'Read from its first bytes: its name does not say what it is · Metadata says why' } : null),
    key(e, m) {
      if (m === 'source') return hex?.key(e) ?? false;
      if (showsCard()) return (card?.key(e, m) ?? false) || steps.key(e);
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowLeft':
          return steps.key(e);
        case '+':
        case '=':
          zoomBy(1);
          return true;
        case '-':
          zoomBy(-1);
          return true;
        case '0':
          zoomTo('fit');
          return true;
        case '1':
          zoomTo(1);
          return true;
        default:
          return false;
      }
    },
    panelKey: () => `${id}:${mode}:${showsCard()}:${shown ? `${shown.z}:${shown.fit}` : ''}:${natural ? natural.w : ''}:${state().revealed.has(path)}:${hex?.selected() ?? ''}:${card?.panelKey() ?? ''}`,
    place() {
      if (showsCard() && card?.place) return card.place();
      const stage = page?.stage;
      return { hex: hex?.place() ?? o.place?.hex, scroll: stage && mode === 'rendered' ? { top: stage.scrollTop, left: stage.scrollLeft } : undefined };
    },
    land(at) {
      if (!binary) return mode;
      if (showsCard() && card?.land) return card.land(at);
      ensureHex().restore({ selected: at, top: null });
      return 'source';
    },
    parts(m) {
      if (m === 'source') return binary ? ensureHex().parts() : null;
      if (showsCard()) return card?.parts?.(m) ?? null;
      return pictureParts();
    },
    floor: binary ? { on: () => showsCard(), set: (on) => setCard(on) } : undefined,
    exports: () => (binary ? [asItIs(shell, file, 'image')] : []),
    destroy() {
      resize?.disconnect();
      hex?.destroy();
      card?.destroy();
      hex = null;
      card = null;
      page = null;
      host = null;
    },
  };
}

/** Why an image of a format this system draws did not draw: the bytes, not the system. */
export function undrawableWhy(facts: ImageFacts): string {
  return `This system draws ${formatName(facts.format)} images, but not this one: the file may be damaged or cut short.`;
}

/** Facts for an image whose facts the shell did not give, when the page must say it could not draw it. */
function blankFacts(file: ViewedFile): ImageFacts {
  return { format: extensionOf(file.path) || 'image', width: 0, height: 0, orientation: 1, bitDepth: null, channels: null, colorProfile: null, frames: 1, show: 'none', why: null, exif: null, location: null };
}
