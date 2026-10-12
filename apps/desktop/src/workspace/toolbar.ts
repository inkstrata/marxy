// The toolbar (W-05; ADR-0065, mock-v2 01-workspace Round 7): a row of doors in the `toolbar` region, unfolded
// only. Each door is a registry command's button, drawn only when that command is registered, so there is no
// dead button and a story that wants a control registers its command and nothing here changes: `transform.open`
// (W-21), `export.menu` (W-15), `kind.chip` (K-07), `document.new-menu` (W-14), `view.toggle-sidebar` and
// `view.toggle-inspector` (W-03, which also fill the region the toggle opens). Folded there is no element at all:
// this runs only while the region exists (workspace/fill.ts). No Extract button and no theme switcher (06-
// reconciliation rows 3 and 4). Layout and look are `base.css`: state is exposed as ARIA
// (`aria-disabled`, `aria-checked`, `aria-pressed`) and the stylesheet draws it from the chrome spec (W-04); nothing here styles it.
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { parseConfig } from '@marxy/theme';
import type { AppHandle } from '../app.ts';
import { palette } from '../commands/app-handle.ts';
import type { AppContext, Command } from '../commands/registry.ts';
import { documentName, isUntitled } from '../document/untitled.ts';
import { keyLabel } from '../palette/commands.ts';
import { buildAppContext } from '../selection/bind.ts';
import { openVerbMenu, type VerbMenuRow } from '../selection/verb-menu.ts';
import type { WorkspaceRegion } from './regions.ts';

/** How an item is drawn: a button, a panel toggle (pressed while its region is docked), the title, the Read/Split/Source radios, or Copy and its chevron. */
export type ToolbarKind = 'button' | 'toggle' | 'title' | 'radios' | 'split';

export interface ToolbarItem {
  readonly id: string;
  /** The registry commands behind the item; it is drawn when any is registered. None: always drawn. */
  readonly commands: readonly string[];
  /** A panel toggle is drawn only once something fills the region it opens. */
  readonly needsFill?: WorkspaceRegion;
  readonly kind: ToolbarKind;
  /** The words on the control; its accessible name is the command's title. */
  readonly label?: string;
}

/** Left to right. The order is the toolbar's; `visibleItems` only removes. */
export const TOOLBAR_ITEMS: readonly ToolbarItem[] = [
  { id: 'sidebar', commands: ['view.toggle-sidebar'], needsFill: 'sidebar', kind: 'toggle', label: 'Sidebar' },
  { id: 'back', commands: ['nav.back'], kind: 'button', label: '←' },
  { id: 'forward', commands: ['nav.forward'], kind: 'button', label: '→' },
  { id: 'title', commands: [], kind: 'title' },
  { id: 'new', commands: ['document.new-menu'], kind: 'button', label: '+' },
  { id: 'mode', commands: ['view.mode-read', 'view.mode-split', 'view.mode-source'], kind: 'radios' },
  { id: 'kind', commands: ['kind.chip'], kind: 'button', label: 'Kind' },
  { id: 'copy', commands: ['copy-as.menu'], kind: 'split', label: 'Copy' },
  { id: 'export', commands: ['export.menu'], kind: 'button', label: 'Export' },
  { id: 'transform', commands: ['transform.open'], kind: 'button', label: 'Transform' },
  { id: 'find', commands: ['view.find'], kind: 'button', label: 'Find' },
  { id: 'inspector', commands: ['view.toggle-inspector'], needsFill: 'inspector', kind: 'toggle', label: 'Inspector' },
];

/**
 * Which doors fold into the *More* menu when the row would overflow, and in what order: the lowest number goes first
 * (the mockup's toolbar, right to left). A door not listed (back, forward, the title, the switch, Copy and the panel
 * toggles) never folds. Kept apart from `TOOLBAR_ITEMS` so a story adding a door adds one line to each.
 */
export const FOLD_ORDER: Readonly<Record<string, number>> = { transform: 1, export: 2, new: 3, kind: 4, find: 5 };

/** The switch's three choices, in order. */
export const MODE_CHOICES: readonly { readonly command: string; readonly label: string }[] = [
  { command: 'view.mode-read', label: 'Read' },
  { command: 'view.mode-split', label: 'Split' },
  { command: 'view.mode-source', label: 'Source' },
];

