// The drag selection's verbs: copy as rich text, plain text or exact markdown (ADR-0054, design 03, C-06).
// They act on the drag recorded when it was made (its range and its blocks' bytes), never on the live DOM
// selection, which the palette takes away; so they are app commands rather than `op.*`. Each writes the
// clipboard once and never changes the document.
import { textOf } from '@marxy/core';
import { htmlFromRange } from '../selection/copy-html.ts';
import { codeRunSourceText, textFromRange } from '../selection/copy-text.ts';
import { writeCopy } from './copy-write.ts';
import type { AppContext, Command } from './registry.ts';

async function write(ctx: AppContext, data: { readonly text: string; readonly html?: string }, notice: string): Promise<void> {
  await writeCopy(ctx, data, notice);
}

const isDrag = (ctx: AppContext): boolean => ctx.selection.kind === 'text';

type Drag = Extract<AppContext['selection'], { kind: 'text' }>;

/** The text a drag copies: a code file's own bytes between its ends (V-10), else the page's text. */
function codeText(ctx: AppContext, drag: Drag, range: Range): string | null {
  const page = ctx.renderedPage?.();
  return page && drag.version === page.version ? codeRunSourceText(range, page.article, page.buffer.bytes) : null;
}
const dragText = (ctx: AppContext, drag: Drag, range: Range): string => codeText(ctx, drag, range) ?? textFromRange(range);

/** The recorded drag's range while it still holds part of the rendered page, else null. */
function liveRange(ctx: AppContext, drag: Drag): Range | null {
  const page = ctx.renderedPage?.();
  const range = drag.range;
  if (!page || !range || range.collapsed || !page.article.contains(range.commonAncestorContainer)) return null;
  return range;
}

export function copyTextCommands(): readonly Command[] {
  return [
    {
      id: 'selection.copy-rich',
      title: 'Copy',
      group: 'selection',
      when: isDrag,
      async run(ctx) {
        if (ctx.selection.kind !== 'text') return;
        const range = liveRange(ctx, ctx.selection);
        if (!range) return write(ctx, { text: ctx.selection.text }, 'Copied as plain text');
        // A code file's selection is its bytes and nothing else on the clipboard (V-10).
        const code = codeText(ctx, ctx.selection, range);
        if (code !== null) return write(ctx, { text: code }, 'Copied');
        const html = htmlFromRange(range);
        const text = textFromRange(range);
        return html === '' ? write(ctx, { text }, 'Copied as plain text') : write(ctx, { text, html }, 'Copied');
      },
    },
    {
      id: 'selection.copy-plain',
      title: 'Copy as plain text (strip markdown)',
      group: 'selection',
      when: isDrag,
      async run(ctx) {
        if (ctx.selection.kind !== 'text') return;
        const range = liveRange(ctx, ctx.selection);
        return write(ctx, { text: range ? dragText(ctx, ctx.selection, range) : ctx.selection.text }, 'Copied as plain text');
      },
    },
    {
      id: 'selection.copy-markdown',
      title: 'Copy as markdown',
      group: 'selection',
      when: isDrag,
      async run(ctx) {
        if (ctx.selection.kind !== 'text') return;
        const page = ctx.renderedPage?.();
        const src = ctx.selection.src;
        // The bytes are those of the page the drag was made on: a page set since has dropped the drag.
        if (!page || !src || ctx.selection.version !== page.version || src.end > page.buffer.bytes.length) {
          ctx.closePalette();
          ctx.showNotice('Nothing to copy as markdown: the selection holds no block', { kind: 'refused' });
          return;
        }
        return write(ctx, { text: textOf(page.buffer, src) }, 'Copied as markdown');
      },
    },
  ];
}
