// The one key for news (U-02, X-21 ruling 9), `Mod+Alt+N` (a pane chord, pane/keys.ts, so it works from Source): it moves focus to the newest notice showing, Tab then reaches its
// actions, and Esc on it dismisses it (notices/index.ts). Esc's order for the sheet, find and the peek is untouched.
import { focusNewestNotice } from '../notices/index.ts';
import type { Command } from './registry.ts';

export function noticeCommands(): readonly Command[] {
  return [
    {
      id: 'notices.focus',
      title: 'Go to the newest notice',
      key: 'Mod+Alt+N',
      group: 'app',
      when: () => typeof document !== 'undefined' && document.querySelector('.marxy-pane > [role="status"] > .marxy-notice:not([data-notice-held])') !== null,
      async run() {
        focusNewestNotice();
      },
    },
  ];
}
