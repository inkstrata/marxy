// A regular expression's search over the files' texts, off the main thread. A pattern that backtracks without end
// (`(a+)+$` over a long run of a) can hold one `exec` for minutes, and nothing on the page can stop a call that is running:
// only a worker can be ended from outside. The page sends the pattern and the texts, and ends this worker if the answer
// is not back in time.
import { type LineHit, matchLines } from './search-model.ts';

export interface SearchJob {
  readonly source: string;
  readonly flags: string;
  readonly texts: readonly (readonly [string, string])[];
}

export interface SearchDone {
  readonly hits: readonly (readonly [string, readonly LineHit[]])[];
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<SearchJob>) => void) | null; postMessage(m: SearchDone): void };

scope.onmessage = (e) => {
  const { source, flags, texts } = e.data;
  const re = new RegExp(source, flags);
  const hits: [string, readonly LineHit[]][] = [];
  for (const [path, text] of texts) {
    const h = matchLines(text, re);
    if (h.length > 0) hits.push([path, h]);
  }
  scope.postMessage({ hits });
};
