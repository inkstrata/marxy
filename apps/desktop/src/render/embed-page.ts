// A text entry's page inside another page (`viewers/embed.ts`): what the pane draws for those bytes, by
// the same calls (a reading's page, Markdown through the one allow-list, code through the code parse), then made inert as
// the Line's preview is: a picture is its alt text and a link loses its address, except a link to another entry of the
// archive, which keeps it as a name for the page to follow (`EMBED_LINK`). Text reaches the DOM only as that HTML.
import { parseCode } from '@marxy/core';
import { readingOf } from '@marxy/core/src/reading/index.ts';
import { renderDocumentSafeHtml, renderSafeHtml } from '@marxy/core/src/render/index.ts';
import { applyAllHighlights } from './highlight.ts';
import { applyInvisibleMarkers } from './invisibles-dom.ts';
import { neutralise, setAs } from './palette-preview.ts';

/** The event a followed link raises on its element, bubbling: `detail.name` is the entry it names. */
export const EMBED_LINK = 'marxy:arch-link';

/** `href` of a link in entry `name`, as the archive's entry it names; null when it leaves the archive or names the web. */
export function linkTarget(name: string, href: string): string | null {
  if (href === '' || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#') || href.startsWith('\\')) return null;
  let target: string;
  try {
    target = decodeURIComponent(href.replace(/[?#].*$/, ''));
  } catch {
    return null;
  }
  const out = name.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.length > 0 ? out.join('/') : null;
}

/** Draws Markdown into `article` with its images inert before they reach the page, and its links into the archive wired. */
function drawMarkdown(article: HTMLElement, name: string, html: string): void {
  const template = article.ownerDocument.createElement('template');
  // Parsed where nothing loads: an `<img>` parsed into the live document starts its fetch at once.
  template.innerHTML = html;
  const targets = new Map<Element, string>();
  for (const a of template.content.querySelectorAll('a')) {
    const to = linkTarget(name, a.getAttribute('href') ?? '');
    if (to) targets.set(a, to);
  }
  neutralise(template.content);
  for (const [a, to] of targets) {
    a.classList.add('marxy-arch-link');
    a.setAttribute('role', 'link');
    a.setAttribute('data-marxy-arch-to', to);
    a.setAttribute('title', to);
  }
  article.replaceChildren(template.content);
  article.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('.marxy-arch-link') : null;
    const to = a?.getAttribute('data-marxy-arch-to');
    if (!a || !to) return;
    e.preventDefault();
    a.dispatchEvent(new CustomEvent(EMBED_LINK, { bubbles: true, detail: { name: to } }));
  });
}

/** Draws entry `name`'s `bytes` into `article` as the pane reads a file of kind `kind`; resolves once its code is coloured. */
export async function fillEmbedPage(article: HTMLElement, name: string, bytes: Uint8Array, kind: string): Promise<{ readonly code: boolean }> {
  const reading = readingOf(name, bytes, kind);
  let code = false;
  if (reading) article.innerHTML = reading.html;
  else {
    const how = setAs(name, kind as Parameters<typeof setAs>[1]);
    if (how.as === 'markdown') {
      drawMarkdown(article, name, renderSafeHtml(bytes, { file: name }).html);
    } else {
      code = true;
      article.innerHTML = renderDocumentSafeHtml(parseCode(bytes, { file: name, ...(how.lang === undefined ? {} : { lang: how.lang }) })).html;
    }
  }
  applyInvisibleMarkers(article);
  await applyAllHighlights(article).catch(() => {});
  return { code };
}
