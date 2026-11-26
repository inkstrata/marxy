// Places (the first panel): a filter with `kind:x`, `>size` and `<size`, a count by kind, then Pinned, each
// place as a tree, Loose (open files in no place) and Sets. The files are the index's; nothing here reads a folder or
// writes a file, and a file's reading is said on its row only where its name does not say it.
import type { TabSet } from '@marxy/core/src/layout/frame-storage.ts';
import { failureText, readOrMissing } from '@marxy/core/src/util/read-or-missing.ts';
import { removeRoot } from '@marxy/core/src/index-model/collection.ts';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../../app-types.ts';
import { palette } from '../../commands/app-handle.ts';
import { compareTwoFiles } from '../../commands/compare.ts';
import { writeCopy } from '../../commands/copy-write.ts';
import { collectionFile, collectionOf } from '../../collection/load.ts';
import { canRun, commandById, runCommand } from '../../frame/branches/run.ts';
import { openFolderPage } from '../../frame/folder-page.ts';
import { openFromList } from '../../frame/glance.ts';
import { anchorBelow, openMenu, type MenuItem } from '../../frame/menu.ts';
import { kindLabel } from '../../frame/model/facts.ts';
import { inOrder, moved } from '../../frame/model/places.ts';
import { splitRoots } from '../../frame/model/tree.ts';
import { nextName, openSet, openTabs } from '../../frame/sets.ts';
import { isTransient } from '../../frame/tabs.ts';
import type { Frame } from '../../frame/types.ts';
import { notify } from '../../notices/index.ts';
import { proposalOn } from '../../proposals/state.ts';
import { buildAppContext } from '../../selection/bind.ts';
import { inferHomeFromConfig } from '../../theme/user-theme.ts';
import { KIND_GROUPS, census, kindCount, foldersTo, groupOf, isDot, nameOf, parseFilter, passes, relOf, sorter, treeOf, type KindGroup, type Order, type PlaceFile, type TreeDir } from '../places-model.ts';
import type { PanelContext, PanelDef, RowEvent, RowOptions, Verb } from '../types.ts';
import { ck, empty, fld, gh, h, mark, row, scrollWithin } from '../ui.ts';

type Show = 'folders' | 'flat' | 'kind';

export interface PlacesState {
  q: string;
  order: Order;
  show: Show;
  onlyOpen: boolean;
  dots: boolean;
  kind: KindGroup | null;
  readonly sel: Set<string>;
  /** Groups folded or opened by the reader: Pinned, each place, Loose, Sets, a kind. */
  readonly g: Map<string, boolean>;
  readonly open: Set<string>;
  /** A file to bring into view on the next draw: its place and folders open, the cursor on it. */
  reveal?: string;
  started?: boolean;
  offIndex?: () => void;
  /** A set being renamed (`r` on its row): its name now, and what the field holds. */
  renaming?: { readonly from: string; to: string };
}

const TREE_ROWS_MAX = 4000;

function openPaths(frame: Frame): Set<string> {
  return new Set(frame.tabs.model.tabs.map((t) => t.path).filter((p) => !isTransient(p)));
}

/** What a row says of an open file's reading: nothing unless it is a choice, a guess, or no reading at all. */
function readingNote(handle: AppHandle, path: string): { as: string; g?: boolean } | null {
  const pane = handle.panes().panes.find((p) => p.path() === path);
  if (!pane) return null;
  const viewer = pane.content.viewer();
  if (viewer?.kind === 'card' && viewer.owns(pane.view.mode)) return { as: 'no reading: bytes' };
  const detected = pane.content.detected();
  if (!detected) return null;
  const decisive = detected.reasons.find((r) => r.decisive) ?? detected.reasons[0];
  const words = kindLabel(detected.kind, path);
  if (decisive?.tier === 1) return { as: `read as ${words}, your choice` };
  if (decisive && decisive.tier >= 4) return { as: `${words}, guessed`, g: true };
  return null;
}

