// The parse of a code file (V-10): no Markdown. One document holding one code block over all of the file's
// bytes, so that Rendered shows `inventory.py` as the code it is and a `# section` comment is never a heading.
// The block's `src` and `content` are both the whole file after any byte-order mark (a copy of the block is
// the file's bytes), and its `value` is the text less the last line ending, so the closing newline is not drawn
// as an empty line. The bytes are never copied, trimmed or re-flowed (commitment 3). Highlighting is the renderer's, lazily, as for a
// fence; a file with no grammar has no `lang` and is plain monospace.

import type { Document, Source } from '../contracts/ast.ts';
import { fileTypeOf } from '../index-model/file-types.ts';
import { registerLineStarts } from '../sourcemap/line-starts.ts';
import { decodeWithOffsets } from './byte-offsets.ts';
import { lineStarts, markDefinitions } from './from-mdast.ts';

export interface CodeParseOptions {
  /** Absolute path, or a stable identifier for an untitled buffer. Defaults to `untitled`. */
  readonly file?: string;
  /** The Shiki id of the file's language; absent for a file with no grammar (plain monospace, no guess). */
  readonly lang?: string;
}

/** Whether the file-type table calls `path` code (V-09): the files that open in Source and are read as code. */
export function isCodeFile(path: string): boolean {
  return fileTypeOf(path)?.kind === 'source';
}

/** The Shiki id the file-type table gives `path`, or `undefined` when it has none. */
export function codeLanguageOf(path: string): string | undefined {
  return fileTypeOf(path)?.shiki;
}

/** `bytes` as one code block. An empty file has no block, as an empty Markdown file has none. */
export function parseCode(bytes: Uint8Array, options: CodeParseOptions = {}): Document {
  const file = options.file ?? 'untitled';
  let skipped = 0;
  while (bytes[skipped] === 0xef && bytes[skipped + 1] === 0xbb && bytes[skipped + 2] === 0xbf) skipped += 3;
  const { text, offsets } = decodeWithOffsets(bytes, skipped);
  const ending = /\r\n$|[\r\n]$/.exec(text);
  const value = ending ? text.slice(0, text.length - ending[0].length) : text;
  const start = offsets.at(0);
  const src: Source = { file, start, end: offsets.byteLength };
  const document: Document = {
    type: 'document',
    src: { file, start: 0, end: offsets.byteLength },
    path: file,
    children: text === ''
      ? []
      : [{ type: 'codeBlock', src, ...(options.lang ? { lang: options.lang } : {}), value, content: src }],
  };
  registerLineStarts(document, () => lineStarts({ file, text, offsets }));
  markDefinitions(document, false);
  return document;
}
