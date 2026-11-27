// Reveal's marks: the markup a node's rendering left out, read from its byte provenance, never
// from a second parse. What a node's range holds outside its children's ranges is what Read did not show: a heading's
// hashes, a list item's marker, emphasis delimiters, a link's destination, a fence's lines. Pure.
import type { Block, Document, Inline, Node } from '@marxy/core';

/**
 * Where a mark goes on the node's element: `open`/`close` inside it at its start and end, `before`/`after` beside it,
 * `line-before`/`line-after` as lines of their own beside it, `hang` at the start of a list item in the bullet's place,
 * `gap` as a line of its own where a node that made no element (an HTML comment) sat: before the next part.
 */
export type MarkPlace = 'open' | 'close' | 'before' | 'after' | 'line-before' | 'line-after' | 'hang' | 'gap';

export interface RevealMark {
  /** The node whose element carries the mark, by type and range. */
  readonly type: Node['type'];
  readonly start: number;
  readonly end: number;
  readonly place: MarkPlace;
  readonly text: string;
}

const decoder = new TextDecoder();
const read = (bytes: Uint8Array, a: number, b: number): string => (b > a ? decoder.decode(bytes.subarray(a, b)) : '');

const INLINE_WRAPS: ReadonlySet<string> = new Set(['emphasis', 'strong', 'strikethrough', 'link']);

/** A block mark keeps only its first line's ending off: a setext underline is the line after the text. */
const trimEnds = (s: string): string => s.replace(/^[\r\n]+|[\r\n]+$/g, '');

/**
 * The marks for `doc`, in document order. Tables are not marked: their cells already draw the rules the pipes stand for,
 * and a delimiter row would be a row the table does not have. Front matter's inside is its rows already.
 */
export function revealMarks(doc: Document, bytes: Uint8Array): RevealMark[] {
  const out: RevealMark[] = [];
  const add = (node: Node, place: MarkPlace, text: string): void => {
    if (text.trim() !== '') out.push({ type: node.type, start: node.src.start, end: node.src.end, place, text });
  };

  const inline = (node: Inline): void => {
    const kids = (node.children ?? []) as readonly Inline[];
    if (INLINE_WRAPS.has(node.type) && kids.length > 0) {
      add(node, 'before', read(bytes, node.src.start, kids[0]!.src.start));
      kids.forEach(inline);
      add(node, 'after', read(bytes, kids.at(-1)!.src.end, node.src.end));
      return;
    }
    if (node.type === 'code') {
      const src = read(bytes, node.src.start, node.src.end);
      const open = /^`+ ?/.exec(src)?.[0] ?? '';
      const close = / ?`+$/.exec(src.slice(open.length))?.[0] ?? '';
      add(node, 'before', open);
      add(node, 'after', close);
      return;
    }
    if (node.type === 'image') add(node, 'before', read(bytes, node.src.start, node.src.end));
    else if (node.type === 'taskMarker') add(node, 'before', read(bytes, node.src.start, node.src.end));
    kids.forEach(inline);
  };

  const block = (node: Block): void => {
    switch (node.type) {
      case 'heading': {
        const kids = node.children;
        if (kids.length === 0) {
          add(node, 'open', trimEnds(read(bytes, node.src.start, node.src.end)));
          return;
        }
        add(node, 'open', read(bytes, node.src.start, kids[0]!.src.start));
        kids.forEach(inline);
        const close = read(bytes, kids.at(-1)!.src.end, node.src.end);
        if (/[\r\n]/.test(close)) add(node, 'line-after', trimEnds(close).trim());
        else add(node, 'close', close);
        return;
      }
      case 'paragraph':
      case 'tableCell':
        node.children.forEach(inline);
        return;
      case 'blockquote': {
        let from = node.src.start;
        for (const child of node.children) {
          // The prefix of the line the child starts on: earlier lines of the gap (a bare `>`) are left out.
          const gap = read(bytes, from, child.src.start);
          const prefix = gap.slice(Math.max(gap.lastIndexOf('\n'), gap.lastIndexOf('\r')) + 1).replace(/^[ \t]+/, '');
          add(child, child.type === 'paragraph' || child.type === 'heading' ? 'open' : 'line-before', prefix);
          block(child);
          from = child.src.end;
        }
        return;
      }
      case 'list':
        node.children.forEach(block);
        return;
      case 'listItem': {
        const first = node.children[0];
        add(node, 'hang', read(bytes, node.src.start, first ? first.src.start : node.src.end).trim() + ' ');
        node.children.forEach(block);
        return;
      }
      case 'codeBlock': {
        if (node.run) return;
        add(node, 'line-before', trimEnds(read(bytes, node.src.start, node.content.start)));
        add(node, 'line-after', trimEnds(read(bytes, node.content.end, node.src.end)));
        return;
      }
      case 'thematicBreak':
        add(node, 'line-before', trimEnds(read(bytes, node.src.start, node.src.end)));
        return;
      case 'footnoteDefinition':
        node.children.forEach(block);
        return;
      case 'table':
        for (const row of node.children) for (const cell of row.children) block(cell);
        return;
      case 'frontmatter': {
        const lines = read(bytes, node.src.start, node.src.end).split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
        if (lines.length < 2) return;
        add(node, 'line-before', lines[0]!);
        add(node, 'line-after', lines.at(-1)!);
        return;
      }
      default:
        return;
    }
  };

  for (const node of doc.children) {
    // A comment makes no element (core's sanitiser takes it out); only one between top-level parts has a place to go.
    if (node.type === 'htmlBlock' && node.value.trimStart().startsWith('<!--')) add(node, 'gap', trimEnds(read(bytes, node.src.start, node.src.end)));
    else block(node);
  }
  return out;
}
