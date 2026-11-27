// The package around an EPUB's chapters: where its OPF is (META-INF/container.xml), what the OPF says (the book's own
// fields, its manifest and its spine), its contents (nav.xhtml for EPUB 3, toc.ncx for EPUB 2), and whether a seller's
// lock is on it (META-INF/encryption.xml naming more than fonts, or an Adobe, Apple or Readium rights file). Every part
// is read under the office reader's budget and caps; nothing here fetches what an address names. Pure.
import { resolvePart } from '../office/parts.ts';
import { find, findAll, kid, kidsOf, readXml, textOf, tooMuchXml, xmlText, type XmlBudget, type XmlElement } from '../office/xml.ts';

/** A part's bytes by its name in the zip, or null when the book has no such part. */
export type EntryRead = (name: string) => Promise<Uint8Array | null>;

export interface ManifestItem {
  readonly id: string;
  /** The zip entry it names, resolved against the OPF's folder. */
  readonly path: string;
  readonly type: string;
  readonly properties: readonly string[];
}

export interface BookMeta {
  readonly title: string | null;
  readonly creators: readonly string[];
  readonly language: string | null;
  readonly publisher: string | null;
  readonly date: string | null;
  readonly identifier: string | null;
  readonly description: string | null;
  /** The package's own version: `2.0`, `3.0`. */
  readonly version: string | null;
}

export interface OpfPackage {
  readonly opf: string;
  readonly meta: BookMeta;
  readonly manifest: ReadonlyMap<string, ManifestItem>;
  /** The spine: manifest items in reading order, and whether each is in the linear reading. */
  readonly spine: readonly { readonly item: ManifestItem; readonly linear: boolean }[];
  /** The EPUB 3 contents document, when the manifest names one. */
  readonly nav: ManifestItem | null;
  /** The EPUB 2 contents, named by the spine's `toc` or by its media type. */
  readonly ncx: ManifestItem | null;
}

/** One entry of the book's contents, before it is placed on the page. */
export interface TocLink {
  readonly text: string;
  readonly depth: number;
  /** The zip entry it leads to, and the fragment inside it. */
  readonly path: string;
  readonly frag: string | null;
}

/** Why the book cannot be read as a book: the archive page shows it instead, with this sentence. */
export class BookError extends Error {}

/** The most a book's contents may list, and how deep it may nest: past either, the rest are left out. */
export const TOC_MOST = 5000;
export const TOC_DEPTH = 8;
/** The most chapters a spine may list. */
export const SPINE_MOST = 10_000;

const FONT_TYPES = /^(?:font\/|application\/(?:x-font|font-|vnd\.ms-opentype))/i;
const FONT_NAME = /\.(?:ttf|otf|woff2?|ttc|otc|eot)$/i;
/** The two ways a book may hide its fonts from being copied out of it; neither is a lock on its text. */
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);

const clean = (s: string): string | null => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

/** An address in a part, as the zip entry it names (no fragment, no query), or null for one outside the book. */
export function entryOf(from: string, href: string): { readonly path: string; readonly frag: string | null } | null {
  const raw = href.trim();
  if (raw === '' || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('\\')) return null;
  const hash = raw.indexOf('#');
  const fragRaw = hash < 0 ? null : raw.slice(hash + 1);
  let target = (hash < 0 ? raw : raw.slice(0, hash)).replace(/\?.*$/, '');
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  let frag: string | null = null;
  if (fragRaw !== null && fragRaw !== '') {
    try {
      frag = decodeURIComponent(fragRaw);
    } catch {
      frag = fragRaw;
    }
  }
  if (target === '') return { path: from, frag };
  if (target.includes('\0')) return null;
  return { path: resolvePart(from, target), frag };
}

export interface BookParts {
  readonly budget: XmlBudget;
  /**
   * A part as XML, or null when the book has no such part. Throws `OfficeError` for one that is not XML. Every part of a
   * book may name its DTD (XHTML's, the NCX's), which is skipped; `lenient` reads a chapter as a browser would.
   */
  xml(name: string, lenient?: boolean): Promise<XmlElement | null>;
  /** Parts a lenient read stopped short in: what came after the construct never closed is left out. */
  readonly truncated: ReadonlySet<string>;
}

