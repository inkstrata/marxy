// An archive's page: one sentence that says what it is, the
// plan (its contents to scale, pictures as themselves), the entries (a list, windowed, each saying what it reads as), and
// the preview's head for the entry under the cursor (slice A3 fills the body under it). Listed by the shell from the
// archive's directory or headers, never extracted: an entry's first 4 KB is asked for only as its row comes into view, a
// picture up to 4 MB is unpacked into memory to be drawn small and let go. The cursor walks the entries (j k, l into a
// folder, h out, z folds) and o opens one into memory in a tab of its own. Source is the hex view.
import { accountBeside } from '../frame/account.ts';
import {
  ENTRY_OPEN_CAP,
  archiveLede,
  archiveSums,
  archiveTree,
  careSentence,
  entryBar,
  entryDate,
  initialFolds,
  largestEntries,
  ratioWords,
  shortSize,
  sortedKids,
  visibleRows,
  wrapOf,
  type ArchiveNode,
  type ArchiveRow,
} from '@marxy/core/src/viewer/archive.ts';
import { careOf, type CareSaid } from '@marxy/core/src/viewer/archive-care.ts';
import { filterMatches, parseArchiveFilter, type ArchiveFilter } from '@marxy/core/src/viewer/archive-filter.ts';
import { archivePlan, type PlanCell, type PlanInput } from '@marxy/core/src/viewer/archive-plan.ts';
import { ENCRYPTED_READING, READING_HEAD_BYTES, readingByName, readingOfHead, type EntryReading } from '@marxy/core/src/viewer/archive-reading.ts';
import { magicOf } from '@marxy/core/src/viewer/bytes.ts';
import { FILE_TYPES } from '@marxy/core/src/kind/registry.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { ArchiveEntry, ArchiveListing } from '@marxy/shell-api';
import type { AppShell } from '../app-types.ts';
import { appHandle } from '../commands/app-handle.ts';
import { el, factRow } from '../frame/dom.ts';
import { intend } from '../frame/intent.ts';
import { setMarked, spokenText } from '../frame/model/metadata-marks.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { notify } from '../notices/index.ts';
import { heldEntry, holdEntry, holdPreview, promotePreview, releasePreviews } from '../document/entries.ts';
import { entryShell } from './archive-entries.ts';
import { EMBED_LINK, createEmbed, type Embed } from './embed.ts';
import { archiveReveal } from './archive-reveal.ts';
import { partsGoTo, partsHere } from '../parts/cursor.ts';
import { createSheet, entriesSwitch, folderTiles, mostlyPictures, type EntriesAs, type FolderTiles, type Sheet, type TileDeps } from './archive-sheet.ts';
import { fileCardElement } from './card.ts';
import { byteCard, factsCard, readingCard } from './cards.ts';
import type { ViewedFile } from './file.ts';
import { asItIs, listingExport } from './exports.ts';
import { createHexView, type HexView } from './hex.ts';
import { nextViewerId, viewerChanged } from './signal.ts';
import type { PaneViewer, PartTree, PartUnit, ViewerPlace, ViewerRows, ViewMode } from './types.ts';
import { treeParts } from '../parts/moves.ts';
import { appendAll } from '@marxy/core/src/util/spread.ts';

const n2 = (n: number): string => n.toLocaleString('en-GB');
const plural = (n: number, one: string, many = `${one}s`): string => `${n2(n)} ${n === 1 ? one : many}`;
const cap1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A row's height, as frame.css draws it: the window of rows is placed by it. */
const ROW_H = 26;
/** Rows drawn above and below the view. */
const OVERSCAN = 30;
/** An archive of up to this many files is read whole at open (its readings, its lede); a larger one as its rows show. */
const READ_ALL_UNDER = 500;
/** Heads asked for in one call. */
const HEADS_A_CALL = 200;
/** A picture is drawn in the plan from bytes up to this size, two at a time. */
const PICTURE_CAP = 4 * 1024 * 1024;
const PICTURES_AT_ONCE = 2;
/** The longest side a picture is kept at once drawn small. */
const PICTURE_SIDE = 320;
/** The preview follows the cursor once it has rested this long, as the Line's preview does. */
const PREVIEW_PAUSE = 120;
/** A text entry's preview reads its beginning, this much; a kind read from bytes is read whole, up to ENTRY_OPEN_CAP. */
const PREVIEW_TEXT = 256 * 1024;
/** What a text entry's reading says it is, when no registry row names it. */
const TEXT_LABELS = new Set(['plain text', 'a log', 'text, set as written', 'empty']);

const ONE_STREAM: Readonly<Record<string, string>> = { gz: 'gzip', bz2: 'bzip2', xz: 'xz', zst: 'Zstandard' };

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Bytes that begin as text: no format's magic, no NUL. */
const textHead = (b: Uint8Array): boolean => magicOf(b.subarray(0, 8192)) === null && !b.subarray(0, 8192).includes(0);

type Scale = 'unpacked' | 'packed';

interface Kept {
  folded: Set<string>;
  asCard: boolean;
  scale: Scale;
  /** The entries as a list or a sheet: set once at the first open, by whether it is mostly pictures. */
  as?: EntriesAs;
  /** The Line's `=`: the query the entries are kept by, as written. */
  filter?: string;
}

// The folds, the scale, the floor and the filter, kept for the archive while the app runs (memory only, never written).
const kept = new Map<string, Kept>();

export interface ArchiveOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  readonly listing: ArchiveListing;
  /** The pane's section: an entry opens in a new tab of this pane. */
  readonly paneHost: HTMLElement;
  /** Where the reader was in the page this one replaces (the archive changed on disk). */
  readonly place?: ViewerPlace;
  /** Drawn as another archive's preview: compact, no preview of its own, and opening an entry opens this archive. */
  readonly embed?: { open(): void };
  /** Why a file with a reading of its own (a book) is shown as its archive: said first in the lede. */
  readonly said?: string;
}

/** Why an entry cannot open, as a sentence for a refusal said on Enter or a press of its Open. */
function refusalOf(e: ArchiveEntry): string | null {
  const name = basename(e.path.replace(/\/$/, ''));
  if (e.kind === 'link') return `${name} is a link${e.link ? ` to ${e.link}` : ''}: links in an archive are not followed.`;
  if (e.kind === 'other') return `${name} is not a file: a device, a pipe or the like.`;
  if (e.encrypted) return 'This entry is encrypted. The app does not ask for archive passwords.';
  if (e.method) return `${name} is compressed with ${e.method}, which the app does not read.`;
  if (e.size !== null && e.size > ENTRY_OPEN_CAP) {
    return `${name} is ${shortSize(e.size)} unpacked, over the ${shortSize(ENTRY_OPEN_CAP)} an entry may open with. Open the archive in your default app to extract it.`;
  }
  return null;
}

const PICTURE_TYPES: Readonly<Record<string, string>> = { PNG: 'image/png', JPEG: 'image/jpeg', GIF: 'image/gif', WebP: 'image/webp', BMP: 'image/bmp', ICO: 'image/x-icon', AVIF: 'image/avif' };

