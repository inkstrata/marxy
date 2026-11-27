// Reading a grammar's tokens: Shiki, its regex engine and the loader of every allow-listed grammar. Only the highlight
// worker and Node code (tests, tools) import this; the page imports index.ts, which carries the names and none of this,
// so the grammars are in the build once (scripts/gate-highlight-bundle.mjs).
import type { GrammarState, ThemedToken } from '@shikijs/core';
import { tokenizeFromState } from './highlighter.ts';
import { type HighlightToken, isTerminalLang, logLineTokens, terminalTokens } from './index.ts';
import { DEFAULT_LINE_CAP, lineCapFor } from './line-cap.ts';
import { logLevelClassForToken } from './line-classes.ts';
import { LANGUAGE_TO_GRAMMAR } from './languages.generated.ts';
import { marxyScopeForTokenColor } from './scopes.ts';
import { own } from '../util/text.ts';

export * from './index.ts';

const toHighlightToken = (token: ThemedToken, lang: string): HighlightToken => {
  const level = logLevelClassForToken(lang, token.content);
  if (level) return { text: token.content, className: level };
  const scope = marxyScopeForTokenColor(token.color);
  return scope ? { text: token.content, scope } : { text: token.content };
};

/** A block larger than this is not highlighted: the JS regex engine's cost is not linear in line length. */
export const MAX_HIGHLIGHT_BLOCK_CHARS = 200_000;
/**
 * A line longer than this is left plain (minified bundles, base64, one-line logs); its neighbours are
 * highlighted. Some grammars have a lower cap (`lineCapFor`, with the measurements).
 */
export const MAX_HIGHLIGHT_LINE_CHARS = DEFAULT_LINE_CAP;

/**
 * Tokenize `code` for a markdown fence language id. Unknown ids and `plaintext` return `null`
 * so the caller leaves the DOM untouched.
 */
export async function highlight(code: string, lang: string): Promise<HighlightToken[][] | null> {
  const normalized = lang.trim().toLowerCase();
  if (!normalized || normalized === 'plaintext' || normalized === 'text' || normalized === 'txt') return null;
  if (normalized === 'log') return code.split(/\r\n|\r|\n/).map(logLineTokens);
  if (isTerminalLang(normalized)) return terminalTokens(code.split(/\r\n|\r|\n/));
  if (!own(LANGUAGE_TO_GRAMMAR, normalized)) return null;
  const rawLines = code.split(/\r\n|\r|\n/);
  if (code.length > MAX_HIGHLIGHT_BLOCK_CHARS) return rawLines.map((line) => (line === '' ? [] : [{ text: line }]));
  return (await grammarTokens(rawLines, normalized))?.lines ?? null;
}

/**
 * A grammar language's tokens for `rawLines`, begun in `state` (where the lines before them left the grammar), with the
 * state after the last line, so a text tokenised a piece at a time comes out as it would whole (Source's runs).
 * `null` when the language has no grammar on the allow-list. What Read paints and Source marks both come from here.
 */
export async function grammarTokens(
  rawLines: readonly string[],
  lang: string,
  state?: GrammarState,
): Promise<{ readonly lines: HighlightToken[][]; readonly state: GrammarState | undefined } | null> {
  if (!own(LANGUAGE_TO_GRAMMAR, lang)) return null;
  // Over-long lines are blanked for the tokenizer and put back as plain text, so one pathological
  // line cannot stall the rest of the block and every line still comes back in order.
  const long = new Set<number>();
  const cap = lineCapFor(lang);
  rawLines.forEach((line, index) => { if (line.length > cap) long.add(index); });
  const input = rawLines.map((line, index) => (long.has(index) ? '' : line)).join('\n');
  const result = await tokenizeFromState(input, lang, state);
  if (!result) return null;
  const lines = result.tokens.map((line, index) => (long.has(index) ? [{ text: rawLines[index]! }] : line.map((token) => toHighlightToken(token, lang))));
  return { lines, state: result.state };
}
