// The one parse: source bytes → one AST with byte provenance (ADR-0003, ADR-0021).
// CommonMark by micromark, GFM/frontmatter/math by extension, offsets converted to bytes once.

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Extension as MdastExtension, Options as FromMarkdownOptions } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import type { Document } from '../contracts/ast.ts';
import { byteOffsets } from './byte-offsets.ts';
import { documentFromMdast } from './from-mdast.ts';

export interface ParseOptions {
  /** Absolute path, or a stable identifier for an untitled buffer. Defaults to `untitled`. */
  readonly file?: string;
  /** GFM: tables, strikethrough, task items, autolinks, footnotes. On by default. */
  readonly gfm?: boolean;
  /** YAML/TOML frontmatter. On by default. */
  readonly frontmatter?: boolean;
  /** `$…$` and `$$…$$` math. On by default. */
  readonly math?: boolean;
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** Parse a document's bytes. Accepts a string for callers that already hold the buffer decoded. */
export function parseMarkdown(source: string | Uint8Array, options: ParseOptions = {}): Document {
  const file = options.file ?? 'untitled';
  const text = typeof source === 'string' ? source : decoder.decode(source);

  // A byte-order mark is bytes of the file but not markdown: leaving it in would make the first line
  // start with U+FEFF and stop being a heading. It is skipped for parsing and paid for in `base`.
  const hasBom = text.charCodeAt(0) === 0xfeff;
  const body = hasBom ? text.slice(1) : text;
  const offsets = byteOffsets(body, hasBom ? 3 : 0);

  const { extensions, mdastExtensions } = syntax(options);
  const tree = fromMarkdown(body, { extensions, mdastExtensions });
  return documentFromMdast(tree, { file, text: body, offsets });
}

interface Syntax {
  extensions: NonNullable<FromMarkdownOptions['extensions']>;
  mdastExtensions: NonNullable<FromMarkdownOptions['mdastExtensions']>;
}

// Building the extension objects is a measurable share of a small parse, and they are stateless, so
// each combination is built once. Cold start is a budget (ADR-0013).
const syntaxCache = new Map<string, Syntax>();

function syntax(options: ParseOptions): Syntax {
  const key = `${options.gfm !== false}:${options.frontmatter !== false}:${options.math !== false}`;
  const cached = syntaxCache.get(key);
  if (cached) return cached;
  const built: Syntax = { extensions: [], mdastExtensions: [] };
  if (options.gfm !== false) {
    built.extensions.push(gfm());
    built.mdastExtensions.push(withoutTransforms(gfmFromMarkdown()));
  }
  if (options.frontmatter !== false) {
    built.extensions.push(frontmatter(['yaml', 'toml']));
    built.mdastExtensions.push(frontmatterFromMarkdown(['yaml', 'toml']));
  }
  if (options.math !== false) {
    built.extensions.push(math());
    built.mdastExtensions.push(mathFromMarkdown());
  }
  syntaxCache.set(key, built);
  return built;
}

/**
 * Drops the tree transforms from a set of mdast extensions, keeping their token handlers.
 *
 * GFM's autolink-literal extension carries one: a `findAndReplace` pass that rewrites a paragraph's
 * inline children to linkify candidates micromark's own scanner could not match, which is those
 * containing a backslash escape or a character reference — `x <a\.b@c.example> y`. That pass rebuilds
 * the children *without* position data, so every inline node in the paragraph loses its provenance,
 * and a parser that filled the gap with a default would point them at the top of the file. ADR-0003
 * makes provenance structural, so the pass has to go rather than be compensated for.
 *
 * What this costs is narrow and visible: an autolink candidate written with an escape inside it stays
 * literal text. Every candidate micromark can scan — `https://x.com`, `www.x.com`, `a@b.com` — still
 * becomes a link, because the token handlers that build those are untouched and they position every
 * node they emit. What it buys is that no node reaches `from-mdast.ts` without offsets.
 */
function withoutTransforms(extensions: MdastExtension[]): MdastExtension[] {
  return extensions.map((extension) => {
    if (extension.transforms === undefined) return extension;
    const { transforms: _dropped, ...rest } = extension;
    return rest;
  });
}
