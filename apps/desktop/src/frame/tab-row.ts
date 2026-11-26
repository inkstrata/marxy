// The window's one row of tabs: every open document once, across the top. The tab the focused pane
// shows is the current one, a tab another pane shows is marked as visible, an unsaved one says so. A press shows a tab
// in the focused pane; a middle click or Alt+W closes it; a drag reorders it, or drops it on a pane to show it there.
// The row fits by fair share: tabs keep their width while there is room, then every tab wider than one common
// width is cut to it, down to a floor, after which the strip scrolls, fading at an edge with more beyond it. At the
// row's right end: every tab when some are out of the row, find a file, and split. It follows
// what each pane lands on (a refused open leaves no tab) and leads only through the pane set's own open, so unsaved
// edits are always asked about.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { hasMarks, markedNode } from './model/metadata-marks.ts';
import type { AppHandle } from '../app-types.ts';
import { discardAll, openChangesPage } from '../changes/page.ts';
import { writeCopy } from '../commands/copy-write.ts';
import { compareTwoFiles } from '../commands/compare.ts';
import { splitSame } from '../commands/pane-split-same.ts';
import type { DocumentStore } from '../document/store.ts';
import { documentName } from '../document/untitled.ts';
import { onHeld, saveHeld, unseenHeld } from '../left/held.ts';
import { GONE, goneMark } from '../notices/disk.ts';
import { notify } from '../notices/index.ts';
import { onProposals, proposalOn } from '../proposals/state.ts';
import { buildAppContext } from '../selection/bind.ts';
import { chordText } from './branch-info.ts';
import { icon } from './icons.ts';
import { intend, takeIntent } from './intent.ts';
import { anchorBelow, openMenu, type MenuItem } from './menu.ts';
import { cutName, fairShare, folderHints, graphemesOf, isTransient, type Cut } from './tabs.ts';
import type { Frame, FramePane, TabRow } from './types.ts';
import { WINDOW_TAB_CAP, WindowTabs, type WindowTab } from './window-tabs.ts';

const TAB_DRAG = 'application/x-marxy-tab';
/** The row's height; frame.ts writes it as --marxy-frame-tabs, 0 when folded. */
export const TABS_H = 36;
/** What a same-name folder hint keeps when its tab is cut: a few letters and the ellipsis. */
const HINT_MIN = 30;

function button(className: string, label: string, child?: Node): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.setAttribute('aria-label', label);
  b.title = label;
  if (child) b.append(child);
  // A press in the row never takes focus or the selection from the page.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  return b;
}

const nameOf = (path: string): string => (isTransient(path) ? documentName(path) : basename(path) || path);

/** What the fit needs to know of a tab's name: its text, and whether it is set in italic (a glance). */
interface NameInfo {
  readonly el: HTMLElement;
  readonly text: string;
  readonly italic: boolean;
}

/** Puts `words` in `into`, a dotfile's dot quiet and any flagged character drawn as a mark. */
function lit(into: HTMLElement, words: string, whole: string): void {
  if (words.startsWith('.') && whole.startsWith(words) && whole.length > 1) {
    const dot = document.createElement('span');
    dot.className = 'marxy-tab-dot';
    dot.textContent = '.';
    into.append(dot, markedNode(words.slice(1)));
  } else into.append(markedNode(words));
}

/**
 * Draws `text` into the name: whole, or cut as a head and a tail that join to the whole name. The head box is `head` px,
 * the width of the glyphs it shows and the ellipsis, so the ellipsis touches the tail.
 */
function drawName(name: HTMLElement, text: string, cut: Cut | null, head = 0): void {
  name.replaceChildren();
  name.removeAttribute('data-marxy-cut');
  if (!cut) {
    lit(name, text, text);
    return;
  }
  name.setAttribute('data-marxy-cut', '');
  const box = document.createElement('span');
  box.className = 'marxy-tab-cut';
  const headEl = document.createElement('span');
  headEl.className = 'marxy-tab-head';
  lit(headEl, cut.head, text);
  const tailEl = document.createElement('span');
  tailEl.className = 'marxy-tab-tail';
  // No head shown: text-overflow always draws a line's first glyph, so the head goes unseen and the tail leads with
  // the ellipsis itself (`…deploy.txt`).
  if (cut.shown === 0 && cut.tail !== '') {
    headEl.classList.add('marxy-tab-nohead');
    tailEl.classList.add('marxy-tab-lead');
  } else if (head > 0) headEl.style.width = `${head}px`;
  if (cut.tail.length > 1 && cut.tail.startsWith('.')) {
    // An extension alone after the ellipsis read as four dots (`auth-refac….md`): its dot is kept in the text, unseen,
    // and the extension is quiet.
    tailEl.classList.add('marxy-tab-ext');
    const dot = document.createElement('span');
    dot.className = 'marxy-tab-xdot';
    dot.textContent = '.';
    tailEl.append(dot, markedNode(cut.tail.slice(1)));
  } else tailEl.append(markedNode(cut.tail));
  box.append(headEl, tailEl);
  name.append(box);
}

