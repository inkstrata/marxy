// "Changes to <file>": a document's unsaved changes as the patch saving would make, opened beside
// it as a scratch page, so it is read with the patch reading (word marks included) under the same cursor and verbs as any
// page. A bar above it holds Save, Undo, Discard all and Copy the patch, each acting on the document, never on the page;
// the page follows the document's every change until it is closed. Nothing is written but by Save.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../app-types.ts';
import { fenceFor } from '../commands/compare.ts';
import { writeCopy } from '../commands/copy-write.ts';
import { undoDocumentEdit } from '../commands/edits.ts';
import type { DocumentStore } from '../document/store.ts';
import { documentName } from '../document/untitled.ts';
import { notify } from '../notices/index.ts';
import { splitRefusal } from '../pane/fit.ts';
import type { AppContext } from '../commands/registry.ts';
import { changesWords, type Changes } from './patch.ts';
import { changesOfStore, onChangesSummary } from './state.ts';

const escapeMarkdown = (name: string): string => name.replace(/[\\`*_[\]<>#]/g, '\\$&');

/** The page's Markdown: a heading, what saving would do, and the patch as one `diff` fence. */
export function changesPageText(name: string, c: Changes): string {
  const title = `# Changes to ${escapeMarkdown(name)}\n\n`;
  if (c.places === 0) return `${title}No unsaved changes: what you read is what is on disk.\n`;
  const patch = c.patch.endsWith('\n') ? c.patch : `${c.patch}\n`;
  const fence = fenceFor(patch);
  const coarse = c.exact ? '' : ' The file changed too much to match line by line, so some stretches show as one removal and one addition.';
  return `${title}Not yet written: saving would leave the file ${changesWords(c)}, and touch no other byte.${coarse}\n\n${fence}diff\n${patch}${fence}\n`;
}

interface Shown {
  readonly source: DocumentStore;
  scratch: string;
  bar: HTMLElement | null;
  text: string;
}

let shown: Shown | null = null;
let installed: AppHandle | null = null;
/** The command context the page's Copy writes through; the key dispatcher sets it (selection/bind.ts), which imports this file. */
let contextOf: (() => AppContext) | null = null;

export const setChangesContext = (make: () => AppContext): void => {
  contextOf = make;
};
/** What saving from the page is, set by the commands (they hold the review rule). */
let saveFrom: (store: DocumentStore) => Promise<void> = async () => {};

export const setChangesSave = (save: (store: DocumentStore) => Promise<void>): void => {
  saveFrom = save;
};

/** The pane that shows the page now, or null when it has been closed or replaced. */
function pageShown(handle: AppHandle): ReturnType<AppHandle['panes']>['panes'][number] | null {
  return shown ? (handle.panes().panes.find((p) => p.path() === shown!.scratch) ?? null) : null;
}

/** The document the page in the focused pane is about, or null when the focused pane does not show one. */
export function changesPageSource(handle: AppHandle): DocumentStore | null {
  return shown && handle.panes().focused.path() === shown.scratch ? shown.source : null;
}

function button(label: string, act: string, run: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'marxy-btn';
  b.toggleAttribute('data-marxy-primary', primary);
  b.textContent = label;
  b.setAttribute('data-marxy-changes-act', act);
  b.addEventListener('click', run);
  return b;
}

const barSays = new WeakMap<HTMLElement, string>();

function drawBar(handle: AppHandle): void {
  const pane = pageShown(handle);
  if (!shown) return;
  if (!pane) {
    shown.bar?.remove();
    shown.bar = null;
    return;
  }
  const { source } = shown;
  const dirty = source.snapshot().dirty;
  const bar = shown.bar ?? document.createElement('div');
  // The same buttons are kept while they say the same: a press is never lost to a redraw.
  const says = `${dirty} ${source.snapshot().canUndo}`;
  if (barSays.get(bar) === says && bar.parentElement === pane.host && bar.nextElementSibling === pane.article) return;
  bar.className = 'marxy-changes-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Changes');
  const parts: HTMLElement[] = [];
  if (dirty) {
    parts.push(
      button('Save to disk', 'save', () => void saveFrom(source), true),
      button('Undo the last change', 'undo', () => void undoDocumentEdit(source)),
      button('Discard them all', 'discard', () => void discardAll(source)),
      button('Copy the patch', 'copy', () => {
        const c = changesOfStore(source);
        if (c && contextOf) void writeCopy(contextOf(), { text: c.patch }, 'Copied the patch');
      }),
    );
  } else if (source.snapshot().canUndo) {
    parts.push(button('Undo the last change', 'undo', () => void undoDocumentEdit(source)));
  }
  bar.replaceChildren(...parts);
  barSays.set(bar, says);
  bar.hidden = parts.length === 0;
  if (bar.parentElement !== pane.host || bar.nextElementSibling !== pane.article) pane.host.insertBefore(bar, pane.article);
  shown.bar = bar;
}

