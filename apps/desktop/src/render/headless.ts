// Headless render entry: one function a Playwright gate calls to typeset a document without Tauri.
import { parseMarkdown } from '@marxy/core';
import { renderDocumentSafeHtml, type RenderResult } from '@marxy/core/src/render/index.ts';
import { attach, snapToGrid, type TypesetStats } from '@marxy/typeset';
import { applyWeightOffset, platformOf } from '../theme/offset.ts';
import { buildBlocks, buildNodeMap } from './post.ts';
import { createStubShell } from './stub.ts';

export interface MarxyRenderOpts {
  theme?: string;
  variant: 'light' | 'dark';
  width: number;
  size?: number;
  typeset?: boolean;
}

export interface MarxyRenderResult {
  readonly removed: RenderResult['removed'];
  readonly stats: TypesetStats & { readonly cls: number };
}

/** Body size → even line box, same table as packages/theme/test/grid.test.mjs, so half a line is whole pixels. */
const LINE_BOX: Readonly<Record<number, number>> = { 14: 24, 17: 28, 21: 34, 24: 40 };

function observeCls(): { value(): number } {
  let sum = 0;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (shift.hadRecentInput) continue;
        sum += shift.value ?? 0;
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });
  } catch {
    observer = null;
  }
  return {
    value() {
      observer?.disconnect();
      return sum;
    },
  };
}

function emptyStats(): TypesetStats {
  return { paragraphs: 0, typeset: 0, fallbacks: 0, short: 0, viewportMs: 0, reasons: {} };
}

/**
 * Same post-passes as the app (node map, grid, typesetter) against a stub shell. Resolves after
 * fonts and — when typesetting — after every paragraph has been considered, so rag is measured on
 * the set page rather than the viewport-only first pass.
 */
export async function marxyRender(source: string, opts: MarxyRenderOpts): Promise<MarxyRenderResult> {
  const cls = observeCls();
  const shell = createStubShell();

  const root = document.documentElement;
  root.dataset.marxyVariant = opts.variant;
  const size = opts.size ?? 17;
  const lineToken = LINE_BOX[size];
  if (size !== 17 && lineToken !== undefined) {
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
  article.innerHTML = html;

  // Reserve image boxes from the stub decoder before fonts, so a data: image cannot shift the page.
  for (const img of article.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (src === null) continue;
    const url = src.startsWith('data:') ? src : shell.assetUrl(src);
    const size = await shell.imageSize(url);
    if (size === null) continue;
    img.setAttribute('width', String(size.width));
    img.setAttribute('height', String(size.height));
  }

  const nodeMap = buildNodeMap(ast);
  void article.offsetHeight;
  await document.fonts.ready;

  const lineBox = parseFloat(getComputedStyle(article).lineHeight);
  snapToGrid(article, lineBox);

  let stats: TypesetStats = emptyStats();
  if (opts.typeset !== false) {
    const controller = attach(article, {
      lineBox,
      glueStretchEm: 0.6,
      hyphenate: false,
      lastLineMinWidth: 0.33,
      hanging: 'none',
      onPass: () => snapToGrid(article, parseFloat(getComputedStyle(article).lineHeight)),
    });
    await controller.ready;
    await controller.done;
    stats = controller.stats;
  }

  buildBlocks(article, nodeMap);
  return { removed, stats: { ...stats, cls: cls.value() } };
}

declare global {
  interface Window {
    marxyRender: typeof marxyRender;
  }
}

window.marxyRender = marxyRender;
