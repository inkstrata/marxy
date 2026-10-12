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
import { capQuery, evaluateQuery, parseQuery, textTerms, usesContentKeys, type Query, type QueryContext } from '@marxy/core/src/index-model/index.ts';
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
  /** Files matched now, or null when only reading files could say, or the count has not landed yet (see `SmartCounts`). */
  readonly count: number | null;
}

/** The Smart collections section's rows, in file order, each with the count `countOf` has for its query. */
export function smartRows(queries: readonly SavedQuery[], countOf: (q: string) => number | null | undefined): readonly SmartRow[] {
  return queries.map((x) => ({ name: x.name, q: x.q, count: countOf(x.q) ?? null }));
}

/** Entries evaluated in one go: a few milliseconds of work, so a slice ends well inside a frame. */
const COUNT_CHUNK = 1500;
/** The longest a slice of counting holds the thread before it yields. */
const COUNT_SLICE_MS = 5;
/** A request after a quiet moment starts counting this late, so a walk's patches do not restart it each time; never later than `COUNT_MAX_WAIT_MS` from the first. */
const COUNT_DEBOUNCE_MS = 150;
const COUNT_MAX_WAIT_MS = 1000;

const yieldToUi = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });

/**
 * The counts of the saved queries, kept off the path of a feed patch (Q-07 review). `request` is cheap: it compares what the
 * counts were made from (the feed's entries, the session, the clock to the minute, the watched folders) with what is asked now
 * and, when they differ, schedules one run after a quiet moment. The run counts one query at a time over the entries in chunks,
 * yielding between slices of about five milliseconds, so a patch never waits on a count. Until a query's new count lands the old
 * one is shown. A newer request replaces a run under way. A count is the library's first answer to the same query over *All
 * files* (`indexOnlyCount`); a query that needs files read has none.
 */
export class SmartCounts {
  private readonly counts = new Map<string, number | null>();
  private readonly plans = new Map<string, Query | null>();
  private doneFor: { entries: readonly IndexEntry[]; key: string; queries: string } | null = null;
  private wanted: { entries: readonly IndexEntry[]; key: string; queries: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstAskedAt = 0;
  private generation = 0;
  private running: Promise<void> = Promise.resolve();
  /** Counts begun, for tests: a request that changes nothing begins none. */
  runs = 0;

  private readonly onChange: () => void;
  /** A stored count has changed since `onChange` last fired. */
  private dirty = false;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  /** The count for `q`: a number, null when only reading files could say, undefined while it has not been made. */
  get(q: string): number | null | undefined {
    return this.counts.get(q);
  }

  /** Resolves when no run is under way or waiting (tests). */
  async settled(): Promise<void> {
    for (;;) {
      const run = this.running;
      await run;
      // A run that was replaced while awaited is not the last: wait for the one that replaced it.
      if (run === this.running && this.timer === null && this.wanted === null) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Asks for counts of `queries` against `input`. `key` names what else the answer depends on. Null input (the section is folded)
   * drops what is waiting and keeps the counts as they are.
   */
  request(queries: readonly string[], input: ScopeInput | null, key: string): void {
    if (input === null || queries.length === 0) {
      this.cancel();
      return;
    }
    const now = Math.floor(input.nowMs / 60_000);
    const { session } = input;
    const readSum = Object.values(session.readAt).reduce((a, b) => a + b, 0);
    const made = {
      entries: input.entries,
      key: `${key}|${now}|${session.pinned.join('\0')}|${session.mru.join('\0')}|${Object.keys(session.readAt).length}|${readSum}`,
      queries: queries.join('\0'),
    };
    const same = (a: typeof made | null) => a !== null && a.entries === made.entries && a.key === made.key && a.queries === made.queries;
    if (same(this.doneFor) || same(this.wanted) || same(this.inFlight)) return;
    // What is held is the one asked for last; the run that starts takes it.
    this.wanted = made;
    this.heldInput = input;
    this.heldQueries = queries;
    const first = this.doneFor === null;
    const at = Date.now();
    if (this.timer === null) this.firstAskedAt = at;
    else if (at - this.firstAskedAt < COUNT_MAX_WAIT_MS) clearTimeout(this.timer);
    else return;
    this.timer = setTimeout(() => this.start(), first ? 0 : COUNT_DEBOUNCE_MS);
  }

  private heldInput: ScopeInput | null = null;
  private heldQueries: readonly string[] = [];
  private inFlight: { entries: readonly IndexEntry[]; key: string; queries: string } | null = null;

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.wanted = null;
    this.inFlight = null;
    this.generation++;
  }

  private planOf(q: string): Query | null {
    if (!this.plans.has(q)) {
      const { query } = capQuery(parseQuery(q));
      const needsFiles = usesContentKeys(query) || textTerms(query).some((t) => t.text.length >= CONTENT_MIN_CHARS);
      this.plans.set(q, needsFiles ? null : query);
    }
    return this.plans.get(q)!;
  }

  private start(): void {
    this.timer = null;
    const made = this.wanted;
    const input = this.heldInput;
    const queries = this.heldQueries;
    if (made === null || input === null) return;
    this.wanted = null;
    this.inFlight = made;
    const mine = ++this.generation;
    this.runs++;
    this.running = this.count(mine, made, input, queries);
  }

  private async count(mine: number, made: NonNullable<SmartCounts['doneFor']>, input: ScopeInput, queries: readonly string[]): Promise<void> {
    const ctx = queryContext(input);
    const entries = scopeEntries('all', input);
    let sliceFrom = performance.now();
    for (const q of new Set(queries)) {
      const plan = this.planOf(q);
      let total: number | null = null;
      if (plan !== null) {
        total = 0;
        for (let at = 0; at < entries.length; at += COUNT_CHUNK) {
          total += evaluateQuery(plan, entries.slice(at, at + COUNT_CHUNK), ctx).filter((hit) => !hit.unmeasured).length;
          if (performance.now() - sliceFrom >= COUNT_SLICE_MS) {
            await yieldToUi();
            if (mine !== this.generation) return;
            sliceFrom = performance.now();
          }
        }
      }
      if (mine !== this.generation) return;
      if (this.counts.get(q) !== total) {
        this.counts.set(q, total);
        this.dirty = true;
      }
    }
    if (mine !== this.generation) return;
    this.doneFor = made;
    this.inFlight = null;
    // Counts of queries the file no longer holds are let go.
    for (const q of [...this.counts.keys()]) if (!queries.includes(q)) this.counts.delete(q);
    // Told once the stored counts differ from what was last announced, even when the run that stored them was replaced.
    if (this.dirty) {
      this.dirty = false;
      this.onChange();
    }
  }
}
