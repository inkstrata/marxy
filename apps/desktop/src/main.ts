// Phase 0 reader: open the file named on the command line, render it sanitised and unstyled, print
// startup marks, exit when asked. All privileged work goes through ./shell (ADR-0010, ADR-0020).
import { parseMarkdown, type Document } from '@marxy/core';
import { renderDocumentSafeHtml } from '@marxy/core/src/render/index.ts';
import { shell } from './shell/tauri.ts';

const t0 = Date.now();

/** Phase-0 document state. nodeMap and blocks land with MARXY-75. */
interface OpenDocument {
  readonly ast: Document;
  readonly html: string;
  readonly nodeMap: null;
  readonly blocks: null;
}

const state: { document: OpenDocument | null } = { document: null };

/**
 * Counts animation frames from the moment the script runs, independently of anything below. The
 * paint mark reports how many frames passed between the DOM mutation and `first_text`, and the CLI
 * smoke check asserts that count is at least two — because a mark that only *claims* to be after
 * the paint would silently make every cold-start number optimistic (ADR-0013). The counter lives
 * out here, not inside afterPaint(), so that neutralising afterPaint() reports frames=0 and fails
 * the check instead of passing quietly.
 */
let framesObserved = 0;
let observing = true;
const observeFrame = () => { framesObserved += 1; if (observing) requestAnimationFrame(observeFrame); };
requestAnimationFrame(observeFrame);

/** Two animation frames plus a macrotask: by the time this resolves the mutated DOM has been painted. */
const FRAMES_BEFORE_PAINT = 2;

/**
 * Waits for the paint, with no deadline of its own. Some environments deliver no frames at all — a Mac
 * in dark wake, a locked screen — and there this never resolves; a harness launch is ended by the
 * shell's deadline instead (`arm_paint_deadline`, armed by the `render` mark), because WebKit aligns
 * timers in a window that cannot paint to about 15 s, so a timer in this page is not a deadline. A
 * reader is deliberately left waiting: a display that is asleep should show the document when it wakes.
 */
function afterPaint(): Promise<void> {
  return new Promise(resolve => {
    let waited = 0;
    const tick = () => {
      waited += 1;
      if (waited < FRAMES_BEFORE_PAINT) requestAnimationFrame(tick);
      else setTimeout(resolve, 0);
    };
    requestAnimationFrame(tick);
  });
}

interface RenderEvidence { readonly blocks: number; readonly chars: number; readonly heading: string }

/** Evidence that the document actually reached the DOM, for the CLI smoke check. */
function renderEvidence(doc: HTMLElement): RenderEvidence {
  return {
    blocks: doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,ul,ol,table,blockquote').length,
    chars: doc.textContent?.length ?? 0,
    heading: doc.querySelector('h1,h2,h3')?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
  };
}

/** The arguments this launch was given, kept so the error path can honour the flag too. */
let launchArgs: readonly string[] = [];

/** True when a harness launched us: the startup harness sets the env var, the flag is for a person. */
async function inHarness(): Promise<boolean> {
  if (launchArgs.includes('--quit-after-paint')) return true;
  try {
    return Boolean((await shell.startupMarks()).quit_after_paint);
  } catch {
    return false;
  }
}

/**
 * Every path ends here: the frame observer stops so an idle window is not woken once a frame, and a
 * harness launch exits with a code that says whether it painted. Harness mode is resolved here rather
 * than before the render so that its IPC round trip stays out of the measured path.
 */
async function finish(code: number): Promise<void> {
  observing = false;
  if (await inHarness()) await shell.quit(code);
}

async function main() {
  await shell.mark('script_start', t0);
  launchArgs = await shell.args();
  // Skip flags and the macOS launcher's -psn_… argument; the first plain argument is the document.
  const file = launchArgs.find(a => !a.startsWith('-'));
  const doc = document.getElementById('doc')!;

  // No document means no `first_text`: nothing was read, so a launch like this must not be able to
  // hand the startup measurement a cold-start number.
  if (!file) {
    await shell.mark('no_document', Date.now());
    return finish(0);
  }

  const bytes = await shell.readFile(file);
  // One parse, then the sanitised render from that AST — not a second parser (ADR-0001, ADR-0021).
  const ast = parseMarkdown(bytes, { file });
  const { html, removed } = renderDocumentSafeHtml(ast);
  state.document = { ast, html, nodeMap: null, blocks: null };
  console.info(`marxy: sanitiser removed ${removed.length}`);
  doc.innerHTML = html;
  document.title = `${file.split('/').pop()} — marxy`;

  const evidence = renderEvidence(doc);
  const renderedAt = Date.now();
  await shell.mark('render', renderedAt, `blocks=${evidence.blocks} chars=${evidence.chars} heading=${evidence.heading}`);

  // Nothing on screen is not "first readable text": a build whose rendering silently produced nothing
  // must not be able to hand the startup measurement a number either — and it has no paint to wait for,
  // so this runs before the wait. The `no_text` mark also disarms the shell's paint deadline.
  if (evidence.blocks === 0 || evidence.chars === 0) {
    await shell.mark('no_text', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars}`);
    return finish(1);
  }

  // Counted from here, so the number covers the wait and not the render mark's IPC round trip.
  const framesAtRender = framesObserved;
  await afterPaint();
  // One timestamp for both marks: the paint detail costs an IPC round trip and `first_text` must not
  // be pushed later by the cost of reporting it.
  const paintedAt = Date.now();
  const frames = framesObserved - framesAtRender;

  await shell.mark('painted', paintedAt, `frames=${frames} since_render_ms=${paintedAt - renderedAt}`);
  // Two fields exactly: the acceptance criterion names this line, and the startup harness parses it.
  // Anything the check needs beyond the timestamp goes on the `painted` line above.
  await shell.mark('first_text', paintedAt);
  return finish(0);
}

main().catch(async (e) => {
  document.getElementById('doc')!.textContent = String(e);
  await shell.mark('error', Date.now(), String(e));
  // A failed launch still has to exit when asked, or the harness waits out its whole timeout. The
  // flag counts here as well as the env var, which is why the arguments are kept.
  await finish(1);
});
