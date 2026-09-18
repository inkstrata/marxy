// The sanitiser's public surface (ADR-0009). `packages/core/src/index.ts` is not this story's to
// edit, so callers import this file directly until the package index names it.

export { sanitizeHtml } from './sanitize-html.ts';
export type { Removal, SanitizeResult } from './sanitize-html.ts';
export { DEFAULT_POLICY, VOID_ELEMENTS } from './policy.ts';
export type { AttributeRule, ElementRule, Policy, UrlContext } from './policy.ts';
export { sanitizeUrl } from './urls.ts';
export type { UrlDecision } from './urls.ts';
export { escapeAttribute, escapeText } from './escape.ts';
