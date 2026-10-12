// The sidebar's sections (W-07; ADR-0058): what the `sidebar` region lists, as plain data. Pure and shell-free, so
// the order and the cap are a table in a node test; `sidebar-view.ts` draws it.
//
// It adds no rule of its own. The rows are the palette's empty state (C-12: `emptyStateSections`, the same files in
// the same order, "changed since you read" decided by `changedSinceRead`), asked without the palette's twelve-row
// cap and with its three lists left unmerged: Recent, and Pinned with the changed files after it. Recent is cut to
// eight here; a document is in one list only (a pinned file is not repeated in Recent).
//
// What the sidebar cannot list: a document whose entry the palette's feed does not hold. The feed is the index in
// scope order and is capped (`SCOPE_ENTRY_CAP`), so a pinned or recent file outside the scope has no row until the
// scope reaches it, exactly as in the palette. Nothing here reads the disk to find it.
import type { IndexEntry } from '@marxy/core';
import type { SavedQuery } from '@marxy/core/src/index-model/collection.ts';
import { capQuery, evaluateQuery, parseQuery, textTerms, usesContentKeys, type QueryContext } from '@marxy/core/src/index-model/index.ts';
import { SIDEBAR_SECTION_IDS, type SidebarSectionId } from '@marxy/core/src/layout/workspace-storage.ts';
import { CONTENT_MIN_CHARS } from '../palette/content.ts';
import { emptyStateSections, type EmptyStateInput } from '../palette/empty-state.ts';
import { changedPredicate, scopeEntries, type ScopeInput } from '../library/scopes.ts';

export { SIDEBAR_SECTION_IDS, type SidebarSectionId };

/** The sections in the order they are drawn, with the words on their headers. */
export const SIDEBAR_SECTIONS: readonly { readonly id: SidebarSectionId; readonly title: string }[] = [
  { id: 'recent', title: 'Recent' },
  { id: 'pinned', title: 'Pinned · Changed since you read' },
  // W-08: these two are trees (`sidebar-tree.ts`), drawn after the lists above; `sidebarSections` never fills them.
  { id: 'repos', title: 'Repositories' },
  { id: 'folders', title: 'Folders' },
  // Q-07: the `[[query]]` tables of collection.toml, drawn after the trees (`smartRows`); `sidebarSections` never fills it.
  { id: 'smart', title: 'Smart collections' },
];

/** Documents in Recent. */
export const SIDEBAR_RECENT_LIMIT = 8;

/** Why a row is in its section: it is pinned, it changed since the reader read it, or it was opened lately. */
export type SidebarMark = 'pinned' | 'changed' | 'recent';

export interface SidebarRow {
  readonly entry: IndexEntry;
  readonly mark: SidebarMark;
}

export interface SidebarSection {
  readonly id: SidebarSectionId;
  readonly title: string;
  readonly rows: readonly SidebarRow[];
}

export type SidebarInput = Omit<EmptyStateInput, 'limit' | 'changedCap'>;

/** The sections to draw, in order; a section with no rows is not in the list. */
export function sidebarSections(input: SidebarInput): readonly SidebarSection[] {
  // No cap but the palette's own five in Changed: the limit only stops Recent being squeezed by the others.
  const lists = emptyStateSections({ ...input, limit: Number.MAX_SAFE_INTEGER });
  const rowsOf = (kinds: readonly SidebarMark[]): SidebarRow[] =>
    lists.flatMap((section) => (kinds.includes(section.kind) ? section.hits.map((hit) => ({ entry: hit.entry, mark: section.kind })) : []));
  const byId: Record<SidebarSectionId, SidebarRow[]> = {
    recent: rowsOf(['recent']).slice(0, SIDEBAR_RECENT_LIMIT),
    pinned: [...rowsOf(['pinned']), ...rowsOf(['changed'])],
    repos: [],
    folders: [],
    smart: [],
  };
  return SIDEBAR_SECTIONS.flatMap(({ id, title }) => (byId[id].length > 0 ? [{ id, title, rows: byId[id] }] : []));
}

/** What a saved query is asked against: the library's own context, so the sidebar and the library cannot disagree (Q-07). */
export function queryContext(input: ScopeInput): QueryContext {
  const { session } = input;
  return {
    nowMs: input.nowMs,
    pinned: new Set(session.pinned),
    recent: new Set(session.mru),
    changed: changedPredicate(input),
    readAt: (e) => session.readAt[e.path],
  };
}

/**
 * How many files a saved query matches among all the files, or null when the index cannot say. The count is the library's
 * first answer to the same query over *All files* (index keys, before any file is read). A query that searches the lines
 * of files (a word of two letters or more) or asks about contents (`words:`, `has:`, `tasks:`) is answered by reading
 * files, which a row of the sidebar never does, so it has no count here and the library gives it.
 */
export function indexOnlyCount(q: string, input: ScopeInput): number | null {
  const { query } = capQuery(parseQuery(q));
  if (usesContentKeys(query) || textTerms(query).some((t) => t.text.length >= CONTENT_MIN_CHARS)) return null;
  return evaluateQuery(query, scopeEntries('all', input), queryContext(input)).filter((hit) => !hit.unmeasured).length;
}

export interface SmartRow {
  readonly name: string;
  readonly q: string;
  /** Files matched now, or null when only reading files could say (see `indexOnlyCount`). */
  readonly count: number | null;
}

/** The Smart collections section's rows, in file order. Nothing is evaluated when `counted` is false (the section is folded). */
export function smartRows(queries: readonly SavedQuery[], input: ScopeInput | null, counted: boolean): readonly SmartRow[] {
  return queries.map((x) => ({ name: x.name, q: x.q, count: counted && input !== null ? indexOnlyCount(x.q, input) : null }));
}
