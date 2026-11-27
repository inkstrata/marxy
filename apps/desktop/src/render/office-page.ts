// A Word document's or a deck's Markdown (core's office/markdown.ts) drawn as the Markdown page draws a file: the one
// parse, the one allow-list, the page's own HTML. Each picture's stand-in address is dropped by the allow-list, and its
// removals say which picture each `img` stands for, in the order they are on the page.
import { IMAGE_SCHEME } from '@marxy/core/src/office/index.ts';
import { renderSafeHtml } from '@marxy/core/src/render/index.ts';

/** Fills `into` with the page; returns each `img` drawn, with the index of the picture it stands for. */
export function fillOfficePage(into: HTMLElement, markdown: string, file: string): { readonly img: HTMLImageElement; readonly image: number }[] {
  const r = renderSafeHtml(markdown, { file });
  // Parsed where nothing loads, so no image reaches the live page until it is known to be one of the writer's.
  const template = into.ownerDocument.createElement('template');
  template.innerHTML = r.html;
  const prefix = `${IMAGE_SCHEME}:`;
  const marks = r.removed.flatMap((x) => (x.what === 'attribute' && x.name === 'src' && x.on === 'img' && x.value?.startsWith(prefix) ? [Number(x.value.slice(prefix.length))] : []));
  const imgs = [...template.content.querySelectorAll('img')];
  // Only the writer makes an image, and every one it makes has a stand-in address: the two lists match one for one.
  // If they do not, no image can be told from a stranger's, so each is drawn as its alt text.
  if (imgs.length !== marks.length) {
    for (const img of imgs) img.replaceWith(img.ownerDocument.createTextNode(img.getAttribute('alt') ?? ''));
    into.replaceChildren(template.content);
    return [];
  }
  into.replaceChildren(template.content);
  return imgs.map((img, i) => ({ img, image: marks[i]! }));
}
