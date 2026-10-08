// Post-pass 3: local image paths, reserved boxes, asset URLs (docs/design/02-render.md). MARXY-138.
import { normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { isInsideImageRoot, presentLocalImage, resolveImageSrc, type ImageSize } from '@marxy/core/src/render/images.ts';

export interface ImageShell {
  imageSize(path: string): Promise<ImageSize | null>;
  allowAssetScope(dir: string): Promise<void>;
  assetUrl(path: string): string;
}

export interface ApplyImagesContext {
  readonly documentPath: string;
  readonly documentDir: string;
  readonly imageRoot: string;
  readonly shell: ImageShell;
  /** Session roots already passed to `allowAssetScope`. */
  readonly scopedRoots: Set<string>;
}

/**
 * The image root found for each document directory (ADR-0027 §5): the repository root that indexes it.
 * Filled once per document from the index service's `rootFor`; read synchronously by everything else.
 */
const knownRoots = new Map<string, string>();

function directoryOf(documentPath: string): string {
  const normalized = normalizePath(documentPath);
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(0, slash) : normalized;
}

/** Records `root` as the image root of `documentPath`'s folder. A root that does not contain the folder is ignored. */
export function rememberImageRoot(documentPath: string, root: string): void {
  const dir = directoryOf(documentPath);
  const normalized = normalizePath(root);
  if (isInsideImageRoot(dir, normalized)) knownRoots.set(dir, normalized);
}

/** True once the image root of `documentPath` is known, so a strict check of its images is final. */
export function imageRootKnown(documentPath: string): boolean {
  return knownRoots.has(directoryOf(documentPath));
}

/** Asks `rootFor` once for the document's repository root and remembers it. A failed lookup leaves the folder as the root. */
export async function resolveImageRoot(documentPath: string, rootFor: (path: string) => Promise<string>): Promise<void> {
  if (imageRootKnown(documentPath)) return;
  try {
    rememberImageRoot(documentPath, await rootFor(documentPath));
  } catch {
    rememberImageRoot(documentPath, directoryOf(documentPath));
  }
}

/** Directory containing the document and the image root (repository root once known, else the same directory). */
export function pathsForDocument(documentPath: string): { documentDir: string; imageRoot: string } {
  const documentDir = directoryOf(documentPath);
  return { documentDir, imageRoot: knownRoots.get(documentDir) ?? documentDir };
}

function measurePx(article: HTMLElement): number {
  const width = article.clientWidth;
  if (width > 0) return width;
  const main = article.closest('#marxy-main') as HTMLElement | null;
  return main?.clientWidth ?? article.parentElement?.clientWidth ?? 0;
}

/**
 * Drops `src` on images that cannot be local assets (no shell IPC). Runs on the critical path so
 * refused paths never reach `first_text` with a fetchable URL (MARXY-138, MARXY-33).
 */
export function stripNonLocalImages(article: HTMLElement, documentPath: string): void {
  const { documentDir, imageRoot } = pathsForDocument(documentPath);
  const known = imageRootKnown(documentPath);
  const measure = measurePx(article);
  const opts = { documentDir, imageRoot, measurePx: measure };
  for (const img of article.querySelectorAll<HTMLImageElement>('img[src]')) {
    if (img.dataset.marxyRemote !== undefined || img.dataset.marxyDone === 'images') continue;
    const raw = img.getAttribute('src') ?? '';
    const resolved = resolveImageSrc(raw, opts);
    if (resolved.kind === 'local') continue;
    img.removeAttribute('src');
    if (resolved.kind === 'outside' && !known) {
      // Outside the folder is not outside the repository: keep the reference, and let applyImages decide once the root is known.
      img.dataset.marxySrc = raw;
      continue;
    }
    img.dataset.marxyDone = 'images';
  }
}

/**
 * Resolve each local `<img src>`, allow the image root once, reserve width/height, then set `src`.
 * Skips remote placeholders (dataset.marxyRemote) and images this pass already processed.
 */
export async function applyImages(article: HTMLElement, ctx: ApplyImagesContext): Promise<void> {
  const measure = measurePx(article);
  const opts = { documentDir: ctx.documentDir, imageRoot: ctx.imageRoot, measurePx: measure };

  for (const img of article.querySelectorAll<HTMLImageElement>('img[src], img[data-marxy-src]')) {
    if (img.dataset.marxyRemote !== undefined || img.dataset.marxyDone === 'images') continue;
    const rawSrc = img.getAttribute('src') ?? img.dataset.marxySrc ?? '';
    delete img.dataset.marxySrc;
    const resolved = resolveImageSrc(rawSrc, opts);
    if (resolved.kind !== 'local') {
      img.removeAttribute('src');
      img.dataset.marxyDone = 'images';
      continue;
    }

    if (!ctx.scopedRoots.has(ctx.imageRoot)) {
      await ctx.shell.allowAssetScope(ctx.imageRoot);
      ctx.scopedRoots.add(ctx.imageRoot);
    }

    let size: ImageSize | null = null;
    try {
      size = await ctx.shell.imageSize(resolved.path);
    } catch {
      size = null;
    }
    if (size === null) {
      img.removeAttribute('src');
      img.dataset.marxyDone = 'images';
      continue;
    }
    const presentation = presentLocalImage(rawSrc, {
      ...opts,
      size,
      assetUrl: ctx.shell.assetUrl.bind(ctx.shell),
    });
    if (presentation.kind !== 'ready') {
      img.removeAttribute('src');
      img.dataset.marxyDone = 'images';
      continue;
    }
    if (presentation.width !== undefined) {
      img.setAttribute('width', String(presentation.width));
      img.dataset.marxyWidthBeforeSrc = '1';
    }
    if (presentation.height !== undefined) img.setAttribute('height', String(presentation.height));
    img.setAttribute('src', presentation.src);
    img.dataset.marxyDone = 'images';
  }
}
