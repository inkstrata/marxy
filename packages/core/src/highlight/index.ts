// Parse-time syntax highlighting: Shiki tokens mapped to marxy scope classes only (MARXY-27).
import type { ThemedToken } from '@shikijs/core';
import { tokenizeWithAllowList } from './highlighter.ts';
import { marxyScopeForTokenColor, type MarxyTokenScope } from './scopes.ts';
import { LANGUAGE_TO_GRAMMAR } from './languages.generated.ts';

export type { MarxyTokenScope } from './scopes.ts';
export { marxyScopeForTextMateScope, marxyScopeForTokenColor } from './scopes.ts';
export { LANGUAGE_TO_GRAMMAR } from './languages.generated.ts';

/** One highlighted run; `scope` is omitted for unclassified text. */
export interface HighlightToken {
  readonly text: string;
  readonly scope?: MarxyTokenScope;
}

const toHighlightToken = (token: ThemedToken): HighlightToken => {
  const scope = marxyScopeForTokenColor(token.color);
  return scope ? { text: token.content, scope } : { text: token.content };
};

/**
 * Tokenize `code` for a markdown fence language id. Unknown ids and `plaintext` return `null`
 * so the caller leaves the DOM untouched (docs/design/02-render.md).
 */
export async function highlight(code: string, lang: string): Promise<HighlightToken[][] | null> {
  const normalized = lang.trim().toLowerCase();
  if (!normalized || normalized === 'plaintext' || normalized === 'text' || normalized === 'txt') return null;
  if (!LANGUAGE_TO_GRAMMAR[normalized]) return null;
  const lines = await tokenizeWithAllowList(code, normalized);
  if (!lines) return null;
  return lines.map((line) => line.map(toHighlightToken));
}

/** Plain source text from token runs (clipboard / copy-code-clean; no class markup). */
export function plainTextFromTokens(lines: readonly (readonly HighlightToken[])[]): string {
  return lines.map((line) => line.map((t) => t.text).join('')).join('\n');
}
