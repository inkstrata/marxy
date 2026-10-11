// What a clipboard payload is (E-14, ADR-0065). Pure: no DOM, no Node built-ins, no clipboard read
// (the shell reads; this only looks at what it was handed). The same payload always gives the same
// answer and the same bytes.

export interface ClipboardPayload {
  readonly text?: string;
  readonly html?: string;
}

export type ClipboardKind = 'empty' | 'markdown' | 'html' | 'json' | 'text';

export interface Classified {
  readonly kind: ClipboardKind;
  /** Set for `markdown`, `json` and `text`. Absent for `html`: converting it needs a DOM (the desktop app). */
  readonly markdown?: string;
}

/** A backtick fence one longer than any backtick run in `text` (never shorter than three). */
export function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/m;
const ATX_HEADING = /^ {0,3}#{1,6}[ \t]+\S/m;
const LIST_LINE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/gm;
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$|^[ \t]*\|[ \t]*:?-+:?[ \t]*\|?[ \t]*$/m;
const INLINE_MARKS = [/\*\*[^*\n]+\*\*/g, /`[^`\n]+`/g, /\[[^\]\n]+\]\([^)\n]+\)/g];
const BLOCK_ELEMENT = /<(?:p|div|h[1-6]|ul|ol|li|table|pre|blockquote|br)(?=[\s/>])/i;

/** The heuristic of E-14: a fence, an ATX heading, two list lines, a GFM delimiter row, or two inline marks. */
export function looksLikeMarkdown(text: string): boolean {
  if (FENCE_LINE.test(text) || ATX_HEADING.test(text) || TABLE_DELIMITER.test(text)) return true;
  if ((text.match(LIST_LINE) ?? []).length >= 2) return true;
  let marks = 0;
  for (const re of INLINE_MARKS) marks += (text.match(re) ?? []).length;
  return marks >= 2;
}

function isJsonContainer(text: string): boolean {
  const t = text.trim();
  if (!(t.startsWith('{') && t.endsWith('}')) && !(t.startsWith('[') && t.endsWith(']'))) return false;
  try {
    const value: unknown = JSON.parse(t);
    return typeof value === 'object' && value !== null;
  } catch {
    return false;
  }
}

export function classifyClipboard(payload: ClipboardPayload): Classified {
  const text = payload.text ?? '';
  const html = payload.html ?? '';
  const hasText = text.trim() !== '';
  const hasHtml = html.trim() !== '';
  if (!hasText && !hasHtml) return { kind: 'empty' };

  // An assistant's "copy" button puts the author's exact markdown in text/plain beside a rendered
  // text/html. Those bytes beat any conversion of the rendering.
  if (hasText && looksLikeMarkdown(text)) return { kind: 'markdown', markdown: text };
  if (hasHtml && BLOCK_ELEMENT.test(html)) return { kind: 'html' };
  if (hasText && isJsonContainer(text)) {
    const body = text.replace(/(?:\r?\n)+$/, '');
    const fence = fenceFor(body);
    return { kind: 'json', markdown: `${fence}json\n${body}\n${fence}\n` };
  }
  if (hasText) return { kind: 'text', markdown: text };
  return { kind: 'empty' };
}