export function bookParts(read: EntryRead, budget: XmlBudget): BookParts {
  const kept = new Map<string, Promise<XmlElement | null>>();
  const truncated = new Set<string>();
  return {
    budget,
    truncated,
    xml(name, lenient = false) {
      const key = lenient ? `${name}\0lenient` : name;
      let got = kept.get(key);
      if (!got) {
        got = (async () => {
          const bytes = await read(name);
          if (!bytes) return null;
          budget.bytes -= bytes.length;
          if (budget.bytes < 0) throw tooMuchXml();
          return readXml(xmlText(bytes), budget, name, { xhtml: true, lenient, onTruncated: () => truncated.add(name) });
        })();
        kept.set(key, got);
      }
      return got;
    },
  };
}

/** The OPF's name, from META-INF/container.xml. */
export async function opfPath(parts: BookParts): Promise<string> {
  const container = await parts.xml('META-INF/container.xml').catch((e: unknown) => {
    throw new BookError(`Its META-INF/container.xml could not be read: ${e instanceof Error ? e.message : String(e)}`);
  });
  if (!container) throw new BookError('It has no META-INF/container.xml, which every EPUB has to say where its contents are.');
  const roots = findAll(container, 'rootfile');
  const opf = roots.find((r) => (r.attrs['media-type'] ?? '').toLowerCase() === 'application/oebps-package+xml') ?? roots[0];
  const path = opf?.attrs['full-path'];
  if (!path) throw new BookError('Its META-INF/container.xml names no package file.');
  const at = entryOf('', path);
  if (!at) throw new BookError('Its META-INF/container.xml names a package file outside the book.');
  return at.path;
}

/** The OPF read: the book's fields, its manifest, its spine and its contents' parts. */
export async function readOpf(parts: BookParts, opf: string): Promise<OpfPackage> {
  const root = await parts.xml(opf).catch((e: unknown) => {
    throw new BookError(`Its package file, ${opf}, could not be read: ${e instanceof Error ? e.message : String(e)}`);
  });
  if (!root) throw new BookError(`Its package file, ${opf}, is not in it.`);
  if (root.name !== 'package') throw new BookError(`Its package file, ${opf}, is not an EPUB package.`);
  const metadata = kid(root, 'metadata');
  const of = (name: string): string | null => clean(textOf(kid(metadata, name)));
  const all = (name: string): string[] => kidsOf(metadata, name).flatMap((e) => clean(textOf(e)) ?? []);
  const description = of('description');
  const meta: BookMeta = {
    title: of('title'),
    creators: all('creator').slice(0, 20),
    language: of('language'),
    publisher: of('publisher'),
    date: of('date'),
    identifier: of('identifier'),
    // Some books write their blurb as escaped HTML: it is shown as text, its tags taken out.
    description: description ? clean(description.replace(/<[^>]*>/g, ' ')) : null,
    version: clean(root.attrs.version ?? ''),
  };
  const manifest = new Map<string, ManifestItem>();
  for (const item of kidsOf(kid(root, 'manifest'), 'item')) {
    const id = item.attrs.id;
    const href = item.attrs.href;
    if (!id || !href || manifest.has(id)) continue;
    const at = entryOf(opf, href);
    if (!at) continue;
    manifest.set(id, { id, path: at.path, type: (item.attrs['media-type'] ?? '').toLowerCase(), properties: (item.attrs.properties ?? '').split(/\s+/).filter(Boolean) });
  }
  const spineEl = kid(root, 'spine');
  if (!spineEl) throw new BookError(`Its package file, ${opf}, has no spine: nothing says in what order its chapters are read.`);
  const refs = kidsOf(spineEl, 'itemref');
  if (refs.length > SPINE_MOST) throw new BookError(`Its spine lists ${refs.length.toLocaleString('en-GB')} chapters, more than the ${SPINE_MOST.toLocaleString('en-GB')} the app reads as one page.`);
  const spine: { item: ManifestItem; linear: boolean }[] = [];
  for (const ref of refs) {
    const item = manifest.get(ref.attrs.idref ?? '');
    if (item) spine.push({ item, linear: (ref.attrs.linear ?? 'yes').toLowerCase() !== 'no' });
  }
  if (spine.length === 0) throw new BookError(refs.length === 0 ? `Its spine, in ${opf}, is empty.` : `Its spine, in ${opf}, names no part its manifest lists.`);
  const items = [...manifest.values()];
  const nav = items.find((i) => i.properties.includes('nav')) ?? null;
  const ncx = manifest.get(spineEl.attrs.toc ?? '') ?? items.find((i) => i.type === 'application/x-dtbncx+xml') ?? null;
  return { opf, meta, manifest, spine, nav, ncx };
}

