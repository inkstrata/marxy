// The source in an article's byline as a link (K-20): trusted DOM after sanitise, like the link destinations. The core
// marks a web source's URL (`span[data-marxy-fm-part="url"]`, render/frontmatter.ts) in every kind; only in a pane whose
// document is an `article` is it a link, so every other kind's head keeps its plain value. Run after a render and when
// a pane's kind changes; a link made here is undone when the kind is no longer `article`.

const LINK = 'marxy-byline-link';
const URL_SPAN = '.marxy-article > dl:first-child > dd[data-marxy-fm-part="byline"][data-marxy-fm-key="source"] span[data-marxy-fm-part="url"]';
/** C0 controls, DEL and C1 controls, and whitespace: never in a link made here (the core refused them already). */
const REFUSED = /[\u0000- \u007f-\u009f]/u;

/** The URL a span holds, when it is a web URL a link may go to; else null. */
function webHref(text: string): string | null {
  if (REFUSED.test(text) || !/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' ? text : null;
  } catch {
    return null;
  }
}

/** Labels the page draws inside a value that are not its bytes: an invisible character's name, a link's destination. */
const LABELS = '.marxy-invisible-glyph, .marxy-link-dest';

/**
 * The value's own text: every text node but the labels. An invisible character's marker holds the character itself
 * (`.marxy-invisible-byte`) beside its label ("200B"), so the URL is read as written, never with the label in it.
 */
export function writtenText(el: Element): string {
  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) out += (node as Text).data;
    else if (node.nodeType === Node.ELEMENT_NODE && !(node as Element).matches(LABELS)) for (const child of node.childNodes) walk(child);
  };
  walk(el);
  return out;
}

/** Makes or undoes the byline's source link under `root`, by the kind of the pane it sits in. */
export function applyBylineLinks(root: ParentNode): void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (doc === null) return;
  for (const span of root.querySelectorAll<HTMLElement>(URL_SPAN)) {
    const article = span.closest('[data-marxy-kind]')?.getAttribute('data-marxy-kind') === 'article';
    const link = span.parentElement?.classList.contains(LINK) ? span.parentElement : null;
    if (article && link === null) {
      const href = webHref(writtenText(span));
      if (href === null) continue;
      const a = doc.createElement('a');
      a.className = LINK;
      a.setAttribute('href', href);
      span.replaceWith(a);
      a.append(span);
    } else if (!article && link !== null) {
      link.replaceWith(span);
    }
  }
}
