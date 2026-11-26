// A large open says what it is doing while it works: "Reading 2.0 MB…" in the pane's head, in the grey of a tier,
// from the moment its bytes are in until its page is. The open path writes it on the pane;
// the head shows it in place of what it says of how the file is shown.
import { sizeWords } from '@marxy/core/src/viewer/bytes.ts';
import type { HeadSay } from '../viewers/types.ts';

export const WORKING = 'data-marxy-working';

/** From this size an open is long enough to say so, and gives the frame back between its slices. */
export const LARGE_OPEN_BYTES = 1024 * 1024;

export const readingWords = (bytes: number): string => `Reading ${sizeWords(bytes).split(' · ')[0]}…`;

/**
 * Resolves once a frame has painted, so words just written are seen before a long stretch of work. A hidden page paints
 * no frames: a timer stands in.
 */
export function paintThenGo(): Promise<void> {
  return new Promise((resolve) => {
    const done = setTimeout(resolve, 100);
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(done);
        resolve();
      }, 0),
    );
  });
}

/** What the head says while `pane` reads a large file, or null. */
export function workingSay(pane: Element): HeadSay | null {
  const text = pane.getAttribute(WORKING);
  return text ? { text, tone: 'tier', title: 'A large file: its page is being made' } : null;
}
