// An EPUB read as a book (the book page, apps/desktop/src/viewers/book.ts): its parts come through the shell's zip reader
// under its caps and are handed here by name; what comes back is the whole book as Markdown in its spine's order, for the
// one renderer and sanitiser, with the byte each chapter and each place a link names starts at, its contents (nav.xhtml,
// toc.ncx, or the chapters' first headings), the pictures it holds and its own fields. A lock, or a package that cannot be
// read as a book, comes back as the sentence the page says instead. Pure.
import { writeMarkdown, type OfficeMarkdown } from '../office/markdown.ts';
import { countWords, type Block, type OfficeImage } from '../office/model.ts';
import { LENIENT_ROOT, newBudget, OfficeError, OfficeLimit, find, type XmlElement } from '../office/xml.ts';
import { bookParts, BookError, lockOf, navLinks, ncxLinks, opfPath, readOpf, type BookMeta, type EntryRead, type TocLink } from './package.ts';
import { chapterBlocks, chapterTitle } from './xhtml.ts';

export { BookError, TOC_DEPTH, TOC_MOST, SPINE_MOST, entryOf, type BookMeta, type EntryRead } from './package.ts';

/** The most entries a book's zip may list to be read as a book, and the most its chapters may hold before they are read. */
export const BOOK_LIMITS = {
  entries: 20_000,
  /** Bytes of chapters, as the zip lists them unpacked: the XML budget's own, checked before anything is read. */
  chapterBytes: 128 * 1024 * 1024,
  /** A chapter larger than this is named, not read: the shell's own cap on an entry. */
  chapterEach: 16 * 1024 * 1024,
} as const;

export interface BookChapter {
  /** Its zip entry. */
  readonly path: string;
  readonly title: string | null;
  readonly words: number;
  /** The anchor id its first block is marked with. */
  readonly mark: string;
  /** The sentence said in its place when it could not be read. */
  readonly broken: string | null;
}

export interface BookTocEntry {
  readonly text: string;
  readonly depth: number;
  readonly chapter: number;
  /** The anchor id it lands on: its chapter's, or the place inside it. */
  readonly mark: string;
}

export interface Book extends OfficeMarkdown {
  readonly meta: BookMeta;
  readonly opf: string;
  readonly chapters: readonly BookChapter[];
  readonly toc: readonly BookTocEntry[];
  /** Where the contents came from. */
  readonly tocFrom: 'nav' | 'ncx' | 'headings';
  readonly images: readonly OfficeImage[];
  /** A link inside the book, by the number in its `#bkN` key: the anchor it leads to. */
  readonly targets: readonly string[];
  readonly words: number;
  /** Pictures named on the web or by a data address, held back. */
  readonly heldBack: number;
  readonly leftOut: ReadonlySet<string>;
  /** Spine items that are not chapters (a picture read as one is drawn; anything else is named). */
  readonly skipped: number;
  /** Chapters that are not well-formed XHTML, read as a browser would read them. */
  readonly mended: number;
  /** Of those, the chapters cut short where something was never closed (a script, a comment, a tag). */
  readonly truncated: number;
}

export type BookResult =
  | { readonly book: Book }
  /** A seller's lock is on it: nothing of its chapters is read. */
  | { readonly locked: string }
  /** It cannot be read as a book: the archive page shows it, with this sentence. */
  | { readonly fallback: string };

const XHTML = new Set(['application/xhtml+xml', 'text/html', 'application/xml', 'text/xml', 'application/x-dtbook+xml']);
const PICTURE = /^image\//;

export interface BookEntry {
  readonly path: string;
  readonly size: number | null;
  readonly encrypted: boolean;
}

/** The anchor id for a chapter's start. */
export const chapterMark = (i: number): string => `c${i}`;

/**
 * Reads the book whose zip lists `entries`, its parts read by `read`. Never throws for what the file holds: a refusal is a
 * `fallback` with the sentence why, a lock is `locked`.
 */
