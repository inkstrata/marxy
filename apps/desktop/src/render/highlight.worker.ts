// Highlighting off the main thread (ADR-0033). Compiling a TextMate grammar in WebKit's regex engine
// takes hundreds of milliseconds the first time a language appears (TypeScript, shell); on the main
// thread that is a frozen page just after a README opens. The worker returns plain token data, and
// the page builds the spans (highlight.ts), so nothing but strings crosses the boundary.
import { highlight } from '@marxy/core/src/highlight/index.ts';

interface Request {
  readonly id: number;
  readonly code: string;
  readonly lang: string;
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (e) => {
  const { id, code, lang } = e.data;
  highlight(code, lang).then(
    (lines) => scope.postMessage({ id, lines }),
    () => scope.postMessage({ id, lines: null }),
  );
};
