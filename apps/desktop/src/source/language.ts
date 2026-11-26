// Source's language for a file: its colour from Read's tokenizer (`colour.ts`, Shiki's runs as marks), and its
// structure from Lezer where a package exists (folding, indentation, Markdown's marks); MIT @codemirror/lang-* only.
// Lezer colours Markdown's own marks and nothing else: a code file's tokens, and a fence's, are the runs Read paints.

import type { Buffer } from '@marxy/core';
import type { Compartment, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { isUntitled } from '../document/untitled.ts';
import { fileTypeOf } from '@marxy/core/src/kind/registry.ts';
import { LanguageSupport } from '@codemirror/language';
import type { RunSessionOptions } from '@marxy/core/src/highlight/session.ts';
import { tierOf } from '../render/colour-tier.ts';
import { styleTags, tags as t } from '@lezer/highlight';

/**
 * Markdown's marks are all `processingInstruction` and take the `marker` hue. Quote marks, list marks and task
 * boxes also carry `contentSeparator`, which the role table gives to `mark`, so they take a hue of their own
 * and the text beside them keeps the text colour. A code block's body (`CodeText`, only ever in a fence or an indented
 * block) is `content`, no role: a fence's colour is its runs, an indented block is plain, as in Read. It is named with no
 * context because rules from two `styleTags` are merged shallowest first (`@lezer/highlight`), so a `FencedCode/CodeText`
 * rule here would lose to the parser's own `CodeText` one.
 */
const MARK_PROPS = {
  props: [styleTags({ QuoteMark: t.contentSeparator, ListMark: t.contentSeparator, TaskMarker: t.contentSeparator, CodeText: t.content })],
};

/**
 * Above this size Source skips language and line wrapping: no structure, and no colour but what the reader asks for
 * anyway (the plain-text tier, `render/colour-tier.ts`).
 */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;

export type LangLoader = () => Promise<Extension>;

/** Lezer structure by the table's CodeMirror id (file-types.ts). Each is a lazy import. */
const BY_CM_ID: Record<string, LangLoader> = {
  markdown: async () => {
    const [{ markdown }, { fenceLanguageScopes }, { fenceColour }, { marxyHighlighting }] = await Promise.all([
      import('@codemirror/lang-markdown'),
      import('./fence-lang.ts'),
      import('./colour.ts'),
      import('./highlight-style.ts'),
    ]);
    const md = markdown({ extensions: [MARK_PROPS] });
    // Each fence its own `data-marxy-lang` scope, inside the editor root's `markdown`, and its runs.
    return new LanguageSupport(md.language, [md.support, fenceLanguageScopes(), fenceColour(), marxyHighlighting()]);
  },
  typescript: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  tsx: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript(),
  jsx: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  rust: async () => (await import('@codemirror/lang-rust')).rust(),
  python: async () => (await import('@codemirror/lang-python')).python(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  json: async () => (await import('@codemirror/lang-json')).json(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  go: async () => (await import('@codemirror/lang-go')).go(),
  c: async () => (await import('@codemirror/lang-cpp')).cpp(),
  cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
  java: async () => (await import('@codemirror/lang-java')).java(),
};

/** The colour for a code file in `lang`, its channel opened at once when the editor's text is given. */
async function colourFor(lang: string, text?: string, options?: RunSessionOptions): Promise<Extension> {
  return (await import('./colour.ts')).codeColour(lang, undefined, text, options);
}

/**
 * How a file's colour is read: every line, the view first, on the full page; past the plain-text tier none, unless
 * the reader chose to colour it anyway, then only what is in view. Undefined: no colour.
 */
function colourReading(buffer: Pick<Buffer, 'path' | 'bytes'>): RunSessionOptions | undefined {
  const tier = tierOf(buffer.path, buffer.bytes);
  if (tier === null) return buffer.bytes.length > LARGE_FILE_BYTES ? undefined : {};
  if (tier.tier === 'full') return {};
  return tier.anyway ? { whole: false } : undefined;
}

/** What `path` is in Source: its Lezer package's id, and the language its runs are read in (Markdown's come with it). */
function sourceLanguage(path: string): { cm?: string; lang?: string } {
  if (isUntitled(path)) return { cm: 'markdown' };
  const type = fileTypeOf(path);
  return { cm: type?.cm, lang: type?.cm === 'markdown' ? undefined : type?.lang };
}

/** Lezer's structure for `path`, or null; a package that fails to load is left out. */
function structureFor(path: string, loaders: Record<string, LangLoader>): Promise<Extension | null> {
  const { cm } = sourceLanguage(path);
  const loader = cm ? loaders[cm] : undefined;
  return loader ? loader().catch(() => null) : Promise.resolve(null);
}

/**
 * Language extension for `path`: Lezer's structure where a package exists, and the colour of its grammar's runs. None
 * when the file is over the size threshold or has neither; a part that fails to load is left out (the text stays).
 */
export async function languageExtension(
  path: string,
  byteLength: number,
  loaders: Record<string, LangLoader> = BY_CM_ID,
  colour: (lang: string) => Promise<Extension> = colourFor,
): Promise<Extension | null> {
  if (byteLength > LARGE_FILE_BYTES) return null;
  const { lang } = sourceLanguage(path);
  const parts = await Promise.all([structureFor(path, loaders), lang ? colour(lang).catch(() => null) : null]);
  const found = parts.filter((p): p is Extension => p !== null);
  return found.length === 0 ? null : found;
}

/**
 * The colour for `buffer`, begun now: its runs are asked for as soon as the colour module has loaded, before the editor
 * has mounted, so the grammar's first, slow use overlaps the mount (commitment 5). Null over the size threshold or for
 * a file with no grammar runs. `text` is the editor's text with lines joined by `\n`.
 */
export function startColour(buffer: Pick<Buffer, 'path' | 'bytes'>, text: string): Promise<Extension | null> {
  const reading = colourReading(buffer);
  const { lang } = sourceLanguage(buffer.path);
  return lang && reading ? colourFor(lang, text, reading).catch(() => null) : Promise.resolve(null);
}

/**
 * Load the language for `buffer` and put each part in `compartment` as it arrives (the colour need not wait for Lezer's
 * package, nor it for the colour), unless `current()` says the editor has moved on (destroyed, or showing another file).
 * A part that fails to load is left out; Source stays. `colour` is one `startColour` began earlier.
 */
export async function attachLanguage(
  view: Pick<EditorView, 'dispatch'>,
  buffer: Pick<Buffer, 'path' | 'bytes'>,
  current: () => boolean,
  compartment: Compartment,
  loaders: Record<string, LangLoader> = BY_CM_ID,
  colour?: Promise<Extension | null>,
): Promise<void> {
  const { lang } = sourceLanguage(buffer.path);
  const reading = colourReading(buffer);
  const structured = buffer.bytes.length <= LARGE_FILE_BYTES;
  if (!structured && !reading) return;
  const have: Extension[] = [];
  const add = (part: Extension | null, isColour: boolean): void => {
    if (part === null) return;
    if (!current()) {
      if (isColour) void import('./colour.ts').then((m) => m.releaseColour(part));
      return;
    }
    have.push(part);
    view.dispatch({ effects: compartment.reconfigure([...have]) });
  };
  const colourPart = colour ?? (lang && reading ? colourFor(lang, undefined, reading).catch(() => null) : Promise.resolve(null));
  const structure = structured ? structureFor(buffer.path, loaders) : Promise.resolve(null);
  await Promise.all([structure.then((p) => add(p, false)), colourPart.then((p) => add(p, true))]);
}