/** Why the book is locked, in the sentence the page says, or null when nothing locks its text. */
export async function lockOf(names: ReadonlySet<string>, parts: BookParts, manifest: ReadonlyMap<string, ManifestItem> | null): Promise<string | null> {
  const has = (n: string): boolean => names.has(n) || [...names].some((x) => x.toLowerCase() === n.toLowerCase());
  if (has('META-INF/rights.xml')) return 'It carries Adobe’s DRM (META-INF/rights.xml): its chapters are encrypted for the reader it was sold to, so they cannot be read here.';
  if (has('META-INF/sinf.xml')) return 'It carries Apple’s FairPlay DRM (META-INF/sinf.xml): its chapters are encrypted for the account it was sold to, so they cannot be read here.';
  if (has('META-INF/license.lcpl')) return 'It carries Readium LCP protection (META-INF/license.lcpl): its chapters are encrypted for the reader it was lent or sold to, so they cannot be read here.';
  if (!has('META-INF/encryption.xml')) return null;
  let enc: XmlElement | null;
  try {
    enc = await parts.xml('META-INF/encryption.xml');
  } catch {
    return 'Its META-INF/encryption.xml says some of its parts are encrypted, and could not be read to say which: they cannot be read here.';
  }
  const types = new Map<string, string>();
  for (const m of manifest?.values() ?? []) types.set(m.path, m.type);
  let locked = 0;
  for (const data of findAll(enc, 'EncryptedData')) {
    const algorithm = kid(data, 'EncryptionMethod')?.attrs.Algorithm ?? '';
    const uri = find(data, 'CipherReference')?.attrs.URI ?? '';
    const at = entryOf('', uri)?.path ?? uri;
    const font = FONT_TYPES.test(types.get(at) ?? '') || FONT_NAME.test(at);
    if (!(font && FONT_OBFUSCATION.has(algorithm))) locked++;
  }
  if (locked === 0) return null;
  return `Its META-INF/encryption.xml says ${locked === 1 ? 'one of its parts is' : `${locked.toLocaleString('en-GB')} of its parts are`} encrypted, which is how a seller locks a book: they cannot be read here.`;
}

/** The book's contents from its EPUB 3 nav document: the `toc` nav, else the first. */
export function navLinks(nav: XmlElement, from: string): TocLink[] {
  const navs = findAll(nav, 'nav');
  const toc = navs.find((n) => (n.attrs.type ?? '').split(/\s+/).includes('toc')) ?? navs[0];
  const list = toc ? kid(toc, 'ol') ?? find(toc, 'ol') : null;
  const out: TocLink[] = [];
  const walk = (ol: XmlElement, depth: number): void => {
    if (depth >= TOC_DEPTH) return;
    for (const li of kidsOf(ol, 'li')) {
      if (out.length >= TOC_MOST) return;
      const a = kid(li, 'a') ?? kid(li, 'span');
      const text = clean(textOf(a)) ?? '';
      const at = a?.name === 'a' ? entryOf(from, a.attrs.href ?? '') : null;
      if (at && text) out.push({ text: text.slice(0, 500), depth, path: at.path, frag: at.frag });
      const sub = kid(li, 'ol');
      // A heading with no link of its own still holds its children, one level in.
      if (sub) walk(sub, at && text ? depth + 1 : depth);
    }
  };
  if (list) walk(list, 0);
  return out;
}

/** The book's contents from its EPUB 2 toc.ncx. */
export function ncxLinks(ncx: XmlElement, from: string): TocLink[] {
  const map = kid(ncx, 'navMap') ?? find(ncx, 'navMap');
  const out: TocLink[] = [];
  const walk = (el: XmlElement, depth: number): void => {
    if (depth >= TOC_DEPTH) return;
    for (const p of kidsOf(el, 'navPoint')) {
      if (out.length >= TOC_MOST) return;
      const text = clean(textOf(kid(kid(p, 'navLabel'), 'text'))) ?? '';
      const at = entryOf(from, kid(p, 'content')?.attrs.src ?? '');
      if (at && text) out.push({ text: text.slice(0, 500), depth, path: at.path, frag: at.frag });
      walk(p, at && text ? depth + 1 : depth);
    }
  };
  if (map) walk(map, 0);
  return out;
}
