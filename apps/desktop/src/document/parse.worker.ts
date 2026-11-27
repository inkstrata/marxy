// The Markdown parse of a large document, off the main thread. It is core's own `parseMarkdown`, the one parser, run on
// the bytes the page sent; the result goes back as core's handoff pieces (the head, the top-level blocks a batch at a
// time, the notes), so the page receives it in short tasks and puts back the same document (`parse-worker.ts`). Nothing
// is rendered or sanitised here. A file with a definition parses whole, as it must, but the whole is this thread's.
// The parse's own modules, not core's index: the worker loads only what the parse needs (as the highlight worker does).
import { parseMarkdown } from '@marxy/core/src/parse/parse.ts';
import { handoffPieces } from '@marxy/core/src/parse/handoff.ts';

interface Job {
  readonly id: number;
  readonly bytes: Uint8Array;
  readonly file: string;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<Job>) => void) | null; postMessage(m: unknown): void };

scope.onmessage = (event) => {
  const { id, bytes, file } = event.data;
  try {
    for (const piece of handoffPieces(parseMarkdown(bytes, { file }))) scope.postMessage({ id, piece });
  } catch (error) {
    scope.postMessage({ id, failed: String(error) });
  }
};
