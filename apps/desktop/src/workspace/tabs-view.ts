// The tab row (W-06; ADR-0058 item 5): the `tabs` region while the window is unfolded. A tab is a document a pane has
// shown since the window unfolded: the kind's glyph (K-18), the name and an unsaved dot, nothing else. Folded there is no row
// and no list: folding forgets the tabs (nothing here is remembered), and the palette's Recent is the switcher.
//
// The row follows the panes and never leads them. Every update reads what the panes show (`reconcile`), so a document
// whose open the reader refused at the unsaved-changes prompt never gets a tab, and a pane that landed one by any
// route (the palette, a link beside, Save As) does. A tab is shown with `focused.content.open(path)` and nothing else: the
// prompt over unsaved edits, the pane's history and the position are the open's own. A tab keeps no unsaved edits (only a
// document a pane shows can be dirty), so leaving a dirty document asks exactly as any open does, and Cancel (Dismiss)
// changes nothing: no pane, no buffer and no tab.
//
// Below two tabs the band hides itself (`region.hidden`), as the strip does, and `workspace.arrangement.tabs` stays as the
// reader left it. Layout is base.css (`.marxy-tabs`); state is ARIA and data attributes (`data-marxy-tab`,
// `data-marxy-tab-active`, `data-marxy-tab-shown`), and the stylesheet draws it.
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import type { AppHandle } from '../app.ts';
import { setTabsController } from '../commands/tabs.ts';
import { documentName } from '../document/untitled.ts';
import { kindIconElement, langOfPath } from '../kind-icons/icons.ts';
import { TabList, isTransient } from './tabs.ts';
import type { DocumentSignal } from './toolbar.ts';

type Pane = ReturnType<AppHandle['panes']>['panes'][number];

/** What one tab shows; compared whole, so a row that has not changed is not touched. */
interface Row {
  readonly path: string;
  readonly active: boolean;
  readonly shown: boolean;
  readonly dirty: boolean;
  readonly kind: Kind | null;
  readonly closable: boolean;
  readonly label: string;
}

interface Node {
  readonly wrap: HTMLElement;
  readonly open: HTMLButtonElement;
  readonly close: HTMLButtonElement;
  readonly name: HTMLElement;
  readonly dot: HTMLElement;
  glyph: HTMLElement | null;
  glyphKind: Kind | null;
}

const KIND_ATTRIBUTE = 'data-marxy-kind';

const folderOf = (path: string): string => (isTransient(path) ? '' : basename(dirname(path)));

