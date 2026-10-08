// Start-up measurement: the code that makes `first_text` an honest number (ADR-0013), lifted out of
// app.ts (B-08). Every mark keeps its name, order and detail format; scripts/perf-harness.mjs,
// scripts/measure-startup.mjs and the nightly read them by name.
import type { Shell } from '@marxy/shell-api';
import { isDocVisible, waitForEnginePaint } from '../paint-signal.mjs';

/** Module evaluation time: the `script_start` mark reports it. */
export const t0 = Date.now();

// The counter starts when this module is evaluated, not when startApp runs: starting it later made
// render to painted about 15 ms slower on a 1 MB document (B-08 measurement), so the loop has to be
// running before the first render. `createLaunchMeasure` restarts it for a later launch in one page.
let observed = 0;
let observing = false;
const observeFrame = () => { observed += 1; if (observing) requestAnimationFrame(observeFrame); };
function startObserving(): void {
  if (observing) return;
  observing = true;
  requestAnimationFrame(observeFrame);
}
startObserving();

export interface RenderEvidence {
  readonly blocks: number;
  readonly chars: number;
  /** Any character that is not white space: the newline between two image blocks is not text (F-17). */
  readonly hasText: boolean;
  readonly heading: string;
}

export type FirstTextOutcome = 'painted' | 'no_text' | 'no_paint';

export interface LaunchMeasure {
  /** Animation frames counted since `createLaunchMeasure`. */
  framesObserved(): number;
  /** Stops the frame counter so an idle window is not woken once a frame. */
  stopObserving(): void;
  /** Evidence that the document actually reached the DOM, for the CLI smoke check. */
  renderEvidence(doc: HTMLElement): RenderEvidence;
  /** The arguments once the shell has reported them, when the launch was not given any. */
  adoptArgs(args: readonly string[]): void;
  /** True when a harness launched us: the startup harness sets the env var, the flag is for a person. */
  inHarness(): Promise<boolean>;
  /**
   * Marks `no_text` / `no_paint` / `painted` + `first_text` as the document warrants. `evidence` is what the render
   * mark reported (not recomputed: that would delay first text), `after` the `performance.now()`
   * taken before the render, `renderedAt` the `Date.now()` after its render mark.
   */
  waitForFirstText(doc: HTMLElement, evidence: RenderEvidence, after: number, renderedAt: number): Promise<FirstTextOutcome>;
  /** Every path ends here: settles `ready`, and a harness launch exits with a code that says if it painted. */
  finish(code: number): Promise<void>;
  /** Resolves with the exit code the first time `finish` runs. */
  readonly ready: Promise<number>;
}

/**
 * Counts animation frames since the module loaded (restarted per launch), independently of anything else. The paint
 * mark reports how many frames passed between the DOM mutation and `first_text`, and the CLI smoke
 * check asserts that count is at least two — because a mark that only *claims* to be after the paint
 * would silently make every cold-start number optimistic. The counter lives here, not inside
 * waitForEnginePaint(), so that a wait which never actually waited still reports frames=0 and fails
 * the check instead of passing quietly. `startApp` calls this first, so the count covers the launch.
 */
export function createLaunchMeasure(
  shell: Pick<Shell, 'mark' | 'quit' | 'startupMarks'>,
  args: readonly string[],
): LaunchMeasure {
  startObserving();
  let launchArgs = args;

  let settleReady: (code: number) => void = () => {};
  const ready = new Promise<number>((resolve) => { settleReady = resolve; });

  function renderEvidence(doc: HTMLElement): RenderEvidence {
    return {
      blocks: doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,ul,ol,table,blockquote').length,
      chars: doc.textContent?.length ?? 0,
      hasText: /\S/.test(doc.textContent ?? ''),
      heading: doc.querySelector('h1,h2,h3')?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
    };
  }

  async function inHarness(): Promise<boolean> {
    if (launchArgs.includes('--quit-after-paint')) return true;
    try {
      return Boolean((await shell.startupMarks()).quit_after_paint);
    } catch {
      return false;
    }
  }

  return {
    framesObserved: () => observed,
    stopObserving() { observing = false; },
    renderEvidence,
    adoptArgs(next) { launchArgs = next; },
    inHarness,
    async waitForFirstText(doc, evidence, after, renderedAt) {
      // Nothing on screen is not "first readable text": a build whose rendering silently produced nothing
      // must not be able to hand the startup measurement a number either — and it has no paint to wait for,
      // so this runs before the wait (there is nothing to paint, so the wait would never end: F-17). The
      // `no_text` mark also disarms the shell's paint deadline. The caller decides what a document with
      // blocks but no text (only images) does next; the measurement says there was no text either way.
      if (evidence.blocks === 0 || !evidence.hasText) {
        await shell.mark('no_text', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars}`);
        return 'no_text';
      }

      // Hidden text is still in `textContent` and frames still tick; that is not a paint (MARXY-71).
      if (!isDocVisible(doc)) {
        await shell.mark('no_paint', Date.now(), 'reason=not-visible');
        return 'no_paint';
      }

      // Counted from here, so the number covers the wait and not the render mark's IPC round trip.
      // The wait has no deadline of its own: some environments deliver no frames and no paint entries
      // (a Mac in dark wake, a locked screen) and there it never resolves. A harness launch is ended
      // by the shell's deadline instead, because WebKit aligns in-page timers in a window that cannot
      // paint to about 15 s. A reader is left waiting and gets the document when the display wakes.
      const framesAtRender = observed;
      const { signal } = await waitForEnginePaint({ after });
      // One timestamp for both marks: the paint detail costs an IPC round trip and `first_text` must not
      // be pushed later by the cost of reporting it.
      const paintedAt = Date.now();
      const frames = observed - framesAtRender;

      await shell.mark('painted', paintedAt, `frames=${frames} since_render_ms=${paintedAt - renderedAt} signal=${signal}`);
      // Two fields exactly: the acceptance criterion names this line, and the startup harness parses it.
      // Anything the check needs beyond the timestamp goes on the `painted` line above.
      await shell.mark('first_text', paintedAt);
      return 'painted';
    },
    async finish(code) {
      observing = false;
      settleReady(code);
      // Harness mode is resolved here rather than before the render so that its IPC round trip stays
      // out of the measured path.
      if (await inHarness()) await shell.quit(code);
    },
    ready,
  };
}
