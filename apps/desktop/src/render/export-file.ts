// A file that is not open, set as a page for Export (a ticked file in a joined page or a bundle's pages/): Markdown through
// the sanitising pipeline, then cleaned as a copy is; any other text as preformatted lines.
import { renderSafeHtml } from '@marxy/core/src/render/pipeline.ts';
import { htmlFromRange } from '../selection/copy-html.ts';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function fileHtml(bytes: Uint8Array, markdown: boolean): string {
  if (!markdown) return `<pre>${esc(new TextDecoder('utf-8', { fatal: false }).decode(bytes))}</pre>`;
  // Parsed in a document of its own, where nothing loads, then cleaned as a copy is: no src, no class, nothing that runs.
  const doc = document.implementation.createHTMLDocument('');
  const box = doc.createElement('div');
  box.innerHTML = renderSafeHtml(bytes).html;
  doc.body.append(box);
  const r = doc.createRange();
  r.selectNodeContents(box);
  return htmlFromRange(r);
}
