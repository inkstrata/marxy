// The Markdown parse of a large document, made in a worker (`parse.worker.ts`) and handed to this thread as core's
// pieces, so the page's thread never runs the parse. In slices on this thread a file with a link reference or footnote
// definition could not be cut at all and was one task of about a second per megabyte; in the worker it costs this thread
// only the receiving of the pieces, each a short task of its own (core's `handoffPieces` cuts them at about 64 KB of
// source), and the putting back of the document, which is the one `parseMarkdown` gives here (handoff.test.ts).
//
// One worker per parse: it is ended as soon as its document is back, and at once when the caller stops wanting it (a
// new open, the pane closed, the bytes changed), which is the only way to stop a parse that is running. Where no worker
// can start (no Worker here, a CSP, an engine without module workers) the answer is 'none' and the caller parses on
// this thread as it did before; after the first such failure no other worker is tried.
import { Abandoned, documentFromHandoff, type Block, type Document, type DocumentHead, type HandoffPiece } from '@marxy/core';
import { pushAll } from '@marxy/core/src/util/spread.ts';

/** How often a running parse asks whether it is still wanted. */
const CHECK_MS = 50;

let unusable = false;

/** Whether a parse can be made in a worker here: false where there is no Worker, or one already failed to start. */
export function parseWorkerAvailable(): boolean {
  return !unusable && typeof Worker !== 'undefined';
}

type Reply = { readonly id: number } & ({ readonly piece: HandoffPiece } | { readonly failed: string });

let nextId = 1;

/**
 * `parseMarkdown(bytes, { file })`, made in a worker. Rejects with `Abandoned` once `aborted()` is true; resolves 'none'
 * when no worker could make it, for the caller to parse on this thread.
 */
export function parseInWorker(bytes: Uint8Array, file: string, aborted: () => boolean): Promise<Document | 'none'> {
  if (!parseWorkerAvailable()) return Promise.resolve('none');
  let worker: Worker;
  try {
    worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    gaveUp(String(error));
    return Promise.resolve('none');
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    let head: DocumentHead | undefined;
    const blocks: Block[] = [];
    let heard = false;
    const end = (): void => {
      clearInterval(watch);
      worker.terminate();
    };
    const watch = setInterval(() => {
      if (!aborted()) return;
      end();
      reject(new Abandoned());
    }, CHECK_MS);
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      if (reply.id !== id) return;
      heard = true;
      if (aborted()) {
        end();
        reject(new Abandoned());
        return;
      }
      if ('failed' in reply) {
        end();
        console.warn(`marxy: the parse worker failed (${reply.failed}); parsing on the page`);
        resolve('none');
        return;
      }
      const { piece } = reply;
      if ('head' in piece) head = piece.head;
      else if ('blocks' in piece) pushAll(blocks, piece.blocks);
      else {
        end();
        resolve(documentFromHandoff(head!, blocks, piece.notes, bytes));
      }
    };
    // A worker that cannot load is given up on for the session; one that broke after it answered is this parse's alone.
    worker.onerror = (event) => {
      event.preventDefault();
      end();
      if (!heard) gaveUp(event.message);
      resolve('none');
    };
    worker.postMessage({ id, bytes, file });
  });
}

function gaveUp(reason: string): void {
  if (unusable) return;
  unusable = true;
  console.warn(`marxy: large Markdown is parsed on the page: the parse worker could not start${reason ? ` (${reason})` : ''}`);
}
