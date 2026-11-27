// An EPUB as a book (.epub): core reads its parts through the shell's zip reader (its caps, its refusals) and writes its
// chapters as one Markdown page in the spine's order, and the page is that Markdown drawn as any Markdown file is, in
// the reading look, with pictures drawn from the book's own bytes. Its contents are the Outline (go, fold, copy the
// chapter: the verbs that read; nothing here rearranges), the crumbs name the chapter the reading line is in, and the
// place is kept across launches as a text document's is. A link inside the book goes to its place on the page; nothing
// the book names outside itself is fetched. Source is the bytes; every block carries its range in the page's Markdown,
// as the office page's do.
import { bookAccount, bookHeadLine, readEpub, type Book, type BookResult } from '@marxy/core/src/book/index.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { ArchiveEntry, ArchiveListing } from '@marxy/shell-api';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppShell } from '../app-types.ts';
import { accountElement } from '../frame/account.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { el, factRow } from '../frame/dom.ts';
import { notify } from '../notices/index.ts';
import { treeParts } from '../parts/moves.ts';
import { fillOfficePage } from '../render/office-page.ts';
import { byteCard, factsCard } from './cards.ts';
import { fileCardElement } from './card.ts';
import { asItIs } from './exports.ts';
import type { ViewedFile } from './file.ts';
import { createHexView, type HexView } from './hex.ts';
import css from './office.css?inline';
import { PICTURE_BYTES_MOST, PICTURE_MAX, PICTURES_MOST, pictureType, WHAT_WORDS } from './office.ts';
import { pageFind } from './page-find.ts';
import { nextViewerId, viewerChanged } from './signal.ts';
import { tablesReadingCard } from './table-cards.ts';
import type { HexPlace, PaneViewer, PartUnit, ViewerCrumb, ViewerExport, ViewerMemory, ViewerOutline, ViewerOutlineRow, ViewMode } from './types.ts';
import { appendAll } from '@marxy/core/src/util/spread.ts';

export type BookSetup = { readonly book: Book; readonly read: (name: string) => Promise<Uint8Array | null>; readonly entries: ReadonlyMap<string, ArchiveEntry> };

/** The book at `path`, a lock or a fallback (core's sentences), or why it cannot be opened at all. */
export async function openBookFor(shell: AppShell, path: string): Promise<BookSetup | Exclude<BookResult, { book: Book }> | { readonly kicker: string; readonly line: string }> {
  let listing: ArchiveListing | null;
  try {
    listing = await shell.listArchive(path);
  } catch (e) {
    return { kicker: 'A book the app cannot open', line: e instanceof Error ? e.message : String(e) };
  }
  if (!listing || listing.format !== 'zip') return { kicker: 'A book the app cannot open', line: 'Its bytes are not a zip, which every .epub is.' };
  const entries = new Map<string, ArchiveEntry>();
  for (const e of listing.entries) if (e.kind === 'file' && !entries.has(e.path)) entries.set(e.path, e);
  const read = async (name: string): Promise<Uint8Array | null> => {
    const e = entries.get(name);
    return e ? shell.readArchiveEntry(path, e.index, e.path) : null;
  };
  const got = await readEpub(
    [...entries.values()].map((e) => ({ path: e.path, size: e.size, encrypted: e.encrypted })),
    read,
  );
  return 'book' in got ? { book: got.book, read, entries } : got;
}

/** An SVG's text, drawn through `<img>`, where nothing in it runs or is fetched. */
function svgType(b: Uint8Array): string | null {
  const head = new TextDecoder().decode(b.subarray(0, 1024));
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[^]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head.replace(/^﻿/, '')) ? 'image/svg+xml' : null;
}

export interface BookOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  readonly setup: BookSetup;
  readonly paneHost?: HTMLElement;
  readonly place?: { readonly scroll?: { readonly top: number; readonly left: number }; readonly hex?: HexPlace };
  readonly remember?: ViewerMemory;
}

interface Row {
  readonly key: string;
  readonly text: string;
  readonly depth: number;
  /** The page's Markdown bytes it spans. */
  readonly start: number;
  readonly end: number;
  readonly kids: boolean;
}

const words = (s: string): number => s.match(/\S+/g)?.length ?? 0;

