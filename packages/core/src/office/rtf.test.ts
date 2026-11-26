// The RTF reader against WordPad's own shape and by-hand samples: what each block becomes, the bytes of the file each
// block names, `\u` with its fallback, code pages as the file declares them, headings by size, style and outline level,
// lists, tables, fields, pictures and objects named, the file's own facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSafeHtml } from '../render/pipeline.ts';
import { officeAccount, officeHeadLine, readRtfOffice, sourceRangeOf } from './index.ts';
import { inlineText, type Block } from './model.ts';
import { hyperlinkOf, readRtf } from './rtf.ts';
import { OfficeError } from './xml.ts';

const fixture = (name: string): Uint8Array => readFileSync(new URL(`../../../../fixtures/rtf/${name}`, import.meta.url));
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const doc = (body: string, head = '\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Arial;}}'): string => `{\\rtf1${head}\\pard ${body}}`;
const text = (s: string): string => readRtfOffice(ascii(s)).doc.blocks.map(blockText).join('\n');
const html = (md: string): string => renderSafeHtml(md, { file: 'notes.md' }).html;

function blockText(b: Block): string {
  switch (b.t) {
    case 'heading':
    case 'para':
      return inlineText(b.kids);
    case 'list':
      return b.items.map((i) => i.map(blockText).join(' ')).join(' / ');
    case 'table':
      return b.rows.map((r) => r.map(inlineText).join(' | ')).join(' / ');
    default:
      return '';
  }
}

test('a WordPad file reads as headings, paragraphs, lists, a table and links, each the page’s own element', () => {
  const r = readRtfOffice(fixture('wordpad-harbour-notes.rtf'));
  const shape = r.doc.blocks.map((b) => (b.t === 'heading' ? `h${b.level}` : b.t === 'list' ? (b.ordered ? 'ol' : 'ul') : b.t));
  assert.deepEqual(shape, ['h1', 'para', 'h2', 'ul', 'para', 'ol', 'h2', 'table', 'para', 'para']);
  const h = html(r.markdown);
  assert.match(h, /<h1[^>]*>.*Harbour notes/);
  assert.match(h, /<strong[^>]*>soundings<\/strong>/);
  assert.match(h, /<em[^>]*>north basin<\/em>/);
  assert.match(h, /<code[^>]*>GAUGE-7<\/code>/);
  assert.equal((h.match(/<li/g) ?? []).length, 5);
  assert.equal((h.match(/<tr/g) ?? []).length, 3);
  assert.match(h, /Fish dock/);
  // A link is its words and then its address, as text: nothing to follow.
  assert.doesNotMatch(h, /<a\b/);
  assert.match(r.markdown, /the chart office \\\(https\\:\/\/example\\\.org\/chart\\\)/);
  // A link whose words are its address is not written twice.
  assert.equal(r.markdown.match(/example\\\.org\/harbour/g)?.length, 1);
  assert.match(blockText(r.doc.blocks[9]!), /^Depth ≥ 4 m is safe – “clear” water\.$/);
  assert.equal(officeHeadLine(r), `Rich Text document · ${r.words} words · the text, not the layout`);
  assert.equal(r.doc.props.application, 'Riched20 10.0.22621');
});

