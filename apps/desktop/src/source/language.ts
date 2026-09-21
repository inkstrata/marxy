// CodeMirror language support by file extension; MIT @codemirror/lang-* only (§09).

import type { Extension } from '@codemirror/state';
import { extensionOf } from './default-mode.ts';

/** Above this size, Source mode skips language and line wrapping (§09). */
export const LARGE_FILE_BYTES = 2 * 1024 * 1024;

type LangLoader = () => Promise<Extension>;

const BY_EXT: Record<string, LangLoader> = {
  '.md': async () => (await import('@codemirror/lang-markdown')).markdown(),
  '.markdown': async () => (await import('@codemirror/lang-markdown')).markdown(),
  '.mdx': async () => (await import('@codemirror/lang-markdown')).markdown(),
  '.txt': async () => (await import('@codemirror/lang-markdown')).markdown(),
  '.ts': async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  '.tsx': async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  '.js': async () => (await import('@codemirror/lang-javascript')).javascript(),
  '.jsx': async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  '.mjs': async () => (await import('@codemirror/lang-javascript')).javascript(),
  '.cjs': async () => (await import('@codemirror/lang-javascript')).javascript(),
  '.rs': async () => (await import('@codemirror/lang-rust')).rust(),
  '.py': async () => (await import('@codemirror/lang-python')).python(),
  '.css': async () => (await import('@codemirror/lang-css')).css(),
  '.json': async () => (await import('@codemirror/lang-json')).json(),
  '.yaml': async () => (await import('@codemirror/lang-yaml')).yaml(),
  '.yml': async () => (await import('@codemirror/lang-yaml')).yaml(),
  '.html': async () => (await import('@codemirror/lang-html')).html(),
  '.htm': async () => (await import('@codemirror/lang-html')).html(),
};

/** Language extension for `path`, or none when unknown or over the size threshold. */
export async function languageExtension(path: string, byteLength: number): Promise<Extension | null> {
  if (byteLength > LARGE_FILE_BYTES) return null;
  const ext = extensionOf(path);
  const loader = BY_EXT[ext];
  if (!loader) return null;
  return loader();
}
