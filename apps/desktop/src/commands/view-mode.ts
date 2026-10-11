// Read, Split and Source (W-19; ADR-0058 item 7): `Mod+1`, `Mod+2`, `Mod+3`. Read and Source set the focused
// pane's mode and nothing else (a no-op when it is already there, unlike `Mod+E`, which flips). Split is one
// document twice, Read on the left and Source on the right, built on `view.split-same`. The commands are
// `global`, so they run from inside a Source editor; no Source editing chord takes a digit.
import { appHandle } from './app-handle.ts';
import { splitSame } from './pane-split-same.ts';
import type { Command } from './registry.ts';

export const SPLIT_TWO_DOCUMENTS = 'Split shows one document twice; this window has two. Close one pane first.';

function setMode(mode: 'rendered' | 'source'): Command['run'] {
  return async () => {
    const view = appHandle()?.panes().focused.view;
    if (view && view.mode !== mode) await view.toggleMode();
  };
}

const hasDocument = (): boolean => appHandle()?.openDocument() != null;

export function viewModeCommands(): readonly Command[] {
  return [
    {
      id: 'view.mode-read',
      title: 'Read',
      key: 'Mod+1',
      global: true,
      group: 'view',
      when: hasDocument,
      run: setMode('rendered'),
    },
    {
      id: 'view.mode-split',
      title: 'Split: Read and Source side by side',
      key: 'Mod+2',
      global: true,
      group: 'view',
      when: hasDocument,
      async run(ctx) {
        const panes = appHandle()?.panes();
        if (!panes) return;
        if (panes.panes.length === 2) {
          const [left, right] = panes.panes;
          if (left.path() === null || left.path() !== right.path()) {
            ctx.showNotice(SPLIT_TWO_DOCUMENTS);
            return;
          }
          if (left.view.mode !== 'rendered') await left.view.toggleMode();
          if (right.view.mode !== 'source') await right.view.toggleMode();
          return;
        }
        if (panes.focused.path() === null) return;
        if (panes.focused.view.mode !== 'rendered') await panes.focused.view.toggleMode();
        const at = panes.focused.view.position().byteOffset;
        await splitSame(ctx);
        const right = panes.panes[1];
        if (right && right.view.mode !== 'source') await right.view.jumpToSource(at);
      },
    },
    {
      id: 'view.mode-source',
      title: 'Source',
      key: 'Mod+3',
      global: true,
      group: 'view',
      when: hasDocument,
      run: setMode('source'),
    },
  ];
}
