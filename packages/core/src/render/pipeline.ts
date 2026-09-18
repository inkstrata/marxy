// The pipeline a reader's DOM is allowed to see: parse → render → sanitise (ADR-0009). One function,
// so there is no way to reach the render stage's output without passing the allow-list, and no
// platform dependency, so the same call runs in Node, in a gate and in the shell's webview (ADR-0020).

import type { Document } from '../contracts/ast.ts';
import { parseMarkdown, type ParseOptions } from '../parse/parse.ts';
import { DEFAULT_POLICY, type Policy } from '../sanitize/policy.ts';
import { sanitizeHtml, type Removal } from '../sanitize/sanitize-html.ts';
import { renderToUnsanitisedHtml } from './render-html.ts';

export interface RenderOptions extends ParseOptions {
  /** The allow-list to hold the document to. Defaults to the narrow one; widening it is MARXY-44. */
  readonly policy?: Policy;
}

export interface RenderResult {
  /** HTML that has been through the allow-list and is safe to put in the DOM. */
  readonly html: string;
  /** What the allow-list took out, in order, so a notice can name it (MARXY-26, MARXY-44). */
  readonly removed: readonly Removal[];
}

/** Parses a document's bytes and returns sanitised HTML. */
export function renderSafeHtml(source: string | Uint8Array, options: RenderOptions = {}): RenderResult {
  return renderDocumentSafeHtml(parseMarkdown(source, options), options.policy);
}

/** The same, for a document that has already been parsed once (the parse is the expensive half). */
export function renderDocumentSafeHtml(document: Document, policy: Policy = DEFAULT_POLICY): RenderResult {
  return sanitizeHtml(renderToUnsanitisedHtml(document), policy);
}
