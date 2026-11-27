// "Find in this pane" (`Mod+F`): Rendered find in the focused pane's article, or CodeMirror's own
// search panel in that pane's editor when it shows Source. Nothing here searches both panes.
//
// "Replace" (`Mod+Alt+F`): Source only. The same panel, with its replace field focused. Replace changes the
// current match; Replace all… opens a preview of every change and changes nothing until Apply
// (`source/replace-sheet.ts`). Rendered has no replace: it has no caret, and a replacement would reshape the page.
import { activeFind, findFor, type FindController } from '../find/view.ts';
import { onTabRemoved } from '../frame/window-tabs.ts';
import { focusOrigin } from '../pane/focus.ts';
import type { Pane, PaneContent, PaneSet } from '../pane/pane-set.ts';
import { appHandle } from './app-handle.ts';
import type { Command } from './registry.ts';

/** Pane sets whose changes already reach find: a page set again re-matches, a pane that went closes it. */
const followed = new WeakSet<object>();

/**
 * A find put away with its document (another document came into its pane), to come back when that document does. It is
 * let go when its document's tab closes, and when the reader opens or closes a find: the one they ask for is the one.
 */
let away: { readonly path: string; readonly query: string; readonly pattern: RegExp | null } | null = null;
/** How long a document coming back is waited for to be drawn before its find is let go. */
const BACK_WAIT_MS = 3000;

onTabRemoved((path) => {
  if (away?.path === path) away = null;
});

function follow<C extends PaneContent>(panes: PaneSet<C>): void {
  if (followed.has(panes)) return;
  followed.add(panes);
  panes.onChange((e) => {
    const find = activeFind();
    if (find && !panes.panes.some((pane) => pane === find.pane)) {
      find.close();
      return;
    }
    if (e.kind !== 'open' || !e.pane) return;
    const pane = e.pane;
    const path = pane.path();
    if (find && find.pane === pane) {
      // Its own document again (a reload, an edit): matched again where it is.
      if (find.document() === path) {
        void pane.view.settled().then(() => find.refresh());
        return;
      }
      // Another document in its pane: the find goes away with its own. The same document opened in the other pane leaves
      // it where it is.
      const { query, pattern } = find.state();
      const doc = find.document();
      find.close();
      away = doc !== null && query !== '' ? { path: doc, query, pattern } : null;
    }
    if (!away || away.path !== path || pane.view.mode === 'source') return;
    const back = away;
    away = null;
    const drawn = Promise.race([pane.view.settled().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), BACK_WAIT_MS))]);
    void drawn.then((ok) => {
      // A find the reader has open meanwhile, on any document, stays theirs.
      if (!ok || pane.path() !== back.path || pane.view.mode === 'source' || activeFind()?.isOpen()) return;
      findIn(pane).seek(back.query, back.pattern, { focus: false });
    });
  });
}

/** Where each find gives focus back: the pane focused when it was last opened (`focusOrigin`). */
const origins = new WeakMap<Pane, ReturnType<typeof focusOrigin>>();

/** `pane`'s find, made with what it needs once. */
function findIn(pane: Pane): FindController {
  const handle = appHandle();
  return findFor(pane, {
    mark: (name, data) => void handle?.shell.mark(name, Date.now(), data),
    restoreFocus: () => {
      // Closed by the reader (Esc): nothing put away comes back over what they chose.
      away = null;
      origins.get(pane)?.restore();
    },
  });
}

/** Opens `pane`'s Rendered find, recording the pane focus returns to. */
function openRendered<C extends PaneContent>(panes: PaneSet<C>, pane: Pane<C>): FindController {
  away = null;
  origins.set(pane, focusOrigin(panes));
  const find = findIn(pane);
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

/** The Line's `/`: the focused pane's Rendered find opened on `text`, matched by `re`. */
export function findInPane(text: string, re: RegExp | null): boolean {
  const panes = appHandle()?.panes();
  if (!panes || panes.focused.path() === null || panes.focused.view.mode === 'source') return false;
  follow(panes);
  const pane = panes.focused;
  away = null;
  origins.set(pane, focusOrigin(panes));
  findIn(pane).seek(text, re);
  return true;
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
        away = null;
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
          away = null;
          activeFind()?.close();
          await sourceSearch(pane);
          return;
        }
        openRendered(panes, pane);
      },
    },
  ];
}
