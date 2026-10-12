// The library view (Q-03; ADR-0062 item 2, 05-collections.md): a full-window view inside the unfolded workspace.
// The panes are hidden (`hidden` and `inert`), not closed, and come back as they were, scroll positions included;
// the view is a sibling of `#marxy-main` and takes its place in the workspace grid (base.css, `.marxy-library`).
// From top to bottom: the scope's name and path; the query field with its chips and completions; the results,
// each saying why it matched; on the right a text preview. Folding closes it.
//
// What it reads, and when: nothing at launch and nothing on opening. A query with plain words asks the shell to
// search the lines of the files the index keys left (`searchContent`); a content key (`words:`, `has:`, `tasks:`)
// measures those files with `readHead`, each at most once (measure.ts). It never writes, and never uses `readFile`,
// which arms the stale-write guard. The list is windowed: only the rows on screen exist.
//
// Keys, inside the view only (no global key opens it; `library.open` is a palette command): `/` or `Mod+F` focuses
// the field; Down goes into the list; Return opens the row in the focused pane and `Alt+Return` in the other; Esc
// clears the field, then closes the view with focus back on the pane that had it.
import { detectKind, type IndexEntry } from '@marxy/core';
import { KINDS } from '@marxy/core/src/contracts/kinds.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import {
  capQuery,
  completeQuery,
  evaluateQuery,
  indexCandidates,
  parseQuery,
  termNote,
  textTerms,
  usesContentKeys,
  type LineMatches,
  type Query,
  type QueryContext,
  type QueryHit,
  type Term,
} from '@marxy/core/src/index-model/index.ts';
import type { ContentHit } from '@marxy/shell-api';
import type { AppHandle } from '../app.ts';
import { palette } from '../commands/app-handle.ts';
import { kindIconElement, langOfPath } from '../kind-icons/icons.ts';
import { beginSaveQuery, collectionOf, saveQuery, type CollectionWriterShell, type SaveDraft } from '../collection/load.ts';
import { splitRefusal } from '../pane/fit.ts';
import { focusOrigin } from '../pane/focus.ts';
import { CONTENT_DEBOUNCE_MS, CONTENT_FILE_CAP, CONTENT_MIN_CHARS } from '../palette/content.ts';
import { notify as showNotice, noticeLine, placeNotice, removeNotice, type NoticeInput } from '../notices/index.ts';
import { coverPanes } from '../workspace/pane-cover.ts';
import { queryContext } from '../workspace/sidebar.ts';
import type { Workspace } from '../workspace/state.ts';
import { activeItem, chooseFacet, facetMenus, type FacetMenu } from './facets.ts';
import { MeasureCache, measureFiles } from './measure.ts';
import { libraryRow, sortChoices, sortHits, whyCount, type LibraryRow, type SortKey } from './rows.ts';
import {
  changedPredicate,
  libraryScopes,
  scopeEntries,
  scopeIsOrdered,
  type LibraryScope,
  type ScopeId,
  type ScopeInput,
} from './scopes.ts';

export interface LibraryController {
  readonly isOpen: boolean;
  /** Shows the library (unfolded only) over the panes; resolves once it is drawn. `query` and `scope` start it somewhere. */
  open(opts?: { readonly scope?: ScopeId; readonly query?: string }): Promise<void>;
  /** Hides it and gives the panes back as they were; focus returns to the pane that had it. */
  close(): void;
  /** The view and everything it started are let go (the app instance going). */
  dispose(): void;
}

const SCOPE_BLURB: Readonly<Record<string, string>> = {
  all: 'Every file the palette searches',
  recent: 'Opened in Marxy, last opened first',
  pinned: 'Pinned in the palette',
  changed: 'Modified after you last read them',
};

/** Rows drawn above and below the screenful, so a held arrow key never shows a gap. */
const OVERSCAN = 4;
/** Completions listed at most. */
const SUGGEST_MAX = 8;
/** Matching lines the preview lists. */
const PREVIEW_LINES = 8;
/** Line matches asked of the shell for one text term. */
const LINES_PER_TERM = 5000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
const MARK_PATHS = {
  changed: 'M3 5.5h9l-2.2-2.2M13 10.5H4l2.2 2.2',
  pinned: 'M8 2.5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zM8 7.7V13.5',
} as const;

function markIcon(name: keyof typeof MARK_PATHS): SVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', MARK_PATHS[name]);
  svg.append(path);
  return svg;
}

const bytesText = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

interface Saved {
  readonly windowTop: number;
  readonly scrollers: readonly (readonly [HTMLElement, number])[];
}

