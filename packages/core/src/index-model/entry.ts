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

/** Heading recorded on an index entry: level, text, and the byte where the line starts. */
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
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  let lineStart = i;
  let inFence = false;
  let frontmatter: 'none' | 'open' | 'done' = 'none';
  while (i <= bytes.length) {
    const atEnd = i === bytes.length;
    const isLf = !atEnd && bytes[i] === 0x0a;
    if (!atEnd && !isLf) {
      i += 1;
      continue;
    }
    let lineEnd = i;
    if (lineEnd > lineStart && bytes[lineEnd - 1] === 0x0d) lineEnd -= 1;
    const line = decoder.decode(bytes.subarray(lineStart, lineEnd));
    const trimmed = line.trim();
    if (frontmatter === 'none' && lineStart <= 3 && trimmed === '---') {
      frontmatter = 'open';
    } else if (frontmatter === 'open' && (trimmed === '---' || trimmed === '...')) {
      frontmatter = 'done';
    } else if (frontmatter !== 'open') {
      if (/^(```|~~~)/.test(trimmed)) inFence = !inFence;
      else if (!inFence) {
        const match = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
        if (match) {
          headings.push({
            level: match[1]!.length,
            text: match[2]!.trim(),
            byteOffset: lineStart,
          });
        }
      }
    }
    i += 1;
    lineStart = i;
    if (atEnd) break;
  }
  return headings;
}

const decoder = new TextDecoder('utf-8');
