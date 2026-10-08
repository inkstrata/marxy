// Structured selection moves as registry commands (MARXY-42 migrates keys from view.ts). They act on the
// app's selection controller (`AppHandle.selection`, B-12) and decide from the context they are given.
import type { AppContext, Command } from './registry.ts';
import { appHandle } from './app-handle.ts';

function structured(ctx: AppContext): boolean {
  const kind = ctx.selection.kind;
  return kind === 'node' || kind === 'section' || kind === 'document';
}

export function selectionNavigationCommands(): readonly Command[] {
  return [
    {
      id: 'selection.clear',
      title: 'Clear selection',
      key: 'Escape',
      group: 'selection',
      when: (ctx) => ctx.selection.kind !== 'none',
      run: async () => {
        appHandle()?.selection.clear();
      },
    },
    {
      id: 'selection.next-block',
      title: 'Select next block',
      key: 'Alt+ArrowDown',
      group: 'selection',
      when: structured,
      run: async () => {
        appHandle()?.selection.moveDown();
      },
    },
    {
      id: 'selection.prev-block',
      title: 'Select previous block',
      key: 'Alt+ArrowUp',
      group: 'selection',
      when: structured,
      run: async () => {
        appHandle()?.selection.moveUp();
      },
    },
    {
      id: 'selection.parent-block',
      title: 'Select parent block',
      key: 'Alt+Shift+ArrowUp',
      group: 'selection',
      when: structured,
      run: async () => {
        appHandle()?.selection.moveParent();
      },
    },
  ];
}
