// The pipeline a reader's DOM is allowed to see: parse → render → sanitise (ADR-0009). One function,
// so there is no way to reach the render stage's output without passing the allow-list, and no
// platform dependency, so the same call runs in Node, in a gate and in the shell's webview (ADR-0020).
// `globalThis.crypto` is the Web Crypto global, present in both; it is not a Node built-in.

import type { Document } from '../contracts/ast.ts';
import { parseMarkdown, type ParseOptions } from '../parse/parse.ts';
import { DEFAULT_POLICY, PROVENANCE_ATTRIBUTES, withProvenance, type Policy, type ProvenanceNames } from '../sanitize/policy.ts';
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

/**
 * The same, for a document that has already been parsed once (the parse is the expensive half).
 *
 * Every element made for a node carries `data-marxy-s` / `data-marxy-e`, its byte range (ADR-0023),
 * and nothing a document wrote can carry them. The renderer writes provenance under two names drawn
 * for this call alone, the allow-list admits those names and not the public ones, and only then are
 * they renamed. Raw HTML in the file cannot guess the names, so whatever it wrote as `data-marxy-*`
 * is removed by the same single pass that judges everything else — over the whole document, so an
 * inline `<kbd>…</kbd>` split across two raw-HTML nodes keeps its shape.
 */
export function renderDocumentSafeHtml(document: Document, policy: Policy = DEFAULT_POLICY): RenderResult {
  const secret = secretNames();
  const { html, removed } = sanitizeHtml(renderToUnsanitisedHtml(document, { provenance: secret }), withProvenance(policy, secret));
  return { html: publish(html, secret), removed };
}

/** Attribute names nobody outside this call can predict: 128 bits from the platform's CSPRNG. */
function secretNames(): ProvenanceNames {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { start: `data-marxy-${nonce}-s`, end: `data-marxy-${nonce}-e` };
}

/**
 * Renames the secret attributes to the public ones. The sanitiser writes every attribute as
 * ` name="value"` and escapes every `<` in text, so the only place ` data-marxy-<nonce>-s="` can
 * occur in its output is an attribute the allow-list admitted under that exact name.
 */
function publish(html: string, secret: ProvenanceNames): string {
  return html
    .replaceAll(` ${secret.start}="`, ` ${PROVENANCE_ATTRIBUTES.start}="`)
    .replaceAll(` ${secret.end}="`, ` ${PROVENANCE_ATTRIBUTES.end}="`);
}