const folderOf = (path: string): string => {
  const segs = path.split(/[\\/]/).filter((x) => x !== '');
  return segs.length > 1 ? segs[segs.length - 2]! : '';
};

export function mountTabRow(handle: AppHandle, frame: () => Frame): TabRow {
  const model = new WindowTabs();
  const panes = () => handle.panes();
  const el = document.createElement('div');
  el.className = 'marxy-tabbar';

  const strip = document.createElement('div');
  strip.className = 'marxy-tabs';
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Tabs');
  const grow = document.createElement('span');
  grow.className = 'marxy-tabbar-grow';
  const allTabs = button('marxy-tabs-all', 'All tabs', icon('down'));
  allTabs.setAttribute('aria-haspopup', 'menu');
  allTabs.hidden = true;
  const outCount = document.createElement('span');
  outCount.className = 'marxy-tabs-all-n';
  allTabs.prepend(outCount);
  const plus = button('marxy-tab-new', `Find a file to open (${chordText('Mod+K')})`, icon('plus'));
  const split = button('marxy-tabbar-split', 'Split: show this beside', icon('split'));
  const dropAt = document.createElement('span');
  dropAt.className = 'marxy-tab-drop';
  dropAt.hidden = true;
  el.append(strip, allTabs, grow, plus, split, dropAt);
  document.body.prepend(el);
  const names = new WeakMap<HTMLElement, NameInfo>();
  let hints = new Map<string, string>();

  /** What each slot last showed, and through which store: a new path through the same store is a rename. */
  const last = new Map<number, { path: string | null; store: unknown }>();
  /** Where each pane was in each document it left from the row or the head (`slot\npath`), for coming back to it. */
  const places = new Map<string, number>();
  let drawn = '';

  const paneAt = (slot: number): FramePane | undefined => panes().panes.find((p) => p.slot === slot);
  const placeKey = (slot: number, path: string): string => `${slot}\n${path}`;

  /** Notes where `pane` is in what it shows now, before it is moved off it. */
  function remember(pane: FramePane): void {
    const path = pane.path();
    if (path === null || pane.view.viewer()?.binary === true) return;
    places.set(placeKey(pane.slot, path), pane.view.position().byteOffset);
  }

  async function openAt(pane: FramePane, path: string, how: 'activate' | 'back' | 'forward', tabId?: number, landed?: () => void): Promise<boolean> {
    remember(pane);
    intend(pane.host, path, how, tabId);
    const at = places.get(placeKey(pane.slot, path));
    await panes().openIn(pane.slot, path, {
      at,
      onLanded: () => {
        panes().focus(pane);
        landed?.();
      },
    });
    return pane.path() === path;
  }

  /** A file with unsaved changes no pane shows (a replace staged it, left/held.ts): its tab is marked unsaved too. */
  const heldAt = (path: string): DocumentStore | null => unseenHeld(handle).find((s) => s.snapshot().path === path) ?? null;
  const dirtyPath = (path: string): boolean => panes().panes.some((p) => p.path() === path && p.content.hasUnsavedChanges()) || heldAt(path) !== null;
  const offHeld = onHeld(() => {
    model.adopt(unseenHeld(handle).map((s) => s.snapshot().path));
    render();
  });

  const row: TabRow = {
    el,
    model,
    async show(id, o) {
      const tab = model.byId(id);
      const pane = o?.slot !== undefined ? paneAt(o.slot) : panes().focused;
      if (!tab || !pane) return;
      if (pane.path() === tab.path) {
        panes().focus(pane);
        return;
      }
      const partner = tab.pair;
      if (!(await openAt(pane, tab.path, 'activate', id))) return;
      if (o?.alone || partner === null || !proposalOn('pairs') || panes().panes.length < 2) return;
      // Pairs: the tab's partner comes back beside it, if the row still has it; alone, so it does not undo this one.
      const other = panes().panes.find((p) => p !== pane);
      const back = model.byPath(partner);
      if (!other || !back || other.path() === partner) return;
      await row.show(back.id, { slot: other.slot, alone: true });
      panes().focus(pane);
    },
    async close(id) {
      const tab = model.byId(id);
      if (!tab) return;
      const showing = panes().panes.filter((p) => p.path() === tab.path);
      const held = showing.length === 0 ? heldAt(tab.path) : null;
      if (held) {
        // Its changes live only in the store the tab stands for: they are saved or let go first.
        notify({
          kind: 'refused',
          text: `${nameOf(tab.path)} has changes that are not saved, and no pane shows it · save them or discard them first`,
          actions: [
            { label: 'Save', onClick: () => void saveHeld(held) },
            { label: 'Discard', onClick: () => void discardAll(held) },
          ],
        });
        return;
      }
      if (showing.length === 0) {
        model.remove(id);
        render();
        return;
      }
      const next = model.nextAfterClose(id);
      // Right first: closing the left pane moves the right's document into slot 0.
      for (const pane of [...showing].reverse()) {
        const other = panes().panes.find((p) => p !== pane);
        // A pane left with nothing, or with what the other pane already shows, goes.
        if (other && (next === null || other.path() === next || other.path() === tab.path)) {
          if (!(await panes().close(pane))) return;
          continue;
        }
        if (next === null) {
          notify({ kind: 'info', text: 'This is the last tab · open another file first, or quit.' });
          return;
        }
        const nextTab = model.byPath(next);
        // Over unsaved edits the open resolves at the prompt and lands only on Save or Open without saving: the close
        // goes on from there, and a Dismiss keeps the tab.
        let asking = false;
        const went = await openAt(pane, next, 'activate', nextTab?.id, () => {
          if (asking) void row.close(id);
        });
        if (!went) {
          asking = true;
          return;
        }
      }
      if (!panes().panes.some((p) => p.path() === tab.path)) model.remove(id);
      render();
    },
    async reopen() {
      for (;;) {
        const closed = model.takeClosed();
        if (!closed) return;
        const pane = panes().focused;
        const asking = pane.content.hasUnsavedChanges();
        const place = (): void => {
          row.note(pane);
          const tab = model.byPath(closed.path);
          if (tab) model.move(tab.id, closed.index);
          render();
        };
        let landed = false;
        await openAt(pane, closed.path, 'activate', undefined, () => {
          landed = true;
          place();
        });
        if (landed || pane.path() === closed.path) return;
        // Asked about unsaved changes: it lands on the answer, or stays to be reopened. Else it no longer opens.
        if (asking) {
          model.keepClosed(closed);
          return;
        }
      }
    },
    async cycle(dir) {
      const list = model.tabs;
      if (list.length < 2) return;
      const at = list.findIndex((t) => t === model.current);
      const next = list[(at + dir + list.length) % list.length]!;
      await row.show(next.id);
    },
    async step(slot, dir) {
      const pane = paneAt(slot);
      const path = model.step(slot, dir);
      if (!pane || path === null) return;
      await openAt(pane, path, dir < 0 ? 'back' : 'forward');
    },
    note(pane) {
      const path = pane.path();
      const store = pane.content.store();
      const before = last.get(pane.slot);
      if (path !== null && path !== before?.path) {
        if (before && before.path !== null && store !== null && store === before.store) model.renamed(before.path, path);
        else {
          const { how, tabId } = takeIntent(pane.host, path);
          model.landed(pane.slot, path, how, tabId);
          if (proposalOn('pairs') && panes().panes.length > 1) model.pairShown();
          const closed = model.takeClosedByCap();
          if (closed.length > 0) {
            const names = closed.map(nameOf);
            const said = names.length === 1 ? names[0] : `${names.length} tabs: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}`;
            notify({ kind: 'info', fades: true, text: `Closed ${said} · the window holds ${WINDOW_TAB_CAP} tabs` }, { pane: pane.host });
          }
        }
      }
      last.set(pane.slot, { path, store });
      render();
    },
    render,
    destroy() {
      offHeld();
      offPanes();
      offProposals();
      resized?.disconnect();
      // The panes' hosts outlive the row (a second start reuses them): their drop listeners go with it.
      for (const off of paneDrops.values()) off();
      paneDrops.clear();
      el.remove();
    },
  };

  function tabMenu(tab: WindowTab, at: Element): void {
    const path = tab.path;
    const two = panes().panes.length > 1;
    const items: MenuItem[] = [
      { title: 'Close', chord: 'Alt+W', run: () => row.close(tab.id) },
      { title: 'Close the others', run: () => closeOthers(tab.id) },
      ...(model.tabs.indexOf(tab) < model.tabs.length - 1 ? [{ title: 'Close the tabs to the right', run: () => closeRight(tab.id) }] : []),
      { title: two ? 'Show in the other pane' : 'Open beside', run: () => showBeside(tab) },
      { title: 'Copy its path', run: () => copyPath(path) },
    ];
    const held = panes().panes.some((p) => p.path() === path) ? null : heldAt(path);
    if (held) {
      items.unshift(
        { title: 'Read its changes', detail: 'the patch, beside', run: () => void openChangesPage(handle, held) },
        { title: 'Save', run: () => void saveHeld(held) },
        { title: 'Discard its changes', run: () => void discardAll(held) },
      );
    }
    if (!isTransient(path)) items.push({ title: 'Show in Places', run: () => frame().left.show('places', { reveal: path }, false) });
    const beside = panes().focused.path();
    if (proposalOn('compare_files') && beside !== null && beside !== path && !isTransient(path) && !isTransient(beside)) {
      items.push({ title: `Compare with ${basename(beside)}`, detail: 'a patch beside, from that file to this one', run: () => void compareTwoFiles(beside, path) });
    }
    if (tab.glance) items.push({ title: 'Keep this tab', run: () => { model.keep(tab.id); render(); } });
    if (model.canReopen) items.push({ title: 'Reopen the closed tab', chord: 'Mod+Shift+T', run: () => row.reopen() });
    openMenu(anchorBelow(at), nameOf(path), items);
  }

  async function closeOthers(id: number): Promise<void> {
    const tab = model.byId(id);
    if (!tab) return;
    await row.show(id);
    // The open was refused (or is waiting on an answer about unsaved changes): nothing closes.
    if (!panes().panes.some((p) => p.path() === tab.path)) return;
    // A tab whose changes no pane shows stays, as Close would keep it: its changes are saved or let go first.
    for (const t of [...model.tabs]) if (t.id !== id && !panes().panes.some((p) => p.path() === t.path) && heldAt(t.path) === null) model.remove(t.id);
    render();
  }

  async function closeRight(id: number): Promise<void> {
    const tab = model.byId(id);
    if (!tab) return;
    const right = (): WindowTab[] => model.tabs.slice(model.tabs.indexOf(tab) + 1);
    if (model.current && right().includes(model.current)) {
      await row.show(id);
      if (panes().focused.path() !== tab.path) return;
    }
    // As Close the others: a tab whose changes no pane shows stays; one the other pane shows moves that pane on.
    for (const t of right()) if (!panes().panes.some((p) => p.path() === t.path) && heldAt(t.path) === null) model.remove(t.id);
    render();
    for (const t of right()) if (panes().panes.some((p) => p.path() === t.path)) await row.close(t.id);
  }

  async function showBeside(tab: WindowTab): Promise<void> {
    const focused = panes().focused;
    intend(focused.host, tab.path, 'activate', tab.id);
    await panes().openIn('other', tab.path);
  }

  async function copyPath(path: string): Promise<void> {
    await writeCopy(buildAppContext(handle), { text: path }, 'Copied its path');
  }

  function tabNode(tab: WindowTab, onlyOne: boolean): HTMLElement {
    const path = tab.path;
    const current = tab === model.current;
    const visible = !current && panes().panes.some((p) => p.path() === path);
    const node = document.createElement('div');
    node.className = 'marxy-tab';
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', String(current));
    if (visible) node.setAttribute('data-marxy-visible', '');
    node.dataset.marxyTab = String(tab.id);
    node.dataset.marxyTabPath = path;
    const dirty = dirtyPath(path);
    node.title = isTransient(path) ? documentName(path) : `${path}${dirty ? '\nUnsaved changes' : ''}${visible ? '\nShown in the other pane' : ''}${tab.glance ? '\nA glance: the next one replaces it' : ''}`;
    if (tab.glance) node.dataset.marxyGlance = '';
    if (proposalOn('drag')) {
      node.draggable = true;
      node.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(TAB_DRAG, String(tab.id));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        node.setAttribute('data-marxy-dragging', '');
      });
      node.addEventListener('dragend', () => {
        node.removeAttribute('data-marxy-dragging');
        dropAt.hidden = true;
      });
    }
    // The tab itself takes focus, one in the row at a time (roving): arrows, Home and End move it, Enter shows it.
    node.tabIndex = current ? 0 : -1;
    node.setAttribute('aria-label', nameOf(path));
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'marxy-tab-open';
    open.tabIndex = -1;
    const shownIn = panes().panes.find((p) => p.path() === path);
    const label = shownIn && isTransient(path) ? shownIn.content.scratchLabel() : undefined;
    const name = document.createElement('span');
    name.className = 'marxy-tab-name';
    name.dir = 'auto';
    const text = label ?? nameOf(path);
    drawName(name, text, null);
    names.set(node, { el: name, text, italic: tab.glance });
    open.append(name);
    const where = hints.get(path);
    if (where !== undefined) {
      const hint = document.createElement('span');
      hint.className = 'marxy-tab-where';
      hint.textContent = where;
      open.append(hint);
    }
    if (tab.pair !== null && proposalOn('pairs') && model.byPath(tab.pair)) {
      const pair = document.createElement('span');
      pair.className = 'marxy-tab-pair';
      pair.textContent = '⇄';
      pair.setAttribute('aria-label', `paired with ${nameOf(tab.pair)}`);
      open.append(pair);
    }
    if (shownIn?.host.hasAttribute(GONE)) open.append(goneMark());
    open.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    open.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) void showBeside(tab);
      else void row.show(tab.id);
    });
    open.addEventListener('dblclick', () => {
      model.keep(tab.id);
      render();
    });
    open.addEventListener('auxclick', (e) => {
      if (e.button === 1) void row.close(tab.id);
    });
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      tabMenu(tab, node);
    });
    const close = button('marxy-tab-close', dirty ? 'Close (unsaved changes)' : 'Close', icon('close'));
    close.tabIndex = -1;
    if (dirty) close.dataset.marxyDirty = '';
    close.hidden = onlyOne && panes().panes.length === 1;
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      void row.close(tab.id);
    });
    node.append(open, close);
    return node;
  }

  /** Roving focus: `tab` is the row's one stop, and has focus. */
  function focusTab(tab: HTMLElement | null): void {
    if (!tab) return;
    for (const t of strip.querySelectorAll<HTMLElement>('.marxy-tab')) t.tabIndex = t === tab ? 0 : -1;
    tab.focus({ preventScroll: true });
    reveal(tab);
  }

  /** Scrolls the strip, and only the strip, so `tab` is wholly in it. */
  function reveal(tab: HTMLElement): void {
    const t = tab.getBoundingClientRect();
    const r = strip.getBoundingClientRect();
    if (t.left < r.left) strip.scrollLeft -= r.left - t.left;
    else if (t.right > r.right) strip.scrollLeft += Math.min(t.right - r.right, t.left - r.left);
  }

  /** Widths of single graphemes, by face, weight and style: a cut is chosen from their sums. */
  const glyphs = new Map<string, number>();

  /** Each item's width as drawn in the row, read in one layout from an unseen box in the bar. */
  function measure(items: readonly { text: string; weight: string; italic: boolean; marked?: boolean }[], extra?: HTMLElement): number[] {
    const box = document.createElement('div');
    box.className = 'marxy-tab-measure';
    box.setAttribute('aria-hidden', 'true');
    const spans = items.map((item) => {
      const span = document.createElement('span');
      span.style.fontWeight = item.weight;
      span.style.fontStyle = item.italic ? 'italic' : 'normal';
      span.append(item.marked ? markedNode(item.text) : document.createTextNode(item.text));
      return span;
    });
    box.append(...spans);
    if (extra) box.append(extra);
    el.append(box);
    const out = spans.map((x) => x.getBoundingClientRect().width);
    if (extra) out.push(extra.getBoundingClientRect().width);
    box.remove();
    return out;
  }

  /**
   * The fit. One pass clears what the last fit wrote and reads every natural width in one layout, each name in
   * the current tab's weight so showing a tab moves no other; then one width is found and the names are cut.
   */
  function layout(): void {
    const nodes = [...strip.querySelectorAll<HTMLElement>('.marxy-tab')];
    const infos = nodes.map((n) => names.get(n)!);
    for (const [i, node] of nodes.entries()) {
      node.style.width = '';
      node.classList.remove('marxy-tab-squeezed');
      const where = node.querySelector<HTMLElement>('.marxy-tab-where');
      if (where) where.style.minWidth = '';
      if (infos[i]!.el.hasAttribute('data-marxy-cut')) drawName(infos[i]!.el, infos[i]!.text, null);
    }
    allTabs.hidden = false;

    const font = getComputedStyle(el).font;
    const weights = nodes.map((n) => getComputedStyle(n).fontWeight);
    const key = (g: string, weight: string, italic: boolean): string => `${font}|${weight}|${italic ? 'i' : 'n'}|${g}`;
    const wanted = new Map<string, { text: string; weight: string; italic: boolean }>();
    if (glyphs.size > 4000) glyphs.clear();
    for (const [i, info] of infos.entries()) {
      const weight = weights[i]!;
      for (const g of [...graphemesOf(info.text), '…']) if (!glyphs.has(key(g, weight, info.italic))) wanted.set(key(g, weight, info.italic), { text: g, weight, italic: info.italic });
    }
    const floorProbe = document.createElement('div');
    floorProbe.style.width = 'calc(124 * var(--marxy-c, 1px))';
    const items = [...infos.map((i) => ({ text: i.text, weight: '620', italic: i.italic, marked: hasMarks(i.text) })), ...wanted.values()];
    const read = measure(items, floorProbe);
    const whole = read.slice(0, infos.length);
    [...wanted.keys()].forEach((k, i) => glyphs.set(k, read[infos.length + i]!));
    const floor = read[read.length - 1]!;
    const around = nodes.map((n, i) => n.getBoundingClientRect().width - infos[i]!.el.getBoundingClientRect().width);
    const whereW = nodes.map((n) => n.querySelector('.marxy-tab-where')?.getBoundingClientRect().width ?? 0);
    const bar = getComputedStyle(el);
    const gap = parseFloat(bar.columnGap) || 0;
    const outer = (x: HTMLElement): number => (x.hidden ? 0 : x.getBoundingClientRect().width + gap);
    const fixed = el.clientWidth - parseFloat(bar.paddingLeft) - parseFloat(bar.paddingRight) - outer(plus) - outer(split) - (parseFloat(getComputedStyle(grow).minWidth) || 0) - gap;
    const doorW = outer(allTabs);

    const naturals = nodes.map((_, i) => Math.ceil(around[i]! + whole[i]!));
    const between = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const gaps = between * Math.max(0, nodes.length - 1);
    let width = fairShare(naturals, fixed - gaps, floor);
    const over = naturals.reduce((s, n) => s + Math.min(n, width), 0) + gaps > fixed + 0.5;
    if (over) width = fairShare(naturals, fixed - doorW - gaps, floor);

    // A cut tab that neither the focused pane shows nor holds unsaved changes gives its close slot to its name (the close
    // comes over the name's end under the pointer); its width is the same either way, so showing it moves nothing.
    const closeEl = nodes[0]?.querySelector<HTMLElement>('.marxy-tab-close');
    const closeCs = closeEl ? getComputedStyle(closeEl) : null;
    const slot = closeEl && closeCs && !closeEl.hidden ? closeEl.getBoundingClientRect().width + parseFloat(closeCs.marginLeft) + parseFloat(closeCs.marginRight) : 0;
    const squeezable = nodes.map((n) => n.getAttribute('aria-selected') !== 'true' && !n.querySelector('.marxy-tab-close[data-marxy-dirty]'));
    const texts = infos.map((i) => i.text);
    const cuts = infos.map((info, i) => {
      if (naturals[i]! <= width) return null;
      // In the tab's own weight: the current tab may show a glyph fewer, and its width is the same either way.
      const w = (t: string): number => graphemesOf(t).reduce((s, g) => s + (glyphs.get(key(g, weights[i]!, info.italic)) ?? 0), 0);
      // A pixel spare for what sums of single glyphs miss (kerning between them); a squeezed tab keeps 6 px before its
      // edge; a folder hint gives way to the name down to a few letters of its own.
      const hint = whereW[i]! - Math.min(whereW[i]!, HINT_MIN);
      const room = width - around[i]! - 1 + (squeezable[i] ? Math.max(0, slot - 6) : 0) + hint;
      return cutName(info.text, room, w, texts, hasMarks(info.text));
    });
    // The head box in the tab's own weight: its glyphs, then the ellipsis apart, as text-overflow sets it (no kerning
    // between them).
    // A name cut at its end is sized the same way: the name does not shrink in its tab (a folder hint does).
    const heads = cuts.map((c, i) => (c ? { text: graphemesOf(c.head).slice(0, c.shown).join(''), weight: weights[i]!, italic: infos[i]!.italic } : null));
    const shownHeads = heads.filter((h) => h !== null);
    const headRead = measure(shownHeads.flatMap((h) => [h, { ...h, text: '…' }]));
    let at = 0;
    for (const [i, node] of nodes.entries()) {
      node.style.width = `${Math.min(naturals[i]!, width)}px`;
      if (naturals[i]! > width && squeezable[i] && slot > 0) node.classList.add('marxy-tab-squeezed');
      const where = node.querySelector<HTMLElement>('.marxy-tab-where');
      if (where && naturals[i]! > width) where.style.minWidth = `${Math.min(whereW[i]!, HINT_MIN)}px`;
      const cut = cuts[i] ?? null;
      if (!cut) continue;
      // Under a pixel of slack: the box ends where the ellipsis does.
      const head = heads[i] ? headRead[at++]! + headRead[at++]! + 0.6 : 0;
      drawName(infos[i]!.el, infos[i]!.text, cut, head);
    }
    allTabs.hidden = !over;
    edges();
    const current = strip.querySelector<HTMLElement>('.marxy-tab[aria-selected="true"]');
    if (current && !strip.contains(document.activeElement)) reveal(current);
  }

  /** The fades at an edge with tabs beyond it, and the door's count of tabs not wholly in view. */
  function edges(): void {
    const max = strip.scrollWidth - strip.clientWidth;
    strip.style.setProperty('--lb-fade-start', strip.scrollLeft > 1 ? '24px' : '0px');
    strip.style.setProperty('--lb-fade-end', strip.scrollLeft < max - 1 ? '24px' : '0px');
    const r = strip.getBoundingClientRect();
    const out = [...strip.querySelectorAll<HTMLElement>('.marxy-tab')].filter((t) => {
      const b = t.getBoundingClientRect();
      return b.left < r.left - 1 || b.right > r.right + 1;
    }).length;
    outCount.textContent = out > 0 ? String(out) : '';
    allTabs.title = out > 0 ? `All ${model.tabs.length} tabs · ${out} out of view` : `All ${model.tabs.length} tabs`;
    allTabs.setAttribute('aria-label', allTabs.title);
  }

  let fitQueued = false;
  /** What the last fit was made for: the row's width, its tabs and their states, the face. */
  let fittedFor = '';
  function fit(): void {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => {
      fitQueued = false;
      // The frame draws the row again on every layout of the window. A fit undoes its widths and cuts to measure, which
      // made each resize relay out the panes under it (a table's place was lost to the extra resize), so a fit runs only
      // when what it depends on has changed.
      const key = `${el.clientWidth}\n${getComputedStyle(el).font}\n${document.fonts?.status ?? ''}\n${drawn}`;
      if (key === fittedFor) return;
      fittedFor = key;
      layout();
    });
  }
  strip.addEventListener('scroll', () => edges(), { passive: true });
  // The wheel over the row moves the strip sideways, and never the page under it.
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (strip.scrollWidth <= strip.clientWidth + 1) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    strip.scrollLeft += e.deltaMode === 1 ? delta * 16 : e.deltaMode === 2 ? delta * strip.clientWidth : delta;
  }, { passive: false });
  void document.fonts?.ready.then(() => fit());

  allTabs.addEventListener('click', () => {
    const items: MenuItem[] = model.tabs.map((t) => {
      const where = isTransient(t.path) ? '' : (hints.get(t.path) ?? folderOf(t.path));
      const state = t === model.current ? 'shown' : panes().panes.some((p) => p.path() === t.path) ? 'beside' : '';
      return { title: nameOf(t.path), detail: [where, state].filter((x) => x !== '').join(' · ') || undefined, run: () => row.show(t.id) };
    });
    openMenu(anchorBelow(allTabs), `${model.tabs.length} tabs`, items);
  });

  strip.addEventListener('keydown', (e) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>('.marxy-tab');
    if (!node || !strip.contains(node)) return;
    const nodes = [...strip.querySelectorAll<HTMLElement>('.marxy-tab')];
    const at = nodes.indexOf(node);
    const id = Number(node.dataset.marxyTab);
    const to = (i: number): void => {
      e.preventDefault();
      focusTab(nodes[(i + nodes.length) % nodes.length] ?? null);
    };
    if (e.key === 'ArrowRight') to(at + 1);
    else if (e.key === 'ArrowLeft') to(at - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(nodes.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void row.show(id);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void row.close(id).then(() => {
        const left = [...strip.querySelectorAll<HTMLElement>('.marxy-tab')];
        focusTab(left[Math.min(at, left.length - 1)] ?? null);
      });
    } else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      const tab = model.byId(id);
      if (tab) tabMenu(tab, node);
    }
  });
  strip.addEventListener('dblclick', (e) => {
    if (e.target === strip) frame().openFinder();
  });
  plus.addEventListener('click', () => frame().openFinder());
  split.addEventListener('click', () => {
    const set = panes();
    if (set.panes.length > 1) {
      const other = set.panes.find((p) => p !== set.focused);
      if (other) void set.close(other);
      return;
    }
    void splitSame(buildAppContext(handle));
  });

  function render(): void {
    // An edit keeps a glance: it is no longer a look.
    for (const t of model.tabs) if (t.glance && dirtyPath(t.path)) model.keep(t.id);
    model.focus(panes().focused.slot);
    const list = model.tabs;
    // A closed tab's warm store goes with it: its encoding, read record and watch are forgotten as the store closes.
    panes().stores.retain(list.map((t) => t.path));
    const state = JSON.stringify([
      list.map((t) => [t.id, t.path, t.glance, t.pair, t === model.current, panes().panes.some((p) => p.path() === t.path), dirtyPath(t.path)]),
      panes().panes.map((p) => [p.host.hasAttribute(GONE), isTransient(p.path() ?? '') ? p.content.scratchLabel() : '']),
      panes().panes.length,
      proposalOn('drag'),
      proposalOn('pairs'),
    ]);
    if (state !== drawn) {
      drawn = state;
      hints = folderHints(list.map((t) => t.path).filter((p) => !isTransient(p)));
      const focusedId = strip.contains(document.activeElement) ? (document.activeElement as HTMLElement).closest<HTMLElement>('.marxy-tab')?.dataset.marxyTab : undefined;
      strip.replaceChildren(...list.map((t) => tabNode(t, list.length === 1)));
      if (focusedId !== undefined) focusTab(strip.querySelector<HTMLElement>(`.marxy-tab[data-marxy-tab="${focusedId}"]`) ?? strip.querySelector<HTMLElement>('.marxy-tab[aria-selected="true"]'));
    }
    const two = panes().panes.length > 1;
    split.title = two ? 'Close the other pane' : 'Split: show this beside';
    split.setAttribute('aria-label', split.title);
    split.setAttribute('aria-pressed', String(two));
    fit();
  }

  // Drag a tab (a proposal): along the row to reorder it, or onto a pane to show it there.
  const dropIndex = (x: number): number => {
    const nodes = [...strip.querySelectorAll<HTMLElement>('.marxy-tab:not([data-marxy-dragging])')];
    const at = nodes.findIndex((n) => {
      const box = n.getBoundingClientRect();
      return x < box.left + box.width / 2;
    });
    return at < 0 ? nodes.length : at;
  };
  const isTabDrag = (e: DragEvent): boolean => proposalOn('drag') && (e.dataTransfer?.types.includes(TAB_DRAG) ?? false);
  const draggedId = (e: DragEvent): number | null => {
    const raw = proposalOn('drag') ? (e.dataTransfer?.getData(TAB_DRAG) ?? '') : '';
    return /^\d+$/.test(raw) ? Number(raw) : null;
  };
  /** The 2 px bar where a dragged tab would land: before the tab it would go in front of, else after the last. */
  function markDrop(x: number): void {
    const nodes = [...strip.querySelectorAll<HTMLElement>('.marxy-tab:not([data-marxy-dragging])')];
    if (nodes.length === 0) return;
    const at = dropIndex(x);
    const box = (nodes[at] ?? nodes[nodes.length - 1]!).getBoundingClientRect();
    const r = strip.getBoundingClientRect();
    const edge = Math.min(r.right - 1, Math.max(r.left + 1, at < nodes.length ? box.left : box.right));
    dropAt.style.left = `${edge - el.getBoundingClientRect().left - 1}px`;
    dropAt.hidden = false;
  }
  el.addEventListener('dragover', (e) => {
    if (!isTabDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    markDrop(e.clientX);
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node | null)) dropAt.hidden = true;
  });
  el.addEventListener('drop', (e) => {
    dropAt.hidden = true;
    const id = draggedId(e);
    if (id === null) return;
    e.preventDefault();
    model.move(id, dropIndex(e.clientX));
    render();
  });
  const paneDrops = new Map<FramePane, () => void>();
  function acceptDrops(pane: FramePane): void {
    if (paneDrops.has(pane)) return;
    const over = (e: DragEvent): void => {
      if (!isTabDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      pane.host.setAttribute('data-marxy-drop', '');
    };
    const leave = (e: DragEvent): void => {
      if (!pane.host.contains(e.relatedTarget as Node | null)) pane.host.removeAttribute('data-marxy-drop');
    };
    const drop = (e: DragEvent): void => {
      pane.host.removeAttribute('data-marxy-drop');
      const id = draggedId(e);
      if (id === null) return;
      e.preventDefault();
      // A drop places one tab: its partner stays where it is.
      void row.show(id, { slot: pane.slot, alone: true });
    };
    pane.host.addEventListener('dragover', over);
    pane.host.addEventListener('dragleave', leave);
    pane.host.addEventListener('drop', drop);
    paneDrops.set(pane, () => {
      pane.host.removeEventListener('dragover', over);
      pane.host.removeEventListener('dragleave', leave);
      pane.host.removeEventListener('drop', drop);
    });
  }
  for (const pane of panes().panes) acceptDrops(pane);

  const offPanes = panes().onChange((e) => {
    if (e.kind === 'close' && e.pane) {
      model.paneClosed(e.pane.slot);
      last.delete(1);
      const left = panes().panes[0];
      if (left) last.set(0, { path: left.path(), store: left.content.store() });
      for (const [pane, off] of paneDrops) if (!panes().panes.includes(pane)) {
        off();
        paneDrops.delete(pane);
      }
    }
    if (e.kind === 'open' && e.pane) acceptDrops(e.pane);
    render();
  });
  const offProposals = onProposals((now, before) => {
    if (!now.glance && before.glance) for (const t of model.tabs) model.keep(t.id);
    render();
  });
  const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit());
  resized?.observe(el);
  return row;
}
