// Truncation notice for never-closed HTML islands (docs/design/13-trust.md §The unclosed-element case).

import type { Buffer } from '@marxy/core';
import { lineOf } from '@marxy/core';
import type { RenderRemoval } from '@marxy/core/src/render/pipeline.ts';
import { ensureNoticesRegion, focusedPane, noticeLine, placeNotice } from './index.ts';
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
    const { showSource } = opts;
    placeNotice(
      ensureNoticesRegion(opts.pane ?? focusedPane()),
      noticeLine({
        kind: 'blocked',
        text: truncationNoticeText(line, remaining, removal.name),
        actions: showSource ? [{ label: 'Show source', onClick: () => showSource(line) }] : [],
      }),
    );
  }
}
