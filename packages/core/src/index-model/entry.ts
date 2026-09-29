// Turns a walked file into an IndexEntry. Title is the first h1, or the filename (ADR-0012).

import type { IndexEntry } from '../contracts/index-entry.ts';
import { classify } from './kinds.ts';
import { basename } from './paths.ts';

export interface IndexCandidate {
  readonly path: string;
  readonly relativePath: string;
  readonly mtimeMs: number;
  readonly size: number;
  /** Present only when the host already read the file; the walk itself does not. */
  readonly bytes?: Uint8Array;
}

/** Heading recorded on an index entry: level, text, and the byte of its `#` (the parser's heading start). */
export interface IndexHeading {
  readonly level: number;
  readonly text: string;
  readonly byteOffset: number;
}

/** Build an entry. Headings are filled only when `bytes` are provided — the 20k walk stays metadata. */
export function entryFromCandidate(root: string, candidate: IndexCandidate): IndexEntry {
  const kind = classify(candidate.relativePath) ?? classify(candidate.path) ?? 'text';
  const name = basename(candidate.path);
  const headings = candidate.bytes ? headingsFromMarkdown(candidate.bytes) : [];
  const h1 = headings.find((heading) => heading.level === 1);
  return {
    path: candidate.path,
    root,
    title: h1?.text || name,
    headings,
    mtimeMs: candidate.mtimeMs,
    size: candidate.size,
    kind,
  };
}

/**
 * ATX headings only. The index is metadata, not a second parse of the document AST, so this
 * stays a line scan and leaves provenance to `parseMarkdown`.
 */
export function headingsFromMarkdown(bytes: Uint8Array): IndexHeading[] {
  const headings: IndexHeading[] = [];
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const lines = splitLines(bytes, hasBom ? 3 : 0);
  // Front matter only opens on the very first line, and only when a closing line exists.
  let index = 0;
  if (lines.length > 0 && lines[0]!.text.trimEnd() === '---') {
    for (let k = 1; k < lines.length; k++) {
      const t = lines[k]!.text.trimEnd();
      if (t === '---' || t === '...') {
        index = k + 1;
        break;
      }
    }
  }
  let openFence: { readonly char: '`' | '~'; readonly len: number } | null = null;
  let inComment = false;
  for (; index < lines.length; index++) {
    const { text: line, start } = lines[index]!;
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (openFence === null) {
      const marker = fenceMarker(line);
      if (marker) {
        openFence = marker;
        continue;
      }
      if (/^ {0,3}<!--/.test(line)) {
        inComment = !line.slice(line.indexOf('<!--') + 4).includes('-->');
        continue;
      }
      const match = /^( {0,3})(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
      if (match) {
        // The closing `#` run counts only when a space or tab precedes it (or it is the whole content).
        const text = (match[3] ?? '').replace(/[ \t]+$/, '').replace(/(?:^|[ \t]+)#+$/, '').trim();
        if (text !== '') headings.push({ level: match[2]!.length, text, byteOffset: start + match[1]!.length });
      }
    } else if (isClosingFence(line, openFence.char, openFence.len)) {
      openFence = null;
    }
  }
  return headings;
}

interface SourceLine {
  readonly text: string;
  readonly start: number;
}

/** Lines split on CRLF, CR and LF; `start` is the byte offset of the line's first byte. */
function splitLines(bytes: Uint8Array, from: number): SourceLine[] {
  const lines: SourceLine[] = [];
  let lineStart = from;
  let i = from;
  while (i <= bytes.length) {
    const b = i < bytes.length ? bytes[i] : -1;
    if (b === 0x0a || b === 0x0d || b === -1) {
      lines.push({ text: decoder.decode(bytes.subarray(lineStart, i)), start: lineStart });
      if (b === 0x0d && bytes[i + 1] === 0x0a) i += 1;
      i += 1;
      lineStart = i;
      if (b === -1) break;
      continue;
    }
    i += 1;
  }
  // A trailing terminator leaves an empty final "line"; it can hold no heading.
  return lines;
}

const decoder = new TextDecoder('utf-8');

const FENCE_RUN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Opening fence on this line (up to three spaces of indent), if any. */
function fenceMarker(line: string): { char: '`' | '~'; len: number } | null {
  const match = FENCE_RUN.exec(line);
  if (!match) return null;
  const run = match[1]!;
  const char = run[0] === '~' ? '~' : '`';
  // A backtick fence's info string may not itself contain a backtick (that is inline code).
  if (char === '`' && match[2]!.includes('`')) return null;
  return { char, len: run.length };
}

/** CommonMark closing fence: same marker, length at least the opener, only spaces after. */
function isClosingFence(line: string, char: '`' | '~', openLen: number): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  if (!match) return false;
  const run = match[1]!;
  const runChar = run[0] === '~' ? '~' : '`';
  return runChar === char && run.length >= openLen;
}
