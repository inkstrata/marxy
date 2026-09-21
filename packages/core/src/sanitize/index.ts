// The sanitiser's public surface (ADR-0009). `packages/core/src/index.ts` is not this story's to
// edit, so callers import this file directly until the package index names it.

export { sanitizeHtml } from './sanitize-html.ts';
export type { Removal, SanitizeResult } from './sanitize-html.ts';
export {
  BLOCK_ELEMENTS, DEFAULT_POLICY, FOREIGN_ROOTS, PROVENANCE_ATTRIBUTES, RAW_TEXT_ELEMENTS, RENDERED_POLICY,
  VOID_ELEMENTS, WIDE_POLICY, WIDE_RENDERED_POLICY, policyFor, withProvenance,
} from './policy.ts';
export { GATE_DOCUMENT_DIRECTORY, GATE_DOCUMENT_ORIGIN, RESOLUTION_BASES } from './document-origin.ts';
export type { AttributeRule, ElementRule, Policy, ProvenanceNames, UrlContext } from './policy.ts';
export { sanitizeUrl } from './urls.ts';
export type { UrlDecision } from './urls.ts';
export { escapeAttribute, escapeText } from './escape.ts';
