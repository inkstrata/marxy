// The pane head's address: the place the file is in, its folders, the file, then the chain of
// headings the reading line is under, which follows the page as it scrolls. Pressing a step opens what sits beside it:
// a folder's entries, the file's neighbours in its folder, a heading's sibling headings. Choosing one goes there.
import { outlineFrom, type Document } from '@marxy/core';
import { besideIn, folderOrder } from '@marxy/core/src/index-model/folder-order.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../app-types.ts';
import { documentName } from '../document/untitled.ts';
import { folderSteps, headingChain, siblingHeadings, type FolderStep, type HeadingMark } from './address.ts';
import { folderUnread, openFolderPage } from './folder-page.ts';
import { anchorBelow, openMenu, type MenuItem } from './menu.ts';
import { setMarked } from './model/metadata-marks.ts';
import { isTransient } from './tabs.ts';
import type { ViewerCrumb } from '../viewers/types.ts';
import type { Frame, FramePane } from './types.ts';

/** The most entries a folder's menu lists; the folder's page lists the rest. */
const MENU_MAX = 200;

const headingCache = new WeakMap<Document, HeadingMark[]>();

/** The document's headings by where they start, read once per parse. */
export function headingsOf(ast: Document | null | undefined): readonly HeadingMark[] {
  if (!ast) return [];
  let marks = headingCache.get(ast);
  if (!marks) {
    marks = outlineFrom(ast)
      .map((e) => ({ level: e.level, text: e.text, start: e.src.start }))
      .sort((a, b) => a.start - b.start);
    headingCache.set(ast, marks);
  }
  return marks;
}

export interface Crumbs {
  readonly el: HTMLElement;
  render(): void;
  destroy(): void;
}

