// Rich text for the clipboard from a drag selection (ADR-0054, design 03 §Rich copy of a drag, C-06).
// The cloned range loses every display-only mark and every attribute a paste target has no use for,
// then passes the core sanitiser: nothing raw from the page reaches the clipboard.
import { DEFAULT_POLICY, sanitizeHtml } from '@marxy/core/src/sanitize/index.ts';
import { cloneRangeInert, inertDocument } from './copy-text.ts';

/** Display-only elements dropped with their contents: glyph labels, link destinations, typesetter breaks. */
const DROP_CLASSES: readonly string[] = [
  'marxy-invisible-glyph',
  'marxy-link-dest',
  'marxy-link-host-label',
  'marxy-elided',
  'marxy-lb',
  'marxy-hyphen',
];

/** Wrappers whose contents stay: hanging punctuation. */
const UNWRAP_CLASSES: readonly string[] = ['marxy-hang'];

/** Controls the page draws that are not the document's words (a task checkbox, a copy button). */
const DROP_ELEMENTS: ReadonlySet<string> = new Set(['input', 'button', 'script', 'style', 'template']);

const KEEP_ATTRIBUTES: ReadonlySet<string> = new Set(['href', 'title', 'alt', 'colspan', 'rowspan', 'start']);

const SOFT_HYPHEN = /\u00ad/g;

function hasAny(el: Element, classes: readonly string[]): boolean {
  return classes.some((c) => el.classList.contains(c));
}

function clean(root: Node): void {
  for (const child of [...root.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text.includes('\u00ad')) child.textContent = text.replace(SOFT_HYPHEN, '');
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }
    if (!(child instanceof Element)) continue;
    if (DROP_ELEMENTS.has(child.localName) || hasAny(child, DROP_CLASSES)) {
      child.remove();
      continue;
    }
    clean(child);
    if (hasAny(child, UNWRAP_CLASSES)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    for (const attr of [...child.attributes]) {
      if (!KEEP_ATTRIBUTES.has(attr.name)) child.removeAttribute(attr.name);
    }
    if (child.localName === 'img') child.removeAttribute('src');
  }
}

/** Sanitised HTML for a range of the page; '' when it is empty. Built in an inert document: nothing in it loads. */
export function htmlFromRange(range: Range): string {
  if (range.collapsed) return '';
  const box = inertDocument().createElement('div');
  box.append(cloneRangeInert(range));
  clean(box);
  // Reading the markup of a detached container, never writing any: the sanitiser is the second line.
  const html = box.innerHTML;
  return sanitizeHtml(html, DEFAULT_POLICY).html;
}
