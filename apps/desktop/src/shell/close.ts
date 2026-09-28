// Close while dirty: one notice, not a modal (docs/design/01-buffer.md, MARXY-49).
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { ensureNoticesRegion } from '../notices/index.ts';
import { save } from './save.ts';

export interface CloseGuardHost {
  isDirty(): boolean;
  documentName(): string | null;
}

let closeNoticeUp = false;
let bypassCloseGuard = false;

export function installCloseGuard(host: CloseGuardHost): void {
  if (typeof window === 'undefined') return;
  void listen('marxy:close-requested', () => {
    if (bypassCloseGuard) {
      void invoke('close_confirmed');
      return;
    }
    if (!host.isDirty()) {
      void invoke('close_confirmed');
      return;
    }
    if (closeNoticeUp) {
      bypassCloseGuard = true;
      void invoke('close_confirmed');
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
          await invoke('close_confirmed');
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
      void invoke('close_confirmed');
    });
    region.append(line);
  });
}
