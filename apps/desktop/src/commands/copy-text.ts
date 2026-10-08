// The drag selection's verbs: copy as rich text, plain text or exact markdown (ADR-0054, design 03, C-06).
// They act on the DOM range rather than on a node, so they are app commands rather than `op.*`; each
// writes the clipboard once and never changes the document.
import { textOf, type Source } from '@marxy/core';
import { htmlFromDomSelection } from '../selection/copy-html.ts';
import { textFromDomSelection } from '../selection/copy-text.ts';
import type { AppContext, Command } from './registry.ts';

/** The live DOM selection when it lies in the rendered article, else null. */
function liveSelection(ctx: AppContext): globalThis.Selection | null {
  if (typeof window === 'undefined') return null;
  const article = ctx.renderedPage?.()?.article;
  const sel = window.getSelection();
  if (!article || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  return article.contains(range.commonAncestorContainer) ? sel : null;
}

/** The outermost element carrying provenance that holds `node`, below `article`: its top-level block. */
function topLevelBlock(article: HTMLElement, node: Node): Element | null {
  let el: Element | null = node instanceof Element ? node : node.parentElement;
  let found: Element | null = null;
  while (el && el !== article) {
    if (el.hasAttribute('data-marxy-s') && el.hasAttribute('data-marxy-e')) found = el;
    el = el.parentElement;
  }
  return el === article ? found : null;
}

/** The byte range from the first to the last top-level block a DOM range touches, or null. */
export function blockRangeOf(article: HTMLElement, range: Range, file: string): Source | null {
  const first = topLevelBlock(article, range.startContainer);
  const last = topLevelBlock(article, range.endContainer);
  if (!first || !last) return null;
  const start = Number(first.getAttribute('data-marxy-s'));
  const end = Number(last.getAttribute('data-marxy-e'));
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return null;
  return { file, start, end };
}

async function write(ctx: AppContext, data: { readonly text: string; readonly html?: string }): Promise<void> {
  await ctx.shell.clipboardWrite(data);
  ctx.closePalette();
  ctx.showNotice('Copied', { transient: true });
}

const isDrag = (ctx: AppContext): boolean => ctx.selection.kind === 'text';

export function copyTextCommands(): readonly Command[] {
  return [
    {
      id: 'selection.copy-rich',
      title: 'Copy',
      group: 'selection',
      when: isDrag,
      async run(ctx) {
        if (ctx.selection.kind !== 'text') return;
        const sel = liveSelection(ctx);
        if (!sel) return write(ctx, { text: ctx.selection.text });
        const html = htmlFromDomSelection(sel);
        const text = textFromDomSelection(sel);
        return write(ctx, html === '' ? { text } : { text, html });
      },
    },
    {
      id: 'selection.copy-plain',
      title: 'Copy as plain text',
      group: 'selection',
      when: isDrag,
      async run(ctx) {
        if (ctx.selection.kind !== 'text') return;
        const sel = liveSelection(ctx);
        return write(ctx, { text: sel ? textFromDomSelection(sel) : ctx.selection.text });
      },
    },
    {
      id: 'selection.copy-markdown',
      title: 'Copy as markdown',
      group: 'selection',
      when: isDrag,
      async run(ctx) {
        const page = ctx.renderedPage?.();
        const sel = liveSelection(ctx);
        const range = page && sel ? blockRangeOf(page.article, sel.getRangeAt(0), page.buffer.path) : null;
        if (!page || !range || range.end > page.buffer.bytes.length) {
          ctx.closePalette();
          ctx.showNotice('Select the text again to copy its markdown', { transient: true });
          return;
        }
        return write(ctx, { text: textOf(page.buffer, range) });
      },
    },
  ];
}
