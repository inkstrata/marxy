// The parse of a code file (V-10): no Markdown. One document whose code blocks are the file in pieces of at most
// CODE_CHUNK_LINES lines, so that Rendered shows `inventory.py` as the code it is (a `# section` comment is never a
// heading) and can be set in slices (commitment 5). Each piece's `src` and `content` are its bytes (the pieces tile
// the file after any byte-order mark, so a copy is the file's bytes), and its `value` is its text less its last line
// ending, so a closing newline is not drawn as an empty line; a NUL is the replacement character in the value, as in
// a Markdown code block (the bytes keep it). Each piece carries `run`, so the renderer draws them as one block. The bytes are never copied, trimmed or re-flowed (commitment 3). Highlighting is the renderer's, lazily, as for a
// fence; a file with no grammar has no `lang` and is plain monospace.

import type { Document, Source } from '../contracts/ast.ts';
import { fileTypeOf } from '../index-model/file-types.ts';
import { TIMESTAMP } from '../kind/detect.ts';
import { registerLineStarts } from '../sourcemap/line-starts.ts';
import { decodeWithOffsets } from './byte-offsets.ts';
import { lineStarts, markDefinitions } from './from-mdast.ts';
import { nextLineEnding } from './line-endings.ts';

/** The most lines in one piece of a code file. */
export const CODE_CHUNK_LINES = 200;
/**
 * A log's piece ends at the end of a log entry (before the next line that opens with a timestamp and a level word) once
 * it has 200 lines, however long the entry is (K-08): a stack trace is never cut from the line it belongs to and every
 * piece begins at a head, so what the level of a line is can be read from its piece alone and the page and the whole-file
 * count cannot disagree. A piece with no head in its first 200 lines is cut at 200 like any other code: its lines
 * have no head before them either, so they are in the same (orphan) rank in a piece as in the file.
 */

/** Whether the line starting at `at` opens with a timestamp and a level word; only its first characters are read. */
function isLogHead(text: string, at: number): boolean {
  const first = text.charCodeAt(at);
  // A head opens with a bracket or a digit: most continuation lines (frames, wrapped text) are rejected here.
  if (!(first === 0x5b || (first >= 0x30 && first <= 0x39))) return false;
  return TIMESTAMP.test(text.slice(at, at + 160));
}

/** Kind `source` in the file-type table, but read by their own stories (K-06 data, K-10 tables) or trust-gated (HTML). */
const READ_ELSEWHERE: ReadonlySet<string> = new Set(['html', 'htm', 'csv', 'tsv', 'jsonl']);

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
  const isLog = options.lang === 'log';
  for (let at = 0; at < text.length; ) {
    let end = at;
    let lines = 0;
    let sawHead = false;
    for (; lines < CODE_CHUNK_LINES && end < text.length; lines++) {
      if (isLog && !sawHead) sawHead = isLogHead(text, end);
      const ending = nextLineEnding(text, end);
      end = ending === undefined ? text.length : ending.end;
    }
    // A log's piece runs on to the end of its entry (K-08): the next piece opens with a head.
    while (isLog && sawHead && end < text.length && !isLogHead(text, end)) {
      const ending = nextLineEnding(text, end);
      end = ending === undefined ? text.length : ending.end;
      lines++;
    }
    // A diff's piece runs on to the next header (K-09): it then begins at one, so a hunk's counts are read from its piece alone.
    while (options.lang === 'diff' && end < text.length && !text.startsWith('@@', end) && !text.startsWith('diff ', end)) {
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
