// The sidebar (W-07; ADR-0058): the `sidebar` region while it is shown, unfolded or peeking. Two foldable sections,
// Recent and Pinned (the changed files after the pinned), drawn from `sidebarSections` over the palette's feed and
// session; a *Library* row above them when the command `library.open` is registered (Q-03). After them, Repositories and
// Folders (W-08): the index's roots as lazy trees (`sidebar-tree.ts`), a folder listed with `readDir` only when it opens. Layout is base.css
// (`.marxy-sidebar`); state is ARIA and data attributes (`data-marxy-sidebar-section`, `data-marxy-sidebar-row`), and
// the stylesheet draws it.
//
// It reads the palette's feed and session and the index service's watch state, never the disk, and it adds no way
// to pin or unpin (the palette's `Mod+.` stays the only one). A row opens its document with `AppHandle.open`, as the
// palette does, so the unsaved-changes prompt, the history and the read time are the open's own.
//
// The palette is mounted after `startApp`, so it may not exist when the region is first made: the sidebar then draws
// nothing and looks again until it does. Folded sections are kept in workspace.json (`Workspace.saveSections`).
import type { SidebarSectionId } from '@marxy/core/src/layout/workspace-storage.ts';
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import type { IndexEntry } from '@marxy/core';
import type { AppHandle } from '../app.ts';
import { palette } from '../commands/app-handle.ts';
import type { AppContext, Command } from '../commands/registry.ts';
import { kindIconElement, langOfPath } from '../kind-icons/icons.ts';
import { relativeAge, spokenAge } from '../palette/empty-state.ts';
import { buildAppContext, openPalette } from '../selection/bind.ts';
import { changedPredicate } from '../library/scopes.ts';
import { SIDEBAR_SECTIONS, sidebarSections, type SidebarMark, type SidebarSection } from './sidebar.ts';
import {
  changedByGroup,
  closeWithin,
  splitRoots,
  staleDirs,
  visibleRows,
  type FolderRow,
  type Listing,
  type RepositoryRow,
  type TreeRow,
} from './sidebar-tree.ts';
import type { DocumentSignal } from './toolbar.ts';
import { toolbarIconElement } from './toolbar-icons.ts';

const LIBRARY_COMMAND = 'library.open';
/** How often a sidebar made before the palette looks for it. The palette mounts within the launch, so this ends at once. */
const PALETTE_WAIT_MS = 200;

const isMac = (): boolean => typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

const kindOf = (entry: IndexEntry): Kind => entry.readerKind ?? (entry.kind === 'source' ? 'code' : 'article');

/** Entries asked of `checkoutKey` per root to learn whether the root is itself a checkout; a plain folder costs this many, once per draw. */
/** One level of indentation in a tree, in em. */
const TREE_STEP_EM = 1.1;

const GROUP_PROBE_CAP = 64;

const MARK_WORDS: Record<SidebarMark, string> = { pinned: ', pinned', changed: ', changed since you read', recent: '' };

