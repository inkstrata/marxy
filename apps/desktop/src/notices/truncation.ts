// Truncation notice for never-closed HTML islands (docs/design/13-trust.md §The unclosed-element case).

import type { Buffer } from '@marxy/core';
import { lineOf } from '@marxy/core';
import type { RenderRemoval } from '@marxy/core/src/render/pipeline.ts';
import { ensureNoticesRegion, focusedPane } from './index.ts';
import { truncationNoticeText } from './trust-copy.ts';

export interface TruncationNoticeOpts {
  readonly buffer: Buffer;
  readonly removed: readonly RenderRemoval[];
  showSource?(line: number): void;
  /** The pane that shows the buffer (`section.marxy-pane`): the notice is said there. The focused pane when unset. */
  readonly pane?: HTMLElement;
}

function countLinesFrom(byteOffset: number, buffer: Buffer): number {
  const text = new TextDecoder().decode(buffer.bytes.subarray(byteOffset));
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  if (text.length > 0 && !text.endsWith('\n')) count++;
  return count;
}

export function truncationNotices(opts: TruncationNoticeOpts): void {
  for (const removal of opts.removed) {
    if (removal.what !== 'truncation' || removal.src === undefined) continue;
    const line = lineOf(opts.buffer, removal.src.start);
    const remaining = countLinesFrom(removal.src.start, opts.buffer);
    const region = ensureNoticesRegion(opts.pane ?? focusedPane());
    const row = document.createElement('div');
    row.className = 'marxy-notice';
    row.dataset.noticeKind = 'blocked';

    const text = document.createElement('span');
    text.className = 'marxy-notice-text';
    text.textContent = truncationNoticeText(line, remaining, removal.name);
    row.append(text);

    if (opts.showSource) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'marxy-notice-action';
      action.textContent = 'Show source';
      action.addEventListener('click', () => opts.showSource!(line));
      row.append(action);
    }

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'marxy-notice-dismiss';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => row.remove());
    row.append(dismiss);

    region.append(row);
  }
}
