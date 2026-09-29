// The render pipeline's public surface. `packages/core/src/index.ts` is not this story's to edit, so
// callers — including `scripts/gate-no-network.mjs` — import this file directly for now.

export { renderSafeHtml, renderDocumentSafeHtml } from './pipeline.ts';
export type { RenderOptions, RenderResult } from './pipeline.ts';
export {
  blockedHosts,
  blockedImageNoticeText,
  blockedImagesFrom,
  collapsePath,
  hostOfRefusedSrc,
  imageSizeFromBytes,
  isInsideImageRoot,
  presentLocalImage,
  reserveImageBox,
  resolveImageSrc,
} from './images.ts';
export type { BlockedImage, ImagePresentation, ImageResolution, ImageSize } from './images.ts';
/** Unsanitised, and not for the DOM: see the note on the function. Exported for the gate's control. */
export { renderToUnsanitisedHtml } from './render-html.ts';
export { smarten } from './typography.ts';
export type { SmartenContext } from './typography.ts';
export {
  invisibleHexLabel,
  invisibleSegments,
  markInvisibles,
  shouldFlagInvisible,
} from './invisibles.ts';
export type { InvisibleContext, InvisibleSegment } from './invisibles.ts';
export {
  hostForms,
  linkDestinationLabel,
  linkHostMismatchLabel,
  linkTextLooksLikeHost,
} from './link-host.ts';
export type { HostForms, LinkHostLabel } from './link-host.ts';