/** Fills the `sidebar` region. Returns what takes it out. */
export function mountSidebar(el: HTMLElement, handle: AppHandle, signal: DocumentSignal): () => void {
  const workspace = handle.workspace();
  const mac = isMac();

  const root = document.createElement('nav');
  root.className = 'marxy-sidebar';
  root.setAttribute('aria-label', 'Sidebar');
  el.append(root);

  /** The folded sections; null until workspace.json has been read (nothing is drawn before, so nothing jumps). */
  let collapsed: Set<SidebarSectionId> | null = null;
  let disposed = false;
  let drawn = '';
  let sessionSeen: unknown = null;
  let waiting: ReturnType<typeof setTimeout> | null = null;
  let offFeed: (() => void) | null = null;
  let feedOf: unknown = null;
  /** The folders open in the trees, and what `readDir` last said of each. Held while the window lives; a launch starts closed. */
  let expanded = new Set<string>();
  const listings = new Map<string, Listing>();
  const reading = new Set<string>();
  const readAgain = new Set<string>();
  let wasIndexing = handle.index.indexing();

  const libraryCommand = (): Command | undefined =>
    (handle.commands() as readonly Command[]).find((c) => c.id === LIBRARY_COMMAND);

  const sectionsNow = (byPath: ReadonlyMap<string, IndexEntry>): readonly SidebarSection[] => {
    const p = palette();
    if (!p) return [];
    return sidebarSections({
      entriesByPath: byPath,
      session: p.session,
      nowMs: Date.now(),
      watched: (r) => handle.index.isWatched(r),
      baselineMs: (r) => handle.index.baselineMs(r),
    });
  };

  interface TreeTop {
    readonly row: RepositoryRow | FolderRow;
    readonly changed: number;
    readonly open: boolean;
    readonly children: readonly TreeRow[];
  }
  interface TreeModel {
    readonly repos: readonly TreeTop[];
    readonly folders: readonly TreeTop[];
    readonly isChanged: (path: string) => boolean;
    readonly signature: unknown;
  }

  /** The two trees, from live state: the index's roots, the palette's feed (the counts) and the listings read so far. */
  const treeModel = (feedEntries: readonly IndexEntry[], byPath: ReadonlyMap<string, IndexEntry>): TreeModel => {
    const p = palette()!;
    const changed = changedPredicate({
      session: p.session,
      nowMs: Date.now(),
      watched: (r) => handle.index.isWatched(r),
      baselineMs: (r) => handle.index.baselineMs(r),
    });
    // A root is a repository when its own checkout holds a `.git`: some entry of it is keyed to a checkout that is the root.
    const groupOf = new Map<string, string>();
    const probed = new Map<string, number>();
    for (const entry of handle.index.entries()) {
      if (groupOf.has(entry.root)) continue;
      const n = probed.get(entry.root) ?? 0;
      if (n >= GROUP_PROBE_CAP) continue;
      probed.set(entry.root, n + 1);
      const key = handle.index.checkoutKey(entry.path);
      if (key !== undefined && key.checkout === entry.root) groupOf.set(entry.root, key.group);
    }
    const split = splitRoots(handle.index.roots(), (root) => groupOf.get(root));
    const perGroup = changedByGroup(feedEntries, (path) => handle.index.checkoutKey(path), changed);
    const top = (row: RepositoryRow | FolderRow): TreeTop => {
      const open = expanded.has(row.root);
      return {
        row,
        changed: row.kind === 'repository' ? (perGroup.get(row.id) ?? 0) : 0,
        open,
        children: open ? visibleRows(row.root, expanded, listings) : [],
      };
    };
    const repos = split.repositories.map(top);
    const folders = split.folders.map(top);
    const isChanged = (path: string): boolean => {
      const entry = byPath.get(path);
      return entry !== undefined && changed(entry);
    };
    const signature = [repos, folders].map((tops) =>
      tops.map((t) => [t.row.id, t.row.name, t.row.root, t.row.kind === 'repository' ? t.row.checkouts.length : 0, t.changed, t.open, t.children.map((r) => [r.kind, r.path, r.depth, r.kind === 'dir' ? [r.expanded, r.loading] : r.kind === 'file' ? isChanged(r.path) : r.text])]),
    );
    return { repos, folders, isChanged, signature };
  };

  /** Lists `dir` with `readDir`, one level. A change that arrives while it reads asks for one more read after it. */
  const list = async (dir: string): Promise<void> => {
    if (reading.has(dir)) {
      readAgain.add(dir);
      return;
    }
    reading.add(dir);
    if (!listings.has(dir)) listings.set(dir, 'loading');
    try {
      const stats = await handle.shell.readDir(dir);
      if (!disposed && expanded.has(dir)) listings.set(dir, stats);
    } catch {
      if (!disposed && expanded.has(dir)) listings.set(dir, 'failed');
    } finally {
      reading.delete(dir);
      if (readAgain.delete(dir) && !disposed && expanded.has(dir)) void list(dir);
      else draw();
    }
  };

  const setOpen = (dir: string, open: boolean): void => {
    if (open === expanded.has(dir)) return;
    if (open) {
      expanded.add(dir);
      void list(dir);
    } else {
      // Closing a folder closes what was open under it, so opening it again lists the disk afresh.
      expanded = closeWithin(expanded, dir);
      for (const key of [...listings.keys()]) if (!expanded.has(key)) listings.delete(key);
    }
    draw();
  };

  /** Every open folder is listed again: after a walk that the watch did not patch (a refused watch, a rescan). */
  const relistOpen = (): void => {
    for (const dir of expanded) if (listings.has(dir)) void list(dir);
  };

  const openPath = (path: string, beside: boolean): void => {
    void handle.open(path, beside ? { target: 'other' } : undefined);
  };

  const runLibrary = async (): Promise<void> => {
    const command = libraryCommand();
    if (!command) return;
    const ctx: AppContext = buildAppContext(handle);
    try {
      if (command.when(ctx)) await command.run(ctx);
    } catch (error) {
      console.warn(`marxy: ${LIBRARY_COMMAND} failed from the sidebar`, error);
    }
  };

  const setCollapsed = (id: SidebarSectionId, all: boolean): void => {
    if (collapsed === null) return;
    // The click says what the clicked section does; with ⌥ every section does the same.
    const fold = !collapsed.has(id);
    const ids = all ? SIDEBAR_SECTIONS.map((s) => s.id) : [id];
    for (const each of ids) {
      if (fold) collapsed.add(each);
      else collapsed.delete(each);
    }
    void workspace.saveSections({ collapsed: SIDEBAR_SECTIONS.map((s) => s.id).filter((each) => collapsed!.has(each)) });
    draw(`header:${id}`);
  };

  const stopsOf = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('button[data-stop]')];

  /** One tab stop: the control with focus, else the first. */
  const rove = (): void => {
    const stops = stopsOf();
    const to = stops.find((b) => b === document.activeElement) ?? stops[0];
    for (const b of stops) b.tabIndex = b === to ? 0 : -1;
  };

  const stopFor = (key: string): HTMLButtonElement | undefined => stopsOf().find((b) => b.dataset.stop === key);

  /** Redraws when what it shows changed; `refocus` names the control that had focus, which a rebuild would lose. */
  function draw(refocus?: string): void {
    if (disposed || collapsed === null) return;
    const hadFocus = root.contains(document.activeElement);
    const focusKey = refocus ?? (document.activeElement as HTMLElement | null)?.dataset?.stop;
    // The palette's own list (one entry per path, under the scope's cap), so the foot agrees with the palette and the library.
    const feedEntries = palette()?.feed.entries() ?? [];
    const byPath = new Map<string, IndexEntry>();
    for (const entry of feedEntries) byPath.set(entry.path, entry);
    const sections = sectionsNow(byPath);
    const model = palette() ? treeModel(feedEntries, byPath) : null;
    const library = libraryCommand() !== undefined;
    const feedCount = feedEntries.length;
    // What the tree watches are now (live or refused), not what was declared; a walk under way hides the count.
    const watching = handle.index.watchState();
    const indexing = handle.index.indexing();
    const active = handle.panes().focused.path() ?? '';
    const rows = sections.map((s) => ({
      id: s.id,
      rows: s.rows.map((r) => [r.entry.path, r.entry.title, r.entry.mtimeMs, r.mark, relativeAge(Date.now(), r.entry.mtimeMs)]),
    }));
    const key = JSON.stringify([library, [...collapsed], rows, sectionsKeyKinds(sections), model?.signature ?? null, feedCount, watching, indexing, active]);
    if (key === drawn) return;
    drawn = key;
    root.replaceChildren();

    root.append(searchField());
    if (library) root.append(libraryRow());
    for (const section of sections) root.append(sectionNode(section, active));
    if (model) {
      if (model.repos.length > 0) root.append(treeSectionNode('repos', 'Repositories', model.repos, model.isChanged, byPath, active));
      if (model.folders.length > 0) root.append(treeSectionNode('folders', 'Folders', model.folders, model.isChanged, byPath, active));
    }
    if (indexing || feedCount > 0) root.append(footNode(feedCount, watching, indexing));
    rove();
    if (hadFocus && focusKey) (stopFor(focusKey) ?? stopsOf()[0])?.focus();
    rove();
  }

  const sectionsKeyKinds = (sections: readonly SidebarSection[]): string[] => sections.flatMap((s) => s.rows.map((r) => kindOf(r.entry)));

  /** The search field: it opens the palette, as ⌘K does. It is not a filter; the sidebar has none yet. */
  const searchField = (): HTMLElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'marxy-sidebar-search';
    button.dataset.stop = 'search';
    button.setAttribute('data-marxy-sidebar-search', '');
    button.setAttribute('aria-label', 'Search documents, opens the palette');
    button.setAttribute('aria-keyshortcuts', mac ? 'Meta+K' : 'Control+K');
    const label = document.createElement('span');
    label.className = 'marxy-sidebar-search-label';
    label.textContent = 'Search';
    const chip = document.createElement('kbd');
    chip.className = 'marxy-sidebar-chip';
    chip.textContent = mac ? '\u2318K' : 'Ctrl+K';
    chip.setAttribute('aria-hidden', 'true');
    button.append(toolbarIconElement(document, 'find'), label, chip);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => openPalette());
    return button;
  };

  /** The foot: how many documents the index holds and whether it is watching. Text, not a control. */
  const footNode = (count: number, watching: 'live' | 'refused' | 'none', indexing: boolean): HTMLElement => {
    const foot = document.createElement('div');
    foot.className = 'marxy-sidebar-foot';
    foot.setAttribute('data-marxy-sidebar-foot', '');
    // Only what is true: no count while a walk runs (it climbs), and "watching" only when a tree watch is open.
    // A refused watch says so in the palette's words (C-10.1, C-11).
    const watch = watching === 'live' ? ' \u00b7 watching' : watching === 'refused' ? ' \u00b7 not watching, rescanned when you open the palette' : '';
    foot.textContent = indexing ? 'Indexing\u2026' : `${count.toLocaleString('en-US')} ${count === 1 ? 'document' : 'documents'} indexed${watch}`;
    return foot;
  };

  const libraryRow = (): HTMLElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'marxy-sidebar-library';
    button.dataset.stop = 'library';
    button.setAttribute('data-marxy-sidebar-row', LIBRARY_COMMAND);
    button.textContent = 'Library';
    button.setAttribute('aria-label', libraryCommand()?.title ?? 'Library');
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => void runLibrary());
    return button;
  };

  /** A section's header button: it folds the section; folded, it keeps a quiet count. */
  const headerNode = (id: SidebarSectionId, title: string, spoken: string, count: number): HTMLButtonElement => {
    const folded = collapsed!.has(id);
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'marxy-sidebar-head';
    header.dataset.stop = `header:${id}`;
    header.setAttribute('aria-expanded', String(!folded));
    header.setAttribute('aria-label', `${title}, ${spoken}`);
    header.title = `${title}. ${mac ? '⌥' : 'Alt'}-click ${folded ? 'opens' : 'folds'} every section`;
    const label = document.createElement('span');
    label.className = 'marxy-sidebar-title';
    label.textContent = title;
    const chevron = toolbarIconElement(document, 'chevron');
    chevron.classList.add('marxy-sidebar-chevron');
    header.append(chevron, label);
    if (folded) {
      const quiet = document.createElement('span');
      quiet.className = 'marxy-sidebar-count';
      quiet.textContent = String(count);
      quiet.setAttribute('aria-hidden', 'true');
      header.append(quiet);
    }
    header.addEventListener('mousedown', (event) => event.preventDefault());
    header.addEventListener('click', (event) => setCollapsed(id, event.altKey));
    return header;
  };

  const sectionNode = (section: SidebarSection, active: string): HTMLElement => {
    const folded = collapsed!.has(section.id);
    const node = document.createElement('section');
    node.className = 'marxy-sidebar-section';
    node.setAttribute('data-marxy-sidebar-section', section.id);
    const count = section.rows.length;
    node.append(headerNode(section.id, section.title, `${count} ${count === 1 ? 'document' : 'documents'}`, count));
    if (folded) return node;

    const list = document.createElement('ul');
    list.className = 'marxy-sidebar-list';
    const now = Date.now();
    for (const row of section.rows) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `marxy-sidebar-row marxy-sidebar-row-${row.mark}`;
      button.dataset.stop = `row:${section.id}:${row.entry.path}`;
      button.setAttribute('data-marxy-sidebar-row', row.entry.path);
      button.title = row.entry.path;
      if (row.entry.path === active) button.setAttribute('aria-current', 'true');
      const age = relativeAge(now, row.entry.mtimeMs);
      button.setAttribute('aria-label', `${row.entry.title}${MARK_WORDS[row.mark]}${age === '' ? '' : `, ${spokenAge(age)}`}`);
      const kind = kindOf(row.entry);
      const name = document.createElement('span');
      name.className = 'marxy-sidebar-name';
      name.textContent = row.entry.title;
      const quiet = document.createElement('span');
      quiet.className = 'marxy-sidebar-age';
      quiet.textContent = age;
      quiet.setAttribute('aria-hidden', 'true');
      button.append(kindIconElement(document, kind, kind === 'code' ? langOfPath(row.entry.path) : undefined), name);
      if (age !== '') button.append(quiet);
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => openPath(row.entry.path, mac ? event.metaKey : event.ctrlKey));
      item.append(button);
      list.append(item);
    }
    node.append(list);
    return node;
  };

  /** One tree row: a button that is the `treeitem`; `depth` is its `aria-level` (the section's own rows are level 1). */
  const nodeButton = (sectionId: SidebarSectionId, path: string, depth: number, name: string, spoken: string, open: boolean | null): { item: HTMLLIElement; button: HTMLButtonElement; label: HTMLSpanElement } => {
    const item = document.createElement('li');
    item.setAttribute('role', 'none');
    // The guides: one rule per level above this row, drawn on the item so a hovered button keeps them.
    item.style.backgroundSize = `${(depth - 1) * TREE_STEP_EM}em 100%`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'marxy-sidebar-node';
    button.dataset.stop = `tree:${sectionId}:${path}`;
    button.setAttribute('role', 'treeitem');
    button.setAttribute('aria-level', String(depth));
    if (open !== null) button.setAttribute('aria-expanded', String(open));
    button.setAttribute('data-marxy-sidebar-row', path);
    button.setAttribute('data-marxy-sidebar-depth', String(depth));
    button.setAttribute('aria-label', spoken);
    button.title = path;
    button.style.paddingInlineStart = `${0.6 + (depth - 1) * TREE_STEP_EM}em`;
    const chevron = document.createElement('span');
    chevron.className = 'marxy-sidebar-chevron marxy-sidebar-node-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    if (open !== null) chevron.append(toolbarIconElement(document, 'chevron'));
    const label = document.createElement('span');
    label.className = 'marxy-sidebar-name';
    label.textContent = name;
    button.append(chevron);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    item.append(button);
    return { item, button, label };
  };

  const quiet = (text: string, extra = ''): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = `marxy-sidebar-age${extra}`;
    span.textContent = text;
    span.setAttribute('aria-hidden', 'true');
    return span;
  };

  const treeSectionNode = (
    id: 'repos' | 'folders',
    title: string,
    tops: readonly TreeTop[],
    isChanged: (path: string) => boolean,
    byPath: ReadonlyMap<string, IndexEntry>,
    active: string,
  ): HTMLElement => {
    const node = document.createElement('section');
    node.className = 'marxy-sidebar-section';
    node.setAttribute('data-marxy-sidebar-section', id);
    const count = tops.length;
    const noun = id === 'repos' ? (count === 1 ? 'repository' : 'repositories') : count === 1 ? 'folder' : 'folders';
    node.append(headerNode(id, title, `${count} ${noun}`, count));
    if (collapsed!.has(id)) return node;

    const tree = document.createElement('ul');
    tree.className = 'marxy-sidebar-list marxy-sidebar-tree';
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', title);
    tree.setAttribute('data-marxy-sidebar-tree', id);
    for (const top of tops) {
      const row = top.row;
      const bits: string[] = [row.kind === 'repository' ? 'repository' : 'folder'];
      if (row.kind === 'repository' && row.checkouts.length > 1) bits.push(`${row.checkouts.length} checkouts`);
      if (top.changed > 0) bits.push(`${top.changed} changed since you read`);
      const { item, button, label } = nodeButton(id, row.root, 1, row.name, [row.name, ...bits].join(', '), top.open);
      button.classList.add('marxy-sidebar-node-top');
      button.append(toolbarIconElement(document, row.kind === 'repository' ? 'branch' : 'folder'), label);
      if (row.kind === 'repository' && row.checkouts.length > 1) button.append(quiet(`${row.checkouts.length} checkouts`));
      if (top.changed > 0) button.append(quiet(String(top.changed), ' marxy-sidebar-badge'));
      button.addEventListener('click', () => setOpen(row.root, !top.open));
      tree.append(item);
      for (const child of top.children) tree.append(childNode(id, child, isChanged, byPath, active));
    }
    node.append(tree);
    return node;
  };

  const childNode = (id: SidebarSectionId, row: TreeRow, isChanged: (path: string) => boolean, byPath: ReadonlyMap<string, IndexEntry>, active: string): HTMLLIElement => {
    if (row.kind === 'note') {
      const item = document.createElement('li');
      item.setAttribute('role', 'none');
      const text = document.createElement('span');
      text.className = 'marxy-sidebar-note';
      text.style.paddingInlineStart = `${0.6 + (row.depth - 1) * TREE_STEP_EM}em`;
      text.textContent = row.text;
      item.append(text);
      return item;
    }
    if (row.kind === 'dir') {
      const { item, button, label } = nodeButton(id, row.path, row.depth, row.name, `${row.name}, folder${row.loading ? ', loading' : ''}`, row.expanded);
      if (row.loading) button.setAttribute('aria-busy', 'true');
      button.append(toolbarIconElement(document, 'folder'), label);
      button.addEventListener('click', () => setOpen(row.path, !row.expanded));
      return item;
    }
    const changed = isChanged(row.path);
    const { item, button, label } = nodeButton(id, row.path, row.depth, row.name, `${row.name}${changed ? ', changed since you read' : ''}`, null);
    if (row.path === active) button.setAttribute('aria-current', 'true');
    // The glyph is the index's word for the kind where it holds the file, else a guess from the name; no file is read to draw a row.
    const entry = byPath.get(row.path);
    const kind: Kind = entry ? kindOf(entry) : langOfPath(row.path) !== undefined ? 'code' : 'article';
    button.append(kindIconElement(document, kind, kind === 'code' ? langOfPath(row.path) : undefined), label);
    if (changed) {
      const mark = document.createElement('span');
      mark.className = 'marxy-sidebar-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = '\u25cf';
      button.append(mark);
    }
    button.addEventListener('click', (event) => openPath(row.path, mac ? event.metaKey : event.ctrlKey));
    return item;
  };

  root.addEventListener('keydown', (event) => {
    const stops = stopsOf();
    const at = stops.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const mod = mac ? event.metaKey : event.ctrlKey;
    const isFileRow = stops[at]!.classList.contains('marxy-sidebar-row') || (stops[at]!.getAttribute('role') === 'treeitem' && !stops[at]!.hasAttribute('aria-expanded'));
    if (event.key === 'Enter' && mod && isFileRow) {
      event.preventDefault();
      openPath(stops[at]!.getAttribute('data-marxy-sidebar-row')!, true);
      return;
    }
    const focused = stops[at]!;
    const go = (target: HTMLButtonElement | undefined): void => {
      if (!target) return;
      event.preventDefault();
      for (const b of stops) b.tabIndex = b === target ? 0 : -1;
      target.focus();
    };
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      const right = event.key === 'ArrowRight';
      if (focused.getAttribute('role') === 'treeitem') {
        // The tree's keys: → opens a closed folder, or steps into an open one; ← closes an open folder, or steps out to its parent.
        const level = Number(focused.getAttribute('aria-level'));
        const path = focused.getAttribute('data-marxy-sidebar-row')!;
        const state = focused.getAttribute('aria-expanded');
        if (right && state === 'false') {
          event.preventDefault();
          setOpen(path, true);
        } else if (right && state === 'true') {
          const next = stops[at + 1];
          if (next && Number(next.getAttribute('aria-level')) > level) go(next);
        } else if (!right && state === 'true') {
          event.preventDefault();
          setOpen(path, false);
        } else if (!right) {
          go([...stops.slice(0, at)].reverse().find((b) => b.getAttribute('role') === 'treeitem' && Number(b.getAttribute('aria-level')) < level));
        }
        return;
      }
      if (focused.classList.contains('marxy-sidebar-head')) {
        // A header: → opens its section, ← folds it.
        const id = focused.dataset.stop!.slice('header:'.length) as SidebarSectionId;
        const folded = focused.getAttribute('aria-expanded') === 'false';
        if (right === folded) {
          event.preventDefault();
          setCollapsed(id, false);
        }
        return;
      }
    }
    const to =
      event.key === 'ArrowDown' ? stops[Math.min(at + 1, stops.length - 1)]
      : event.key === 'ArrowUp' ? stops[Math.max(at - 1, 0)]
      : event.key === 'Home' ? stops[0]
      : event.key === 'End' ? stops.at(-1)
      : undefined;
    if (!to) return;
    event.preventDefault();
    for (const b of stops) b.tabIndex = b === to ? 0 : -1;
    to.focus();
  });

  // What changes the lists: a document opened (the session), the index patched (the feed), a pin made in the palette
  // (the session, seen when the pointer or focus comes back here: the palette announces nothing).
  const refresh = (): void => draw();
  const attach = (): void => {
    const p = palette();
    if (!p) {
      if (waiting === null && !disposed) {
        waiting = setTimeout(() => {
          waiting = null;
          attach();
        }, PALETTE_WAIT_MS);
      }
      return;
    }
    if (feedOf !== p.feed) {
      offFeed?.();
      feedOf = p.feed;
      offFeed = p.feed.subscribe(refresh);
    }
    draw();
  };
  // The foot follows the watch state and the walks, which the feed does not announce.
  const offWatched = handle.index.onWatchedRootsChange(refresh);
  const offStatus = handle.index.onStatusChange(() => {
    // A walk that ended may have changed what is on disk without a watch patch to say so: the open folders list again.
    const now = handle.index.indexing();
    if (wasIndexing && !now) relistOpen();
    wasIndexing = now;
    draw();
  });
  // An open folder lists again when the index reports a path appearing or going away under it (a patch from the watch);
  // a changed file changes no name and costs no read.
  const offIndex = handle.index.subscribe((_entries, patch) => {
    if (!patch) return;
    for (const dir of staleDirs(listings, patch.upserted.map((e) => e.path), patch.removed)) if (expanded.has(dir)) void list(dir);
  });
  const offSignal = signal.onChange(() => {
    attach();
  });
  const looked = (): void => {
    const p = palette();
    if (p && p.session !== sessionSeen) {
      sessionSeen = p.session;
      draw();
    }
  };
  root.addEventListener('pointerenter', looked);
  root.addEventListener('focusin', looked);

  void workspace.loadSections().then((state) => {
    if (disposed) return;
    collapsed = new Set(state.collapsed);
    attach();
  });

  return () => {
    disposed = true;
    if (waiting !== null) clearTimeout(waiting);
    offFeed?.();
    offSignal();
    offWatched();
    offStatus();
    offIndex();
    root.remove();
  };
}
