// The library's rows (Q-03): what one result says about its file, as plain data the view only has to draw. Pure and
// DOM-free, so the order, the reasons and the marks are tested without a page. A row is built when it is about to
// be drawn, never for the whole result: the list is windowed, and 20,000 hits are 20,000 cheap objects, not rows.
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import type { IndexEntry } from '@marxy/core';
import { pathUnder, basename } from '@marxy/core/src/index-model/paths.ts';
import type { QueryHit, Reason } from '@marxy/core/src/index-model/query-eval.ts';
import { relativeAge, spokenAge } from '../palette/empty-state.ts';

/** A row shows at most this many reasons, one line each; the last of them says how many more there were. */
export const MAX_WHY = 3;

/** One reason as the line it is drawn as: `title`, `path`, `heading "Cache"`, `line 12: ...`, `kind:report`. */
export function reasonLine(r: Reason): string {
  switch (r.kind) {
    case 'title': return 'title';
    case 'path': return 'path';
    case 'heading': return `heading "${r.text}"`;
    case 'line': return `line ${r.line}: ${r.preview.trim()}`;
    case 'field': return r.detail === undefined ? r.label : `${r.label} (${r.detail})`;
  }
}

/**
 * The reason lines of a hit, in order, without a repeat. Over `max`, the first `max - 1` and a last line that counts
 * the rest ("2 more reasons"): nothing is dropped without a word (commitment 4).
 */
export function whyLines(why: readonly Reason[], max: number = MAX_WHY): string[] {
  const lines: string[] = [];
  for (const r of why) {
    const line = reasonLine(r);
    if (!lines.includes(line)) lines.push(line);
  }
  if (lines.length <= max) return lines;
  const rest = lines.length - (max - 1);
  return [...lines.slice(0, max - 1), `${rest} more reasons`];
}

/** How many reason lines a hit with `n` reasons draws: what the row's height is made of. */
export const whyCount = (hit: QueryHit): number => whyLines(hit.why).length;

export interface RowMark {
  readonly name: 'changed' | 'pinned';
  /** The words for it: the mark is an icon with a name, never colour alone. */
  readonly label: string;
}

export interface LibraryRow {
  readonly path: string;
  readonly title: string;
  /** The path under its folder (the root the index holds it under). */
  readonly rel: string;
  readonly kind: Kind | null;
  readonly kindLabel: string;
  readonly age: string;
  readonly spokenAge: string;
  readonly marks: readonly RowMark[];
  readonly why: readonly string[];
  readonly entry: IndexEntry;
}

export interface RowContext {
  readonly nowMs: number;
  readonly pinned: ReadonlySet<string>;
  changed(entry: IndexEntry): boolean;
}

export function libraryRow(hit: QueryHit, ctx: RowContext): LibraryRow {
  const { entry } = hit;
  const marks: RowMark[] = [];
  if (ctx.changed(entry)) marks.push({ name: 'changed', label: 'Changed since you read' });
  if (ctx.pinned.has(entry.path)) marks.push({ name: 'pinned', label: 'Pinned' });
  const age = relativeAge(ctx.nowMs, entry.mtimeMs);
  return {
    path: entry.path,
    title: entry.title,
    rel: pathUnder(entry.root, entry.path) ?? basename(entry.path),
    kind: entry.readerKind ?? null,
    kindLabel: entry.readerKind ?? entry.kind,
    age,
    spokenAge: spokenAge(age),
    marks,
    why: whyLines(hit.why),
    entry,
  };
}

export type SortKey = 'relevance' | 'modified' | 'name' | 'path' | 'opened';

/** What the sort control offers: relevance only while words are typed, last opened only in a scope that has an order. */
export function sortChoices(typing: boolean, ordered: boolean): readonly SortKey[] {
  return [...(typing ? (['relevance'] as const) : []), ...(ordered ? (['opened'] as const) : []), 'modified', 'name', 'path'];
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const relOf = (e: IndexEntry): string => pathUnder(e.root, e.path) ?? basename(e.path);

/** A sorted copy. `opened` keeps the scope's own order (a stable sort of nothing); ties fall to the path so the order is total. */
export function sortHits(hits: readonly QueryHit[], key: SortKey): QueryHit[] {
  const out = [...hits];
  if (key === 'opened') return out;
  const tie = (a: QueryHit, b: QueryHit): number => (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0);
  const by: Record<Exclude<SortKey, 'opened'>, (a: QueryHit, b: QueryHit) => number> = {
    relevance: (a, b) => b.score - a.score || b.entry.mtimeMs - a.entry.mtimeMs,
    modified: (a, b) => b.entry.mtimeMs - a.entry.mtimeMs,
    name: (a, b) => collator.compare(a.entry.title, b.entry.title),
    path: (a, b) => collator.compare(relOf(a.entry), relOf(b.entry)),
  };
  return out.sort((a, b) => by[key](a, b) || tie(a, b));
}
