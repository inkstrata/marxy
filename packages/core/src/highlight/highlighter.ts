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
  return hi.codeToTokensBase(code, { lang: grammar, theme: INTERNAL_THEME_NAME });
}
