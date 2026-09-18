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

/** Resolves on the frame after the browser has painted the current DOM, so `first_text` is honest. */
const afterPaint = () => new Promise<void>(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
});

/** Evidence that the document actually reached the DOM, for the CLI smoke check. */
function renderEvidence(doc: HTMLElement): string {
  const blocks = doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,ul,ol,table,blockquote').length;
  const heading = doc.querySelector('h1,h2,h3')?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
  return `blocks=${blocks} chars=${doc.textContent?.length ?? 0} heading=${heading}`;
}

async function main() {
  await shell.mark('script_start', t0);
  const args = await shell.args();
  // Skip flags and the macOS launcher's -psn_… argument; the first plain argument is the document.
  const file = args.find(a => !a.startsWith('-'));
  const doc = document.getElementById('doc')!;
  if (file) {
    const bytes = await shell.readFile(file);
    // Display only: the buffer layer keeps the raw bytes, and nothing in this app writes them back.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    doc.innerHTML = sanitize(md.render(text));
    document.title = `${file.split('/').pop()} — marxy`;
    await shell.mark('render', Date.now(), renderEvidence(doc));
  } else {
    await shell.mark('no_document', Date.now());
  }
  await afterPaint();
  await shell.mark('first_text', Date.now());
  if (args.includes('--quit-after-paint') || (await shell.startupMarks()).quit_after_paint) await shell.quit();
}

main().catch(e => {
  document.getElementById('doc')!.textContent = String(e);
  shell.mark('error', Date.now(), String(e));
});
