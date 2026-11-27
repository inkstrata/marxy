// The office readers against files written to break them: ids that try to become Markdown, addresses that try to end a
// table's row, a deck that lists one slide without end, attributes that try to fill the memory, marks by the tens of
// thousands; RTF that nests without end, hides a picture's worth of hex, hides braces in raw bytes, and fields and objects
// that would fetch or run something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSafeHtml } from '../render/pipeline.ts';
import { readOffice, readRtfOffice, writeMarkdown } from './index.ts';
import { run } from './model.ts';
import { openPackage } from './parts.ts';
import { deckParts, partsReader, wordParts } from './testing/samples.ts';
import { RTF_LIMITS } from './rtf.ts';
import { OfficeError, readXml } from './xml.ts';

const html = (md: string): string => renderSafeHtml(md, { file: 'office.md' }).html;
const X = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The sample document with its first footnote's id, in the text and in the notes part, made `id`. */
function withNoteId(id: string): Record<string, string | Uint8Array> {
  const parts = wordParts();
  parts['word/document.xml'] = String(parts['word/document.xml']).replace('<w:footnoteReference w:id="1"/>', `<w:footnoteReference w:id="${X(id)}"/>`);
  parts['word/footnotes.xml'] = String(parts['word/footnotes.xml']).replace('<w:footnote w:id="1">', `<w:footnote w:id="${X(id)}">`);
  return parts;
}

test('a note’s id never reaches the Markdown: notes are labelled by their order', async () => {
  for (const id of ['a] **b** [click](https://evil.test) ["', 'x&#10;&#10;# Owned&#10;&#10;[^y', '1]: [x](javascript:alert(1))\n\n<script>']) {
    const r = await readOffice('docx', partsReader(withNoteId(id)));
    assert.deepEqual([...r.markdown.matchAll(/\[\^([^\]]*)\]/g)].map((m) => m[1]).sort(), ['n1', 'n1', 'n2', 'n2', 'n3', 'n3'], id);
    const h = html(r.markdown);
    assert.doesNotMatch(h, /evil\.test|javascript:|<script|<h1[^>]*>Owned/, id);
    assert.match(h, /Lowest astronomical tide/, id);
    assert.equal(r.doc.counts.footnotes, 2);
  }
});

test('the writer labels notes itself, whatever labels the model carries, and drops a mark with no note', () => {
  const md = writeMarkdown({
    blocks: [{ t: 'para', kids: [run('a'), { t: 'note', label: 'x] [y](https://evil.test)' }, run('b'), { t: 'note', label: 'missing' }] }],
    notes: [{ label: 'x] [y](https://evil.test)', blocks: [{ t: 'para', kids: [run('the note')] }] }],
    images: [],
  }).markdown;
  assert.equal(md, 'a[^n1]b\n\n[^n1]: the note\n');
});

test('a list’s first number is a number Markdown reads, whatever the file says', () => {
  for (const [start, want] of [
    [Number.NaN, '1.'],
    [-5, '0.'],
    [1.7, '1.'],
    [1e15, '999999000.'],
  ] as const) {
    const md = writeMarkdown({ blocks: [{ t: 'list', ordered: true, start, items: [[{ t: 'para', kids: [run('one')] }]] }], notes: [], images: [] }).markdown;
    assert.equal(md, `${want.replace('.', ')')} one\n`, String(start));
    assert.match(html(md), /<ol/);
  }
});

test('a link’s address cannot end a table’s row or carry Markdown', () => {
  const href = 'https://example.org/a|b*c_d`e[f]g!h(i)j k';
  const md = writeMarkdown({
    blocks: [{ t: 'table', rows: [[[run('head')], [run('more')]], [[{ t: 'link', href, kids: [run('site')] }], [run('x')]]] }],
    notes: [],
    images: [],
  }).markdown;
  assert.match(md, /\(<https:\/\/example\.org\/a%7Cb%2Ac%5Fd%60e%5Bf%5Dg%21h%28i%29j%20k>\)/);
  const h = html(md);
  assert.equal((h.match(/<td/g) ?? []).length, 2, h);
  assert.match(h, /href="https:\/\/example\.org\/a%7Cb%2Ac%5Fd%60e%5Bf%5Dg%21h%28i%29j%20k"/);
});

