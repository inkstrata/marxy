// The inspector (W-09; ADR-0058 item 5): the `inspector` region while the window is unfolded. A strip of tabs and the selected
// tab's panel, for the focused pane's document. The strip is a table: `registerInspectorTab({ id, title, mount })` adds a tab,
// the withdrawal it returns takes it out, and a tab is drawn only while its builder is registered. Links is registered in
// `fill.ts`; Outline (W-10), Metadata (W-17) and Versions (V-06) register theirs the same way and nothing here changes.
//
// The shell owns the strip, the selected tab (kept in memory for the session, never written) and one tab stop for the whole
// region: Tab reaches the inspector once, the arrows move inside it (Left and Right between tabs, Up and Down through the
// selected panel's rows, whatever it marks with a `tabindex`). A panel is mounted when its tab is selected and let go when
// another is, so a tab nobody looks at costs nothing. Folded there is no inspector element at all. Layout is base.css
// (`.marxy-inspector`); state is ARIA and data attributes.
import type { AppHandle } from '../app.ts';
import { appHandle } from '../commands/app-handle.ts';
import type { DocumentSignal } from './toolbar.ts';

/** What a tab's builder is given: the app and the signal that follows the focused pane's document. */
export interface InspectorContext {
  readonly handle: AppHandle;
  readonly signal: DocumentSignal;
  /** True while the region is docked and visible; a panel does no work while it is not. */
  visible(): boolean;
  /** Called when the region is shown again after being hidden. */
  onShown(cb: () => void): () => void;
}

export interface InspectorTab {
  readonly id: string;
  readonly title: string;
  /** Fills `el` and returns what takes it out. Its focusable rows carry a `tabindex` (-1; the shell roves them). */
  mount(el: HTMLElement, ctx: InspectorContext): () => void;
}

const tabs: InspectorTab[] = [];
const listeners = new Set<() => void>();

/** Adds a tab to the strip (a second id replaces the first). Returns the withdrawal. */
export function registerInspectorTab(tab: InspectorTab): () => void {
  const at = tabs.findIndex((t) => t.id === tab.id);
  if (at >= 0) tabs[at] = tab;
  else tabs.push(tab);
  for (const cb of [...listeners]) cb();
  return () => {
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    tabs.splice(i, 1);
    for (const cb of [...listeners]) cb();
  };
}

/** The tabs now registered, in the order they were. */
export function inspectorTabs(): readonly InspectorTab[] {
  return [...tabs];
}

/** `cb` runs whenever a tab is registered or withdrawn; returns what stops it. The status bar asks it which doors have a tab behind them. */
export function onInspectorTabsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

let selected: string | null = null;

/**
 * Docks the inspector and selects the tab `id` (W-11: a status-bar item that has a tab opens it). False, and nothing
 * changed, when no tab has that id; the region is docked only while the window is unfolded (folded there is none).
 */
export function selectInspectorTab(id: string): boolean {
  if (!tabs.some((t) => t.id === id)) return false;
  selected = id;
  appHandle()?.workspace().setPanel('inspector', true);
  // Each mounted inspector draws again; its tab is the selected one.
  for (const cb of [...listeners]) cb();
  return true;
}

