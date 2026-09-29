// Source gutter toggle and jump-to-source palette commands (MARXY-239).
import type { Command } from './registry.ts';
import { writeLineNumbersPreference } from '../source/line-numbers.ts';
import { getSelectionBufferContext } from '../selection/view.ts';

function byteAttr(el: Element | null | undefined): number | null {
  const s = el?.getAttribute('data-marxy-s');
  return s === null || s === undefined ? null : Number(s);
}

function clickedBlockByte(): number | null {
  const carrier = (window as Window & { __marxyJumpCarrier?: Element | null }).__marxyJumpCarrier;
  return byteAttr(carrier);
}

function selectionStartByte(): number | null {
  const ctx = getSelectionBufferContext();
  if (ctx) {
    const sel = ctx.state.selection;
    if (sel.kind === 'node' && sel.el instanceof Element) {
      const s = byteAttr(sel.el.closest('[data-marxy-s]'));
      if (s !== null) return s;
    }
    if (sel.kind === 'section') return sel.range.start;
    if (sel.kind === 'text') {
      const anchor = window.getSelection()?.anchorNode ?? null;
      const el = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
      const s = byteAttr(el?.closest('[data-marxy-s]') ?? null);
      if (s !== null) return s;
    }
  }
  // A click still names a block when the selection model does not (MARXY-239).
  return clickedBlockByte();
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
        const open = (window as Window & {
          __marxyHandle?: { openDocument?: () => { buffer: import('@marxy/core').Buffer } | null };
        }).__marxyHandle?.openDocument?.();
        const buffer = ctx?.buffer ?? open?.buffer;
        if (byte === null || !buffer) return;
        const { openSourceAtByte } = await import('../source/mode-open.ts');
        await openSourceAtByte(buffer, byte);
      },
    },
  ];
}
