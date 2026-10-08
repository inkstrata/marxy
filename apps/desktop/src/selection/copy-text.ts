// DOM selection text for copy: marker glyphs and the long-line elision note are display-only (MARXY-236, F-01).
// A range is copied into an inert document, never cloned in the page's own: a clone made there is a live
// element, and an image clone fetches its source again (C-06 review).

const SKIP = new Set(['marxy-elided', 'marxy-invisible-glyph', 'marxy-link-dest', 'marxy-link-host-label']);

let inertDoc: Document | null = null;

/** A document with no browsing context: nothing made in it loads, runs or lays out. */
export function inertDocument(): Document {
  inertDoc ??= document.implementation.createHTMLDocument('');
  return inertDoc;
}

/** The part of `range` as a fragment of the inert document: nodes are imported one by one, never cloned in the page. */
export function cloneRangeInert(range: Range): DocumentFragment {
  const target = inertDocument();
  const out = target.createDocumentFragment();
  const textPart = (node: CharacterData): string => {
    const end = node === range.endContainer ? range.endOffset : node.data.length;
    const start = node === range.startContainer ? range.startOffset : 0;
    return node.data.slice(start, end);
  };
  const copy = (node: Node, into: Node): void => {
    if (!range.intersectsNode(node)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      into.appendChild(target.createTextNode(textPart(node as CharacterData)));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = target.importNode(node, false);
    into.appendChild(el);
    for (const child of node.childNodes) copy(child, el);
  };
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) out.appendChild(target.createTextNode(textPart(root as CharacterData)));
  else for (const child of root.childNodes) copy(child, out);
  return out;
}

/** Text for the clipboard from a range; invisible marker labels are omitted. */
export function textFromRange(range: Range): string {
  return textFromFragment(cloneRangeInert(range));
}

/** Text for the clipboard from a DOM selection; invisible marker labels are omitted. */
export function textFromDomSelection(sel: Selection): string {
  if (sel.rangeCount === 0) return '';
  return textFromRange(sel.getRangeAt(0));
}

function textFromFragment(root: DocumentFragment | Node): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (const cls of (node as Element).classList) if (SKIP.has(cls)) return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return parts.join('');
}
