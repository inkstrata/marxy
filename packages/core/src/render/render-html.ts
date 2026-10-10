// AST → HTML, structure and escaping only. This module makes no security decision: raw HTML from
// the file goes out verbatim and a link's URL goes out as written, because the allow-list is the one
// boundary (ADR-0009) and a second, weaker check here would only make it harder to see where the
// boundary is. Its output is never for the DOM — `renderSafeHtml` is (ADR-0007, ADR-0020).

import type { Block, Blockquote, Document, FootnoteDefinition, Inline, List, ListItem, Source, Table, TableRow, Text } from '../contracts/ast.ts';
import type { ParsedAlert } from './alerts.ts';
import { PROVENANCE_ATTRIBUTES, type ProvenanceNames } from '../sanitize/policy.ts';
import { escapeAttribute, escapeText } from '../sanitize/escape.ts';
import { parseAlert } from './alerts.ts';
import { headingIdsForDocument } from './heading-ids.ts';
import { renderFrontmatterHead } from './frontmatter.ts';
import { linkHostMismatchLabel } from './link-host.ts';
import { smartenParagraphTextNode, type ParagraphTypo } from './typography.ts';

/** One class-safe token: what the sanitiser's `language-*` class pattern allows, with no whitespace. */
const LANGUAGE_TOKEN = /^[a-z0-9#+._-]{1,32}$/;

/** Lowercase A to Z only; `toLowerCase` would fold U+212A KELVIN SIGN to `k`. */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

const DIAGRAM_LANGUAGES = new Set(['mermaid', 'plantuml', 'dot', 'd2']);

/** Paragraph widont metadata plus the paragraph's inline list for trailing-suffix checks. */
type RenderTypo = ParagraphTypo & { readonly paragraphChildren: readonly Inline[] };

const NO_WIDONT: RenderTypo = { lastText: undefined, wordsInParagraph: 0, paragraphChildren: [] };

/** Matches `typography.ts` — only paragraphs at least this long receive widont. */
const WIDONT_MIN_WORDS = 8;

const NBSP = '\u00a0';

const WIDONT_TRAILING = new Set<Inline['type']>(['code', 'mathInline', 'image', 'footnoteReference']);

/** Inline kinds that end a paragraph prose run without a following text node (MARXY-296). */
const WIDONT_TRAILING_BIND = new Set<Inline['type']>(['code', 'mathInline', 'image']);

/** What every function below needs to know about the document as a whole. */
interface Context {
  /** Footnote labels in definition order, so every id and back-reference is a number we chose. */
  readonly footnotes: Map<string, number>;
  readonly names: ProvenanceNames;
  /** Heading element ids in document order (GitHub slugger; docs/design/02-render.md). */
  readonly headingIds: Map<string, string>;
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
  const ctx: Context = {
    footnotes: collectFootnotes(document),
    names: options.provenance ?? PROVENANCE_ATTRIBUTES,
    headingIds: headingIdsForDocument(document),
  };
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
    if (child.type === 'footnoteDefinition' && !labels.has(footnoteKey(child.label))) {
      labels.set(footnoteKey(child.label), labels.size + 1);
    }
  }
  return labels;
}

/** GFM matches a footnote reference to its definition as it matches link labels: case and runs of whitespace do not count. */
function footnoteKey(label: string): string {
  return label.replace(/[\t\n\r ]+/g, ' ').trim().toLowerCase().toUpperCase();
}

