// CodeMirror language support by file extension; MIT @codemirror/lang-* only (§09).

import type { Extension } from '@codemirror/state';
import { isUntitled } from '../document/untitled.ts';
import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';
import { LanguageDescription, LanguageSupport, StreamLanguage, type LRLanguage, type StreamParser } from '@codemirror/language';
import { styleTags, tags as t } from '@lezer/highlight';

/**
 * Tag a decorator's whole node as `meta`, the tag the role table gives to `decorator` (ADR-0068). Python and
 * JavaScript nest the annotation's name inside a `Decorator` node and give the name an ordinary tag, so without
 * this only the `@` takes the decorator hue.
 */
function withDecorators(support: LanguageSupport): LanguageSupport {
  const language = (support.language as LRLanguage).configure({ props: [styleTags({ 'Decorator/...': t.meta })] });
  return new LanguageSupport(language, support.support);
}

/**
 * Markdown's marks are all `processingInstruction` and take the `marker` hue. Quote marks, list marks and task
 * boxes also carry `contentSeparator`, which the role table gives to `mark`, so they take a hue of their own
 * and the text beside them keeps the text colour.
 */
const MARK_PROPS = {
  props: [styleTags({ QuoteMark: t.contentSeparator, ListMark: t.contentSeparator, TaskMarker: t.contentSeparator })],
};

/** Above this size, Source mode skips language and line wrapping (§09). */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;

type LangLoader = () => Promise<LanguageSupport>;

/** A legacy CodeMirror 5 mode wrapped as a language; its token names map to Lezer tags in `@codemirror/language`. */
const legacy = (parser: unknown): LanguageSupport =>
  new LanguageSupport(StreamLanguage.define(parser as StreamParser<unknown>)); // the modes type against a types-only twin of the same shape

/** Loaders by the table's CodeMirror id (file-types.ts); a new grammar is a loader here and an id there. Each is a lazy import. */
const BY_CM_ID: Record<string, LangLoader> = {
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown({ extensions: [MARK_PROPS], codeLanguages: fenceLanguage }),
  typescript: async () => withDecorators((await import('@codemirror/lang-javascript')).javascript({ typescript: true })),
  tsx: async () => withDecorators((await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true })),
  javascript: async () => withDecorators((await import('@codemirror/lang-javascript')).javascript()),
  jsx: async () => withDecorators((await import('@codemirror/lang-javascript')).javascript({ jsx: true })),
  rust: async () => (await import('@codemirror/lang-rust')).rust(),
  python: async () => withDecorators((await import('@codemirror/lang-python')).python()),
  css: async () => (await import('@codemirror/lang-css')).css(),
  json: async () => (await import('@codemirror/lang-json')).json(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  go: async () => (await import('@codemirror/lang-go')).go(),
  c: async () => (await import('@codemirror/lang-cpp')).cpp(),
  cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
  java: async () => (await import('@codemirror/lang-java')).java(),
  shell: async () => legacy((await import('@codemirror/legacy-modes/mode/shell')).shell),
  toml: async () => legacy((await import('@codemirror/legacy-modes/mode/toml')).toml),
  dockerfile: async () => legacy((await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile),
};

/** Fence info words (lowercase) to the table's CodeMirror id. */
const FENCE_ALIASES: Record<string, string> = {
  md: 'markdown', markdown: 'markdown',
  ts: 'typescript', typescript: 'typescript', tsx: 'tsx',
  js: 'javascript', javascript: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  rs: 'rust', rust: 'rust',
  py: 'python', python: 'python', python3: 'python',
  css: 'css', json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', html: 'html',
  go: 'go', golang: 'go',
  c: 'c', h: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  java: 'java',
  sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', console: 'shell',
  toml: 'toml', dockerfile: 'dockerfile', docker: 'dockerfile',
};

const FENCE_DESCRIPTIONS = new Map<string, LanguageDescription>();

/**
 * A fence's language inside Markdown (V-14): the info word picks a grammar, loaded on first use so the fence costs
 * nothing until a document has one. An unknown word keeps the plain code colour.
 */
function fenceLanguage(info: string): LanguageDescription | null {
  const word = info.trim().split(/[\s{]/)[0]?.toLowerCase() ?? '';
  const cm = Object.hasOwn(FENCE_ALIASES, word) ? FENCE_ALIASES[word] : undefined;
  if (!cm || cm === 'markdown') return null;
  let d = FENCE_DESCRIPTIONS.get(cm);
  if (!d) {
    const loader = BY_CM_ID[cm];
    d = LanguageDescription.of({
      name: cm,
      load: loader,
    });
    FENCE_DESCRIPTIONS.set(cm, d);
  }
  return d;
}

/** Language extension for `path`, or none when unknown or over the size threshold. */
export async function languageExtension(path: string, byteLength: number): Promise<Extension | null> {
  if (byteLength > LARGE_FILE_BYTES) return null;
  const cm = isUntitled(path) ? 'markdown' : fileTypeOf(path)?.cm;
  const loader = cm ? BY_CM_ID[cm] : undefined;
  if (!loader) return null;
  return loader();
}