test('every block names the bytes of the file it was read from, and an element maps back through them', () => {
  const bytes = fixture('wordpad-harbour-notes.rtf');
  const r = readRtfOffice(bytes);
  const latin = new TextDecoder('latin1');
  const md = new TextEncoder().encode(r.markdown);
  assert.ok(r.spans.length >= 15);
  for (const sp of r.spans) {
    const words = new TextDecoder().decode(md.subarray(sp.ms, sp.me)).replace(/<[^>]+>|\\|[|*#\-]|\d+\)/g, ' ').match(/[A-Za-z]{3,}/g) ?? [];
    const src = latin.decode(bytes.subarray(sp.s, sp.e));
    for (const w of words.slice(0, 3)) assert.ok(src.includes(w), `${w} in ${src}`);
    assert.ok(sp.s < sp.e && sp.e <= bytes.length);
  }
  // In order, and none overlapping one before it unless inside it.
  const top = r.spans.filter((a) => !r.spans.some((b) => b !== a && b.ms <= a.ms && b.me >= a.me));
  for (let i = 1; i < top.length; i++) assert.ok(top[i]!.s >= top[i - 1]!.e, 'blocks follow one another in the file');
  // A run of bold inside the paragraph maps to the paragraph; the paragraph to its own bytes.
  const para = r.spans.find((sp) => latin.decode(bytes.subarray(sp.s, sp.e)).startsWith('These are'))!;
  const strongAt = r.markdown.indexOf('<strong>soundings');
  assert.deepEqual(sourceRangeOf(r.spans, strongAt, strongAt + 26), { s: para.s, e: para.e });
  assert.match(latin.decode(bytes.subarray(para.e - 4, para.e)), /\\par$/);
});

test('\\u decodes with its \\uc fallback skipped, by count, by number and by group', () => {
  assert.equal(text(doc('a\\u8364?b')), 'a€b');
  assert.equal(text(doc("\\uc2 a\\u8364\\'80\\'80b")), 'a€b');
  assert.equal(text(doc('\\uc0 a\\u8364 b')), 'a€b');
  // A group ends the skip: the fallback never eats what follows it.
  assert.equal(text(doc('\\uc3 a\\u8364{b}c')), 'a€bc');
  // Negative numbers are the upper half; two halves make one character.
  assert.equal(text(doc('\\u-10179?\\u-8704?')), '😀');
  assert.equal(text(doc('\\u-3913?')), '\uf0b7');
  // The skip count is the group's own.
  assert.equal(text(doc('{\\uc2 \\u8364xx}\\u8364?')), '€€');
});

test('characters by number are read in the code page the file declares: Greek, Japanese, a font’s charset', () => {
  assert.equal(blockText(readRtf(fixture('greek-1253.rtf')).blocks[0]!), 'Λιμάνι του Πειραιά');
  const jp = readRtfOffice(fixture('japanese-932.rtf'));
  assert.equal(blockText(jp.doc.blocks[0]!), '日本の港湾調査');
  assert.match(officeAccount(jp).join('\n'), /code page 932 \(Shift_JIS\)/);
  // A trail byte written as itself, as some writers do.
  assert.equal(text(doc("\\'82l\\'82r", '\\ansi\\ansicpg932')), 'ＭＳ');
  // A font's declared charset: Greek in a Western document.
  assert.equal(text(doc("\\f1 \\'c5\\'eb\\f0  \\'e9", '\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Arial;}{\\f1\\fnil\\fcharset161 Arial Greek;}}')), 'Ελ é');
  // No code page named: \ansi is Windows-1252, never a guess from the bytes.
  assert.equal(text("{\\rtf1\\ansi \\'93\\'fa}"), '“ú');
});

test('a code page the page has no decoder for says so, and shows what it cannot read as �', () => {
  const r = readRtfOffice(ascii("{\\rtf1\\ansi\\ansicpg1361 caf\\'82}"));
  assert.equal(blockText(r.doc.blocks[0]!), 'caf�');
  assert.match(officeAccount(r).join('\n'), /code page, 1361, is not one Marxy reads/);
});

test('DOS files read in their own code pages: \\pc is 437, \\pca is 850', () => {
  assert.equal(text("{\\rtf1\\pc caf\\'82 \\'b0}"), 'café ░');
  assert.equal(text("{\\rtf1\\pca caf\\'82 \\'9b}"), 'café ø');
});

/** RTF with raw bytes among its text: strings as ASCII, arrays as the bytes they hold. */
const raw = (...parts: (string | number[])[]): Uint8Array => Uint8Array.from(parts.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : x)));
const rawText = (...parts: (string | number[])[]): string => readRtf(raw(...parts)).blocks.map(blockText).join('\n');

test('bytes above 7F written raw are read as a byte by number is, in the code page; a raw pair is one character', () => {
  assert.equal(rawText('{\\rtf1\\ansi\\ansicpg1252 caf', [0xe9], ' ', [0x93], 'clear', [0x94], '}'), 'café “clear”');
  // Shift_JIS and GBK pairs, raw, and one raw byte beside one by number.
  assert.equal(rawText('{\\rtf1\\ansi\\ansicpg932 ', [0x93, 0xfa, 0x8d, 0x60], '}'), '日港');
  assert.equal(rawText('{\\rtf1\\ansi\\ansicpg932 ', [0x93], "\\'fa}"), '日');
  assert.equal(rawText('{\\rtf1\\ansi\\ansicpg936 ', [0xd6, 0xd0, 0xce, 0xc4], '}'), '中文');
  // UTF-8 only when the file says 65001, or names no code page and the run reads as nothing else.
  assert.equal(rawText('{\\rtf1\\ansi\\ansicpg65001 caf', [0xc3, 0xa9], '}'), 'café');
  assert.equal(rawText('{\\rtf1\\ansi caf', [0xc3, 0xa9], '}'), 'café');
  assert.equal(rawText('{\\rtf1\\ansi\\ansicpg1252 caf', [0xc3, 0xa9], '}'), 'cafÃ©');
  assert.equal(rawText('{\\rtf1\\ansi caf', [0xe9], '}'), 'café');
});

