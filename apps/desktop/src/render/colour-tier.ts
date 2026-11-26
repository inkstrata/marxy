// A code file's colour tier (core `highlight/tier.ts` decides), and the reader's choice to colour one in
// the plain-text tier anyway, a screen at a time. Read and Source both ask here, so the head, the Reading card and both
// modes agree on what a file is shown as.
import { isTerminalLang } from '@marxy/core/src/highlight/terminal-lines.ts';
import { type ColourTier, colourTier, longestLine } from '@marxy/core/src/highlight/tier.ts';
import { fileTypeFor } from '@marxy/core/src/kind/registry.ts';

const anyway = new Set<string>();
const listeners = new Set<(path: string) => void>();

/** Whether the reader chose to colour `path` past its tier. */
export function colourAnyway(path: string): boolean {
  return anyway.has(path);
}

/** Colours `path` as it scrolls past its tier, or with false goes back to plain text; listeners hear the path. */
export function setColourAnyway(path: string, on: boolean): void {
  if (anyway.has(path) === on) return;
  if (on) anyway.add(path);
  else anyway.delete(path);
  for (const cb of [...listeners]) cb(path);
}

export function onColourChoice(cb: (path: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Every path coloured anyway (readings.json keeps them). */
export function colourChoicesNow(): string[] {
  return [...anyway].sort();
}

/** Replaces the choices with `paths` (readings.json as read at launch), but for the paths in `keep`, chosen since. */
export function restoreColourChoices(paths: readonly string[], keep: ReadonlySet<string> = new Set()): void {
  const next = new Set(paths.filter((p) => !keep.has(p)));
  for (const p of keep) if (anyway.has(p)) next.add(p);
  const changed = [...new Set([...anyway, ...next])].filter((p) => anyway.has(p) !== next.has(p));
  anyway.clear();
  for (const p of next) anyway.add(p);
  for (const p of changed) for (const cb of [...listeners]) cb(p);
}

/** The language `path` is coloured in by grammar runs, or undefined: Markdown, plain text and Read's own readings have no tier. */
export function tieredLanguage(path: string): string | undefined {
  const type = fileTypeFor(path);
  // As core's `hasGrammarRuns`, without loading the highlighter: the registry's `lang` is a Shiki grammar's id.
  return type.parser === 'code' && type.lang !== undefined && type.lang !== 'log' && !isTerminalLang(type.lang) ? type.lang : undefined;
}

/** The tier as measured, by the bytes it was measured on: a long line is looked for once per buffer. */
const measured = new WeakMap<Uint8Array, ColourTier>();

/** `path`'s tier for `bytes` with the reader's choice applied, or null when the file is not coloured by grammar runs. */
export function tierOf(path: string, bytes: Uint8Array): ColourTier | null {
  if (tieredLanguage(path) === undefined) return null;
  let tier = measured.get(bytes);
  if (!tier) {
    tier = colourTier(bytes);
    measured.set(bytes, tier);
  }
  return tier.tier === 'plain' && colourAnyway(path) ? { ...tier, anyway: true } : tier;
}

/** The characters in the longest line, for the Reading card's why. */
export function longestLineOf(bytes: Uint8Array): number {
  return longestLine(bytes);
}
