// The render pipeline's public surface. `packages/core/src/index.ts` is not this story's to edit, so
// callers — including `scripts/gate-no-network.mjs` — import this file directly for now.

export { renderSafeHtml, renderDocumentSafeHtml } from './pipeline.ts';
export type { RenderOptions, RenderResult } from './pipeline.ts';
/** Unsanitised, and not for the DOM: see the note on the function. Exported for the gate's control. */
export { renderToUnsanitisedHtml } from './render-html.ts';
export { smarten } from './typography.ts';
export type { SmartenContext } from './typography.ts';
