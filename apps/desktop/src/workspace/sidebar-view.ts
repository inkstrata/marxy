// The sidebar (W-07; ADR-0058): the `sidebar` region while it is shown, unfolded or peeking. Two foldable sections,
// Recent and Pinned (the changed files after the pinned), drawn from `sidebarSections` over the palette's feed and
// session; a *Library* row above them when the command `library.open` is registered (Q-03). Layout is base.css
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
import { buildAppContext } from '../selection/bind.ts';
import { SIDEBAR_SECTIONS, sidebarSections, type SidebarMark, type SidebarSection } from './sidebar.ts';
import type { DocumentSignal } from './toolbar.ts';

const LIBRARY_COMMAND = 'library.open';
/** How often a sidebar made before the palette looks for it. The palette mounts within the launch, so this ends at once. */
const PALETTE_WAIT_MS = 200;

const isMac = (): boolean => typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

const kindOf = (entry: IndexEntry): Kind => entry.readerKind ?? (entry.kind === 'source' ? 'code' : 'article');

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

  const libraryCommand = (): Command | undefined =>
    (handle.commands() as readonly Command[]).find((c) => c.id === LIBRARY_COMMAND);

  const sectionsNow = (): readonly SidebarSection[] => {
    const p = palette();
    if (!p) return [];
    const byPath = new Map<string, IndexEntry>();
    for (const entry of p.feed.entries()) byPath.set(entry.path, entry);
    return sidebarSections({
      entriesByPath: byPath,
      session: p.session,
      nowMs: Date.now(),
      watched: (r) => handle.index.isWatched(r),
      baselineMs: (r) => handle.index.baselineMs(r),
    });
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
    const sections = sectionsNow();
    const library = libraryCommand() !== undefined;
    const rows = sections.map((s) => ({
      id: s.id,
      rows: s.rows.map((r) => [r.entry.path, r.entry.title, r.entry.mtimeMs, r.mark, relativeAge(Date.now(), r.entry.mtimeMs)]),
    }));
    const key = JSON.stringify([library, [...collapsed], rows, sectionsKeyKinds(sections)]);
    if (key === drawn) return;
    drawn = key;
    root.replaceChildren();

    if (library) root.append(libraryRow());
    for (const section of sections) root.append(sectionNode(section));
    rove();
    if (hadFocus && focusKey) (stopFor(focusKey) ?? stopsOf()[0])?.focus();
    rove();
  }

  const sectionsKeyKinds = (sections: readonly SidebarSection[]): string[] => sections.flatMap((s) => s.rows.map((r) => kindOf(r.entry)));

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

  const sectionNode = (section: SidebarSection): HTMLElement => {
    const folded = collapsed!.has(section.id);
    const node = document.createElement('section');
    node.className = 'marxy-sidebar-section';
    node.setAttribute('data-marxy-sidebar-section', section.id);
    const count = section.rows.length;
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'marxy-sidebar-head';
    header.dataset.stop = `header:${section.id}`;
    header.setAttribute('aria-expanded', String(!folded));
    header.setAttribute('aria-label', `${section.title}, ${count} ${count === 1 ? 'document' : 'documents'}`);
    header.title = `${section.title}. ${mac ? '⌥' : 'Alt'}-click ${folded ? 'opens' : 'folds'} every section`;
    const title = document.createElement('span');
    title.className = 'marxy-sidebar-title';
    title.textContent = section.title;
    header.append(title);
    if (folded) {
      const quiet = document.createElement('span');
      quiet.className = 'marxy-sidebar-count';
      quiet.textContent = String(count);
      quiet.setAttribute('aria-hidden', 'true');
      header.append(quiet);
    }
    header.addEventListener('mousedown', (event) => event.preventDefault());
    header.addEventListener('click', (event) => setCollapsed(section.id, event.altKey));
    node.append(header);
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

  root.addEventListener('keydown', (event) => {
    const stops = stopsOf();
    const at = stops.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const mod = mac ? event.metaKey : event.ctrlKey;
    if (event.key === 'Enter' && mod && stops[at]!.classList.contains('marxy-sidebar-row')) {
      event.preventDefault();
      openPath(stops[at]!.getAttribute('data-marxy-sidebar-row')!, true);
      return;
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
    root.remove();
  };
}
