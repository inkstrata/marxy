// The transform library's registry (J-03, ADR-0065 item 4): one list of `{ id, name, group, fn }` that the
// palette, the toolbar and the verb menu read, so they agree. `ids.json` is the catalogue (the mockup's 50 ids,
// `docs/plan/direction-2026-10/mock-v2/06-clipboard.md`); every id is either implemented here or listed in
// `NOT_YET` with its reason, and a test holds that line.
//
// Each `fn` is pure `string -> string`. It keeps the file's line endings and byte-order mark (see `wrap`):
// that is the fidelity property, and `registry.test.ts` applies it to every entry.
import catalogue from './ids.json' with { type: 'json' };
import { CASE } from './case.ts';
import { CLEAN } from './clean.ts';
import { CONVERT } from './convert.ts';
import { EXTRACT } from './extract.ts';
import { LINES } from './lines.ts';
import type { TransformContext, TransformDef, TransformKind } from './types.ts';

export type { TransformContext, TransformKind } from './types.ts';

export type TransformGroup = 'Clean' | 'Convert' | 'Lines' | 'Case' | 'Extract';

export interface CatalogueEntry {
  readonly id: string;
  readonly name: string;
  readonly group: TransformGroup;
}

export interface Transform extends CatalogueEntry {
  readonly kind: TransformKind;
  readonly outsideCode: boolean;
  readonly idempotent: boolean;
  readonly fn: (text: string, ctx?: TransformContext) => string;
}

/** The catalogue: every id the mockup's transform table names, in its order. */
export const CATALOGUE: readonly CatalogueEntry[] = catalogue as readonly CatalogueEntry[];

/** Catalogue ids not built yet, each with why. The follow-up story (J-03.1) empties this. */
export const NOT_YET: Readonly<Record<string, string>> = {
  'wrap-80': 'hard-wrapping needs list-indent and table rules of its own and a reflow property; left to J-03.1',
  'to-slack': 'a Markdown converter (mrkdwn) that needs the AST walk, not regexes; left to J-03.1',
  'to-jira': 'a Markdown converter (Jira wiki) with nested lists, panels and tables; left to J-03.1',
  'to-html': "needs Marxy's renderer (core's HTML writer), which has its own sanitiser rules (ADR-0021); left to J-03.1",
  'tsv-to-table': 'reads delimited text, not Markdown; wants the numeric-column alignment from align-table-pipes; left to J-03.1',
};

const eolOf = (s: string): string => /\r\n|\n|\r/.exec(s)?.[0] ?? '\n';
const BOM = '﻿';

/**
 * The fidelity wrapper. An `edit` or `derive` body sees LF text; the result is written back with the line ending the
 * input used (its first, when it mixes them; never a kind the input lacks), and a body that returns its input
 * unchanged returns the original bytes, mixed endings and all. An `edit` keeps a leading BOM; a `derive` output has none.
 */
function wrap(def: TransformDef): Transform['fn'] {
  return (text, ctx = {}) => {
    if (def.kind === 'literal') return def.run(text, ctx);
    const bom = text.startsWith(BOM);
    const body = bom ? text.slice(1) : text;
    const eol = eolOf(body);
    const lf = body.replace(/\r\n|\r/g, '\n');
    const out = def.run(lf, ctx);
    if (out === lf) return text;
    const restored = eol === '\n' ? out : out.replace(/\n/g, eol);
    return bom && def.kind === 'edit' ? BOM + restored : restored;
  };
}

const DEFINITIONS: readonly TransformDef[] = [...CLEAN, ...CONVERT, ...LINES, ...CASE, ...EXTRACT];

const byId = new Map(DEFINITIONS.map((d) => [d.id, d]));

/** Every implemented transform, in catalogue order. */
export const TRANSFORMS: readonly Transform[] = CATALOGUE.flatMap((entry) => {
  const def = byId.get(entry.id);
  return def
    ? [{ ...entry, kind: def.kind, outsideCode: def.outsideCode === true, idempotent: def.idempotent === true, fn: wrap(def) }]
    : [];
});

export function transformById(id: string): Transform | undefined {
  return TRANSFORMS.find((t) => t.id === id);
}

/** Run one transform by id. An unknown or not-yet id returns the text unchanged (a pipeline step that cannot run keeps its input). */
export function runTransform(id: string, text: string, ctx?: TransformContext): string {
  return transformById(id)?.fn(text, ctx) ?? text;
}

/** Definitions the registry was built from, for the tests that hold the registry to the catalogue. */
export const DEFINITION_IDS: readonly string[] = DEFINITIONS.map((d) => d.id);