export function createArchiveViewer(o: ArchiveOptions): PaneViewer {
  const { shell, file, listing, paneHost } = o;
  const path = file.path;
  const tree = archiveTree(listing.entries);
  const sums = archiveSums(listing);
  const wrap = wrapOf(tree);
  const top = wrap ?? tree;
  const lede = archiveLede(listing, tree);
  // A gzip (or bzip2, xz) of one file reads as that file: a sentence says what wraps it, and the page is the file's.
  const single = listing.entries.length === 1 && listing.entries[0]!.kind === 'file' && /^(gz|bz2|xz|zst)$/.test(listing.format);
  // Inside another archive's preview there is no preview of its own, but a lone gzip's one file is still read as itself.
  const compact = o.embed !== undefined && !single;
  const packedKnown = listing.entries.some((e) => e.kind === 'file') && listing.entries.every((e) => e.kind !== 'file' || e.packed !== null);
  const state: Kept = kept.get(path) ?? { folded: initialFolds(top, listing.entries.length), asCard: false, scale: 'unpacked' };
  if (!packedKnown) state.scale = 'unpacked';
  kept.set(path, state);
  if (kept.size > 50) kept.delete(kept.keys().next().value!);

  // Every node by its id: a folder's path, a file's path, and a second entry of one path its path and index.
  const ids = new Map<ArchiveNode, string>();
  const nodes = new Map<string, ArchiveNode>();
  const parentOf = new Map<ArchiveNode, ArchiveNode>();
  const byIndex = new Map<number, ArchiveNode>();
  (function index(n: ArchiveNode): void {
    for (const k of n.kids.values()) {
      parentOf.set(k, n);
      const id = nodes.has(k.path) ? `${k.path}#${k.entry?.index ?? ''}` : k.path;
      ids.set(k, id);
      nodes.set(id, k);
      if (k.entry) byIndex.set(k.entry.index, k);
      if (k.dir) index(k);
    }
  })(tree);
  const idOf = (n: ArchiveNode): string => ids.get(n) ?? n.path;
  /** A path as the page says it: inside the one folder that holds everything. */
  const shown = (p: string): string => (wrap && p.startsWith(wrap.path) ? p.slice(wrap.path.length) : p);

  let host: HTMLElement | null = null;
  let mode: ViewMode = 'rendered';
  const id = nextViewerId();
  let hex: HexView | null = null;
  const pane = (): HTMLElement | undefined => host?.closest<HTMLElement>('section.marxy-pane') ?? paneHost;
  const ensureHex = (): HexView => (hex ??= createHexView(file, (offset, length) => shell.readRange(path, offset, length)));
  if (o.place?.hex) ensureHex().restore(o.place.hex);
  let scrollBack = o.place?.scroll?.top ?? null;
  let alive = true;

  // ---- readings and care ------------------------------------------------------------------------------------------

  const readings = new Map<number, EntryReading>();
  const byName = new Map<number, EntryReading>();
  const asked = new Set<number>();
  const pending = new Set<number>();
  let care: ReadonlyMap<number, readonly CareSaid[]> = careOf(listing, readings);
  let rev = 0;
  for (const e of listing.entries) if (e.encrypted && e.kind === 'file') readings.set(e.index, ENCRYPTED_READING);

  /** What an entry reads as now: from its bytes once they came, by its name before. */
  function readingOf(e: ArchiveEntry): EntryReading {
    const got = readings.get(e.index);
    if (got) return got;
    let r = byName.get(e.index);
    if (!r) {
      r = e.kind === 'link' ? { ...readingByName(e.path), label: 'a link, not followed', group: 'Links' } : readingByName(e.path);
      byName.set(e.index, r);
    }
    return r;
  }

  // By name: at the first open no bytes are read yet.
  state.as ??= mostlyPictures(listing, readingOf) ? 'sheet' : 'list';

  let flushing = false;
  let flushTimer = 0;
  function want(indices: Iterable<number>): void {
    for (const i of indices) {
      const e = listing.entries[i];
      if (!e || e.kind !== 'file' || readings.has(i) || asked.has(i)) continue;
      pending.add(i);
    }
    if (pending.size > 0 && !flushTimer && !flushing) flushTimer = window.setTimeout(() => void flush(), 30);
  }

  async function flush(): Promise<void> {
    flushTimer = 0;
    if (flushing || !alive) return;
    flushing = true;
    try {
      while (pending.size > 0 && alive) {
        const batch = [...pending].slice(0, HEADS_A_CALL);
        for (const i of batch) {
          pending.delete(i);
          asked.add(i);
        }
        const heads = await shell.readArchiveHeads(path, batch.map((i) => ({ index: i, name: listing.entries[i]!.path })), READING_HEAD_BYTES).catch(() => []);
        if (!alive) return;
        const got = new Set<number>();
        for (const h of heads) {
          const e = listing.entries[h.index];
          if (!e) continue;
          got.add(h.index);
          readings.set(h.index, h.refused ? readingByName(e.path) : readingOfHead(e.path, h.bytes));
        }
        // Left out past the call's budget: asked again with the next rows that show.
        for (const i of batch) if (!got.has(i) && heads.length > 0) asked.delete(i);
        care = careOf(listing, readings);
        rev++;
        refreshAll();
      }
    } finally {
      flushing = false;
    }
  }

  // ---- the page's parts -------------------------------------------------------------------------------------------

  let page: HTMLElement | null = null;
  let ledeEl: HTMLElement | null = null;
  let planEl: HTMLElement | null = null;
  let underEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let rowsEl: HTMLElement | null = null;
  let headEl: HTMLElement | null = null;
  let rows: ArchiveRow[] = [];
  let rowAt = new Map<string, number>();
  let drawnFrom = -1;
  let drawnTo = -1;
  const drawnRows = new Map<string, HTMLElement>();
  let headId: string | null = null;
  let runIds = new Set<string>();
  let observer: ResizeObserver | null = null;
  let frame = 0;

  function computeRows(): void {
    rows = visibleRows(top, state.folded);
    if (matched) rows = rows.filter((r) => keeps(r.node));
    rowAt = new Map(rows.map((r, i) => [idOf(r.node), i]));
  }

  // ---- the filter (the Line's `=`): matching files and the folders that hold them; kept in the view only ----------

  // Inside another archive's preview the page is the archive as it is: a filter is the tab's.
  const filterable = !single && !o.embed && listing.entries.length > 0;
  let filter: ArchiveFilter | null = null;
  /** The files matching, and for each folder how many of them it holds; null with no filter. */
  let matched: Set<ArchiveNode> | null = null;
  const holding = new Map<ArchiveNode, number>();
  const fileNodes = [...nodes.values()].filter((n) => !n.dir && n.entry);

  /** A node the filter keeps: a matching file, or a folder that holds one. */
  const keeps = (n: ArchiveNode): boolean => !matched || (n.dir ? (holding.get(n) ?? 0) > 0 : matched.has(n));

  function matchesOf(f: ArchiveFilter): Set<ArchiveNode> {
    return new Set(fileNodes.filter((n) => filterMatches(f, n.entry!, readingOf(n.entry!))));
  }

  /** The filter's sets worked out again; true when what it keeps changed. */
  function computeMatches(): boolean {
    const was = matched;
    matched = filter ? matchesOf(filter) : null;
    holding.clear();
    for (const n of matched ?? []) for (let up = parentOf.get(n); up; up = parentOf.get(up)) holding.set(up, (holding.get(up) ?? 0) + 1);
    if (!was || !matched) return was !== matched;
    return was.size !== matched.size || [...matched].some((n) => !was.has(n));
  }

  function dimCells(): void {
    cells.forEach((c, i) => {
      let n: ArchiveNode | undefined;
      if (c.kind === 'file') n = byIndex.get(c.index!);
      else {
        const full = wrap ? wrap.path + c.path : c.path;
        n = full === '' || full === wrap?.path ? top : nodes.get(full);
      }
      cellEls[i]?.classList.toggle('marxy-arch-cell-dim', matched !== null && (!n || !keeps(n)));
    });
  }

  /** The filter's words in the lede: "Showing 3 of 25 files, matching name:.rs." */
  function filterWords(): string | null {
    if (!matched || !filter) return null;
    return `Showing ${n2(matched.size)} of ${plural(fileNodes.length, 'file')}, matching “${filter.text}”.`;
  }

  /** The page drawn again for the filter as it is now; the cursor stays on its entry when kept, else the first match. */
  function filterChanged(asked: boolean): void {
    // The cursor's own head when it is on this page: the page's note of it can lag a move the cursor could not make.
    const here = partsHere();
    const unit = here && here.tree === partsTree && here.head ? entryUnitOf(here.head) : null;
    const head = unit ? nodes.get(unit.id) : headId ? nodes.get(headId) : undefined;
    partsTree = null;
    drawLede();
    if (host && mode === 'rendered' && !state.asCard && page) {
      if (asked && listEl) listEl.scrollTop = 0;
      drawList();
      dimCells();
    }
    viewerChanged();
    // Readings that came since change what `reading:` keeps: the cursor moves only if its entry went.
    if (!asked && (!head || keeps(head))) return;
    // Every entry shown again: a cursor that was set stays where it was; none is set.
    if (!matched && !head) return;
    const first = visibleRows(top, new Set()).find((r) => !r.node.dir && keeps(r.node))?.node;
    const to = head && keeps(head) ? head : first;
    if (to) setTimeout(() => partsGoTo(idOf(to)), 0);
  }

  // Esc lets the filter go, before the cursor lets go (as a log's level filter takes it): only in this page, focused, with
  // no field, menu or dialog over it (the Escape that closes the Line is the Line's).
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !filter || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (!host || mode !== 'rendered' || state.asCard || appHandle()?.panes().focused?.content.viewer() !== self) return;
    const t = e.target instanceof Element ? e.target : null;
    // A closed Line keeps the focus in its field until the page takes it: that field is not one being typed in.
    if (document.querySelector('dialog[open], .marxy-verb-menu')) return;
    if (!t?.closest('dialog:not([open])') && t?.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]')) return;
    e.preventDefault();
    e.stopPropagation();
    setFilter(null);
  };

  function setFilter(query: string | null): number {
    const f = query === null ? null : parseArchiveFilter(query);
    if (f && 'error' in f) return 0;
    filter = f;
    state.filter = f?.text;
    if (f) document.addEventListener('keydown', onEscape, true);
    else document.removeEventListener('keydown', onEscape, true);
    computeMatches();
    filterChanged(true);
    return matched?.size ?? fileNodes.length;
  }

  if (filterable && state.filter) {
    const f = parseArchiveFilter(state.filter);
    filter = 'error' in f ? null : f;
    if (filter) document.addEventListener('keydown', onEscape, true);
    computeMatches();
  }

  const rowFilter: ViewerRows = {
    filter: (q) => setFilter(q),
    clear: () => void setFilter(null),
    on: () => filter?.text ?? null,
    test(q) {
      const f = parseArchiveFilter(q);
      if ('error' in f) return f;
      return { shown: matchesOf(f).size, total: fileNodes.length, words: fileNodes.length === 1 ? 'file' : 'files' };
    },
  };

  // ---- the lede ---------------------------------------------------------------------------------------------------

  function drawLede(): void {
    if (!ledeEl) return;
    ledeEl.replaceChildren();
    if (o.said) ledeEl.append(el('span', 'marxy-arch-said', o.said), ' ');
    if (lede.files === 0 && listing.entries.length === 0) {
      ledeEl.append(`${lede.form} with nothing in it: it holds no entries. ${shortSize(lede.inFile)} in the file.`);
      return;
    }
    if (single) {
      const e = listing.entries[0]!;
      const b = el('b', 'marxy-arch-wrap');
      setMarked(b, e.path);
      const unpacked = e.size === null ? 'its unpacked size not said' : `${shortSize(e.size)} unpacked`;
      ledeEl.append(`A ${ONE_STREAM[listing.format] ?? listing.format} stream of one file: `, b, `. ${shortSize(listing.size)} in the file, ${unpacked}. It is read below as what it is.`);
      return;
    }
    ledeEl.append(`${lede.form}: ${plural(lede.files, 'file')}${lede.folders > 0 ? ` in ${plural(lede.folders, 'folder')}` : ''}`);
    if (lede.wrap) {
      const b = el('b', 'marxy-arch-wrap');
      setMarked(b, lede.wrap);
      ledeEl.append(', all inside ', b);
    }
    const unpacked = sums.unknownSize && sums.unpacked === 0 ? 'its unpacked size not said' : `${shortSize(lede.unpacked)} unpacked`;
    ledeEl.append(`. ${shortSize(lede.inFile)} in the file, ${unpacked}.`);
    if (lede.shape) ledeEl.append(` It reads like ${lede.shape.what}: ${lede.shape.by} is at its root.`);
    if (lede.comment) ledeEl.append(` Its comment: “${lede.comment}”`);
    let encrypted = 0;
    let careful = 0;
    for (const [i, list] of care) {
      if (listing.entries[i]?.encrypted) encrypted++;
      if (list.some((c) => c.care !== 'encrypted')) careful++;
    }
    const warn = careSentence(encrypted, careful);
    if (warn) ledeEl.append(' ', el('span', 'marxy-arch-warn', warn));
    const showing = filterWords();
    if (showing) ledeEl.append(' ', el('span', 'marxy-arch-showing', showing));
  }

  // ---- the plan ---------------------------------------------------------------------------------------------------

  let cells: PlanCell[] = [];
  const cellEls: HTMLElement[] = [];
  const pictures = new Map<number, HTMLCanvasElement>();
  const picQueue: number[] = [];
  const picAsked = new Set<number>();
  let picsRunning = 0;
  const urls = new Set<string>();

  const planInputs: PlanInput[] = listing.entries.map((e) => ({
    path: shown(e.path),
    size: e.size ?? 0,
    packed: e.packed ?? e.size ?? 0,
    isDir: e.kind === 'dir',
    index: e.index,
  }));

  /** The cell that stands for `n`: its own, else the gathered cell of its folder, else the nearest folder's. */
  function cellOf(n: ArchiveNode): number {
    if (!n.dir && n.entry) {
      const own = cells.findIndex((c) => c.kind === 'file' && c.index === n.entry!.index);
      if (own >= 0) return own;
      const folder = shown(n.path.slice(0, n.path.lastIndexOf('/') + 1));
      const gathered = cells.findIndex((c) => c.kind === 'gathered' && c.path === folder);
      if (gathered >= 0) return gathered;
    }
    for (let at: ArchiveNode | undefined = n; at && at !== top; at = parentOf.get(at)) {
      if (!at.dir) continue;
      const p = shown(at.path);
      const hit = cells.findIndex((c) => c.kind === 'folder' && c.path === p);
      if (hit >= 0) return hit;
    }
    return -1;
  }

  function drawPlan(): void {
    if (!planEl) return;
    const box = { w: planEl.clientWidth, h: planEl.clientHeight };
    cells = archivePlan(planInputs, box, { scale: state.scale });
    cellEls.length = 0;
    planEl.replaceChildren();
    for (const c of cells) {
      const cell = el('div', 'marxy-arch-cell');
      cell.style.left = `${c.x}px`;
      cell.style.top = `${c.y}px`;
      cell.style.width = `${c.w}px`;
      cell.style.height = `${c.h}px`;
      const full = c.kind === 'gathered' ? c.path : wrap ? wrap.path + c.path : c.path;
      const n = c.kind === 'file' ? byIndex.get(c.index!) : c.kind === 'folder' ? nodes.get(full) : undefined;
      const e = c.kind === 'file' ? listing.entries[c.index!] : undefined;
      if (c.kind === 'folder') cell.classList.add(c.frame ? 'marxy-arch-cell-frame' : 'marxy-arch-cell-folder');
      if (c.kind === 'gathered') cell.classList.add('marxy-arch-cell-more');
      if (e?.encrypted) cell.classList.add('marxy-arch-cell-enc');
      else if (e && care.has(e.index)) cell.classList.add('marxy-arch-cell-warn');
      const name = c.kind === 'gathered' ? `${n2(c.count)} more` : c.kind === 'folder' ? `${basename(c.path.replace(/\/$/, ''))}/` : basename(c.path);
      cell.title = `${c.kind === 'gathered' ? `${plural(c.count, 'small thing')} in ${shown(c.path) || 'the top'}` : spokenText(shown(full))}, ${shortSize(c.bytes)}`;
      const pic = c.kind === 'file' ? pictures.get(c.index!) : undefined;
      if (pic) {
        cell.classList.add('marxy-arch-cell-pic');
        cell.append(pic);
      } else if (c.w >= 46 && c.h >= 15) {
        const label = el('b', 'marxy-arch-cell-name');
        setMarked(label, name);
        cell.append(label);
        if (c.w >= 60 && (c.frame ? c.w >= 120 : c.h >= 32)) cell.append(el('i', 'marxy-arch-cell-size', shortSize(c.bytes)));
      }
      cell.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const target = n ?? (c.kind === 'gathered' ? (nodes.get(wrap ? wrap.path + c.path : c.path) ?? null) : null);
        if (!target) return;
        // After the press is done, as a click on a row: the pane is focused by then, and the cursor speaks for it.
        setTimeout(() => partsGoTo(idOf(target)), 0);
      });
      cellEls.push(cell);
      planEl!.append(cell);
      if (e && readingOf(e).picture) wantPicture(e.index);
    }
    dimCells();
    litCell();
    drawUnder();
  }

  function litCell(): void {
    for (const c of cellEls) c.classList.remove('marxy-arch-cell-on');
    const n = headId ? nodes.get(headId) : undefined;
    reveal.lit(n?.entry?.index ?? null);
    if (!n) return;
    const at = cellOf(n);
    if (at >= 0) cellEls[at]?.classList.add('marxy-arch-cell-on');
  }

  function wantPicture(index: number): void {
    const e = listing.entries[index];
    if (!e || picAsked.has(index) || pictures.has(index) || e.encrypted || e.size === null || e.size > PICTURE_CAP) return;
    picAsked.add(index);
    picQueue.push(index);
    pumpPictures();
  }

  function pumpPictures(): void {
    while (picsRunning < PICTURES_AT_ONCE && picQueue.length > 0 && alive) {
      const index = picQueue.shift()!;
      picsRunning++;
      void drawPicture(index).finally(() => {
        picsRunning--;
        pumpPictures();
      });
    }
  }

  /** Unpacked into memory, drawn small onto a canvas, and the bytes and their URL let go. */
  async function drawPicture(index: number): Promise<void> {
    const e = listing.entries[index]!;
    let bytes: Uint8Array | null = await shell.readArchiveEntry(path, index, e.path).catch(() => null);
    if (!bytes || !alive) return;
    const svg = /\.svg$/i.test(e.path);
    const type = svg ? 'image/svg+xml' : PICTURE_TYPES[magicOf(bytes)?.format ?? ''];
    if (!type) return;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    bytes = null;
    urls.add(url);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!alive) return;
      const w = img.naturalWidth || PICTURE_SIDE;
      const h = img.naturalHeight || PICTURE_SIDE;
      const k = Math.min(1, PICTURE_SIDE / Math.max(w, h));
      const canvas = el('canvas', 'marxy-arch-pic');
      canvas.width = Math.max(1, Math.round(w * k));
      canvas.height = Math.max(1, Math.round(h * k));
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      pictures.set(index, canvas);
      const at = cells.findIndex((c) => c.kind === 'file' && c.index === index);
      const cell = at >= 0 ? cellEls[at] : undefined;
      if (cell) {
        cell.classList.add('marxy-arch-cell-pic');
        cell.replaceChildren(canvas);
      }
    } catch {
      // A picture the webview cannot draw keeps its name in the plan.
    } finally {
      URL.revokeObjectURL(url);
      urls.delete(url);
    }
  }

  function drawUnder(): void {
    if (!underEl) return;
    underEl.replaceChildren();
    const files = listing.entries.filter((e) => e.kind === 'file');
    const value = (e: ArchiveEntry): number => (state.scale === 'packed' ? (e.packed ?? 0) : (e.size ?? 0));
    const total = files.reduce((s, e) => s + value(e), 0);
    const big = files.reduce<ArchiveEntry | null>((a, b) => (a === null || value(b) > value(a) ? b : a), null);
    const cap = el('span', 'marxy-arch-cap', `To scale by what each thing ${state.scale === 'packed' ? 'takes in the file' : 'unpacks to'}.`);
    if (big && files.length > 1 && total > 0) {
      const nm = el('span', 'marxy-arch-capname');
      setMarked(nm, shown(big.path));
      cap.append(' The largest is ', nm, `, ${Math.round((value(big) / total) * 100)}% of it.`);
    }
    underEl.append(cap, el('span', 'marxy-arch-gap'));
    if (!packedKnown) return entriesSwitch(underEl, state.as!, setAs);
    underEl.append(el('span', 'marxy-arch-ctl', 'to scale by'));
    for (const [scale, words] of [['unpacked', 'unpacked'], ['packed', 'in the file']] as const) {
      const b = el('button', 'marxy-arch-opt', words);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.scale === scale));
      b.addEventListener('click', () => {
        if (state.scale === scale) return;
        state.scale = scale;
        drawPlan();
      });
      underEl.append(b);
    }
    entriesSwitch(underEl, state.as!, setAs);
  }

  // ---- the entries ------------------------------------------------------------------------------------------------

  function rowWords(n: ArchiveNode): { text: string; warn: boolean } {
    if (n.dir) return { text: matched ? `${n2(holding.get(n) ?? 0)} of ${plural(n.files, 'file')}` : plural(n.files, 'file'), warn: false };
    const e = n.entry!;
    const r = readingOf(e);
    const said = care.get(e.index) ?? [];
    const parts: string[] = [];
    if (r.disagrees) parts.push(`${r.label}, not ${r.ext ? `a .${r.ext}` : 'its name'}`);
    for (const c of said) if (c.care !== 'not-its-name' && !(c.care === 'encrypted' && r.encrypted && parts.includes('encrypted'))) parts.push(c.words);
    if (parts.length === 0) parts.push(r.label);
    return { text: [...new Set(parts)].join(', '), warn: said.length > 0 };
  }

  function rowEl(r: ArchiveRow, i: number): HTMLElement {
    const { node, depth } = r;
    const rid = idOf(node);
    const row = el('div', node.dir ? 'marxy-arow marxy-arow-dir' : 'marxy-arow');
    row.setAttribute('role', 'row');
    row.setAttribute('aria-level', String(depth + 1));
    row.setAttribute('aria-selected', String(rid === headId));
    if (rid === headId) row.classList.add('marxy-cursor');
    if (runIds.has(rid)) row.classList.add('marxy-selected');
    row.style.top = `${i * ROW_H}px`;
    const nm = el('span', 'marxy-arch-nm');
    nm.setAttribute('role', 'gridcell');
    nm.style.setProperty('--marxy-arch-depth', String(depth));
    const name = el('span', 'marxy-arch-name');
    if (node.dir) {
      const open = !state.folded.has(node.path);
      row.setAttribute('aria-expanded', String(open));
      const tw = el('button', 'marxy-arch-tw');
      tw.type = 'button';
      tw.tabIndex = -1;
      tw.setAttribute('aria-expanded', String(open));
      tw.setAttribute('aria-label', `${open ? 'Fold' : 'Unfold'} ${node.name}`);
      tw.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggle(node);
      });
      nm.append(tw);
      setMarked(name, `${node.name}/`);
    } else setMarked(name, node.name);
    nm.append(name);
    const words = rowWords(node);
    const reads = el('span', words.warn ? 'marxy-arch-reads marxy-arch-warn' : 'marxy-arch-reads', words.text);
    reads.setAttribute('role', 'gridcell');
    const sz = el('span', 'marxy-arch-sz');
    sz.setAttribute('role', 'gridcell');
    const bar = el('span', 'marxy-arch-bar');
    const fill = el('i');
    const size = node.dir ? node.size : (node.entry?.size ?? 0);
    fill.style.width = sums.unpacked > 0 && size > 0 ? `${Math.max(2, (size / sums.unpacked) * 100).toFixed(1)}%` : '0';
    bar.append(fill);
    sz.append(bar, node.dir || node.entry?.size !== null ? shortSize(size) : 'not said');
    row.append(nm, reads, sz, ...reveal.cells(node.entry ?? null));
    row.addEventListener('dblclick', () => {
      if (node.dir) toggle(node);
      else if (node.entry) void openEntry(node.entry);
    });
    return row;
  }

  /** The rows near the view, drawn into the list's sizer; the rest are not in the page. */
  function drawWindow(force = false): void {
    if (!listEl || !rowsEl) return;
    const height = listEl.clientHeight || 800;
    const from = Math.max(0, Math.floor(listEl.scrollTop / ROW_H) - OVERSCAN);
    const to = Math.min(rows.length, Math.ceil((listEl.scrollTop + height) / ROW_H) + OVERSCAN);
    if (!force && from === drawnFrom && to === drawnTo) return;
    drawnFrom = from;
    drawnTo = to;
    drawnRows.clear();
    const out: HTMLElement[] = [];
    const files: number[] = [];
    for (let i = from; i < to; i++) {
      const r = rows[i]!;
      const row = rowEl(r, i);
      drawnRows.set(idOf(r.node), row);
      out.push(row);
      if (!r.node.dir && r.node.entry) files.push(r.node.entry.index);
    }
    rowsEl.replaceChildren();
    appendAll(rowsEl, out);
    want(files);
  }

  function drawList(): void {
    if (sheet) {
      computeRows();
      sheet.layout();
      return;
    }
    if (!rowsEl) return;
    computeRows();
    rowsEl.style.height = `${rows.length * ROW_H}px`;
    drawWindow(true);
  }

  function toggle(n: ArchiveNode): void {
    if (state.folded.has(n.path)) state.folded.delete(n.path);
    else state.folded.add(n.path);
    drawList();
  }

  // ---- the preview's head -----------------------------------------------------------------------------------------

  /** The entry the preview shows with no cursor: the README at the top, else the first file. */
  function firstShown(): ArchiveNode | null {
    for (const k of top.kids.values()) if (!k.dir && /^readme(\.|$)/i.test(k.name)) return k;
    const first = visibleRows(top, new Set()).find((r) => !r.node.dir);
    return first?.node ?? null;
  }

  function packedWords(e: ArchiveEntry): string {
    if (e.packed === null || e.size === null) return '';
    if (e.size === 0) return 'empty';
    if (e.packed === e.size) return 'stored as it is';
    const pct = (e.packed / e.size) * 100;
    return `packed to ${n2(e.packed)} (${pct < 1 ? 'under 1' : Math.round(pct)}%)`;
  }

  function drawHead(): void {
    if (!headEl) return;
    headEl.replaceChildren();
    const n = (headId ? nodes.get(headId) : null) ?? firstShown();
    if (!n) return;
    const where = el('div', 'marxy-arch-ppath');
    const rel = shown(n.path).replace(/\/$/, '');
    const dir = rel.slice(0, rel.lastIndexOf('/') + 1);
    if (dir) {
      const d = el('span', 'marxy-arch-pdir');
      setMarked(d, dir);
      where.append(d);
    }
    const b = el('b', 'marxy-arch-pname');
    setMarked(b, n.dir ? `${n.name}/` : n.name);
    where.append(b);
    headEl.append(where);
    const facts: string[] = [];
    if (n.dir) {
      facts.push('A folder', `${plural(n.files, 'file')}, ${shortSize(n.size)} unpacked`);
      if (n.entry?.mtime) facts.push(entryDate(n.entry.mtime));
      else facts.push('named only in the paths of what it holds');
    } else {
      const e = n.entry!;
      const r = readingOf(e);
      facts.push(cap1(r.disagrees ? `${r.label}, not ${r.ext ? `a .${r.ext}` : 'its name'}` : r.label));
      facts.push(e.size === null ? 'its size not said' : plural(e.size, 'byte'));
      const packed = packedWords(e);
      if (packed) facts.push(packed);
      if (e.mtime) facts.push(entryDate(e.mtime));
      const bar = e.encrypted ? null : entryBar(e);
      if (bar) facts.push(bar);
      // Unpacked whole to be shown, the shell checked its size and checksum on the way: a beginning alone says nothing.
      if (shown_ && shown_.index === e.index && shown_.whole && e.crc !== null) facts.push('checksum agrees');
    }
    headEl.append(el('div', 'marxy-arch-pfacts', facts.join(' · ')));
    const rec = n.entry ? reveal.record(n.entry) : null;
    if (rec) headEl.append(rec);
    for (const c of (n.entry && care.get(n.entry.index)) ?? []) headEl.append(el('div', 'marxy-arch-pwarn', c.sentence));
  }

  // ---- the preview's body ----------------------------------------------------------------------------------------

  let bodyEl: HTMLElement | null = null;
  let embed: Embed | null = null;
  /** The element the shown embed is drawn in, inside the body. */
  let slotEl: HTMLElement | null = null;
  /** The entry the body shows, and whether it was read whole. */
  let shown_: { index: number; whole: boolean } | null = null;
  /** The entry the body is on its way to, while it is read. */
  let coming: number | null = null;
  let previewTimer = 0;
  let previewGen = 0;
  /** Entries read for the preview, by index: their path in the preview pool, and whether all of each is held. */
  const pooled = new Map<number, { path: string; whole: boolean }>();

  /** Whether an entry reads as text, by what its reading says so far: its beginning then is all a preview reads. */
  function textish(e: ArchiveEntry): boolean {
    const r = readingOf(e);
    if (r.encrypted) return false;
    if (r.row === null) return TEXT_LABELS.has(r.label);
    return FILE_TYPES.find((t) => t.id === r.row)?.kind !== 'binary';
  }

  /** The body follows `n` (null: the entry shown with no cursor) once the cursor has rested; `now` skips the pause. */
  function wantPreview(n: ArchiveNode | null, now = false): void {
    if (compact) return;
    const target = n ?? firstShown();
    if (target?.dir) return wantFolder(target, now);
    const e = target && !target.dir ? target.entry : null;
    const index = e?.index ?? null;
    const settled = coming === null && previewTimer === 0;
    if (!settled && coming === index) return;
    if (settled && !folderShown && (shown_?.index ?? null) === index && (index === null || embed)) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = 0;
    const gen = ++previewGen;
    coming = index;
    const go = (): void => {
      previewTimer = 0;
      // A fault reaching an entry (the archive changed, the pool let it go) is said in the body, never left unheard.
      showPreview(e, gen).catch((err: unknown) => bodySays(err instanceof Error ? err.message : String(err), gen));
    };
    if (now) go();
    else previewTimer = window.setTimeout(go, PREVIEW_PAUSE);
  }

  function bodySays(text: string, gen: number): void {
    if (gen !== previewGen || !bodyEl) return;
    dropFolder();
    embed?.destroy();
    embed = null;
    shown_ = null;
    coming = null;
    slotEl = null;
    bodyEl.replaceChildren(el('p', 'marxy-embed-note', text));
    drawHead();
  }

  /** The entry's bytes for its preview: from the pool when held, else read (its beginning, or all of it) and pooled. */
  async function previewBytes(e: ArchiveEntry): Promise<{ path: string; whole: boolean } | string> {
    const got = pooled.get(e.index);
    if (got && heldEntry(got.path)) return got;
    pooled.delete(e.index);
    const fits = e.size !== null && e.size <= ENTRY_OPEN_CAP;
    let bytes: Uint8Array;
    let whole: boolean;
    try {
      if (!textish(e) && fits) {
        bytes = await shell.readArchiveEntry(path, e.index, e.path);
        whole = true;
      } else {
        const [h] = await shell.readArchiveHeads(path, [{ index: e.index, name: e.path }], PREVIEW_TEXT);
        if (!h) return 'It was not read.';
        if (h.refused) return h.refused;
        bytes = h.bytes;
        whole = h.whole;
        // Its beginning says it is not text after all: a picture or a PDF is not read by its beginning, so all of it.
        if (!whole && fits && !textHead(h.bytes)) {
          bytes = await shell.readArchiveEntry(path, e.index, e.path);
          whole = true;
        }
      }
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    const mtimeMs = e.mtime ? Date.parse(e.mtime) : Number.NaN;
    const held = holdPreview({ archive: path, name: e.path, index: e.index, bytes, mtimeMs: Number.isNaN(mtimeMs) ? null : mtimeMs, ...(whole ? {} : { size: e.size ?? bytes.length }) });
    const kept = { path: held.path, whole };
    pooled.set(e.index, kept);
    return kept;
  }

  async function showPreview(e: ArchiveEntry | null, gen: number): Promise<void> {
    if (!alive || gen !== previewGen) return;
    dropFolder();
    if (!e) {
      embed?.destroy();
      embed = null;
      shown_ = null;
      coming = null;
      slotEl = null;
      bodyEl?.replaceChildren();
      drawHead();
      return;
    }
    // Encrypted, a link, a method not read: the head's sentence says it, and there is no body.
    if (e.encrypted || e.kind !== 'file' || e.method) return bodySays('', gen);
    const got = await previewBytes(e);
    if (!alive || gen !== previewGen) return;
    if (typeof got === 'string') return bodySays(got, gen);
    if (!bodyEl) return;
    const wasSlot = slotEl;
    for (const c of [...bodyEl.children]) if (c !== wasSlot) c.remove();
    // Drawn out of sight at the body's size, then shown in the old one's place: never two at once, nor an empty body.
    const slot = el('div', 'marxy-arch-pslot marxy-arch-pslot-coming');
    bodyEl.append(slot);
    const made = await createEmbed({ shell: entryShell(shell), path: got.path, whole: got.whole, host: slot, size: 'page', open: () => void openEntry(e) });
    if (!alive || gen !== previewGen) {
      made.destroy();
      slot.remove();
      return;
    }
    embed?.destroy();
    wasSlot?.remove();
    slot.classList.remove('marxy-arch-pslot-coming');
    slotEl = slot;
    embed = made;
    shown_ = { index: e.index, whole: got.whole };
    coming = null;
    spliceFor = null;
    drawHead();
    viewerChanged();
  }

  /** A link in the preview to another entry of the archive: the cursor goes there. */
  function followLink(ev: Event): void {
    const name = (ev as CustomEvent<{ name: string }>).detail?.name;
    const n = name ? (nodes.get(name) ?? nodes.get(`${name}/`)) : undefined;
    if (n) setTimeout(() => partsGoTo(idOf(n)), 0);
  }

  // ---- the sheet: the entries as tiles; a folder's preview its files' tiles --------------------------------------

  let sheet: Sheet | null = null;
  let folderShown: { id: string; tiles: FolderTiles } | null = null;
  const tileDeps: TileDeps = { shell, path, listing, readingOf, says: rowWords, idOf, go: (tid) => partsGoTo(tid), open: (e) => void openEntry(e), want };

  function setAs(as: EntriesAs): void {
    if (state.as === as) return;
    state.as = as;
    sheet?.destroy();
    sheet = null;
    listEl = null;
    scrollBack = null;
    draw();
    viewerChanged();
  }

  function dropFolder(): void {
    folderShown?.tiles.destroy();
    folderShown?.tiles.el.remove();
    folderShown = null;
  }

  /** The body follows a folder as the preview follows a file: once the cursor rests, its files as tiles. */
  function wantFolder(n: ArchiveNode, now: boolean): void {
    const fid = idOf(n);
    if (previewTimer === 0 && coming === null && folderShown?.id === fid) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = 0;
    const gen = ++previewGen;
    coming = null;
    const go = (): void => {
      previewTimer = 0;
      if (!alive || gen !== previewGen || !bodyEl) return;
      embed?.destroy();
      embed = null;
      shown_ = null;
      slotEl = null;
      dropFolder();
      const tiles = folderTiles(tileDeps, n);
      bodyEl.replaceChildren(tiles.el);
      folderShown = { id: fid, tiles };
      drawHead();
    };
    if (now) go();
    else previewTimer = window.setTimeout(go, PREVIEW_PAUSE);
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------

  /** Readings came: what the rows, the cells and the head say is set in place, so nothing under the pointer is replaced. */
  function refreshAll(): void {
    if (filter?.terms.some((t) => t.by === 'reading') && computeMatches()) filterChanged(false);
    if (!host || mode !== 'rendered' || state.asCard || !page) return;
    drawLede();
    for (const [rid, row] of drawnRows) {
      const n = nodes.get(rid);
      const reads = row.querySelector('.marxy-arch-reads');
      if (!n || !reads) continue;
      const words = rowWords(n);
      reads.textContent = words.text;
      reads.classList.toggle('marxy-arch-warn', words.warn);
    }
    sheet?.refresh();
    cells.forEach((c, i) => {
      const e = c.kind === 'file' ? listing.entries[c.index!] : undefined;
      if (!e) return;
      cellEls[i]?.classList.toggle('marxy-arch-cell-warn', !e.encrypted && care.has(e.index));
      if (readingOf(e).picture) wantPicture(e.index);
    });
    drawHead();
    viewerChanged();
  }

  function archivePage(): HTMLElement {
    const p = el('div', compact ? 'marxy-archpage marxy-archpage-compact' : 'marxy-archpage');
    p.tabIndex = -1;
    page = p;
    dropFolder();
    ledeEl = el('p', 'marxy-arch-lede');
    // The lede is the page's caption; an entry read below (a gzip's one file) carries no account of its own, so this is
    // the page's only one.
    p.append(
      accountBeside(ledeEl, [
        'Nothing is unpacked to disk. An entry opens read-only, held in memory, in a tab of its own.',
        'A link inside the archive is never followed, and an encrypted entry is not read: Marxy does not ask for passwords.',
      ]),
    );
    if (listing.note) p.append(el('p', 'marxy-arch-note', listing.note));
    if (listing.truncated) p.append(el('p', 'marxy-arch-note', listing.truncated));
    if (listing.skipped > 0) {
      p.append(el('p', 'marxy-arch-note', `${n2(listing.skipped)} ${listing.skipped === 1 ? 'entry is' : 'entries are'} not listed: a name past 1,024 characters or 64 folders deep, or one with nothing left once made safe.`));
    }
    drawLede();
    if (listing.entries.length === 0) {
      planEl = underEl = listEl = rowsEl = headEl = bodyEl = null;
      return p;
    }
    if (single) {
      planEl = underEl = listEl = rowsEl = headEl = null;
      const one = el('div', 'marxy-arch-preview marxy-arch-one');
      bodyEl = el('div', 'marxy-arch-pbody');
      bodyEl.addEventListener(EMBED_LINK, followLink);
      if (slotEl) bodyEl.append(slotEl);
      one.append(bodyEl);
      const strip = reveal.strip();
      if (strip) p.append(strip);
      p.append(one);
      return p;
    }
    planEl = el('div', 'marxy-arch-plan');
    planEl.setAttribute('role', 'img');
    planEl.setAttribute('aria-label', `The contents of ${basename(path)} to scale`);
    underEl = el('div', 'marxy-arch-under');
    const body = el('div', 'marxy-arch-body');
    const entries = el('div', 'marxy-arch-entries');
    const cols = el('div', 'marxy-arch-cols');
    cols.setAttribute('aria-hidden', 'true');
    cols.append(el('span', '', 'Name'), el('span', '', 'Reads as'), el('span', 'marxy-arch-sz', 'Size'), ...reveal.cols());
    listEl = el('div', 'marxy-atree');
    listEl.setAttribute('role', 'treegrid');
    listEl.setAttribute('aria-label', `The entries of ${basename(path)}`);
    rowsEl = el('div', 'marxy-arch-rows');
    listEl.append(rowsEl);
    listEl.addEventListener('scroll', () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        drawWindow();
      });
    });
    sheet?.destroy();
    sheet = null;
    // A compact page (an archive previewed inside another) is always a list: tiles inside a preview's tile are too small.
    if (compact) {
      entries.append(cols, listEl);
      headEl = bodyEl = null;
      body.append(entries);
      p.append(planEl, underEl, body);
      computeRows();
      rowsEl.style.height = `${rows.length * ROW_H}px`;
      return p;
    }
    if (state.as === 'sheet') {
      listEl = rowsEl = null;
      sheet = createSheet({ ...tileDeps, top, rows: () => rows, parentOf: (k) => parentOf.get(k) ?? null, isFolded: (k) => state.folded.has(k.path), toggle, shown, matching: (k) => (matched ? (holding.get(k) ?? 0) : null) });
      entries.append(sheet.el);
    } else entries.append(cols, listEl);
    const preview = el('aside', 'marxy-arch-preview');
    preview.setAttribute('aria-label', 'The entry under the cursor');
    headEl = el('header', 'marxy-arch-phead');
    bodyEl = el('div', 'marxy-arch-pbody');
    bodyEl.addEventListener(EMBED_LINK, followLink);
    if (slotEl) bodyEl.append(slotEl);
    preview.append(headEl, bodyEl);
    body.append(entries, preview);
    p.append(planEl, underEl, body);
    const strip = reveal.strip();
    if (strip) underEl.after(strip);
    p.classList.toggle(reveal.pageClass, reveal.switch.on());
    computeRows();
    if (rowsEl) rowsEl.style.height = `${rows.length * ROW_H}px`;
    drawHead();
    return p;
  }

  /** Laid out once the page is in the document: the plan needs its box, the window its height. */
  function settle(): void {
    if (page && bodyEl && !embed) wantPreview(headId ? (nodes.get(headId) ?? null) : null, true);
    if (!page || !planEl) return;
    observer?.disconnect();
    let lastW = -1;
    let lastH = -1;
    observer = new ResizeObserver(() => {
      if (planEl && (planEl.clientWidth !== lastW || planEl.clientHeight !== lastH)) {
        lastW = planEl.clientWidth;
        lastH = planEl.clientHeight;
        drawPlan();
      }
      drawWindow();
    });
    observer.observe(planEl);
    if (listEl) observer.observe(listEl);
    if (scrollBack !== null && listEl) listEl.scrollTop = scrollBack;
    sheet?.settle(scrollBack);
    scrollBack = null;
    drawPlan();
    drawWindow(true);
    if (listing.entries.filter((e) => e.kind === 'file').length <= READ_ALL_UNDER) want(listing.entries.map((e) => e.index));
  }

  async function openEntry(e: ArchiveEntry): Promise<void> {
    if (o.embed) return o.embed.open();
    const refused = refusalOf(e);
    if (refused) {
      notify({ kind: 'refused', text: refused }, { pane: pane() });
      return;
    }
    // Previewed whole already: the pool hands it to the tabs' entries, and nothing is read again.
    const pre = pooled.get(e.index);
    const promoted = pre?.whole ? promotePreview(pre.path) : null;
    let bytes: Uint8Array = promoted?.bytes ?? new Uint8Array(0);
    if (!promoted) try {
      bytes = await shell.readArchiveEntry(path, e.index, e.path);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : String(err);
      notify({ kind: code === 'refused' || code === 'unsupported' ? 'refused' : 'error', text: message }, { pane: pane() });
      return;
    }
    const mtimeMs = e.mtime ? Date.parse(e.mtime) : Number.NaN;
    const entry = promoted ?? holdEntry({ archive: path, name: e.path, index: e.index, bytes, mtimeMs: Number.isNaN(mtimeMs) ? null : mtimeMs });
    const handle = appHandle();
    const at = handle?.panes().panes.find((p) => p.host === paneHost);
    if (!handle || !at) return;
    intend(paneHost, entry.path, 'new');
    // The entry's tab says what it is when it lands (document/open.ts): one notice for the one event.
    await handle.panes().openIn(at.slot, entry.path);
  }

  function cardPage(): HTMLElement {
    const p = el('div', 'marxy-fcpage');
    const side = el('div', 'marxy-fchex');
    const view = ensureHex();
    side.append(view.el);
    p.append(fileCardElement({ shell, file, back: { words: 'Show the archive’s page', run: () => setCard(false) } }, pane), side);
    requestAnimationFrame(() => view.draw());
    return p;
  }

  function setCard(on: boolean): void {
    state.asCard = on;
    draw();
    viewerChanged();
  }

  function draw(): void {
    if (!host) return;
    const top0 = scrollBack ?? listEl?.scrollTop ?? sheet?.el.scrollTop ?? null;
    observer?.disconnect();
    page = null;
    sheet?.destroy();
    sheet = null;
    if (mode === 'source') {
      const view = ensureHex();
      const p = el('div', 'marxy-hexpage');
      p.append(view.el);
      host.replaceChildren(p);
      requestAnimationFrame(() => view.draw());
      return;
    }
    if (state.asCard) {
      host.replaceChildren(cardPage());
      return;
    }
    scrollBack = top0;
    host.replaceChildren(archivePage());
    settle();
  }

  // ---- Reveal and x-ray (viewers/archive-reveal.ts) -------------------------------------------------------------

  const reveal = archiveReveal({
    shell,
    path,
    listing,
    lede,
    head: file.head,
    changed: () => {
      rev++;
      draw();
      viewerChanged();
    },
    refresh: () => {
      rev++;
      if (page && reveal.switch.on()) {
        drawWindow(true);
        drawHead();
      }
      viewerChanged();
    },
    goTo: (index) => {
      const n = byIndex.get(index);
      if (n) setTimeout(() => partsGoTo(idOf(n)), 0);
    },
    xrayAfter: () => headEl,
  });

  // ---- the panel's cards ------------------------------------------------------------------------------------------

  const reading = readingCard({
    file,
    facts: () => null,
    shownAs: () => (state.asCard && mode === 'rendered' ? 'a file card and the bytes' : `an archive · ${listing.format}`),
    other: () =>
      mode === 'rendered'
        ? state.asCard
          ? { words: 'Show the archive’s page instead', run: () => setCard(false) }
          : { words: 'Show the file card and the bytes instead', run: () => setCard(true) }
        : null,
  });

  const archiveCard: CardDef = {
    id: 'contents',
    title: () => 'Archive',
    detail: () => `${n2(sums.files)} ${sums.files === 1 ? 'file' : 'files'}`,
    relevant: () => true,
    render(cardBody) {
      const unpacked = sums.unknownSize && sums.unpacked === 0 ? 'not said' : shortSize(sums.unpacked);
      const ratio = ratioWords(sums.unpacked, listing.size);
      cardBody.append(factRow('format', listing.format), factRow('unpacked', ratio ? `${unpacked} · ${ratio}` : unpacked));
      if (listing.format === 'zip' || listing.format === '7z' || listing.format === 'rar') cardBody.append(factRow('locked', sums.encrypted === 0 ? 'none of it' : `${n2(sums.encrypted)} ${sums.encrypted === 1 ? 'entry is' : 'entries are'} encrypted`));
      if (listing.comment) cardBody.append(factRow('comment', listing.comment));
      cardBody.append(factRow('extracted', 'never; an entry opens into memory on request'));
      if (listing.truncated) cardBody.append(factRow('listed', listing.truncated));
      const big = largestEntries(listing);
      if (big.length === 0) return;
      cardBody.append(el('p', 'marxy-card-sub', 'Largest'));
      const list = el('div', 'marxy-arch-largest');
      for (const e of big) {
        const b = el('button', 'marxy-arch-big');
        b.type = 'button';
        b.title = spokenText(e.path);
        const nm = el('span', 'marxy-arch-big-name');
        setMarked(nm, basename(e.path));
        b.append(nm, el('span', 'marxy-arch-big-size', shortSize(e.size ?? 0)));
        b.addEventListener('click', () => {
          const n = byIndex.get(e.index);
          if (n) partsGoTo(idOf(n));
        });
        list.append(b);
      }
      cardBody.append(list);
    },
  };

  // Metadata's "Written in it": the archive's own comment.
  const written: CardDef = {
    id: 'frontmatter',
    title: () => 'its comment',
    relevant: () => listing.comment !== null,
    render(body) {
      if (listing.comment) body.append(factRow('Comment', listing.comment));
    },
  };

  // Metadata's "It holds": files, folders, a count by kind of reading, and what needs care.
  const holds: CardDef = {
    id: 'notes',
    title: () => 'by what each reads as',
    relevant: () => true,
    render(body) {
      const groups = new Map<string, number>();
      for (const e of listing.entries) {
        if (e.kind === 'dir') continue;
        const g = readingOf(e).group;
        groups.set(g, (groups.get(g) ?? 0) + 1);
      }
      body.append(factRow('Files', n2(sums.files)), factRow('Folders', n2(lede.folders)));
      for (const [g, count] of [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) body.append(factRow(g, n2(count)));
      const careful = [...care.values()].filter((list) => list.some((c) => c.care !== 'encrypted')).length;
      if (careful > 0) body.append(factRow('Need a careful look', n2(careful)));
    },
  };

  // ---- the cursor's parts -----------------------------------------------------------------------------------------

  // The preview's parts spliced under its entry's unit, as a fenced part of a Markdown page is gone into:
  // `l` on the entry goes in, `h` comes out, and an inner part's address is the entry's with its own after it.
  const inner = new Map<string, PartUnit>();
  const innerUp = new Map<string, PartUnit | null>();
  let spliceFor: { readonly entry: string; readonly top: readonly PartUnit[] } | null = null;
  let building = false;
  let innerId: string | null = null;
  let innerPainted: Element[] = [];

  /** The preview's parts as `owner`'s children (null: the top level, a lone gzip's one file). */
  function spliced(owner: PartUnit | null, ownerId: string): readonly PartUnit[] {
    if (building || !embed || !shown_) return [];
    const n = byIndex.get(shown_.index);
    if (!n || idOf(n) !== ownerId) return [];
    if (spliceFor?.entry === ownerId) return spliceFor.top;
    inner.clear();
    innerUp.clear();
    const entry = n.entry!;
    const prefix = `!/${n.path}`;
    const wrap = (u: PartUnit, up: PartUnit | null): PartUnit => {
      const w: Mutable<PartUnit> = {
        id: `${ownerId}>${u.id}`,
        label: u.label,
        address: `${prefix}${u.address}`,
        el: () => u.el(),
        stored: () => u.stored(),
        open: () => openEntry(entry),
      };
      inner.set(w.id, w);
      innerUp.set(w.id, up);
      const kids = (u.children ?? []).map((c) => wrap(c, w));
      if (kids.length > 0) w.children = kids;
      return w;
    };
    spliceFor = { entry: ownerId, top: embed.parts().map((u) => wrap(u, owner)) };
    return spliceFor.top;
  }

  /** The entry's unit an inner part is held by, or the unit itself. */
  function entryUnitOf(u: PartUnit): PartUnit | null {
    let at: PartUnit | null = u;
    while (at && inner.has(at.id)) at = innerUp.get(at.id) ?? null;
    return at;
  }

  function markInner(head: PartUnit | null, run: readonly PartUnit[]): void {
    for (const e of innerPainted) e.classList.remove('marxy-cursor', 'marxy-selected');
    innerPainted = [];
    innerId = head && inner.has(head.id) ? head.id : null;
    for (const u of run) {
      if (!inner.has(u.id)) continue;
      const e = u.el();
      if (!e) continue;
      e.classList.add('marxy-selected');
      if (u.id === head?.id) e.classList.add('marxy-cursor');
      innerPainted.push(e);
    }
  }

  /** The entries as the cursor's parts: every folder and file, folded or not; a folder holds its own. */
  let partsTree: PartTree | null = null;
  function entryParts(): PartTree {
    if (partsTree) return partsTree;
    if (single) return (partsTree = oneFileParts());
    const level = (n: ArchiveNode): PartUnit[] =>
      sortedKids(n).filter(keeps).map((k) => {
        const kids = k.dir ? level(k) : [];
        const entry = k.entry;
        const kid = idOf(k);
        const unit: PartUnit = {
          id: kid,
          label: k.dir ? `folder ${k.name}` : `entry ${k.name}`,
          address: `!/${k.path}`,
          get children() {
            if (k.dir) return kids.length > 0 ? kids : undefined;
            const got = spliced(unit, kid);
            return got.length > 0 ? got : undefined;
          },
          el: () => rowFor(kid),
          stored: () => k.path,
          open: !k.dir && entry ? () => openEntry(entry) : undefined,
          ...(entry ? { xray: reveal.xray(entry) } : {}),
        };
        return unit;
      });
    const units = level(top);
    building = true;
    const base = treeParts(units, {
      readOnly: true,
      // The first row in view.
      start: () => {
        const tile = sheet?.firstInView();
        if (tile) return partsTree?.find(tile) ?? units[0] ?? null;
        const first = rows[listEl ? Math.floor(listEl.scrollTop / ROW_H) : 0];
        return (first ? partsTree?.find(idOf(first.node)) : null) ?? units[0] ?? null;
      },
    });
    building = false;
    partsTree = {
      ...base,
      find: (fid) => inner.get(fid) ?? base.find(fid),
      parent: (u) => (inner.has(u.id) ? (innerUp.get(u.id) ?? null) : base.parent(u)),
      // A repaint or a click asks this, not el(): only a move unfolds a folder to reach its entry.
      drawn: (u) => (sheet ? sheet.drawn(u.id) : drawnRows.get(u.id)) ?? (inner.has(u.id) ? u.el() : null),
      mark(head, run) {
        markInner(head, run);
        const owner = head ? entryUnitOf(head) : null;
        headId = owner?.id ?? null;
        runIds = new Set(run.map((u) => u.id));
        for (const [rid, row] of drawnRows) {
          row.setAttribute('aria-selected', String(rid === headId));
          // Inside the preview, its entry's row stays picked out, the cursor being in the preview.
          row.classList.toggle('marxy-cursor', rid === headId && innerId === null);
          row.classList.toggle('marxy-selected', runIds.has(rid) || (rid === headId && innerId !== null));
        }
        sheet?.mark(headId, runIds, innerId !== null);
        litCell();
        drawHead();
        wantPreview(headId ? (nodes.get(headId) ?? null) : null);
      },
      fold(u) {
        const n = nodes.get(u.id);
        if (!n?.dir) return false;
        toggle(n);
        return true;
      },
    };
    return partsTree;
  }

  /** A lone gzip's one file: its parts are the page's, at the top. */
  function oneFileParts(): PartTree {
    const n = byIndex.get(0);
    const kid = n ? idOf(n) : '';
    return {
      top: () => spliced(null, kid),
      find: (fid) => inner.get(fid) ?? null,
      parent: (u) => innerUp.get(u.id) ?? null,
      start: () => spliced(null, kid)[0] ?? null,
      readOnly: true,
      drawn: (u) => u.el(),
      mark: (head, run) => markInner(head, run),
    };
  }
  /** The row of `rid` on the page, its folders unfolded first and the list scrolled to it; null when it is not drawn. */
  function rowFor(rid: string): HTMLElement | null {
    if (!host || mode !== 'rendered' || state.asCard || (!listEl && !sheet)) return null;
    const n = nodes.get(rid);
    if (!n) return null;
    let unfolded = false;
    for (let up = parentOf.get(n); up && up !== top && up !== tree; up = parentOf.get(up)) unfolded = state.folded.delete(up.path) || unfolded;
    if (unfolded) drawList();
    if (sheet) return sheet.reveal(rid);
    if (!listEl) return null;
    const at = rowAt.get(rid);
    if (at === undefined) return null;
    const view = listEl.clientHeight || 800;
    if (at * ROW_H < listEl.scrollTop || (at + 1) * ROW_H > listEl.scrollTop + view) listEl.scrollTop = Math.max(0, at * ROW_H - view / 3);
    drawWindow();
    return drawnRows.get(rid) ?? null;
  }

  const facts = factsCard(file);
  const fileFacts = reveal.fileCard(facts);
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });

  const self: PaneViewer = {
    path,
    kind: 'archive',
    group: 'archive',
    binary: true,
    owns: () => true,
    show(m, into) {
      mode = m;
      host = into;
      into.setAttribute('data-marxy-viewer', 'archive');
      draw();
    },
    hide() {
      host = null;
    },
    cards: () => (state.asCard ? { reading, facts } : { reading, contents: archiveCard, facts: fileFacts, ...(listing.comment ? { frontmatter: written } : {}), notes: holds }),
    passing: (m) => (m === 'source' || state.asCard ? [byte] : []),
    headSay: () => null,
    // The entries are walked by the cursor (j k l h z, o opens); the arrows are the bytes' in Source and on the card.
    key(e, m) {
      if (m === 'source' || state.asCard) return hex?.key(e) ?? false;
      // Esc letting the filter go is the cursor's Escape (parts/commands.ts), so one press does one thing.
      return false;
    },
    parts: (m) => (m === 'source' || state.asCard ? ensureHex().parts() : entryParts()),
    floor: { on: () => state.asCard, set: (on) => setCard(on) },
    reveal: reveal.switch,
    ...(filterable ? { rows: rowFilter } : {}),
    panelKey: () => `${id}:${mode}:${state.asCard}:${hex?.selected() ?? ''}:${rev}`,
    place() {
      const list = mode === 'rendered' && !state.asCard ? (listEl ?? sheet?.el ?? null) : null;
      return { hex: hex?.place(), scroll: list ? { top: list.scrollTop, left: 0 } : undefined };
    },
    land(at) {
      ensureHex().restore({ selected: at, top: null });
      return mode === 'rendered' && state.asCard ? 'rendered' : 'source';
    },
    exports: () => [asItIs(shell, file, 'archive'), listingExport(listing)],
    destroy() {
      document.removeEventListener('keydown', onEscape, true);
      alive = false;
      observer?.disconnect();
      observer = null;
      if (frame) cancelAnimationFrame(frame);
      if (flushTimer) clearTimeout(flushTimer);
      if (previewTimer) clearTimeout(previewTimer);
      // A preview still being made stops at its next look: its entry is let go just below.
      previewGen++;
      embed?.destroy();
      embed = null;
      reveal.destroy();
      sheet?.destroy();
      sheet = null;
      dropFolder();
      releasePreviews({ archive: path });
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      pictures.clear();
      hex?.destroy();
      hex = null;
      host = null;
      page = null;
    },
  };
  return self;
}
