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
import { SIDEBAR_SECTION_IDS, type SidebarSectionId } from '@marxy/core/src/layout/workspace-storage.ts';
import { emptyStateSections, type EmptyStateInput } from '../palette/empty-state.ts';

export { SIDEBAR_SECTION_IDS, type SidebarSectionId };

/** The sections in the order they are drawn, with the words on their headers. */
export const SIDEBAR_SECTIONS: readonly { readonly id: SidebarSectionId; readonly title: string }[] = [
  { id: 'recent', title: 'Recent' },
  { id: 'pinned', title: 'Pinned · Changed since you read' },
  // W-08: these two are trees (`sidebar-tree.ts`), drawn after the lists above; `sidebarSections` never fills them.
  { id: 'repos', title: 'Repositories' },
  { id: 'folders', title: 'Folders' },
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
  };
  return SIDEBAR_SECTIONS.flatMap(({ id, title }) => (byId[id].length > 0 ? [{ id, title, rows: byId[id] }] : []));
}
