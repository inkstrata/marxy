// "Find in this pane" (`Mod+F`, D-13): Rendered find in the focused pane's article, or CodeMirror's own
// search panel in that pane's editor when it shows Source. Nothing here searches both panes.
//
// "Replace" (`Mod+Alt+F`, V-03): Source only. The same panel, with its replace field focused. Replace changes the
// current match; Replace all… opens a preview of every change and changes nothing until Apply
// (`source/replace-sheet.ts`). Rendered has no replace: it has no caret, and a replacement would reshape the page.
import { activeFind, findFor, type FindController } from '../find/view.ts';
import { focusOrigin } from '../pane/focus.ts';
import type { Pane, PaneContent, PaneSet } from '../pane/pane-set.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

/** Pane sets whose changes already reach find: a page set again re-matches, a pane that went closes it. */
const followed = new WeakSet<object>();

function follow<C extends PaneContent>(panes: PaneSet<C>): void {
  if (followed.has(panes)) return;
  followed.add(panes);
  panes.onChange((e) => {
    const find = activeFind();
    if (!find) return;
    if (!panes.panes.some((pane) => pane === find.pane)) {
      find.close();
      return;
    }
    if (e.kind === 'open' && e.pane === find.pane) {
      void find.pane.view.settled().then(() => find.refresh());
    }
  });
}

/** Where each find gives focus back: the pane focused when it was last opened (D-06's `focusOrigin`). */
const origins = new WeakMap<Pane, ReturnType<typeof focusOrigin>>();

/** Opens `pane`'s Rendered find, recording the pane focus returns to. */
function openRendered<C extends PaneContent>(panes: PaneSet<C>, pane: Pane<C>): FindController {
  const handle = appHandle();
  origins.set(pane, focusOrigin(panes));
  const find = findFor(pane, {
    mark: (name, data) => void handle?.shell.mark(name, Date.now(), data),
    restoreFocus: () => origins.get(pane)?.restore(),
  });
  find.open();
  return find;
}

/** CodeMirror's search panel in `pane`'s editor (the keymap is already in `baseExtensions`). */
async function sourceSearch(pane: Pane): Promise<void> {
  const editor = pane.parts.source.querySelector<HTMLElement>('.cm-editor');
  if (!editor) return;
  const [{ EditorView }, { openSearchPanel }] = await Promise.all([import('@codemirror/view'), import('@codemirror/search')]);
  const view = EditorView.findFromDOM(editor);
  if (view) openSearchPanel(view);
}

/** The focused pane shows Source: Replace means its editor. */
function focusedInSource(): boolean {
  const panes = appHandle()?.panes();
  return panes !== undefined && panes.focused.path() !== null && panes.focused.view.mode === 'source';
}

/** The find panel in the focused pane's editor, with the replace field focused. */
async function sourceReplace(pane: Pane): Promise<void> {
  const editor = pane.parts.source.querySelector<HTMLElement>('.cm-editor');
  if (!editor) return;
  const [{ EditorView }, { openReplacePanel }] = await Promise.all([import('@codemirror/view'), import('../source/replace-sheet.ts')]);
  const view = EditorView.findFromDOM(editor);
  if (view) await openReplacePanel(view);
}

export function findCommands(): readonly Command[] {
  return [
    {
      id: 'view.replace',
      title: 'Replace',
      key: 'Mod+Alt+F',
      // From inside the editor and its find panel too: the key is the registry's, not CodeMirror's.
      global: true,
      group: 'view',
      when: focusedInSource,
      run: async () => {
        const panes = appHandle()?.panes();
        if (!panes || panes.focused.view.mode !== 'source') return;
        activeFind()?.close();
        await sourceReplace(panes.focused);
      },
    },
    {
      id: 'view.find',
      title: 'Find in this pane',
      key: 'Mod+F',
      group: 'view',
      when: () => {
        const panes = appHandle()?.panes();
        return panes !== undefined && panes.focused.path() !== null;
      },
      run: async () => {
        const panes = appHandle()?.panes();
        if (!panes) return;
        follow(panes);
        const pane = panes.focused;
        if (pane.view.mode === 'source') {
          activeFind()?.close();
          await sourceSearch(pane);
          return;
        }
        openRendered(panes, pane);
      },
    },
  ];
}
