// Highlighting off the main thread (ADR-0033). Compiling a TextMate grammar in WebKit's regex engine
// takes hundreds of milliseconds the first time a language appears (TypeScript, shell); on the main
// thread that is a frozen page just after a README opens. The worker returns plain token data, and
// the page builds the spans (highlight.ts), so nothing but strings crosses the boundary.
//
// Jobs are queued here, not run on arrival, so the page can take back the ones for a document that
// has closed (`drop`, B-21) before they cost anything. A dropped job is answered with null lines.
import { highlight } from '@marxy/core/src/highlight/index.ts';
import { JobQueue } from './highlight-queue.ts';

interface Request {
  readonly id: number;
  readonly code: string;
  readonly lang: string;
}

type Message = Request | { readonly drop: readonly number[] };

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<Message>) => void) | null;
  postMessage(message: unknown): void;
};

const queue = new JobQueue<Request>(async ({ id, code, lang }) => {
  try {
    scope.postMessage({ id, lines: await highlight(code, lang) });
  } catch {
    scope.postMessage({ id, lines: null });
  }
});

scope.onmessage = (e) => {
  if ('drop' in e.data) {
    for (const id of queue.drop(e.data.drop)) scope.postMessage({ id, lines: null });
    return;
  }
  queue.push(e.data);
};
