// Task checkbox post-pass and article re-render after edits (MARXY-43).
import { parseMarkdown, textOf, type Buffer } from '@marxy/core';
import { renderDocumentSafeHtml } from '@marxy/core/src/render/index.ts';
import { toggleTask } from '@marxy/core/src/operations/toggle-task.ts';
import { buildBlocks, buildNodeMap, type NodeMap } from './post.ts';
import { nodeFor } from './post.ts';
import { apply } from '../selection/apply.ts';
import { buildAppContext } from '../selection/bind.ts';
import { currentPosition, restoreScrollToPosition } from '../position/index.ts';
import { afterDocumentRendered, getSelectionBufferContext } from '../selection/view.ts';

const WIRED = new WeakSet<HTMLElement>();

export async function rerenderOpenDocument(buffer: Buffer): Promise<void> {
  const ctx = getSelectionBufferContext();
  if (!ctx) throw new Error('no open document');
  const path = buffer.path;
  const scroller = document.documentElement;
  const blocksBefore = buildBlocks(ctx.article, ctx.nodeMap);
  const before = currentPosition(scroller, blocksBefore, path, 'rendered');
  await (ctx.shell as { writeFileAtomic(p: string, b: Uint8Array): Promise<void> }).writeFileAtomic(
    path,
    buffer.bytes,
  );
  const ast = parseMarkdown(buffer.bytes, { file: path });
  const { html } = renderDocumentSafeHtml(ast);
  const nodeMap = buildNodeMap(ast);
  ctx.article.innerHTML = html;
  afterDocumentRendered({ buffer, document: ast, nodeMap });
  installTaskMarkers(ctx.article, nodeMap);
  const blocksAfter = buildBlocks(ctx.article, nodeMap);
  restoreScrollToPosition(scroller, blocksAfter, before);
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
