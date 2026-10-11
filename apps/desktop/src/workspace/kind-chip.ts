// The kind chip and the per-kind tool strip (K-07; ADR-0060 items 3 and 6, mock-v2 01-workspace and 03-content-modes),
// both drawn only while the window is unfolded (workspace/fill.ts); folded there is neither: no chip and no strip.
//
// The chip is the toolbar's `kind` door (W-05), which draws a plain button once `kind.chip` is registered. This
// gives that button the kind's glyph (K-18) and name and keeps it true to the focused pane's `data-marxy-kind`, so a
// kind decided late (K-05a.1) or decided again by a *Show as* reopen shows at once; with no document open the door is
// taken out of the row entirely. In a row too narrow for it the toolbar folds it into *More* (toolbar.ts). Its menu is `commands/kind-chip.ts`. The strip is the `strip` region: the focused
// kind's tools whose commands are registered (`toolsFor`), nothing when there are none, and then the band is hidden
// from emptiness on the element itself. The remembered panel arrangement is never touched.
import { parseConfig } from '@marxy/theme';
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import type { AppHandle } from '../app.ts';
import type { Command } from '../commands/registry.ts';
import { kindIconElement } from '../kind-icons/icons.ts';
import { buildAppContext } from '../selection/bind.ts';
import { toolsFor, type StripTool } from './strip.ts';
import type { DocumentSignal } from './toolbar.ts';

/** `data-marxy-kind` is written on a pane's `section` (pane/dom.ts); the panes sit in one `#marxy-main`. */
const KIND_ATTRIBUTE = 'data-marxy-kind';

/** Calls `cb` when any pane's kind attribute changes, whichever route changed it. Returns what stops it. */
function watchKinds(handle: AppHandle, cb: () => void): () => void {
  const main = handle.panes().panes[0]?.host.parentElement;
  if (!main) return () => {};
  const observer = new MutationObserver(cb);
  observer.observe(main, { attributes: true, attributeFilter: [KIND_ATTRIBUTE], subtree: true });
  return () => observer.disconnect();
}

const focusedKind = (handle: AppHandle): Kind | null => handle.panes().focused.kind();

/** Fills the chip into the toolbar's `kind` item. Returns what takes it out. */
export function mountKindChip(el: HTMLElement, handle: AppHandle, signal: DocumentSignal): () => void {
  const item = el.querySelector<HTMLElement>('[data-marxy-toolbar-item="kind"]');
  const button = item?.querySelector('button');
  if (!item || !button) return () => {};
  // The door keeps its place in the row while it is out of it.
  const place = document.createComment('kind chip');
  item.before(place);

  let drawn: Kind | null = null;
  const refresh = (): void => {
    const kind = focusedKind(handle);
    if (kind === null) {
      drawn = null;
      item.remove();
      return;
    }
    if (!item.isConnected) place.after(item);
    if (drawn === kind) return;
    drawn = kind;
    const name = document.createElement('span');
    name.className = 'marxy-kind-chip-name';
    name.textContent = kind;
    button.replaceChildren(kindIconElement(document, kind), name);
    // base.css is not this story's: the glyph and the name sit on one line, centred, by the button's own style.
    button.style.display = 'inline-flex';
    button.style.alignItems = 'center';
    button.style.gap = '0.4em';
    button.setAttribute('aria-label', `Kind: ${kind}. How this file is read`);
    button.setAttribute('aria-haspopup', 'menu');
    button.title = `${kind}: how this file is read`;
    item.dataset.marxyKind = kind;
  };
  refresh();
  const off = signal.onChange(refresh);
  const stop = watchKinds(handle, refresh);
  return () => {
    off();
    stop();
    place.remove();
  };
}

