// The Line's `/re/` find over a page's lines, off the main thread (left/budgeted-worker.ts says why).
import { type LineHit, lineHits } from './refs.ts';

export interface FindJob {
  readonly source: string;
  readonly flags: string;
  readonly lines: readonly string[];
  readonly cap: number;
}

export type FindDone = readonly LineHit[];

const scope = self as unknown as { onmessage: ((e: MessageEvent<FindJob>) => void) | null; postMessage(m: FindDone): void };

scope.onmessage = (e) => {
  const { source, flags, lines, cap } = e.data;
  scope.postMessage(lineHits(lines, new RegExp(source, flags), cap));
};
