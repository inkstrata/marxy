// The pipeline a reader's DOM is allowed to see: parse → render → sanitise. One function,
// so there is no way to reach the render stage's output without passing the allow-list, and no
// platform dependency, so the same call runs in Node, in a gate and in the shell's webview.
// `crypto` is the Web Crypto global, present in both; it is not a Node built-in import.

import type { Block, Document, Inline, ListItem, Source, TableCell, TableRow } from '../contracts/ast.ts';
import { MAX_NESTING_DEPTH, nestedTooDeepText } from '../parse/from-mdast.ts';
import { parseMarkdown, type ParseOptions } from '../parse/parse.ts';
import { DEFAULT_POLICY, PROVENANCE_ATTRIBUTES, REMOTE_IMAGE_ATTR, SPEAKER_ATTR, FM_KEY_ATTR, FM_PART_ATTR, EMPHASIS_ATTR, LANG_ATTR, withProvenance, type Policy, type ProvenanceNames } from '../sanitize/policy.ts';
import { sanitizeHtml, type Removal } from '../sanitize/sanitize-html.ts';
import { blockedImagesFrom, type BlockedImage } from './images.ts';
import { headingIdsForDocument } from './heading-ids.ts';
import { Abandoned } from '../parse/chunked.ts';
import { rawTagsBalanced } from './raw-tags.ts';
import { footnoteNumbers, listedFootnotes, renderToUnsanitisedHtml } from './render-html.ts';

export { footnoteNumbers, listedFootnotes };

/** A removal tagged with the island it came from when the first pass took it out. */
export interface RenderRemoval extends Removal {
  readonly src?: Source;
}

export interface RenderOptions extends ParseOptions {
  /** The allow-list to hold the document to. Defaults to the narrow one. */
  readonly policy?: Policy;
}

/** What a run of a document's blocks, rendered on its own, needs to know of the whole document. */
export interface RunContext {
  /** The ids the whole document gives its headings: a repeated heading is numbered by the headings before it. */
  readonly headingIds?: ReadonlyMap<string, string>;
  /**
   * The whole document's footnote numbers (`footnoteNumbers`). Given, the run's references take them and the run draws
   * no list of notes: the document's list is drawn once, after its last block.
   */
  readonly footnotes?: ReadonlyMap<string, number>;
}

export interface RenderResult {
  /** HTML that has been through the allow-list and is safe to put in the DOM. */
  readonly html: string;
  /** What the allow-list took out, in order, so a notice can name it. */
  readonly removed: readonly RenderRemoval[];
  /**
   * Remote images the allow-list stripped of `src`, with hosts already parsed. The article HTML
   * must not name those hosts (the hostile fixture fails if it does); the app's notice does.
   */
  readonly blockedImages: readonly BlockedImage[];
}

/** Parses a document's bytes and returns sanitised HTML. */
export function renderSafeHtml(source: string | Uint8Array, options: RenderOptions = {}): RenderResult {
  try {
    return renderDocumentSafeHtml(parseMarkdown(source, options), options.policy);
  } catch (error) {
    // The parse refuses a nesting past the cap before it recurses (`MAX_NESTING_DEPTH`), so this is the net under
    // it: only a stack overflow degrades to source; any other RangeError is a bug.
    if (!(error instanceof RangeError) || !/call stack/i.test(error.message)) throw error;
    return unrenderable(source, `nested too deeply to typeset (${error.message}); shown as plain source`);
  }
}

/**
 * What a document nested too deep to typeset becomes: its source, escaped, in a `<pre>` that carries one
 * provenance range over the whole file. A reader still gets the text, and nothing the document wrote reaches
 * the DOM as markup. The one `structure` removal is what the app's notice is made from.
 */
function unrenderable(source: string | Uint8Array, reason: string): RenderResult {
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source;
  const text = typeof source === 'string' ? source : new TextDecoder().decode(source);
  return shownAsSource(text, bytes.length, reason);
}

function shownAsSource(text: string, byteLength: number, reason: string): RenderResult {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const { start, end } = PROVENANCE_ATTRIBUTES;
  return {
    html: `<pre ${start}="0" ${end}="${byteLength}">${escaped}</pre>`,
    removed: [{ what: 'structure', name: 'document', reason }],
    blockedImages: [],
  };
}

/**
 * The same, for a document that has already been parsed once (the parse is the expensive half).
 *
 * Block HTML islands are sanitised first so their removals carry the island's `src`; inline raw HTML
 * is judged in the document pass so a tag split across nodes keeps its shape.
 * The renderer pass then adds byte provenance under secret names; reserved ids and classes stay refused
 * on anything that does not carry those secret names.
 */
