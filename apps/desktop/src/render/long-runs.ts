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

/** The longest run of non-space characters left unbroken, and the distance between the breaks put in a longer one. */
export const RUN_CHARS = 4096;

const LONG_RUN = new RegExp(`\\S{${RUN_CHARS + 1},}`, 'gu');
const SKIPPED = '.katex, .marxy-math, .marxy-math-inline';
/** A character that must stay with the one before it: a mark, a joiner, a variation selector. */
const CLUSTERS_WITH_PREVIOUS = /^[\p{M}‍︎️]/u;

/** Where, inside `run`, to put the breaks: offsets about `RUN_CHARS` apart, never inside a surrogate pair or a cluster. */
function cuts(run: string): number[] {
  const out: number[] = [];
  let at = RUN_CHARS;
  while (at < run.length) {
    let cut = at;
    const previous = run.charCodeAt(cut - 1);
    if (previous >= 0xd800 && previous <= 0xdbff) cut += 1;
    while (cut < run.length && CLUSTERS_WITH_PREVIOUS.test(run.slice(cut, cut + 2))) cut += 1;
    if (cut >= run.length) break;
    out.push(cut);
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
