// Singleton Shiki core highlighter with lazy grammar loading from the allow-list (MARXY-27).
import { createHighlighterCore, type HighlighterCore } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import { GRAMMAR_LOADERS, LANGUAGE_TO_GRAMMAR } from './languages.generated.ts';
import { INTERNAL_THEME_NAME, internalScopeTheme } from './scopes.ts';

let highlighter: HighlighterCore | undefined;
const loadedGrammars = new Set<string>();

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;
  highlighter = await createHighlighterCore({
    themes: [internalScopeTheme()],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

async function ensureGrammar(grammarId: string): Promise<void> {
  if (loadedGrammars.has(grammarId)) return;
  const load = GRAMMAR_LOADERS[grammarId];
  if (!load) throw new Error(`grammar not allow-listed: ${grammarId}`);
  const mod = await load();
  const hi = await getHighlighter();
  await hi.loadLanguage(mod.default as never);
  loadedGrammars.add(grammarId);
}

export async function ensureLanguage(lang: string): Promise<string | null> {
  const grammar = LANGUAGE_TO_GRAMMAR[lang];
  if (!grammar) return null;
  await ensureGrammar(grammar);
  return grammar;
}

export async function tokenizeWithAllowList(code: string, lang: string) {
  const grammar = await ensureLanguage(lang);
  if (!grammar) return null;
  const hi = await getHighlighter();
  // 0 = no limit. Shiki's default (500 ms per line) stops tokenising mid-line when a cold grammar
  // is slow to compile its regexes, so the same code would get different colours on a busy machine.
  // Cost stays bounded by MAX_HIGHLIGHT_LINE_CHARS / MAX_HIGHLIGHT_BLOCK_CHARS, and runs in a worker.
  return hi.codeToTokensBase(code, { lang: grammar, theme: INTERNAL_THEME_NAME, tokenizeTimeLimit: 0 });
}

/**
 * A line longer than its grammar's cap is left plain (B-21). The JS regex engine's cost is not linear
 * in line length for some grammars, and tokenising is never cut off by time (a time limit would colour
 * the same code differently on a busy machine), so the bound is on length: the same text always gets
 * the same colours. Worst line time measured on this machine (Node, warm grammar, 40+ adversarial
 * patterns: quotes, brackets, backticks, `$(`, `//`, `#include`, random mixes), at the cap and at the
 * old 2000-character cap:
 *
 *   cpp   400: 0.21 s (2000: 4.5 s)     c    400: 0.01 s (2000: 0.25 s)
 *   go    500: 0.07 s (2000: 5.1 s)     bash 500: 0.15 s (2000: 5.0 s)   (grammar `shellscript`)
 *   every other grammar, 1000: 0.17 s at most (typescript); yaml 0.08 s, html 0.08 s, toml 0.04 s.
 *
 * A minified bundle is far past 1000 characters on one line, so the global cap loses nothing that
 * 2000 kept. Keyed by grammar id, so every alias of a grammar shares its cap.
 */
export const DEFAULT_LINE_CAP = 1_000;
const GRAMMAR_LINE_CAPS: Readonly<Record<string, number>> = {
  c: 400,
  cpp: 400,
  go: 500,
  shellscript: 500,
};

/** The longest line, in characters, that is tokenised for a language id (an alias or a grammar id). */
export function lineCapFor(lang: string): number {
  const grammar = LANGUAGE_TO_GRAMMAR[lang] ?? lang;
  return GRAMMAR_LINE_CAPS[grammar] ?? DEFAULT_LINE_CAP;
}
