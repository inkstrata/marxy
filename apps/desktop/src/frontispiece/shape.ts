// The Commonplace piece, set as a page (MARXY-257). The piece has already been through the one parse
// and the sanitiser and is in `#doc`; this only moves those elements into place and names them with
// classes. It writes no markup: every node here was made by createElement or already existed.
import { directionOf, type PieceMatter } from './pieces.ts';

/** Verse indents deeper than this are set at this depth; no piece in the corpus comes close. */
const MAX_INDENT = 8;
const ELISION = '⋮';
const EM_SPACE = ' ';

function isElement(node: Node, tag: string): node is HTMLElement {
  return node.nodeType === 1 && (node as Element).tagName === tag;
}

function isElision(p: Element): boolean {
  return (p.textContent ?? '').trim() === ELISION;
}

/**
 * Takes a verse line's leading EM SPACE run off its first text and returns its length: the run is the
 * line's indent level (FORMAT.md, Verse), set by a class and never drawn as characters. The newline
 * the renderer leaves after each `<br>` goes too; spaces inside the line are the poet's and stay.
 */
function takeIndent(line: Node[]): number {
  let level = 0;
  while (line.length > 0 && line[0]!.nodeType === 3) {
    const text = line[0] as Text;
    const data = text.data.replace(/^[\n\r\t ]+/, '');
    let i = 0;
    while (data[i] === EM_SPACE) i++;
    level += i;
    const rest = data.slice(i);
    if (rest.length > 0) {
      text.data = rest;
      break;
    }
    text.remove();
    line.shift();
  }
  return level;
}

/**
 * One stanza: each `<br>`-separated line becomes its own block, so a line that turns over hangs
 * (reader-typography chapter 7, Poetry). The `<br>`s go: a block line already ends the line, and a
 * `<br>` left between blocks would draw a blank one. Returns the deepest indent level in the stanza.
 */
function setStanza(p: HTMLElement): number {
  const doc = p.ownerDocument;
  const lines: Node[][] = [[]];
  for (const node of [...p.childNodes]) {
    if (isElement(node, 'BR')) {
      node.remove();
      lines.push([]);
    } else {
      lines[lines.length - 1]!.push(node);
    }
  }
  p.classList.add('marxy-verse');
  let deepest = 0;
  for (const line of lines) {
    const level = Math.min(takeIndent(line), MAX_INDENT);
    if (line.length === 0) continue;
    const span = doc.createElement('span');
    span.className = level > 0 ? `marxy-verse-line marxy-verse-indent-${level}` : 'marxy-verse-line';
    span.append(...line);
    p.append(span);
    deepest = Math.max(deepest, level);
  }
  return deepest;
}

/**
 * A piece in two or more languages sets one section per language side by side (stacked when the
 * window is narrow), each carrying its language and direction. Sections are the `## ` headings in the
 * order front matter lists the languages; a piece whose headings do not match is left as it is.
 */
function setParallel(page: HTMLElement, languages: readonly string[], end: Node | null): void {
  const doc = page.ownerDocument;
  const sections: Node[][] = [];
  for (const node of [...page.childNodes]) {
    if (node === end) break;
    if (isElement(node, 'H2')) sections.push([node]);
    else if (sections.length > 0) sections[sections.length - 1]!.push(node);
  }
  if (sections.length !== languages.length) return;
  const parallel = doc.createElement('div');
  parallel.className = 'marxy-frontispiece-parallel';
  page.insertBefore(parallel, sections[0]![0]!);
  sections.forEach((nodes, i) => {
    const section = doc.createElement('section');
    section.className = 'marxy-frontispiece-lang';
    section.lang = languages[i]!;
    section.dir = directionOf(languages[i]!);
    section.append(...nodes);
    parallel.append(section);
  });
}

/**
 * Wraps the rendered piece in `doc` into the frontispiece and returns its root. The colophon is
 * everything after the last thematic break (FORMAT.md, Body).
 */
export function shapeFrontispiece(doc: HTMLElement, matter: PieceMatter): HTMLElement {
  const owner = doc.ownerDocument;
  const root = owner.createElement('div');
  root.className = `marxy-frontispiece marxy-frontispiece-${matter.form}`;
  const page = owner.createElement('div');
  page.className = 'marxy-frontispiece-page';
  page.append(...doc.childNodes);
  root.append(page);
  doc.append(root);

  const rules = [...page.children].filter((el) => el.tagName === 'HR');
  const lastRule = rules[rules.length - 1] ?? null;
  if (lastRule) {
    const colophon = owner.createElement('div');
    colophon.className = 'marxy-frontispiece-colophon';
    while (lastRule.nextSibling) colophon.append(lastRule.nextSibling);
    lastRule.after(colophon);
  }

  // A turned-over line hangs one level deeper than the poem's deepest indent, so it can never be
  // mistaken for an indented line of its own (the depth class on the root sets where that is).
  let depth = 0;
  for (const p of [...page.querySelectorAll<HTMLElement>(':scope > p')]) {
    if (isElision(p)) p.classList.add('marxy-frontispiece-elision');
    else if (matter.form === 'verse') depth = Math.max(depth, setStanza(p));
  }
  if (depth > 0) root.classList.add(`marxy-verse-depth-${depth}`);

  if (matter.languages.length > 1) {
    setParallel(page, matter.languages, lastRule);
  } else if (matter.languages.length === 1) {
    root.lang = matter.languages[0]!;
    root.dir = directionOf(matter.languages[0]!);
  }
  return root;
}
