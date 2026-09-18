// Test support only: renders the AST to CommonMark's reference HTML so the conformance suite can
// compare it with the reference implementation's output and prove the AST lost nothing (MARXY-11).
//
// marxy has no HTML renderer and never emits an HTML document — it typesets (ADR-0007). Nothing under
// `src/` outside this `testing/` directory may import this file, and `dependencies.test.ts` enforces
// that, which is also why `micromark-util-sanitize-uri` is a devDependency.
//
// The line-break behaviour copies cmark's: block-level output begins on a fresh line, which is why
// everything goes through a writer with a `cr` that is a no-op at the start of a line.

import type { Block, Document, Inline, List, ListItem, Table, TableRow } from '../../contracts/ast.ts';
import { normalizeUri } from 'micromark-util-sanitize-uri';

export function toHtml(document: Document): string {
  const out = writer();
  blocks(document.children, false, out);
  out.cr();
  return out.done();
}

interface Writer {
  write: (text: string) => void;
  /** A newline, unless the output is already at the start of a line. */
  cr: () => void;
  done: () => string;
}

function writer(): Writer {
  const parts: string[] = [];
  let atLineStart = true;
  return {
    write(text) {
      if (text.length === 0) return;
      parts.push(text);
      atLineStart = text.endsWith('\n');
    },
    cr() {
      if (!atLineStart) { parts.push('\n'); atLineStart = true; }
    },
    done: () => parts.join(''),
  };
}

function blocks(nodes: readonly Block[], tight: boolean, out: Writer): void {
  for (const node of nodes) block(node, tight, out);
}

function block(node: Block, tight: boolean, out: Writer): void {
  switch (node.type) {
    case 'paragraph':
      // A tight list item's paragraph has no tags of its own, and does not start a line.
      if (tight) { inlines(node.children, out); return; }
      out.cr();
      out.write(`<p>${inlineString(node.children)}</p>`);
      out.cr();
      return;
    case 'heading':
      out.cr();
      out.write(`<h${node.level}>${inlineString(node.children)}</h${node.level}>`);
      out.cr();
      return;
    case 'thematicBreak':
      out.cr();
      out.write('<hr />');
      out.cr();
      return;
    case 'blockquote':
      out.cr();
      out.write('<blockquote>');
      out.cr();
      blocks(node.children, false, out);
      out.cr();
      out.write('</blockquote>');
      out.cr();
      return;
    case 'codeBlock': {
      const language = node.lang ? ` class="language-${escapeText(node.lang)}"` : '';
      const value = node.value.length > 0 ? `${escapeText(node.value)}\n` : '';
      out.cr();
      out.write(`<pre><code${language}>${value}</code></pre>`);
      out.cr();
      return;
    }
    case 'htmlBlock':
      out.cr();
      out.write(node.value);
      out.cr();
      return;
    case 'list':
      list(node, out);
      return;
    case 'listItem':
      listItem(node, false, out);
      return;
    case 'table':
      table(node, out);
      return;
    case 'mathBlock':
      out.cr();
      out.write(`<pre><code class="language-math math-display">${escapeText(node.value)}\n</code></pre>`);
      out.cr();
      return;
    case 'footnoteDefinition':
      out.cr();
      out.write(`<section class="footnote" id="fn-${escapeText(node.label)}">`);
      out.cr();
      blocks(node.children, false, out);
      out.cr();
      out.write('</section>');
      out.cr();
      return;
    case 'frontmatter':
      return;
    default:
      return;
  }
}

function list(node: List, out: Writer): void {
  out.cr();
  if (node.ordered) {
    const start = node.start === undefined || node.start === 1 ? '' : ` start="${node.start}"`;
    out.write(`<ol${start}>`);
  } else {
    out.write('<ul>');
  }
  out.cr();
  for (const item of node.children) listItem(item, node.tight, out);
  out.cr();
  out.write(node.ordered ? '</ol>' : '</ul>');
  out.cr();
}

function listItem(node: ListItem, tight: boolean, out: Writer): void {
  out.cr();
  out.write('<li>');
  blocks(node.children, tight, out);
  out.write('</li>');
  out.cr();
}

function table(node: Table, out: Writer): void {
  out.cr();
  out.write('<table>');
  out.cr();
  const [header, ...body] = node.children;
  if (header) {
    out.write('<thead>\n<tr>\n');
    out.write(cells(header, node));
    out.write('</tr>\n</thead>\n');
  }
  if (body.length > 0) {
    out.write('<tbody>\n');
    for (const row of body) out.write(`<tr>\n${cells(row, node)}</tr>\n`);
    out.write('</tbody>\n');
  }
  out.write('</table>');
  out.cr();
}

function cells(row: TableRow, table: Table): string {
  const tag = row.header ? 'th' : 'td';
  return row.children
    .map((cell, index) => {
      const align = table.align[index];
      const style = align ? ` align="${align}"` : '';
      return `<${tag}${style}>${inlineString(cell.children)}</${tag}>\n`;
    })
    .join('');
}

function inlines(nodes: readonly Inline[], out: Writer): void {
  out.write(inlineString(nodes));
}

function inlineString(nodes: readonly Inline[]): string {
  let text = '';
  for (const node of nodes) text += inline(node);
  return text;
}

function inline(node: Inline): string {
  switch (node.type) {
    case 'text':
      return escapeText(node.value);
    case 'emphasis':
      return `<em>${inlineString(node.children)}</em>`;
    case 'strong':
      return `<strong>${inlineString(node.children)}</strong>`;
    case 'strikethrough':
      return `<del>${inlineString(node.children)}</del>`;
    case 'code':
      // The spec turns a code span's line endings into spaces; the AST keeps the source's bytes.
      return `<code>${escapeText(node.value.replace(/\r?\n/g, ' '))}</code>`;
    case 'link': {
      const title = node.title === undefined ? '' : ` title="${escapeText(node.title)}"`;
      return `<a href="${escapeText(normalizeHref(node.url))}"${title}>${inlineString(node.children)}</a>`;
    }
    case 'image': {
      const title = node.title === undefined ? '' : ` title="${escapeText(node.title)}"`;
      return `<img src="${escapeText(normalizeHref(node.url))}" alt="${escapeText(node.alt)}"${title} />`;
    }
    case 'html':
      return node.value;
    case 'softBreak':
      return '\n';
    case 'hardBreak':
      return '<br />\n';
    case 'footnoteReference':
      return `<sup class="footnote-ref"><a href="#fn-${escapeText(node.label)}">${escapeText(node.label)}</a></sup>`;
    case 'mathInline':
      return `<code class="language-math math-inline">${escapeText(node.value.replace(/\r?\n/g, ' '))}</code>`;
    case 'taskMarker':
      return `<input type="checkbox" disabled${node.checked ? ' checked' : ''} /> `;
    default:
      return '';
  }
}

/** cmark escapes exactly these four, in text and in attribute values alike. */
function escapeText(value: string): string {
  return value.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

/** cmark's href escaping: percent-encode what is unsafe, keep percent escapes that are already valid. */
function normalizeHref(url: string): string {
  return normalizeUri(url).replace(/%(?![\da-f]{2})/gi, '%25');
}
