// A page of text for the Studio: Markdown through the one sanitising render, then its code
// coloured as a pane's is, so the canvas and the miniatures are the real page and not a picture of one.
import { renderSafeHtml } from '@marxy/core/src/render/index.ts';
import { applyAllHighlights } from './highlight.ts';

/** `article` holds `markdown` as the reader would see it; resolves when its code is coloured. */
export async function fillStudioPage(article: HTMLElement, markdown: string): Promise<void> {
  // Parsed where nothing loads: the page is no file's, so a relative image has nowhere to resolve and would only be asked for.
  const template = article.ownerDocument.createElement('template');
  template.innerHTML = renderSafeHtml(markdown).html;
  for (const img of template.content.querySelectorAll('img')) img.removeAttribute('src');
  article.replaceChildren(template.content);
  await applyAllHighlights(article);
}