/** Fills the `tabs` region. Returns what takes the row out. */
export function mountTabs(el: HTMLElement, handle: AppHandle, signal: DocumentSignal): () => void {
  const workspace = handle.workspace();
  const list = new TabList();
  /** The kind a path was last shown as, so a tab whose document no pane shows keeps its glyph. */
  const kinds = new Map<string, Kind>();
  const nodes = new Map<string, Node>();

  const root = document.createElement('div');
  root.className = 'marxy-tabs';
  root.setAttribute('role', 'tablist');
  root.setAttribute('aria-label', 'Open documents');
  el.append(root);

  const panesOf = (): readonly Pane[] => handle.panes().panes;
  const shownPaths = (): Set<string> => new Set(panesOf().flatMap((p) => (p.path() === null ? [] : [p.path()!])));

  // Hidden from what is on it, not through `setPanel`: the remembered arrangement stays as the reader left it.
  const settle = (): void => {
    const want = list.snapshot().tabs.length < 2 || workspace.arrangement?.tabs === false;
    if (el.hidden !== want) el.hidden = want;
  };

  /** Makes the list true to the panes. Idempotent: any signal may call it. */
  const reconcile = (): void => {
    const panes = handle.panes();
    list.sync(
      panes.panes.map((pane) => ({ key: pane, path: pane.path(), store: pane.content.store() })),
      panes.focused.path(),
    );
    // The glyph a tab shows is the kind its document was last shown as; one no pane shows keeps it.
    for (const pane of panes.panes) {
      const path = pane.path();
      const kind = pane.kind();
      if (path !== null && kind !== null) kinds.set(path, kind);
    }
    render();
  };

  const rowsNow = (): Row[] => {
    const panes = handle.panes();
    const { tabs, active } = list.snapshot();
    const shown = shownPaths();
    return tabs.map((path) => {
      const owner = panes.panes.find((p) => p.path() === path) ?? null;
      const others = new Set([...shown].filter((p) => p !== path));
      const name = documentName(path);
      const folder = folderOf(path);
      const dirty = owner?.content.hasUnsavedChanges() ?? false;
      const isActive = path === active;
      const closable = tabs.length > 1 && (owner === null || list.neighbour(path, others) !== null);
      return {
        path,
        active: isActive,
        shown: owner !== null,
        dirty,
        kind: owner?.kind() ?? kinds.get(path) ?? null,
        closable,
        label: `${name}${folder === '' ? '' : `, in ${folder}`}${dirty ? ', unsaved changes' : ''}${owner !== null && !isActive ? ', shown in the other pane' : ''}`,
      };
    });
  };

  const makeNode = (path: string): Node => {
    const wrap = document.createElement('div');
    wrap.className = 'marxy-tab';
    wrap.setAttribute('role', 'presentation');
    wrap.setAttribute('data-marxy-tab', path);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'marxy-tab-open';
    open.setAttribute('role', 'tab');
    open.tabIndex = -1;
    const name = document.createElement('span');
    name.className = 'marxy-tab-name';
    name.textContent = documentName(path);
    const dot = document.createElement('span');
    dot.className = 'marxy-tab-dirty';
    dot.setAttribute('aria-hidden', 'true');
    dot.textContent = '●';
    open.append(name, dot);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'marxy-tab-close';
    close.tabIndex = -1;
    close.textContent = '×';
    close.setAttribute('aria-label', `Close ${documentName(path)}`);
    close.title = 'Close tab';
    wrap.append(open, close);
    // A press must not take focus or the selection from the page.
    for (const b of [open, close]) b.addEventListener('mousedown', (event) => event.preventDefault());
    open.addEventListener('click', () => void showTab(path));
    close.addEventListener('click', () => void closeTab(path));
    const title = isTransient(path) ? '' : path;
    if (title !== '') wrap.title = title;
    return { wrap, open, close, name, dot, glyph: null, glyphKind: null };
  };

  let drawn = '';
  let drawnActive: string | null = null;
  const render = (): void => {
    const rows = rowsNow();
    const key = JSON.stringify(rows);
    if (key === drawn) {
      settle();
      return;
    }
    drawn = key;
    const wanted = new Set(rows.map((r) => r.path));
    for (const [path, node] of nodes) {
      if (wanted.has(path)) continue;
      node.wrap.remove();
      nodes.delete(path);
    }
    rows.forEach((row, index) => {
      let node = nodes.get(row.path);
      if (!node) {
        node = makeNode(row.path);
        nodes.set(row.path, node);
      }
      // Only a tab that is out of place moves: moving a node takes focus from it.
      if (root.children[index] !== node.wrap) root.insertBefore(node.wrap, root.children[index] ?? null);
      node.wrap.toggleAttribute('data-marxy-tab-active', row.active);
      node.wrap.toggleAttribute('data-marxy-tab-shown', row.shown);
      node.open.setAttribute('aria-selected', String(row.active));
      node.open.setAttribute('aria-label', row.label);
      node.dot.hidden = !row.dirty;
      node.close.hidden = !row.closable;
      if (row.kind !== node.glyphKind) {
        node.glyph?.remove();
        node.glyph = row.kind === null ? null : kindIconElement(document, row.kind, row.kind === 'code' ? langOfPath(row.path) : undefined);
        node.glyphKind = row.kind;
        if (node.glyph) node.open.prepend(node.glyph);
      }
    });
    rove();
    settle();
    const active = rows.find((r) => r.active)?.path ?? null;
    if (active !== drawnActive) {
      drawnActive = active;
      if (active !== null) bringIntoView(nodes.get(active)!.wrap);
    }
  };

  /** One tab stop: the tab with focus, else the active one, else the first. */
  const rove = (): void => {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.marxy-tab-open')];
    const focused = buttons.find((b) => b === document.activeElement);
    const to = focused ?? buttons.find((b) => b.getAttribute('aria-selected') === 'true') ?? buttons[0];
    for (const b of buttons) b.tabIndex = b === to ? 0 : -1;
  };

  /** The row scrolls to a tab it hides; the page does not (a row in a sticky band must not move the window). */
  const bringIntoView = (tab: HTMLElement): void => {
    if (el.hidden) return;
    const row = root.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.width === 0) return;
    // Clear of the faded edge, so the label is not under it.
    const clear = 24;
    if (box.left < row.left + clear) root.scrollLeft += box.left - (row.left + clear);
    else if (box.right > row.right - clear) root.scrollLeft += box.right - (row.right - clear);
  };

  /** Show `path` in the focused pane, or focus the pane that already shows it. Asks over unsaved edits, as any open does. */
  const showTab = async (path: string): Promise<void> => {
    const panes = handle.panes();
    const owner = panes.panes.find((p) => p.path() === path);
    if (owner) {
      if (owner !== panes.focused) panes.focus(owner);
      return;
    }
    await panes.focused.content.open(path);
  };

  /** Close `path`: a tab no pane shows is forgotten; one a pane shows opens the next tab there first, and goes when that has landed. */
  const closeTab = async (path: string): Promise<void> => {
    if (list.snapshot().tabs.length < 2) return;
    const owner = panesOf().find((p) => p.path() === path);
    if (!owner) {
      list.close(path);
      reconcile();
      return;
    }
    const others = new Set([...shownPaths()].filter((p) => p !== path));
    const next = list.neighbour(path, others);
    if (next === null) return;
    await owner.content.open(next, {
      onLanded: () => {
        list.close(path);
        reconcile();
      },
    });
  };

  root.addEventListener('keydown', (event) => {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.marxy-tab-open')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      const path = buttons[at]!.closest<HTMLElement>('[data-marxy-tab]')?.getAttribute('data-marxy-tab');
      if (path == null) return;
      const mate = buttons[at + 1] ?? buttons[at - 1];
      void closeTab(path).then(() => {
        // The tab that had focus is gone: focus stays in the row.
        if (document.activeElement === document.body || document.activeElement === null) (mate ?? root.querySelector<HTMLElement>('.marxy-tab-open'))?.focus();
        rove();
      });
      return;
    }
    const to =
      event.key === 'ArrowRight' ? buttons[(at + 1) % buttons.length]
      : event.key === 'ArrowLeft' ? buttons[(at - 1 + buttons.length) % buttons.length]
      : event.key === 'Home' ? buttons[0]
      : event.key === 'End' ? buttons.at(-1)
      : undefined;
    if (!to) return;
    event.preventDefault();
    for (const b of buttons) b.tabIndex = b === to ? 0 : -1;
    to.focus();
  });

  reconcile();
  const off = signal.onChange(reconcile);
  // A kind decided late, or decided again by *Show as*, redraws the glyph whichever route changed it.
  const main = handle.panes().panes[0]?.host.parentElement;
  const kindWatch = new MutationObserver(reconcile);
  if (main) kindWatch.observe(main, { attributes: true, attributeFilter: [KIND_ATTRIBUTE], subtree: true });
  // Docking the band from elsewhere (setPanel) must not show it below two tabs.
  const hiding = new MutationObserver(settle);
  hiding.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  const withdraw = setTabsController({
    count: () => list.snapshot().tabs.length,
    step: async (delta) => {
      const to = list.step(delta);
      if (to !== null) await showTab(to);
    },
    closeActive: async () => {
      const { active } = list.snapshot();
      if (active !== null) await closeTab(active);
    },
  });
  return () => {
    withdraw();
    off();
    kindWatch.disconnect();
    hiding.disconnect();
    root.remove();
  };
}