/** `[strip]` from config.toml, read when asked so an edit counts at once; empty when there is no file or it cannot be read. */
async function stripConfig(handle: AppHandle): Promise<{ readonly strip: Readonly<Record<string, readonly string[]>> }> {
  try {
    const { configPaths, readFile } = handle.shell;
    if (!configPaths) return { strip: {} };
    const { config } = await configPaths();
    if (config === '') return { strip: {} };
    return { strip: parseConfig(await readFile(config)).config.strip };
  } catch {
    return { strip: {} };
  }
}

/** Fills the `strip` region with the focused kind's tools. Returns what takes them out. */
export function mountStrip(el: HTMLElement, handle: AppHandle, signal: DocumentSignal): () => void {
  const workspace = handle.workspace();
  const registry = new Map((handle.commands() as readonly Command[]).map((c) => [c.id, c] as const));
  const root = document.createElement('div');
  root.className = 'marxy-toolbar marxy-strip';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Tools for this kind');

  let tools: readonly StripTool[] = [];
  let latest = 0;
  // Hidden from what is on it, not through `setPanel`: the remembered arrangement stays as the reader left it.
  const settle = (): void => {
    const want = tools.length === 0 || workspace.arrangement?.strip === false;
    if (el.hidden !== want) el.hidden = want;
  };
  settle();

  const press = async (tool: StripTool): Promise<void> => {
    const command = tool.command === null ? undefined : registry.get(tool.command);
    if (!command) return;
    const ctx = buildAppContext(handle);
    if (!command.when(ctx)) return;
    try {
      await command.run(ctx);
    } catch (error) {
      console.warn(`marxy: ${command.id} failed from the strip`, error);
    }
    sync();
  };

  const sync = (): void => {
    const ctx = buildAppContext(handle);
    for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
      const command = registry.get(button.dataset.command ?? '');
      let ok = false;
      try {
        ok = command?.when(ctx) ?? false;
      } catch {
        ok = false;
      }
      if (ok) button.removeAttribute('aria-disabled');
      else button.setAttribute('aria-disabled', 'true');
    }
  };

  const render = (next: readonly StripTool[]): void => {
    const same = next.length === tools.length && next.every((t, i) => t.id === tools[i]!.id);
    tools = next;
    if (!same) {
      root.replaceChildren(
        ...next.map((tool) => {
          const command = registry.get(tool.command!)!;
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = tool.label;
          button.dataset.tool = tool.id;
          button.dataset.command = command.id;
          button.setAttribute('aria-label', command.title);
          button.title = command.title;
          button.addEventListener('mousedown', (event) => event.preventDefault());
          button.addEventListener('click', () => {
            if (button.getAttribute('aria-disabled') === 'true') return;
            void press(tool);
          });
          return button;
        }),
      );
      const first = root.querySelector('button');
      if (first) first.tabIndex = 0;
      for (const b of root.querySelectorAll('button')) if (b !== first) b.tabIndex = -1;
    }
    // A strip with nothing on it is not in the page at all, not only hidden.
    if (next.length === 0) root.remove();
    else if (!root.isConnected) el.append(root);
    sync();
    settle();
  };

  const refresh = async (): Promise<void> => {
    const mine = ++latest;
    const kind = focusedKind(handle);
    if (kind === null) return render([]);
    const config = await stripConfig(handle);
    // A later refresh (another document, a late kind) has the say; a strip taken out does not draw.
    if (mine !== latest || !el.isConnected) return;
    render(toolsFor(kind, config, registry.keys()));
  };

  root.addEventListener('keydown', (event) => {
    const list = [...root.querySelectorAll<HTMLButtonElement>('button')];
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
    for (const b of list) b.tabIndex = b === to ? 0 : -1;
    to.focus();
  });

  void refresh();
  const off = signal.onChange(() => void refresh());
  const stop = watchKinds(handle, () => void refresh());
  // Docking the strip from elsewhere (setPanel) must not show an empty band.
  const hiding = new MutationObserver(settle);
  hiding.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  return () => {
    latest++;
    off();
    stop();
    hiding.disconnect();
    root.remove();
  };
}