export function mountCrumbs(pane: FramePane, handle: AppHandle, frame: Frame): Crumbs {
  const el = document.createElement('nav');
  el.className = 'marxy-crumbs';
  el.setAttribute('aria-label', 'Where this is');
  const panes = () => handle.panes();
  let drawnPlace = '';
  let drawnChain = '';
  let placeEnd: Node | null = null;

  const sep = (): HTMLElement => {
    const s = document.createElement('span');
    s.className = 'marxy-crumb-sep';
    s.setAttribute('aria-hidden', 'true');
    s.textContent = '›';
    return s;
  };

  function crumb(kind: 'root' | 'dir' | 'file' | 'section' | 'more', label: string, title: string, menu: (at: HTMLElement) => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'marxy-crumb';
    b.setAttribute('data-marxy-crumb', kind);
    setMarked(b, label);
    b.title = title;
    b.setAttribute('aria-haspopup', 'menu');
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (panes().focused !== pane) panes().focus(pane);
      menu(b);
    });
    return b;
  }

  async function openHere(path: string): Promise<void> {
    if (panes().focused !== pane) panes().focus(pane);
    await panes().openIn(pane.slot, path);
  }

  /** A folder's entries, folders first; `here` is marked. `filesOnly` lists the file's neighbours. */
  async function folderMenu(at: HTMLElement, dir: string, here: string | null, filesOnly: boolean): Promise<void> {
    let entries: { path: string; isDir: boolean }[];
    try {
      // A crumb pressed is the reader's choice of that folder: the shell lists it once told (read-only).
      await handle.shell.markOpened?.(dir, 'root').catch(() => undefined);
      entries = (await handle.shell.readDir(dir)).map((s) => ({ path: s.path, isDir: s.isDir }));
    } catch (e) {
      openMenu(anchorBelow(at), `${basename(dir) || dir}/`, [{ title: folderUnread(dir, e), note: true }]);
      return;
    }
    if (!at.isConnected) return;
    entries = folderOrder(entries);
    // The keys that step to the file's neighbours are said beside them.
    const near = filesOnly && here !== null ? besideIn(entries, here) : null;
    const items: MenuItem[] = [];
    if (filesOnly) items.push({ title: 'What this file is', detail: 'in Metadata', run: () => frame.showPanel({ card: 'facts' }) });
    items.push({ title: 'Read this folder as a page', run: () => openFolderPage(handle, dir) });
    const shown = entries.filter((e) => !filesOnly || !e.isDir);
    for (const e of shown.slice(0, MENU_MAX)) {
      const name = basename(e.path);
      items.push(
        e.isDir
          ? { title: `${name}/`, detail: 'folder', run: () => openFolderPage(handle, e.path) }
          : { title: name, detail: e.path === here ? 'here' : e.path === near?.previous ? 'g [' : e.path === near?.next ? 'g ]' : undefined, run: () => openHere(e.path) },
      );
    }
    if (shown.length > MENU_MAX) items.push({ title: `${shown.length - MENU_MAX} more · the folder's page lists every one`, note: true });
    if (shown.length === 0) items.push({ title: 'Nothing else is here', note: true });
    openMenu(anchorBelow(at), `${basename(dir) || dir}/`, items);
  }

  function sectionMenu(at: HTMLElement, path: string, headings: readonly HeadingMark[], i: number): void {
    const items: MenuItem[] = siblingHeadings(headings, i).map((j) => ({
      title: headings[j]!.text || '(untitled heading)',
      detail: j === i ? 'here' : undefined,
      run: async () => {
        if (panes().focused !== pane) panes().focus(pane);
        await handle.open(path, { at: headings[j]!.start });
      },
    }));
    openMenu(anchorBelow(at), 'Beside this section', items);
  }

  function readingByte(): number | null {
    if (pane.path() === null || pane.view.document() === null) return null;
    try {
      return pane.view.position().byteOffset;
    } catch {
      return null;
    }
  }

  function drawPlace(path: string | null): void {
    el.replaceChildren();
    placeEnd = null;
    drawnChain = '';
    if (path === null) return;
    if (isTransient(path)) {
      const label = pane.content.scratchLabel() ?? documentName(path);
      const file = crumb('file', label, label, () => frame.showPanel({ card: 'facts' }));
      el.append(file);
      placeEnd = file;
      return;
    }
    const steps: FolderStep[] = folderSteps(path, handle.index.roots());
    steps.forEach((s, i) => {
      el.append(crumb(i === 0 ? 'root' : 'dir', s.label, s.dir, (at) => void folderMenu(at, s.dir, path, false)), sep());
    });
    const dir = steps[steps.length - 1]?.dir ?? '';
    const file = crumb('file', basename(path) || path, `${path} · what is beside it`, (at) => void (dir ? folderMenu(at, dir, path, true) : frame.showPanel({ card: 'facts' })));
    file.setAttribute('aria-current', 'page');
    el.append(file);
    placeEnd = file;
  }

  /** A page of the app's own with contents (a book): its chain, from the viewer, each step's menu its own siblings. */
  function drawViewerChain(path: string, steps: readonly ViewerCrumb[]): void {
    const key = `v:${steps.map((s) => s.key).join(',')}`;
    if (key === drawnChain || placeEnd === null) return;
    drawnChain = key;
    while (placeEnd.nextSibling) placeEnd.nextSibling.remove();
    for (const s of steps) {
      el.append(
        sep(),
        crumb('section', s.text || '(untitled)', s.text, (b) => {
          const items: MenuItem[] = s.beside().map((x) => ({ title: x.title || '(untitled)', detail: x.here ? 'here' : undefined, run: () => x.go() }));
          openMenu(anchorBelow(b), `Beside this in ${basename(path)}`, items);
        }),
      );
    }
    fit();
  }

  function drawChain(): void {
    const path = pane.path();
    if (path === null || placeEnd === null) return;
    const viewer = pane.view.viewer();
    if (viewer?.chain) return drawViewerChain(path, viewer.chain());
    // A code file's Markdown parse waits for the first ask for Rendered: its headings are none until then.
    const headings = pane.content.store()?.parsed() ? headingsOf(pane.view.document()?.ast) : [];
    const at = readingByte();
    const chain = at === null || pane.view.viewer() !== null ? [] : headingChain(headings, at);
    const key = chain.map((i) => headings[i]!.start).join(',');
    if (key === drawnChain) return;
    drawnChain = key;
    while (placeEnd.nextSibling) placeEnd.nextSibling.remove();
    for (const i of chain) {
      const h = headings[i]!;
      el.append(sep(), crumb('section', h.text || '(untitled heading)', h.text, (b) => sectionMenu(b, path, headings, i)));
    }
    fit();
  }

  /** Short of room, whole steps go from the left (folders, then outer headings), never every name cut to a stub. */
  let fitQueued = false;
  function fit(): void {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => {
      fitQueued = false;
      el.querySelector('[data-marxy-crumb="more"]')?.nextElementSibling?.remove();
      el.querySelector('[data-marxy-crumb="more"]')?.remove();
      const kids = [...el.children] as HTMLElement[];
      for (const k of kids) k.hidden = false;
      // What the steps would take uncut (each shrinks to fit, so the row itself never overflows).
      const over = (): boolean => kids.reduce((w, k) => w + (k.hidden ? 0 : k.scrollWidth), 0) > el.clientWidth + 1;
      if (!over()) return;
      const folders = kids.filter((k) => k.dataset.marxyCrumb === 'root' || k.dataset.marxyCrumb === 'dir');
      const sections = kids.filter((k) => k.dataset.marxyCrumb === 'section');
      const hide = (k: HTMLElement): void => {
        k.hidden = true;
        const s = k.nextElementSibling as HTMLElement | null;
        const before = k.previousElementSibling as HTMLElement | null;
        if (s?.classList.contains('marxy-crumb-sep')) s.hidden = true;
        else if (before?.classList.contains('marxy-crumb-sep')) before.hidden = true;
      };
      let gone: HTMLElement | null = null;
      for (const f of folders) {
        if (!over()) break;
        hide(f);
        gone = f;
      }
      for (const s of sections.slice(0, -1)) {
        if (!over()) break;
        hide(s);
      }
      if (gone) {
        const dir = gone.title;
        const more = crumb('more', '…', `${dir} and the folders above it`, (at) => void folderMenu(at, dir, pane.path(), false));
        el.prepend(more, sep());
      }
    });
  }

  function render(): void {
    const path = pane.path();
    const place = `${path}\n${isTransient(path ?? '') ? pane.content.scratchLabel() : ''}\n${handle.index.roots().join('\n')}`;
    if (place !== drawnPlace) {
      drawnPlace = place;
      drawPlace(path);
    }
    // The chain a frame later, as a scroll draws it: read now, the reading place is measured on the page being left, a
    // layout of the whole of it (over 100 ms for a 1 MB page) inside the document change.
    queueChain();
    fit();
  }

  // The chain follows the reading line, a frame at most per scroll, and redraws only when it changes.
  let scrollQueued = false;
  function queueChain(): void {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      drawChain();
    });
  }
  const onScroll = (e: Event): void => {
    const t = e.target;
    if (t === document || t === pane.host || (t instanceof Node && pane.host.contains(t))) queueChain();
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit());
  resized?.observe(el);
  // A folder becomes a place after its file is shown (a viewer's, at idle): the steps are drawn again from it.
  const offIndex = handle.index.subscribe(() => render());

  return {
    el,
    render,
    destroy() {
      document.removeEventListener('scroll', onScroll, { capture: true });
      resized?.disconnect();
      offIndex();
      el.remove();
    },
  };
}
