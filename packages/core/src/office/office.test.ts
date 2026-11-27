// The office readers over files built here from their XML (samples.ts): what each element becomes, that the text can
// never become markup, and the XML reader's refusals and caps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSafeHtml } from '../render/pipeline.ts';
import { escapeText, IMAGE_SCHEME, officeAccount, officeFormatOf, officeHeadLine, readOffice, writeMarkdown } from './index.ts';
import { run } from './model.ts';
import { deckParts, odpParts, odtParts, partsReader, storedZip, wordParts } from './testing/samples.ts';
import { OfficeError, readXml, type XmlBudget } from './xml.ts';

const html = (md: string): string => renderSafeHtml(md, { file: 'office.md' }).html;
/** The text a reader sees: tags gone, the five escapes undone, and the page's typography (curly quotes, a dash for two
 * hyphens) taken back, as it is on every Markdown page. */
const seen = (h: string): string =>
  h
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/–/g, '--');

test('a Word document reads as its headings, paragraphs, lists, table, notes and comments', async () => {
  const r = await readOffice('docx', partsReader(wordParts()));
  const md = r.markdown;
  assert.match(md, /^# Harbour Survey 2026\n/);
  // A Title sits above Heading 1, so the headings move down one.
  assert.match(md, /\n## Summary\n/);
  assert.match(md, /\n### Equipment\n/);
  assert.match(md, /<strong>deep enough<\/strong>/);
  assert.match(md, /<em>except<\/em>/);
  assert.match(md, /<s>4\\\.1 m<\/s>/);
  assert.match(md, /<code>d\\_min<\/code>/);
  assert.match(md, /H<sub>2<\/sub>O/);
  assert.match(md, /km<sup>2<\/sup>/);
  assert.match(md, /\[the harbour site\]\(<https:\/\/example\.org\/harbour>\)/);
  assert.match(md, /\[the tide tables\]\(<https:\/\/example\.org\/tides>\)/, 'a HYPERLINK field is a link');
  // The list nests, and resumes its numbering after the paragraph that interrupts it.
  assert.match(md, /1\) Sounded the channel on the flood\n {3}\* Logged each fix with the pole\n {3}\* Repeated the line on the ebb\n2\) Compared/);
  assert.match(md, /\n3\) Wrote up the results\n/);
  assert.match(md, /\| Fish dock &#124; inner \| 3\\\.8 m \|/);
  assert.match(md, /```\nfix {2}time {3}depth\n01 {3}09:12 {2}6\.24\n02 {3}09:14 {2}<6\.10>\n```/, 'code paragraphs are one block, as typed');
  assert.match(md, /\n> The sea is the only surveyor/);
  assert.match(md, new RegExp(`!\\[A week of tide heights[^\\]]*\\]\\(${IMAGE_SCHEME}:0\\)`));
  assert.equal(r.doc.images[0]?.entry, 'word/media/tides.png');
  assert.equal(r.doc.images[1]?.what, 'chart');
  assert.match(md, /In the margin box/, 'a text box is read after its paragraph');
  assert.equal((md.match(/In the margin box/g) ?? []).length, 1, 'once, not again from its fallback');
  // Notes in the order the text marks them, footnotes and endnotes together.
  assert.deepEqual([...md.matchAll(/^\[\^(\w+)\]:/gm)].map((m) => m[1]), ['n1', 'n2', 'n3']);
  assert.match(md, /springs\\.\[\^n1\]/);
  assert.match(md, /high\[\^n2\]/);
  // Comments, as asides after the paragraph they are on.
  assert.equal(r.asides.length, 2);
  const first = new TextDecoder().decode(new TextEncoder().encode(md).subarray(r.asides[0]!.start, r.asides[0]!.end));
  assert.match(first, /^Say which datum/);
  assert.equal(r.asides[0]!.who, 'Ines Marlow');
  assert.deepEqual(r.doc.counts, { comments: 2, footnotes: 2, endnotes: 1, slides: 0, hiddenSlides: 0, speakerNotes: 0 });
  assert.ok(r.doc.leftOut.has('headers and footers'));
  assert.ok(r.doc.leftOut.has('charts'));
  assert.equal(r.doc.props.title, 'Harbour Survey 2026');
  assert.equal(r.doc.props.creator, 'Ines Marlow');
  assert.equal(r.doc.props.modified, '2026-10-09T16:10:00Z');
  assert.equal(r.doc.props.pages, 3);
  assert.match(officeHeadLine(r), /^Word document · \d+ words · 3 notes · 2 comments$/);
  assert.ok(officeAccount(r).some((l) => /Fonts, colours, page size/.test(l)));
});

test('the Word page renders through the Markdown renderer as typed', async () => {
  const r = await readOffice('docx', partsReader(wordParts()));
  const h = html(r.markdown);
  assert.match(h, /<h1[^>]*>Harbour Survey 2026<\/h1>/);
  assert.match(h, /<ol class="marxy-footnotes">/);
  assert.match(h, /<table/);
  assert.match(h, /<img alt="A week of tide heights/);
  assert.doesNotMatch(h, /office-image:/, 'the stand-in address never reaches the page');
  const text = seen(h);
  assert.match(text, /depth > draught, and "clear" means 0\.5 m to spare/);
  assert.match(text, /Fish dock \| inner/);
  assert.match(text, /09:14 {2}<6\.10>/);
});

test('a deck reads as its slides in order, with titles, bullets, a table, a picture and notes', async () => {
  const r = await readOffice('pptx', partsReader(deckParts()));
  const md = r.markdown;
  assert.deepEqual(
    r.slides.map((s) => [s.n, s.title, s.hidden]),
    [
      [1, 'Tide Gauge Upgrade', false],
      [2, 'Why replace the gauge', false],
      [3, 'Costs', false],
      [4, 'A week of readings', false],
      [5, '', true],
    ],
  );
  assert.match(md, /^## Tide Gauge Upgrade\n\nHarbour board, October 2026\n/);
  assert.doesNotMatch(md, /Confidential draft/, 'a footer placeholder is not the slide’s text');
  assert.match(md, /\* The float gauge drifts 3 cm a year\n {2}- Readings are logged by hand\n {4}\* Twice a day/);
  assert.match(md, /<strong>IEC 60529<\/strong>/);
  assert.match(md, /\| Radar head \| £4,200 \|/);
  assert.match(md, /\[the supplier\]\(<https:\/\/example\.org\/radar-gauge>\)/);
  assert.match(md, /^Steps\n\n1\) Order the head\n2\) Fit it at neaps$/m, 'a text box is paragraphs unless it numbers them');
  assert.match(md, /## Slide 5\n/);
  assert.equal(r.asides.length, 3);
  assert.ok(r.asides.every((a) => a.who === 'Speaker notes'));
  assert.equal(officeHeadLine(r), 'PowerPoint deck · 5 slides · 1 hidden · notes on 3');
  const h = html(md);
  assert.match(seen(h), /a vote: depth > budget\?/);
});

test('OpenDocument text and presentations read through the same model', async () => {
  const t = await readOffice('odt', partsReader(odtParts()));
  assert.match(t.markdown, /^# Mooring Register\n/);
  assert.match(t.markdown, /<strong>checked<\/strong> in <em>spring<\/em>/);
  assert.match(t.markdown, /1\) Lift the chain\n {3}\* Measure the wear\n2\) Paint the buoy/);
  assert.match(t.markdown, /\| B7 \| 16 mm \|/);
  assert.match(t.markdown, /\[\^n1\]: Before Easter/);
  assert.equal(t.asides[0]?.who, 'Ines Marlow');
  assert.equal(t.doc.props.creator, 'Ines Marlow');
  const p = await readOffice('odp', partsReader(odpParts()));
  assert.deepEqual(
    p.slides.map((s) => s.title),
    ['Winter Moorings', 'Dates'],
  );
  assert.match(p.markdown, /\* Lift the small buoys\n\* Leave the fairway marks/);
  assert.equal(p.asides.length, 1);
});

test('a document’s text never becomes markup', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '# not a heading',
    '1. not a list',
    '- not a bullet',
    '> not a quote',
    '**not bold** _nor this_ `nor code`',
    'a | b | c',
    '$x^2$ and $$y$$',
    '[^fn1] and ![pic](office-image:0)',
    'https://example.org and www.example.org and a@b.co',
    '&amp; &lt; &#x41; \\ back\\slash',
    '===',
    '<!-- a comment -->',
    'a > b, "quotes" and \'single\'',
  ];
  for (const s of hostile) {
    const doc = { blocks: [{ t: 'para' as const, kids: [run(s)] }], notes: [], images: [] };
    const h = html(writeMarkdown(doc).markdown);
    assert.doesNotMatch(h, /<(script|img|a|h1|ol|ul|li|blockquote|code|strong|em|table|sup)\b/, `${s} stayed text: ${h}`);
    assert.equal(seen(h).trim(), s, `${s} reads as typed`);
    assert.equal(seen(html(escapeText(s))).trim(), s);
  }
});

