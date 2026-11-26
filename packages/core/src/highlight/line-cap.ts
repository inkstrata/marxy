// How long a line may be before it is left plain. Apart from highlighter.ts so the page can read the caps without the grammars.
import { LANGUAGE_TO_GRAMMAR } from './languages.generated.ts';
import { own } from '../util/text.ts';

/**
 * A line longer than its grammar's cap is left plain. The JS regex engine's cost is not linear
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
  const grammar = own(LANGUAGE_TO_GRAMMAR, lang) ?? lang;
  return own(GRAMMAR_LINE_CAPS, grammar) ?? DEFAULT_LINE_CAP;
}