export function mountLibrary(workspace: Workspace, handle: AppHandle): LibraryController {
  const cache = new MeasureCache();
  /** What the shell found for each text term: the lines, and which paths were searched, so none is searched twice. */
  const lineIndex = new Map<string, { readonly searched: Set<string>; readonly matches: Map<string, ContentHit[]>; truncated: boolean }>();

  let root: HTMLElement | null = null;
  let teardown: Array<() => void> = [];
  let saved: Saved | null = null;
  let origin: ReturnType<typeof focusOrigin> | null = null;
  let main: HTMLElement | null = null;

  // The state of the view while it is open.
  let scopeId: ScopeId = 'all';
  let scopes: readonly LibraryScope[] = [];
  let sortChoice: SortKey | null = null;
  let hits: readonly QueryHit[] = [];
  let tops: number[] = [];
  let active = 0;
  let status = '';
  /** Said in the status while it holds: the query was cut to its first terms; the line search stopped at the file cap. */
  let queryNote: string | null = null;
  let lineCapNote: string | null = null;
  let measuring: string | null = null;
  let searching = false;
  let gen = 0;
  let abort: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let lineHeight = 20;
  let rowPad = 6;
  let suggestions: readonly { label: string; insert: string; detail?: string }[] = [];
  let suggestAt = -1;
  let suggestReplace: readonly [number, number] = [0, 0];
  let roots: readonly string[] = [];
  /** collection.toml as read when the reader began to name a saved search (Q-07); null while no name is being asked for. */
  let saveDraft: SaveDraft | null = null;
  let saving = false;

  // The elements.
  let field!: HTMLInputElement;
  let chipsEl!: HTMLElement;
  let suggestEl!: HTMLElement;
  let scopeNav!: HTMLElement;
  let titleEl!: HTMLElement;
  let blurbEl!: HTMLElement;
  let statusEl!: HTMLElement;
  let sortEl!: HTMLSelectElement;
  let listEl!: HTMLElement;
  let rowsEl!: HTMLElement;
  let previewEl!: HTMLElement;
  let probeLine!: HTMLElement;
  let probePad!: HTMLElement;
  let probeRow!: HTMLElement;
  let gridHead!: HTMLElement;
  let statsEl!: HTMLElement;
  let facetsEl!: HTMLElement;
  let saveButton!: HTMLButtonElement;
  let saveForm!: HTMLFormElement;
  let saveName!: HTMLInputElement;
  let noticesEl: HTMLElement | null = null;
  let openMenu: { readonly button: HTMLButtonElement; readonly menu: HTMLElement } | null = null;
  let rowH = 30;
  /** The entries of the current scope before any query: what the header counts and what the rows are drawn from. */
  let baseEntries: readonly IndexEntry[] = [];

  const feed = () => palette()?.feed ?? null;
  const input = (): ScopeInput | null => {
    const p = palette();
    if (!p) return null;
    return {
      entries: p.feed.entries(),
      declared: p.feed.declared(),
      session: p.session,
      nowMs: Date.now(),
      watched: (r) => handle.index.isWatched(r),
      baselineMs: (r) => handle.index.baselineMs(r),
    };
  };

  // The sidebar's count for a saved query is this same context (workspace/sidebar.ts), so the two cannot drift.
  function context(scopeInputs: ScopeInput, over: Partial<QueryContext> = {}): QueryContext {
    return { ...queryContext(scopeInputs), ...over };
  }

  // ---- the pipeline: index keys at once, then lines, then measures --------------------------------------------

  const sortKey = (typing: boolean): SortKey => {
    const choices = sortChoices(typing, scopeIsOrdered(scopeId));
    if (sortChoice !== null && choices.includes(sortChoice)) return sortChoice;
    return typing ? 'relevance' : scopeIsOrdered(scopeId) ? 'opened' : 'modified';
  };

  function linesFor(query: Query): LineMatches | undefined {
    const terms = textTerms(query);
    if (terms.length === 0 || lineIndex.size === 0) return undefined;
    const out = new Map<string, Map<string, ContentHit[]>>();
    for (const t of terms) {
      const found = lineIndex.get(t.text);
      if (found) out.set(t.text, found.matches);
    }
    return out;
  }

  /** Index keys now; lines and measures follow, each re-drawing the results when it lands. */
  function refresh(opts: { readonly keepActive?: boolean } = {}): void {
    if (!root) return;
    const mine = ++gen;
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    measuring = null;
    searching = false;

    const scopeInputs = input();
    if (!scopeInputs) return;
    const text = field.value;
    const capped = capQuery(parseQuery(text));
    const query = capped.query;
    queryNote = capped.note;
    lineCapNote = null;
    drawChips(text, query);
    const base = scopeEntries(scopeId, scopeInputs);
    baseEntries = base;
    drawHeaderFacts();
    drawFacets();
    const baseCtx = context(scopeInputs);
    const wantsLines = textTerms(query).some((t) => t.text.length >= CONTENT_MIN_CHARS);
    const wantsMeasure = usesContentKeys(query);
    const typing = textTerms(query).some((t) => !t.negated);
    const keep = opts.keepActive === true ? hits[active]?.entry.path : undefined;

    const evaluate = (): QueryHit[] =>
      evaluateQuery(query, base, { ...baseCtx, lines: linesFor(query), measures: wantsMeasure ? cache.forEntries(base) : undefined });
    let first = true;
    const show = (all: readonly QueryHit[], note?: string): void => {
      // A hit still waiting for a measure is not shown: it might not match.
      const shown = all.filter((h) => !h.unmeasured);
      // A new query starts at the top; the stages of one query, landing later, leave the reader where they have scrolled to.
      if (first && keep === undefined) listEl.scrollTop = 0;
      // A later stage keeps the row the reader has moved to since, not the one the query started on.
      const kept = first ? keep : hits[active]?.entry.path;
      first = false;
      hits = sortHits(shown, sortKey(typing));
      const at = kept === undefined ? -1 : hits.findIndex((h) => h.entry.path === kept);
      active = at >= 0 ? at : 0;
      status = statusLine(shown.length, base.length, note);
      drawResults();
    };

    show(evaluate());

    const candidates = wantsLines || wantsMeasure ? indexCandidates(query, base, baseCtx) : [];
    // The line search reads at most CONTENT_FILE_CAP files (searchLines); the palette says so, and so does the library.
    if (wantsLines && candidates.length > CONTENT_FILE_CAP) {
      lineCapNote = `line search covers the first ${CONTENT_FILE_CAP.toLocaleString('en-US')} of ${candidates.length.toLocaleString('en-US')} files`;
    }
    const run = async (): Promise<void> => {
      if (wantsLines) {
        searching = true;
        status = statusLine(hits.length, base.length);
        drawStatus();
        await searchLines(query, candidates, controller.signal);
        if (mine !== gen) return;
        searching = false;
        show(evaluate());
      }
      if (wantsMeasure) {
        const pending = evaluateQuery(query, base, { ...baseCtx, lines: linesFor(query), measures: cache.forEntries(base) })
          .filter((h) => h.unmeasured)
          .map((h) => h.entry);
        if (pending.length > 0) {
          measuring = `Measuring ${0} of ${pending.length.toLocaleString('en-US')} files`;
          drawStatus();
          let lastDraw = 0;
          const result = await measureFiles(pending, (path, max) => handle.shell.readHead(path, max), cache, {
            signal: controller.signal,
            onProgress(measured, of) {
              if (mine !== gen) return;
              measuring = `Measuring ${measured.toLocaleString('en-US')} of ${of.toLocaleString('en-US')} files`;
              const now = performance.now();
              if (now - lastDraw > 150) {
                lastDraw = now;
                drawStatus();
              }
            },
          });
          if (mine !== gen) return;
          measuring = null;
          show(evaluate(), result.overBudget ? `measured ${result.measured.toLocaleString('en-US')} of ${result.of.toLocaleString('en-US')} files` : undefined);
          return;
        }
        show(evaluate());
      }
    };
    if (wantsLines || wantsMeasure) {
      timer = setTimeout(() => {
        timer = undefined;
        void run().catch((error: unknown) => {
          if (mine !== gen || controller.signal.aborted) return;
          searching = false;
          measuring = null;
          status = `The files could not be searched: ${error instanceof Error ? error.message : String(error)}`;
          drawStatus();
        });
      }, wantsLines ? CONTENT_DEBOUNCE_MS : 0);
    }
  }

  /** Asks the shell for the lines holding each text term, in the candidates not yet searched for it. */
  async function searchLines(query: Query, candidates: readonly IndexEntry[], signal: AbortSignal): Promise<void> {
    const paths = candidates.map((e) => e.path).slice(0, CONTENT_FILE_CAP);
    const rootSet = [...new Set(candidates.map((e) => e.root))];
    await Promise.all(
      textTerms(query)
        .filter((t) => t.text.length >= CONTENT_MIN_CHARS)
        .map(async (t) => {
          let held = lineIndex.get(t.text);
          if (!held) {
            held = { searched: new Set(), matches: new Map(), truncated: false };
            lineIndex.set(t.text, held);
          }
          const fresh = paths.filter((p) => !held!.searched.has(p));
          if (fresh.length === 0) return;
          const result = await handle.shell.searchContent(fresh, t.text, { roots: rootSet, limit: LINES_PER_TERM, perFile: 3, signal });
          for (const p of fresh) held.searched.add(p);
          for (const h of result.hits) {
            const list = held.matches.get(h.path);
            if (list) list.push(h);
            else held.matches.set(h.path, [h]);
          }
          // Only a search that filled its limit left lines out; `truncated` is also set by the per-file cap, which is intended.
          if (result.truncated && result.hits.length >= LINES_PER_TERM) held.truncated = true;
        }),
    );
  }

  function statusLine(shown: number, total: number, note?: string): string {
    const parts = [shown === total ? `${total.toLocaleString('en-US')} ${total === 1 ? 'file' : 'files'}` : `${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} files`];
    if (note) parts.push(note);
    if (queryNote) parts.push(queryNote);
    if (lineCapNote) parts.push(lineCapNote);
    if ([...lineIndex.values()].some((v) => v.truncated)) parts.push(`line matches limited to the first ${LINES_PER_TERM.toLocaleString('en-US')} for a word`);
    if (scopeId === 'all') {
      const notice = feed()?.notice();
      if (notice) parts.push(notice);
    }
    return parts.join(' · ');
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------

  function drawStatus(): void {
    const parts = [status];
    if (searching) parts.push('searching file contents');
    if (measuring) parts.push(measuring);
    statusEl.textContent = parts.filter(Boolean).join(' · ');
  }

  function drawChips(text: string, query: Query): void {
    const terms: Term[] = query.groups.flat().sort((a, b) => a.range[0] - b.range[0]);
    const chips = terms.map((term) => {
      const chip = el('span', 'marxy-query-chip');
      chip.setAttribute('data-marxy-query-chip', '');
      const written = text.slice(term.range[0], term.range[1]);
      chip.append(el('span', 'marxy-query-chip-text', written));
      const note = termNote(term);
      if (note) {
        chip.setAttribute('data-marxy-query-chip', 'flagged');
        chip.title = note;
        chip.append(el('span', 'marxy-query-chip-note', note));
      }
      const remove = el('button', 'marxy-query-chip-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${written}`);
      remove.addEventListener('mousedown', (event) => event.preventDefault());
      remove.addEventListener('click', () => {
        const [from, to] = term.range;
        field.value = `${field.value.slice(0, from)}${field.value.slice(to)}`.replace(/\s{2,}/g, ' ').trim();
        field.focus();
        field.setSelectionRange(Math.min(from, field.value.length), Math.min(from, field.value.length));
        active = 0;
        refresh();
        updateSuggestions();
      });
      chip.append(remove);
      return chip;
    });
    // Save as smart collection (Q-07) ends the row of chips: offered for a query with at least one term, and in place of
    // itself the name field while the reader names it. A term the parser ignores (`kind:` alone) is not one.
    const hasTerms = terms.some((t) => t.kind !== 'incomplete');
    saveButton.hidden = saveDraft !== null || !hasTerms;
    saveForm.hidden = saveDraft === null;
    // The chips are replaced in front of the save controls, which stay where they are: a name being typed keeps its focus
    // and caret when the feed redraws the results.
    for (const old of chipsEl.querySelectorAll(':scope > .marxy-query-chip')) old.remove();
    for (const chip of chips) saveButton.before(chip);
    chipsEl.hidden = chips.length === 0 && saveDraft === null;
  }

  // ---- Save as smart collection (Q-07) ------------------------------------------------------------------------------

  /** Says news in the view: the panes' notices are hidden under it, so a pill is placed in the view's own region. */
  function say(input: NoticeInput): void {
    if (!noticesEl) {
      showNotice(input);
      return;
    }
    // The same news again replaces the old pill instead of stacking.
    for (const pill of noticesEl.querySelectorAll<HTMLElement>('.marxy-notice')) {
      if (pill.dataset.noticeKind === input.kind && pill.querySelector('.marxy-notice-text')?.textContent === input.text) removeNotice(pill);
    }
    placeNotice(noticesEl, noticeLine(input));
  }

  /** Reads collection.toml now, then asks for a name; nothing is written until the reader saves. */
  async function openSave(): Promise<void> {
    if (saveDraft !== null) {
      saveName.focus();
      return;
    }
    const draft = await beginSaveQuery(handle.shell, { notify: say });
    if (draft === null || !root || saveDraft !== null) return;
    saveDraft = draft;
    saveName.value = '';
    redrawSave();
    saveName.focus();
  }

  function closeSave(refocus: boolean): void {
    saveDraft = null;
    saving = false;
    if (!root) return;
    saveName.value = '';
    redrawSave();
    if (refocus) field.focus();
  }

  /** Shows the button or the name field for the query as it stands, without running the search again. */
  function redrawSave(): void {
    drawChips(field.value, capQuery(parseQuery(field.value)).query);
  }

  async function submitSave(): Promise<void> {
    if (saving || saveDraft === null) return;
    saving = true;
    let saved = false;
    try {
      saved = await saveQuery(handle.shell as CollectionWriterShell, saveDraft, { name: saveName.value, q: field.value }, {
        notify: say,
        // The section lists what the file now holds without waiting for the folder watch.
        onSaved: () => collectionOf(handle)?.reload(),
      });
    } finally {
      saving = false;
    }
    if (!root) return;
    if (saved) {
      closeSave(true);
      return;
    }
    // A refusal keeps the name for another try, against the file as it is now.
    const fresh = await beginSaveQuery(handle.shell, { notify: say });
    if (fresh !== null && root && saveDraft !== null) saveDraft = fresh;
    saveName.focus();
  }

  function measureProbes(): void {
    lineHeight = Math.max(12, probeLine.getBoundingClientRect().height || 20);
    rowPad = probePad.getBoundingClientRect().height || 6;
    rowH = Math.max(20, probeRow.getBoundingClientRect().height || 30);
  }

  /** A row is one table line; each reason the row says is a quiet line under it, across the columns. */
  const rowHeight = (hit: QueryHit): number => {
    const why = whyCount(hit);
    return rowH + (why > 0 ? why * lineHeight + rowPad / 2 : 0);
  };
  /** The part of the scroller's height below the sticky column header: where rows can be seen. */
  const viewHeight = (): number => Math.max(0, listEl.clientHeight - gridHead.offsetHeight);

  function layout(): void {
    tops = new Array<number>(hits.length + 1);
    let y = 0;
    for (let i = 0; i < hits.length; i++) {
      tops[i] = y;
      y += rowHeight(hits[i]!);
    }
    tops[hits.length] = y;
    rowsEl.style.height = `${y}px`;
  }

  /** The first row whose bottom is below `y`. */
  function rowAt(y: number): number {
    let lo = 0;
    let hi = hits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid + 1]! <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const ROW_ID = (i: number): string => `marxy-library-row-${i}`;

  function buildRow(index: number, row: LibraryRow): HTMLElement {
    const node = el('div', 'marxy-library-row');
    node.id = ROW_ID(index);
    node.setAttribute('role', 'row');
    node.setAttribute('data-marxy-library-row', row.path);
    node.setAttribute('aria-selected', index === active ? 'true' : 'false');
    node.setAttribute('aria-rowindex', String(index + 2));
    node.dataset.index = String(index);
    node.style.top = `${tops[index]}px`;
    node.style.height = `${tops[index + 1]! - tops[index]!}px`;
    const label = [row.title, row.rel, row.kindLabel, `modified ${row.spokenAge}`, ...row.marks.map((m) => m.label), ...row.why.map((w) => `matched: ${w}`)].join(', ');
    node.setAttribute('aria-label', label);

    const cell = (name: string): HTMLElement => {
      const c = el('div', `marxy-library-cell marxy-library-cell-${name}`);
      c.setAttribute('role', 'gridcell');
      return c;
    };
    const name = cell('name');
    if (row.kind !== null) {
      const glyph = kindIconElement(document, row.kind, langOfPath(row.path));
      glyph.setAttribute('aria-hidden', 'true');
      name.append(glyph);
    }
    name.append(el('span', 'marxy-library-row-name', row.title));
    const path = cell('path');
    path.append(el('span', 'marxy-library-row-rel', row.rel));
    path.title = row.rel;
    const modified = cell('modified');
    modified.append(el('span', 'marxy-library-row-age', row.age));
    modified.title = `Modified ${row.spokenAge}`;
    const status = cell('status');
    for (const mark of row.marks) {
      const m = el('span', 'marxy-library-mark');
      m.title = mark.label;
      m.append(markIcon(mark.name), el('span', 'marxy-library-mark-name', mark.label));
      status.append(m);
    }
    node.append(name, path, modified, status);
    if (row.why.length > 0) {
      const why = el('div', 'marxy-library-row-whys');
      why.setAttribute('role', 'gridcell');
      why.setAttribute('aria-colspan', '4');
      for (const line of row.why) why.append(el('div', 'marxy-library-row-why', line));
      node.append(why);
    }
    return node;
  }

  function drawRows(): void {
    if (hits.length === 0) {
      rowsEl.replaceChildren();
      return;
    }
    const scoped = input();
    if (!scoped) return;
    const ctx = { nowMs: scoped.nowMs, pinned: new Set(scoped.session.pinned), changed: changedPredicate(scoped) };
    const top = listEl.scrollTop;
    const first = Math.max(0, rowAt(top) - OVERSCAN);
    const last = Math.min(hits.length - 1, rowAt(top + viewHeight()) + OVERSCAN);
    const nodes: HTMLElement[] = [];
    for (let i = first; i <= last; i++) nodes.push(buildRow(i, libraryRow(hits[i]!, ctx)));
    rowsEl.replaceChildren(...nodes);
    syncActiveDescendant();
  }

  function syncActiveDescendant(): void {
    const focusedInList = document.activeElement === listEl;
    if (focusedInList && hits[active]) listEl.setAttribute('aria-activedescendant', ROW_ID(active));
    else listEl.removeAttribute('aria-activedescendant');
  }

  function drawResults(): void {
    measureProbes();
    layout();
    listEl.scrollTop = Math.min(listEl.scrollTop, Math.max(0, (tops[hits.length] ?? 0) - viewHeight()));
    drawRows();
    drawStatus();
    drawPreview();
    const typing = textTerms(parseQuery(field.value)).some((t) => !t.negated);
    const choices = sortChoices(typing, scopeIsOrdered(scopeId));
    const current = sortKey(typing);
    sortEl.replaceChildren(...choices.map((c) => {
      const option = el('option', undefined, SORT_LABEL[c]);
      option.value = c;
      option.selected = c === current;
      return option;
    }));
    listEl.setAttribute('aria-busy', measuring || searching ? 'true' : 'false');
    listEl.setAttribute('aria-rowcount', String(hits.length + 1));
    for (const [key, head] of headCells) {
      const sorted = key === current;
      head.setAttribute('aria-sort', sorted ? (key === 'modified' ? 'descending' : 'ascending') : 'none');
    }
    sortButtons(choices);
  }

  /** The sortable column headers are offered only for the keys the Sort control offers now. */
  function sortButtons(choices: readonly SortKey[]): void {
    for (const [key, head] of headCells) head.querySelector('button')!.disabled = !choices.includes(key);
  }

  // ---- the header of facts and the filter menus ------------------------------------------------------------------

  function watchFact(): string | null {
    // Only the whole library, or one folder, has a watch to report; Recent, Pinned and Changed are made of the session.
    if (scopeId !== 'all' && !scopeId.startsWith('folder:')) return null;
    if (scopeId.startsWith('folder:') && !handle.index.isWatched(scopeId.slice('folder:'.length))) return 'Not watching';
    const state = handle.index.watchState();
    return state === 'live' ? 'Watching' : state === 'refused' ? 'Not watching: the watch limit was reached' : 'Not watching';
  }

  /** Counts the documents the rows are drawn from (the scope's own set, as the palette's feed folds it), never the raw index. */
  function drawHeaderFacts(): void {
    const n = baseEntries.length;
    const size = baseEntries.reduce((sum, e) => sum + e.size, 0);
    const facts = [`${n.toLocaleString('en-US')} ${n === 1 ? 'file' : 'files'}`, bytesText(size)];
    if (scopeId === 'all' || scopeId.startsWith('folder:')) facts.push(handle.index.indexing() ? 'Indexing' : 'Indexed');
    const watch = watchFact();
    if (watch !== null) facts.push(watch);
    statsEl.replaceChildren(...facts.map((f) => el('span', 'marxy-library-stat', f)));
  }

  function closeMenu(): void {
    if (!openMenu) return;
    openMenu.menu.hidden = true;
    openMenu.button.setAttribute('aria-expanded', 'false');
    openMenu = null;
  }

  function drawFacets(): void {
    const scoped = input();
    if (!scoped) return;
    const ctx = context(scoped);
    const menus = facetMenus({ entries: baseEntries, nowMs: scoped.nowMs, pinned: ctx.pinned, recent: ctx.recent, changed: ctx.changed });
    closeMenu();
    facetsEl.replaceChildren(...menus.map((m) => facetMenuElement(m)));
    facetsEl.hidden = menus.length === 0;
  }

  function facetMenuElement(menu: FacetMenu): HTMLElement {
    const wrap = el('div', 'marxy-library-facet');
    const button = el('button', 'marxy-library-facet-button');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    const chosen = activeItem(field.value, menu);
    button.append(el('span', undefined, chosen ? `${menu.label}: ${chosen.label}` : menu.label));
    if (chosen) button.setAttribute('data-marxy-facet-on', '');
    const list = el('div', 'marxy-library-facet-menu');
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', menu.label);
    list.hidden = true;
    for (const item of menu.items) {
      const row = el('button', 'marxy-library-facet-item');
      row.type = 'button';
      row.setAttribute('role', 'menuitemradio');
      row.setAttribute('aria-checked', chosen?.term === item.term ? 'true' : 'false');
      row.append(el('span', undefined, item.label), el('span', 'marxy-library-facet-count', item.count.toLocaleString('en-US')));
      row.addEventListener('click', () => {
        field.value = chooseFacet(field.value, menu, item);
        active = 0;
        closeMenu();
        refresh();
        updateSuggestions();
        field.focus();
      });
      list.append(row);
    }
    button.addEventListener('click', () => {
      const wasOpen = openMenu?.button === button;
      closeMenu();
      if (wasOpen) return;
      list.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      openMenu = { button, menu: list };
      list.querySelector<HTMLElement>('[aria-checked="true"], button')?.focus();
    });
    list.addEventListener('keydown', (event) => {
      const items = [...list.querySelectorAll<HTMLElement>('button')];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); button.focus(); }
    });
    wrap.append(button, list);
    return wrap;
  }

  function ensureVisible(index: number): void {
    if (!hits[index]) return;
    const top = tops[index]!;
    const bottom = tops[index + 1]!;
    if (top < listEl.scrollTop) listEl.scrollTop = top;
    else if (bottom > listEl.scrollTop + viewHeight()) listEl.scrollTop = bottom - viewHeight();
    drawRows();
  }

  function setActive(index: number): void {
    if (hits.length === 0) return;
    active = Math.max(0, Math.min(hits.length - 1, index));
    ensureVisible(active);
    for (const node of rowsEl.children) node.setAttribute('aria-selected', (node as HTMLElement).dataset.index === String(active) ? 'true' : 'false');
    syncActiveDescendant();
    drawPreview();
  }

  function drawPreview(): void {
    const hit = hits[active];
    previewEl.replaceChildren();
    if (!hit) {
      previewEl.append(el('p', 'marxy-library-preview-empty', hits.length === 0 ? 'Nothing matches.' : 'Select a file.'));
      return;
    }
    const e = hit.entry;
    previewEl.append(el('h3', 'marxy-library-preview-title', e.title), el('p', 'marxy-library-preview-path', e.path));
    const facts = el('dl', 'marxy-library-facts');
    const fact = (name: string, value: string): void => {
      facts.append(el('dt', undefined, name), el('dd', undefined, value));
    };
    const kind = e.readerKind ?? e.kind;
    const why = detectKind({ path: e.path, head: new Uint8Array() }).reasons.find((r) => r.decisive);
    fact('Kind', kind);
    if (why) fact('Detected', `${why.signal}${why.at ? ` (${why.at})` : ''}`);
    fact('Modified', new Date(e.mtimeMs).toLocaleString());
    fact('Size', bytesText(e.size));
    previewEl.append(facts);
    // The lines the search found in this file, for every word of the query (a row shows one).
    const found = new Map<number, string>();
    for (const held of lineIndex.values()) for (const m of held.matches.get(e.path) ?? []) found.set(m.line, m.preview.trim());
    if (found.size > 0) {
      previewEl.append(el('h4', 'marxy-library-preview-head', 'Matching lines'));
      const list = el('ul', 'marxy-library-preview-lines');
      for (const [line, text] of [...found].sort((a, b) => a[0] - b[0]).slice(0, PREVIEW_LINES)) list.append(el('li', undefined, `${line}: ${text}`));
      previewEl.append(list);
    }
    if (e.headings.length > 0) {
      previewEl.append(el('h4', 'marxy-library-preview-head', 'Headings'));
      const list = el('ul', 'marxy-library-preview-headings');
      for (const h of e.headings.slice(0, 16)) {
        const li = el('li', undefined, h.text);
        li.style.paddingInlineStart = `${Math.max(0, h.level - 1)}em`;
        list.append(li);
      }
      previewEl.append(list);
    }
    const actions = el('div', 'marxy-library-preview-actions');
    const open = el('button', undefined, 'Open');
    open.type = 'button';
    open.addEventListener('click', () => void openActive(false));
    const beside = el('button', undefined, 'Open in the other pane');
    beside.type = 'button';
    beside.addEventListener('click', () => void openActive(true));
    actions.append(open, beside);
    previewEl.append(actions);
  }

  // ---- completions -------------------------------------------------------------------------------------------------

  function updateSuggestions(): void {
    const caret = field.selectionStart ?? field.value.length;
    const result = field.value === '' ? { replace: [0, 0] as const, items: [] } : completeQuery(field.value, caret, { collections: roots.map((r) => basename(r)), kinds: KINDS });
    suggestions = result.items.slice(0, SUGGEST_MAX);
    suggestReplace = result.replace;
    suggestAt = -1;
    suggestEl.replaceChildren(
      ...suggestions.map((item, i) => {
        const option = el('div', 'marxy-library-suggest-item');
        option.id = `marxy-library-suggest-${i}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.append(el('span', undefined, item.label));
        if (item.detail) option.append(el('span', 'marxy-library-suggest-detail', item.detail));
        option.addEventListener('mousedown', (event) => {
          event.preventDefault();
          suggestAt = i;
          acceptSuggestion();
        });
        return option;
      }),
    );
    suggestEl.hidden = suggestions.length === 0;
    field.setAttribute('aria-expanded', suggestions.length === 0 ? 'false' : 'true');
    field.removeAttribute('aria-activedescendant');
  }

  function moveSuggestion(delta: number): void {
    if (suggestions.length === 0) return;
    suggestAt = (suggestAt + delta + suggestions.length + (suggestAt < 0 && delta < 0 ? 1 : 0)) % suggestions.length;
    [...suggestEl.children].forEach((child, i) => child.setAttribute('aria-selected', i === suggestAt ? 'true' : 'false'));
    field.setAttribute('aria-activedescendant', `marxy-library-suggest-${suggestAt}`);
  }

  function acceptSuggestion(): void {
    const item = suggestions[suggestAt < 0 ? 0 : suggestAt];
    if (!item) return;
    const [from, to] = suggestReplace;
    field.value = `${field.value.slice(0, from)}${item.insert}${field.value.slice(to)}`;
    const caret = from + item.insert.length;
    field.setSelectionRange(caret, caret);
    refresh();
    updateSuggestions();
  }

  // ---- opening a row -----------------------------------------------------------------------------------------------

  async function openActive(beside: boolean): Promise<void> {
    const hit = hits[active];
    if (!hit) return;
    if (beside) {
      // A refusal is said here, in the view: the panes' notices are hidden under it. The fit is measured on the panes'
      // own box, which has no width while it is hidden, so it is shown for the one synchronous measure (nothing paints).
      main!.hidden = false;
      const refusal = splitRefusal(handle.panes());
      main!.hidden = true;
      if (refusal !== null) {
        status = refusal;
        drawStatus();
        return;
      }
    }
    const path = hit.entry.path;
    closeNow(true);
    await handle.open(path, beside ? { target: 'other' } : undefined);
  }

  // ---- keys ----------------------------------------------------------------------------------------------------------

  const dialogOpen = (): boolean => document.querySelector('dialog[open]') !== null;
  const isMod = (event: KeyboardEvent): boolean => (/mac/i.test(navigator.platform) ? event.metaKey : event.ctrlKey);

  function onWindowKey(event: KeyboardEvent): void {
    if (!root || dialogOpen()) return;
    const inside = event.target instanceof Element ? event.target : null;
    // A pill that has focus is dismissed by its own Esc, and the name field's Esc closes the field: neither clears the search.
    if (event.key === 'Escape' && inside?.closest('.marxy-notice')) return;
    if (event.key === 'Escape' && inside !== null && saveForm.contains(inside)) {
      event.preventDefault();
      event.stopPropagation();
      closeSave(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (field.value !== '') {
        field.value = '';
        active = 0;
        refresh();
        updateSuggestions();
        field.focus();
      } else closeNow(true);
      return;
    }
    if (isMod(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      field.focus();
      field.select();
      return;
    }
    const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(input|textarea|select)$/i.test(event.target.tagName));
    if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      field.focus();
    }
  }

  function intoList(): void {
    if (hits.length === 0) return;
    active = Math.max(0, Math.min(active, hits.length - 1));
    listEl.focus();
    setActive(active);
  }

  function onFieldKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const open = suggestions.length > 0;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (open) moveSuggestion(1);
        else intoList();
        break;
      case 'ArrowUp':
        if (open) {
          event.preventDefault();
          moveSuggestion(-1);
        }
        break;
      case 'Tab':
        if (open && !event.shiftKey) {
          event.preventDefault();
          acceptSuggestion();
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (open && suggestAt >= 0) acceptSuggestion();
        else if (event.altKey) void openActive(true);
        else intoList();
        break;
      default:
    }
  }

  function onListKey(event: KeyboardEvent): void {
    const page = Math.max(1, Math.floor(viewHeight() / rowH));
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActive(active + 1); break;
      case 'ArrowUp': event.preventDefault(); if (active === 0) field.focus(); else setActive(active - 1); break;
      case 'PageDown': event.preventDefault(); setActive(active + page); break;
      case 'PageUp': event.preventDefault(); setActive(active - page); break;
      case 'Home': event.preventDefault(); setActive(0); break;
      case 'End': event.preventDefault(); setActive(hits.length - 1); break;
      case 'Enter': event.preventDefault(); void openActive(event.altKey); break;
      default:
        // Typing in the list is typing in the field.
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && event.key !== '/') field.focus();
    }
  }

  // ---- building and tearing down ----------------------------------------------------------------------------

  /** The columns, left to right; a header sorts by the key beside it. Measure is not a column: no measure exists per entry yet (W-16). */
  const COLUMNS: readonly (readonly [SortKey | null, string])[] = [['name', 'Name'], ['path', 'Path'], ['modified', 'Modified'], [null, 'Status']];
  const headCells = new Map<SortKey, HTMLElement>();
  const SORT_LABEL: Readonly<Record<SortKey, string>> = { relevance: 'Relevance', opened: 'Last opened', modified: 'Modified', name: 'Name', path: 'Path' };

  function drawScopes(): void {
    const scoped = input();
    if (!scoped) return;
    scopes = libraryScopes(scoped);
    roots = [...new Set(scoped.entries.map((e) => e.root))];
    scopeNav.replaceChildren(
      ...scopes.map((s) => {
        const b = el('button', 'marxy-library-scope', s.label);
        b.type = 'button';
        b.append(el('span', 'marxy-library-scope-count', s.count.toLocaleString('en-US')));
        b.setAttribute('aria-current', s.id === scopeId ? 'true' : 'false');
        b.addEventListener('click', () => setScope(s.id));
        return b;
      }),
    );
    const current = scopes.find((s) => s.id === scopeId) ?? scopes[0]!;
    titleEl.textContent = current.label;
    blurbEl.textContent = current.path ?? SCOPE_BLURB[current.id] ?? '';
    drawHeaderFacts();
  }

  function setScope(id: ScopeId): void {
    if (id === scopeId && field.value === '') return;
    scopeId = id;
    sortChoice = null;
    // Switching clears the query, so a name being asked for has nothing to save.
    saveDraft = null;
    saveName.value = '';
    field.value = '';
    active = 0;
    listEl.scrollTop = 0;
    drawScopes();
    refresh();
    updateSuggestions();
  }

  function build(): HTMLElement {
    const section = el('section', 'marxy-library');
    section.setAttribute('data-marxy-library', '');
    section.setAttribute('role', 'region');
    section.setAttribute('aria-label', 'Library');

    const head = el('header', 'marxy-library-head');
    const heading = el('div', 'marxy-library-heading');
    titleEl = el('h2', 'marxy-library-title');
    blurbEl = el('p', 'marxy-library-blurb');
    statsEl = el('p', 'marxy-library-stats');
    heading.append(titleEl, blurbEl, statsEl);
    scopeNav = el('nav', 'marxy-library-scopes');
    scopeNav.setAttribute('aria-label', 'Scopes');
    head.append(heading, scopeNav);

    saveButton = el('button', 'marxy-library-save', 'Save as smart collection');
    saveButton.type = 'button';
    saveButton.hidden = true;
    saveButton.setAttribute('data-marxy-library-save', '');
    saveButton.addEventListener('click', () => void openSave());
    saveForm = el('form', 'marxy-library-save-form');
    saveForm.hidden = true;
    saveForm.setAttribute('data-marxy-library-save-form', '');
    saveForm.setAttribute('role', 'group');
    saveForm.setAttribute('aria-label', 'Save as smart collection');
    saveName = el('input', 'marxy-library-save-name');
    saveName.type = 'text';
    saveName.setAttribute('aria-label', 'Name for this smart collection');
    saveName.placeholder = 'Name';
    saveName.spellcheck = false;
    saveName.autocomplete = 'off';
    const saveGo = el('button', 'marxy-library-save', 'Save');
    saveGo.type = 'submit';
    const saveCancel = el('button', 'marxy-library-save', 'Cancel');
    saveCancel.type = 'button';
    saveCancel.addEventListener('click', () => closeSave(true));
    saveForm.append(saveName, saveGo, saveCancel);
    saveForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitSave();
    });

    const search = el('div', 'marxy-library-search');
    field = el('input', 'marxy-library-field');
    field.type = 'text';
    field.setAttribute('role', 'combobox');
    field.setAttribute('aria-label', 'Search the library');
    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-expanded', 'false');
    field.setAttribute('aria-controls', 'marxy-library-suggest');
    field.placeholder = 'Search: words, kind:report, is:changed, modified:<7d, words:>500';
    field.spellcheck = false;
    field.autocomplete = 'off';
    suggestEl = el('div', 'marxy-library-suggest');
    suggestEl.id = 'marxy-library-suggest';
    suggestEl.setAttribute('role', 'listbox');
    suggestEl.setAttribute('aria-label', 'Suggestions');
    suggestEl.hidden = true;
    chipsEl = el('div', 'marxy-library-chips');
    chipsEl.hidden = true;
    chipsEl.append(saveButton, saveForm);
    search.append(field, suggestEl, chipsEl);

    const bar = el('div', 'marxy-library-bar');
    facetsEl = el('div', 'marxy-library-facets');
    facetsEl.hidden = true;
    const sortLabel = el('label', 'marxy-library-sort', 'Sort ');
    sortEl = el('select');
    sortEl.setAttribute('aria-label', 'Sort results by');
    sortLabel.append(sortEl);
    bar.append(facetsEl, sortLabel);
    statusEl = el('div', 'marxy-library-status');
    statusEl.setAttribute('role', 'status');

    const body = el('div', 'marxy-library-body');
    listEl = el('div', 'marxy-library-results');
    listEl.tabIndex = 0;
    listEl.setAttribute('role', 'grid');
    listEl.setAttribute('aria-label', 'Results');
    listEl.setAttribute('aria-colcount', '4');
    gridHead = el('div', 'marxy-library-grid-head');
    gridHead.setAttribute('role', 'row');
    gridHead.setAttribute('aria-rowindex', '1');
    headCells.clear();
    for (const [key, label] of COLUMNS) {
      const head = el('div', `marxy-library-colhead marxy-library-cell-${label.toLowerCase()}`);
      head.setAttribute('role', 'columnheader');
      if (key === null) head.textContent = label;
      else {
        const b = el('button', undefined, label);
        b.type = 'button';
        b.addEventListener('click', () => {
          sortChoice = key;
          refresh({ keepActive: true });
        });
        head.append(b);
        headCells.set(key, head);
      }
      gridHead.append(head);
    }
    rowsEl = el('div', 'marxy-library-rows');
    rowsEl.setAttribute('role', 'rowgroup');
    listEl.append(gridHead, rowsEl);
    previewEl = el('aside', 'marxy-library-preview');
    previewEl.setAttribute('aria-label', 'Preview');
    body.append(listEl, previewEl);

    probeLine = el('span', 'marxy-library-probe marxy-library-probe-line');
    probePad = el('span', 'marxy-library-probe marxy-library-probe-pad');
    probeRow = el('span', 'marxy-library-probe marxy-library-probe-row');
    noticesEl = el('div', 'marxy-library-notices');
    noticesEl.setAttribute('role', 'status');
    section.append(head, search, bar, body, statusEl, noticesEl, probeLine, probePad, probeRow);

    field.addEventListener('input', () => {
      active = 0;
      refresh();
      updateSuggestions();
    });
    field.addEventListener('keydown', onFieldKey);
    field.addEventListener('keyup', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') updateSuggestions();
    });
    field.addEventListener('click', updateSuggestions);
    field.addEventListener('blur', () => {
      suggestEl.hidden = true;
      suggestions = [];
      field.setAttribute('aria-expanded', 'false');
      field.removeAttribute('aria-activedescendant');
    });
    section.addEventListener('mousedown', (event) => {
      if (openMenu && !(event.target as Element).closest('.marxy-library-facet')) closeMenu();
    });
    sortEl.addEventListener('change', () => {
      sortChoice = sortEl.value as SortKey;
      refresh({ keepActive: true });
    });
    listEl.addEventListener('keydown', onListKey);
    listEl.addEventListener('focus', syncActiveDescendant);
    listEl.addEventListener('blur', syncActiveDescendant);
    listEl.addEventListener('scroll', () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        drawRows();
      });
    }, { passive: true });
    listEl.addEventListener('click', (event) => {
      const row = (event.target as Element).closest<HTMLElement>('[data-marxy-library-row]');
      if (!row) return;
      setActive(Number(row.dataset.index));
      listEl.focus();
    });
    listEl.addEventListener('dblclick', (event) => {
      const row = (event.target as Element).closest<HTMLElement>('[data-marxy-library-row]');
      if (row) void openActive(event.altKey);
    });
    return section;
  }

  function closeNow(restoreFocus: boolean): void {
    if (!root) return;
    gen++;
    abort?.abort();
    abort = null;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    for (const off of teardown) off();
    teardown = [];
    root.remove();
    root = null;
    noticesEl = null;
    saveDraft = null;
    saving = false;
    if (main) {
      main.hidden = false;
      main.inert = false;
    }
    // The panes come back where they were: a hidden box forgets its scroll, so it is put back.
    if (saved) {
      window.scrollTo(0, saved.windowTop);
      for (const [scroller, top] of saved.scrollers) if (scroller !== document.documentElement) scroller.scrollTop = top;
    }
    saved = null;
    cache.bytesRead = 0;
    lineIndex.clear();
    if (restoreFocus) origin?.restore();
    origin = null;
    main = null;
  }

  async function open(opts: { readonly scope?: ScopeId; readonly query?: string } = {}): Promise<void> {
    if (root) {
      // Asked for a query while open (a Smart collections row): the view takes it in place, over All files.
      if (opts.query !== undefined) {
        scopeId = opts.scope ?? 'all';
        sortChoice = null;
        saveDraft = null;
        saveName.value = '';
        field.value = opts.query;
        active = 0;
        listEl.scrollTop = 0;
        drawScopes();
        refresh();
      }
      field.focus();
      updateSuggestions();
      return;
    }
    if (workspace.mode !== 'unfolded' || !palette()) return;
    const panes = handle.panes();
    main = panes.panes[0]?.host.parentElement ?? document.getElementById('marxy-main');
    if (!main) return;
    origin = focusOrigin(panes);
    saved = {
      windowTop: window.scrollY,
      scrollers: panes.panes.map((p) => [p.view.scroller, p.view.scroller.scrollTop] as const),
    };
    main.hidden = true;
    main.inert = true;
    root = build();
    main.after(root);
    scopeId = opts.scope ?? 'all';
    sortChoice = null;
    active = 0;
    field.value = opts.query ?? '';
    drawScopes();
    refresh();
    window.addEventListener('keydown', onWindowKey, true);
    teardown.push(() => window.removeEventListener('keydown', onWindowKey, true));
    const onResize = (): void => drawResults();
    window.addEventListener('resize', onResize);
    teardown.push(() => window.removeEventListener('resize', onResize));
    // Folding the window closes the library; any document opening anywhere (the palette, a link) does too.
    teardown.push(workspace.onChange((mode) => { if (mode === 'folded') closeNow(false); }));
    teardown.push(panes.onChange((e) => { if (e.kind === 'open') closeNow(false); }));
    // A click on a tab (or a tab command) opens in a pane without PaneSet.open: it asks the cover to let go first, so the
    // "Save and open" notice of a pane with unsaved edits is not raised under the view.
    teardown.push(coverPanes(() => closeNow(false)));
    let pending = 0;
    teardown.push(palette()!.feed.subscribe(() => {
      if (pending !== 0) return;
      pending = window.setTimeout(() => {
        pending = 0;
        if (!root) return;
        drawScopes();
        lineIndex.clear();
        refresh({ keepActive: true });
      }, 100);
    }));
    teardown.push(() => { if (pending !== 0) clearTimeout(pending); });
    teardown.push(handle.index.onStatusChange(() => { if (root) drawHeaderFacts(); }));
    field.focus();
    updateSuggestions();
  }

  return {
    get isOpen() {
      return root !== null;
    },
    open,
    close: () => closeNow(true),
    dispose: () => closeNow(false),
  };
}

/** The library for the running app, made on first use and again for a newer app instance. */
let current: { readonly handle: AppHandle; readonly controller: LibraryController } | null = null;

export function libraryFor(handle: AppHandle): LibraryController {
  if (current && current.handle !== handle) {
    current.controller.dispose();
    current = null;
  }
  if (!current) current = { handle, controller: mountLibrary(handle.workspace(), handle) };
  return current.controller;
}
