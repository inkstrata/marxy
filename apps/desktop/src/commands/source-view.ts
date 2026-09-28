// Source gutter toggle and jump-to-source palette commands (MARXY-239).
import type { Command } from './registry.ts';
import { writeLineNumbersPreference } from '../source/line-numbers.ts';
import { getSelectionBufferContext } from '../selection/view.ts';

function selectionStartByte(): number | null {
  const ctx = getSelectionBufferContext();
  if (!ctx) return null;
  const sel = ctx.state.selection;
  if (sel.kind === 'node' && sel.el instanceof HTMLElement) {
    const s = sel.el.getAttribute('data-marxy-s');
    if (s !== null) return Number(s);
  }
  if (sel.kind === 'section') return sel.range.start;
  return null;
}

export function sourceViewCommands(): readonly Command[] {
  return [
    {
      id: 'view.toggle-line-numbers',
      title: 'Toggle line numbers in Source',
      group: 'view',
      when: () => document.body.dataset.marxyMode === 'source' || getSelectionBufferContext() !== null,
      run: async () => {
        const { activeSourceEditor, createSourceEditor } = await import('../source/editor.ts');
        let editor = activeSourceEditor();
        if (!editor) {
          const ctx = getSelectionBufferContext();
          const host = document.getElementById('marxy-source');
          if (ctx && host) editor = await createSourceEditor({ parent: host, buffer: ctx.buffer });
        }
        if (!editor) return;
        const hasNumbers = Boolean(editor.view.dom.querySelector('.cm-lineNumbers'));
        const next = !hasNumbers;
        writeLineNumbersPreference(next);
        editor.setLineNumbers(next);
      },
    },
    {
      id: 'view.jump-to-source',
      title: 'Jump to source',
      group: 'view',
      when: () => selectionStartByte() !== null,
      run: async () => {
        const byte = selectionStartByte();
        const ctx = getSelectionBufferContext();
        if (byte === null || !ctx) return;
        const { openSourceAtByte } = await import('../source/mode-open.ts');
        await openSourceAtByte(ctx.buffer, byte);
      },
    },
  ];
}
