// Explicit byte-faithful save from either mode (docs/design/01-buffer.md §Save, MARXY-49).
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { Buffer } from '@marxy/core';
import type { Shell, ShellError } from '@marxy/shell-api';
import { documentIsDirty, markDocumentSaved } from './commands/edits.ts';
import { ensureNoticesRegion } from './notices/index.ts';
import { updateTitle } from './title.ts';

export type SaveResult = 'saved' | 'unchanged' | 'cancelled' | 'failed';

export interface SaveHost {
  readonly shell: Pick<Shell, 'writeFileAtomic' | 'saveDialog' | 'setTitle' | 'allowAssetScope'>;
  getOpenBuffer(): Buffer | null;
  foldSourceIntoBuffer(): Promise<Buffer | null>;
  isReadOnlyPath(path: string): boolean;
  /**
   * `documentUnchanged` is false when the open document was edited while the save was in flight: the
   * host then keeps its newer buffer (which stays dirty) and only records what reached disk.
   */
  onSaved(path: string, buffer: Buffer, documentUnchanged: boolean): Promise<void>;
  onSaveAsPath(path: string): Promise<void>;
}

let host: SaveHost | null = null;

export function installSave(next: SaveHost): void {
  host = next;
}

function shellErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim() !== '') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as ShellError).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return fallback;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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

export async function save(opts?: { as?: boolean }): Promise<SaveResult> {
  if (!host) return 'failed';
  const folded = await host.foldSourceIntoBuffer();
  if (!folded) return 'failed';
  const dirty = documentIsDirty(folded);
  if (!dirty && !opts?.as) return 'unchanged';

  let path = folded.path;
  if (path === 'untitled' || opts?.as) {
    const picked = await host.shell.saveDialog({ defaultPath: path === 'untitled' ? undefined : basename(path) });
    if (!picked) return 'cancelled';
    path = picked;
  }

  if (host.isReadOnlyPath(path)) {
    const { notify } = await import('./notices/index.ts');
    notify({
      kind: 'info',
      text: `${readOnlyNoticeName(path)} is part of Marxy and cannot be saved`,
    });
    return 'cancelled';
  }

  const bufferOnDisk = path === folded.path ? folded : { ...folded, path };

  try {
    await host.shell.writeFileAtomic(path, bufferOnDisk.bytes);
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as ShellError).code : undefined;
    // The shell's own message says why (read-only, hard link, not a regular file, changed on disk);
    // the code only picks a fallback when there is none.
    const reason = shellErrorMessage(err, code === 'permission' ? 'permission was denied.' : 'the write failed.');
    showSaveFailedNotice(path, reason, () => void save({ as: true }));
    return 'failed';
  }

  // The write took time. If the reader opened another document meanwhile, the saved state belongs to
  // this file only and must not replace the new document's baseline.
  const openNow = await host.foldSourceIntoBuffer();
  if (!openNow || openNow.path !== folded.path) return 'saved';

  markDocumentSaved(bufferOnDisk);
  const documentUnchanged = sameBytes(openNow.bytes, folded.bytes);
  if (path !== folded.path) {
    await host.onSaveAsPath(path);
  }
  await host.onSaved(path, bufferOnDisk, documentUnchanged);
  // An edit made while the save was in flight leaves the document newer than the file: stay dirty.
  const current = host.getOpenBuffer();
  if (current && current.path === path) {
    await updateTitle(host.shell, path, documentUnchanged ? false : documentIsDirty(current));
  }
  return 'saved';
}