/** The document back to its bytes on disk, as one change: `u` undoes it like any other. */
export async function discardAll(store: DocumentStore): Promise<boolean> {
  const snap = store.snapshot();
  if (!snap.dirty || snap.disk === null) return false;
  // A store held only for a staged replace (left/held.ts) closes once clean, and its history with it: no u to promise.
  let closed = false;
  const off = store.subscribe((_s, change) => {
    if (change.kind === 'close') closed = true;
  });
  const applied = await store.apply({
    range: { file: snap.path, start: 0, end: snap.buffer.bytes.length },
    replacement: snap.disk,
    label: 'Discard all changes',
    baseVersion: snap.version,
  });
  await new Promise((r) => setTimeout(r, 0));
  off();
  if (applied) notify({ kind: 'done', text: closed ? 'Back to what is on disk' : 'Back to what is on disk · u undoes that too' });
  return applied;
}

async function refresh(handle: AppHandle): Promise<void> {
  if (!shown) return;
  const pane = pageShown(handle);
  if (!pane) {
    drawBar(handle);
    shown = null;
    return;
  }
  const c = changesOfStore(shown.source);
  const text = c ? changesPageText(documentName(shown.source.snapshot().path), c) : shown.text;
  if (text !== shown.text) {
    // A scratch page takes no reload (it has no file): the page is laid again in its pane, focus kept where it was.
    await place(handle, shown.source, text, handle.panes().focused === pane);
    return;
  }
  drawBar(handle);
}

/** While a page is being opened its pane shows the one before it: no refresh then. */
let opening = false;

/** Opens `text` as the page beside `store`'s pane, replacing any page there; focus ends on the page or the document. */
async function place(handle: AppHandle, store: DocumentStore, text: string, focusPage: boolean): Promise<void> {
  opening = true;
  const panes = handle.panes();
  const docPane = panes.panes.find((p) => p.content.store() === store);
  if (docPane && panes.focused !== docPane) panes.focus(docPane);
  const snap = store.snapshot();
  const next: Shown = { source: store, scratch: '', bar: shown?.source === store ? shown.bar : null, text };
  if (shown && shown.source !== store) shown.bar?.remove();
  shown = next;
  try {
    await new Promise<void>((resolve) => {
      void panes
        .openScratch(new TextEncoder().encode(text), {
          beside: true,
          label: `Changes to ${basename(snap.path) || documentName(snap.path)}`,
          onPath: (path) => {
            next.scratch = path;
          },
          onLanded: () => resolve(),
        })
        .then((pane) => {
          if (pane === null) resolve();
        });
    });
  } finally {
    opening = false;
  }
  const page = pageShown(handle);
  const back = focusPage ? page : panes.panes.find((p) => p.content.store() === store);
  if (back && panes.focused !== back) panes.focus(back);
  drawBar(handle);
}

function install(handle: AppHandle): void {
  if (installed === handle) return;
  installed = handle;
  let queued = false;
  const later = (): void => {
    if (queued || opening) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      void refresh(handle);
    });
  };
  onChangesSummary((path) => {
    if (shown && (path === shown.source.snapshot().path || path === shown.scratch)) later();
  });
  handle.panes().onChange(later);
}

/**
 * Opens the page for `store` beside it, or brings the open one up to date and focuses it. With nothing unsaved it says so
 * and opens nothing.
 */
export async function openChangesPage(handle: AppHandle, store: DocumentStore): Promise<void> {
  install(handle);
  const snap = store.snapshot();
  const name = documentName(snap.path);
  const c = changesOfStore(store);
  if (c === null) {
    notify({ kind: 'refused', text: `The changes to ${name} are too large to lay out as a patch here` });
    return;
  }
  if (c.places === 0) {
    notify({ kind: 'done', text: `No unsaved changes to ${name} · what you read is what is on disk` });
    return;
  }
  const panes = handle.panes();
  const open = shown?.source === store ? pageShown(handle) : null;
  if (open) {
    await refresh(handle);
    panes.focus(open);
    return;
  }
  if (panes.panes.length === 1) {
    const refusal = splitRefusal(panes);
    if (refusal !== null) {
      notify({ kind: 'refused', text: refusal });
      return;
    }
  }
  await place(handle, store, changesPageText(name, c), true);
}
