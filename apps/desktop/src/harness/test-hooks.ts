// The hooks the WebKit tests drive (B-16). Only harness pages load this module (app-harness.ts and
// test/palette-boot.html), so the shipped bundle carries none of it: scripts/gate-bundle.mjs fails a
// release build that contains `installTestHooks`. Each hook is built on the running app's handle (its
// store, view and selection), never on module state, and `installTestHooks` again (a second `startApp`
// in one page) moves them all to the new handle.
import { createBuffer, parseMarkdown, sectionRange, textOf, type Node } from '@marxy/core';
import { alignTablePipes } from '@marxy/core/src/operations/align-table-pipes.ts';
import type { AppHandle } from '../app.ts';
import { sourceViewCommands } from '../commands/source-view.ts';
import { taskMarkersInstalled } from '../render/tasks.ts';
import { buildAppContext } from '../selection/bind.ts';
import { resolve } from '../selection/resolve.ts';
import { updateTabWidthResolver } from '../source/tab-width.ts';

function findTable(node: Node): Node | null {
  if (node.type === 'table') return node;
  for (const child of node.children ?? []) {
    const hit = findTable(child);
    if (hit) return hit;
  }
  return null;
}

/** Aligns the first table of the open document through the handle's `apply`; resolves its summary. */
async function alignFirstTable(handle: AppHandle): Promise<string | undefined> {
  const snap = handle.document()?.snapshot();
  if (!snap) return undefined;
  const table = findTable(snap.ast);
  if (!table || table.type !== 'table') return undefined;
  const range = table.src;
  const result = alignTablePipes.run({ document: snap.ast, node: table, range, text: textOf(snap.buffer, range) });
  if (result.replacement === textOf(snap.buffer, range)) return result.summary;
  await handle.dispatch({
    type: 'apply',
    range,
    replacement: result.replacement,
    label: alignTablePipes.title,
    baseVersion: snap.version,
  });
  const { notify } = await import('../notices/index.ts');
  if (result.summary) notify({ kind: 'info', text: result.summary, transient: true });
  return result.summary;
}

/** Sets every `window.marxy*` / `window.__marxy*` hook a test reads, against `handle`. */
export function installTestHooks(handle: AppHandle): void {
  const w = window as unknown as Record<string, unknown>;
  const doc = (): HTMLElement | null => document.getElementById('doc');

  w.marxySelection = {
    getSelectionState: () => handle.selection.state(),
    /** Replaces `#doc`'s nodes with clones of themselves (the bytes do not change), then re-resolves. */
    rerenderWithSameHtml: () => {
      const article = doc();
      if (!article || !handle.document()) return;
      article.replaceChildren(...[...article.childNodes].map((n) => n.cloneNode(true)));
      handle.selection.afterRender();
    },
    resolve,
    textOf,
    parseMarkdown,
    sectionRange,
    createBuffer,
  };

  w.marxyDocumentEdit = () => {
    const snap = handle.document()?.snapshot();
    return snap ? { dirty: snap.dirty, savedVersion: snap.version } : { dirty: false, savedVersion: 0 };
  };
  w.marxyHarnessUndo = () => handle.dispatch({ type: 'undo' });
  w.marxyHarnessRedo = () => handle.dispatch({ type: 'redo' });
  w.marxyHarnessSave = () => handle.save();
  w.marxyHarnessAlignTable = () => alignFirstTable(handle);

  w.marxyRunCommand = async (id: string) => {
    const cmd = sourceViewCommands().find((c) => c.id === id);
    if (!cmd) return;
    const ctx = buildAppContext(handle);
    if (!cmd.when(ctx)) return;
    await cmd.run(ctx);
  };
  w.marxyRefreshSourceTab = async () => {
    const path = handle.currentPath();
    if (!path) return;
    await updateTabWidthResolver(path, handle.shell);
    await new Promise((r) => setTimeout(r, 0));
  };
  w.marxySourceTabSize = async () => {
    const { EditorView } = await import('@codemirror/view');
    const dom = document.querySelector<HTMLElement>('#marxy-source .cm-editor');
    const view = dom ? EditorView.findFromDOM(dom) : null;
    return view?.state.tabSize ?? null;
  };

  installReadinessFlags();
}

/**
 * Readiness flags, read as they stand: the task click is installed on an article, and the rendered
 * document is in `#doc` with it installed (the harness waits on these before it edits). They need no
 * app, so a page that only builds views (`marxyViewHarness`) has them too.
 */
export function installReadinessFlags(): void {
  Object.defineProperty(window, '__marxyTasksReady', {
    configurable: true,
    get: () => [...document.querySelectorAll<HTMLElement>('.marxy-article')].some(taskMarkersInstalled),
  });
  Object.defineProperty(window, '__marxyOpenSynced', {
    configurable: true,
    get: () => {
      const article = document.getElementById('doc');
      return article !== null && article.querySelector('[data-marxy-s]') !== null && taskMarkersInstalled(article);
    },
  });
}
