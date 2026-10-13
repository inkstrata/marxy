// *New file*, *New file here* and *Fork this file* (W-14): what the commands, the + menus and the sidebar's folder menu run.
//
// A new file is a scratch document (E-13): empty, called "Untitled", and nothing is written until the reader's own Save As. *Here*
// only changes where that Save As opens (the folder of the open file, or the sidebar folder the menu was opened on). A fork is the
// one thing here that writes, and `fork.ts` holds the rules it writes by.
import { dirname } from '@marxy/core/src/index-model/paths.ts';
import { appHandle } from '../commands/app-handle.ts';
import type { AppContext } from '../commands/registry.ts';
import { FORK_SAYS } from '../notices/fork.ts';
import { notify, SOURCE_HELD_APART } from '../notices/index.ts';
import { forkPath, writeFork } from './fork.ts';
import { openScratch } from './scratch.ts';
import { isUntitled } from './untitled.ts';

/** A path that is a file on disk: not a scratch document and not one of Marxy's own pages. */
export function isFilePath(path: string | null | undefined): path is string {
  return typeof path === 'string' && !isUntitled(path) && !path.startsWith('marxy:');
}

/** The open document's path when it is a file, else null: what *Fork* and *New file here* need. */
export function openFilePath(ctx: Pick<AppContext, 'document'>): string | null {
  const path = ctx.document?.snapshot().path;
  return isFilePath(path) ? path : null;
}

/**
 * *New file*: an empty scratch document in Source, where the reader can type. `folder` is where its Save As opens. Nothing is
 * written. True when it opened (false when the reader dismissed the unsaved-edits prompt over the pane it would replace).
 */
export function newFile(folder?: string): Promise<boolean> {
  return openScratch('', { saveIn: folder, source: true });
}

/** *New file here* on the open file: a new file whose Save As opens in the open file's folder. */
export function newFileHere(ctx: Pick<AppContext, 'document'>): Promise<boolean> {
  const path = openFilePath(ctx);
  return path === null ? Promise.resolve(false) : newFile(dirname(path));
}

/**
 * *Fork this file*: the open document's bytes, as on disk plus any unsaved edits (Source text is folded in first), written beside it
 * under the first free `(fork)` name and opened. The original is not touched. The notice says where the fork went, or that
 * nothing was written; it is the notice's job, not the open's, so a refused prompt over unsaved edits cannot hide a written file.
 */
export async function forkOpenDocument(ctx: AppContext): Promise<void> {
  const app = appHandle();
  const store = ctx.document;
  const original = openFilePath(ctx);
  if (!app || !store || original === null) return;
  await app.foldSource();
  if (app.hasUnfoldedSource()) {
    ctx.showNotice(SOURCE_HELD_APART, { kind: 'refused' });
    return;
  }
  const snap = store.snapshot();
  if (snap.path !== original) return;
  const outcome = await writeFork(app.shell, original, snap.buffer.bytes);
  if (outcome.result === 'failed') {
    const failed = FORK_SAYS.failed(original, outcome.error);
    ctx.showNotice(failed.text, { kind: failed.kind });
    return;
  }
  // The names tried before this one were taken; each is left exactly as it was, and the notice says so.
  const taken = Array.from({ length: outcome.n - 1 }, (_, i) => forkPath(original, i + 1));
  const done = FORK_SAYS.written(original, outcome.path, taken);
  ctx.showNotice(done.text, { kind: done.kind });
  // Opening replaces the pane's notices, so it is said again where the fork lands.
  await app.open(outcome.path, {
    onLanded() {
      notify({ kind: done.kind, text: done.text });
    },
  });
}
