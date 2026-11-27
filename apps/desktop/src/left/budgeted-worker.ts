// One job in a worker, with a time budget. A regular expression the reader typed can hold one `exec` for minutes
// (`(a+)+$` over a long run of a), and nothing on the page can stop a call that is running: only a worker can be ended
// from outside. The job is sent; the worker is ended when the budget passes or the caller's `stop` is called.

/** What a job came to: its answer; 'slow' (budget passed); 'stopped' (the caller moved on); 'none' (no worker here: run it in the page). */
export type Ran<R> = { readonly done: R } | 'slow' | 'stopped' | 'none';

/** `holder.stop` is set while the job runs, so the next search can end it. `make` holds the `new Worker(new URL(...))` call. */
export function runBudgeted<J, R>(make: () => Worker, job: J, ms: number, holder: { stop?: () => void }): Promise<Ran<R>> {
  if (typeof Worker === 'undefined') return Promise.resolve('none');
  let w: Worker;
  try {
    w = make();
  } catch {
    return Promise.resolve('none');
  }
  return new Promise((resolve) => {
    const end = (v: Ran<R>): void => {
      clearTimeout(timer);
      w.terminate();
      if (holder.stop === stop) holder.stop = undefined;
      resolve(v);
    };
    const stop = (): void => end('stopped');
    const timer = setTimeout(() => end('slow'), ms);
    holder.stop = stop;
    w.onmessage = (e: MessageEvent<R>) => end({ done: e.data });
    // A worker that cannot start or load (a CSP, an engine without module workers): the caller runs the job in the page.
    w.onerror = () => end('none');
    w.postMessage(job);
  });
}
