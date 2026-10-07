// Close while dirty: one notice, not a modal (docs/design/01-buffer.md, MARXY-49). Opening another
// document while dirty takes the same path (MARXY-337).
import type { Shell } from '@marxy/shell-api';
import { ensureNoticesRegion } from './notices/index.ts';
import type { SaveResult } from './save.ts';

export interface CloseGuardHost {
  readonly shell: Pick<Shell, 'onCloseRequested' | 'confirmClose'>;
  /** The store's `dirty`, or Source text the reader typed and has not yet folded into it. */
  isDirty(): boolean;
  documentName(): string | null;
  /** The open document's explicit save (save.ts), for "Save and close" and "Save and open". */
  save(): Promise<SaveResult>;
}

interface Prompt {
  readonly kind: 'close' | 'open';
  readonly saveLabel: string;
  readonly discardLabel: string;
  /** Runs once the reader has chosen to go on: after a save, or without one. */
  readonly proceed: () => void | Promise<void>;
}

let installed: CloseGuardHost | null = null;
// The one notice on screen, if any. "Up" means still attached: something else (opening a document
// clears every notice) may have removed it, and a stale flag would swallow the next close.
let notice: { readonly line: HTMLElement; readonly kind: Prompt['kind'] } | null = null;

const noticeIsUp = (): boolean => notice !== null && notice.line.isConnected;

export function installCloseGuard(host: CloseGuardHost): void {
  if (typeof window === 'undefined' || !host.shell.onCloseRequested) return;
  installed = host;
  host.shell.onCloseRequested(() => {
    if (!host.isDirty()) {
      void host.shell.confirmClose();
      return;
    }
    if (noticeIsUp() && notice?.kind === 'close') {
      // A second close request while the notice is up: the reader asked twice.
      notice.line.remove();
      void host.shell.confirmClose();
      return;
    }
    showPrompt({
      kind: 'close',
      saveLabel: 'Save and close',
      discardLabel: 'Close without saving',
      proceed: () => host.shell.confirmClose(),
    });
  });
}

/**
 * Opening another document while the open one has unsaved changes. Returns true when it has taken
 * over — a notice offers save, discard or dismiss, and `proceed` runs only on save or discard — and
 * false when nothing is unsaved and the caller opens straight away.
 */
export function confirmLeaveDocument(proceed: () => void | Promise<void>): boolean {
  if (!installed?.isDirty()) return false;
  showPrompt({ kind: 'open', saveLabel: 'Save and open', discardLabel: 'Open without saving', proceed });
  return true;
}

function showPrompt(prompt: Prompt): void {
  const host = installed;
  if (!host) return;
  notice?.line.remove();
  const name = host.documentName() ?? 'This document';
  const line = document.createElement('div');
  line.className = 'marxy-notice';
  const text = document.createElement('span');
  text.className = 'marxy-notice-text';
  text.textContent = `${name} has changes that are not saved.`;
  line.append(text);

  const button = (className: string, label: string, onClick: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', onClick);
    line.append(b);
  };
  button('marxy-notice-action', prompt.saveLabel, () => {
    line.remove();
    void (async () => {
      const result = await host.save();
      if (result !== 'saved' && result !== 'unchanged') return;
      // The reader kept editing while the save ran: what they see is not what reached disk, and going on
      // would drop it. Ask again.
      if (host.isDirty()) showPrompt(prompt);
      else await prompt.proceed();
    })();
  });
  button('marxy-notice-action', prompt.discardLabel, () => {
    line.remove();
    void prompt.proceed();
  });
  button('marxy-notice-dismiss', 'Dismiss', () => line.remove());

  ensureNoticesRegion().append(line);
  notice = { line, kind: prompt.kind };
}
