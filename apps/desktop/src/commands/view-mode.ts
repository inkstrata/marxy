// Read, Split and Source (W-19; ADR-0058 item 7): `Mod+1`, `Mod+2`, `Mod+3`. Read and Source set the focused
// pane's mode and nothing else (a no-op when it is already there, unlike `Mod+E`, which flips). Split is one
// document twice, Read on the left and Source on the right, built on `view.split-same`. Inside Split, Read and
// Source close the second pane and keep one in that mode, and Split again goes back to Read (F-44). The commands are
// `global`, so they run from inside a Source editor; no Source editing chord takes a digit.
import { appHandle } from './app-handle.ts';
import { splitSame } from './pane-split-same.ts';
import type { Command } from './registry.ts';

export const SPLIT_TWO_DOCUMENTS = 'Split shows one document twice; this window has two. Close one pane first.';

/**
 * Leaves Split (F-44): the window shows one document twice, and Read, Source or Split again ends it in one pane
 * in `mode`. The pane that already shows `mode` survives (Source: the right one, which `PaneSet.close` moves
 * into slot 0 at its place; otherwise the left, the reader's place); `close` folds the closing pane's Source
 * text into the store and asks first over what it cannot keep, and a refused close changes nothing.
 */
async function leaveSplit(mode: 'rendered' | 'source'): Promise<void> {
  const panes = appHandle()?.panes();
  if (!panes || panes.panes.length !== 2) return;
  const [left, right] = panes.panes;
  const keepRight = mode === 'source' && right.view.mode === 'source' && left.view.mode !== 'source';
  if (!(await panes.close(keepRight ? left : right))) return;
  await panes.panes[0]?.view.setMode(mode);
}

const isSplit = (): boolean => {
  const panes = appHandle()?.panes();
  if (!panes || panes.panes.length !== 2) return false;
  const [left, right] = panes.panes;
  return left.path() !== null && left.path() === right.path();
};

function setMode(mode: 'rendered' | 'source'): Command['run'] {
  return async () => {
    if (isSplit()) return leaveSplit(mode);
    // Asked of the view, which knows the mode a press before this one is still on its way to (V-11).
    await appHandle()?.panes().focused.view.setMode(mode);
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
            ctx.showNotice(SPLIT_TWO_DOCUMENTS, { kind: 'refused' });
            return;
          }
          // Split again is the way back: one pane in Read.
          await leaveSplit('rendered');
          return;
        }
        if (panes.focused.path() === null) return;
        await panes.focused.view.setMode('rendered');
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
