// CodeMirror language support by file extension; MIT @codemirror/lang-* only (§09).

import type { Extension } from '@codemirror/state';
import { isUntitled } from '../document/untitled.ts';
import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';
import { LanguageSupport, type LRLanguage } from '@codemirror/language';
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

type LangLoader = () => Promise<Extension>;

/** Loaders by the table's CodeMirror id (file-types.ts); a new grammar is a loader here and an id there. */
const BY_CM_ID: Record<string, LangLoader> = {
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown({ extensions: [MARK_PROPS] }),
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
};

/** Language extension for `path`, or none when unknown or over the size threshold. */
export async function languageExtension(path: string, byteLength: number): Promise<Extension | null> {
  if (byteLength > LARGE_FILE_BYTES) return null;
  const cm = isUntitled(path) ? 'markdown' : fileTypeOf(path)?.cm;
  const loader = cm ? BY_CM_ID[cm] : undefined;
  if (!loader) return null;
  return loader();
}