export function renderDocumentSafeHtml(document: Document, policy: Policy = DEFAULT_POLICY, run: RunContext = {}): RenderResult {
  const tooDeep = nestedTooDeepText(document);
  if (tooDeep !== undefined) return shownAsSource(tooDeep, document.src.end, `nested more than ${MAX_NESTING_DEPTH} levels deep; shown as plain source`);
  const secret = secretNames();
  // The deferred-remote marker is written under a secret name too, so the island pass's marker
  // survives the document pass while one an author wrote under the public name does not.
  const remoteAttr = `${secret.start.slice(0, -2)}-r`;
  const { document: prepared, removed: islandRemoved } = sanitizeBlockIslands(document, policy, remoteAttr);
  const pass = sanitizeHtml(
    renderToUnsanitisedHtml(prepared, { provenance: secret, ...run }),
    withProvenance(policy, secret, remoteAttr),
    { provenanceNames: secret, remoteAttr },
  );
  const removed: RenderRemoval[] = [...islandRemoved, ...pass.removed];
  return {
    html: publish(pass.html, secret, remoteAttr),
    removed,
    blockedImages: blockedImagesFrom(removed),
  };
}

/** What `renderDocumentSafeHtmlInSlices` makes: the result of `renderDocumentSafeHtml`, and its html in the slices it was made in. */
export interface SlicedRenderResult extends RenderResult {
  /** The top-level blocks' html in runs, in order; `html` is these joined by a newline. */
  readonly pieces: readonly string[];
}

export interface SliceOptions {
  readonly policy?: Policy;
  /** Given back between slices: resolves once the event loop has had its turn. */
  readonly yieldNow: () => Promise<void>;
  /** What one slice may cost, in milliseconds; the next is sized from the last one's cost. Default 3. */
  readonly budgetMs?: number;
  /** Asked after each yield: true abandons the render by throwing `Abandoned` (the pane it was for is gone). */
  readonly aborted?: () => boolean;
}

/**
 * `renderDocumentSafeHtml(document, policy)`, a run of blocks at a time with the event loop given back
 * between runs: the same html byte for byte and the same removals in the same order, or null when
 * the document is one whose render reaches across blocks in a way a run alone cannot give: raw inline HTML that
 * leaves an element open past its block (the sanitiser keeps one stack for the whole document); the caller
 * renders those whole. Heading ids, which a repeated heading numbers by what came before it, and footnote
 * numbers, which the definitions give in their order, are worked out once for the document and handed to every
 * run; the list of notes is drawn once, after the last run, as the whole render draws it after the last block.
 */
export async function renderDocumentSafeHtmlInSlices(document: Document, options: SliceOptions): Promise<SlicedRenderResult | null> {
  const { yieldNow, budgetMs = 3, aborted } = options;
  const policy = options.policy ?? DEFAULT_POLICY;
  const blocks = document.children;
  // A document too deep to typeset is rendered whole, as the source it is shown as.
  if (nestedTooDeepText(document) !== undefined) return null;
  const secret = secretNames();
  const remoteAttr = `${secret.start.slice(0, -2)}-r`;
  const withNames = withProvenance(policy, secret, remoteAttr);
  const holders = blocks.filter((b) => b.type === 'heading' || b.type === 'blockquote' || b.type === 'list' || b.type === 'footnoteDefinition');
  const headingIds = headingIdsForDocument({ ...document, children: holders });
  const footnotes = footnoteNumbers(document);

  const pieces: string[] = [];
  const islandRemoved: RenderRemoval[] = [];
  const passRemoved: RenderRemoval[] = [];
  let at = 0;
  let count = 8;
  while (at < blocks.length) {
    const t0 = performance.now();
    const run = blocks.slice(at, at + count);
    at += run.length;
    if (!run.every(rawTagsBalanced)) return null;
    const { document: prepared, removed: islands } = sanitizeBlockIslands({ ...document, children: run }, policy, remoteAttr);
    const rendered = renderToUnsanitisedHtml(prepared, { provenance: secret, headingIds, footnotes });
    // A run that renders to nothing leaves nothing between its neighbours' newlines, as a whole render's blocks do.
    if (rendered.length > 0) {
      const pass = sanitizeHtml(rendered, withNames, { provenanceNames: secret, remoteAttr });
      // A run the sanitiser ended with an element open took the rest of the document with it in a whole render.
      if (pass.removed.some((r) => r.what === 'truncation')) return null;
      pieces.push(publish(pass.html, secret, remoteAttr));
      passRemoved.push(...pass.removed);
    }
    islandRemoved.push(...islands);
    const spent = performance.now() - t0;
    count = Math.max(4, Math.min(4096, Math.round(count * (budgetMs / Math.max(spent, 0.25)))));
    if (at < blocks.length) {
      await yieldNow();
      if (aborted?.()) throw new Abandoned();
    }
  }
  if (footnotes.size > 0) {
    // Every block was balanced, so the sanitiser's stack is empty here, as it is after a whole render's last block.
    // The definitions' island removals came with their runs, at their place in the bytes; only the list's own are new.
    const { document: prepared } = sanitizeBlockIslands({ ...document, children: listedFootnotes(document) }, policy, remoteAttr);
    const pass = sanitizeHtml(renderToUnsanitisedHtml(prepared, { provenance: secret, headingIds }), withNames, { provenanceNames: secret, remoteAttr });
    if (pass.removed.some((r) => r.what === 'truncation')) return null;
    pieces.push(publish(pass.html, secret, remoteAttr));
    passRemoved.push(...pass.removed);
  }
  const removed: RenderRemoval[] = [...islandRemoved, ...passRemoved];
  return { html: pieces.join('\n'), pieces, removed, blockedImages: blockedImagesFrom(removed) };
}

