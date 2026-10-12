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
import { appHandle, palette } from '../commands/app-handle.ts';
import { kindIconElement, langOfPath } from '../kind-icons/icons.ts';
import { splitRefusal } from '../pane/fit.ts';
import { focusOrigin } from '../pane/focus.ts';
import { CONTENT_DEBOUNCE_MS, CONTENT_FILE_CAP, CONTENT_MIN_CHARS } from '../palette/content.ts';
import type { Workspace } from '../workspace/state.ts';
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

  function context(scopeInputs: ScopeInput, over: Partial<QueryContext> = {}): QueryContext {
    const { session } = scopeInputs;
    return {
      nowMs: scopeInputs.nowMs,
      pinned: new Set(session.pinned),
      recent: new Set(session.mru),
      changed: changedPredicate(scopeInputs),
      readAt: (e) => session.readAt[e.path],
      ...over,
    };
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
    const query = parseQuery(text);
    drawChips(text, query);
    const base = scopeEntries(scopeId, scopeInputs);
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
      first = false;
      hits = sortHits(shown, sortKey(typing));
      const at = keep === undefined ? -1 : hits.findIndex((h) => h.entry.path === keep);
      active = at >= 0 ? at : 0;
      status = statusLine(shown.length, base.length, note);
      drawResults();
    };

    show(evaluate());

    const candidates = wantsLines || wantsMeasure ? indexCandidates(query, base, baseCtx) : [];
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
    chipsEl.replaceChildren(...chips);
    chipsEl.hidden = chips.length === 0;
  }

  function measureProbes(): void {
    lineHeight = Math.max(12, probeLine.getBoundingClientRect().height || 20);
    rowPad = probePad.getBoundingClientRect().height || 6;
  }

  const rowHeight = (hit: QueryHit): number => (2 + whyCount(hit)) * lineHeight + 2 * rowPad;

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
    node.setAttribute('role', 'option');
    node.setAttribute('data-marxy-library-row', row.path);
    node.setAttribute('aria-selected', index === active ? 'true' : 'false');
    node.setAttribute('aria-posinset', String(index + 1));
    node.setAttribute('aria-setsize', String(hits.length));
    node.dataset.index = String(index);
    node.style.top = `${tops[index]}px`;
    node.style.height = `${tops[index + 1]! - tops[index]!}px`;
    const label = [row.title, row.rel, row.kindLabel, `modified ${row.spokenAge}`, ...row.marks.map((m) => m.label), ...row.why.map((w) => `matched: ${w}`)].join(', ');
    node.setAttribute('aria-label', label);

    const first = el('div', 'marxy-library-row-title');
    if (row.kind !== null) first.append(kindIconElement(document, row.kind, langOfPath(row.path)));
    first.append(el('span', 'marxy-library-row-name', row.title));
    for (const mark of row.marks) {
      const m = el('span', 'marxy-library-mark');
      m.title = mark.label;
      m.append(markIcon(mark.name), el('span', 'marxy-library-mark-name', mark.label));
      first.append(m);
    }
    const age = el('span', 'marxy-library-row-age', row.age);
    age.title = `Modified ${row.spokenAge}`;
    first.append(age);

    const second = el('div', 'marxy-library-row-path');
    second.append(el('span', 'marxy-library-row-rel', row.rel), el('span', 'marxy-library-row-kind', row.kindLabel));
    node.append(first, second);
    for (const line of row.why) node.append(el('div', 'marxy-library-row-why', line));
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
    const last = Math.min(hits.length - 1, rowAt(top + listEl.clientHeight) + OVERSCAN);
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
    listEl.scrollTop = Math.min(listEl.scrollTop, Math.max(0, (tops[hits.length] ?? 0) - listEl.clientHeight));
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
  }

  function ensureVisible(index: number): void {
    if (!hits[index]) return;
    const top = tops[index]!;
    const bottom = tops[index + 1]!;
    if (top < listEl.scrollTop) listEl.scrollTop = top;
    else if (bottom > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = bottom - listEl.clientHeight;
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
    const page = Math.max(1, Math.floor(listEl.clientHeight / (lineHeight * 4)));
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
  }

  function setScope(id: ScopeId): void {
    if (id === scopeId && field.value === '') return;
    scopeId = id;
    sortChoice = null;
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
    heading.append(titleEl, blurbEl);
    scopeNav = el('nav', 'marxy-library-scopes');
    scopeNav.setAttribute('aria-label', 'Scopes');
    head.append(heading, scopeNav);

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
    search.append(field, suggestEl, chipsEl);

    const bar = el('div', 'marxy-library-bar');
    statusEl = el('div', 'marxy-library-status');
    statusEl.setAttribute('role', 'status');
    const sortLabel = el('label', 'marxy-library-sort', 'Sort ');
    sortEl = el('select');
    sortEl.setAttribute('aria-label', 'Sort results by');
    sortLabel.append(sortEl);
    bar.append(statusEl, sortLabel);

    const body = el('div', 'marxy-library-body');
    listEl = el('div', 'marxy-library-results');
    listEl.tabIndex = 0;
    listEl.setAttribute('role', 'listbox');
    listEl.setAttribute('aria-label', 'Results');
    rowsEl = el('div', 'marxy-library-rows');
    listEl.append(rowsEl);
    previewEl = el('aside', 'marxy-library-preview');
    previewEl.setAttribute('aria-label', 'Preview');
    body.append(listEl, previewEl);

    probeLine = el('span', 'marxy-library-probe marxy-library-probe-line');
    probePad = el('span', 'marxy-library-probe marxy-library-probe-pad');
    section.append(head, search, bar, body, probeLine, probePad);

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
      field.focus();
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

/** Whether the library is showing now: what `library.open` asks to leave it alone. */
export const libraryIsOpen = (): boolean => current?.controller.isOpen === true && current.handle === appHandle();
