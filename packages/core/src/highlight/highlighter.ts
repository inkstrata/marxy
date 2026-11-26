// Singleton Shiki core highlighter with lazy grammar loading from the allow-list.
import { createHighlighterCore, type GrammarState, type HighlighterCore, type ThemedToken } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import { GRAMMAR_LOADERS } from './grammar-loaders.generated.ts';
import { LANGUAGE_TO_GRAMMAR } from './languages.generated.ts';
import { INTERNAL_THEME_NAME, internalScopeTheme } from './scopes.ts';
import { own } from '../util/text.ts';

/** The fields of a grammar registration the loader reads. */
interface Grammar {
  readonly name: string;
  readonly embeddedLangs?: readonly string[];
  readonly embeddedLangsLazy?: readonly string[];
}

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
  const load = own(GRAMMAR_LOADERS, grammarId);
  if (!load) throw new Error(`grammar not allow-listed: ${grammarId}`);
  const mod = await load();
  const hi = await getHighlighter();
  // A grammar's module carries the grammars it embeds; one not on the allow-list (cpp and ruby embed GLSL, whose licence
  // is unknown) is left out here, as the build leaves its module out of the bundle (vite.config.ts).
  // Shiki refuses a grammar whose `embeddedLangs` names one it has not loaded, so the names go too; the grammar's
  // include of the left-out scope then matches nothing, and that text is coloured as the grammar's own.
  const allowed = (name: string): boolean => Object.hasOwn(GRAMMAR_LOADERS, name);
  const grammars = (mod.default as readonly Grammar[]).filter((g) => allowed(g.name)).map((g) =>
    [...(g.embeddedLangs ?? []), ...(g.embeddedLangsLazy ?? [])].every(allowed)
      ? g
      : { ...g, embeddedLangs: g.embeddedLangs?.filter(allowed), embeddedLangsLazy: g.embeddedLangsLazy?.filter(allowed) },
  );
  await hi.loadLanguage(...(grammars as never[]));
  loadedGrammars.add(grammarId);
}

export async function ensureLanguage(lang: string): Promise<string | null> {
  const grammar = own(LANGUAGE_TO_GRAMMAR, lang);
  if (!grammar) return null;
  await ensureGrammar(grammar);
  return grammar;
}

export async function tokenizeWithAllowList(code: string, lang: string) {
  return (await tokenizeFromState(code, lang))?.tokens ?? null;
}

/**
 * Tokens for `code` begun in `state` (the grammar's state after the lines before it, from an earlier call), and the state
 * after its last line, so a long text can be tokenised a piece at a time with the same result as all at once.
 */
export async function tokenizeFromState(
  code: string,
  lang: string,
  state?: GrammarState,
): Promise<{ readonly tokens: ThemedToken[][]; readonly state: GrammarState | undefined } | null> {
  const grammar = await ensureLanguage(lang);
  if (!grammar) return null;
  const hi = await getHighlighter();
  // 0 = no limit. Shiki's default (500 ms per line) stops tokenising mid-line when a cold grammar
  // is slow to compile its regexes, so the same code would get different colours on a busy machine.
  // Cost stays bounded by MAX_HIGHLIGHT_LINE_CHARS / MAX_HIGHLIGHT_BLOCK_CHARS, and runs in a worker.
  const tokens = hi.codeToTokensBase(code, { lang: grammar, theme: INTERNAL_THEME_NAME, tokenizeTimeLimit: 0, grammarState: state });
  return { tokens, state: hi.getLastGrammarState(tokens) };
}