test('a store’s own text: a raw run that is well-formed UTF-8 is that text, whatever the file declares', () => {
  // Saved as UTF-8 though it says 1252.
  const saved = raw('{\\rtf1\\ansi\\ansicpg1252 caf', [0xc3, 0xa9], '}');
  assert.equal(blockText(readRtf(saved, { storeText: true }).blocks[0]!), 'café');
  // A legacy file as Source edited it: the store's UTF-8 Greek, and a lone raw byte that is not UTF-8 in the code page.
  const edited = raw('{\\rtf1\\ansi\\ansicpg1253 ', [...new TextEncoder().encode('Λιμάνι')], ' x', [0xe1], '}');
  assert.equal(blockText(readRtf(edited, { storeText: true }).blocks[0]!), 'Λιμάνι xα');
  // From the file's own bytes the code page alone applies.
  assert.equal(blockText(readRtf(saved).blocks[0]!), 'cafÃ©');
});

test('a control word longer than RTF allows is read whole and names nothing; Object’s own names are not words', () => {
  assert.equal(text(doc(`a\\${'x'.repeat(40)} b`)), 'ab');
  assert.equal(text(doc(`a\\${'q'.repeat(100_000)}9 b`)), 'ab');
  assert.equal(text(doc('a\\constructor b\\toString c\\hasOwnProperty d')), 'abcd');
});

test('control characters written by \\u are dropped as raw ones are', () => {
  assert.equal(text(doc('a\\u7?b\\u0?c\\u27?d\\u9?e')), 'abcd\te');
});

test('a field inside a field’s result counts toward what the outer one showed', () => {
  const r = text(doc('{\\field{\\*\\fldinst HYPERLINK "https://a.test/"}{\\fldrslt {\\field{\\*\\fldinst PAGE}{\\fldrslt https://a.test/}}}}'));
  assert.equal(r, 'https://a.test/');
  // The inner link's address, written after it, is not something the outer result showed.
  const nested = text(doc('{\\field{\\*\\fldinst HYPERLINK "https://b.test/"}{\\fldrslt {\\field{\\*\\fldinst HYPERLINK "https://a.test/"}{\\fldrslt site}}}}'));
  assert.equal(nested, 'site (https://a.test/) (https://b.test/)');
  const same = text(doc('{\\field{\\*\\fldinst HYPERLINK "https://a.test/"}{\\fldrslt {\\field{\\*\\fldinst HYPERLINK "https://b.test/"}{\\fldrslt https://a.test/}}}}'));
  assert.equal(same, 'https://a.test/ (https://b.test/)');
});

test('headings come from outline levels, heading styles, and type set larger than the body', () => {
  const styles = '\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}{\\stylesheet{\\s0 Normal;}{\\s1\\outlinelevel0 heading 1;}{\\s2 heading 2;}{\\*\\cs10 Default Paragraph Font;}}';
  const r = readRtf(ascii(doc('\\pard\\s1 Styled one\\par\\pard\\s2 Styled two\\par\\pard\\outlinelevel2 By level\\par\\pard Body text here\\par', styles)));
  assert.deepEqual(r.blocks.map((b) => (b.t === 'heading' ? `h${b.level} ${inlineText(b.kids)}` : `${b.t}`)), ['h1 Styled one', 'h2 Styled two', 'h3 By level', 'para']);
  const sized = readRtf(ascii(doc('\\fs48 Big\\par\\fs32 Middle\\par\\fs24 Body one\\par Body two that is longer\\par\\fs26 Barely larger\\par')));
  assert.deepEqual(sized.blocks.map((b) => (b.t === 'heading' ? `h${b.level}` : b.t)), ['h1', 'h2', 'para', 'para', 'para']);
  // One size throughout: no headings at all.
  assert.ok(readRtf(ascii(doc('\\fs40 One\\par Two\\par'))).blocks.every((b) => b.t === 'para'));
});

test('Word’s lists nest by level, bullets and numbers apart; a list starts where its numbering says', () => {
  const li = (mark: string, lvl: number, words: string): string => `\\pard\\ls1\\ilvl${lvl} {\\listtext\\pard\\plain ${mark}\\tab}${words}\\par`;
  const r = readRtf(ascii(doc(`${li('3.', 0, 'Three')}${li('a.', 1, 'Inner')}${li('4.', 0, 'Four')}\\pard After\\par${li("\\'b7", 0, 'Dot')}`)));
  const [first, after, second] = r.blocks as [Extract<Block, { t: 'list' }>, Block, Extract<Block, { t: 'list' }>];
  assert.equal(first.t, 'list');
  assert.equal(first.ordered, true);
  assert.equal(first.start, 3);
  assert.equal(first.items.length, 2);
  const inner = first.items[0]![1] as Extract<Block, { t: 'list' }>;
  assert.equal(inner.t, 'list');
  assert.equal(blockText(inner), 'Inner');
  assert.equal(blockText(after), 'After');
  assert.equal(second.ordered, false);
});

