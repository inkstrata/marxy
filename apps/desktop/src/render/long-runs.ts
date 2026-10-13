// A break opportunity inside a run of text that has none (F-79). WebKit lays out a run of non-space characters that
// spans two or more text nodes in time quadratic in its length when the page has `overflow-wrap: break-word`: a 2 MB
// line with no spaces took 80 s for one layout, and every later layout paid it again. The HTML parser makes the
// split itself, a text node at most 64 KB long. A `<wbr>` is an element that holds nothing and draws nothing: it is
// not a character, so `textContent`, a copy, find's text index and every byte offset in the source map are what they
// were, and it gives the engine a place to break every `RUN_CHARS` characters, which bounds the run it measures.
// Prose with spaces is never touched: only a run of more than `RUN_CHARS` non-space characters is cut, and only
// inside the run. Code is cut too: the page holds a code piece's text, a long token and all, in the parser's 64 KB text
// nodes until highlight.ts has split it into lines (it elides a long line then), and a 2 MB one-line log or minified
// bundle took minutes to lay out in that time. The pass that splits the lines drops the breaks with the text it replaces.

/** The longest run of non-space characters left unbroken, and the distance between the breaks put in a longer one (a cut moves back to a cluster boundary, so a piece is at most this long). */
export const RUN_CHARS = 4096;

const LONG_RUN = new RegExp(`\\S{${RUN_CHARS + 1},}`, 'gu');
const SKIPPED = '.katex, .marxy-math, .marxy-math-inline';
/** How far either side of a cut the grapheme boundary is looked for: a cluster (a tag-sequence flag is the longest) is far shorter. */
const WINDOW = 256;
let segmenter: Intl.Segmenter | null | undefined;

/** The start of the grapheme cluster `at` falls in, or `at` when it is on a boundary: a cut there splits no flag, emoji sequence, syllable or conjunct. */
function boundaryAtOrBefore(run: string, at: number, floor: number): number {
  segmenter ??= typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('und', { granularity: 'grapheme' }) : null;
  const from = Math.max(floor, at - WINDOW);
  if (segmenter === null) {
    // No segmenter: at least not between the halves of a surrogate pair.
    const previous = run.charCodeAt(at - 1);
    return previous >= 0xd800 && previous <= 0xdbff ? at + 1 : at;
  }
  let best = from;
  for (const part of segmenter.segment(run.slice(from, Math.min(run.length, at + WINDOW)))) {
    const start = from + part.index;
    if (start > at) break;
    best = start;
  }
  return best;
}

/** Where, inside `run`, to put the breaks: about `RUN_CHARS` apart, each moved back to the start of the grapheme cluster it falls in. */
function cuts(run: string): number[] {
  const out: number[] = [];
  let previous = 0;
  let at = RUN_CHARS;
  while (at < run.length) {
    const cut = boundaryAtOrBefore(run, at, previous + 1);
    if (cut >= run.length) break;
    out.push(cut);
    previous = cut;
    at = cut + RUN_CHARS;
  }
  return out;
}

/**
 * Cuts every run of more than `RUN_CHARS` non-space characters under `root` into pieces of about that many, with a
 * `<wbr>` between each two. The text is the same text: only the nodes that hold it, and the elements between them, change.
 * Returns how many breaks it put in.
 */
export function guardLongRuns(root: ParentNode): number {
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (doc === null) return 0;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const long: Text[] = [];
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    if (node.data.length > RUN_CHARS && node.parentElement?.closest(SKIPPED) === null) long.push(node);
  }
  let breaks = 0;
  for (const node of long) {
    const data = node.data;
    LONG_RUN.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let from = 0;
    let cutAny = false;
    for (let m = LONG_RUN.exec(data); m !== null; m = LONG_RUN.exec(data)) {
      for (const cut of cuts(m[0])) {
        frag.append(doc.createTextNode(data.slice(from, m.index + cut)), doc.createElement('wbr'));
        from = m.index + cut;
        cutAny = true;
        breaks += 1;
      }
    }
    if (!cutAny) continue;
    frag.append(doc.createTextNode(data.slice(from)));
    node.replaceWith(frag);
  }
  return breaks;
}
