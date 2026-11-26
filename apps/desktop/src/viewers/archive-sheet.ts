// The sheet: the entries as tiles, each the entry's own page drawn small
// by the preview's embed (`size: 'mini'`, inert, no parts), never an icon. Folders are headings over their files, in the
// list's own order, so the cursor walks the tiles as it walks the rows and the parts and addresses are the list's. Windowed
// as the list is; a tile's embed is made only as it nears the view and let go when it leaves it (destroyed, its entry
// released from a pool of its own), at most TILES_LIVE at once. A folder's preview is its files as the same tiles.
import { shortSize, sortedKids, type ArchiveNode, type ArchiveRow } from '@marxy/core/src/viewer/archive.ts';
import type { EntryReading } from '@marxy/core/src/viewer/archive-reading.ts';
import { FILE_TYPES } from '@marxy/core/src/kind/registry.ts';
import type { ArchiveEntry, ArchiveListing } from '@marxy/shell-api';
import type { AppShell } from '../app-types.ts';
import { holdTile, releaseTiles } from '../document/entries.ts';
import { el } from '../frame/dom.ts';
import { setMarked, spokenText } from '../frame/model/metadata-marks.ts';
import { entryShell } from './archive-entries.ts';
import { createEmbed, type Embed } from './embed.ts';

export type EntriesAs = 'list' | 'sheet';

/** A tile's box, as frame.css draws it: the sheet is laid out by these. */
const TILE_W = 132;
const TILE_GAP = 12;
const TILE_ROW = 96 + 40 + 14;
const HEAD_H = 40;
/** Tiles with an embed at once; past it, those no longer near the view go first. */
export const TILES_LIVE = 48;
/** A text tile draws from its first bytes: a small drawing needs no more. */
const TILE_HEAD = 16 * 1024;
/** A picture or a PDF is drawn from all of it, up to this size, two read at a time (the plan's limits). */
const WHOLE_CAP = 4 * 1024 * 1024;
const WHOLE_AT_ONCE = 2;
const HEADS_A_CALL = 64;
/** A picture up to this size is read by its head, which then holds all of it (the shell's most a head may be). */
const WHOLE_BY_HEAD = 256 * 1024;
/** The shell's 16 MB a call, at WHOLE_BY_HEAD each. */
const BIG_HEADS_A_CALL = 64;
const LET_GO_AFTER = 1000;
/** A folder's preview draws this many of its things. */
const FOLDER_TILES = 120;

const n2 = (n: number): string => n.toLocaleString('en-GB');
const plural = (n: number, one: string): string => `${n2(n)} ${n === 1 ? one : `${one}s`}`;

/** What the sheet asks of the archive's page. */
export interface TileDeps {
  readonly shell: AppShell;
  readonly path: string;
  readonly listing: ArchiveListing;
  readingOf(e: ArchiveEntry): EntryReading;
  /** What the list says of it: its reading or its care, and whether that is a warning. */
  says(n: ArchiveNode): { text: string; warn: boolean };
  idOf(n: ArchiveNode): string;
  /** Puts the cursor on the part `id`. */
  go(id: string): void;
  open(e: ArchiveEntry): void;
  /** Asks for readings of these entries (they are drawn). */
  want(indices: readonly number[]): void;
}

/** A picture by its reading so far: drawn from its bytes, or (before they come) named as an image. */
const pictureLike = (r: EntryReading): boolean => r.picture || (r.row === 'image' && !r.disagrees);

/** More than half the files read as pictures: the archive opens as a sheet. */
export function mostlyPictures(listing: ArchiveListing, readingOf: (e: ArchiveEntry) => EntryReading): boolean {
  let files = 0;
  let pictures = 0;
  for (const e of listing.entries) {
    if (e.kind !== 'file') continue;
    files++;
    if (pictureLike(readingOf(e))) pictures++;
  }
  return files > 0 && pictures * 2 > files;
}

/** The line under the plan's second control, as words: list | sheet. */
export function entriesSwitch(into: HTMLElement, as: EntriesAs, set: (as: EntriesAs) => void): void {
  into.append(el('span', 'marxy-arch-ctl marxy-arch-ctl-as', 'entries as'));
  for (const [value, words] of [['list', 'a list'], ['sheet', 'a sheet']] as const) {
    const b = el('button', 'marxy-arch-opt', words);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(as === value));
    b.addEventListener('click', () => set(value));
    into.append(b);
  }
}

