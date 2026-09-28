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
  onSaved(path: string, buffer: Buffer): Promise<void>;
  onSaveAsPath(path: string): Promise<void>;
}

let host: SaveHost | null = null;

export function installSave(next: SaveHost): void {
  host = next;
}

function shellErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as ShellError).message === 'string') {
    return (err as ShellError).message;
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
    const reason =
      code === 'permission'
        ? 'it is read-only.'
        : shellErrorMessage(err, 'the write failed.');
    showSaveFailedNotice(path, reason, () => void save({ as: true }));
    return 'failed';
  }

  markDocumentSaved(bufferOnDisk);
  if (path !== folded.path) {
    await host.onSaveAsPath(path);
  }
  await host.onSaved(path, bufferOnDisk);
  await updateTitle(host.shell, path, false);
  return 'saved';
}
