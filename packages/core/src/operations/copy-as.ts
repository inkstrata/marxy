// Copy as (J-04, ADR-0065 item 1): the targets a reader can copy a selection, a block or a document as. This file
// is the one place that names them. Each target takes the same input (the markdown bytes, the plain text and the
// rich text of what is selected, each read only when a target needs it) and gives back the text to put on the
// pasteboard, with HTML beside it for rich text. Pure: no clipboard, no document change.
//
// Five targets go through the transform library (J-03): JSON string, Quote with source, Slack, Jira wiki. A target
// whose transform is not built (`NOT_YET`) is not offered, so the list is whatever the registry can run and
// J-03.1 adds its rows with no change here.
import type { Heading } from '../contracts/ast.ts';
import type { Operation, OperationInput } from '../contracts/operation.ts';
import { createBuffer, textOf } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { runTransform, transformById } from '../transforms/registry.ts';
import { copyPlain } from './copy-plain.ts';
import { copyRich } from './copy-rich.ts';
import { copySource } from './copy-source.ts';
import { inlinePlainText } from './inline-text.ts';

const BOM = '﻿';

/** What a target is built from. The three readers are lazy: Slack never renders HTML. */
export interface CopyAsInput {
  /** The exact markdown of the selection (a leading byte-order mark is never in the copy). */
  markdown(): string;
  /** The words, without markup. */
  plain(): string;
  /** Sanitised HTML with its plain text beside it. */
  rich(): { readonly text: string; readonly html: string };
  /** The document's title: its first heading, else its file name. */
  readonly title: string;
  /** The document's path, or undefined for a scratch document (nothing to link to). */
  readonly path?: string;
}

export interface CopyAsResult {
  readonly text: string;
  /** Present only for rich text. */
  readonly html?: string;
}

export interface CopyTarget {
  /** The value `copy_format` takes. */
  readonly id: string;
  readonly name: string;
  build(input: CopyAsInput): CopyAsResult;
}

/** The part of the transform registry a target needs; a test stands in for it. */
export interface CopyAsRegistry {
  has(id: string): boolean;
  run(id: string, text: string): string;
}

const REGISTRY: CopyAsRegistry = {
  has: (id) => transformById(id) !== undefined,
  run: (id, text) => runTransform(id, text),
};

const stripBom = (s: string): string => (s.startsWith(BOM) ? s.slice(1) : s);
const eolOf = (s: string): string => /\r\n|\n|\r/.exec(s)?.[0] ?? '\n';

/** A link destination that survives markdown: spaces and parentheses escaped. */
const destination = (path: string): string => path.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
const label = (title: string): string => title.replace(/[[\]\\]/g, '\\$&').replace(/\s+/g, ' ');

/** Every target in menu order, each with the transform it needs (null: none). */
const DEFINITIONS: readonly { readonly id: string; readonly name: string; readonly transform: string | null; readonly build: (input: CopyAsInput, reg: CopyAsRegistry) => CopyAsResult }[] = [
  { id: 'markdown', name: 'Markdown', transform: null, build: (i) => ({ text: stripBom(i.markdown()) }) },
  { id: 'plain', name: 'Plain text', transform: null, build: (i) => ({ text: i.plain() }) },
  { id: 'rich', name: 'Rich text', transform: null, build: (i) => i.rich() },
  { id: 'html', name: 'HTML source', transform: null, build: (i) => ({ text: i.rich().html }) },
  { id: 'slack', name: 'Slack', transform: 'to-slack', build: (i, r) => ({ text: r.run('to-slack', stripBom(i.markdown())) }) },
  { id: 'jira', name: 'Jira wiki', transform: 'to-jira', build: (i, r) => ({ text: r.run('to-jira', stripBom(i.markdown())) }) },
  { id: 'json-string', name: 'JSON string', transform: 'json-string', build: (i, r) => ({ text: r.run('json-string', stripBom(i.markdown())) }) },
  {
    id: 'quote',
    name: 'Quote with source',
    transform: 'quote',
    build(i, r) {
      const md = stripBom(i.markdown());
      const eol = eolOf(md);
      const quoted = r.run('quote', md).replace(/\s+$/, '');
      const source = i.path === undefined ? `— ${label(i.title)}` : `— [${label(i.title)}](${destination(i.path)})`;
      return { text: `${quoted}${eol}${eol}${source}${eol}` };
    },
  },
];

/** The targets `registry` can run, in menu order. A target whose transform is missing is left out. */
export function copyTargets(registry: CopyAsRegistry = REGISTRY): readonly CopyTarget[] {
  return DEFINITIONS.filter((d) => d.transform === null || registry.has(d.transform)).map((d) => ({
    id: d.id,
    name: d.name,
    build: (input) => d.build(input, registry),
  }));
}

/** The targets the transform library can run today. */
export const COPY_TARGETS: readonly CopyTarget[] = copyTargets();

/** A document's title for a source line: its first heading's words, else the file's name. */
export function titleFor(input: Pick<OperationInput, 'document'>, path: string | undefined): string {
  const heading = input.document.children.find((n): n is Heading => n.type === 'heading');
  const words = heading === undefined ? '' : inlinePlainText(heading.children).replace(/\s+/g, ' ').trim();
  if (words !== '') return words;
  const name = path === undefined ? '' : path.slice(path.lastIndexOf('/') + 1);
  return name !== '' ? name : 'Untitled';
}

/** Inputs for the operations' own copies: markdown, plain text and rich text of one resolved operation input. */
export function copyAsFromOperation(input: OperationInput, ref: { readonly path?: string } = {}): CopyAsInput {
  const run = (op: Operation): NonNullable<ReturnType<Operation['run']>['clipboard']> => op.run(input).clipboard!;
  return {
    markdown: () => run(copySource).text,
    plain: () => run(copyPlain).text,
    rich: () => {
      const { text, html } = run(copyRich);
      return { text, html: html ?? '' };
    },
    title: titleFor(input, ref.path),
    ...(ref.path === undefined ? {} : { path: ref.path }),
  };
}

/**
 * Inputs for markdown text that has no block of its own in a parsed document, a Source selection: the text is
 * parsed as a document of its own for plain and rich text; the markdown is the text, byte for byte.
 */
export function copyAsFromText(text: string, ref: { readonly path?: string; readonly title?: string } = {}): CopyAsInput {
  let whole: OperationInput | null = null;
  const parsed = (): OperationInput => {
    if (whole === null) {
      const bytes = new TextEncoder().encode(text);
      const document = parseMarkdown(bytes, { file: ref.path ?? 'copy.md' });
      whole = { document, range: document.src, text: textOf(createBuffer('copy.md', bytes), document.src) };
    }
    return whole;
  };
  const from = copyAsFromOperation.bind(null);
  return {
    markdown: () => text,
    plain: () => from(parsed()).plain(),
    rich: () => from(parsed()).rich(),
    title: ref.title ?? titleFor({ document: parsed().document }, ref.path),
    ...(ref.path === undefined ? {} : { path: ref.path }),
  };
}
