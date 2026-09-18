// The one parse: source bytes → one AST with byte provenance (ADR-0003, ADR-0021).
// CommonMark by micromark, GFM/frontmatter/math by extension, offsets converted to bytes once.

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Options as FromMarkdownOptions } from 'mdast-util-from-markdown';
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
    built.mdastExtensions.push(gfmFromMarkdown());
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