test('a table keeps empty cells and a cell’s paragraphs as lines; a table ends where its rows do', () => {
  const r = readRtf(ascii(doc('\\trowd\\cellx1000\\cellx2000\\cellx3000 \\pard\\intbl A\\cell\\cell one\\par two\\cell\\row\\pard After\\par')));
  const t = r.blocks[0] as Extract<Block, { t: 'table' }>;
  assert.equal(t.t, 'table');
  assert.equal(t.rows[0]!.length, 3);
  assert.equal(inlineText(t.rows[0]![1]!), '');
  assert.deepEqual(t.rows[0]![2]!.map((k) => k.t), ['run', 'br', 'run']);
  assert.equal(blockText(r.blocks[1]!), 'After');
});

test('fields show the text they last showed; a link’s address follows as text, a place in the document does not', () => {
  assert.equal(hyperlinkOf('HYPERLINK "https://a.test/x" \\o "tip"'), 'https://a.test/x');
  assert.equal(hyperlinkOf(' HYPERLINK https://a.test/y '), 'https://a.test/y');
  assert.equal(hyperlinkOf('HYPERLINK \\l "_Toc1"'), null);
  assert.equal(hyperlinkOf('PAGE \\* MERGEFORMAT'), null);
  const field = (inst: string, shown: string): string => `{\\field{\\*\\fldinst {${inst}}}{\\fldrslt {${shown}}}}`;
  assert.equal(text(doc(`See ${field('HYPERLINK "https://a.test/"', 'the site')}.`)), 'See the site (https://a.test/).');
  assert.equal(text(doc(`Page ${field('PAGE', '7')} of ${field('INCLUDETEXT "C:\\\\\\\\secret.txt"', 'old text')}`)), 'Page 7 of old text');
});

test('pictures and objects are named where they stand, their bytes counted, never decoded', () => {
  const hex = '89504e47'.repeat(512);
  const r = readRtf(ascii(doc(`Before {\\*\\shppict{\\pict\\pngblip\\picw10\\pich10 ${hex}}}{\\nonshppict{\\pict\\wmetafile8 0102}} after {\\object\\objemb{\\*\\objclass Excel.Sheet.12}{\\*\\objdata 0105000002000000}{\\result{\\pict\\emfblip 00}}} end`)));
  assert.deepEqual(r.images.map((i) => [i.what, i.alt]), [['held picture', 'PNG, 2 KB'], ['object', 'Excel.Sheet.12']]);
  const kids = (r.blocks[0] as Extract<Block, { t: 'para' }>).kids;
  assert.deepEqual(kids.map((k) => (k.t === 'run' ? k.text : k.t)), ['Before ', 'image', ' after ', 'image', ' end']);
});

test('the file’s own facts: title, author, who saved it, when, its pages', () => {
  const info = '{\\info{\\title Harbour notes}{\\author Ines Marlow}{\\operator Tom Reyes}{\\creatim\\yr2026\\mo3\\dy9\\hr14\\min5}{\\revtim\\yr2026\\mo10\\dy1}{\\nofpages3}}';
  const r = readRtf(ascii(`{\\rtf1\\ansi${info}\\pard Text\\par}`));
  assert.deepEqual(
    [r.props.title, r.props.creator, r.props.lastModifiedBy, r.props.created, r.props.modified, r.props.pages],
    ['Harbour notes', 'Ines Marlow', 'Tom Reyes', '2026-03-09T14:05:00', '2026-10-01T00:00:00', 3],
  );
  assert.equal(blockText(r.blocks[0]!), 'Text');
});

test('headers, footers, footnotes, comments and hidden or deleted text stay out, and the account names them', () => {
  const r = readRtfOffice(ascii(doc('{\\header Head}{\\footer Foot}Body{\\super\\chftn}{\\footnote Note}{\\v hidden}{\\deleted gone} end{\\*\\atnid x}{\\*\\annotation Comment}\\par')));
  assert.equal(blockText(r.doc.blocks[0]!), 'Body end');
  assert.match(officeAccount(r).join('\n'), /Also left out: headers and footers, footnotes, comments\./);
});

test('bytes that are not RTF are refused with a sentence', () => {
  assert.throws(() => readRtf(ascii('Just text')), (e: unknown) => e instanceof OfficeError && /\{\\rtf/.test((e as Error).message));
  // Space before the group, as some writers leave, is still RTF.
  assert.doesNotThrow(() => readRtf(ascii('\r\n {\\rtf1 ok}')));
});