function sanitizeBlockIslands(document: Document, policy: Policy, remoteAttr: string): { document: Document; removed: RenderRemoval[] } {
  const removed: RenderRemoval[] = [];
  return {
    document: { ...document, children: document.children.map((block) => mapBlock(block, policy, removed, remoteAttr)) },
    removed,
  };
}

function mapBlock(block: Block, policy: Policy, removed: RenderRemoval[], remoteAttr: string): Block {
  if (block.type === 'htmlBlock') {
    const pass = sanitizeHtml(block.value, policy, { remoteAttr });
    for (const entry of pass.removed) removed.push({ ...entry, src: block.src });
    return { ...block, value: pass.html };
  }
  switch (block.type) {
    case 'blockquote':
    case 'footnoteDefinition':
      return { ...block, children: block.children.map((child) => mapBlock(child, policy, removed, remoteAttr)) };
    case 'list':
      return { ...block, children: block.children.map((item) => mapBlock(item, policy, removed, remoteAttr) as ListItem) };
    case 'listItem':
      return { ...block, children: block.children.map((child) => mapBlock(child, policy, removed, remoteAttr)) };
    case 'table':
      return { ...block, children: block.children.map((row) => mapBlock(row, policy, removed, remoteAttr) as TableRow) };
    case 'tableRow':
      return { ...block, children: block.children.map((cell) => mapBlock(cell, policy, removed, remoteAttr) as TableCell) };
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
  return {
    start: `data-marxy-${nonce}-s`,
    end: `data-marxy-${nonce}-e`,
    speaker: `data-marxy-${nonce}-k`,
    fmKey: `data-marxy-${nonce}-f`,
    fmPart: `data-marxy-${nonce}-p`,
    emphasis: `data-marxy-${nonce}-m`,
    lang: `data-marxy-${nonce}-l`,
  };
}

/**
 * Renames the secret attributes to the public ones. The sanitiser writes every attribute as
 * ` name="value"` and escapes every `<` in text, so the only place ` data-marxy-<nonce>-s="` can
 * occur in its output is an attribute the allow-list admitted under that exact name.
 */
function publish(html: string, secret: ProvenanceNames, remoteAttr: string): string {
  return html
    .replaceAll(` ${remoteAttr}="`, ` ${REMOTE_IMAGE_ATTR}="`)
    .replaceAll(` ${secret.start}="`, ` ${PROVENANCE_ATTRIBUTES.start}="`)
    .replaceAll(` ${secret.end}="`, ` ${PROVENANCE_ATTRIBUTES.end}="`)
    .replaceAll(` ${secret.speaker!}="`, ` ${SPEAKER_ATTR}="`)
    .replaceAll(` ${secret.fmKey!}="`, ` ${FM_KEY_ATTR}="`)
    .replaceAll(` ${secret.fmPart!}="`, ` ${FM_PART_ATTR}="`)
    .replaceAll(` ${secret.emphasis!}="`, ` ${EMPHASIS_ATTR}="`)
    .replaceAll(` ${secret.lang!}="`, ` ${LANG_ATTR}="`);
}
