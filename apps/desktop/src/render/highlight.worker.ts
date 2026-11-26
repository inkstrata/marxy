// Highlighting off the main thread. Compiling a TextMate grammar in WebKit's regex engine
// takes hundreds of milliseconds the first time a language appears (TypeScript, shell); on the main
// thread that is a frozen page just after a README opens. The worker returns plain token data, and
// the page builds the spans (highlight.ts), so nothing but strings crosses the boundary.
//
// Jobs are queued here, not run on arrival, so the page can take back the ones for a document that
// has closed (`drop`) before they cost anything. A dropped job is answered with null lines.
//
// Source's colour is a session per editor: the page sends the text whenever it changes, and the worker reads it a
// piece at a time (core's RunSession), posting each piece's runs as one transferred buffer. Each piece is its own job at
// the back of the queue, so Read's fences are never held behind a long file. The page says which lines it shows (`view`),
// and the session reads those first; a file coloured anyway, past the plain-text tier, is read only there.
import { highlight } from '@marxy/core/src/highlight/grammar.ts';
import { type LineRange, RunSession } from '@marxy/core/src/highlight/session.ts';
import { JobQueue } from './highlight-queue.ts';

interface Request {
  readonly id: number;
  readonly code: string;
  readonly lang: string;
}

/** The next piece of session `step`'s text. Never dropped by id. */
interface Step {
  readonly id: -1;
  readonly step: number;
}

type Message =
  | Request
  | { readonly drop: readonly number[] }
  | {
      readonly session: number;
      readonly lang: string;
      readonly text: string;
      readonly version: number;
      readonly whole?: boolean;
      readonly cuts?: readonly number[];
    }
  | { readonly view: number; readonly ranges: readonly LineRange[] }
  | { readonly warm: string }
  | { readonly endSession: number };

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<Message>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

interface Session {
  readonly runs: RunSession;
  version: number;
  queued: boolean;
}

const sessions = new Map<number, Session>();

const queue = new JobQueue<Request | Step>(async (job) => {
  if ('step' in job) return step(job.step);
  const { id, code, lang } = job;
  try {
    scope.postMessage({ id, lines: await highlight(code, lang) });
  } catch {
    scope.postMessage({ id, lines: null });
  }
});

/** Queues the session's next piece; `first` when it is the view's, ahead of fences and every other file's reading top down. */
function schedule(id: number, session: Session, first = false): void {
  if (session.queued && !first) return;
  if (session.queued) queue.remove((job) => 'step' in job && job.step === id);
  session.queued = true;
  if (first) queue.pushFront({ id: -1, step: id });
  else queue.push({ id: -1, step: id });
}

async function step(id: number): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  session.queued = false;
  const version = session.version;
  let piece: Awaited<ReturnType<RunSession['next']>>;
  try {
    piece = await session.runs.next();
  } catch {
    piece = null;
  }
  if (sessions.get(id) !== session) return;
  if (piece === 'stale') return schedule(id, session, session.runs.viewing);
  if (piece === null) {
    scope.postMessage({ session: id, version, none: true });
    return;
  }
  if (piece.to > piece.from) scope.postMessage({ session: id, version, from: piece.from, to: piece.to, runs: piece.runs, done: piece.done }, [piece.runs.buffer]);
  if (!session.runs.done) schedule(id, session, session.runs.viewing);
}

/**
 * A few lines most grammars have rules for: read once when a file in the language begins to open, so the grammar's
 * load and its first compile are paid while the file is read and the editor mounts, not after its text is up.
 */
const WARM_TEXT = ['/* a */ // b', '# c', 'const f = function (a, b) { return "s" + \'t\' + `u${a}` + 1.5 * b; };', ''].join('\n');

scope.onmessage = (e) => {
  const m = e.data;
  if ('warm' in m) {
    void highlight(WARM_TEXT, m.warm).catch(() => null);
    return;
  }
  if ('drop' in m) {
    for (const id of queue.drop(m.drop)) scope.postMessage({ id, lines: null });
    return;
  }
  if ('endSession' in m) {
    sessions.delete(m.endSession);
    return;
  }
  if ('view' in m) {
    const session = sessions.get(m.view);
    if (!session) return;
    session.runs.setView(m.ranges);
    if (!session.runs.done) schedule(m.view, session, session.runs.viewing);
    return;
  }
  if ('session' in m) {
    let session = sessions.get(m.session);
    if (session?.runs.lang !== m.lang) {
      session = { runs: new RunSession(m.lang, '', { whole: m.whole, cuts: m.cuts }), version: m.version, queued: false };
      sessions.set(m.session, session);
    }
    session.runs.update(m.text);
    session.version = m.version;
    schedule(m.session, session, session.runs.viewing);
    return;
  }
  queue.push(m);
};