/** Why an entry is not drawn, said on its tile; null when it can be. */
function notDrawn(e: ArchiveEntry): string | null {
  if (e.encrypted) return 'Encrypted: not read. The app does not ask for archive passwords.';
  if (e.kind === 'link') return `A link${e.link ? ` to ${e.link}` : ''}: not followed.`;
  if (e.kind !== 'file') return 'Not a file: a device, a pipe or the like.';
  if (e.method) return `Compressed with ${e.method}, which the app does not read.`;
  return null;
}

// ---- filling tiles as they come into view ----------------------------------------------------------------------------

interface Tile {
  readonly el: HTMLElement;
  readonly pic: HTMLElement;
  readonly page: HTMLElement;
  readonly entry: ArchiveEntry;
  state: 'idle' | 'reading' | 'live';
  near: boolean;
  /** Bumped when the tile is let go, so a read that comes back late is dropped. */
  gen: number;
  embed: Embed | null;
  held: string | null;
}

interface Filler {
  watch(tile: HTMLElement, pic: HTMLElement, page: HTMLElement, entry: ArchiveEntry): void;
  unwatch(tile: HTMLElement): void;
  destroy(): void;
}

const yieldTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** `root`: the scroller the tiles are seen through (null: the window). */
function createFiller(d: TileDeps, root: HTMLElement | null): Filler {
  const tiles = new Map<Element, Tile>();
  const shell = entryShell(d.shell);
  let alive = true;
  const heads = new Set<Tile>();
  const bigHeads = new Set<Tile>();
  let headTimer = 0;
  const wholeQueue: Tile[] = [];
  let wholeRunning = 0;
  // Embeds are made one at a time, a task apart: forty-odd made in one go would hold the main thread.
  let making: Promise<void> = Promise.resolve();

  // A destroyed viewer may still have a read on its way (a card's bytes): its entry is let go a moment later, not at once.
  const letGo = (held: string): void => {
    window.setTimeout(() => releaseTiles({ path: held }), LET_GO_AFTER);
  };

  const near = new IntersectionObserver(
    (seen) => {
      for (const x of seen) {
        const t = tiles.get(x.target);
        if (t) t.near = x.isIntersecting;
      }
      pump();
    },
    { root, rootMargin: '240px 0px' },
  );
  const far = new IntersectionObserver(
    (seen) => {
      for (const x of seen) {
        const t = tiles.get(x.target);
        if (t && !x.isIntersecting && t.state !== 'idle') release(t);
      }
    },
    { root, rootMargin: '1200px 0px' },
  );

  function release(t: Tile): void {
    // An embed still being made lets its entry go itself once it is done (fill), so its viewer never reads a gone entry.
    const making = t.state === 'reading' && t.held !== null;
    t.gen++;
    t.embed?.destroy();
    t.embed = null;
    if (t.held && !making) letGo(t.held);
    t.held = null;
    heads.delete(t);
    bigHeads.delete(t);
    const q = wholeQueue.indexOf(t);
    if (q >= 0) wholeQueue.splice(q, 1);
    t.page.replaceChildren();
    t.pic.querySelector('.marxy-arch-tile-note')?.remove();
    t.state = 'idle';
  }

  function pump(): void {
    if (!alive) return;
    const waiting = [...tiles.values()].filter((t) => t.near && t.state === 'idle');
    if (waiting.length === 0) return;
    let busy = 0;
    for (const t of tiles.values()) if (t.state !== 'idle') busy++;
    if (busy + waiting.length > TILES_LIVE) {
      for (const t of tiles.values()) {
        if (busy + waiting.length <= TILES_LIVE) break;
        if (!t.near && t.state !== 'idle') {
          release(t);
          busy--;
        }
      }
    }
    for (const t of waiting) {
      if (busy >= TILES_LIVE) break;
      busy++;
      ask(t);
    }
  }

  function ask(t: Tile): void {
    t.state = 'reading';
    const e = t.entry;
    const r = d.readingOf(e);
    const pdf = r.row !== null && FILE_TYPES.find((f) => f.id === r.row)?.viewer === 'pdf';
    const whole = (pictureLike(r) || pdf) && e.size !== null && e.size <= WHOLE_CAP;
    // A small picture is read whole by its head, many in one call: one walk of the archive for a screenful, not one each.
    if (whole && e.size! > WHOLE_BY_HEAD) {
      wholeQueue.push(t);
      pumpWhole();
      return;
    }
    (whole ? bigHeads : heads).add(t);
    if (!headTimer) headTimer = window.setTimeout(() => void flushHeads(), 30);
  }

  async function flushHeads(): Promise<void> {
    headTimer = 0;
    if (!alive) return;
    const from = bigHeads.size > 0 ? bigHeads : heads;
    if (from.size === 0) return;
    const maxEach = from === bigHeads ? WHOLE_BY_HEAD : TILE_HEAD;
    const batch = [...from].slice(0, from === bigHeads ? BIG_HEADS_A_CALL : HEADS_A_CALL);
    for (const t of batch) from.delete(t);
    if (heads.size > 0 || bigHeads.size > 0) headTimer = window.setTimeout(() => void flushHeads(), 30);
    const gens = batch.map((t) => t.gen);
    let got: Awaited<ReturnType<AppShell['readArchiveHeads']>>;
    try {
      got = await d.shell.readArchiveHeads(d.path, batch.map((t) => ({ index: t.entry.index, name: t.entry.path })), maxEach);
    } catch (err) {
      batch.forEach((t, i) => t.gen === gens[i] && note(t, err instanceof Error ? err.message : String(err)));
      return;
    }
    const byIndex = new Map(got.map((h) => [h.index, h]));
    batch.forEach((t, i) => {
      if (t.gen !== gens[i] || t.state !== 'reading') return;
      const h = byIndex.get(t.entry.index);
      // Left out past the call's budget: asked again as the view moves.
      if (!h) t.state = 'idle';
      else if (h.refused) note(t, h.refused);
      else fill(t, h.bytes, h.whole);
    });
  }

  function pumpWhole(): void {
    while (alive && wholeRunning < WHOLE_AT_ONCE && wholeQueue.length > 0) {
      const t = wholeQueue.shift()!;
      const gen = t.gen;
      wholeRunning++;
      void d.shell
        .readArchiveEntry(d.path, t.entry.index, t.entry.path)
        .then(
          (bytes) => t.gen === gen && fill(t, bytes, true),
          (err: unknown) => t.gen === gen && note(t, err instanceof Error ? err.message : String(err)),
        )
        .finally(() => {
          wholeRunning--;
          // A task apart: a shell that answers at once (the browser twin) would otherwise read the whole queue in one.
          window.setTimeout(pumpWhole, 0);
        });
    }
  }

  function note(t: Tile, text: string): void {
    if (!alive) return;
    t.pic.append(el('p', 'marxy-arch-tile-note', text));
    t.state = 'live';
  }

  function fill(t: Tile, bytes: Uint8Array, whole: boolean): void {
    const gen = t.gen;
    const current = (): boolean => alive && t.gen === gen && t.state === 'reading';
    making = making.then(async () => {
      if (!current()) return;
      await yieldTask();
      if (!current()) return;
      const e = t.entry;
      const mtimeMs = e.mtime ? Date.parse(e.mtime) : Number.NaN;
      const held = holdTile({ archive: d.path, name: e.path, index: e.index, bytes, mtimeMs: Number.isNaN(mtimeMs) ? null : mtimeMs, ...(whole ? {} : { size: e.size ?? bytes.length }) });
      t.held = held.path;
      try {
        const made = await createEmbed({ shell, path: held.path, whole, host: t.page, size: 'mini', open: () => d.open(e) });
        if (!current()) {
          made.destroy();
          letGo(held.path);
          return;
        }
        t.embed = made;
        t.state = 'live';
      } catch (err) {
        if (current()) note(t, err instanceof Error ? err.message : String(err));
        else letGo(held.path);
      }
    });
  }

  return {
    watch(tile, pic, page, entry) {
      const t: Tile = { el: tile, pic, page, entry, state: 'idle', near: false, gen: 0, embed: null, held: null };
      tiles.set(tile, t);
      near.observe(tile);
      far.observe(tile);
    },
    unwatch(tile) {
      const t = tiles.get(tile);
      if (!t) return;
      release(t);
      near.unobserve(tile);
      far.unobserve(tile);
      tiles.delete(tile);
      pump();
    },
    destroy() {
      alive = false;
      near.disconnect();
      far.disconnect();
      if (headTimer) clearTimeout(headTimer);
      for (const t of tiles.values()) release(t);
      tiles.clear();
    },
  };
}