/** Fills the `inspector` region. Returns what takes the content out. */
export function mountInspector(el: HTMLElement, handle: AppHandle, signal: DocumentSignal): () => void {
  const shownListeners = new Set<() => void>();
  const ctx: InspectorContext = {
    handle,
    signal,
    visible: () => !el.hidden,
    onShown(cb) {
      shownListeners.add(cb);
      return () => shownListeners.delete(cb);
    },
  };

  const root = document.createElement('div');
  root.className = 'marxy-inspector';
  const strip = document.createElement('div');
  strip.className = 'marxy-inspector-tabs';
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Inspector');
  strip.setAttribute('aria-orientation', 'horizontal');
  const panel = document.createElement('div');
  panel.className = 'marxy-inspector-panel';
  panel.setAttribute('role', 'tabpanel');
  root.append(strip, panel);
  el.append(root);

  let current: { readonly id: string; readonly dispose: () => void } | null = null;
  let stop: HTMLElement | null = null;
  const buttons = new Map<string, HTMLButtonElement>();

  const rows = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>('[tabindex]')];
  const stops = (): HTMLElement[] => [...buttons.values(), ...rows()];

  /** Exactly one element of the region is a tab stop: the one last used, else the selected tab. */
  const normalise = (): void => {
    const all = stops();
    if (stop === null || !all.includes(stop)) stop = (selected !== null ? buttons.get(selected) : undefined) ?? all[0] ?? null;
    for (const node of all) node.tabIndex = node === stop ? 0 : -1;
  };

  const select = (id: string, focus = false): void => {
    if (!tabs.some((t) => t.id === id)) return;
    selected = id;
    draw();
    if (focus) buttons.get(id)?.focus();
  };

  const mountSelected = (): void => {
    const tab = tabs.find((t) => t.id === selected) ?? null;
    if (current && current.id === tab?.id) return;
    current?.dispose();
    current = null;
    panel.replaceChildren();
    if (!tab) return;
    panel.setAttribute('aria-label', tab.title);
    panel.id = `marxy-inspector-panel-${tab.id}`;
    const inner = document.createElement('div');
    inner.className = 'marxy-inspector-body';
    panel.append(inner);
    current = { id: tab.id, dispose: tab.mount(inner, ctx) };
  };

  const draw = (): void => {
    if (selected === null || !tabs.some((t) => t.id === selected)) selected = tabs[0]?.id ?? null;
    const have = new Set(tabs.map((t) => t.id));
    for (const [id, button] of buttons) {
      if (!have.has(id)) {
        button.remove();
        buttons.delete(id);
      }
    }
    for (const tab of tabs) {
      let button = buttons.get(tab.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'marxy-inspector-tab';
        button.setAttribute('role', 'tab');
        button.id = `marxy-inspector-tab-${tab.id}`;
        button.setAttribute('data-marxy-inspector-tab', tab.id);
        button.tabIndex = -1;
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          stop = button!;
          select(tab.id);
        });
        buttons.set(tab.id, button);
      }
      button.textContent = tab.title;
      button.setAttribute('aria-selected', String(tab.id === selected));
      button.toggleAttribute('data-marxy-inspector-tab-active', tab.id === selected);
      strip.append(button); // in registry order
    }
    mountSelected();
    if (selected !== null) {
      for (const button of buttons.values()) button.setAttribute('aria-controls', panel.id);
      panel.setAttribute('aria-labelledby', `marxy-inspector-tab-${selected}`);
    }
    normalise();
  };

  strip.addEventListener('keydown', (event) => {
    const ids = tabs.map((t) => t.id);
    const at = ids.indexOf(selected ?? '');
    let to = -1;
    if (event.key === 'ArrowRight') to = Math.min(ids.length - 1, at + 1);
    else if (event.key === 'ArrowLeft') to = Math.max(0, at - 1);
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = ids.length - 1;
    else return;
    event.preventDefault();
    if (to >= 0 && ids[to] !== undefined) {
      stop = buttons.get(ids[to]!) ?? null;
      select(ids[to]!, true);
    }
  });
  root.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (strip.contains(target) || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End')) return;
    const list = rows();
    const at = list.indexOf(target);
    if (at < 0) return;
    event.preventDefault();
    let to = at;
    if (event.key === 'ArrowDown') to = Math.min(list.length - 1, at + 1);
    else if (event.key === 'ArrowUp') to = at - 1;
    else if (event.key === 'Home') to = 0;
    else to = list.length - 1;
    const next = to < 0 ? (selected !== null ? buttons.get(selected) : undefined) : list[to];
    if (next) {
      stop = next;
      normalise();
      next.focus();
    }
  });
  // Down from the strip enters the panel.
  strip.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    const first = rows()[0];
    if (!first) return;
    event.preventDefault();
    stop = first;
    normalise();
    first.focus();
  });
  root.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement;
    if (stops().includes(target) && stop !== target) {
      stop = target;
      normalise();
    }
  });
  // A panel redraws its rows whenever its document changes; the stop is made again after each.
  const rowWatch = new MutationObserver(() => normalise());
  rowWatch.observe(panel, { childList: true, subtree: true });
  const hiddenWatch = new MutationObserver(() => {
    if (!el.hidden) for (const cb of [...shownListeners]) cb();
  });
  hiddenWatch.observe(el, { attributes: true, attributeFilter: ['hidden'] });

  listeners.add(draw);
  draw();
  return () => {
    listeners.delete(draw);
    rowWatch.disconnect();
    hiddenWatch.disconnect();
    current?.dispose();
    current = null;
    root.remove();
  };
}
