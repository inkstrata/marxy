// Source gutter toggle and jump-to-source palette commands (MARXY-239).
import type { AppContext, Command } from './registry.ts';
import type { AppShell } from '../app.ts';
import { writeReaderKey } from '../theme/reader-config.ts';
import { resolveLineNumbers, setLineNumbersChoice } from '../source/line-numbers.ts';
import { appHandle } from './app-handle.ts';

function byteAttr(el: Element | null | undefined): number | null {
  const s = el?.getAttribute('data-marxy-s');
  return s === null || s === undefined ? null : Number(s);
}

function clickedBlockByte(): number | null {
  return byteAttr(appHandle()?.selection.lastPointerCarrier());
}

function selectionStartByte(ctx: AppContext): number | null {
  if (ctx.document) {
    const sel = ctx.selection;
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
      when: (ctx) => document.body.dataset.marxyMode === 'source' || ctx.document !== null,
      run: async (ctx) => {
        // The preference only; the app owns the Source editor and makes it (F-03, F-12). One that is
        // mounted is reconfigured now; with none, the next Source entry reads the recorded choice.
        const { activeSourceEditor } = await import('../source/editor.ts');
        const editor = activeSourceEditor();
        const current = editor
          ? Boolean(editor.view.dom.querySelector('.cm-lineNumbers'))
          : resolveLineNumbers(appHandle()?.currentPath() ?? '');
        const next = !current;
        if (editor) editor.setLineNumbers(next);
        else setLineNumbersChoice(next);
        const shell = appHandle()?.shell as AppShell | undefined;
        if (!shell) return;
        try {
          await writeReaderKey(shell, 'line_numbers', String(next));
        } catch (e) {
          ctx.showNotice(`config.toml could not be updated: ${e instanceof Error ? e.message : String(e)}; this choice lasts until you quit`);
        }
      },
    },
    {
      id: 'view.jump-to-source',
      title: 'Jump to source',
      group: 'view',
      when: (ctx) => selectionStartByte(ctx) !== null,
      run: async (ctx) => {
        const byte = selectionStartByte(ctx);
        // Source opens only through the running app, so what is typed there is the document's (F-03).
        const app = appHandle();
        if (byte === null || !app) return;
        await app.jumpToSource(byte);
      },
    },
  ];
}
