// Close while dirty: one notice, not a modal (docs/design/01-buffer.md, MARXY-49).
import type { Shell } from '@marxy/shell-api';
import { ensureNoticesRegion } from './notices/index.ts';
import { save } from './save.ts';

export interface CloseGuardHost {
  readonly shell: Pick<Shell, 'onCloseRequested' | 'confirmClose'>;
  isDirty(): boolean;
  documentName(): string | null;
}

let closeNoticeUp = false;
let bypassCloseGuard = false;

export function installCloseGuard(host: CloseGuardHost): void {
  if (typeof window === 'undefined') return;
  host.shell.onCloseRequested(() => {
    if (bypassCloseGuard) {
      void host.shell.confirmClose();
      return;
    }
    if (!host.isDirty()) {
      void host.shell.confirmClose();
      return;
    }
    if (closeNoticeUp) {
      bypassCloseGuard = true;
      void host.shell.confirmClose();
      return;
    }
    const name = host.documentName() ?? 'This document';
    closeNoticeUp = true;
    const region = ensureNoticesRegion();
    const line = document.createElement('div');
    line.className = 'marxy-notice';
    const text = document.createElement('span');
    text.className = 'marxy-notice-text';
    text.textContent = `${name} has changes that are not saved.`;
    line.append(text);
    const saveClose = document.createElement('button');
    saveClose.type = 'button';
    saveClose.className = 'marxy-notice-action';
    saveClose.textContent = 'Save and close';
    saveClose.addEventListener('click', () => {
      line.remove();
      closeNoticeUp = false;
      void (async () => {
        const result = await save();
        if (result === 'saved' || result === 'unchanged') {
          bypassCloseGuard = true;
          await host.shell.confirmClose();
        }
      })();
    });
    line.append(saveClose);
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'marxy-notice-action';
    discard.textContent = 'Close without saving';
    discard.addEventListener('click', () => {
      line.remove();
      closeNoticeUp = false;
      bypassCloseGuard = true;
      void host.shell.confirmClose();
    });
    region.append(line);
  });
}
