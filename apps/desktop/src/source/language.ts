// CodeMirror language support by file extension; MIT @codemirror/lang-* only (§09).

import type { Extension } from '@codemirror/state';
import { isUntitled } from '../document/untitled.ts';
import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';

/** Above this size, Source mode skips language and line wrapping (§09). */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;

type LangLoader = () => Promise<Extension>;

/** Loaders by the table's CodeMirror id (file-types.ts); a new grammar is a loader here and an id there. */
const BY_CM_ID: Record<string, LangLoader> = {
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
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
};

/** Language extension for `path`, or none when unknown or over the size threshold. */
export async function languageExtension(path: string, byteLength: number): Promise<Extension | null> {
  if (byteLength > LARGE_FILE_BYTES) return null;
  const cm = isUntitled(path) ? 'markdown' : fileTypeOf(path)?.cm;
  const loader = cm ? BY_CM_ID[cm] : undefined;
  if (!loader) return null;
  return loader();
}
