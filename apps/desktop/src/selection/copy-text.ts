// DOM selection text for copy: marker glyphs and the long-line elision note are display-only (MARXY-236, F-01).
// A range is copied into an inert document, never cloned in the page's own: a clone made there is a live
// element, and an image clone fetches its source again (C-06 review).

const SKIP = new Set(['marxy-elided', 'marxy-invisible-glyph', 'marxy-link-dest', 'marxy-link-host-label', 'marxy-log-hidden-run']);

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

const FENCE_CODE = 'pre:not(.marxy-run) > code[data-marxy-s]';

/**
 * The one Markdown code fence a selection lies wholly inside (F-68), as a one-piece list for `codeRunSourceText`'s
 * mapping, else none: a selection that takes any prose, another block or a second fence copies the page's text. The
 * fence's bytes must be its page text's source: a fence in a quote or a list item has its container's marks between
 * its lines, and an indented block loses its indent on the page, so those are left to the page's text.
 */
function fenceCode(range: Range, article: HTMLElement, bytes: Uint8Array): HTMLElement[] {
  const fences = [...article.querySelectorAll<HTMLElement>(FENCE_CODE)].filter((code) => range.intersectsNode(code));
  const code = fences[0];
  if (!code) return [];
  const whole = document.createRange();
  whole.selectNodeContents(code);
  const inside = range.cloneRange();
  if (range.compareBoundaryPoints(Range.START_TO_START, whole) < 0) inside.setStart(code, 0);
  if (range.compareBoundaryPoints(Range.END_TO_END, whole) > 0) inside.setEnd(code, code.childNodes.length);
  // Anything the selection holds besides this fence's text (prose, a second fence) makes the two differ.
  if (textFromRange(inside) !== textFromRange(range)) return [];
  const start = Number(code.dataset.marxyS);
  const end = Number(code.dataset.marxyE);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end > bytes.length || start > end) return [];
  const source = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes.subarray(start, end));
  const asPage = (text: string): string => text.replace(/\r\n?/g, '\n').replaceAll('\0', '\uFFFD').replace(/\n$/, '');
  return asPage(source) === textFromRange(whole).replace(/\n$/, '') ? [code] : [];
}

/**
 * The source text of `range` when it touches a code file's pieces (V-10), else null: the file's own bytes between
 * the two ends of the selection, line endings as they are, not the page's text. The page's text is a poorer copy
 * of the file: the HTML parser turned a CRLF into LF, and the pieces are separate blocks with a break between
 * them. A piece's page text is its source text with each line ending (CRLF, CR or LF) as one newline and each NUL as
 * U+FFFD, so an offset in one maps to the other; the selection's ends are found by that map. `bytes` are those the
 * page was set from. Failing that, a selection wholly inside one Markdown code fence is that fence's piece (F-68).
 */
export function codeRunSourceText(range: Range, article: HTMLElement, bytes: Uint8Array): string | null {
  const runPieces = [...article.querySelectorAll<HTMLElement>(RUN_PIECE)].filter((code) => range.intersectsNode(code));
  const pieces = runPieces.length > 0 ? runPieces : fenceCode(range, article, bytes);
  if (pieces.length === 0) return null;
  // A fence's last line ending is a character the reader can select, so a fence's selection ends where it ends (F-68).
  const exactEnd = runPieces.length === 0;
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  const out: string[] = [];
  for (const code of pieces) {
    // A piece the log filter hides whole (K-08) is not on the page: a copy of what is shown has none of it.
    if (code.parentElement?.classList.contains('marxy-log-hidden-piece')) continue;
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
    const reachesEnd = range.compareBoundaryPoints(Range.END_TO_END, whole) >= 0 || (!exactEnd && /^\n?$/.test(textFromRange(after)));
    const to = reachesEnd ? Number.POSITIVE_INFINITY : upTo('end');
    // The first source index at or after each page index; past the end of the source is the end of it.
    // A page index just past a newline is just past the whole CRLF in the source, not between its CR and its LF (F-68).
    const sourceIndex = (p: number): number => {
      // `pageAt` never decreases: the first index at or after `p` by bisection (a log piece has thousands of lines).
      let low = 0;
      let high = pageAt.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (pageAt[mid]! >= p) high = mid;
        else low = mid + 1;
      }
      if (low === pageAt.length) return source.length;
      return source[low] === '\n' && source[low - 1] === '\r' ? low + 1 : low;
    };
    const first = sourceIndex(from);
    const last = to === Number.POSITIVE_INFINITY ? source.length : sourceIndex(to);
    out.push(withoutHiddenRuns(code, source, first, last, sourceIndex));
  }
  return out.join('');
}

/** How much of the page's copy text a node holds: what `textFromFragment` would keep of it. */
function pageLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.length;
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  for (const cls of (node as Element).classList) if (SKIP.has(cls)) return 0;
  let n = 0;
  for (const child of node.childNodes) n += pageLength(child);
  return n;
}

/**
 * `source` from `first` to `last`, less the runs of lines the log filter hides in `code` (K-08). A copy takes what the
 * reader sees as well as the bytes of it: a selection from the first line to the last of a filtered log is the lines
 * shown, each as the file has it, and not the thousands between. A hidden run is one element holding its lines' text and
 * newlines (`kinds/log-view.ts`), so it is a range of the page's text, and that maps to the source like any other.
 */
function withoutHiddenRuns(code: HTMLElement, source: string, first: number, last: number, sourceIndex: (page: number) => number): string {
  if (code.querySelector('.marxy-log-hidden-text') === null) return source.slice(first, last);
  const kept: string[] = [];
  let from = first;
  let at = 0;
  for (const child of code.childNodes) {
    const length = pageLength(child);
    if (child instanceof Element && child.classList.contains('marxy-log-hidden-text')) {
      const start = Math.max(sourceIndex(at), first);
      const end = Math.min(sourceIndex(at + length), last);
      if (end > start) {
        if (start > from) kept.push(source.slice(from, start));
        from = Math.max(from, end);
      }
    }
    at += length;
  }
  if (last > from) kept.push(source.slice(from, last));
  return kept.join('');
}
