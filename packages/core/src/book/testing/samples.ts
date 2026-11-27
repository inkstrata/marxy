// Small EPUBs built from their XML, for the tests and the browser checks: an EPUB 3 book of three chapters with a nav
// document whose contents nest and name a place inside a chapter, a picture held in the book, one named on the web, a
// link between chapters, a script and XHTML's entities under its document type; and the same book as EPUB 2, its
// contents in a toc.ncx. `epubZip` packs either; nothing here compresses. Pure.
import { samplePng, storedZip } from '../../office/testing/samples.ts';
import type { BookEntry } from '../index.ts';

const CONTAINER = '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

const page = (title: string, body: string, doctype = false): string =>
  `<?xml version="1.0" encoding="utf-8"?>\n${doctype ? '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n' : ''}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title><link rel="stylesheet" href="styles/book.css"/><script>window.ran = true;</script></head><body>${body}</body></html>`;

/** The chapters' titles, in the spine's order. */
export const SAMPLE_CHAPTERS = ['1. The way back', '2. Where the numbers come from', '3. Working it out'];

const CHAPTERS = [
  page(
    SAMPLE_CHAPTERS[0]!,
    '<section epub:type="chapter"><h1>1. The way back</h1><p>A column of type is read in lines, and a line has a&nbsp;measure.</p><p>The <em>measure</em> is how wide a line runs; <a href="chapter-02.xhtml#numbers">the numbers</a> come later.</p><figure><img src="images/plate.png" alt="A plate of the measure"/></figure><p><img src="https://example.org/tracker.png" alt="A picture on the web"/></p><script>window.ran = true;</script></section>',
    true,
  ),
  page(
    SAMPLE_CHAPTERS[1]!,
    '<h1>2. Where the numbers come from</h1><p>Printers counted characters.</p><h2 id="numbers">Sixty-six</h2><p>Sixty-six characters &mdash; spaces included &mdash; is the figure most often given.</p><ul><li>Forty-five at the least</li><li>Seventy-five at the most</li></ul>',
  ),
  page(
    SAMPLE_CHAPTERS[2]!,
    '<div><h1>3. Working it out</h1><p>Here <i>w</i> is the measure in pixels and <i>s</i> the font size.</p><table><tr><th>Size</th><th>Measure</th></tr><tr><td>16</td><td>600</td></tr></table><p>Back to <a href="chapter-01.xhtml">the start</a>, or <a href="https://example.org/more">further reading</a>.</p></div>',
  ),
];

const MANIFEST =
  '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
  '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
  '<item id="c1" href="chapter-01.xhtml" media-type="application/xhtml+xml"/>' +
  '<item id="c2" href="chapter-02.xhtml" media-type="application/xhtml+xml"/>' +
  '<item id="c3" href="chapter-03.xhtml" media-type="application/xhtml+xml"/>' +
  '<item id="plate" href="images/plate.png" media-type="image/png"/>' +
  '<item id="css" href="styles/book.css" media-type="text/css"/>';

const METADATA = '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Measure</dc:title><dc:creator>Ruth Calloway</dc:creator><dc:language>en</dc:language><dc:publisher>Harbour Press</dc:publisher><dc:date>2026-03-01</dc:date><dc:identifier id="id">urn:uuid:0b6f6c1e-0000-4000-8000-000000000001</dc:identifier></metadata>';

export const NAV = `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="landmarks"><ol><li><a href="chapter-03.xhtml">Not the contents</a></li></ol></nav><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="chapter-01.xhtml">${SAMPLE_CHAPTERS[0]}</a></li><li><a href="chapter-02.xhtml">${SAMPLE_CHAPTERS[1]}</a><ol><li><a href="chapter-02.xhtml#numbers">Sixty-six</a></li></ol></li><li><a href="chapter-03.xhtml">${SAMPLE_CHAPTERS[2]}</a></li></ol></nav></body></html>`;

export const NCX = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>The Measure</text></docTitle><navMap><navPoint id="p1" playOrder="1"><navLabel><text>${SAMPLE_CHAPTERS[0]}</text></navLabel><content src="chapter-01.xhtml"/></navPoint><navPoint id="p2" playOrder="2"><navLabel><text>${SAMPLE_CHAPTERS[1]}</text></navLabel><content src="chapter-02.xhtml"/><navPoint id="p3" playOrder="3"><navLabel><text>Sixty-six</text></navLabel><content src="chapter-02.xhtml#numbers"/></navPoint></navPoint><navPoint id="p4" playOrder="4"><navLabel><text>${SAMPLE_CHAPTERS[2]}</text></navLabel><content src="chapter-03.xhtml"/></navPoint></navMap></ncx>`;

const SPINE = '<itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/>';

/** The EPUB 3 book's parts, by their names in the zip, in the order a zip holds them (`mimetype` first). */
export function epub3Parts(): Record<string, string | Uint8Array> {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': `<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">${METADATA}<manifest>${MANIFEST}</manifest><spine toc="ncx">${SPINE}</spine></package>`,
    'OEBPS/nav.xhtml': NAV,
    'OEBPS/toc.ncx': NCX,
    'OEBPS/chapter-01.xhtml': CHAPTERS[0]!,
    'OEBPS/chapter-02.xhtml': CHAPTERS[1]!,
    'OEBPS/chapter-03.xhtml': CHAPTERS[2]!,
    'OEBPS/images/plate.png': samplePng(48, 32, (x, y) => [40 + x * 4, 80 + y * 4, 160]),
    'OEBPS/styles/book.css': 'body { font-family: Georgia, serif; }\n',
  };
}

/** The same book as EPUB 2: no nav document, its contents in toc.ncx. */
export function epub2Parts(): Record<string, string | Uint8Array> {
  const parts = epub3Parts();
  delete parts['OEBPS/nav.xhtml'];
  parts['OEBPS/content.opf'] = `<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">${METADATA}<manifest>${MANIFEST.replace(/<item id="nav"[^>]*\/>/, '')}</manifest><spine toc="ncx">${SPINE}</spine></package>`;
  return parts;
}

export const epubZip = (parts: Readonly<Record<string, string | Uint8Array>>): Uint8Array => storedZip(parts);

const enc = new TextEncoder();

/** A part reader and the zip's listing over `parts`, as the shell would hand them to `readEpub`; `read` records what was asked. */
export function partsReader(parts: Readonly<Record<string, string | Uint8Array>>): { entries: BookEntry[]; read: (name: string) => Promise<Uint8Array | null>; asked: string[] } {
  const asked: string[] = [];
  const bytes = (v: string | Uint8Array): Uint8Array => (typeof v === 'string' ? enc.encode(v) : v);
  return {
    entries: Object.entries(parts).map(([path, v]) => ({ path, size: bytes(v).length, encrypted: false })),
    asked,
    read: async (name) => {
      asked.push(name);
      const v = parts[name];
      return v === undefined ? null : bytes(v);
    },
  };
}
