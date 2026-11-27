// A Word document or a deck (.docx, .pptx, .odt, .odp) as a page of text: core reads its parts through the shell's zip
// reader (its caps, its refusals) and writes it as Markdown, and the page is that Markdown drawn as any Markdown file is,
// in the reading look, with comments and speaker notes set apart beside the text they belong to, a slide's number hung
// in the margin of its heading, and pictures drawn from the file's own bytes. Nothing the file names outside itself is
// fetched; a link is followed only when the reader follows it. Source is the bytes. The cursor walks the sections (a
// heading and what follows it, or a slide) and their blocks. An RTF file is text, read from the store's bytes: Source is
// the text views', and the page's elements name the file's own bytes. A Word 97-2003 document or deck (.doc, .ppt) is a
// compound file the shell reads into the same blocks; Source is its bytes, as a .docx's.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { isDeck, isLegacy, officeAccount, officeFormatOf, officeHeadLine, OfficeError, readLegacyOffice, readOffice, readRtfOffice, sourceRangeOf, startsAsRtf, FORMAT_WORDS, LEGACY_FILE_MAX, OFFICE_LIMITS, RTF_LIMITS, type OfficeReading } from '@marxy/core/src/office/index.ts';
import type { ArchiveEntry, ArchiveListing } from '@marxy/shell-api';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppShell } from '../app-types.ts';
import { appHandle } from '../commands/app-handle.ts';
import { bufferOffset, heldEncoding } from '../document/encoding.ts';
import { accountElement } from '../frame/account.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { el, factRow } from '../frame/dom.ts';
import { notify } from '../notices/index.ts';
import { treeParts } from '../parts/moves.ts';
import { guardLongRuns } from '../render/long-runs.ts';
import { fillOfficePage } from '../render/office-page.ts';
import { LINK_MALFORMED, localLinkTarget } from '../selection/link-target.ts';
import { byteCard, factsCard } from './cards.ts';
import { fileCardElement } from './card.ts';
import { asItIs } from './exports.ts';
import { dateWords, type ViewedFile } from './file.ts';
import { createHexView, type HexView } from './hex.ts';
import css from './office.css?inline';
import { pageFind } from './page-find.ts';
import { nextViewerId, viewerChanged } from './signal.ts';
import { tablesReadingCard } from './table-cards.ts';
import type { PaneViewer, PartUnit, ViewerExport, ViewerFind, ViewMode } from './types.ts';

/** A picture larger than this shows its alt text: the page is for reading, not for a scan's full resolution. */
export const PICTURE_MAX = 8 * 1024 * 1024;
/** Pictures drawn on one page, and their bytes in all: past either, the rest are named, not drawn. */
export const PICTURES_MOST = 300;
export const PICTURE_BYTES_MOST = 64 * 1024 * 1024;

export interface OfficeSetup {
  readonly reading: OfficeReading;
  readonly read: (name: string) => Promise<Uint8Array | null>;
  readonly entries: ReadonlyMap<string, ArchiveEntry>;
  /** For an RTF file read from a store that decoded it: the store's byte for each of the file's. */
  readonly toBuffer?: (f: number) => number;
}

