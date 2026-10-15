// "Outline": summon the heading list at the right edge (A-15); and the commands that move a section (W-10).
import { closeOutline, openOutline, outlineIsOpen, type OutlineSource } from '../outline/view.ts';
import { canMoveSection, focusedOutlineHeading } from '../workspace/outline-move.ts';
import { appHandle, palette } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';

function sourceFromApp(): OutlineSource | null {
  const handle = appHandle();
  if (!handle) return null;
  return {
    document() {
      const open = handle.openDocument();
      return open ? { path: open.path, ast: open.ast } : null;
    },
    position: () => handle.sourceHarness()?.byteOffset ?? 0,
    land: (path, byte) => handle.open(path, { at: byte }),
  };
}

/**
 * The heading a move command is for: the row that has focus in the Outline tab, else the heading of the section the reader
 * has selected on the page (a section, or a heading block). Null when neither.
 */
function targetOf(ctx: AppContext): number | null {
  const row = focusedOutlineHeading();
  if (row !== null) return row;
  const node = ctx.operationInput()?.node;
  return node?.type === 'heading' ? node.src.start : null;
}

function moveCommand(direction: 'up' | 'down'): Command {
  return {
    id: `outline.move-section-${direction}`,
    title: direction === 'up' ? 'Move section up' : 'Move section down',
    group: 'selection',
    when(ctx) {
      const start = targetOf(ctx);
      return start !== null && ctx.document !== null && canMoveSection(ctx.document, start, direction);
    },
    async run(ctx) {
      const handle = appHandle();
      const start = targetOf(ctx);
      if (!handle || start === null || !ctx.document) return;
      ctx.closePalette();
      // The tab's code is read on the first move, not at first text (F-111).
      const { runOutlineAction } = await import('../workspace/outline-tab.ts');
      await runOutlineAction(handle, ctx.document, start, direction === 'up' ? 'move-up' : 'move-down');
    },
  };
}

export function outlineCommands(): readonly Command[] {
  return [
    {
      id: 'view.outline',
      title: 'Outline',
      key: 'Mod+Shift+O',
      global: true,
      group: 'view',
      when: () => appHandle()?.openDocument() != null,
      run: async () => {
        if (outlineIsOpen()) {
          closeOutline();
          return;
        }
        const source = sourceFromApp();
        if (!source) return;
        palette()?.close();
        openOutline(source);
      },
    },
    moveCommand('up'),
    moveCommand('down'),
  ];
}
