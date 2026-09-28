// DOM selection text for copy: marker glyphs are display-only (MARXY-236).

const SKIP = new Set(['marxy-invisible-glyph', 'marxy-link-dest', 'marxy-link-host-label']);

/** Text for the clipboard from a DOM selection; invisible marker labels are omitted. */
export function textFromDomSelection(sel: Selection): string {
  if (sel.rangeCount === 0) return '';
  const fragment = sel.getRangeAt(0).cloneContents();
  return textFromFragment(fragment);
}

function textFromFragment(root: DocumentFragment | Node): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node instanceof Element) {
      for (const cls of node.classList) if (SKIP.has(cls)) return;
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