/** The items to draw: those with a registered command (or none to ask), whose region has content when they need one. */
export function visibleItems(
  items: readonly ToolbarItem[],
  commandIds: Iterable<string>,
  filledRegions: Iterable<WorkspaceRegion>,
): readonly ToolbarItem[] {
  const have = new Set(commandIds);
  const filled = new Set(filledRegions);
  return items.filter(
    (item) =>
      (item.commands.length === 0 || item.commands.some((id) => have.has(id))) &&
      (item.needsFill === undefined || filled.has(item.needsFill)),
  );
}

/** What the toolbar needs to know that the registry does not say: when the page changed. */
export interface DocumentSignal {
  /** Called when a document opened, changed, saved or closed in any pane, or focus moved. */
  onChange(cb: () => void): () => void;
}

/**
 * One per app instance, made where the fills are installed, so it has seen every open since launch. It holds
 * no subscription that outlives the panes: they are let go with the panes (ADR-0037).
 */
export function createDocumentSignal(handle: AppHandle): DocumentSignal {
  const panes = handle.panes();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const cb of [...listeners]) cb();
  };
  const watch = (pane: (typeof panes.panes)[number]): (() => void) =>
    pane.content.onDocumentChange(() => {
      emit();
    });
  watch(panes.panes[0]!);
  panes.onSplit(() => {
    const second = panes.panes[1];
    return second ? watch(second) : () => {};
  });
  panes.onChange(() => {
    emit();
  });
  return {
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

const isMac = (): boolean => typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

/** `copy_format` from config.toml, read when asked so an edit counts at once; Markdown when unset or unreadable. */
async function configuredFormat(handle: AppHandle): Promise<string> {
  try {
    const { configPaths, readFile } = handle.shell;
    if (!configPaths) return 'markdown';
    const { config } = await configPaths();
    return parseConfig(await readFile(config)).config.copyFormat;
  } catch {
    return 'markdown';
  }
}

function button(text: string, name: string, tip: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = text;
  el.setAttribute('aria-label', name);
  el.title = tip;
  // A press must not take focus or the selection from the page: a Copy that has lost the selection copies the document.
  el.addEventListener('mousedown', (event) => event.preventDefault());
  return el;
}

const tipFor = (command: Command, mac: boolean): string => {
  const key = command.key ? ` (${keyLabel(command.key, mac)})` : '';
  return `${command.title}${key}`;
};

/**
 * Draws the toolbar into `el` (the `toolbar` region) and keeps it true to the page. Returns what takes it out.
 * The controls are decided once, from the registry as it is now; their state follows the page.
 */
export function mountToolbar(el: HTMLElement, handle: AppHandle, signal: DocumentSignal): () => void {
  const mac = isMac();
  const registry = new Map((handle.commands() as readonly Command[]).map((c) => [c.id, c]));
  const workspace = handle.workspace();
  const filled = (['sidebar', 'inspector'] as const).filter((region) => workspace.hasFill(region));
  const items = visibleItems(TOOLBAR_ITEMS, registry.keys(), filled);

  const root = document.createElement('div');
  root.className = 'marxy-toolbar';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Tools');

  const syncs: Array<(ctx: AppContext) => void> = [];

  /** Runs a registered command from a control, as the palette does: only where its `when` holds. */
  const runCommand = async (id: string): Promise<void> => {
    const command = registry.get(id);
    if (!command) return;
    const ctx = buildAppContext(handle);
    if (!command.when(ctx)) return;
    try {
      await command.run(ctx);
    } catch (error) {
      console.warn(`marxy: ${id} failed from the toolbar`, error);
    }
    refresh();
  };

  const enabled = (id: string, ctx: AppContext): boolean => {
    try {
      return registry.get(id)?.when(ctx) ?? false;
    } catch {
      return false;
    }
  };

  const bind = (control: HTMLButtonElement, id: string, act: () => Promise<void> = () => runCommand(id)): void => {
    control.addEventListener('click', () => {
      if (control.getAttribute('aria-disabled') === 'true') return;
      void act();
    });
  };

  const disable = (control: HTMLElement, ok: boolean): void => {
    if (ok) control.removeAttribute('aria-disabled');
    else control.setAttribute('aria-disabled', 'true');
  };

  for (const item of items) {
    const top = document.createElement('span');
    top.setAttribute('data-marxy-toolbar-item', item.id);

    if (item.kind === 'title') {
      const name = document.createElement('span');
      name.className = 'marxy-toolbar-name';
      const dirty = document.createElement('span');
      dirty.className = 'marxy-toolbar-dirty';
      dirty.setAttribute('role', 'img');
      dirty.setAttribute('aria-label', 'Unsaved changes');
      dirty.textContent = '●';
      dirty.hidden = true;
      const folder = document.createElement('span');
      folder.className = 'marxy-toolbar-folder';
      top.append(name, dirty, folder);
      syncs.push(() => {
        const snap = handle.document()?.snapshot();
        const path = snap?.path ?? null;
        name.textContent = path === null ? '' : documentName(path);
        folder.textContent = path === null || isUntitled(path) || path.startsWith('marxy:') ? '' : basename(dirname(path));
        dirty.hidden = !(snap?.dirty ?? false);
        if (path === null || isUntitled(path)) top.removeAttribute('title');
        else top.title = path;
      });
    } else if (item.kind === 'radios') {
      top.setAttribute('role', 'radiogroup');
      top.setAttribute('aria-label', 'View');
      const radios = MODE_CHOICES.filter((choice) => registry.has(choice.command)).map((choice) => {
        const command = registry.get(choice.command)!;
        const radio = button(choice.label, command.title, tipFor(command, mac));
        radio.setAttribute('role', 'radio');
        bind(radio, choice.command);
        top.append(radio);
        return { id: choice.command, radio };
      });
      syncs.push((ctx) => {
        const panes = handle.panes();
        const [left, right] = panes.panes;
        const split = panes.panes.length === 2 && left!.path() !== null && left!.path() === right!.path();
        const shown = panes.focused.path() !== null;
        const mode = panes.focused.view.mode;
        for (const { id, radio } of radios) {
          const checked =
            id === 'view.mode-split' ? split : !split && shown && (id === 'view.mode-read' ? mode === 'rendered' : mode === 'source');
          radio.setAttribute('aria-checked', String(checked));
          disable(radio, enabled(id, ctx));
        }
      });
    } else if (item.kind === 'split') {
      top.setAttribute('role', 'group');
      top.setAttribute('aria-label', 'Copy');
      const menu = registry.get('copy-as.menu')!;
      const copy = button(item.label ?? 'Copy', 'Copy', 'Copy');
      copy.classList.add('marxy-toolbar-copy');
      const chevron = button('▾', menu.title, tipFor(menu, mac));
      chevron.classList.add('marxy-toolbar-copy-menu');
      chevron.setAttribute('aria-haspopup', 'menu');
      top.append(copy, chevron);
      // The click copies in `copy_format`; Markdown is the default and the fallback for a target not built yet.
      let target = 'copy-as.markdown';
      const learn = async (): Promise<void> => {
        const id = `copy-as.${await configuredFormat(handle)}`;
        target = registry.has(id) ? id : 'copy-as.markdown';
        const command = registry.get(target);
        if (command) {
          copy.setAttribute('aria-label', command.title);
          copy.title = command.title;
        }
      };
      void learn();
      bind(copy, 'copy-as.menu', async () => {
        await learn();
        await runCommand(target);
      });
      bind(chevron, 'copy-as.menu');
      syncs.push((ctx) => {
        disable(copy, enabled(target, ctx));
        disable(chevron, enabled('copy-as.menu', ctx));
      });
    } else {
      const id = item.commands.find((c) => registry.has(c))!;
      const command = registry.get(id)!;
      const control = button(item.label ?? command.title, command.title, tipFor(command, mac));
      top.append(control);
      if (item.kind === 'toggle') {
        const region = item.needsFill!;
        control.setAttribute('aria-pressed', 'false');
        syncs.push((ctx) => {
          disable(control, enabled(id, ctx));
          control.setAttribute('aria-pressed', String(workspace.arrangement?.[region] ?? false));
        });
      } else if (id === 'nav.back' || id === 'nav.forward') {
        // `when` says a document is open. Whether there is anywhere to go is the histories': the palette's
        // session for both, and for Back also a link followed in this window (the pane's own, which only Back
        // walks). Disabled only when neither has a step, never when one might.
        syncs.push((ctx) => {
          const session = palette()?.session;
          const index = session?.historyIndex ?? -1;
          const palettePrev = index > 0;
          const paletteNext = index >= 0 && index < (session?.history.length ?? 0) - 1;
          const has = id === 'nav.back' ? palettePrev || handle.selection.canBack() : paletteNext;
          disable(control, enabled(id, ctx) && has);
        });
      } else {
        syncs.push((ctx) => disable(control, enabled(id, ctx)));
      }
      bind(control, id);
    }
    root.append(top);
  }

  // One tab stop; arrows move within the row (the toolbar pattern). Disabled controls stay reachable.
  // When the row would overflow, the doors in `FOLD_ORDER` fold, lowest first, into one *More* button at its end, so every
  // action stays reachable by mouse and keyboard and nothing is clipped. Measured on the element, so no frame shows both.
  const more = document.createElement('span');
  more.setAttribute('data-marxy-toolbar-item', 'more');
  more.hidden = true;
  const moreButton = button('…', 'More tools', 'More tools');
  moreButton.setAttribute('aria-haspopup', 'menu');
  moreButton.tabIndex = -1;
  more.append(moreButton);
  root.append(more);
  let folded: Array<{ id: string; top: HTMLElement }> = [];
  const foldable = [...root.querySelectorAll<HTMLElement>(':scope > [data-marxy-toolbar-item]')]
    .map((top) => ({ id: top.getAttribute('data-marxy-toolbar-item')!, top }))
    .filter((d) => d.id in FOLD_ORDER)
    .sort((a, b) => FOLD_ORDER[a.id]! - FOLD_ORDER[b.id]!);
  const overflows = (): boolean => root.scrollWidth > root.clientWidth + 0.5;
  const layout = (): void => {
    if (!root.isConnected) return;
    for (const d of foldable) d.top.hidden = false;
    more.hidden = true;
    folded = [];
    if (!overflows()) return;
    more.hidden = false;
    for (const d of foldable) {
      if (!overflows()) break;
      // A door that is out of the row (the chip with no document) has nothing to fold.
      if (!d.top.isConnected) continue;
      d.top.hidden = true;
      folded.push(d);
    }
    // The one tab stop must not be a control that has just folded away.
    if (!controls().some((b) => b.tabIndex === 0)) rove(controls()[0]);
  };
  bind(moreButton, 'more', async () => {
    const ctx = buildAppContext(handle);
    const rows: VerbMenuRow[] = folded.flatMap((d) => {
      const id = TOOLBAR_ITEMS.find((i) => i.id === d.id)?.commands.find((c) => registry.has(c));
      const command = id ? registry.get(id) : undefined;
      return command && enabled(command.id, ctx) ? [{ command, title: command.title, chord: command.key }] : [];
    });
    const box = moreButton.getBoundingClientRect();
    openVerbMenu({ x: Math.round(box.left), y: Math.round(box.bottom), top: Math.round(box.top) }, ctx, { registered: [], allActions: () => {}, rows, label: 'More tools' });
  });

  const controls = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.closest('[hidden]'));
  const rove = (to: HTMLButtonElement | undefined): void => {
    if (!to) return;
    for (const c of controls()) c.tabIndex = c === to ? 0 : -1;
  };
  root.addEventListener('focusin', (event) => {
    if (event.target instanceof HTMLButtonElement) rove(event.target);
  });
  root.addEventListener('keydown', (event) => {
    const list = controls();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to =
      event.key === 'ArrowRight' ? list[(at + 1) % list.length]
      : event.key === 'ArrowLeft' ? list[(at - 1 + list.length) % list.length]
      : event.key === 'Home' ? list[0]
      : event.key === 'End' ? list.at(-1)
      : undefined;
    if (!to) return;
    event.preventDefault();
    to.focus();
  });

  function refresh(): void {
    if (!root.isConnected) return;
    const ctx = buildAppContext(handle);
    for (const sync of syncs) sync(ctx);
    layout();
  }

  el.append(root);
  rove(controls()[0]);
  refresh();
  const offSignal = signal.onChange(refresh);
  const offHistory = handle.selection.onHistoryChange(refresh);
  const off = (): void => {
    offSignal();
    offHistory();
  };
  // A door changing its own width (the kind chip, a longer title) or the window changing size refolds the row.
  const relayout = new ResizeObserver(layout);
  relayout.observe(el);
  const contents = new MutationObserver(layout);
  contents.observe(root, { childList: true, subtree: true, characterData: true });
  // Each pane writes `<body data-marxy-mode>` while it has focus: the switch follows a mode change from any route (⌘E, ⌘1 to ⌘3).
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-marxy-mode'] });
  return () => {
    off();
    observer.disconnect();
    relayout.disconnect();
    contents.disconnect();
    root.remove();
  };
}
