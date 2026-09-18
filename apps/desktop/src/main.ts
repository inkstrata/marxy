// Phase 0 hello world: open the file passed on the command line, render it sanitised and unstyled,
// print startup marks, exit when asked (used by scripts/measure-startup.mjs).
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { shell } from './shell/tauri.ts';

const t0 = Date.now();
const raf = () => new Promise<number>(r => requestAnimationFrame(r));
const md = new MarkdownIt({ html: true, linkify: false, typographer: true });
const sanitize = (html: string) => DOMPurify.sanitize(html, {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['img', 'iframe', 'object', 'embed', 'form', 'meta', 'link', 'svg', 'style', 'video', 'audio'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|#|\/)/i,
});

async function main() {
  await shell.mark('script_start', t0);
  const args = await shell.args();
  const file = args.find(a => !a.startsWith('-'));
  const doc = document.getElementById('doc')!;
  if (file) {
    const bytes = await shell.readFile(file);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); // display only; the buffer layer (MARXY-013) keeps the raw bytes
    doc.innerHTML = sanitize(md.render(text));
    document.title = `${file.split('/').pop()} — marxy`;
  }
  await raf(); await raf();
  await shell.mark('first_text', Date.now(), file ?? '');
  if (args.includes('--quit-after-paint') || (await shell.startupMarks()).quit_after_paint) await shell.quit();
}
main().catch(e => { document.getElementById('doc')!.textContent = String(e); shell.mark('error', Date.now(), String(e)); });
