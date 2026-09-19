// AST → HTML, structure and escaping only. This module makes no security decision: raw HTML from
// the file goes out verbatim and a link's URL goes out as written, because the allow-list is the one
// boundary (ADR-0009) and a second, weaker check here would only make it harder to see where the
// boundary is. Its output is never for the DOM — `renderSafeHtml` is (ADR-0007, ADR-0020).

import type { Block, Document, Inline, List, ListItem, Source, Table, TableRow, Text } from '../contracts/ast.ts';
import { PROVENANCE_ATTRIBUTES, type ProvenanceNames } from '../sanitize/policy.ts';
import { escapeAttribute, escapeText } from '../sanitize/escape.ts';
import { smarten } from './typography.ts';

type Typo = { readonly lastText: Text | undefined; readonly wordsInParagraph: number };

const NO_WIDONT: Typo = { lastText: undefined, wordsInParagraph: 0 };

/** What every function below needs to know about the document as a whole. */
interface Context {
  /** Footnote labels in definition order, so every id and back-reference is a number we chose. */
  readonly footnotes: Map<string, number>;
  readonly names: ProvenanceNames;
}

export interface UnsanitisedRenderOptions {
  /**
   * The attribute names byte provenance is written under (ADR-0023). The pipeline passes names only
   * it knows, so that nothing a document wrote can be mistaken for provenance; the default is the
   * public pair, for tests that look at the render before the boundary.
   */
  readonly provenance?: ProvenanceNames;
}

/** ` s="…" e="…"` for a node's own bytes: the attributes every element made for a node carries. */
function prov(src: Source, ctx: Context): string {
  return ` ${ctx.names.start}="${src.start}" ${ctx.names.end}="${src.end}"`;
}

/**
 * Renders the document to HTML that has not been sanitised.
 *
 * The only callers are `renderSafeHtml`, which sanitises what this returns, and the tests that
 * prove the sanitiser's checks can fail — a check that passes against unsanitised output is not
 * checking anything. `render/boundary.test.ts` keeps that list to those two.
 */
export function renderToUnsanitisedHtml(document: Document, options: UnsanitisedRenderOptions = {}): string {
  const ctx: Context = { footnotes: collectFootnotes(document), names: options.provenance ?? PROVENANCE_ATTRIBUTES };
  const parts: string[] = [];
  for (const child of document.children) {
    if (child.type === 'footnoteDefinition') continue;
    parts.push(block(child, false, ctx));
  }
  parts.push(footnoteList(document, ctx));
  return parts.filter((part) => part.length > 0).join('\n');
}

/** Footnote labels in definition order, so every id and back-reference is a number we chose. */
function collectFootnotes(document: Document): Map<string, number> {
  const labels = new Map<string, number>();
  for (const child of document.children) {
    if (child.type === 'footnoteDefinition' && !labels.has(child.label)) labels.set(child.label, labels.size + 1);
  }
  return labels;
}

function footnoteList(document: Document, ctx: Context): string {
  const definitions = document.children.filter((child) => child.type === 'footnoteDefinition');
  if (definitions.length === 0) return '';
  const items = definitions.map((definition) => {
    const number = ctx.footnotes.get(definition.label) ?? 0;
    const body = definition.children.map((child) => block(child, false, ctx)).join('\n');
    return `<li id="marxy-fn-${number}"${prov(definition.src, ctx)}>${body}<a href="#marxy-fnref-${number}" class="marxy-footnote-back">\u21a9</a></li>`;
  });
  return `<hr />\n<ol class="marxy-footnotes">\n${items.join('\n')}\n</ol>`;
}

function blocks(nodes: readonly Block[], tight: boolean, ctx: Context): string {
  return nodes.map((node) => block(node, tight, ctx)).join('\n');
}

function block(node: Block, tight: boolean, ctx: Context): string {
  switch (node.type) {
    case 'paragraph':
      // A tight list item's paragraph has no tags of its own, which is what makes the list tight.
      return tight
        ? inlines(node.children, ctx, paragraphTypo(node.children))
        : `<p${prov(node.src, ctx)}>${inlines(node.children, ctx, paragraphTypo(node.children))}</p>`;
    case 'heading':
      return `<h${node.level}${prov(node.src, ctx)}>${inlines(node.children, ctx)}</h${node.level}>`;
    case 'thematicBreak':
      return `<hr${prov(node.src, ctx)} />`;
    case 'blockquote':
      return `<blockquote${prov(node.src, ctx)}>\n${blocks(node.children, false, ctx)}\n</blockquote>`;
    case 'codeBlock': {
      const language = node.lang === undefined || node.lang === '' ? '' : ` class="language-${escapeAttribute(node.lang)}"`;
      const value = node.value.length > 0 ? `${escapeText(node.value)}\n` : '';
      // The `<pre>` is the whole fence; the `<code>` is the content between the fence lines.
      return `<pre${prov(node.src, ctx)}><code${language}${prov(node.content, ctx)}>${value}</code></pre>`;
    }
    case 'htmlBlock':
      return node.value;
    case 'list':
      return list(node, ctx);
    case 'listItem':
      return listItem(node, false, ctx);
    case 'table':
      return table(node, ctx);
    case 'tableRow':
      return `<tr${prov(node.src, ctx)}>\n${cells(node, undefined, ctx)}</tr>`;
    case 'tableCell':
      return `<td${prov(node.src, ctx)}>${inlines(node.children, ctx)}</td>`;
    case 'mathBlock':
      // Set as code until KaTeX loads on first use (MARXY-28); the source is what a reader has now.
      return `<pre class="marxy-math-block"${prov(node.src, ctx)}><code>${escapeText(node.value)}\n</code></pre>`;
    case 'footnoteDefinition':
      return blocks(node.children, false, ctx);
    case 'frontmatter':
      // Metadata, not prose. Showing it is a decision for the story that designs the document head.
      return '';
    default:
      return '';
  }
}

