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

const RUN_PIECE = 'pre.marxy-run > code';

/**
 * The source text of `range` when it touches a code file's pieces (V-10), else null: the file's own bytes between
 * the two ends of the selection, line endings as they are, not the page's text. The page's text is a poorer copy
 * of the file: the HTML parser turned a CRLF into LF, and the pieces are separate blocks with a break between
 * them. A piece's page text is its source text with each line ending (CRLF, CR or LF) as one newline and each NUL as
 * U+FFFD, so an offset in one maps to the other; the selection's ends are found by that map. `bytes` are those the
 * page was set from.
 */
export function codeRunSourceText(range: Range, article: HTMLElement, bytes: Uint8Array): string | null {
  const pieces = [...article.querySelectorAll<HTMLElement>(RUN_PIECE)].filter((code) => range.intersectsNode(code));
  if (pieces.length === 0) return null;
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  const out: string[] = [];
  for (const code of pieces) {
    const start = Number(code.dataset.marxyS);
    const end = Number(code.dataset.marxyE);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end > bytes.length || start > end) return null;
    const source = decoder.decode(bytes.subarray(start, end));
    // The page index of every source index: a CRLF is one newline, so the index does not move on its LF.
    const pageAt: number[] = [];
    let page = 0;
    for (let i = 0; i < source.length; i++) {
      pageAt.push(page);
      if (!(source[i] === '\n' && source[i - 1] === '\r')) page++;
    }
    pageAt.push(page);
    const whole = document.createRange();
    whole.selectNodeContents(code);
    const upTo = (boundary: 'start' | 'end'): number => {
      const part = document.createRange();
      part.setStart(code, 0);
      if (boundary === 'start') part.setEnd(range.startContainer, range.startOffset);
      else part.setEnd(range.endContainer, range.endOffset);
      return textFromRange(part).length;
    };
    const from = range.compareBoundaryPoints(Range.START_TO_START, whole) <= 0 ? 0 : upTo('start');
    // The piece's last line ending is the break to the next piece and is not always on the page, so a selection that
    // reaches the end of the piece's text takes it.
    const after = document.createRange();
    after.setStart(range.endContainer, range.endOffset);
    after.setEnd(code, code.childNodes.length);
    const reachesEnd = range.compareBoundaryPoints(Range.END_TO_END, whole) >= 0 || /^\n?$/.test(textFromRange(after));
    const to = reachesEnd ? Number.POSITIVE_INFINITY : upTo('end');
    // The first source index at or after each page index; past the end of the source is the end of it.
    const sourceIndex = (p: number): number => {
      const i = pageAt.findIndex((v) => v >= p);
      return i === -1 ? source.length : i;
    };
    out.push(source.slice(sourceIndex(from), to === Number.POSITIVE_INFINITY ? source.length : sourceIndex(to)));
  }
  return out.join('');
}