// ---- a tile ----------------------------------------------------------------------------------------------------------

interface TileParts {
  readonly el: HTMLElement;
  readonly says: HTMLElement;
}

function saysOf(d: TileDeps, n: ArchiveNode): { text: string; warn: boolean } {
  if (n.dir) return { text: `${plural(n.files, 'file')}, ${shortSize(n.size)}`, warn: false };
  const s = d.says(n);
  const size = n.entry?.size;
  return { text: `${s.text} · ${size === null || size === undefined ? 'its size not said' : shortSize(size)}`, warn: s.warn };
}

function setSays(d: TileDeps, n: ArchiveNode, t: TileParts): void {
  const s = saysOf(d, n);
  t.says.textContent = s.text;
  t.el.classList.toggle('marxy-arch-tile-warn', s.warn);
}

function makeTile(d: TileDeps, n: ArchiveNode, filler: Filler): TileParts {
  const id = d.idOf(n);
  const tile = el('div', n.dir ? 'marxy-arch-tile marxy-arch-tile-dir' : 'marxy-arch-tile');
  tile.setAttribute('role', 'gridcell');
  tile.title = spokenText(n.path);
  const pic = el('span', 'marxy-arch-tile-pic');
  const page = el('span', 'marxy-arch-tile-page');
  pic.append(page);
  const name = el('span', 'marxy-arch-tile-name');
  setMarked(name, n.dir ? `${n.name}/` : n.name);
  const says = el('span', 'marxy-arch-tile-says');
  tile.append(pic, name, says);
  const parts = { el: tile, says };
  setSays(d, n, parts);
  const e = n.entry && !n.dir ? d.listing.entries[n.entry.index] : undefined;
  if (n.dir) {
    // A folder drawn small is the list of what it holds.
    const list = el('ul', 'marxy-arch-tile-names');
    for (const k of sortedKids(n).slice(0, 12)) {
      const li = el('li');
      setMarked(li, k.dir ? `${k.name}/` : k.name);
      list.append(li);
    }
    page.append(list);
  } else if (e) {
    const why = notDrawn(e);
    if (why) {
      if (e.encrypted) pic.classList.add('marxy-arch-tile-enc');
      pic.append(el('p', 'marxy-arch-tile-note', why));
    } else filler.watch(tile, pic, page, e);
  }
  tile.addEventListener('click', (ev) => {
    ev.stopPropagation();
    // After the press is done, as a click on a row: the pane is focused by then, and the cursor speaks for it.
    setTimeout(() => d.go(id), 0);
  });
  if (e) tile.addEventListener('dblclick', () => d.open(e));
  return parts;
}