async function removePlace(handle: AppHandle, path: string): Promise<void> {
  const shell = handle.shell;
  const file = await collectionFile(shell);
  const name = basename(path);
  if (file === undefined || !shell.configPaths) return;
  const read = await readOrMissing(() => shell.readFile(file));
  if (read.kind === 'failed') {
    notify({ kind: 'refused', text: `${name} was not removed · collection.toml could not be read: ${failureText(read.error)}` });
    return;
  }
  const bytes = read.kind === 'bytes' ? read.bytes : new Uint8Array();
  let next: Uint8Array;
  try {
    next = removeRoot(bytes, path, { home: inferHomeFromConfig((await shell.configPaths()).config) });
  } catch (e) {
    notify({ kind: 'refused', text: `${name} was not removed · ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  if (next === bytes) {
    notify({ kind: 'info', text: `${name} is listed because a file in it was opened, not because collection.toml names it, so there is nothing to remove.` });
    return;
  }
  try {
    await shell.writeFileAtomic(file, next);
  } catch (e) {
    notify({ kind: 'error', text: `collection.toml could not be written · ${e instanceof Error ? e.message : String(e)} · nothing was changed` });
    return;
  }
  await collectionOf(handle)?.reload();
  notify({ kind: 'done', text: `${name} is no longer a place · its [[root]] left collection.toml; nothing on disk changed` });
}

const copyPath = (handle: AppHandle, text: string): void => void writeCopy(buildAppContext(handle), { text }, 'Copied its path');

function saveSet(handle: AppHandle, frame: Frame): void {
  const open = openTabs(handle, frame);
  if (open.tabs.length === 0) {
    notify({ kind: 'info', text: 'No files are open to save as a set', fades: true });
    return;
  }
  const sets = frame.store.state.sets;
  const name = nextName(sets, open.tabs);
  frame.store.update({ sets: [{ name, ...open }, ...sets] });
  notify({ kind: 'done', text: `Saved the open tabs as ${name}: ${open.tabs.length} ${open.tabs.length === 1 ? 'file' : 'files'}`, fades: true });
}

function viewMenu(ctx: PanelContext<PlacesState>, at: Element): void {
  const st = ctx.st;
  const it = (title: string, on: boolean, run: () => void): MenuItem => ({ title, detail: on ? '✓' : '', run: () => {
    run();
    ctx.redraw();
  } });
  openMenu(anchorBelow(at), 'Order, grouping and what is shown', [
    { title: 'Order', note: true },
    ...(['name', 'kind', 'size', 'modified'] as const).map((o) => it(o[0]!.toUpperCase() + o.slice(1), st.order === o, () => (st.order = o))),
    { title: 'Show as', note: true },
    it('Folders', st.show === 'folders', () => (st.show = 'folders')),
    it('One flat list', st.show === 'flat', () => (st.show = 'flat')),
    it('Grouped by kind', st.show === 'kind', () => (st.show = 'kind')),
    it('Dot files and folders', st.dots, () => (st.dots = !st.dots)),
    it('Only what is open', st.onlyOpen, () => (st.onlyOpen = !st.onlyOpen)),
    it('Fold every folder', false, () => st.open.clear()),
  ]);
}

function addMenu(ctx: PanelContext<PlacesState>, at: Element): void {
  const { handle } = ctx;
  const frame = handle.frame();
  const front = ctx.pane()?.path() ?? null;
  openMenu(anchorBelow(at), 'Add to Places', [
    { title: 'Open a file…', chord: 'Mod+O', run: () => void runCommand(handle, 'document.open') },
    { title: 'Add a folder…', run: () => void runOrSay(handle, 'collection.add-place') },
    ...(proposalOn('sets') ? [{ title: 'Save the open tabs as a set', run: () => saveSet(handle, frame) }] : []),
    ...(front && !isTransient(front) ? [{ title: 'Pin the open file here', run: () => togglePin(ctx, front) }] : []),
  ]);
}

/** Runs a command, or says why it cannot run here (no folder picker in this window, say). */
async function runOrSay(handle: AppHandle, id: string): Promise<void> {
  const command = commandById(handle, id);
  if (!command) return;
  const c = buildAppContext(handle);
  if (!command.when(c)) {
    notify({ kind: 'refused', text: command.unavailable?.(c) ?? ` cannot run here` });
    return;
  }
  await command.run(c);
}

function togglePin(ctx: PanelContext<PlacesState>, path: string): void {
  const p = palette();
  if (!p) return;
  const was = p.session.pinned.includes(path);
  p.togglePin(path);
  notify({ kind: 'done', text: was ? `Unpinned ${basename(path)}` : `Pinned ${basename(path)}. It is at the top of Places.`, fades: true });
  ctx.redraw();
}

function open(ctx: PanelContext<PlacesState>, path: string, e?: RowEvent): void {
  const { handle } = ctx;
  if (e?.beside) {
    void handle.open(path, { target: 'other' });
    return;
  }
  openFromList(handle, handle.frame(), path, { detail: e?.detail ?? 1, ctrlKey: false, metaKey: false, shiftKey: false } as MouseEvent);
}

const panel: PanelDef<PlacesState> = {
  id: 'places',
  name: 'Places',
  field: true,
  rest: 'Tab comes here. J K move, L opens a folder.',
  init: () => ({ q: '', order: 'name', show: 'folders', onlyOpen: false, dots: true, kind: null, sel: new Set(), g: new Map(), open: new Set() }),
  subject: () => '',
  take(ctx, arg) {
    // The Line's Go keeps `{ q, reveal }` (a file or heading row), `{ reveal }` (a reference, a tab), `{ q, scope: 'go' }`.
    const a = (arg ?? {}) as { q?: string; reveal?: string };
    if (typeof a.reveal === 'string') {
      ctx.st.reveal = a.reveal;
      ctx.cursorTo(`f:${a.reveal}`);
      // The Line's words are a fuzzy match: they filter Places only where the file kept still passes them.
      const e = ctx.handle.index.entries().find((x) => x.path === a.reveal);
      const f: PlaceFile = { path: a.reveal, root: e?.root ?? null, size: e?.size ?? 0, mtimeMs: e?.mtimeMs ?? 0 };
      ctx.st.q = typeof a.q === 'string' && passes(f, parseFilter(a.q)) ? a.q : '';
    } else if (typeof a.q === 'string') ctx.st.q = a.q;
  },
  buttons: (ctx) => [{ label: '+', icon: 'plus', title: 'Open a file, add a folder, save a set', run: (e) => addMenu(ctx, e.currentTarget as Element) }],
  render(ctx, body, top) {
    const { handle, st } = ctx;
    const frame = handle.frame();
    st.offIndex ??= handle.index.subscribe(() => requestAnimationFrame(() => ctx.redraw()));
    const here = ctx.pane()?.path() ?? null;
    const tabs = openPaths(frame);
    const entries = handle.index.entries();
    const known = new Map<string, PlaceFile>();
    for (const e of entries) if (!known.has(e.path)) known.set(e.path, { path: e.path, root: e.root, size: e.size, mtimeMs: e.mtimeMs });
    const loose: PlaceFile[] = [];
    for (const path of tabs) {
      if (known.has(path)) continue;
      const store = handle.panes().panes.find((p) => p.path() === path)?.content.store();
      loose.push({ path, root: null, size: store?.snapshot().buffer.bytes.length ?? 0, mtimeMs: 0 });
    }
    const all = [...known.values(), ...loose].filter((f) => st.dots || !isDot(f));
    const filter = parseFilter(st.q);
    const test = (f: PlaceFile): boolean => (!st.onlyOpen || tabs.has(f.path)) && (st.kind === null || groupOf(f.path) === st.kind) && passes(f, filter);
    const shown = all.filter(test);
    const narrowed = filter.any || st.kind !== null || st.onlyOpen;
    const by = sorter(st.order);
    const dirty = new Set(handle.panes().panes.filter((p) => p.content.store()?.snapshot().dirty).map((p) => p.path()));

    // A file to show: its place and folders open, and the cursor brought to it below. The first draw shows the file in
    // front, as the Library opened on its place.
    if (!st.started && here !== null && known.has(here)) {
      st.started = true;
      st.reveal ??= here;
    }
    let revealKey: string | null = null;
    if (st.reveal) {
      const f = known.get(st.reveal);
      if (f?.root) {
        st.g.set(`root:${f.root}`, true);
        for (const dir of foldersTo(f.root, f.path)) st.open.add(dir);
      }
      revealKey = `f:${st.reveal}`;
      st.reveal = undefined;
    }

    const viewButton = h('button', 'marxy-l-v', st.show === 'kind' ? 'by kind ▾' : `by ${st.order} ▾`);
    viewButton.type = 'button';
    viewButton.title = 'Order, grouping and what is shown';
    viewButton.addEventListener('click', () => viewMenu(ctx, viewButton));
    top.append(fld({ name: 'places-q', placeholder: 'Filter files and folders', value: st.q, right: viewButton, oninput: (v) => {
      st.q = v;
      ctx.redraw();
    } }));
    const line = h('div', 'marxy-l-census');
    if (filter.any || st.onlyOpen) {
      const clear = h('button', 'marxy-l-on', `${shown.length} of ${all.length} files`);
      clear.type = 'button';
      clear.title = 'Clear the filter';
      clear.addEventListener('click', () => {
        st.q = '';
        st.onlyOpen = false;
        ctx.redraw();
      });
      line.append(clear, st.onlyOpen ? ' · only what is open' : '', ' · Esc clears');
    } else
      for (const [g, n] of census(all)) {
        // Each kind keeps its dot after it, so a wrapped line never starts with one; the line breaks between kinds.
        const last = line.lastElementChild;
        if (last) {
          last.append(' ·');
          line.append(' ');
        }
        const b = h('button', st.kind === g ? 'marxy-l-on' : '', kindCount(n, g));
        b.type = 'button';
        b.title = st.kind === g ? 'Show every kind again' : `Show only ${g}`;
        b.addEventListener('click', () => {
          st.kind = st.kind === g ? null : g;
          ctx.redraw();
        });
        line.append(h('span', 'marxy-l-kind', b));
      }
    top.append(line);

    const ticking = st.sel.size > 0;
    const tick = (path: string) => (): void => {
      if (st.sel.has(path)) st.sel.delete(path);
      else st.sel.add(path);
      ctx.redraw();
    };
    const ticked = (): string[] => [...st.sel].filter((p) => known.has(p) || tabs.has(p));
    const fileVerbs = (f: PlaceFile) => (): (Verb | null)[] => {
      const many = st.sel.size > 1 && st.sel.has(f.path);
      const sel = ticked();
      const pinned = palette()?.session.pinned.includes(f.path) ?? false;
      const front = here !== null && here !== f.path && !isTransient(here) ? here : null;
      return [
        many
          ? ['o', `open all ${sel.length}`, () => {
              for (const p of sel.slice(1)) void handle.open(p, { focus: 'stay' });
              void handle.open(sel[0]!);
            }]
          : ['o', 'open', (e) => open(ctx, f.path, e as RowEvent | undefined)],
        ['O', 'open beside', () => open(ctx, f.path, { beside: true })],
        many && sel.length === 2
          ? ['~', 'compare them', () => void compareTwoFiles(sel[0]!, sel[1]!)]
          : front
            ? ['~', `compare with ${basename(front)}`, () => void compareTwoFiles(f.path, front)]
            : null,
        ['m', pinned ? 'unpin' : 'pin', () => togglePin(ctx, f.path)],
        ['r', 'read as…', () => {
          open(ctx, f.path);
          handle.frame().left.show('metadata', { card: 'reading' }, false);
        }],
        ['i', 'its metadata', () => {
          open(ctx, f.path);
          handle.frame().left.show('metadata', undefined, false);
        }],
        ['e', 'export', () => {
          void handle.open(f.path).then(() => (canRun(handle, 'document.export') ? runCommand(handle, 'document.export') : undefined));
        }],
        ['c', 'copy its path', () => copyPath(handle, f.path)],
        ['Space', st.sel.has(f.path) ? 'untick' : 'tick', tick(f.path)],
        f.root === null
          ? ['d', 'take it off the list', () => {
              const tab = frame.tabs.model.tabs.find((t) => t.path === f.path);
              st.sel.delete(f.path);
              if (tab) void frame.tabs.close(tab.id).then(() => ctx.redraw());
              notify({ kind: 'done', text: `${basename(f.path)} is off the list. Nothing on disk changed.`, fades: true });
            }]
          : null,
      ];
    };
    const fileRow = (f: PlaceFile, d: number, sub?: string): HTMLElement => {
      const note = readingNote(handle, f.path);
      const cls = [tabs.has(f.path) ? 'open' : '', f.path === here ? 'at' : '', dirty.has(f.path) ? 'dirty' : '', st.sel.has(f.path) ? 'sel' : '', isDot(f) ? 'dim' : ''].join(' ');
      const o: RowOptions = {
        k: `f:${f.path}`,
        d,
        tw: ticking ? undefined : '',
        pre: ticking ? ck(st.sel.has(f.path)) : null,
        nm: mark(nameOf(f.path), filter.words),
        title: f.path + (dirty.has(f.path) ? '  (unsaved changes)' : ''),
        cls,
        what: st.sel.size > 1 && st.sel.has(f.path) ? `${st.sel.size} files` : nameOf(f.path),
        run: (e) => open(ctx, f.path, e),
        tick: tick(f.path),
        verbs: fileVerbs(f),
        ...(note ?? (sub ? { as: sub } : {})),
      };
      return row(o);
    };
    let rowsLeft = TREE_ROWS_MAX;
    const add = (el: HTMLElement): void => {
      rowsLeft--;
      body.append(el);
    };
    const group = (key: string, name: string, small: string, n: number, fill: () => void, o?: { defaultOpen?: boolean; verbs?: () => (Verb | null)[]; run?: () => void }): void => {
      const isOpen = narrowed || (st.g.get(key) ?? o?.defaultOpen ?? true);
      body.append(
        gh(isOpen ? '▾' : '▸', name, small, n, {
          k: `g:${key}`,
          open: isOpen,
          toggle: () => {
            st.g.set(key, !isOpen);
            ctx.redraw();
          },
          ...(o?.verbs ? { verbs: o.verbs } : {}),
          ...(o?.run ? { run: o.run, go: 'read it as a page' } : {}),
        }),
      );
      if (isOpen) fill();
    };

    const pins = (palette()?.session.pinned ?? []).filter((p) => !narrowed || (known.has(p) && test(known.get(p)!)));
    if (pins.length > 0)
      group('pinned', 'Pinned', '', pins.length, () => {
        for (const p of pins)
          add(row({ k: `p:${p}`, d: 1, tw: '', nm: mark(nameOf(p), filter.words), small: `› ${basename(dirname(p))}`, title: p, cls: tabs.has(p) ? 'open' : '', go: 'go', run: (e) => open(ctx, p, e), verbs: () => [['m', 'unpin', () => togglePin(ctx, p)], ['c', 'copy its path', () => copyPath(handle, p)]] }));
      });

    const groupKeys = new Map<string, string>();
    for (const e of entries) {
      if (groupKeys.has(e.root)) continue;
      const key = handle.index.checkoutKey(e.path);
      if (key !== undefined && key.checkout === e.root) groupKeys.set(e.root, key.group);
    }
    const split = splitRoots(handle.index.roots(), (root) => groupKeys.get(root));
    const places = inOrder([...split.repositories, ...split.folders], frame.store.state.placeOrder);
    const shownPlaces = places.map((p) => p.root);
    for (const place of places) {
      const mine = shown.filter((f) => f.root === place.root);
      const key = `root:${place.root}`;
      group(
        key,
        place.name,
        place.root,
        mine.length,
        () => {
          if (mine.length === 0) {
            add(row({ d: 1, tw: '', nm: narrowed ? 'Nothing here matches' : 'Empty', cls: 'dim' }));
            return;
          }
          if (st.show === 'flat') {
            for (const f of mine.slice().sort(by)) if (rowsLeft > 0) add(fileRow(f, 1, `${dirname(relOf(f)) === '.' ? '.' : dirname(relOf(f))}/`));
            return;
          }
          if (st.show === 'kind') {
            for (const g of KIND_GROUPS) {
              const fs = mine.filter((f) => groupOf(f.path) === g).sort(by);
              if (fs.length === 0) continue;
              const gk = `${key}:${g}`;
              const isOpen = narrowed || st.g.get(gk) !== false;
              add(row({ k: `k:${gk}`, d: 1, cls: 'dir', tw: isOpen ? '▾' : '▸', nm: g, n: fs.length, open: isOpen, toggle: () => {
                st.g.set(gk, !isOpen);
                ctx.redraw();
              } }));
              if (isOpen) for (const f of fs) if (rowsLeft > 0) add(fileRow(f, 2, `${dirname(relOf(f)) === '.' ? '.' : dirname(relOf(f))}/`));
            }
            return;
          }
          const walk = (dir: TreeDir, depth: number): void => {
            const dirs = [...dir.dirs.values()].sort((a, b) => Number(a.name.startsWith('.')) - Number(b.name.startsWith('.')) || a.name.localeCompare(b.name));
            for (const d of dirs) {
              if (rowsLeft <= 0) return;
              const isOpen = narrowed || st.open.has(d.path);
              add(
                row({
                  k: `d:${d.path}`,
                  d: depth,
                  cls: `dir${d.name.startsWith('.') ? ' dim' : ''}`,
                  tw: isOpen ? '▾' : '▸',
                  nm: mark(`${d.name}/`, filter.words),
                  n: d.count,
                  title: 'Click to open or fold. Ctrl+click reads the folder as a page.',
                  open: isOpen,
                  toggle: (e) => {
                    if (e?.ctrlKey || e?.metaKey) {
                      void openFolderPage(handle, d.path);
                      return;
                    }
                    if (st.open.has(d.path)) st.open.delete(d.path);
                    else st.open.add(d.path);
                    ctx.redraw();
                  },
                  verbs: () => [['o', 'read it as a page', () => void openFolderPage(handle, d.path)], ['c', 'copy its path', () => copyPath(handle, `${d.path}/`)]],
                }),
              );
              if (isOpen) walk(d, depth + 1);
            }
            for (const f of dir.files.slice().sort(by)) if (rowsLeft > 0) add(fileRow(f, depth));
          };
          walk(treeOf(place.root, mine), 1);
          if (rowsLeft <= 0) add(row({ d: 1, tw: '', nm: 'More than the panel draws: filter to narrow it.', cls: 'dim' }));
        },
        {
          defaultOpen: here !== null && here.startsWith(`${place.root.replace(/\/$/, '')}/`) ? true : places.length <= 3,
          run: () => void openFolderPage(handle, place.root),
          verbs: () => {
            const at = shownPlaces.indexOf(place.root);
            const move = (by: -1 | 1) => (): void => frame.store.update({ placeOrder: moved(shownPlaces, place.root, by, frame.store.state.placeOrder) });
            return [
              ['f', 'find in this place', () => handle.frame().left.show('search', { scope: 'dir', dir: place.root })],
              at > 0 ? ['Alt+ArrowUp', 'move up', move(-1)] : null,
              at >= 0 && at < shownPlaces.length - 1 ? ['Alt+ArrowDown', 'move down', move(1)] : null,
              ['c', 'copy its path', () => copyPath(handle, place.root)],
              ['d', 'remove from places', () => void removePlace(handle, place.root).then(() => ctx.redraw())],
            ];
          },
        },
      );
    }

    const looseShown = shown.filter((f) => f.root === null);
    if (loose.length > 0)
      group('loose', 'Loose', 'not in any folder here', looseShown.length, () => {
        if (looseShown.length === 0) add(row({ d: 1, tw: '', nm: 'Nothing here matches', cls: 'dim' }));
        for (const f of looseShown.sort(by)) add(fileRow(f, 1));
      });

    const sets = frame.store.state.sets;
    if (proposalOn('sets') && !narrowed)
      group(
        'sets',
        'Sets',
        '',
        sets.length,
        () => {
          if (sets.length === 0) add(row({ d: 1, tw: '', nm: 'No sets yet. + saves the open tabs as one.', cls: 'dim' }));
          const rename = (from: string, to: string): void => {
            const name = to.trim();
            st.renaming = undefined;
            if (name !== '' && name !== from && sets.some((x) => x.name === name)) {
              notify({ kind: 'refused', text: `A set is already called ${name} · pick another name` });
            } else if (name !== '' && name !== from) {
              frame.store.update({ sets: sets.map((x) => (x.name === from ? { ...x, name } : x)) });
              ctx.cursorTo(`s:${name}`);
            }
            ctx.redraw();
          };
          sets.forEach((s: TabSet, i) =>
            st.renaming?.from === s.name
              ? add(
                  fld({
                    name: 'places-set-name',
                    placeholder: 'A name for the set',
                    value: st.renaming.to,
                    oninput: (v) => {
                      if (st.renaming) st.renaming.to = v;
                    },
                    onenter: (v) => rename(s.name, v),
                  }),
                )
              : add(
              row({
                k: `s:${s.name}`,
                d: 1,
                tw: '',
                nm: s.name,
                as: `${s.tabs.length} ${s.tabs.length === 1 ? 'file' : 'files'}${s.shown.length > 1 ? ' · two sides' : ''}`,
                title: s.tabs.join(', '),
                go: 'open them',
                run: () => void openSet(handle, frame, s),
                verbs: () => [
                  ['r', 'rename it', () => {
                    st.renaming = { from: s.name, to: s.name };
                    ctx.redraw();
                    requestAnimationFrame(() => {
                      const input = document.querySelector<HTMLInputElement>('.marxy-drawer input[data-marxy-left-field="places-set-name"]');
                      input?.focus();
                      input?.select();
                    });
                  }],
                  ['u', 'replace with the open tabs', () => frame.store.update({ sets: sets.map((x, j) => (j === i ? { name: x.name, ...openTabs(handle, frame) } : x)).filter((x) => x.tabs.length > 0) })],
                  ['d', 'forget this set', () => frame.store.update({ sets: sets.filter((_, j) => j !== i) })],
                ],
              }),
            ),
          );
        },
        { defaultOpen: false },
      );

    if (all.length === 0) body.append(empty('Nothing is here yet. Drop a file on the window, or press Ctrl O. What cannot be read is shown as its bytes.'));
    if (revealKey !== null) {
      const target = body.querySelector<HTMLElement>(`[data-marxy-left-row="${CSS.escape(revealKey)}"]`);
      if (target) scrollWithin(target, 'center');
    }
  },
  light(ctx, body) {
    const here = ctx.pane()?.path() ?? null;
    for (const r of body.querySelectorAll<HTMLElement>('.marxy-l-row.marxy-l-at')) if (r.dataset.marxyLeftRow !== `f:${here}`) r.classList.remove('marxy-l-at');
  },
};

export default panel;
