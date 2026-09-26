// The pipeline a reader's DOM is allowed to see: parse → render → sanitise (ADR-0009). One function,
// so there is no way to reach the render stage's output without passing the allow-list, and no
// platform dependency, so the same call runs in Node, in a gate and in the shell's webview (ADR-0020).
// `crypto` is the Web Crypto global, present in both; it is not a Node built-in import.

import type { Block, Document, Inline, ListItem, Source, TableCell, TableRow } from '../contracts/ast.ts';
import { parseMarkdown, type ParseOptions } from '../parse/parse.ts';
import { DEFAULT_POLICY, PROVENANCE_ATTRIBUTES, withProvenance, type Policy, type ProvenanceNames } from '../sanitize/policy.ts';
import { sanitizeHtml, type Removal } from '../sanitize/sanitize-html.ts';
import { blockedImagesFrom, type BlockedImage } from './images.ts';
import { renderToUnsanitisedHtml } from './render-html.ts';

/** A removal tagged with the island it came from when the first pass took it out (§12). */
export interface RenderRemoval extends Removal {
  readonly src?: Source;
}

export interface RenderOptions extends ParseOptions {
  /** The allow-list to hold the document to. Defaults to the narrow one; widening it is MARXY-44. */
  readonly policy?: Policy;
}

export interface RenderResult {
  /** HTML that has been through the allow-list and is safe to put in the DOM. */
  readonly html: string;
  /** What the allow-list took out, in order, so a notice can name it (MARXY-26, MARXY-44). */
  readonly removed: readonly RenderRemoval[];
  /**
   * Remote images the allow-list stripped of `src`, with hosts already parsed. The article HTML
   * must not name those hosts (the hostile fixture fails if it does); the app's notice does.
   */
  readonly blockedImages: readonly BlockedImage[];
}

/** Parses a document's bytes and returns sanitised HTML. */
export function renderSafeHtml(source: string | Uint8Array, options: RenderOptions = {}): RenderResult {
  return renderDocumentSafeHtml(parseMarkdown(source, options), options.policy);
}

/**
 * The same, for a document that has already been parsed once (the parse is the expensive half).
 *
 * Block HTML islands are sanitised first so their removals carry the island's `src`; inline raw HTML
 * is judged in the document pass so a tag split across nodes keeps its shape (ADR-0023 Amendment 1).
 * The renderer pass then adds byte provenance under secret names; reserved ids and classes stay refused
 * on anything that does not carry those secret names (ADR-0023, ADR-0036).
 */
export function renderDocumentSafeHtml(document: Document, policy: Policy = DEFAULT_POLICY): RenderResult {
  const secret = secretNames();
  const { document: prepared, removed: islandRemoved } = sanitizeBlockIslands(document, policy);
  const pass = sanitizeHtml(
    renderToUnsanitisedHtml(prepared, { provenance: secret }),
    withProvenance(policy, secret),
    { provenanceNames: secret },
  );
  const removed: RenderRemoval[] = [...islandRemoved, ...pass.removed];
  return {
    html: publish(pass.html, secret),
    removed,
    blockedImages: blockedImagesFrom(removed),
  };
}

function sanitizeBlockIslands(document: Document, policy: Policy): { document: Document; removed: RenderRemoval[] } {
  const removed: RenderRemoval[] = [];
  return {
    document: { ...document, children: document.children.map((block) => mapBlock(block, policy, removed)) },
    removed,
  };
}

function mapBlock(block: Block, policy: Policy, removed: RenderRemoval[]): Block {
  if (block.type === 'htmlBlock') {
    const pass = sanitizeHtml(block.value, policy);
    for (const entry of pass.removed) removed.push({ ...entry, src: block.src });
    return { ...block, value: pass.html };
  }
  switch (block.type) {
    case 'blockquote':
    case 'footnoteDefinition':
      return { ...block, children: block.children.map((child) => mapBlock(child, policy, removed)) };
    case 'list':
      return { ...block, children: block.children.map((item) => mapBlock(item, policy, removed) as ListItem) };
    case 'listItem':
      return { ...block, children: block.children.map((child) => mapBlock(child, policy, removed)) };
    case 'table':
      return { ...block, children: block.children.map((row) => mapBlock(row, policy, removed) as TableRow) };
    case 'tableRow':
      return { ...block, children: block.children.map((cell) => mapBlock(cell, policy, removed) as TableCell) };
    case 'heading':
    case 'paragraph':
    case 'tableCell':
      return { ...block, children: block.children.map((inline) => mapInline(inline, policy, removed)) };
    default:
      return block;
  }
}

function mapInline(inline: Inline, policy: Policy, removed: RenderRemoval[]): Inline {
  switch (inline.type) {
    case 'emphasis':
    case 'strong':
    case 'strikethrough':
    case 'link':
      return { ...inline, children: inline.children.map((child) => mapInline(child, policy, removed)) };
    default:
      return inline;
  }
}

/** Attribute names nobody outside this call can predict: 128 bits from the platform's CSPRNG. */
function secretNames(): ProvenanceNames {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { start: `data-marxy-${nonce}-s`, end: `data-marxy-${nonce}-e` };
}

/**
 * Renames the secret attributes to the public ones. The sanitiser writes every attribute as
 * ` name="value"` and escapes every `<` in text, so the only place ` data-marxy-<nonce>-s="` can
 * occur in its output is an attribute the allow-list admitted under that exact name.
 */
function publish(html: string, secret: ProvenanceNames): string {
  return html
    .replaceAll(` ${secret.start}="`, ` ${PROVENANCE_ATTRIBUTES.start}="`)
    .replaceAll(` ${secret.end}="`, ` ${PROVENANCE_ATTRIBUTES.end}="`);
}
