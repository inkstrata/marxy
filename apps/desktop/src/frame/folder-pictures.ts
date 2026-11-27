// A folder that is mostly images (three or more, at least half its entries) lists each file as a row with a small
// picture at its start. Pictures are drawn only for rows near the view, a few at a time, and each is kept as a bitmap the
// size of its box, never the whole decoded photo: a folder of thousands opens at once and scrolls without holding every
// photo. An image this system cannot draw shows its extension. Nothing is kept once the page closes.
import { viewerOf } from '@marxy/core/src/kind/registry.ts';
import { extensionOf, sizeWords } from '@marxy/core/src/viewer/bytes.ts';
import { orientedSize } from '@marxy/core/src/viewer/image.ts';
import type { FileStat } from '@marxy/shell-api';
import type { AppShell } from '../app-types.ts';
import { formatName } from '../viewers/file.ts';
import { el } from './dom.ts';

/** Extensions the webview draws itself; the rest wait for the shell to say it can decode them. */
const WEBVIEW_DRAWS = new Set(['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur', 'svg']);
/** The picture box, in CSS pixels (frame.css `.marxy-folderpage-pic`). */
const BOX_W = 48;
const BOX_H = 36;
/** Pictures decoding at once: more only queues work for rows a fast scroll has already passed. */
const AT_ONCE = 4;
/**
 * The most pixels a picture is decoded from: a PNG of 30,000 by 30,000 is a few KB on disk and gigabytes decoded. Past
 * it, or when the shell cannot say an image's size from its header, the row shows the extension.
 */
const MAX_PIXELS = 64_000_000;

const isImage = (s: FileStat): boolean => !s.isDir && viewerOf(s.path) === 'image';

/** Whether a folder's entries are mostly images, so its rows carry pictures. */
export function isImageFolder(entries: readonly FileStat[]): boolean {
  const images = entries.filter(isImage).length;
  return images >= 3 && images * 2 >= entries.length;
}

/** An image's facts line before its own bytes are read: format by name, and size. */
export function imageWords(stat: FileStat): string {
  const ext = extensionOf(stat.path);
  return `${formatName(ext === 'jpg' ? 'jpeg' : ext)} · ${sizeWords(stat.size).split(' · ')[0]}`;
}

/**
 * Draws `src` into `box` as a bitmap no bigger than the box at this screen's density. True when the image itself was
 * put in the box instead (an SVG), so its URL must stay good.
 */
async function drawSmall(src: string, box: HTMLElement, vector: boolean, live: () => boolean): Promise<boolean> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  try {
    await img.decode();
  } catch (e) {
    img.src = '';
    throw e;
  }
  if (!live()) {
    img.src = '';
    return false;
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (vector || !w || !h) {
    // A drawing holds no photo's worth of pixels, and a canvas copy of one can come out blank: the webview scales it.
    img.alt = '';
    if (box.isConnected) box.replaceChildren(img);
    return true;
  }
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const scale = Math.min((BOX_W * dpr) / w, (BOX_H * dpr) / h, 1);
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = el('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    img.src = '';
    throw new Error('no canvas');
  }
  try {
    // Off the main thread where the webview can: a 12-megapixel photo is scaled without a frame's pause.
    const bmp = await createImageBitmap(img, { resizeWidth: cw, resizeHeight: ch, resizeQuality: 'medium' });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
  } catch {
    ctx.drawImage(img, 0, 0, cw, ch);
  }
  img.src = '';
  if (live()) box.replaceChildren(canvas);
  return false;
}

interface Pending {
  readonly stat: FileStat;
  readonly box: HTMLElement;
  readonly facts: HTMLElement;
}

/**
 * The picture cells of one folder page. `cell` makes a row's first cell (empty for a file that is no image); pictures
 * load as their rows come within a screen of `scroller`'s view. `dispose` stops them all: nothing more is read or drawn.
 */
export function folderPictures(
  shell: AppShell,
  scroller: Element | null,
): { cell(stat: FileStat, facts: HTMLElement): HTMLTableCellElement; dispose(): void } {
  const waiting = new Map<Element, Pending>();
  const near = new Set<Pending>();
  let running = 0;
  let disposed = false;

  const load = async (p: Pending): Promise<void> => {
    const { stat, box, facts } = p;
    const ext = extensionOf(stat.path);
    const named = (): void => {
      box.replaceChildren(el('span', 'marxy-folderpage-ext', ext.toUpperCase() || '?'));
    };
    const live = (): boolean => !disposed && box.isConnected;
    const f = await shell.imageFacts(stat.path).catch(() => null);
    if (!live()) return;
    if (f) {
      const up = orientedSize(f.width, f.height, f.orientation);
      facts.textContent = `${up.w > 0 ? `${up.w.toLocaleString('en-GB')} × ${up.h.toLocaleString('en-GB')} · ` : ''}${formatName(f.format)} · ${sizeWords(stat.size).split(' · ')[0]}`;
      if (/A$|Indexed/.test(f.channels ?? '') || f.format === 'svg') box.setAttribute('data-marxy-checks', '');
    }
    if (f?.show === 'none') return named();
    const decoded = f?.show === 'decoded';
    if (!WEBVIEW_DRAWS.has(ext) && !decoded) return named();
    const vector = ext === 'svg' || f?.format === 'svg';
    // A drawing is drawn by the webview at the box's size; anything else is decoded whole, so its size is known first.
    if (!vector && (!f || f.width * f.height > MAX_PIXELS || !(f.width > 0))) return named();
    let url = '';
    let kept = false;
    try {
      url = shell.fileUrl(stat.path);
      try {
        kept = await drawSmall(WEBVIEW_DRAWS.has(ext) ? url : `${url}?decoded`, box, vector, live);
      } catch (e) {
        if (!WEBVIEW_DRAWS.has(ext) || !decoded || !live()) throw e;
        kept = await drawSmall(`${url}?decoded`, box, false, live);
      }
    } catch {
      if (live()) named();
    } finally {
      // A blob URL (the browser build) holds a copy of the file: let it go once the small picture is drawn.
      if (!kept && url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
  };

  const pump = (): void => {
    while (!disposed && running < AT_ONCE && near.size > 0) {
      const p = near.values().next().value as Pending;
      near.delete(p);
      waiting.delete(p.box);
      seen?.unobserve(p.box);
      running++;
      void load(p).finally(() => {
        running--;
        pump();
      });
    }
  };

  const seen =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              const p = waiting.get(e.target);
              if (!p) continue;
              if (e.isIntersecting) near.add(p);
              else near.delete(p);
            }
            pump();
          },
          { root: scroller, rootMargin: '400px 0px' },
        )
      : null;

  return {
    cell(stat, facts) {
      const td = el('td', 'marxy-folderpage-piccell');
      if (!isImage(stat)) return td;
      const box = el('span', 'marxy-folderpage-pic');
      td.append(box);
      const ext = extensionOf(stat.path);
      if (!WEBVIEW_DRAWS.has(ext)) box.append(el('span', 'marxy-folderpage-ext', ext.toUpperCase() || '?'));
      const p = { stat, box, facts };
      if (disposed) return td;
      if (seen) {
        waiting.set(box, p);
        seen.observe(box);
      } else {
        near.add(p);
        queueMicrotask(pump);
      }
      return td;
    },
    dispose() {
      disposed = true;
      seen?.disconnect();
      waiting.clear();
      near.clear();
    },
  };
}