function list(node: List, ctx: Context): string {
  const items = node.children.map((item) => listItem(item, node.tight, ctx)).join('\n');
  if (!node.ordered) return `<ul${prov(node.src, ctx)}>\n${items}\n</ul>`;
  const start = node.start === undefined || node.start === 1 ? '' : ` start="${node.start}"`;
  return `<ol${start}${prov(node.src, ctx)}>\n${items}\n</ol>`;
}

function listItem(node: ListItem, tight: boolean, ctx: Context): string {
  return `<li${prov(node.src, ctx)}>${blocks(node.children, tight, ctx)}</li>`;
}

function table(node: Table, ctx: Context): string {
  const [header, ...body] = node.children;
  const parts: string[] = [`<table${prov(node.src, ctx)}>`];
  if (header) parts.push(`<thead>\n<tr${prov(header.src, ctx)}>\n${cells(header, node, ctx)}</tr>\n</thead>`);
  if (body.length > 0) {
    parts.push('<tbody>');
    for (const row of body) parts.push(`<tr${prov(row.src, ctx)}>\n${cells(row, node, ctx)}</tr>`);
    parts.push('</tbody>');
  }
  parts.push('</table>');
  return parts.join('\n');
}

function cells(row: TableRow, owner: Table | undefined, ctx: Context): string {
  const tag = row.header ? 'th' : 'td';
  return row.children
    .map((cell, column) => {
      const align = owner?.align[column];
      const attribute = align ? ` align="${align}"` : '';
      return `<${tag}${attribute}${prov(cell.src, ctx)}>${inlines(cell.children, ctx)}</${tag}>\n`;
    })
    .join('');
}

function paragraphTypo(nodes: readonly Inline[]): Typo {
  return { lastText: lastTextNode(nodes), wordsInParagraph: wordsIn(nodes) };
}

function lastTextNode(nodes: readonly Inline[]): Text | undefined {
  let last: Text | undefined;
  const walk = (list: readonly Inline[]): void => {
    for (const child of list) {
      if (child.type === 'text') last = child;
      else if (
        child.type === 'emphasis' ||
        child.type === 'strong' ||
        child.type === 'strikethrough' ||
        child.type === 'link'
      ) {
        walk(child.children);
      }
    }
  };
  walk(nodes);
  return last;
}

function wordsIn(nodes: readonly Inline[]): number {
  const parts: string[] = [];
  const walk = (list: readonly Inline[]): void => {
    for (const child of list) {
      switch (child.type) {
        case 'text':
        case 'code':
        case 'mathInline':
          parts.push(child.value);
          break;
        case 'softBreak':
        case 'hardBreak':
          parts.push(' ');
          break;
        case 'emphasis':
        case 'strong':
        case 'strikethrough':
        case 'link':
          walk(child.children);
          break;
        default:
          break;
      }
    }
  };
  walk(nodes);
  const text = parts.join('').trim();
  return text.length === 0 ? 0 : text.split(/\s+/).length;
}

function inlines(nodes: readonly Inline[], ctx: Context, typo: Typo = NO_WIDONT): string {
  let text = '';
  for (const node of nodes) text += inline(node, ctx, typo);
  return text;
}

function inline(node: Inline, ctx: Context, typo: Typo): string {
  switch (node.type) {
    case 'text':
      return escapeText(
        smarten(node.value, {
          atParagraphEnd: typo.lastText === node,
          wordsInParagraph: typo.wordsInParagraph,
        }),
      );
    case 'emphasis':
      return `<em${prov(node.src, ctx)}>${inlines(node.children, ctx, typo)}</em>`;
    case 'strong':
      return `<strong${prov(node.src, ctx)}>${inlines(node.children, ctx, typo)}</strong>`;
    case 'strikethrough':
      return `<del${prov(node.src, ctx)}>${inlines(node.children, ctx, typo)}</del>`;
    case 'code':
      return `<code${prov(node.src, ctx)}>${escapeText(node.value.replace(/\r?\n/g, ' '))}</code>`;
    case 'link': {
      const title = node.title === undefined ? '' : ` title="${escapeAttribute(node.title)}"`;
      return `<a href="${escapeAttribute(node.url)}"${title}${prov(node.src, ctx)}>${inlines(node.children, ctx, typo)}</a>`;
    }
    case 'image': {
      // The URL is written out as it stands; whether it may load is the sanitiser's decision, and by
      // default a remote one loses its `src` and the reader sees the alt text (MARXY-26 names the host).
      const title = node.title === undefined ? '' : ` title="${escapeAttribute(node.title)}"`;
      return `<img src="${escapeAttribute(node.url)}" alt="${escapeAttribute(node.alt)}"${title}${prov(node.src, ctx)} />`;
    }
    case 'html':
      return node.value;
    case 'softBreak':
      return '\n';
    case 'hardBreak':
      return `<br${prov(node.src, ctx)} />\n`;
    case 'footnoteReference': {
      const number = ctx.footnotes.get(node.label);
      if (number === undefined) return escapeText(`[^${node.label}]`);
      return `<sup class="marxy-footnote-ref" id="marxy-fnref-${number}"${prov(node.src, ctx)}><a href="#marxy-fn-${number}">${number}</a></sup>`;
    }
    case 'mathInline':
      return `<code class="marxy-math"${prov(node.src, ctx)}>${escapeText(node.value.replace(/\r?\n/g, ' '))}</code>`;
    case 'taskMarker':
      return `<input type="checkbox" disabled${node.checked ? ' checked' : ''}${prov(node.src, ctx)} /> `;
    default:
      return '';
  }
}
