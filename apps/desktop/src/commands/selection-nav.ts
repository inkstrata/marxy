// Structured selection moves as registry commands (MARXY-42 migrates keys from view.ts).
import type { Command } from './registry.ts';
import {
  clearStructuredSelection,
  moveSelectionDown,
  moveSelectionParent,
  moveSelectionUp,
  structuredSelectionActive,
} from '../selection/view.ts';

export function selectionNavigationCommands(): readonly Command[] {
  const whenStructured = () => structuredSelectionActive();
  return [
    {
      id: 'selection.clear',
      title: 'Clear selection',
      key: 'Escape',
      group: 'selection',
      when: (ctx) => ctx.selection.kind !== 'none',
      run: async () => {
        clearStructuredSelection();
      },
    },
    {
      id: 'selection.next-block',
      title: 'Select next block',
      key: 'Alt+ArrowDown',
      group: 'selection',
      when: whenStructured,
      run: async () => {
        moveSelectionDown();
      },
    },
    {
      id: 'selection.prev-block',
      title: 'Select previous block',
      key: 'Alt+ArrowUp',
      group: 'selection',
      when: whenStructured,
      run: async () => {
        moveSelectionUp();
      },
    },
    {
      id: 'selection.parent-block',
      title: 'Select parent block',
      key: 'Alt+Shift+ArrowUp',
      group: 'selection',
      when: whenStructured,
      run: async () => {
        moveSelectionParent();
      },
    },
  ];
}