export function createBookViewer(o: BookOptions): PaneViewer {
  const { shell, file, setup, remember } = o;
  const { book } = setup;
  const path = file.path;
  adoptRuntimeSheet(document, 'marxy-office-style', css);
  const id = nextViewerId();
  const mdBytes = new TextEncoder().encode(book.markdown);
  // The place is a byte of this page: it stands only while the book makes the same page (FNV-1a over all of it).
  const stamp = ((): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < mdBytes.length; i++) h = Math.imul(h ^ mdBytes[i]!, 0x01000193);
    return `${mdBytes.length}:${(h >>> 0).toString(16)}`;
  })();
  const anchorAt = new Map<string, number>();
  for (const a of book.anchors) if (!anchorAt.has(a.id)) anchorAt.set(a.id, a.at);
  /** Where a mark lands: its own byte, or its chapter's when the place it named was not found. */
  const markAt = (mark: string): number => anchorAt.get(mark) ?? anchorAt.get(`c${mark.replace(/#.*$/, '')}`) ?? 0;

  // The contents, each entry spanning the page from where it lands to the next entry at its depth or above.
  const rows: Row[] = (() => {
    const starts = book.toc.map((e) => markAt(e.mark));
    return book.toc.map((e, i) => {
      let end = mdBytes.length;
      for (let j = i + 1; j < book.toc.length; j++) {
        if (book.toc[j]!.depth <= e.depth && starts[j]! > starts[i]!) {
          end = starts[j]!;
          break;
        }
      }
      return { key: String(i), text: e.text, depth: e.depth, start: starts[i]!, end, kids: (book.toc[i + 1]?.depth ?? -1) > e.depth };
    });
  })();

  let host: HTMLElement | null = null;
  let mode: ViewMode = 'rendered';
  let hex: HexView | null = null;
  let asCard = false;
  let scrollBack = o.place?.scroll?.top ?? null;
  let page: { root: HTMLElement; body: HTMLElement; blocks: HTMLElement[] } | null = null;
  let drawnOnce = false;
  const folded = new Set<string>();
  let foldRev = 0;
  let wordsKept: Map<string, number> | null = null;
  // A place landed on is held there while pictures above it load, until the reader moves.
  let holding: { byteOffset: number; fraction: number } | null = null;
  let readerMoved = false;
  const urls = new Map<string, Promise<string | null>>();
  let pictureBytes = 0;
  let pictureQueue: Promise<unknown> = Promise.resolve();
  const ensureHex = (): HexView => (hex ??= createHexView(file, (offset, length) => shell.readRange(path, offset, length)));
  if (o.place?.hex) ensureHex().restore(o.place.hex);
  const pane = (): HTMLElement | undefined => host?.closest<HTMLElement>('section.marxy-pane') ?? o.paneHost;
  const range = (e: Element): { s: number; e: number } | null => {
    const s = e.getAttribute('data-marxy-s');
    const t = e.getAttribute('data-marxy-e');
    return s === null || t === null ? null : { s: Number(s), e: Number(t) };
  };
  const slice = (s: number, e: number): string => new TextDecoder().decode(mdBytes.subarray(s, e)).trim();

  /** The index of the first top-level block at or after byte `at`. */
  function blockIndexAt(at: number): number {
    const blocks = page?.blocks ?? [];
    let lo = 0;
    let hi = blocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((range(blocks[mid]!)?.s ?? 0) < at) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  const blockAt = (at: number): HTMLElement | null => page?.blocks[blockIndexAt(at)] ?? null;

  // ---- links ---------------------------------------------------------------------------------------------------------

  function follow(a: HTMLAnchorElement): void {
    const href = a.getAttribute('href') ?? '';
    const inside = /^#bk(\d+)$/.exec(href);
    if (inside) {
      const target = book.targets[Number(inside[1])];
      if (target !== undefined) goTo(markAt(target));
      return;
    }
    if (/^(?:https?|mailto):/i.test(href)) {
      if (shell.openExternal) void shell.openExternal(href);
      else notify({ kind: 'info', text: `${href} would open in your browser.` }, { pane: pane() });
      return;
    }
    notify({ kind: 'refused', text: `${href || 'That link'} leads nowhere in this book · nothing was opened.` }, { pane: pane() });
  }

  /** Brings the block at byte `at` to the top of the page, unfolding what hides it. */
  function goTo(at: number): void {
    const b = blockAt(at);
    if (!b || !page) return;
    if (b.hidden) {
      for (const r of rows) if (folded.has(r.key) && r.start < at && at < r.end) folded.delete(r.key);
      applyFolds();
    }
    holding = null;
    readerMoved = true;
    page.root.scrollTop += b.getBoundingClientRect().top - page.root.getBoundingClientRect().top;
  }

  // ---- the place -----------------------------------------------------------------------------------------------------

  /** The first block on screen and how far through it the top of the page is. */
  function placeNow(): { byteOffset: number; fraction: number } | null {
    if (!page) return null;
    const top = page.root.getBoundingClientRect().top;
    const blocks = page.blocks;
    let lo = 0;
    let hi = blocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid]!.getBoundingClientRect().bottom <= top) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (b.hidden) continue;
      const box = b.getBoundingClientRect();
      const r = range(b);
      if (!r) continue;
      return { byteOffset: r.s, fraction: box.height > 0 ? Math.min(1, Math.max(0, (top - box.top) / box.height)) : 0 };
    }
    return null;
  }

  function landOn(place: { byteOffset: number; fraction: number }): void {
    const b = blockAt(place.byteOffset);
    if (!b || !page) return;
    const box = b.getBoundingClientRect();
    page.root.scrollTop += box.top - page.root.getBoundingClientRect().top + place.fraction * box.height;
  }

  let noteFrame = 0;
  let chapterNow = '';
  /** A frame after a scroll: the place is kept, and the Outline's dot moves when the chapter does. */
  function noted(): void {
    if (noteFrame) return;
    noteFrame = requestAnimationFrame(() => {
      noteFrame = 0;
      const p = mode === 'rendered' && !asCard ? placeNow() : null;
      if (!p) return;
      remember?.note(p, stamp);
      const at = chainRows().map((r) => r.key).join('/');
      if (at !== chapterNow) {
        chapterNow = at;
        viewerChanged();
      }
    });
  }

  // ---- the page ------------------------------------------------------------------------------------------------------

  function standIn(image: number, why?: string): HTMLElement {
    const img = book.images[image];
    const box = el('span', 'marxy-office-stand');
    box.append(el('span', 'marxy-office-stand-what', img ? WHAT_WORDS[img.what] : 'Picture'));
    if (img?.alt) box.append(': ', el('span', '', img.alt));
    else if (img?.what === 'picture') box.append(' ', el('span', 'marxy-office-stand-none', 'with no alt text'));
    if (why) box.append(el('span', 'marxy-office-stand-none', ` · ${why}`));
    return box;
  }

  function pictureUrl(name: string, size: number): Promise<string | null> | 'too many' {
    const kept = urls.get(name);
    if (kept) return kept;
    if (urls.size >= PICTURES_MOST || pictureBytes + size > PICTURE_BYTES_MOST) return 'too many';
    pictureBytes += size;
    const made = pictureQueue.then(async () => {
      const bytes = await setup.read(name).catch(() => null);
      const type = bytes ? (pictureType(bytes) ?? svgType(bytes)) : null;
      return bytes && type ? URL.createObjectURL(new Blob([bytes as BlobPart], { type })) : null;
    });
    pictureQueue = made.catch(() => null);
    urls.set(name, made);
    return made;
  }

  function drawPicture(stand: HTMLElement, img: HTMLImageElement, image: number): void {
    const want = book.images[image];
    const entry = want?.entry ? setup.entries.get(want.entry) : undefined;
    if (!want || !entry || (entry.size ?? 0) > PICTURE_MAX) return;
    const url = pictureUrl(entry.path, entry.size ?? 0);
    if (url === 'too many') {
      stand.replaceWith(standIn(image, 'not drawn: the book holds too many pictures to draw them all'));
      return;
    }
    void url.then((src) => {
      if (!src || !stand.isConnected) return;
      img.src = src;
      img.alt = want.alt;
      if (want.alt) img.title = want.alt;
      img.addEventListener('load', () => {
        if (holding) landOn(holding);
      }, { once: true });
      stand.replaceWith(img);
    });
  }

  function pictures(body: HTMLElement): void {
    for (const { img, image } of fillOfficePage(body, book.markdown, path)) {
      const alone = img.parentElement?.localName === 'p' && img.parentElement.childNodes.length === 1;
      if (alone) img.parentElement!.classList.add('marxy-office-figure');
      img.classList.add('marxy-office-pic');
      const stand = standIn(image);
      img.replaceWith(stand);
      drawPicture(stand, img, image);
    }
  }

  function documentPage(): HTMLElement {
    const root = el('div', 'marxy-office marxy-book');
    root.tabIndex = -1;
    const article = el('article', 'marxy-article marxy-office-doc');
    const account = accountElement(bookAccount(book), bookHeadLine(book));
    if (account) article.append(account);
    const holder = el('div');
    pictures(holder);
    const blocks = [...holder.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute('data-marxy-s'));
    appendAll(article, holder.childNodes);
    article.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!a || !article.contains(a) || a.closest('.marxy-account')) return;
      e.preventDefault();
      follow(a as HTMLAnchorElement);
    });
    root.addEventListener('scroll', noted, { passive: true });
    const moved = (): void => {
      holding = null;
      readerMoved = true;
    };
    root.addEventListener('wheel', moved, { passive: true });
    root.addEventListener('pointerdown', moved);
    root.addEventListener('keydown', moved);
    root.append(article);
    page = { root, body: article, blocks };
    wordsKept = null;
    return root;
  }

  function applyFolds(): void {
    if (!page) return;
    for (const b of page.blocks) {
      b.hidden = false;
      b.classList.remove('marxy-book-shut');
    }
    for (const r of rows) {
      if (!folded.has(r.key)) continue;
      const head = blockIndexAt(r.start);
      page.blocks[head]?.classList.add('marxy-book-shut');
      for (let i = head + 1; i < page.blocks.length; i++) {
        const b = page.blocks[i]!;
        if ((range(b)?.s ?? 0) >= r.end) break;
        b.hidden = true;
      }
    }
    foldRev++;
    viewerChanged();
  }

  function setCard(on: boolean): void {
    asCard = on;
    draw();
    viewerChanged();
  }

  function draw(): void {
    if (!host) return;
    const top = scrollBack ?? page?.root.scrollTop ?? null;
    scrollBack = null;
    page = null;
    finder.clear();
    if (mode === 'source' || asCard) {
      const view = ensureHex();
      if (mode === 'source') {
        const pageEl = el('div', 'marxy-hexpage');
        pageEl.append(view.el);
        host.replaceChildren(pageEl);
      } else {
        const pageEl = el('div', 'marxy-fcpage');
        const side = el('div', 'marxy-fchex');
        side.append(view.el);
        pageEl.append(fileCardElement({ shell, file, back: { words: 'Show the book instead', run: () => setCard(false) } }, () => pane()), side);
        host.replaceChildren(pageEl);
      }
      requestAnimationFrame(() => view.draw());
      return;
    }
    const root = documentPage();
    host.replaceChildren(root);
    if (folded.size > 0) applyFolds();
    if (top !== null) root.scrollTop = top;
    else if (!drawnOnce && remember) {
      // The place kept from an earlier reading of this book, as a text document's is, unless the reader has moved since.
      // Asked for after the page has painted: nothing is read for it on the way to the first text.
      const memory = remember;
      requestAnimationFrame(() =>
        setTimeout(() => {
          if (!page || page.root !== root) return;
          void memory.stored(mdBytes.length, stamp).then((kept) => {
            if (!kept || readerMoved || !page || page.root !== root) return;
            holding = kept;
            landOn(kept);
          });
        }, 0),
      );
    }
    drawnOnce = true;
  }

  const finder = pageFind(() => page);

  // ---- the contents, the crumbs and the cursor's parts ---------------------------------------------------------------

  /** Words in a row's part of the page, as the page shows them. */
  function rowWords(r: Row): number {
    if (!page) return 0;
    wordsKept ??= new Map();
    const kept = wordsKept.get(r.key);
    if (kept !== undefined) return kept;
    let n = 0;
    for (let i = blockIndexAt(r.start); i < page.blocks.length; i++) {
      const b = page.blocks[i]!;
      if ((range(b)?.s ?? 0) >= r.end) break;
      n += words(b.textContent ?? '');
    }
    wordsKept.set(r.key, n);
    return n;
  }

  const LEVELS = ['1', '2', '3'];
  const outline: ViewerOutline = {
    word: 'chapters',
    get rows(): readonly ViewerOutlineRow[] {
      return rows.map((r) => ({
        key: r.key,
        text: r.text,
        depth: r.depth,
        kids: r.kids,
        get words() {
          return rowWords(r);
        },
        el: () => blockAt(r.start),
        go: () => goTo(r.start),
        fold: () => {
          if (folded.has(r.key)) folded.delete(r.key);
          else folded.add(r.key);
          applyFolds();
        },
        copy: () => ({ text: slice(r.start, r.end), as: `Copied “${r.text}” as Markdown` }),
      }));
    },
    level() {
      if (folded.size === 0) return 'all';
      for (const lv of LEVELS) {
        const want = rows.filter((r) => r.depth === Number(lv) - 1).map((r) => r.key);
        if (want.length === folded.size && want.every((k) => folded.has(k))) return lv;
      }
      return null;
    },
    setLevel(lv) {
      folded.clear();
      if (lv !== 'all') for (const r of rows) if (r.depth === Number(lv) - 1) folded.add(r.key);
      applyFolds();
    },
  };

  /** The rows the reading line is under, outermost first. */
  function chainRows(): Row[] {
    const here = placeNow()?.byteOffset;
    if (here === undefined) return [];
    const out: Row[] = [];
    for (let d = 0; ; d++) {
      const outer = out[out.length - 1];
      let best: Row | null = null;
      for (const r of rows) {
        if (r.depth !== d || r.start > here || here >= r.end) continue;
        if (outer && (r.start < outer.start || r.start >= outer.end)) continue;
        if (!best || r.start >= best.start) best = r;
      }
      if (!best) return out;
      out.push(best);
    }
  }

  function chain(): readonly ViewerCrumb[] {
    if (mode !== 'rendered' || asCard || !page) return [];
    const got = chainRows();
    return got.map((r, i) => ({
      key: r.key,
      text: r.text,
      beside: () => {
        const outer = got[i - 1];
        return rows
          .filter((x) => x.depth === r.depth && (!outer || (x.start >= outer.start && x.start < outer.end)))
          .map((x) => ({ title: x.text, here: x === r, go: () => goTo(x.start) }));
      },
    }));
  }

  function documentParts(): ReturnType<typeof treeParts> | null {
    if (!page) return null;
    const blocks = page.blocks;
    const top: PartUnit[] = [];
    book.chapters.forEach((c, n) => {
      if (c.broken) return;
      const start = markAt(c.mark);
      const next = book.chapters.slice(n + 1).find((x) => !x.broken);
      const end = next ? markAt(next.mark) : mdBytes.length;
      const address = `#chapter=${n + 1}`;
      const kids: PartUnit[] = [];
      for (let i = blockIndexAt(start); i < blocks.length; i++) {
        const b = blocks[i]!;
        const r = range(b);
        if (!r || r.s >= end) break;
        const k = kids.length + 1;
        kids.push({ id: `${address}/${k}`, label: /^h[1-6]$/.test(b.localName) ? 'heading' : b.localName === 'p' ? 'paragraph' : b.localName, address: `${address}/${k}`, el: () => b, stored: () => slice(r.s, r.e) });
      }
      const first = kids[0];
      if (!first) return;
      top.push({ id: address, label: c.title ?? `Chapter ${n + 1}`, address, el: () => first.el(), children: kids, stored: () => slice(start, end) });
    });
    return treeParts(top, {
      readOnly: true,
      start() {
        const view = page?.root.getBoundingClientRect().top ?? 0;
        return top.find((u) => (u.el()?.getBoundingClientRect().bottom ?? 0) > view) ?? top[0] ?? null;
      },
    });
  }

  // ---- the panel -----------------------------------------------------------------------------------------------------

  const readingCardDef = tablesReadingCard({
    file,
    shownAs: () => (asCard && mode === 'rendered' ? 'a file card and the bytes' : 'a book as one page · epub'),
    tiers: [
      { name: 'The book, as one page', words: 'in the reading look' },
      { name: 'The bytes', words: 'when it will not read' },
    ],
    at: () => (asCard ? 1 : 0),
    caps: ['chapters up to 16 MB each, read through the zip reader; 128 MB of XHTML in all; 20,000 entries', 'pictures up to 8 MB each, 300 and 64 MB in all', 'nothing the book names on the web is fetched', 'scripts never run'],
    ways: () => (mode !== 'rendered' ? [] : [asCard ? { words: 'Show the book instead', run: () => setCard(false) } : { words: 'Show the file card and the bytes instead', run: () => setCard(true) }]),
  });

  const aboutCard: CardDef = {
    id: 'frontmatter',
    title: () => 'Book',
    detail: () => 'from the book’s own fields',
    relevant: () => true,
    render(body) {
      const m = book.meta;
      const n = (x: number): string => x.toLocaleString('en-GB');
      if (m.title) body.append(factRow('title', m.title));
      if (m.creators.length > 0) body.append(factRow(m.creators.length === 1 ? 'author' : 'authors', m.creators.join(', ')));
      if (m.publisher) body.append(factRow('publisher', m.publisher));
      if (m.date) body.append(factRow('date', m.date));
      if (m.language) body.append(factRow('language', m.language));
      body.append(factRow('chapters', n(book.chapters.filter((c) => !c.broken).length)));
      body.append(factRow('words', n(book.words), 'Counted here from the text shown'));
      body.append(factRow('contents', book.tocFrom === 'nav' ? 'its nav document' : book.tocFrom === 'ncx' ? 'its toc.ncx' : 'none of its own: the chapters’ headings'));
      const pics = book.images.filter((i) => i.what === 'picture').length;
      if (pics) body.append(factRow('pictures', n(pics)));
      if (m.version) body.append(factRow('EPUB', m.version));
      if (m.identifier) body.append(factRow('identifier', m.identifier));
      if (m.description) body.append(factRow('about', m.description.length > 400 ? `${m.description.slice(0, 400)}…` : m.description));
    },
  };

  const facts = factsCard(file);
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });

  function exports(): ViewerExport[] {
    const name = basename(path).replace(/\.[^.]+$/, '');
    return [
      { ...asItIs(shell, file, 'file'), name: 'The book, as it is' },
      { id: 'markdown', name: `${name} as Markdown`, sub: 'the chapters as this page shows them', extension: 'md', build: async () => ({ bytes: mdBytes, preview: book.markdown.slice(0, 4000) }) },
    ];
  }

  return {
    path,
    kind: 'book',
    group: 'prose',
    binary: true,
    owns: () => true,
    show(m, into) {
      mode = m;
      host = into;
      into.setAttribute('data-marxy-viewer', 'book');
      draw();
    },
    hide() {
      finder.clear();
      host = null;
      page = null;
    },
    cards: () => (asCard ? { reading: readingCardDef, facts } : { reading: readingCardDef, frontmatter: aboutCard, facts }),
    passing: (m) => (m === 'source' || asCard ? [byte] : []),
    headSay: () => null,
    key: (e, m) => (m === 'source' || asCard ? (hex?.key(e) ?? false) : false),
    parts: (m) => (m === 'source' || asCard ? ensureHex().parts() : documentParts()),
    find: (m) => (m === 'rendered' && !asCard ? finder : null),
    floor: { on: () => asCard, set: (on) => setCard(on) },
    panelKey: () => `${id}:${mode}:${asCard}:${foldRev}:${hex?.selected() ?? ''}`,
    outline: () => (mode === 'rendered' && !asCard && rows.length > 0 ? outline : null),
    chain,
    place() {
      return { hex: hex?.place(), scroll: mode === 'rendered' && !asCard && page ? { top: page.root.scrollTop, left: 0 } : undefined };
    },
    land(at) {
      ensureHex().restore({ selected: at, top: null });
      return mode === 'rendered' && asCard ? 'rendered' : 'source';
    },
    exports: (m) => (m === 'rendered' ? exports() : [asItIs(shell, file, 'file')]),
    destroy() {
      finder.clear();
      if (noteFrame) cancelAnimationFrame(noteFrame);
      for (const url of urls.values()) void url.then((u) => u && URL.revokeObjectURL(u));
      urls.clear();
      hex?.destroy();
      hex = null;
      host = null;
      page = null;
    },
  };
}