test('a deck that lists one slide over and over shows it once and reads it once', async () => {
  const parts = deckParts();
  parts['ppt/presentation.xml'] = String(parts['ppt/presentation.xml']).replace(/<p:sldIdLst>.*<\/p:sldIdLst>/, `<p:sldIdLst>${'<p:sldId id="256" r:id="rIdS2"/>'.repeat(5000)}</p:sldIdLst>`);
  const asked = new Map<string, number>();
  const read = partsReader(parts);
  const r = await readOffice('pptx', async (name) => {
    asked.set(name, (asked.get(name) ?? 0) + 1);
    return read(name);
  });
  assert.equal(r.doc.counts.slides, 1);
  assert.equal(r.slides.length, 1);
  assert.equal(asked.get('ppt/slides/slide2.xml'), 1);
});

test('attributes and parts are charged against one budget for the document', async () => {
  const many = `<x ${Array.from({ length: 2000 }, (_, i) => `a${i}="${'v'.repeat(20)}"`).join(' ')}/>`;
  assert.throws(() => readXml(many, { elements: 10, chars: 1000, bytes: 50_000 }, 'p.xml'), /MB of XML/);
  assert.doesNotThrow(() => readXml(many, { elements: 10, chars: 1000, bytes: 1_000_000 }, 'p.xml'));
  // Two parts that fit alone do not fit together.
  const part = new TextEncoder().encode(`<x>${'y'.repeat(40_000)}</x>`);
  const pkg = openPackage(async () => part, { elements: 1000, chars: 1_000_000, bytes: 60_000 });
  await pkg.xml('a.xml');
  await assert.rejects(pkg.xml('b.xml'), OfficeError);
});

test('tens of thousands of note marks read in linear time', async () => {
  const marks = 60_000;
  const parts = wordParts();
  parts['word/document.xml'] = `<w:document xmlns:w="w"><w:body><w:p>${Array.from({ length: marks }, (_, i) => `<w:r><w:footnoteReference w:id="${i}"/></w:r>`).join('')}</w:p></w:body></w:document>`;
  const t0 = performance.now();
  const r = await readOffice('docx', partsReader(parts));
  const ms = performance.now() - t0;
  assert.equal(r.doc.notes.length, 2, 'only the notes the file holds are listed');
  // Linear is a fraction of a second here; marks checked against a list were tens of seconds.
  assert.ok(ms < 8000, `${Math.round(ms)} ms`);
});

const rtfBytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const rtfText = (r: ReturnType<typeof readRtfOffice>): string => html(r.markdown).replace(/<[^>]+>/g, '');

test('RTF nested ten thousand braces deep stops at the depth cap, reads what is either side, and says so', () => {
  const deep = 10_000;
  const r = readRtfOffice(rtfBytes(`{\\rtf1\\ansi before ${'{'.repeat(deep)}lost${'}'.repeat(deep)} after\\par}`));
  assert.match(rtfText(r), /before\s+after/);
  assert.doesNotMatch(rtfText(r), /lost/);
  assert.equal(r.doc.cut?.length, 1);
  assert.match(r.doc.cut![0]!, new RegExp(`more than ${RTF_LIMITS.depth} deep`));
  // Unclosed, it still ends.
  const open = readRtfOffice(rtfBytes(`{\\rtf1 start ${'{'.repeat(deep)}`));
  assert.match(rtfText(open), /start/);
});

test('RTF with a picture of tens of megabytes of hex steps over it in linear time, names it, and reads on', () => {
  const hexBytes = 40 * 1024 * 1024;
  const head = rtfBytes('{\\rtf1\\ansi Before {\\pict\\jpegblip ');
  const tail = rtfBytes('} after\\par}');
  const bytes = new Uint8Array(head.length + hexBytes + tail.length);
  bytes.set(head, 0);
  bytes.fill(0x61, head.length, head.length + hexBytes);
  bytes.set(tail, head.length + hexBytes);
  const t0 = performance.now();
  const r = readRtfOffice(bytes);
  const ms = performance.now() - t0;
  assert.deepEqual(r.doc.images.map((i) => [i.what, i.alt]), [['held picture', 'JPEG, 20.0 MB']]);
  assert.match(r.markdown, /Before !\[JPEG, 20\\\.0 MB\]\(office-image:0\) after/);
  assert.ok(ms < 8000, `${Math.round(ms)} ms`);
});

test('RTF text past the output cap is not read, and the page says where it stopped', () => {
  const over = RTF_LIMITS.chars + 1024;
  const head = rtfBytes('{\\rtf1\\ansi ');
  const bytes = new Uint8Array(head.length + over + 1);
  bytes.set(head, 0);
  bytes.fill(0x78, head.length, head.length + over);
  bytes[bytes.length - 1] = 0x7d;
  const r = readRtfOffice(bytes);
  assert.ok(r.markdown.length <= RTF_LIMITS.chars + 16, String(r.markdown.length));
  assert.match(r.doc.cut!.join(' '), /Only the first 16 MB of text is read/);
});

