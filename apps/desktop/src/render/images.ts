// Post-pass 3: local image paths, reserved boxes, asset URLs (docs/design/02-render.md). MARXY-138.
import { normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { presentLocalImage, resolveImageSrc, type ImageSize } from '@marxy/core/src/render/images.ts';

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

/** Directory containing the document and the image root (repository root or the same directory). */
export function pathsForDocument(documentPath: string): { documentDir: string; imageRoot: string } {
  const normalized = normalizePath(documentPath.replace(/\\/g, '/'));
  const slash = normalized.lastIndexOf('/');
  const documentDir = slash >= 0 ? normalized.slice(0, slash) : normalized;
  return { documentDir, imageRoot: documentDir };
}

function measurePx(article: HTMLElement): number {
  const width = article.clientWidth;
  if (width > 0) return width;
  const main = article.closest('#marxy-main') as HTMLElement | null;
  return main?.clientWidth ?? article.parentElement?.clientWidth ?? 0;
}

/**
 * Resolve each local `<img src>`, allow the image root once, reserve width/height, then set `src`.
 * Skips remote placeholders (dataset.marxyRemote) and images this pass already processed.
 */
export async function applyImages(article: HTMLElement, ctx: ApplyImagesContext): Promise<void> {
  const measure = measurePx(article);
  const opts = { documentDir: ctx.documentDir, imageRoot: ctx.imageRoot, measurePx: measure };

  for (const img of article.querySelectorAll<HTMLImageElement>('img[src]')) {
    if (img.dataset.marxyRemote !== undefined || img.dataset.marxyDone === 'images') continue;
    const rawSrc = img.getAttribute('src') ?? '';
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