test('the XML reader refuses a document type and expands no entity of its own', () => {
  const budget = (): XmlBudget => ({ elements: 1000, chars: 1000, bytes: 1_000_000 });
  assert.throws(() => readXml('<!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>', budget(), 'p.xml'), OfficeError);
  const el = readXml('<x a="&lt;&amp;&#65;&bogus;">&quot;&#x1F600;&nope;</x>', budget(), 'p.xml');
  assert.equal(el.attrs.a, '<&A&bogus;');
  assert.equal(el.kids[0], '"\u{1F600}&nope;');
  assert.throws(() => readXml('<x>'.repeat(5) + '</x>'.repeat(4), budget(), 'p.xml'), /not closed/);
  assert.throws(() => readXml('<a><b></a></b>', budget(), 'p.xml'), /closes/);
});

test('the XML reader stops at its element and text caps', () => {
  assert.throws(() => readXml(`<x>${'<y/>'.repeat(20)}</x>`, { elements: 10, chars: 1000, bytes: 1_000_000 }, 'p.xml'), /XML elements/);
  assert.throws(() => readXml(`<x>${'z'.repeat(2000)}</x>`, { elements: 10, chars: 1000, bytes: 1_000_000 }, 'p.xml'), /MB of text/);
  assert.throws(() => readXml('<a>'.repeat(300) + '</a>'.repeat(300), { elements: 1000, chars: 1000, bytes: 1_000_000 }, 'p.xml'), /nests deeper/);
});

test('an external relationship is kept as an address and never read', async () => {
  const asked: string[] = [];
  const parts = wordParts();
  const read = partsReader(parts);
  await readOffice('docx', async (name) => {
    asked.push(name);
    return read(name);
  });
  assert.ok(asked.every((n) => !/^[a-z]+:/i.test(n) && !n.includes('template')), asked.join(', '));
});

test('a file that is not the format it is named says so', async () => {
  await assert.rejects(readOffice('docx', partsReader({ 'readme.txt': 'hello' })), /no Word document part/);
  await assert.rejects(readOffice('pptx', partsReader({ 'ppt/presentation.xml': '<p:presentation' })), OfficeError);
});

test('formats by name; the samples pack as zips', () => {
  assert.equal(officeFormatOf('/a/Report.DOCX'), 'docx');
  assert.equal(officeFormatOf('deck.pptx'), 'pptx');
  assert.equal(officeFormatOf('notes.odt'), 'odt');
  assert.equal(officeFormatOf('old.doc'), 'doc');
  assert.equal(officeFormatOf('old.xls'), null);
  const zip = storedZip(wordParts());
  assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});
