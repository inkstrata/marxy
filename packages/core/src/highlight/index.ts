// Parse-time syntax highlighting: Shiki tokens mapped to marxy scope classes only (MARXY-27).
import type { ThemedToken } from '@shikijs/core';
import { tokenizeWithAllowList } from './highlighter.ts';
import { lineClassForFenceLine, logLevelClassForToken } from './line-classes.ts';
import { marxyScopeForTokenColor, type MarxyTokenScope } from './scopes.ts';
import { LANGUAGE_TO_GRAMMAR } from './languages.generated.ts';

export type { MarxyTokenScope } from './scopes.ts';
export { marxyScopeForTextMateScope, marxyScopeForTokenColor } from './scopes.ts';
export { LANGUAGE_TO_GRAMMAR } from './languages.generated.ts';
export {
  DIFF_LINE_ADD,
  DIFF_LINE_DEL,
  LOG_LEVEL_CLASS,
  diffMarkerIndentCh,
  lineClassForFenceLine,
  logLevelClassForToken,
} from './line-classes.ts';

/** One highlighted run; `scope` is omitted for unclassified text. */
export interface HighlightToken {
  readonly text: string;
  readonly scope?: MarxyTokenScope;
  /** Non-syntax class (log level weight); never carries a token hue. */
  readonly className?: string;
}

/** Per-source-line decoration applied on `.marxy-line` in the renderer. */
export interface HighlightLineMeta {
  readonly lineClass?: string;
}

const toHighlightToken = (token: ThemedToken, lang: string): HighlightToken => {
  const level = logLevelClassForToken(lang, token.content);
  if (level) return { text: token.content, className: level };
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
  return lines.map((line) => line.map((token) => toHighlightToken(token, normalized)));
}

/** Line-level classes (diff tints) keyed by source line index. */
export function lineMetaForHighlight(
  lang: string,
  tokenLines: readonly (readonly HighlightToken[])[],
): readonly HighlightLineMeta[] {
  const normalized = lang.trim().toLowerCase();
  return tokenLines.map((line) => {
    const text = line.map((t) => t.text).join('');
    const lineClass = lineClassForFenceLine(normalized, text);
    return lineClass ? { lineClass } : {};
  });
}

/** Plain source text from token runs (clipboard / copy-code-clean; no class markup). */
export function plainTextFromTokens(lines: readonly (readonly HighlightToken[])[]): string {
  return lines.map((line) => line.map((t) => t.text).join('')).join('\n');
}