/** The file at `path` read as a document, or why it cannot be. Its parts come through the shell's zip reader. */
export async function openOfficeFor(shell: AppShell, path: string, size?: number): Promise<OfficeSetup | { readonly kicker: string; readonly line: string }> {
  const format = officeFormatOf(path);
  if (!format) return { kicker: 'No reading for this file', line: 'Its name is not a .docx, .pptx, .odt, .odp, .rtf, .doc or .ppt.' };
  if (isLegacy(format)) {
    const cannot = (line: string): { kicker: string; line: string } => ({ kicker: `A ${FORMAT_WORDS[format]} the app cannot read`, line });
    if (!shell.officeFromOle) return cannot('This build has no reader for Word 97-2003 documents and decks.');
    const mb = 1024 * 1024;
    if (size !== undefined && size > LEGACY_FILE_MAX) return cannot(`It is ${Math.ceil(size / mb)} MB, past the ${LEGACY_FILE_MAX / mb} MB read as a document.`);
    try {
      // The file is read whole and handed over as bytes: the shell's reader walks the compound file in memory.
      return { reading: readLegacyOffice(await shell.officeFromOle(await shell.readFile(path))), read: async () => null, entries: new Map() };
    } catch (e) {
      return cannot(e instanceof Error ? e.message : String(e));
    }
  }
  if (format === 'rtf') {
    // A large file under the name that is not RTF is said to be so from its head, not read whole first.
    const head = await shell.readHead(path, 16).catch(() => null);
    if (head && !startsAsRtf(head)) return { kicker: `A ${FORMAT_WORDS.rtf} the app cannot read`, line: 'Its bytes do not start with {\\rtf, as every RTF file does.' };
    return openRtfFrom(() => shell.readFile(path));
  }
  let listing: ArchiveListing | null;
  try {
    listing = await shell.listArchive(path);
  } catch (e) {
    return { kicker: `A ${FORMAT_WORDS[format]} the app cannot open`, line: e instanceof Error ? e.message : String(e) };
  }
  if (!listing || listing.format !== 'zip') return { kicker: `A ${FORMAT_WORDS[format]} the app cannot open`, line: `Its bytes are not a zip, which every .${format} is.` };
  // Office part names are matched without regard to case.
  const entries = new Map<string, ArchiveEntry>();
  for (const e of listing.entries) if (e.kind === 'file') entries.set(e.path.toLowerCase(), e);
  const read = async (name: string): Promise<Uint8Array | null> => {
    const e = entries.get(name.toLowerCase());
    return e ? shell.readArchiveEntry(path, e.index, e.path) : null;
  };
  try {
    return { reading: await readOffice(format, read), read, entries };
  } catch (e) {
    if (e instanceof OfficeError) return { kicker: `A ${FORMAT_WORDS[format]} the app cannot read`, line: e.message };
    return { kicker: `A ${FORMAT_WORDS[format]} the app cannot read`, line: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The bytes an RTF file is read from: the file's own, which the store holds as they are for a UTF-8 file and decodes for
 * one in a legacy encoding (its bytes above 7F are in the RTF's code page, not the store's guess), with the store's byte
 * for each of them.
 */
export function rtfSourceOf(path: string | null, text: Uint8Array): { readonly bytes: Uint8Array; readonly toBuffer?: (f: number) => number; readonly storeText: boolean } {
  const held = heldEncoding(path);
  // A store edited since it was read no longer matches the file's bytes: it is read as it stands.
  if (!held || !sameBytes(held.text, text)) return { bytes: text, storeText: true };
  return { bytes: held.raw, toBuffer: (f) => bufferOffset(path, text, f), storeText: false };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** An RTF file read from `text` (the store's bytes when `path` is given, else the file's), or why it cannot be. */
export async function openRtfFrom(text: () => Uint8Array | Promise<Uint8Array>, path: string | null = null): Promise<OfficeSetup | { readonly kicker: string; readonly line: string }> {
  try {
    const held = await text();
    // Read from disk (no store), the bytes are the file's own.
    const src = path === null ? { bytes: held, storeText: false } : rtfSourceOf(path, held);
    return { reading: readRtfOffice(src.bytes, { storeText: src.storeText }), read: async () => null, entries: new Map(), toBuffer: src.toBuffer };
  } catch (e) {
    return { kicker: `A ${FORMAT_WORDS.rtf} the app cannot read`, line: e instanceof Error ? e.message : String(e) };
  }
}

/** "9 Oct 2026, 16:10" from the file's own ISO time, or the text as written. */
export function whenWords(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(ms) ? iso : dateWords(ms + new Date(ms).getTimezoneOffset() * 60_000);
}

/** The type a picture's bytes say they are, when it is one the webview draws. */
export function pictureType(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export const WHAT_WORDS = { picture: 'Picture', 'held picture': 'Picture, not drawn', 'linked picture': 'Linked picture, not fetched', chart: 'Chart, not drawn', diagram: 'Diagram, not drawn', object: 'Embedded object, not shown' } as const;

export interface OfficeOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  readonly setup: OfficeSetup;
  readonly paneHost?: HTMLElement;
  readonly place?: { readonly scroll?: { readonly top: number; readonly left: number }; readonly hex?: import('./types.ts').HexPlace };
  /** For an RTF file, which is text: its bytes as Source holds them, read again when they change. */
  readonly text?: () => Uint8Array;
}

export function createOfficeViewer(o: OfficeOptions): PaneViewer {
  const { shell, file, setup } = o;
  let { reading } = setup;
  const path = file.path;
  const deck = isDeck(reading.doc.format);
  // An RTF file is text: Source is its own lines, and the page's elements name bytes of the file, not of the Markdown.
  const rtf = reading.doc.format === 'rtf';
  // An RTF file content detection called binary (raw bytes after `\bin`) has no store: Source is its bytes, as a .docx's.
  const textual = rtf && o.text !== undefined;
  let toBuffer = setup.toBuffer ?? ((f: number) => f);
  // The Markdown bytes each element was rendered from, where its own attributes now name the file's.
  let mdRanges = new WeakMap<Element, { s: number; e: number }>();
  adoptRuntimeSheet(document, 'marxy-office-style', css);
  const id = nextViewerId();
  const enc = new TextEncoder();
  let mdBytes = enc.encode(reading.markdown);
  let host: HTMLElement | null = null;
  let mode: ViewMode = 'rendered';
  let hex: HexView | null = null;
  let asCard = false;
  let scrollBack = o.place?.scroll?.top ?? null;
  let page: { root: HTMLElement; body: HTMLElement } | null = null;
  // One picture's address per zip entry, however many times the document shows it; the bytes taken so far.
  const urls = new Map<string, Promise<string | null>>();
  let pictureBytes = 0;
  // Pictures are read one after another, never all at once.
  let pictureQueue: Promise<unknown> = Promise.resolve();
  const ensureHex = (): HexView => (hex ??= createHexView(file, (offset, length) => shell.readRange(path, offset, length)));
  if (o.place?.hex) ensureHex().restore(o.place.hex);
  const pane = (): HTMLElement | undefined => host?.closest<HTMLElement>('section.marxy-pane') ?? o.paneHost;

  const range = (e: Element): { s: number; e: number } | null => {
    const s = e.getAttribute('data-marxy-s');
    const t = e.getAttribute('data-marxy-e');
    return s === null || t === null ? null : { s: Number(s), e: Number(t) };
  };
  const mdRange = (e: Element): { s: number; e: number } | null => mdRanges.get(e) ?? (rtf ? null : range(e));
  const slice = (s: number, e: number): string => new TextDecoder().decode(mdBytes.subarray(s, e)).trim();

  /** Every element's range made the file's bytes: its blocks', or the nearest block's around it. */
  function mapToFile(holder: HTMLElement): void {
    mdRanges = new WeakMap();
    for (const e of holder.querySelectorAll('*')) {
      const r = range(e);
      let to: { s: number; e: number } | null = null;
      if (r) {
        mdRanges.set(e, r);
        const f = sourceRangeOf(reading.spans, r.s, r.e);
        to = f && { s: toBuffer(f.s), e: toBuffer(f.e) };
      } else {
        // A stand-in for a picture, or another element the page made: the range of what it sits in, already mapped.
        const up = e.parentElement?.closest('[data-marxy-s]');
        to = up && holder.contains(up) ? range(up) : null;
      }
      if (!to) continue;
      e.setAttribute('data-marxy-s', String(to.s));
      e.setAttribute('data-marxy-e', String(to.e));
    }
  }

  // ---- links -------------------------------------------------------------------------------------------------------------

  function follow(a: HTMLAnchorElement): void {
    const href = a.getAttribute('href') ?? '';
    const refuse = (text: string): void => void notify({ kind: 'refused', text }, { pane: pane() });
    if (href.startsWith('#')) {
      let id: string;
      try {
        id = decodeURIComponent(href.slice(1));
      } catch {
        return refuse(LINK_MALFORMED);
      }
      page?.body.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
      return;
    }
    if (/^(?:https?|mailto):/i.test(href)) {
      if (shell.openExternal) void shell.openExternal(href);
      else notify({ kind: 'info', text: `${href} would open in your browser.` }, { pane: pane() });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href === '') return refuse(`${href || 'That link'} uses a scheme Marxy does not open · nothing was opened.`);
    // A relative link: the Markdown page's rule decides where it leads, and whether it may be followed at all.
    const handle = appHandle();
    if (!handle) return;
    const local = localLinkTarget(path, href, handle.imageRoot(path));
    if ('refused' in local) return refuse(local.refused);
    void handle.open(local.target);
  }

  // ---- the page ----------------------------------------------------------------------------------------------------------

  function standIn(image: number, why?: string): HTMLElement {
    const img = reading.doc.images[image];
    const box = el('span', 'marxy-office-stand');
    box.append(el('span', 'marxy-office-stand-what', img ? WHAT_WORDS[img.what] : 'Picture'));
    if (img?.alt) box.append(': ', el('span', '', img.alt));
    else if (img?.what === 'picture') box.append(' ', el('span', 'marxy-office-stand-none', 'with no alt text'));
    if (why) box.append(el('span', 'marxy-office-stand-none', ` · ${why}`));
    return box;
  }

  /** The address of entry `name`'s picture, read once and kept; null when it is not a picture the page draws. */
  function pictureUrl(name: string, size: number): Promise<string | null> | 'too many' {
    const key = name.toLowerCase();
    const kept = urls.get(key);
    if (kept) return kept;
    if (urls.size >= PICTURES_MOST || pictureBytes + size > PICTURE_BYTES_MOST) return 'too many';
    pictureBytes += size;
    const made = pictureQueue.then(async () => {
      const bytes = await setup.read(name).catch(() => null);
      const type = bytes ? pictureType(bytes) : null;
      return bytes && type ? URL.createObjectURL(new Blob([bytes as BlobPart], { type })) : null;
    });
    pictureQueue = made.catch(() => null);
    urls.set(key, made);
    return made;
  }

  /** Puts the picture in place of its stand-in once its bytes are read and are a picture the webview draws. */
  function drawPicture(stand: HTMLElement, img: HTMLImageElement, image: number): void {
    const want = reading.doc.images[image];
    const entry = want?.entry ? setup.entries.get(want.entry.toLowerCase()) : undefined;
    if (!want || !entry || (entry.size ?? 0) > PICTURE_MAX) return;
    const url = pictureUrl(entry.path, entry.size ?? 0);
    if (url === 'too many') {
      stand.replaceWith(standIn(image, 'not drawn: the document holds too many pictures to draw them all'));
      return;
    }
    void url.then((src) => {
      if (!src || !stand.isConnected) return;
      img.src = src;
      img.alt = want.alt;
      if (want.alt) img.title = want.alt;
      stand.replaceWith(img);
    });
  }

  /** Each picture: a line naming it, which the picture itself replaces when it can be drawn from the file. */
  function pictures(body: HTMLElement): void {
    for (const { img, image } of fillOfficePage(body, reading.markdown, path)) {
      const alone = img.parentElement?.localName === 'p' && img.parentElement.childNodes.length === 1;
      if (alone) img.parentElement!.classList.add('marxy-office-figure');
      img.classList.add('marxy-office-pic');
      const stand = standIn(image);
      img.replaceWith(stand);
      drawPicture(stand, img, image);
    }
  }

  /** Comments and speaker notes: their blocks gathered into an aside headed by who wrote them. */
  function asides(body: HTMLElement): void {
    const blocks = [...body.children];
    for (const a of reading.asides) {
      const inside = blocks.filter((b) => {
        const r = range(b);
        return r !== null && r.s >= a.start && r.e <= a.end;
      });
      if (inside.length === 0) continue;
      const aside = el('aside', deck ? 'marxy-office-aside marxy-office-notes' : 'marxy-office-aside');
      aside.setAttribute('data-marxy-s', String(a.start));
      aside.setAttribute('data-marxy-e', String(a.end));
      const who = el('p', 'marxy-office-who');
      who.append(el('span', 'marxy-office-who-name', a.who));
      const when = whenWords(a.when);
      if (when) who.append(el('span', 'marxy-office-who-when', ` · ${when}`));
      inside[0]!.before(aside);
      aside.append(who, ...inside);
    }
  }

  function slideNumbers(body: HTMLElement): void {
    for (const s of reading.slides) {
      const h = body.querySelector<HTMLElement>(`:scope > [data-marxy-s="${s.at}"]`);
      if (!h) continue;
      h.classList.add('marxy-office-slide');
      const no = el('span', s.hidden ? 'marxy-office-no marxy-office-no-hidden' : 'marxy-office-no', String(s.n));
      no.title = s.hidden ? `Slide ${s.n}, hidden when the deck is shown` : `Slide ${s.n}`;
      h.prepend(no);
      if (!s.title) h.classList.add('marxy-office-untitled');
    }
  }

  function documentPage(): HTMLElement {
    const root = el('div', 'marxy-office');
    root.tabIndex = -1;
    const article = el('article', 'marxy-article marxy-office-doc');
    const account = accountElement(officeAccount(reading), officeHeadLine(reading));
    if (account) article.append(account);
    for (const words of reading.doc.cut ?? []) article.append(el('p', 'marxy-office-cut', words));
    // Drawn apart, then moved in: the page's blocks are the article's own children, as a Markdown page's are, so the
    // article's rules (`.marxy-article > ol`, a paragraph after a paragraph) hold for them.
    const holder = el('div');
    pictures(holder);
    slideNumbers(holder);
    asides(holder);
    if (rtf) mapToFile(holder);
    // A run with no space in it (a long URL, base64, an unspaced script) gets places to break, as a Markdown page's does.
    guardLongRuns(holder);
    article.append(...holder.childNodes);
    article.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!a || !article.contains(a) || a.closest('.marxy-account')) return;
      e.preventDefault();
      follow(a as HTMLAnchorElement);
    });
    root.append(article);
    page = { root, body: article };
    return root;
  }

  function setCard(on: boolean): void {
    asCard = on;
    draw();
    viewerChanged();
  }

  function draw(): void {
    if (!host) return;
    const top = scrollBack ?? page?.root.scrollTop ?? 0;
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
        pageEl.append(fileCardElement({ shell, file, back: { words: deck ? 'Show the slides instead' : 'Show the document instead', run: () => setCard(false) } }, () => pane()), side);
        host.replaceChildren(pageEl);
      }
      requestAnimationFrame(() => view.draw());
      return;
    }
    const root = documentPage();
    host.replaceChildren(root);
    root.scrollTop = top;
  }

  // ---- find --------------------------------------------------------------------------------------------------------------

  const finder: ViewerFind = pageFind(() => page);

  // ---- parts -------------------------------------------------------------------------------------------------------------

  const wordFor = (e: Element): string => {
    if (e.classList.contains('marxy-office-aside')) return deck ? 'notes' : 'comment';
    if (e.classList.contains('marxy-office-figure')) return 'picture';
    switch (e.localName) {
      case 'ul':
      case 'ol':
        return 'list';
      case 'table':
        return 'table';
      case 'pre':
        return 'code';
      case 'blockquote':
        return 'quote';
      case 'hr':
        return 'rule';
      default:
        return /^h[1-6]$/.test(e.localName) ? 'heading' : 'paragraph';
    }
  };

  function documentParts(): ReturnType<typeof treeParts> | null {
    const body = page?.body;
    if (!body) return null;
    const top: PartUnit[] = [];
    let section: { head: HTMLElement; kids: PartUnit[]; address: string; label: string; n: number } | null = null;
    const blockUnit = (e: HTMLElement, address: string): PartUnit => {
      const r = mdRange(e);
      const at = rtf ? range(e)?.s : undefined;
      return { id: address, label: wordFor(e), address, ...(at !== undefined && { at }), el: () => e, stored: () => (r ? slice(r.s, r.e) : (e.textContent ?? '').trim()) };
    };
    const close = (): void => {
      if (!section) return;
      const s = section;
      const head = mdRange(s.head);
      const last = s.kids.length > 0 ? mdRange(s.kids[s.kids.length - 1]!.el()!) : null;
      const at = rtf ? range(s.head)?.s : undefined;
      top.push({
        id: s.address,
        label: s.label,
        address: s.address,
        ...(at !== undefined && { at }),
        el: () => s.head,
        children: s.kids,
        stored: () => (head ? slice(head.s, last?.e ?? head.e) : (s.head.textContent ?? '').trim()),
      });
      section = null;
    };
    let loose = 0;
    let notesUnit: PartUnit | null = null;
    for (const child of [...body.children] as HTMLElement[]) {
      if (child.matches('.marxy-reading-head, .marxy-account, .marxy-office-cut')) continue;
      if (/^h[1-6]$/.test(child.localName)) {
        close();
        const slide = reading.slides.find((s) => String(s.at) === child.getAttribute('data-marxy-s'));
        const words = slide ? slide.title || `Slide ${slide.n}` : (child.textContent ?? '').trim();
        const address = slide ? `#slide=${slide.n}` : `#${child.id || `section-${top.length + 1}`}`;
        section = { head: child, kids: [], address, label: words, n: 0 };
        continue;
      }
      if (child.localName === 'hr' && child.nextElementSibling?.classList.contains('marxy-footnotes')) continue;
      if (child.classList.contains('marxy-footnotes')) {
        close();
        const notes = [...child.children].map((li, i) => blockUnit(li as HTMLElement, `#notes/${i + 1}`));
        notesUnit = { id: '#notes', label: 'notes', address: '#notes', el: () => child, children: notes, stored: () => notes.map((n) => n.stored()).join('\n\n') };
        continue;
      }
      if (section) {
        const s: { kids: PartUnit[]; address: string; n: number } = section;
        s.n += 1;
        s.kids.push(blockUnit(child, `${s.address}/${s.n}`));
      } else top.push(blockUnit(child, `#${++loose}`));
    }
    close();
    if (notesUnit) top.push(notesUnit);
    return treeParts(top, {
      readOnly: true,
      start() {
        const view = page?.root.getBoundingClientRect().top ?? 0;
        return top.find((u) => (u.el()?.getBoundingClientRect().bottom ?? 0) > view) ?? top[0] ?? null;
      },
    });
  }

  // ---- the panel ---------------------------------------------------------------------------------------------------------

  const readingCardDef = tablesReadingCard({
    file,
    shownAs: () => (asCard && mode === 'rendered' ? 'a file card and the bytes' : deck ? `slides as one page · ${reading.doc.format}` : `a document as text · ${reading.doc.format}`),
    tiers: textual
      ? [
          { name: 'The document, as text', words: 'in the reading look' },
          { name: 'Its source', words: 'in Source, as the file holds it' },
        ]
      : [
          { name: deck ? 'The slides, as text' : 'The document, as text', words: 'in the reading look' },
          { name: 'The bytes', words: 'when it will not read' },
        ],
    at: () => (asCard ? 1 : 0),
    caps: rtf
      ? [`groups nested ${RTF_LIMITS.depth} deep`, `${RTF_LIMITS.chars / 1024 / 1024} MB of text`, 'pictures and objects named, never drawn or run', 'nothing the file links to is fetched']
      : isLegacy(reading.doc.format)
      ? [`the file up to ${LEGACY_FILE_MAX / 1024 / 1024} MB, read whole`, `${OFFICE_LIMITS.chars / 1024 / 1024} MB of text`, 'pictures and objects named, never drawn or run', 'nothing the file links to is fetched', 'macros never run']
      : ['parts up to 16 MB each, read through the zip reader; 128 MB of XML in all', 'pictures up to 8 MB each, 300 and 64 MB in all', 'nothing the file links to is fetched', 'macros never run'],
    ways: () => (mode !== 'rendered' || textual ? [] : [asCard ? { words: deck ? 'Show the slides instead' : 'Show the document instead', run: () => setCard(false) } : { words: 'Show the file card and the bytes instead', run: () => setCard(true) }]),
  });

  const aboutCard: CardDef = {
    id: 'frontmatter',
    title: () => (deck ? 'Deck' : 'Document'),
    detail: () => 'from the file’s own fields',
    relevant: () => true,
    render(body) {
      const p = reading.doc.props;
      const c = reading.doc.counts;
      const n = (x: number): string => x.toLocaleString('en-GB');
      if (p.title) body.append(factRow('title', p.title));
      if (p.creator) body.append(factRow('author', p.creator));
      if (p.lastModifiedBy && p.lastModifiedBy !== p.creator) body.append(factRow('saved by', p.lastModifiedBy));
      const created = whenWords(p.created);
      const saved = whenWords(p.modified);
      if (created) body.append(factRow('created', created));
      if (saved) body.append(factRow('saved', saved));
      if (deck) {
        body.append(factRow('slides', `${n(c.slides)}${c.hiddenSlides ? `, ${n(c.hiddenSlides)} hidden` : ''}`));
        body.append(factRow('notes', c.speakerNotes ? `on ${n(c.speakerNotes)} of them` : 'none'));
      } else {
        body.append(factRow('words', n(reading.words), 'Counted here from the text shown, notes and comments aside'));
        if (p.pages !== null) body.append(factRow('pages', `${n(p.pages)}, as last laid out by the app that saved it`));
        const notes = [c.footnotes && `${n(c.footnotes)} footnote${c.footnotes === 1 ? '' : 's'}`, c.endnotes && `${n(c.endnotes)} endnote${c.endnotes === 1 ? '' : 's'}`].filter(Boolean).join(', ');
        body.append(factRow('notes', notes || 'none'));
        body.append(factRow('comments', c.comments ? n(c.comments) : 'none'));
      }
      const pics = reading.doc.images.length;
      if (pics) body.append(factRow('pictures', n(pics)));
      if (p.application) body.append(factRow('made by', p.application));
    },
  };

  const facts = factsCard(file);
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });

  function exports(): ViewerExport[] {
    const name = basename(path).replace(/\.[^.]+$/, '');
    return [
      { ...asItIs(shell, file, 'file'), name: deck ? 'The deck, as it is' : 'The document, as it is' },
      {
        id: 'markdown',
        name: `${name} as Markdown`,
        sub: deck ? 'the slides’ text as this page shows it' : 'the text as this page shows it',
        extension: 'md',
        build: async () => ({ bytes: mdBytes, preview: reading.markdown.slice(0, 4000) }),
      },
    ];
  }

  if (textual) return rtfViewer();

  /** An RTF file's page: Read is the document, Source the text views'; no bytes floor, since Source is the file. */
  function rtfViewer(): PaneViewer {
    return {
      path,
      kind: 'office',
      group: 'prose',
      binary: false,
      owns: (m) => m === 'rendered',
      show(_m, into) {
        mode = 'rendered';
        host = into;
        into.setAttribute('data-marxy-viewer', 'office');
        draw();
      },
      hide() {
        finder.clear();
        host = null;
        page = null;
      },
      refresh() {
        if (!o.text) return;
        try {
          const src = rtfSourceOf(path, o.text());
          reading = readRtfOffice(src.bytes, { storeText: src.storeText });
          toBuffer = src.toBuffer ?? ((f: number) => f);
        } catch {
          // Bytes that no longer read as RTF keep the page they last made; Source shows them as they are.
          return;
        }
        mdBytes = enc.encode(reading.markdown);
        if (host) draw();
        viewerChanged();
      },
      cards: (m) => (m === 'source' ? {} : { reading: readingCardDef, frontmatter: aboutCard, facts }),
      passing: () => [],
      headSay: () => null,
      key: () => false,
      parts: (m) => (m === 'rendered' ? documentParts() : null),
      find: (m) => (m === 'rendered' ? finder : null),
      panelKey: () => `${id}:${mode}:${reading.markdown.length}`,
      place() {
        return { scroll: page ? { top: page.root.scrollTop, left: 0 } : undefined };
      },
      exports: (m) => (m === 'rendered' ? exports() : []),
      destroy() {
        finder.clear();
        host = null;
        page = null;
      },
    };
  }

  return {
    path,
    kind: 'office',
    group: 'prose',
    binary: true,
    owns: () => true,
    show(m, into) {
      mode = m;
      host = into;
      into.setAttribute('data-marxy-viewer', 'office');
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
    panelKey: () => `${id}:${mode}:${asCard}:${hex?.selected() ?? ''}`,
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
      for (const url of urls.values()) void url.then((u) => u && URL.revokeObjectURL(u));
      urls.clear();
      hex?.destroy();
      hex = null;
      host = null;
      page = null;
    },
  };
}
