// Explicit byte-faithful save from either mode (docs/design/01-buffer.md §Save, MARXY-49).
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { Shell, ShellError } from '@marxy/shell-api';
import { appHandle } from './commands/app-handle.ts';
import type { DocumentStore } from './document/store.ts';
import { ensureNoticesRegion } from './notices/index.ts';

export type SaveResult = 'saved' | 'unchanged' | 'cancelled' | 'failed';

/** What a save needs: the store it writes (ADR-0037 §5), and what only the app can do around it. */
export interface SaveDeps {
  readonly store: DocumentStore;
  readonly shell: Pick<Shell, 'saveDialog' | 'setTitle' | 'allowAssetScope'>;
  /** Folds unfolded Source text into the store first (`commitSource`), so a save from Source writes it. */
  foldSource(): Promise<void>;
  /** Source text this pane's fold could not take (held apart from another pane's, D-11): a save would not write it. */
  holdsUnfoldedSource?(): boolean;
  /** The save went to a new path and the store now answers to it: scope, watch and title follow. */
  onSaveAs(path: string): Promise<void>;
}

function shellErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim() !== '') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as ShellError).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return fallback;
}

function readOnlyNoticeName(path: string): string {
  if (path.startsWith('marxy:')) return basename(path) || 'about.md';
  return basename(path);
}

function showSaveFailedNotice(path: string, reason: string, retry: () => void): void {
  const region = ensureNoticesRegion();
  const line = document.createElement('div');
  line.className = 'marxy-notice';
  const text = document.createElement('span');
  text.className = 'marxy-notice-text';
  const name = basename(path);
  text.textContent = `Could not save ${name}: ${reason}`;
  line.append(text);
  const saveAs = document.createElement('button');
  saveAs.type = 'button';
  saveAs.className = 'marxy-notice-action';
  saveAs.textContent = 'Save as…';
  saveAs.addEventListener('click', () => {
    line.remove();
    void retry();
  });
  line.append(saveAs);
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'marxy-notice-dismiss';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => line.remove());
  line.append(dismiss);
  region.append(line);
}

/**
 * Writes the open document's buffer through its store, to its own path or, with `as` (or an untitled
 * buffer), to one the reader picks. A failed write changes nothing in the store, history included,
 * and says why with a "Save as…" retry.
 *
 * Called without deps it saves whatever document the running app has open: the Source editor's own
 * `Mod-s` keymap (source/editor.ts) calls it that way.
 */
export function save(deps: SaveDeps | null, opts?: { as?: boolean }): Promise<SaveResult>;
export function save(opts?: { as?: boolean }): Promise<SaveResult>;
export async function save(
  first?: SaveDeps | null | { as?: boolean },
  second?: { as?: boolean },
): Promise<SaveResult> {
  if (first === undefined || (first !== null && !('store' in first))) {
    return (await appHandle()?.save(first)) ?? 'failed';
  }
  const deps = first;
  const opts = second;
  if (!deps) return 'failed';
  const { store } = deps;
  await deps.foldSource();
  // Held apart (D-11): the store holds the other pane's text, not this pane's, so writing it would say "saved"
  // while this pane's typing is still only in its editor. Refuse, and say why.
  if (deps.holdsUnfoldedSource?.()) {
    const { notify, SOURCE_HELD_APART } = await import('./notices/index.ts');
    notify({ kind: 'info', text: SOURCE_HELD_APART });
    return 'cancelled';
  }
  const snap = store.snapshot();
  if (!snap.dirty && !opts?.as) return 'unchanged';

  let path = snap.path;
  if (path === 'untitled' || opts?.as) {
    const picked = await deps.shell.saveDialog({ defaultPath: path === 'untitled' ? undefined : basename(path) });
    if (!picked) return 'cancelled';
    path = picked;
  }

  if (path.startsWith('marxy:')) {
    const { notify } = await import('./notices/index.ts');
    notify({
      kind: 'info',
      text: `${readOnlyNoticeName(path)} is part of Marxy and cannot be saved`,
    });
    return 'cancelled';
  }

  let written: Awaited<ReturnType<DocumentStore['save']>>;
  try {
    written = await store.save(path === snap.path ? undefined : { to: path });
  } catch (err) {
    // Another document opened while the dialog was up and closed this store: the transition is
    // refused, nothing was written, and the reader's edits were already guarded on leaving.
    if (err instanceof Error && /\bis closed$/.test(err.message)) return 'cancelled';
    throw err;
  }
  if (written.result === 'failed') {
    const err = written.error;
    const code = err && typeof err === 'object' && 'code' in err ? (err as ShellError).code : undefined;
    // The shell's own message says why (read-only, hard link, not a regular file, changed on disk);
    // the code only picks a fallback when there is none.
    const reason = shellErrorMessage(err, code === 'permission' ? 'permission was denied.' : 'the write failed.');
    showSaveFailedNotice(path, reason, () => void save(deps, { as: true }));
    return 'failed';
  }
  if (written.result === 'unchanged') return 'unchanged';
  if (path !== snap.path) await deps.onSaveAs(path);
  return 'saved';
}
