// Task checkbox post-pass (MARXY-43). A click is an operation: it applies through the open document's
// store, whose subscribers re-render the page (ADR-0037).
import { textOf } from '@marxy/core';
import { toggleTask } from '@marxy/core/src/operations/toggle-task.ts';
import { nodeFor, type NodeMap } from './post.ts';
import { apply } from '../selection/apply.ts';
import { buildAppContext } from '../selection/bind.ts';
import { getSelectionBufferContext } from '../selection/view.ts';

const WIRED = new WeakSet<HTMLElement>();

export function installTaskMarkers(article: HTMLElement, _nodeMap?: NodeMap): void {
  if (WIRED.has(article)) return;
  WIRED.add(article);
  if (typeof window !== 'undefined') {
    (window as Window & { __marxyTasksReady?: boolean }).__marxyTasksReady = true;
  }
  article.addEventListener(
    'click',
    (ev) => {
      const box = taskBoxFor(ev, article);
      if (!box) return;
      const carrier = box.closest('[data-marxy-s]');
      if (!carrier) return;
      const ctx = getSelectionBufferContext();
      if (!ctx) return;
      const resolved = nodeFor(ctx.nodeMap, carrier);
      if (!resolved || resolved.type !== 'taskMarker') return;
      ev.preventDefault();
      ev.stopPropagation();
      const marker = resolved;
      const range = marker.src;
      const input = {
        document: ctx.document,
        node: marker,
        range,
        text: textOf(ctx.buffer, range),
      };
      if (!toggleTask.canApply(input)) return;
      const base = buildAppContext();
      if (!base) return;
      void import('../commands/edits.ts').then(({ attachDocumentEdits }) => {
        void apply(toggleTask, attachDocumentEdits(base), input);
      });
    },
    true,
  );
}

/**
 * The checkbox a click means. The sanitiser forces `disabled` on task checkboxes and browsers
 * (WebKit) send no click to a disabled control, so the box has `pointer-events: none` and the click
 * lands on whatever is behind it: the list item, or, as the theme hangs the box in the margin, the
 * list or the article. The box is found by where the click fell, inside the box's own rectangle, so
 * a link or text elsewhere in the item never toggles it.
 */
function taskBoxFor(ev: MouseEvent, article: HTMLElement): HTMLInputElement | null {
  const raw = ev.target;
  if (raw instanceof HTMLInputElement) return raw.type === 'checkbox' ? raw : null;
  if (!(raw instanceof Element) || raw.closest('a, button, input, textarea, select, summary')) return null;
  for (const box of article.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-marxy-s]')) {
    const r = box.getBoundingClientRect();
    if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return box;
  }
  return null;
}