function footnoteList(document: Document, ctx: Context): string {
  // The first definition of a label is the one references reach; a duplicate would repeat its id.
  const seen = new Set<string>();
  const definitions = document.children.filter((child): child is FootnoteDefinition => {
    if (child.type !== 'footnoteDefinition' || seen.has(footnoteKey(child.label))) return false;
    seen.add(footnoteKey(child.label));
    return true;
  });
  if (definitions.length === 0) return '';
  const items = definitions.map((definition) => {
    const number = ctx.footnotes.get(footnoteKey(definition.label)) ?? 0;
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
    case 'heading': {
      const id = ctx.headingIds.get(`${node.src.start}-${node.src.end}`);
      const idAttr = id === undefined ? '' : ` id="${escapeAttribute(id)}"`;
      return `<h${node.level}${idAttr}${prov(node.src, ctx)}>${inlines(node.children, ctx)}</h${node.level}>`;
    }
    case 'thematicBreak':
      return `<hr${prov(node.src, ctx)} />`;
    case 'blockquote': {
      const alert = parseAlert(node);
      if (alert) {
        return `<blockquote${prov(node.src, ctx)}>\n${alertBlocks(node, alert, ctx)}\n</blockquote>`;
      }
      return `<blockquote${prov(node.src, ctx)}>\n${blocks(node.children, false, ctx)}\n</blockquote>`;
    }
    case 'codeBlock': {
      // A language is a class only when it is one plain token. Entity decoding can put whitespace
      // in an info string (`&#32;`), and the sanitiser splits `class` on whitespace and trusts a
      // `marxy-*` token, so a fence must not be able to add the renderer's own classes (B-25.1).
      const lang = asciiLower(node.lang ?? '');
      const safeLang = LANGUAGE_TOKEN.test(lang);
      const language = safeLang ? ` class="language-${escapeAttribute(node.lang ?? '')}"` : '';
      const value = node.value.length > 0 ? `${escapeText(node.value)}\n` : '';
      const caption =
        DIAGRAM_LANGUAGES.has(lang)
          ? `<p>${escapeText(lang)} · diagram source</p>\n`
          : '';
      // The `<pre>` carries the lowercased language too, so the theme's diagram-caption rule can
      // look one step past the caption (`p:has(+ pre.language-mermaid)`). A two-step `:has()` into
      // the `<code>` costs WebKit time in proportion to the article on every appended block (B-25.1).
      const preLanguage = !safeLang ? '' : ` class="language-${escapeAttribute(lang)}"`;
      // The `<pre>` is the whole fence; the `<code>` is the content between the fence lines.
      return `${caption}<pre${preLanguage}${prov(node.src, ctx)}><code${language}${prov(node.content, ctx)}>${value}</code></pre>`;
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
      return renderFrontmatterHead(node, ctx);
    default:
      return '';
  }
}

function alertBlocks(node: Blockquote, alert: ParsedAlert, ctx: Context): string {
  const parts: string[] = [];
  const first = node.children[0];
  if (first?.type === 'paragraph') {
    const label = `<strong>${escapeText(alert.label)}</strong>`;
    const body = alert.body.length > 0 ? ` ${inlines(alert.body, ctx, paragraphTypo(alert.body))}` : '';
    parts.push(`<p${prov(first.src, ctx)}>${label}${body}</p>`);
  }
  for (const child of node.children.slice(1)) parts.push(block(child, false, ctx));
  return parts.join('\n');
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

function paragraphTypo(nodes: readonly Inline[]): RenderTypo {
  return {
    lastText: widontTargetTextNode(nodes),
    wordsInParagraph: wordsIn(nodes),
    paragraphChildren: nodes,
  };
}

function isWidontTrailing(node: Inline): boolean {
  return WIDONT_TRAILING.has(node.type);
}

function stripTopLevelWidontTrailing(nodes: readonly Inline[]): readonly Inline[] {
  let end = nodes.length;
  while (end > 0 && isWidontTrailing(nodes[end - 1])) end -= 1;
  return nodes.slice(0, end);
}

function paragraphEndsWithWidontTrailingBind(nodes: readonly Inline[]): boolean {
  let end = nodes.length;
  while (end > 0 && WIDONT_TRAILING_BIND.has(nodes[end - 1].type)) end -= 1;
  return end < nodes.length;
}

/** Last prose text run that may receive paragraph-end smartening (D-A13 widont). */
function widontTargetTextNode(nodes: readonly Inline[]): Text | undefined {
  return lastTextNodeIn(stripTopLevelWidontTrailing(nodes));
}

function lastTextNodeIn(nodes: readonly Inline[]): Text | undefined {
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

/** Keeps the last word of a text run on the same line as a trailing code/math/image/footnote inline. */
function bindLastWordToTrailingInline(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  if (trimmed.length === 0) return text;
  if (trimmed.endsWith(NBSP)) return `${trimmed}${NBSP}`;
  return `${trimmed}${NBSP}`;
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

function plainInlineText(nodes: readonly Inline[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        out += node.value;
        break;
      case 'softBreak':
      case 'hardBreak':
        out += ' ';
        break;
      case 'emphasis':
      case 'strong':
      case 'strikethrough':
      case 'link':
        out += plainInlineText(node.children);
        break;
      default:
        break;
    }
  }
  return out;
}

function inlines(nodes: readonly Inline[], ctx: Context, typo: RenderTypo = NO_WIDONT): string {
  let text = '';
  for (const node of nodes) text += inline(node, nodes, ctx, typo);
  return text;
}

function inline(node: Inline, siblings: readonly Inline[], ctx: Context, typo: RenderTypo): string {
  switch (node.type) {
    case 'text': {
      let value = smartenParagraphTextNode(siblings, node, typo);
      if (
        typo.lastText === node &&
        typo.wordsInParagraph >= WIDONT_MIN_WORDS &&
        paragraphEndsWithWidontTrailingBind(typo.paragraphChildren)
      ) {
        value = bindLastWordToTrailingInline(value);
      }
      return escapeText(value);
    }
    case 'emphasis':
      return `<em${prov(node.src, ctx)}>${inlines(node.children, ctx, typo)}</em>`;
    case 'strong':
      return `<strong${prov(node.src, ctx)}>${inlines(node.children, ctx, typo)}</strong>`;
    case 'strikethrough':
      return `<del${prov(node.src, ctx)}>${inlines(node.children, ctx, typo)}</del>`;
    case 'code':
      return `<code${prov(node.src, ctx)}>${escapeText(node.value.replace(/\r?\n/g, ' '))}</code>`;
    case 'link': {
      // Class sits on the `<a>` (it already has provenance) so the sanitiser keeps it; dest-on-summon
      // is a CSS ::after / app child, never extra unmarked classes (ADR-0023).
      const mismatch = linkHostMismatchLabel(plainInlineText(node.children), node.url);
      const title =
        node.title !== undefined
          ? ` title="${escapeAttribute(node.title)}"`
          : mismatch !== null
            ? ` title="${escapeAttribute(mismatch.text)}"`
            : '';
      const classes = [
        /^https?:|^mailto:/i.test(node.url) ? 'marxy-external' : null,
        mismatch !== null ? 'marxy-link-mismatch' : null,
      ].filter((c): c is string => c !== null);
      const linkClass = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
      return `<a href="${escapeAttribute(node.url)}"${linkClass}${title}${prov(node.src, ctx)}>${inlines(node.children, ctx, typo)}</a>`;
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
      const number = ctx.footnotes.get(footnoteKey(node.label));
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
