// Phase 0 reader: open the file named on the command line, render it sanitised and unstyled, print
// startup marks, exit when asked. All privileged work goes through ./shell (ADR-0010, ADR-0020).
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { shell } from './shell/tauri.ts';

const t0 = Date.now();
const md = new MarkdownIt({ html: true, linkify: false, typographer: true });
const sanitize = (html: string) => DOMPurify.sanitize(html, {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['img', 'iframe', 'object', 'embed', 'form', 'meta', 'link', 'svg', 'style', 'video', 'audio'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|#|\/)/i,
});

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

/** The startup harness sets the env var; the flag exists so a person can do the same by hand. */
async function quitRequested(args: readonly string[] = []): Promise<boolean> {
  if (args.includes('--quit-after-paint')) return true;
  try {
    return Boolean((await shell.startupMarks()).quit_after_paint);
  } catch {
    return false;
  }
}

/** Every path ends here: the frame observer stops so an idle window is not woken once a frame. */
async function finish(args: readonly string[], code: number): Promise<void> {
  observing = false;
  if (await quitRequested(args)) await shell.quit(code);
}

async function main() {
  await shell.mark('script_start', t0);
  const args = await shell.args();
  // Skip flags and the macOS launcher's -psn_… argument; the first plain argument is the document.
  const file = args.find(a => !a.startsWith('-'));
  const doc = document.getElementById('doc')!;

  // No document means no `first_text`: nothing was read, so a launch like this must not be able to
  // hand the startup measurement a cold-start number.
  if (!file) {
    await shell.mark('no_document', Date.now());
    return finish(args, 0);
  }

  const bytes = await shell.readFile(file);
  // Display only: the buffer layer keeps the raw bytes, and nothing in this app writes them back.
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  doc.innerHTML = sanitize(md.render(text));
  document.title = `${file.split('/').pop()} — marxy`;

  const evidence = renderEvidence(doc);
  const framesAtRender = framesObserved;
  const renderedAt = Date.now();
  await shell.mark('render', renderedAt, `blocks=${evidence.blocks} chars=${evidence.chars} heading=${evidence.heading}`);

  await afterPaint();
  // One timestamp for both marks: the paint detail costs an IPC round trip and `first_text` must not
  // be pushed later by the cost of reporting it.
  const paintedAt = Date.now();
  const frames = framesObserved - framesAtRender;

  // Nothing on screen is not "first readable text": a build whose rendering silently produced nothing
  // must not be able to hand the startup measurement a number either.
  if (evidence.blocks === 0 || evidence.chars === 0) {
    await shell.mark('no_text', paintedAt, `blocks=${evidence.blocks} chars=${evidence.chars}`);
    return finish(args, 1);
  }
  await shell.mark('painted', paintedAt, `frames=${frames} since_render_ms=${paintedAt - renderedAt}`);
  // Two fields exactly: the acceptance criterion names this line, and the startup harness parses it.
  // Anything the check needs beyond the timestamp goes on the `painted` line above.
  await shell.mark('first_text', paintedAt);
  return finish(args, 0);
}

main().catch(async (e) => {
  document.getElementById('doc')!.textContent = String(e);
  await shell.mark('error', Date.now(), String(e));
  // A failed launch still has to exit when asked, or the harness waits out its whole timeout.
  await finish([], 1);
});
