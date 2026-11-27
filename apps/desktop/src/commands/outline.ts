// The commands that move a section, from the Outline card's focused row or the selected heading.
import { canMoveSection, focusedOutlineHeading } from '../frame/model/outline-move.ts';
import { appHandle } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';

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
      // The tab's code is read on the first move, not at first text.
      const { runOutlineAction } = await import('../frame/model/outline.ts');
      await runOutlineAction(handle, ctx.document, start, direction === 'up' ? 'move-up' : 'move-down');
    },
  };
}

export function outlineCommands(): readonly Command[] {
  return [moveCommand('up'), moveCommand('down')];
}
