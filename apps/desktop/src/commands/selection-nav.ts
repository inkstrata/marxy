// Structured selection moves as registry commands (the keys migrate from view.ts). They act on the
// app's selection controller (`AppHandle.selection`) and decide from the context they are given.
import type { AppContext, Command } from './registry.ts';
import { appHandle } from './app-handle.ts';
import { focusShown, leaveFocus } from './depths.ts';
import { verbsOn } from '../selection/verbs-on.ts';

function structured(ctx: AppContext): boolean {
  const kind = ctx.selection.kind;
  return kind === 'node' || kind === 'section' || kind === 'document' || kind === 'blocks';
}

export function selectionNavigationCommands(): readonly Command[] {
  return [
    {
      id: 'selection.clear',
      title: 'Clear selection',
      key: 'Escape',
      group: 'selection',
      when: (ctx) => ctx.selection.kind !== 'none' || focusShown(),
      run: async () => {
        // With one part shown alone, Escape first shows everything again (`v`).
        if (leaveFocus()) return;
        appHandle()?.selection.clear();
      },
    },
    {
      id: 'selection.next-block',
      title: 'Select next block',
      // With the verbs on, Alt+↓ moves the part (commands/changes.ts); with them off it still selects.
      key: 'Alt+ArrowDown',
      group: 'selection',
      when: (ctx) => structured(ctx) && !verbsOn(),
      run: async () => {
        appHandle()?.selection.moveDown();
      },
    },
    {
      id: 'selection.prev-block',
      title: 'Select previous block',
      key: 'Alt+ArrowUp',
      group: 'selection',
      when: (ctx) => structured(ctx) && !verbsOn(),
      run: async () => {
        appHandle()?.selection.moveUp();
      },
    },
    {
      id: 'selection.extend-block',
      title: 'Extend selection to next block',
      key: 'Alt+Shift+ArrowDown',
      group: 'selection',
      when: (ctx) => ctx.selection.kind === 'node' || ctx.selection.kind === 'blocks',
      run: async () => {
        appHandle()?.selection.extendDown();
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
