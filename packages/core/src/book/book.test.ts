import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderSafeHtml } from '../render/index.ts';
import { bookAccount, bookHeadLine, readEpub, TOC_DEPTH, TOC_MOST, type Book, type BookResult } from './index.ts';
import { epub2Parts, epub3Parts, NAV, NCX, partsReader, SAMPLE_CHAPTERS } from './testing/samples.ts';

const read = async (parts: Record<string, string | Uint8Array>): Promise<BookResult> => {
  const r = partsReader(parts);
  return readEpub(r.entries, r.read);
};
const book = async (parts: Record<string, string | Uint8Array>): Promise<Book> => {
  const r = await read(parts);
  assert.ok('book' in r, JSON.stringify(r));
  return r.book;
};
const at = (b: Book, mark: string): number => b.anchors.find((a) => a.id === mark)!.at;

test('an EPUB 3 book reads in its spine’s order, its contents from the nav document', async () => {
  const b = await book(epub3Parts());
  assert.deepEqual(b.chapters.map((c) => c.title), SAMPLE_CHAPTERS);
  assert.equal(b.tocFrom, 'nav');
  // The `toc` nav, not the landmarks before it; the nested entry one level in, landing on the place it names.
  assert.deepEqual(b.toc.map((e) => [e.text, e.depth, e.chapter]), [
    [SAMPLE_CHAPTERS[0], 0, 0],
    [SAMPLE_CHAPTERS[1], 0, 1],
    ['Sixty-six', 1, 1],
    [SAMPLE_CHAPTERS[2], 0, 2],
  ]);
  const md = b.markdown;
  const c1 = at(b, b.chapters[0]!.mark);
  const c2 = at(b, b.chapters[1]!.mark);
  const c3 = at(b, b.chapters[2]!.mark);
  assert.ok(c1 < c2 && c2 < c3, 'chapters in the spine’s order');
  const bytes = new TextEncoder().encode(md);
  const from = (n: number): string => new TextDecoder().decode(bytes.subarray(n, n + 40));
  assert.match(from(c2), /^# 2\\\. Where the numbers/);
  assert.match(from(at(b, b.toc[2]!.mark)), /^## Sixty\\-six/);
  assert.equal(b.meta.title, 'The Measure');
  assert.deepEqual(b.meta.creators, ['Ruth Calloway']);
  assert.equal(b.meta.version, '3.0');
  assert.equal(bookHeadLine(b), `Book · 3 chapters · ${b.words.toLocaleString('en-GB')} words`);
  assert.ok(b.words > 50, String(b.words));
});

test('a chapter’s text: entities under XHTML’s document type, links inside the book as keys, pictures held and held back', async () => {
  const b = await book(epub3Parts());
  const md = b.markdown;
  assert.match(md, /a measure/, '&nbsp; is read from the fixed table');
  assert.match(md, /characters — spaces included —/);
  assert.doesNotMatch(md, /window\.ran/, 'no script reaches the page');
  assert.doesNotMatch(md, /book\.css/);
  // The link to a place in chapter 2 is a key that leads to that place's mark.
  const key = /\[the numbers\]\(<#bk(\d+)>\)/.exec(md);
  assert.ok(key, md);
  assert.equal(b.targets[Number(key[1])], b.toc[2]!.mark);
  assert.match(md, /\[further reading\]\(<https:\/\/example\.org\/more>\)/);
  assert.deepEqual(b.images.map((i) => [i.entry, i.what]), [['OEBPS/images/plate.png', 'picture'], [null, 'linked picture']]);
  assert.equal(b.heldBack, 1);
  assert.ok(bookAccount(b).some((l) => /held back, never fetched/.test(l)));
  // Drawn by the one renderer: every block carries its range in the page's Markdown, and nothing of the web is asked for.
  const html = renderSafeHtml(md, { file: '/r/the-measure.epub' }).html;
  assert.doesNotMatch(html, /example\.org\/tracker/);
  assert.match(html, /data-marxy-s="\d+"/);
  assert.match(md, /\| Size \| Measure \|/);
});

test('an EPUB 2 book takes its contents from toc.ncx', async () => {
  const b = await book(epub2Parts());
  assert.equal(b.tocFrom, 'ncx');
  assert.equal(b.meta.version, '2.0');
  assert.deepEqual(b.toc.map((e) => [e.text, e.depth]), [
    [SAMPLE_CHAPTERS[0], 0],
    [SAMPLE_CHAPTERS[1], 0],
    ['Sixty-six', 1],
    [SAMPLE_CHAPTERS[2], 0],
  ]);
});

test('a book with no contents lists its chapters by their first headings', async () => {
  const parts = epub2Parts();
  delete parts['OEBPS/toc.ncx'];
  const b = await book(parts);
  assert.equal(b.tocFrom, 'headings');
  assert.deepEqual(b.toc.map((e) => e.text), SAMPLE_CHAPTERS);
  assert.ok(bookAccount(b).some((l) => /no contents of its own/.test(l)));
  // A nav that lists nothing the spine holds is no contents either.
  const odd = epub3Parts();
  odd['OEBPS/nav.xhtml'] = NAV.replace(/chapter-0\d\.xhtml/g, 'elsewhere.xhtml');
  delete odd['OEBPS/toc.ncx'];
  assert.equal((await book(odd)).tocFrom, 'headings');
});

test('a missing or broken spine is said, for the archive page', async () => {
  const noContainer = epub3Parts();
  delete noContainer['META-INF/container.xml'];
  assert.match(((await read(noContainer)) as { fallback: string }).fallback, /no META-INF\/container\.xml/);
  const noSpine = epub3Parts();
  noSpine['OEBPS/content.opf'] = String(noSpine['OEBPS/content.opf']).replace(/<spine[^]*<\/spine>/, '');
  assert.match(((await read(noSpine)) as { fallback: string }).fallback, /has no spine/);
  const unknown = epub3Parts();
  unknown['OEBPS/content.opf'] = String(unknown['OEBPS/content.opf']).replace(/idref="c\d"/g, 'idref="nothing"');
  assert.match(((await read(unknown)) as { fallback: string }).fallback, /names no part its manifest lists/);
  const missingOpf = epub3Parts();
  delete missingOpf['OEBPS/content.opf'];
  assert.match(((await read(missingOpf)) as { fallback: string }).fallback, /is not in it/);
});

test('a chapter that is not well-formed is read as a browser would: void elements, bare attributes, closes out of turn', async () => {
  const parts = epub3Parts();
  parts['OEBPS/chapter-02.xhtml'] =
    '<?xml version="1.0"?>\n<!DOCTYPE html>\n<HTML><body><h1 class=title>2. Mended</h1><p>Line one<br>line two &amp; <img src="images/plate.png" alt=plate></p><p hidden class=x>Second <b>bold</p><div>4 < 5<script>if (a < b) window.ran = true;</script></body>';
  const b = await book(parts);
  assert.equal(b.mended, 1);
  assert.equal(b.chapters[1]!.broken, null);
  assert.equal(b.chapters[1]!.title, '2. Mended');
  assert.match(b.markdown, /Line one\\\nline two \\& !\[plate\]\(office-image:\d\)/);
  assert.match(b.markdown, /Second <strong>bold<\/strong>/);
  assert.match(b.markdown, /4 \\< 5/);
  assert.doesNotMatch(b.markdown, /window\.ran/);
  assert.ok(bookAccount(b).some((l) => /read as a browser would/.test(l)));
});

test('read as a browser would: implied end tags, so hundreds of unclosed paragraphs, items and cells nest no deeper', async () => {
  const parts = epub3Parts();
  const paras = Array.from({ length: 300 }, (_, i) => `<p>Paragraph ${i + 1}`).join('\n');
  parts['OEBPS/chapter-02.xhtml'] = `<html><body><h1>2. Unclosed</h1>${paras}<ul><li>one<li>two</ul><dl><dt>term<dd>meaning<dt>other<dd>sense</dl><table><tr><td>a<td>b<tr><td>c<td>d</table></body></html>`;
  const b = await book(parts);
  assert.equal(b.mended, 1);
  assert.equal(b.chapters[1]!.broken, null);
  const md = b.markdown;
  assert.equal(md.match(/^Paragraph \d+$/gm)?.length, 300, 'each paragraph its own, none nested in the last');
  assert.match(md, /^\* one\n\* two$/m);
  assert.match(md, /\| a \| b \|\n\| --- \| --- \|\n\| c \| d \|/);
  assert.match(md, /<strong>other<\/strong>/);
});

test('read as a browser would: everything at the top level is kept; a script never closed truncates, and says so', async () => {
  const parts = epub3Parts();
  parts['OEBPS/chapter-02.xhtml'] = '<h1>2. Loose</h1><p>first</p><p>second</p>';
  parts['OEBPS/chapter-03.xhtml'] = '<html><body><h1>3. Cut</h1><p>kept</p><script>never closed <p>lost</p></body></html>';
  const b = await book(parts);
  assert.equal(b.mended, 2);
  assert.equal(b.chapters[1]!.title, '2. Loose');
  assert.match(b.markdown, /first\n\nsecond/);
  assert.match(b.markdown, /# 3\\\. Cut\n\nkept/);
  assert.doesNotMatch(b.markdown, /lost|never closed/);
  assert.equal(b.truncated, 1);
  assert.ok(bookAccount(b).some((l) => /1 chapter is truncated/.test(l)), bookAccount(b).join(' | '));
});

test('read as a browser would: attribute names in capitals still lead and draw', async () => {
  const parts = epub3Parts();
  parts['OEBPS/chapter-03.xhtml'] = '<HTML><BODY><H1>3. Shouted</H1><P>Back to <A HREF="chapter-01.xhtml">the start</A>.<BR><IMG SRC="images/plate.png" ALT="Plate"></BODY></HTML>';
  const b = await book(parts);
  assert.equal(b.mended, 1);
  assert.match(b.markdown, /\[the start\]\(<#bk\d+>\)/);
  assert.ok(b.images.some((i) => i.entry === 'OEBPS/images/plate.png' && i.alt === 'Plate'), JSON.stringify(b.images));
});

test('a chapter that cannot be read either way says why in its place, and the rest reads', async () => {
  const parts = epub3Parts();
  parts['OEBPS/chapter-02.xhtml'] = '<?xml version="1.0"?><!DOCTYPE html [<!ENTITY a "b">]><html><body><p>&a;</p></body></html>';
  const b = await book(parts);
  assert.equal(b.chapters[1]!.broken !== null, true);
  assert.equal(b.mended, 0);
  assert.equal(b.chapters[0]!.title, SAMPLE_CHAPTERS[0]);
  assert.equal(b.chapters[2]!.title, SAMPLE_CHAPTERS[2]);
  assert.match(b.markdown, /chapter\\-02\\\.xhtml is not XML the app reads\\: it declares a document type of its own/);
  assert.equal(bookHeadLine(b), `Book · 2 chapters · ${b.words.toLocaleString('en-GB')} words`);
});

test('a locked book says so, from its rights file or an encryption.xml that names more than fonts', async () => {
  for (const [name, re] of [['META-INF/rights.xml', /Adobe/], ['META-INF/sinf.xml', /FairPlay/], ['META-INF/license.lcpl', /LCP/]] as const) {
    const parts = { ...epub3Parts(), [name]: '<rights/>' };
    const r = await read(parts);
    assert.ok('locked' in r && re.test(r.locked), `${name}: ${JSON.stringify(r)}`);
  }
  const enc = (uri: string, alg: string): string =>
    `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`;
  const chapters = await read({ ...epub3Parts(), 'META-INF/encryption.xml': enc('OEBPS/chapter-01.xhtml', 'http://www.w3.org/2001/04/xmlenc#aes128-cbc') });
  assert.ok('locked' in chapters && /one of its parts is encrypted/.test(chapters.locked), JSON.stringify(chapters));
  // A font hidden by the IDPF's obfuscation is not a lock on the text.
  const fonts = await read({ ...epub3Parts(), 'OEBPS/fonts/a.otf': new Uint8Array(8), 'META-INF/encryption.xml': enc('OEBPS/fonts/a.otf', 'http://www.idpf.org/2008/embedding') });
  assert.ok('book' in fonts, JSON.stringify(fonts));
});

test('a hostile book: a declared document type, a spine that repeats one chapter, deep contents, too many entries', async () => {
  // Entities declared inside the chapter are refused, never expanded.
  const bomb = epub3Parts();
  bomb['OEBPS/chapter-01.xhtml'] = '<?xml version="1.0"?><!DOCTYPE html [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><html><body><p>&b;</p></body></html>';
  const b1 = await book(bomb);
  assert.match(b1.chapters[0]!.broken ?? '', /document type of its own/);
  assert.doesNotMatch(b1.markdown, /aaaaaaaaaa/);
  // One chapter listed ten thousand times is read, and shown, once.
  const repeat = epub3Parts();
  repeat['OEBPS/content.opf'] = String(repeat['OEBPS/content.opf']).replace(/<spine([^>]*)>[^]*<\/spine>/, (_, a: string) => `<spine${a}>${'<itemref idref="c1"/>'.repeat(10_000)}</spine>`);
  const r = partsReader(repeat);
  const b2 = (await readEpub(r.entries, r.read)) as { book: Book };
  assert.equal(b2.book.chapters.length, 1);
  assert.equal(r.asked.filter((n) => n === 'OEBPS/chapter-01.xhtml').length, 1);
  // Contents nested past the depth, and more entries than the cap, are cut.
  const deep = epub3Parts();
  let ol = '';
  for (let i = 0; i < 40; i++) ol = `<ol><li><a href="chapter-01.xhtml">level ${i}</a>${ol}</li></ol>`;
  const wide = `<ol>${'<li><a href="chapter-02.xhtml">again</a></li>'.repeat(TOC_MOST + 50)}</ol>`;
  deep['OEBPS/nav.xhtml'] = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc">${ol.replace('<ol>', `<ol>${wide.slice(4, -5)}`)}</nav></body></html>`;
  const b3 = await book(deep);
  assert.ok(b3.toc.length <= TOC_MOST, String(b3.toc.length));
  assert.ok(Math.max(...b3.toc.map((e) => e.depth)) < 8);
  // A zip that lists more entries than a book is read from falls back to the archive page.
  const many = epub3Parts();
  for (let i = 0; i < 20_001; i++) many[`OEBPS/x/${i}`] = '';
  assert.match(((await read(many)) as { fallback: string }).fallback, /more than the 20,000/);
  // A container that names a package outside the book, or a link that leaves it, leads nowhere.
  const out = epub3Parts();
  out['OEBPS/chapter-03.xhtml'] = String(out['OEBPS/chapter-03.xhtml']).replace('chapter-01.xhtml', '../../../etc/passwd');
  const b4 = await book(out);
  assert.doesNotMatch(b4.markdown, /passwd/);
  assert.match(b4.markdown, /Back to the start/);
});

test('contents nested past the limit through headings without links are cut there, in a nav and in an NCX', async () => {
  // At every level a link, and beside it a heading with no link holding the next level.
  let ol = '';
  for (let k = 11; k >= 0; k--) ol = `<ol><li><a href="chapter-02.xhtml">Level ${k}</a></li><li><span>Part ${k}</span>${ol}</li></ol>`;
  const three = epub3Parts();
  three['OEBPS/nav.xhtml'] = NAV.replace(/<nav epub:type="toc">[^]*?<\/nav>/, `<nav epub:type="toc">${ol}</nav>`);
  const levels = Array.from({ length: TOC_DEPTH }, (_, k) => [`Level ${k}`, 0]);
  const fromNav = await book(three);
  assert.equal(fromNav.tocFrom, 'nav');
  assert.deepEqual(fromNav.toc.map((e) => [e.text, e.depth]), levels);

  let points = '';
  for (let k = 11; k >= 0; k--) points = `<navPoint><navLabel><text>Level ${k}</text></navLabel><content src="chapter-02.xhtml"/></navPoint><navPoint><navLabel><text>Part ${k}</text></navLabel>${points}</navPoint>`;
  const two = epub2Parts();
  two['OEBPS/toc.ncx'] = NCX.replace(/<navMap>[^]*<\/navMap>/, `<navMap>${points}</navMap>`);
  const fromNcx = await book(two);
  assert.equal(fromNcx.tocFrom, 'ncx');
  assert.deepEqual(fromNcx.toc.map((e) => [e.text, e.depth]), levels);
});
