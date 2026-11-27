// The cursor's keys and its first verbs as registry commands. Their single keys act only when
// focus is on the page and the `verbs` setting is on (the dispatcher's rule, selection/bind.ts); the palette lists them
// whenever their `when` holds.
import { OPERATIONS } from '@marxy/core/src/operations/index.ts';
import type { Source } from '@marxy/core';
import { appHandle } from './app-handle.ts';
import { blockEditCommands } from './block-edit.ts';
import { writeCopy } from './copy-write.ts';
import { fromOperation, type AppContext, type Command } from './registry.ts';
import { citeText, lineSpan } from '../selection/cursor.ts';
import type { Selection } from '../selection/selection.ts';
import type { CursorMove } from '../selection/view.ts';

/** The bytes the part under the cursor stands for: a block's, a section's, a run's. Null with no cursor. */
export function partRange(sel: Selection): Source | null {
  if (sel.kind === 'node') return sel.node.src;
  if (sel.kind === 'section' || sel.kind === 'blocks') return sel.range;
  return null;
}

const ready = (): boolean => appHandle()?.selection.cursorReady() === true;
const hasPart = (ctx: AppContext): boolean => ready() && partRange(ctx.selection) !== null;

/** Opens the verb menu at the part: bind.ts sets it, since the menu's options come from the whole registry. */
let openMenuAtPart: (ctx: AppContext) => void = () => {};
export function setCursorMenuOpener(open: (ctx: AppContext) => void): void {
  openMenuAtPart = open;
}

function move(id: string, title: string, key: string, to: CursorMove): Command {
  return {
    id,
    title,
    key,
    group: 'selection',
    when: ready,
    run: async () => {
      appHandle()?.selection.cursorMove(to);
    },
  };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The part's text exactly as the file holds it, its lines, and the file's path: what `c` and `C` copy. */
function partText(ctx: AppContext): { text: string; path: string; span: { first: number; last: number } } | null {
  const range = partRange(ctx.selection);
  const page = ctx.renderedPage?.();
  if (!range || !page) return null;
  const { bytes, path } = page.buffer;
  return { text: new TextDecoder().decode(bytes.subarray(range.start, range.end)), path, span: lineSpan(bytes, range.start, range.end) };
}

const toggleTask = (): Command | null => {
  const op = OPERATIONS.find((o) => o.id === 'toggle-task');
  return op ? fromOperation(op) : null;
};

const editBlock = (): Command | undefined => blockEditCommands().find((c) => c.id === 'edit.block');

export function cursorCommands(): readonly Command[] {
  return [
    move('cursor.next', 'Next part', 'j', 'next'),
    move('cursor.prev', 'Previous part', 'k', 'prev'),
    move('cursor.in', 'Into the part: the items of a list, the blocks of a quote, the parts of a section', 'l', 'in'),
    move('cursor.out', 'Out of the part: to what holds it, then to its heading', 'h', 'out'),
    move('cursor.extend-down', 'Take the next part too', 'Shift+J', 'extend-down'),
    move('cursor.extend-up', 'Take the previous part too', 'Shift+K', 'extend-up'),
    move('cursor.next-heading', 'Next heading', ']', 'next-heading'),
    move('cursor.prev-heading', 'Previous heading', '[', 'prev-heading'),
    move('cursor.first', 'The first part', 'g g', 'first'),
    move('cursor.last', 'The last part', 'Shift+G', 'last'),
    {
      id: 'cursor.copy',
      title: 'Copy the part, exactly as written',
      key: 'c',
      group: 'selection',
      when: hasPart,
      async run(ctx) {
        const part = partText(ctx);
        if (part) await writeCopy(ctx, { text: part.text }, `Copied ${plural(part.span.last - part.span.first + 1, 'line')} as written`);
      },
    },
    {
      id: 'cursor.copy-cite',
      title: 'Copy the part with its source: a quote and path:lines',
      key: 'Shift+C',
      group: 'selection',
      when: hasPart,
      async run(ctx) {
        const part = partText(ctx);
        if (part) await writeCopy(ctx, { text: citeText(part.text, part.path, part.span) }, `Copied ${plural(part.span.last - part.span.first + 1, 'line')} with its source`);
      },
    },
    {
      id: 'cursor.edit',
      title: 'Edit the part in place',
      key: 'e',
      group: 'selection',
      when: (ctx) => ready() && (ctx.selection.kind === 'node' || ctx.selection.kind === 'section') && (editBlock()?.when(ctx) ?? false),
      run: async (ctx) => editBlock()?.run(ctx),
    },
    {
      id: 'cursor.tick',
      title: 'Tick or untick the task',
      key: 't',
      group: 'selection',
      when: (ctx) => ready() && (toggleTask()?.when(ctx) ?? false),
      run: async (ctx) => toggleTask()?.run(ctx),
    },
    {
      id: 'cursor.menu',
      title: 'Everything you can do with the part',
      key: 'Enter',
      group: 'selection',
      when: hasPart,
      run: async (ctx) => openMenuAtPart(ctx),
    },
    {
      id: 'cursor.source',
      title: 'Source, at the part',
      key: '\\',
      group: 'selection',
      when: hasPart,
      async run(ctx) {
        const range = partRange(ctx.selection);
        if (!range) return;
        await appHandle()?.jumpToSource(range.start);
        appHandle()?.focusSource();
      },
    },
  ];
}
