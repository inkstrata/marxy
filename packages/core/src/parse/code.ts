// The parse of a code file (V-10): no Markdown. One document whose code blocks are the file in pieces of at most
// CODE_CHUNK_LINES lines, so that Rendered shows `inventory.py` as the code it is (a `# section` comment is never a
// heading) and can be set in slices (commitment 5). Each piece's `src` and `content` are its bytes (the pieces tile
// the file after any byte-order mark, so a copy is the file's bytes), and its `value` is its text less its last line
// ending, so a closing newline is not drawn as an empty line; a NUL is the replacement character in the value, as in
// a Markdown code block (the bytes keep it). Each piece carries `run`, so the renderer draws them as one block. The bytes are never copied, trimmed or re-flowed (commitment 3). Highlighting is the renderer's, lazily, as for a
// fence; a file with no grammar has no `lang` and is plain monospace.

import type { Document, Source } from '../contracts/ast.ts';
import { fileTypeOf } from '../index-model/file-types.ts';
import { registerLineStarts } from '../sourcemap/line-starts.ts';
import { decodeWithOffsets } from './byte-offsets.ts';
import { lineStarts, markDefinitions } from './from-mdast.ts';
import { nextLineEnding } from './line-endings.ts';

/** The most lines in one piece of a code file. */
export const CODE_CHUNK_LINES = 200;

/** Kind `source` in the file-type table, but read by their own stories (K-06 data, K-08 logs, K-10 tables) or trust-gated (HTML). */
const READ_ELSEWHERE: ReadonlySet<string> = new Set(['html', 'htm', 'log', 'csv', 'tsv', 'jsonl']);

export interface CodeParseOptions {
  /** Absolute path, or a stable identifier for an untitled buffer. Defaults to `untitled`. */
  readonly file?: string;
  /** The Shiki id of the file's language; absent for a file with no grammar (plain monospace, no guess). */
  readonly lang?: string;
}

/** Whether the file-type table calls `path` code (V-09): the files that open in Source and are read as code. */
export function isCodeFile(path: string): boolean {
  if (fileTypeOf(path)?.kind !== 'source') return false;
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 || !READ_ELSEWHERE.has(name.slice(dot + 1).toLowerCase());
}

/** The Shiki id the file-type table gives `path`, or `undefined` when it has none. */
export function codeLanguageOf(path: string): string | undefined {
  return fileTypeOf(path)?.shiki;
}

/** `bytes` as code blocks of at most `CODE_CHUNK_LINES` lines. An empty file has none, as an empty Markdown file has none. */
export function parseCode(bytes: Uint8Array, options: CodeParseOptions = {}): Document {
  const file = options.file ?? 'untitled';
  let skipped = 0;
  while (bytes[skipped] === 0xef && bytes[skipped + 1] === 0xbb && bytes[skipped + 2] === 0xbf) skipped += 3;
  const { text, offsets } = decodeWithOffsets(bytes, skipped);
  const children: Document['children'][number][] = [];
  for (let at = 0; at < text.length; ) {
    let end = at;
    for (let lines = 0; lines < CODE_CHUNK_LINES && end < text.length; lines++) {
      const ending = nextLineEnding(text, end);
      end = ending === undefined ? text.length : ending.end;
    }
    const piece = text.slice(at, end);
    const last = /\r\n$|[\r\n]$/.exec(piece);
    const value = (last ? piece.slice(0, piece.length - last[0].length) : piece).replace(/\u0000/g, '\ufffd');
    const src: Source = { file, start: offsets.at(at), end: offsets.at(end) };
    children.push({ type: 'codeBlock', src, ...(options.lang ? { lang: options.lang } : {}), value, content: src, run: true });
    at = end;
  }
  const document: Document = {
    type: 'document',
    src: { file, start: 0, end: offsets.byteLength },
    path: file,
    children,
  };
  registerLineStarts(document, () => lineStarts({ file, text, offsets }));
  markDefinitions(document, false);
  return document;
}
