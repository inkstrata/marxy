// AST → HTML, structure and escaping only. This module makes no security decision: raw HTML from
// the file goes out verbatim and a link's URL goes out as written, because the allow-list is the one
// boundary (ADR-0009) and a second, weaker check here would only make it harder to see where the
// boundary is. Its output is never for the DOM — `renderSafeHtml` is (ADR-0007, ADR-0020).

import type { Block, Document, Inline, List, ListItem, Table, TableRow } from '../contracts/ast.ts';
import { escapeAttribute, escapeText } from '../sanitize/escape.ts';

/**
 * Renders the document to HTML that has not been sanitised.
 *
 * The only callers are `renderSafeHtml`, which sanitises what this returns, and the tests that
 * prove the sanitiser's checks can fail — a check that passes against unsanitised output is not
 * checking anything. `render/dependencies.test.ts` keeps that list to those two.
 */
export function renderToUnsanitisedHtml(document: Document): string {
  const footnotes = collectFootnotes(document);
  const parts: string[] = [];
  for (const child of document.children) {
    if (child.type === 'footnoteDefinition') continue;
    parts.push(block(child, false, footnotes));
  }
  parts.push(footnoteList(document, footnotes));
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

function footnoteList(document: Document, footnotes: Map<string, number>): string {
  const definitions = document.children.filter((child) => child.type === 'footnoteDefinition');
  if (definitions.length === 0) return '';
  const items = definitions.map((definition) => {
    const number = footnotes.get(definition.label) ?? 0;
    const body = definition.children.map((child) => block(child, false, footnotes)).join('\n');
    return `<li id="marxy-fn-${number}">${body}<a href="#marxy-fnref-${number}" class="marxy-footnote-back">\u21a9</a></li>`;
  });
  return `<hr />\n<ol class="marxy-footnotes">\n${items.join('\n')}\n</ol>`;
}

function blocks(nodes: readonly Block[], tight: boolean, footnotes: Map<string, number>): string {
  return nodes.map((node) => block(node, tight, footnotes)).join('\n');
}

function block(node: Block, tight: boolean, footnotes: Map<string, number>): string {
  switch (node.type) {
    case 'paragraph':
      // A tight list item's paragraph has no tags of its own, which is what makes the list tight.
      return tight ? inlines(node.children, footnotes) : `<p>${inlines(node.children, footnotes)}</p>`;
    case 'heading':
      return `<h${node.level}>${inlines(node.children, footnotes)}</h${node.level}>`;
    case 'thematicBreak':
      return '<hr />';
    case 'blockquote':
      return `<blockquote>\n${blocks(node.children, false, footnotes)}\n</blockquote>`;
    case 'codeBlock': {
      const language = node.lang === undefined || node.lang === '' ? '' : ` class="language-${escapeAttribute(node.lang)}"`;
      const value = node.value.length > 0 ? `${escapeText(node.value)}\n` : '';
      return `<pre><code${language}>${value}</code></pre>`;
    }
    case 'htmlBlock':
      return node.value;
    case 'list':
      return list(node, footnotes);
    case 'listItem':
      return listItem(node, false, footnotes);
    case 'table':
      return table(node, footnotes);
    case 'tableRow':
      return `<tr>\n${cells(node, undefined)}</tr>`;
    case 'tableCell':
      return `<td>${inlines(node.children, footnotes)}</td>`;
    case 'mathBlock':
      // Set as code until KaTeX loads on first use (MARXY-28); the source is what a reader has now.
      return `<pre class="marxy-math-block"><code>${escapeText(node.value)}\n</code></pre>`;
    case 'footnoteDefinition':
      return blocks(node.children, false, footnotes);
    case 'frontmatter':
      // Metadata, not prose. Showing it is a decision for the story that designs the document head.
      return '';
    default:
      return '';
  }
}

function list(node: List, footnotes: Map<string, number>): string {
  const items = node.children.map((item) => listItem(item, node.tight, footnotes)).join('\n');
  if (!node.ordered) return `<ul>\n${items}\n</ul>`;
  const start = node.start === undefined || node.start === 1 ? '' : ` start="${node.start}"`;
  return `<ol${start}>\n${items}\n</ol>`;
}

function listItem(node: ListItem, tight: boolean, footnotes: Map<string, number>): string {
  return `<li>${blocks(node.children, tight, footnotes)}</li>`;
}

function table(node: Table, footnotes: Map<string, number>): string {
  const [header, ...body] = node.children;
  const parts: string[] = ['<table>'];
  if (header) parts.push(`<thead>\n<tr>\n${cells(header, node, footnotes)}</tr>\n</thead>`);
  if (body.length > 0) {
    parts.push('<tbody>');
    for (const row of body) parts.push(`<tr>\n${cells(row, node, footnotes)}</tr>`);
    parts.push('</tbody>');
  }
  parts.push('</table>');
  return parts.join('\n');
}

function cells(row: TableRow, owner: Table | undefined, footnotes?: Map<string, number>): string {
  const tag = row.header ? 'th' : 'td';
  const labels = footnotes ?? new Map<string, number>();
  return row.children
    .map((cell, column) => {
      const align = owner?.align[column];
      const attribute = align ? ` align="${align}"` : '';
      return `<${tag}${attribute}>${inlines(cell.children, labels)}</${tag}>\n`;
    })
    .join('');
}

function inlines(nodes: readonly Inline[], footnotes: Map<string, number>): string {
  let text = '';
  for (const node of nodes) text += inline(node, footnotes);
  return text;
}

function inline(node: Inline, footnotes: Map<string, number>): string {
  switch (node.type) {
    case 'text':
      return escapeText(node.value);
    case 'emphasis':
      return `<em>${inlines(node.children, footnotes)}</em>`;
    case 'strong':
      return `<strong>${inlines(node.children, footnotes)}</strong>`;
    case 'strikethrough':
      return `<del>${inlines(node.children, footnotes)}</del>`;
    case 'code':
      return `<code>${escapeText(node.value.replace(/\r?\n/g, ' '))}</code>`;
    case 'link': {
      const title = node.title === undefined ? '' : ` title="${escapeAttribute(node.title)}"`;
      return `<a href="${escapeAttribute(node.url)}"${title}>${inlines(node.children, footnotes)}</a>`;
    }
    case 'image': {
      // The URL is written out as it stands; whether it may load is the sanitiser's decision, and by
      // default a remote one loses its `src` and the reader sees the alt text (MARXY-26 names the host).
      const title = node.title === undefined ? '' : ` title="${escapeAttribute(node.title)}"`;
      return `<img src="${escapeAttribute(node.url)}" alt="${escapeAttribute(node.alt)}"${title} />`;
    }
    case 'html':
      return node.value;
    case 'softBreak':
      return '\n';
    case 'hardBreak':
      return '<br />\n';
    case 'footnoteReference': {
      const number = footnotes.get(node.label);
      if (number === undefined) return escapeText(`[^${node.label}]`);
      return `<sup class="marxy-footnote-ref" id="marxy-fnref-${number}"><a href="#marxy-fn-${number}">${number}</a></sup>`;
    }
    case 'mathInline':
      return `<code class="marxy-math">${escapeText(node.value.replace(/\r?\n/g, ' '))}</code>`;
    case 'taskMarker':
      return `<input type="checkbox" disabled${node.checked ? ' checked' : ''} /> `;
    default:
      return '';
  }
}
