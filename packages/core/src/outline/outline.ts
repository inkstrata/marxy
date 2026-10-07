// Heading list from one AST walk. Entries keep the heading node's byte range (ADR-0003, ADR-0020).

import type { Document, Frontmatter, Heading, Inline, Node, Source } from '../contracts/ast.ts';

export interface OutlineEntry {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
  readonly src: Source;
}

export function outlineFrom(doc: Document): OutlineEntry[] {
  const headings = headingsOf(doc);
  const entries = headings.map((heading) => ({
    level: heading.level,
    text: visibleText(heading.children),
    src: heading.src,
  }));
  const title = frontmatterTitle(doc, headings);
  if (title) entries.unshift(title);
  return entries;
}

function headingsOf(node: Node): Heading[] {
  const found: Heading[] = node.type === 'heading' ? [node] : [];
  for (const child of node.children ?? []) found.push(...headingsOf(child));
  return found;
}

function frontmatterTitle(doc: Document, headings: readonly Heading[]): OutlineEntry | undefined {
  if (headings.some((heading) => heading.level === 1)) return undefined;
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
