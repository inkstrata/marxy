// Content search in the palette (C-17): `/` then a phrase searches the contents of the files in the
// palette's scope, in one shell call (C-16). Nothing is indexed and nothing is written; only the
// scoped entries' own paths are read, on this machine. A pause after the last keystroke starts a
// search (120 ms), a newer query aborts the one in flight, and an answer that arrives late is dropped,
// so typing never waits on a scan and the fuzzy matcher is never run for this phase.
import type { InvisibleSegment } from '@marxy/core/src/render/index.ts';
import type { ContentHit, ContentSearchOptions, ContentSearchResult } from '@marxy/shell-api';

/** The phrase after a leading `/`, or null when the query is not a content query (`foo/bar` is fuzzy). */
export function contentQuery(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return null;
  return trimmed.slice(1).trim();
}

/**
 * A whole preview's invisible segments split at the UTF-16 offsets `start` and `end` into before, match
 * and after. Segmenting once and cutting afterwards judges a joiner at the edge of the match with its
 * neighbours (a ZWJ inside an emoji sequence, a Persian ZWNJ), as Rendered and the row's label do. A
 * flagged character goes to the slice it starts in.
 */
export function splitSegments(
  segments: readonly InvisibleSegment[],
  start: number,
  end: number,
): [InvisibleSegment[], InvisibleSegment[], InvisibleSegment[]] {
  const out: [InvisibleSegment[], InvisibleSegment[], InvisibleSegment[]] = [[], [], []];
  const slot = (at: number): 0 | 1 | 2 => (at < start ? 0 : at < end ? 1 : 2);
  const limits = [start, end, Infinity] as const;
  let pos = 0;
  for (const seg of segments) {
    if (seg.kind === 'text') {
      const v = seg.value;
      for (let i = 0; i < v.length; ) {
        const k = slot(pos + i);
        const j = Math.min(v.length, limits[k] - pos);
        out[k].push({ kind: 'text', value: v.slice(i, j) });
        i = j;
      }
      pos += v.length;
    } else {
      out[slot(pos)].push(seg);
      pos += seg.kind === 'marker' ? (seg.cp > 0xffff ? 2 : 1) : seg.payload.length;
    }
  }
  return out;
}

export const CONTENT_DEBOUNCE_MS = 120;
export const CONTENT_MIN_CHARS = 2;
export const CONTENT_LIMIT = 200;
export const CONTENT_FILE_CAP = 20_000;
/** Rows the palette paints for one search. */
export const CONTENT_ROW_LIMIT = 50;

/** What the palette searches: the scoped entries' paths in scope order (the current root first) and their roots. */
export interface ContentScope {
  readonly paths: readonly string[];
  readonly roots: readonly string[];
}

export interface ContentState {
  readonly status: 'hint' | 'searching' | 'done' | 'failed';
  readonly notice: string;
  readonly hits: readonly ContentHit[];
}

export interface ContentShell {
  searchContent(paths: readonly string[], query: string, opts: ContentSearchOptions): Promise<ContentSearchResult>;
  mark(name: string, t: number, data?: string): Promise<void>;
}

export interface ContentSearch {
  /** The text after `/` (or null to leave the phase): starts, restarts or cancels a search. */
  update(phrase: string | null): void;
  /** Drops any search in flight and any answer still to come. */
  cancel(): void;
}

export interface ContentSearchOpts {
  readonly debounceMs?: number;
  readonly now?: () => number;
}

export const HINT_NOTICE = 'Type to search file contents';

export function countNotice(result: ContentSearchResult, fileCapped: boolean): string {
  const files = new Set(result.hits.map((hit) => hit.path)).size;
  let line: string;
  if (result.hits.length === 0) line = 'No matches';
  else if (result.truncated) line = `Showing the first ${result.hits.length} matches`;
  else line = `${result.hits.length} ${result.hits.length === 1 ? 'match' : 'matches'} in ${files} ${files === 1 ? 'file' : 'files'}`;
  return fileCapped ? `${line}. Searched the first ${CONTENT_FILE_CAP.toLocaleString('en-US')} files in scope.` : line;
}

export function createContentSearch(
  shell: ContentShell,
  scope: () => ContentScope,
  onResult: (state: ContentState) => void,
  opts: ContentSearchOpts = {},
): ContentSearch {
  const debounceMs = opts.debounceMs ?? CONTENT_DEBOUNCE_MS;
  const now = opts.now ?? (() => performance.now());
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let lastPhrase: string | null = null;

  const stop = () => {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  };

  const run = async (phrase: string, mine: number) => {
    const { paths, roots } = scope();
    const fileCapped = paths.length > CONTENT_FILE_CAP;
    const abort = new AbortController();
    controller = abort;
    const started = now();
    try {
      const result = await shell.searchContent(fileCapped ? paths.slice(0, CONTENT_FILE_CAP) : paths, phrase, {
        roots,
        limit: CONTENT_LIMIT,
        signal: abort.signal,
      });
      if (mine !== generation) return;
      void shell.mark('content_search', Date.now(), `ms=${(now() - started).toFixed(1)} hits=${result.hits.length}`);
      onResult({ status: 'done', notice: countNotice(result, fileCapped), hits: result.hits });
    } catch (err) {
      if (mine !== generation) return;
      lastPhrase = null; // so typing it again tries again
      onResult({ status: 'failed', notice: `Search failed: ${err instanceof Error ? err.message : String(err)}`, hits: [] });
    }
  };

  return {
    update(phrase) {
      // The same phrase (a trailing space, a repaint) keeps its rows and its search in flight.
      if (phrase !== null && phrase === lastPhrase) return;
      lastPhrase = phrase;
      stop();
      if (phrase === null) return;
      if ([...phrase].length < CONTENT_MIN_CHARS) {
        onResult({ status: 'hint', notice: HINT_NOTICE, hits: [] });
        return;
      }
      const mine = generation;
      onResult({ status: 'searching', notice: 'Searching…', hits: [] });
      timer = setTimeout(() => {
        timer = undefined;
        void run(phrase, mine);
      }, debounceMs);
    },
    cancel() {
      lastPhrase = null;
      stop();
    },
  };
}