// ---- the sheet -------------------------------------------------------------------------------------------------------

export interface SheetOptions extends TileDeps {
  readonly top: ArchiveNode;
  /** The list's rows: every node not under a folded folder, in its order. */
  rows(): readonly ArchiveRow[];
  parentOf(n: ArchiveNode): ArchiveNode | null;
  isFolded(n: ArchiveNode): boolean;
  toggle(n: ArchiveNode): void;
  /** A path as the page says it: inside the one folder that holds everything. */
  shown(p: string): string;
  /** While the page is filtered: how many of a folder's files match; null with no filter. */
  matching(n: ArchiveNode): number | null;
}

export interface Sheet {
  /** The scroller. */
  readonly el: HTMLElement;
  /** The rows changed (a fold) or the width did: laid out again. */
  layout(): void;
  /** Laid out once in the document, at `scroll`. */
  settle(scroll: number | null): void;
  mark(headId: string | null, run: ReadonlySet<string>, inside: boolean): void;
  /** Readings came: what each tile says is set in place. */
  refresh(): void;
  /** The tile or heading of `id`, scrolled into view and drawn; null when it is not on the sheet. */
  reveal(id: string): HTMLElement | null;
  drawn(id: string): HTMLElement | null;
  firstInView(): string | null;
  destroy(): void;
}

type Item =
  | { readonly kind: 'head'; readonly node: ArchiveNode; readonly again: boolean; readonly y: number; readonly key: string }
  | { readonly kind: 'tile'; readonly node: ArchiveNode; readonly y: number; readonly col: number; readonly key: string };

const AGAIN = '\u0000again:';

