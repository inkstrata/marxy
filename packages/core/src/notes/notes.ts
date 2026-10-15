// Notes about a Markdown file (V-04): what Marxy notices without touching the text. Two are found here, from the source
// and its AST: a fence that is never closed (so everything after it is code) and a heading that skips a level. A path
// that does not exist needs the file system, so the desktop adds it (`resolveMentioned`). Pure: no DOM, no Node built-ins.
//
// A note says what it saw in words, at a place; it never says what to do and never changes a byte. It is not prose lint:
// nothing here reads the words of a paragraph.
import type { CodeBlock, Document, Heading } from '../contracts/ast.ts';
import { nodesOf, parseText, utf8Length } from '../transforms/prose.ts';

export type NoteKind = 'fence' | 'heading' | 'path';

export interface Note {
  readonly kind: NoteKind;
  /** The range the note is about, in UTF-16 offsets of the text it was found in (the editor's text, lines joined by LF). */
  readonly start: number;
  readonly end: number;
  /** The same range in UTF-8 bytes of that text, when the note comes from the AST (a path note has none). */
  readonly byteStart: number | null;
  readonly byteEnd: number | null;
  /** 1-based line and column (UTF-16 units) of `start`. */
  readonly line: number;
  readonly column: number;
  /** What the note says, in the words of its tooltip. */
  readonly words: string;
}

/** The line and column (both 1-based) of a UTF-16 offset in `lf`. */
export function lineColumnAt(lf: string, offset: number): { line: number; column: number } {
  let line = 1;
  let from = 0;
  for (let at = lf.indexOf('\n'); at !== -1 && at < offset; at = lf.indexOf('\n', at + 1)) {
    line++;
    from = at + 1;
  }
  return { line, column: offset - from + 1 };
}

/** The container marks a fence line may sit behind: indentation and block-quote markers. */
const LEAD = /^[ \t>]*/;
const OPENER = /^(`{3,}|~{3,})/;

/** Whether `last` (the final line of a fenced block) closes a fence opened with `opener`. */
function closes(last: string, opener: string): boolean {
  const rest = last.replace(LEAD, '');
  const run = /^(`+|~+)[ \t]*$/.exec(rest);
  return run !== null && run[1]![0] === opener[0] && run[1]!.length >= opener.length;
}

/** The notes in `lf` that come from the AST, in document order. `doc` is the parse of `lf` (parsed here when omitted). */
export function notesOf(lf: string, doc: Document = parseText(lf)): Note[] {
  const out: Note[] = [];
  const at = (start: number, end: number, byteStart: number, byteEnd: number, kind: NoteKind, words: (l: number, c: number) => string): void => {
    const { line, column } = lineColumnAt(lf, start);
    out.push({ kind, start, end, byteStart, byteEnd, line, column, words: words(line, column) });
  };

  let previousLevel = 0;
  for (const { node, span } of nodesOf<CodeBlock | Heading>(lf, doc, ['codeBlock', 'heading'])) {
    if (node.type === 'heading') {
      if (previousLevel > 0 && node.level > previousLevel + 1) {
        at(span.start, span.end, node.src.start, node.src.end, 'heading', (l, c) => `Heading at ${l}:${c} jumps from level ${previousLevel} to level ${node.level}`);
      }
      previousLevel = node.level;
      continue;
    }
    if (node.run === true) continue; // a code file read as code has no fences
    const text = lf.slice(span.start, span.end).replace(/\n+$/, '');
    const firstEnd = text.indexOf('\n');
    const firstRaw = firstEnd === -1 ? text : text.slice(0, firstEnd);
    // A fence may be indented at most three spaces; four (or a tab) make the block indented code, which has no fence to close.
    if (/^(?: {4}|\t)/.test(firstRaw)) continue;
    const first = firstRaw.replace(LEAD, '');
    const opener = OPENER.exec(first)?.[1];
    if (opener === undefined) continue; // an indented block has no fence
    const lastStart = text.lastIndexOf('\n');
    // A block of one line is an opener at the end of the file: nothing closes it.
    if (firstEnd !== -1 && closes(text.slice(lastStart + 1), opener)) continue;
    const lineEnd = firstEnd === -1 ? span.end : span.start + firstEnd;
    at(span.start, lineEnd, node.src.start, node.src.start + utf8Length(lf.slice(span.start, lineEnd)), 'fence', (l, c) => `Fence opened at ${l}:${c} is never closed`);
  }
  return out;
}
