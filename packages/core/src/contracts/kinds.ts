/**
 * The kinds of v1. Reviewed contract: changes need review, and a new kind
 * is a change of meaning. A kind is how a text is read, never who wrote it.
 * The order is the record's table; `kinds.test.ts` holds the two equal.
 */
export const KINDS = [
  'article',
  'report',
  'book',
  'readme',
  'docs',
  'code',
  'transcript',
  'data',
  'notes',
  'changelog',
  'log',
  'terminal',
  'diff',
  'html',
] as const;

export type Kind = (typeof KINDS)[number];

/** What a text-family file is read as when no signal names another kind (tier 7). */
export const DEFAULT_KIND: Kind = 'article';