export function createSheet(o: SheetOptions): Sheet {
  const scroller = el('div', 'marxy-arch-sheet');
  scroller.setAttribute('role', 'grid');
  const sizer = el('div', 'marxy-arch-srows');
  scroller.append(sizer);
  const filler = createFiller(o, scroller);
  let items: Item[] = [];
  let at = new Map<string, number>();
  let cols = 1;
  const drawn = new Map<string, HTMLElement>();
  const tileParts = new Map<string, TileParts>();
  let marked: { head: string | null; run: ReadonlySet<string>; inside: boolean } = { head: null, run: new Set(), inside: false };
  let frame = 0;
  let observer: ResizeObserver | null = null;
  let lastW = -1;

  const height = (it: Item): number => (it.kind === 'head' ? HEAD_H : TILE_ROW);

  function layout(): void {
    const w = scroller.clientWidth;
    cols = Math.max(1, Math.floor((w + TILE_GAP) / (TILE_W + TILE_GAP)));
    items = [];
    at = new Map();
    let y = 0;
    let col = 0;
    let block: ArchiveNode = o.top;
    const endRow = (): void => {
      if (col > 0) y += TILE_ROW;
      col = 0;
    };
    for (const r of o.rows()) {
      const n = r.node;
      const id = o.idOf(n);
      if (n.dir) {
        endRow();
        at.set(id, items.length);
        items.push({ kind: 'head', node: n, again: false, y, key: id });
        y += HEAD_H;
        block = n;
        continue;
      }
      const up = o.parentOf(n) ?? o.top;
      if (up !== block) {
        // A folder's files come after its folders, as in the list: its heading is said again over them.
        endRow();
        if (up !== o.top) {
          items.push({ kind: 'head', node: up, again: true, y, key: `${AGAIN}${o.idOf(up)}:${items.length}` });
          y += HEAD_H;
        }
        block = up;
      }
      at.set(id, items.length);
      items.push({ kind: 'tile', node: n, y, col, key: id });
      if (++col === cols) {
        y += TILE_ROW;
        col = 0;
      }
    }
    endRow();
    sizer.style.height = `${y}px`;
    // Laid out anew: every element is placed again (a fold moved what follows it).
    for (const [key, node] of drawn) if (!at.has(key) || key.startsWith(AGAIN) || items[at.get(key)!]!.kind === 'head') forget(key, node);
    win(true);
  }

  function forget(key: string, node: HTMLElement): void {
    filler.unwatch(node);
    node.remove();
    drawn.delete(key);
    tileParts.delete(key);
  }

  function headEl(it: Item & { kind: 'head' }): HTMLElement {
    const n = it.node;
    const h = el('div', it.again ? 'marxy-arch-shead marxy-arch-shead-again' : 'marxy-arch-shead');
    h.setAttribute('role', 'rowheader');
    if (!it.again) {
      const open = !o.isFolded(n);
      h.setAttribute('aria-expanded', String(open));
      const tw = el('button', 'marxy-arch-tw');
      tw.type = 'button';
      tw.tabIndex = -1;
      tw.setAttribute('aria-expanded', String(open));
      tw.setAttribute('aria-label', `${open ? 'Fold' : 'Unfold'} ${n.name}`);
      tw.addEventListener('click', (ev) => {
        ev.stopPropagation();
        o.toggle(n);
      });
      h.append(tw);
    }
    const b = el('b', 'marxy-arch-shead-name');
    setMarked(b, o.shown(n.path));
    const held = o.matching(n);
    h.append(b, el('span', '', `${held === null ? '' : `${n2(held)} of `}${plural(n.files, 'file')}, ${shortSize(n.size)}`));
    const id = o.idOf(n);
    h.addEventListener('click', () => setTimeout(() => o.go(id), 0));
    return h;
  }

  function paint(key: string, node: HTMLElement): void {
    if (key.startsWith(AGAIN)) return;
    const head = key === marked.head;
    node.classList.toggle('marxy-cursor', head && !marked.inside);
    node.classList.toggle('marxy-selected', marked.run.has(key) || (head && marked.inside));
    node.setAttribute('aria-selected', String(head));
  }

  /** The items near the view, drawn into the sizer; the rest are not in the page, and their embeds are let go. */
  function win(force = false): void {
    const top = scroller.scrollTop;
    const view = scroller.clientHeight || 800;
    const from = top - view;
    const to = top + 2 * view;
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid]!.y + height(items[mid]!) < from) lo = mid + 1;
      else hi = mid;
    }
    const want = new Set<string>();
    const files: number[] = [];
    for (let i = lo; i < items.length && items[i]!.y <= to; i++) {
      const it = items[i]!;
      want.add(it.key);
      let node = drawn.get(it.key);
      if (!node) {
        if (it.kind === 'head') node = headEl(it);
        else {
          const t = makeTile(o, it.node, filler);
          tileParts.set(it.key, t);
          node = t.el;
        }
        drawn.set(it.key, node);
        sizer.append(node);
        paint(it.key, node);
        if (it.kind === 'tile' && it.node.entry) files.push(it.node.entry.index);
      } else if (!force) continue;
      node.style.top = `${it.y}px`;
      if (it.kind === 'tile') node.style.left = `${it.col * (TILE_W + TILE_GAP)}px`;
    }
    for (const [key, node] of drawn) if (!want.has(key)) forget(key, node);
    if (files.length > 0) o.want(files);
  }

  scroller.addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      win();
    });
  });

  return {
    el: scroller,
    layout,
    settle(scroll) {
      observer?.disconnect();
      observer = new ResizeObserver(() => {
        const w = scroller.clientWidth;
        const c = Math.max(1, Math.floor((w + TILE_GAP) / (TILE_W + TILE_GAP)));
        if (w !== lastW && c !== cols) {
          // The same pixel offset would show other tiles at a new column count: keep the first one in view at the top.
          const top = scroller.scrollTop;
          const head = items.find((x) => !(x.kind === 'head' && x.again) && x.y + height(x) > top);
          const into = head ? top - head.y : 0;
          const id = head ? o.idOf(head.node) : null;
          layout();
          const i = id === null ? undefined : at.get(id);
          if (i !== undefined) {
            scroller.scrollTop = items[i]!.y + into;
            win();
          }
        } else win();
        lastW = w;
      });
      observer.observe(scroller);
      lastW = scroller.clientWidth;
      layout();
      if (scroll !== null) {
        scroller.scrollTop = scroll;
        win();
      }
    },
    mark(head, run, inside) {
      marked = { head, run, inside };
      for (const [key, node] of drawn) paint(key, node);
    },
    refresh() {
      for (const [key, t] of tileParts) {
        const i = at.get(key);
        const it = i === undefined ? undefined : items[i];
        if (it) setSays(o, it.node, t);
      }
    },
    reveal(id) {
      const i = at.get(id);
      if (i === undefined) return null;
      const it = items[i]!;
      const view = scroller.clientHeight || 800;
      if (it.y < scroller.scrollTop || it.y + height(it) > scroller.scrollTop + view) scroller.scrollTop = Math.max(0, it.y - view / 3);
      win();
      return drawn.get(id) ?? null;
    },
    drawn: (id) => (at.has(id) ? (drawn.get(id) ?? null) : null),
    firstInView() {
      const top = scroller.scrollTop;
      const it = items.find((x) => x.y + height(x) > top);
      return it ? o.idOf(it.node) : null;
    },
    destroy() {
      observer?.disconnect();
      observer = null;
      if (frame) cancelAnimationFrame(frame);
      filler.destroy();
      drawn.clear();
      tileParts.clear();
    },
  };
}

// ---- a folder's preview ----------------------------------------------------------------------------------------------

export interface FolderTiles {
  readonly el: HTMLElement;
  destroy(): void;
}

/** A folder under the cursor, previewed as its files (and then its folders) drawn as the sheet's tiles. */
export function folderTiles(d: TileDeps, n: ArchiveNode): FolderTiles {
  const filler = createFiller(d, null);
  const box = el('div', 'marxy-arch-ftiles');
  const grid = el('div', 'marxy-arch-tiles');
  const kids = sortedKids(n);
  const things = [...kids.filter((k) => !k.dir), ...kids.filter((k) => k.dir)];
  for (const k of things.slice(0, FOLDER_TILES)) grid.append(makeTile(d, k, filler).el);
  box.append(grid);
  if (things.length > FOLDER_TILES) box.append(el('p', 'marxy-embed-note', `And ${n2(things.length - FOLDER_TILES)} more: the sheet shows every one.`));
  const files = things.slice(0, FOLDER_TILES).flatMap((k) => (!k.dir && k.entry ? [k.entry.index] : []));
  if (files.length > 0) d.want(files);
  return { el: box, destroy: () => filler.destroy() };
}