export async function readEpub(entries: readonly BookEntry[], read: EntryRead): Promise<BookResult> {
  try {
    return await readBook(entries, read);
  } catch (e) {
    if (e instanceof BookError || e instanceof OfficeError) return { fallback: e.message };
    throw e;
  }
}

async function readBook(entries: readonly BookEntry[], read: EntryRead): Promise<BookResult> {
  if (entries.length > BOOK_LIMITS.entries) throw new BookError(`It lists ${entries.length.toLocaleString('en-GB')} entries, more than the ${BOOK_LIMITS.entries.toLocaleString('en-GB')} a book is read from.`);
  const byName = new Map<string, BookEntry>();
  for (const e of entries) if (!byName.has(e.path)) byName.set(e.path, e);
  const lower = new Map<string, string>();
  for (const name of byName.keys()) if (!lower.has(name.toLowerCase())) lower.set(name.toLowerCase(), name);
  // Names in a zip are matched as written, then without regard to case, as readers do for books made on Windows.
  const nameOf = (n: string): string | null => (byName.has(n) ? n : (lower.get(n.toLowerCase()) ?? null));
  const budget = newBudget();
  const parts = bookParts((n) => {
    const at = nameOf(n);
    return at ? read(at) : Promise.resolve(null);
  }, budget);

  const names = new Set(byName.keys());
  let pkg: Awaited<ReturnType<typeof readOpf>> | null = null;
  let pkgError: unknown = null;
  try {
    pkg = await readOpf(parts, await opfPath(parts));
  } catch (e) {
    pkgError = e;
  }
  // A lock is said before anything else: a locked book's package may read, but its chapters are noise.
  const locked = await lockOf(names, parts, pkg?.manifest ?? null);
  if (locked) return { locked };
  if (!pkg) throw pkgError;
  if (pkg.spine.some(({ item }) => byName.get(nameOf(item.path) ?? '')?.encrypted)) {
    return { locked: 'Its chapters are encrypted in the zip itself, with a password the app does not ask for.' };
  }
  const chapterItems = pkg.spine.filter(({ item }) => XHTML.has(item.type) || (item.type === '' && /\.x?html?$/i.test(item.path)));
  const listed = chapterItems.reduce((n, { item }) => n + (byName.get(nameOf(item.path) ?? '')?.size ?? 0), 0);
  if (listed > BOOK_LIMITS.chapterBytes) throw new BookError(`Its chapters unpack to ${Math.round(listed / 1024 / 1024)} MB, more than the ${BOOK_LIMITS.chapterBytes / 1024 / 1024} MB a book is read from.`);

  const images: OfficeImage[] = [];
  const leftOut = new Set<string>();
  const targets: string[] = [];
  const targetKeys = new Map<string, number>();
  // Spine items by name, without regard to case (a link may spell a chapter as the zip does, the OPF otherwise).
  const spineIndex = new Map<string, number>();
  pkg.spine.forEach(({ item }, i) => {
    if (!spineIndex.has(item.path.toLowerCase())) spineIndex.set(item.path.toLowerCase(), i);
  });
  const spineOf = (path: string): number | undefined => spineIndex.get(path.toLowerCase());
  const markOf = (path: string, id: string): string => `${spineOf(path) ?? path}#${id}`;
  const ctx = {
    path: '',
    has: (n: string) => nameOf(n) !== null,
    linkKey(path: string, frag: string | null): string | null {
      const at = spineOf(path);
      if (at === undefined) return null;
      const mark = frag ? markOf(path, frag) : chapterMark(at);
      let n = targetKeys.get(mark);
      if (n === undefined) {
        n = targets.length;
        targets.push(mark);
        targetKeys.set(mark, n);
      }
      return `#bk${n}`;
    },
    markOf,
    images,
    heldBack: 0,
    leftOut,
  };

  const blocks: Block[] = [];
  const chapters: BookChapter[] = [];
  let skipped = 0;
  let mended = 0;
  // A part the spine lists again is shown once, where it is first listed: a spine that names one chapter ten thousand
  // times is one chapter long.
  const seen = new Set<string>();
  for (let i = 0; i < pkg.spine.length; i++) {
    const { item } = pkg.spine[i]!;
    const mark = chapterMark(i);
    if (seen.has(item.path.toLowerCase())) continue;
    seen.add(item.path.toLowerCase());
    const said = (why: string): void => {
      blocks.push({ t: 'mark', id: mark }, { t: 'para', kids: [{ t: 'run', text: why, i: true }] });
      chapters.push({ path: item.path, title: null, words: 0, mark, broken: why });
    };
    if (PICTURE.test(item.type)) {
      blocks.push({ t: 'mark', id: mark });
      images.push({ entry: item.path, alt: '', what: 'picture' });
      blocks.push({ t: 'para', kids: [{ t: 'image', image: images.length - 1 }] });
      chapters.push({ path: item.path, title: null, words: 0, mark, broken: null });
      continue;
    }
    if (!chapterItems.some((c) => c.item === item)) {
      skipped++;
      continue;
    }
    const entry = byName.get(nameOf(item.path) ?? '');
    if (!entry) {
      said(`${item.path} is in the book’s spine but not in the file.`);
      continue;
    }
    if ((entry.size ?? 0) > BOOK_LIMITS.chapterEach) {
      said(`${item.path} is ${Math.round((entry.size ?? 0) / 1024 / 1024)} MB unpacked, over the ${BOOK_LIMITS.chapterEach / 1024 / 1024} MB a chapter is read up to.`);
      continue;
    }
    let html: XmlElement | null;
    try {
      html = await parts.xml(entry.path);
    } catch (strict) {
      // Past the book's budget nothing more is read. A chapter that is not well-formed (an unclosed `<br>`, a bare
      // attribute, a tag closed out of turn) is read again as a browser would; one that fails that too says why.
      if (strict instanceof OfficeLimit || !(strict instanceof OfficeError)) throw strict;
      try {
        html = await parts.xml(entry.path, true);
        mended++;
      } catch (e) {
        if (e instanceof OfficeLimit || !(e instanceof OfficeError)) throw e;
        said(strict.message);
        continue;
      }
    }
    if (!html) {
      said(`${item.path} could not be read.`);
      continue;
    }
    // A lenient read with more than one thing at its top keeps them all, inside and outside a body.
    const body = html.name === LENIENT_ROOT ? html : (find(html, 'body') ?? html);
    ctx.path = item.path;
    const own = chapterBlocks(body, ctx);
    blocks.push({ t: 'mark', id: mark }, ...own);
    chapters.push({ path: item.path, title: chapterTitle(own, html), words: countWords(own), mark, broken: null });
  }
  if (chapters.length === 0) throw new BookError('Its spine names no chapter the app reads as text.');

  // The contents: EPUB 3's nav, else EPUB 2's toc.ncx, else each chapter's first heading.
  let links: TocLink[] = [];
  let tocFrom: Book['tocFrom'] = 'headings';
  const tryToc = async (item: { path: string } | null, how: (root: XmlElement, from: string) => TocLink[]): Promise<boolean> => {
    if (!item) return false;
    try {
      const root = await parts.xml(nameOf(item.path) ?? item.path);
      if (!root) return false;
      links = how(root, item.path);
      return links.length > 0;
    } catch (e) {
      if (e instanceof OfficeLimit || !(e instanceof OfficeError)) throw e;
      return false;
    }
  };
  if (await tryToc(pkg.nav, navLinks)) tocFrom = 'nav';
  else if (await tryToc(pkg.ncx, ncxLinks)) tocFrom = 'ncx';
  const chapterByMark = new Map(chapters.map((c, i) => [c.mark, i]));
  const known = new Set(blocks.flatMap((b) => (b.t === 'mark' ? [b.id] : [])));
  let toc: BookTocEntry[] = [];
  for (const l of links) {
    const at = spineOf(l.path);
    // A spine item listed again is shown where it was first listed.
    const first = at === undefined ? undefined : spineOf(pkg.spine[at]!.item.path);
    const chapter = first === undefined ? undefined : chapterByMark.get(chapterMark(first));
    if (first === undefined || chapter === undefined) continue;
    const frag = l.frag ? markOf(l.path, l.frag) : null;
    toc.push({ text: l.text, depth: l.depth, chapter, mark: frag && known.has(frag) ? frag : chapterMark(first) });
  }
  if (toc.length === 0) {
    tocFrom = 'headings';
    toc = chapters.flatMap((c, i) => (c.broken ? [] : [{ text: c.title ?? c.path.replace(/^.*\//, ''), depth: 0, chapter: i, mark: c.mark }]));
  }

  const written = writeMarkdown({ blocks, notes: [], images });
  return {
    book: {
      ...written,
      meta: pkg.meta,
      opf: pkg.opf,
      chapters,
      toc,
      tocFrom,
      images,
      targets,
      words: chapters.reduce((n, c) => n + c.words, 0),
      heldBack: ctx.heldBack,
      leftOut,
      skipped,
      mended,
      truncated: chapters.filter((c) => parts.truncated.has(nameOf(c.path) ?? c.path)).length,
    },
  };
}

const n = (x: number): string => x.toLocaleString('en-GB');
const plural = (x: number, one: string, many = `${one}s`): string => `${n(x)} ${x === 1 ? one : many}`;

/** The page's first line: what the file is and how much of it there is. */
export function bookHeadLine(b: Book): string {
  const chapters = b.chapters.filter((c) => !c.broken).length;
  return ['Book', plural(chapters, 'chapter'), plural(b.words, 'word')].join(' · ');
}

/** What the page says of itself, folded under its first line. */
export function bookAccount(b: Book): string[] {
  const out = [
    'The chapters as one page, in the book’s own order (its spine), in Marxy’s own type: headings, paragraphs, lists, tables, links and pictures as the book marks them. Its styles, fonts and page layout are left out, and nothing in it runs.',
    b.tocFrom === 'nav'
      ? 'The Outline is the book’s own contents, from its nav document.'
      : b.tocFrom === 'ncx'
        ? 'The Outline is the book’s own contents, from its toc.ncx.'
        : 'The book has no contents of its own that the app could read: the Outline lists each chapter by its first heading.',
  ];
  if (b.images.some((i) => i.what === 'picture')) out.push('Pictures held in the book are drawn, up to 300 of them; a picture over 8 MB, past those, or in a format the page does not draw, shows its alt text.');
  if (b.heldBack > 0) out.push(`${plural(b.heldBack, 'picture')} the book names on the web ${b.heldBack === 1 ? 'is' : 'are'} held back, never fetched.`);
  const broken = b.chapters.filter((c) => c.broken).length;
  if (broken > 0) out.push(`${plural(broken, 'chapter')} could not be read, and ${broken === 1 ? 'says' : 'say'} why where ${broken === 1 ? 'it' : 'they'} would be.`);
  if (b.mended > 0) out.push(`${plural(b.mended, 'chapter')} ${b.mended === 1 ? 'is' : 'are'} not well-formed XHTML, and ${b.mended === 1 ? 'was' : 'were'} read as a browser would read ${b.mended === 1 ? 'it' : 'them'}.`);
  if (b.truncated > 0) out.push(`${plural(b.truncated, 'chapter')} ${b.truncated === 1 ? 'is' : 'are'} truncated: something in ${b.truncated === 1 ? 'it' : 'each'} is never closed, and what follows it is left out.`);
  if (b.skipped > 0) out.push(`${plural(b.skipped, 'part')} of the spine ${b.skipped === 1 ? 'is' : 'are'} not text or a picture, and ${b.skipped === 1 ? 'is' : 'are'} left out.`);
  if (b.leftOut.size > 0) out.push(`Also left out: ${[...b.leftOut].join(', ')}.`);
  out.push('A link inside the book goes to its place on this page; a link to the web opens in your browser when you follow it. Read as reads it as the archive it is packed in. Source shows the file’s bytes.');
  return out;
}