test('RTF naming more pictures than the cap names the first ones, reads on, and says how many it left out', () => {
  const over = 7;
  const pictures = '{\\pict\\pngblip 00}'.repeat(RTF_LIMITS.objects + over);
  const r = readRtfOffice(rtfBytes(`{\\rtf1\\ansi before ${pictures} after\\par}`));
  assert.equal(r.doc.images.length, RTF_LIMITS.objects);
  assert.match(rtfText(r), /before[\s\S]*after/);
  // Thousands of groups side by side are not nesting: none of them is skipped as deep.
  assert.deepEqual(r.doc.cut, [`Only the first 10,000 pictures and objects are named; ${over} more are left out.`]);
});

test('RTF raw bytes after \\bin are data: braces and words among them change nothing', () => {
  const r = readRtfOffice(rtfBytes('{\\rtf1 one {\\pict\\pngblip\\bin12 }}}{{{\\par x} two\\par}'));
  assert.match(rtfText(r), /one\s+two/);
  assert.deepEqual(r.doc.images.map((i) => i.alt), ['PNG, 12 bytes']);
  // A count past the end of the file stops at the end.
  assert.doesNotThrow(() => readRtfOffice(rtfBytes('{\\rtf1 x\\bin99999999999 }')));
});

test('RTF text that looks like markup stays text; a field’s address, however hostile, is never a link', () => {
  const field = (inst: string, shown: string): string => `{\\field{\\*\\fldinst {${inst}}}{\\fldrslt {${shown}}}}`;
  const body = [
    '<script>alert(1)</script>',
    '[click](javascript:alert(1))',
    '# not a heading',
    field('HYPERLINK "javascript:alert(1)"', 'run me'),
    field('HYPERLINK "file:///C:/Windows/System32/calc.exe"', 'calc'),
    field('INCLUDEPICTURE "https://tracker.test/pixel.png" \\\\d', 'old picture'),
    '\\trowd\\cellx1 \\pard\\intbl a | b\\cell\\row',
  ].join('\\par ');
  const r = readRtfOffice(rtfBytes(`{\\rtf1\\ansi ${body}\\par}`));
  const h = html(r.markdown);
  assert.doesNotMatch(h, /<script|<a\b|<h1|href=|src="https/, h);
  assert.match(rtfText(r), /run me \(javascript:alert\(1\)\)/);
  assert.match(rtfText(r), /calc \(file:\/\/\/C:\/Windows\/System32\/calc\.exe\)/);
  assert.match(rtfText(r), /old picture/);
  assert.doesNotMatch(rtfText(r), /tracker/);
  assert.equal((h.match(/<t[hd]\b/g) ?? []).length, 1, h);
});

test('an embedded RTF object is named by its class; its data is never decoded or shown', () => {
  const data = Array.from(new TextEncoder().encode('MZ secret payload'), (b) => b.toString(16).padStart(2, '0')).join('');
  const r = readRtfOffice(rtfBytes(`{\\rtf1 x {\\object\\objemb{\\*\\objclass Package}{\\*\\objdata ${data}}{\\result secret result}} y\\par}`));
  assert.deepEqual(r.doc.images.map((i) => [i.what, i.alt]), [['object', 'Package']]);
  assert.doesNotMatch(r.markdown, /secret|payload|MZ/);
});

test('RTF badly made ends cleanly: stray closes, a lone backslash, cut escapes, words and numbers too long', () => {
  for (const s of ['{\\rtf1 a}}}} b', '{\\rtf1 a\\', "{\\rtf1 a\\'", "{\\rtf1 a\\'4", `{\\rtf1 \\${'x'.repeat(100)} a}`, `{\\rtf1 \\fs${'9'.repeat(40)} a}`, '{\\rtf1 \\uc999999\\u65 abc}', '{\\rtf1 \\u99999999999 a}']) {
    assert.doesNotThrow(() => readRtfOffice(rtfBytes(s)), s);
  }
  // A skip count is held to what a character could need.
  assert.match(rtfText(readRtfOffice(rtfBytes(`{\\rtf1 \\uc999999\\u65 ${'b'.repeat(20)}}`))), /^Ab{4}/);
});

test('raw bytes after \\bin inside a group past the depth cap are stepped over, braces and all', () => {
  const deep = RTF_LIMITS.depth + 50;
  const r = readRtfOffice(rtfBytes(`{\\rtf1 a ${'{'.repeat(deep)}\\bin3 }}}${'}'.repeat(deep)} b\\par}`));
  assert.match(rtfText(r), /a\s+b/);
});
