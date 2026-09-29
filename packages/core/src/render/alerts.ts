// GitHub alert blockquotes: a run-in type word, marker hidden, no box or colour (handbook ch.6).

import type { Blockquote, Inline, Paragraph } from '../contracts/ast.ts';

const ALERT_TYPES: Readonly<Record<string, string>> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};

export interface ParsedAlert {
  readonly type: string;
  readonly label: string;
  readonly body: readonly Inline[];
}

const MARKER = /^\[!([A-Z]+)\](?:\s+(.*))?$/i;

function firstParagraph(block: Blockquote): Paragraph | undefined {
  const child = block.children[0];
  return child?.type === 'paragraph' ? child : undefined;
}

/** Render-time only; the marker stays in the source bytes. */
export function parseAlert(block: Blockquote): ParsedAlert | undefined {
  const paragraph = firstParagraph(block);
  if (!paragraph || paragraph.children.length === 0) return undefined;
  const first = paragraph.children[0];
  if (first.type !== 'text') return undefined;
  const match = MARKER.exec(first.value);
  if (!match) return undefined;
  const kind = match[1]!.toUpperCase();
  const word = ALERT_TYPES[kind];
  if (!word) return undefined;
  const title = match[2]?.trim();
  const label = title && title.length > 0 ? title : word;
  const rest: Inline[] = [];
  let skipBreak = true;
  for (const child of paragraph.children.slice(1)) {
    if (skipBreak && child.type === 'softBreak') {
      skipBreak = false;
      continue;
    }
    rest.push(child);
  }
  return { type: kind, label, body: rest };
}

