// The library checks' text work off the main thread (Q-06): a file's bytes in, its shingles and the paths it names out.
// Cutting shingles and parsing for path mentions are the costly part of a check: one 80 KB Markdown file is a parse of tens
// of milliseconds on a loaded machine, which on the page is a frozen frame. Here it cannot be. Nothing is read or written:
// the page reads with `readHead` and sends the bytes; the worker answers with plain data.
//
// A worker has no `document`, and micromark's browser build decodes a named character reference (`&amp;`) by setting an
// element's innerHTML (decode-named-character-reference's `index.dom.js`). The stand-in below answers every reference as
// unknown, so the parse here keeps `&amp;` as literal text. That changes no block and no span: references are inline, and the
// paths are taken from the bytes of the prose between the blocks (`pathMentions`), not from decoded text. A WebKit test in
// library.test.mjs holds the worker's answers to the page's.
import type { DigestWant, Digested } from './checks-digest.ts';

interface Request {
  readonly id: number;
  readonly data: Uint8Array;
  readonly want: DigestWant;
}

const scope = globalThis as unknown as {
  document?: unknown;
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

if (scope.document === undefined) {
  scope.document = {
    createElement: () => ({
      innerHTML: '',
      // The reference comes back as written: "not a reference".
      get textContent(): string {
        return (this as { innerHTML: string }).innerHTML;
      },
    }),
  };
}

// Imported after the stand-in exists; a message that arrives first waits for it.
const ready = import('./checks-digest.ts');

scope.onmessage = (e) => {
  const { id, data, want } = e.data;
  void ready.then(({ digestHere }) => {
    const out: Digested = digestHere(data, want);
    scope.postMessage({ id, ...out }, out.shingles ? [out.shingles.buffer] : []);
  });
};
