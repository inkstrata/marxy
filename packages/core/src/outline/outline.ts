// Heading list from one AST walk. Entries keep the heading node's byte range.

import type { Document, Frontmatter, Heading, Inline, Node, Source } from '../contracts/ast.ts';
import { budget } from '../util/budget.ts';

export interface OutlineEntry {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
  readonly src: Source;
}

/**
 * The most headings the Outline panel draws; past it its rows are the first ones and the panel says so. Only where rows
 * are drawn: the address and the Line read every heading, which the parse has already bounded.
 */
export const OUTLINE_MAX = 20_000;

export interface Outline {
  readonly entries: OutlineEntry[];
  /** More headings than the limit asked for: the entries are the first ones. */
  readonly capped: boolean;
}

/** Every heading of the document, in document order. */
export function outlineFrom(doc: Document): OutlineEntry[] {
  return outlineOf(doc).entries;
}

/** The document's first `limit` headings (all of them by default), in document order, and whether there were more. */
export function outlineOf(doc: Document, limit = Number.POSITIVE_INFINITY): Outline {
  const { headings, capped, hasH1 } = headingsOf(doc, limit);
  const entries = headings.map((heading) => ({
    level: heading.level,
    text: visibleText(heading.children),
    src: heading.src,
  }));
  const title = hasH1 ? undefined : frontmatterTitle(doc);
  if (title) entries.unshift(title);
  return { entries, capped };
}

/**
 * The document's first `limit` headings in document order, whether any heading is an h1, and where the first one left
 * out starts. A walk of its own rather than the stack's: a quote of 200,000 headings, spread into its parent's list,
 * threw a RangeError.
 */
export function headingsOf(doc: Document, limit = Number.POSITIVE_INFINITY): { headings: Heading[]; capped: boolean; hasH1: boolean; firstLeftOut: number | null } {
  const kept = budget(limit);
  const headings: Heading[] = [];
  let hasH1 = false;
  let firstLeftOut: number | null = null;
  const todo: Node[] = [doc];
  while (todo.length > 0) {
    const node = todo.pop()!;
    if (node.type === 'heading') {
      if (node.level === 1) hasH1 = true;
      if (kept.take()) headings.push(node);
      else firstLeftOut ??= node.src.start;
    }
    const children = node.children ?? [];
    for (let i = children.length - 1; i >= 0; i--) todo.push(children[i]!);
  }
  return { headings, capped: kept.hit, hasH1, firstLeftOut };
}

function frontmatterTitle(doc: Document): OutlineEntry | undefined {
  const matter = doc.children.find((child): child is Frontmatter => child.type === 'frontmatter');
  if (!matter) return undefined;
  // [ \t]*, not \s*: an empty `title:` must not read the next key's line as the title. A YAML block
  // scalar (`title: |`) has no one-line value to show, so it gives no entry either.
  const yaml = /^title:[ \t]*(\S.*)$/m.exec(matter.value);
  const toml = /^title\s*=\s*(\S.*)$/m.exec(matter.value);
  const raw = yaml?.[1] ?? toml?.[1];
  if (!raw || /^[|>][+-]?\d*\s*$/.test(raw)) return undefined;
  return { level: 1, text: unquote(raw), src: matter.src };
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.length >= 2 && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function visibleText(nodes: readonly Inline[]): string {
  return nodes.map(inlineContribution).join('').replace(/\s+/g, ' ').trim();
}

function inlineContribution(node: Inline): string {
  switch (node.type) {
    case 'text':
    case 'code':
    case 'mathInline':
      // The TeX source, undelimited: the row is plain text, as inline code is shown without its backticks.
      return node.value;
    case 'emphasis':
    case 'strong':
    case 'strikethrough':
    case 'link':
      return node.children.map(inlineContribution).join('');
    case 'image':
      return node.alt;
    case 'softBreak':
    case 'hardBreak':
      return ' ';
    case 'html':
    case 'footnoteReference':
    case 'taskMarker':
      return '';
  }
}
