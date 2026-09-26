// Task checkbox post-pass and article re-render after edits (MARXY-43).
import { textOf, type Buffer } from '@marxy/core';
import { toggleTask } from '@marxy/core/src/operations/toggle-task.ts';
import { nodeFor, type NodeMap } from './post.ts';
import { apply } from '../selection/apply.ts';
import { buildAppContext } from '../selection/bind.ts';
import { getSelectionBufferContext, selectionApp } from '../selection/view.ts';

const WIRED = new WeakSet<HTMLElement>();

/**
 * Saves an operation's result and shows it. The app writes it and renders it through its one render
 * path (images, highlight, maths, typesetter, the buffer Source mode and live reload compare against);
 * a render of its own here left all of that behind and the page unstyled until the next reload.
 */
export async function rerenderOpenDocument(buffer: Buffer): Promise<void> {
  const app = selectionApp();
  if (!app) throw new Error('no open document');
  await app.commitEdit(buffer);
}

export function installTaskMarkers(article: HTMLElement, _nodeMap?: NodeMap): void {
  if (WIRED.has(article)) return;
  WIRED.add(article);
  if (typeof window !== 'undefined') {
    (window as Window & { __marxyTasksReady?: boolean }).__marxyTasksReady = true;
  }
  article.addEventListener(
    'click',
    (ev) => {
      const raw = ev.target;
      if (!(raw instanceof HTMLInputElement) || raw.type !== 'checkbox') return;
      const carrier = raw.closest('[data-marxy-s]');
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
