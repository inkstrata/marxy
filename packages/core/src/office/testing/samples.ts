// Small Word, PowerPoint and OpenDocument files built from their XML, for the tests and the demo: a survey report that
// uses every element the office page reads (headings, lists that nest and resume, a table with a merged cell, links,
// a field link, code, a quote, footnotes, an endnote, comments, a picture, a chart, a text box), and a deck with titles,
// bullets, a table, a picture and speaker notes. `storedZip` packs them; nothing here compresses. Pure.
import { crc32 } from '../../viewer/archive-read.ts';

const enc = new TextEncoder();
const X = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A zip of `files` (stored, no compression), in the order given. */
export function storedZip(files: Readonly<Record<string, string | Uint8Array>>): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  // 9 October 2026, 10:00, as a DOS date and time.
  const time = (10 << 11) | (0 << 5);
  const date = ((2026 - 1980) << 9) | (10 << 5) | 9;
  for (const [name, body] of Object.entries(files)) {
    const data = typeof body === 'string' ? enc.encode(body) : body;
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, at, true);
    locals.push(new Uint8Array(lh.buffer), nameBytes, data);
    central.push(new Uint8Array(ch.buffer), nameBytes);
    at += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, at, true);
  const parts = [...locals, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A PNG of `w` × `h` drawn by `px` (RGB), stored without compression. */
export function samplePng(w: number, h: number, px: (x: number, y: number) => readonly [number, number, number]): Uint8Array {
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 3 + 1) + 1 + x * 3);
  }
  // zlib: a header, stored blocks of at most 65,535 bytes, then the Adler-32 of the data.
  const blocks: number[] = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) {
    const n = Math.min(65535, raw.length - i);
    blocks.push(i + n >= raw.length ? 1 : 0, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255, ...raw.subarray(i, i + n));
  }
  let a = 1;
  let b = 0;
  for (const v of raw) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  blocks.push(b >> 8, b & 255, a >> 8, a & 255);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(enc.encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(blocks)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A tide curve over a week: the picture both samples hold. */
export const tidePng = (): Uint8Array =>
  samplePng(240, 96, (x, y) => {
    const level = 48 + 30 * Math.sin((x / 240) * Math.PI * 4.2) + 8 * Math.sin((x / 240) * Math.PI * 1.3);
    if (Math.abs(y - level) < 1.6) return [36, 92, 140];
    return y > level ? [214, 228, 238] : [246, 248, 250];
  });

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DRAW_NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CORE_NS = 'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

const t = (s: string): string => `<w:t xml:space="preserve">${X(s)}</w:t>`;
const r = (s: string, rPr = ''): string => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${t(s)}</w:r>`;
const p = (body: string, style?: string, extra = ''): string => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${body}</w:p>`;
const li = (body: string, num: number, level = 0): string => p(body, 'ListParagraph', `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${num}"/></w:numPr>`);
const cell = (body: string, span = 1): string => `<w:tc><w:tcPr>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr>${p(body)}</w:tc>`;

const styleXml = (id: string, name: string, more = ''): string => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${more}</w:style>`;

/** The parts of the sample Word document. */
export function wordParts(): Record<string, string | Uint8Array> {
  const picture = `<w:r><w:drawing><wp:inline><wp:extent cx="2286000" cy="914400"/><wp:docPr id="1" name="Picture 1" descr="A week of tide heights at the north gauge: two highs a day, the spring tide on Thursday"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const chart = `<w:r><w:drawing><wp:inline><wp:docPr id="2" name="Chart 2" descr="Dredged depth by berth"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const textBox = `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:docPr id="3" name="Text Box 3"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx><w:txbxContent>${p(r('In the margin box: readings are in metres above chart datum.'))}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox xmlns:v="urn:schemas-microsoft-com:vml"><w:txbxContent>${p(r('In the margin box: readings are in metres above chart datum.'))}</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
  const body = [
    p(r('Harbour Survey 2026'), 'Title'),
    p(`${r('Prepared for the harbour board after the autumn soundings. ')}<w:commentRangeStart w:id="0"/>${r('Depths are given in metres')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>${r(' and every figure was checked twice.')}`),
    p(r('Summary'), 'Heading1'),
    p(
      `${r('The channel is ')}${r('deep enough', '<w:b/>')}${r(' for the new ferry at every state of the tide, ')}${r('except', '<w:i/>')}${r(' at the lowest springs.')}<w:r><w:footnoteReference w:id="1"/></w:r>${r(' The old figure of ')}${r('4.1 m', '<w:strike/>')}${r(' is ')}${r('4.4 m', '<w:b/><w:i/>')}${r(' now; the depth is written ')}${r('d_min', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')}${r(' in the tables. Water is H')}${r('2', '<w:vertAlign w:val="subscript"/>')}${r('O, and the area is 12 km')}${r('2', '<w:vertAlign w:val="superscript"/>')}${r('.')}`,
    ),
    p(`${r('Read the board’s rules at ')}<w:hyperlink r:id="rIdLink">${r('the harbour site', '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>${r(', or see ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.org/tides" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r('the tide tables')}<w:r><w:fldChar w:fldCharType="end"/></w:r>${r('.')}`),
    p(`${r('Two comparisons hold: depth > draught, and "clear" means 0.5 m to spare.')}<w:r><w:br/></w:r>${r('A second line, after a break.')}`),
    p(r('What we did'), 'Heading1'),
    li(r('Sounded the channel on the flood'), 1),
    li(r('Logged each fix with the pole'), 1, 1),
    li(r('Repeated the line on the ebb'), 1, 1),
    li(r('Compared with the 2019 chart'), 1),
    li(r('Checked the gauge'), 1, 2),
    p(`${r('The gauge was found reading 3 cm high')}<w:r><w:endnoteReference w:id="1"/></w:r>${r('; it was reset on site.')}`),
    li(r('Wrote up the results'), 1),
    p(r('Equipment'), 'Heading2'),
    li(r('Echo sounder, 200 kHz'), 2),
    li(r('Tide pole, read by eye'), 2),
    li(`${r('Survey launch ')}${r('Kittiwake', '<w:i/>')}`, 2),
    p(r('Results by berth'), 'Heading1'),
    `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('<w:r><w:rPr><w:b/></w:rPr><w:t>Berth</w:t></w:r>')}${cell('<w:r><w:rPr><w:b/></w:rPr><w:t>Depth at LAT</w:t></w:r>')}${cell('<w:r><w:rPr><w:b/></w:rPr><w:t>Change</w:t></w:r>')}</w:tr><w:tr>${cell(r('North quay'))}${cell(r('6.2 m'))}${cell(r('+0.1 m'))}</w:tr><w:tr>${cell(r('Fish dock | inner'))}${cell(r('3.8 m'))}${cell(r('−0.3 m'))}</w:tr><w:tr>${cell(r('Slipway, not sounded this year'), 3)}</w:tr></w:tbl>`,
    p(picture),
    p(chart),
    p(r('Sounding record'), 'Heading2'),
    p(r('fix  time   depth'), 'Code'),
    p(r('01   09:12  6.24'), 'Code'),
    p(r('02   09:14  <6.10>'), 'Code'),
    p(r('The sea is the only surveyor that never misses a day.'), 'Quote'),
    p(r('Next steps'), 'Heading1'),
    p(`${r('Dredge the fish dock before the spring tides.')}<w:r><w:footnoteReference w:id="2"/></w:r>`),
    p(`<w:commentRangeStart w:id="1"/>${r('Survey again in March.')}<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>${textBox}`),
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
  ].join('');
  const footnote = (id: number, text: string): string => `<w:footnote w:id="${id}"><w:p><w:r><w:footnoteRef/></w:r>${r(` ${text}`)}</w:p></w:footnote>`;
  return {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS} ${DRAW_NS}><w:body>${body}</w:body></w:document>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="${REL}/numbering" Target="numbering.xml"/><Relationship Id="rIdFoot" Type="${REL}/footnotes" Target="footnotes.xml"/><Relationship Id="rIdEnd" Type="${REL}/endnotes" Target="endnotes.xml"/><Relationship Id="rIdComments" Type="${REL}/comments" Target="comments.xml"/><Relationship Id="rIdImg" Type="${REL}/image" Target="media/tides.png"/><Relationship Id="rIdLink" Type="${REL}/hyperlink" Target="https://example.org/harbour" TargetMode="External"/><Relationship Id="rIdTemplate" Type="${REL}/attachedTemplate" Target="https://example.org/template.dotx" TargetMode="External"/></Relationships>`,
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}>${styleXml('Normal', 'Normal')}${styleXml('Title', 'Title', '<w:basedOn w:val="Normal"/>')}${styleXml('Heading1', 'heading 1', '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr>')}${styleXml('Heading2', 'heading 2', '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr>')}${styleXml('ListParagraph', 'List Paragraph', '<w:basedOn w:val="Normal"/>')}${styleXml('Code', 'Code', '<w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr>')}${styleXml('Quote', 'Quote', '<w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr>')}<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`,
    'word/numbering.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    'word/footnotes.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${W_NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${footnote(1, 'Lowest astronomical tide, as the 2026 tables give it.')}${footnote(2, 'The dredging contract allows for two weeks of work.')}</w:footnotes>`,
    'word/endnotes.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:endnotes ${W_NS}><w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote><w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote><w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r>${r(' Gauge serial 7731, last calibrated in 2024.')}</w:p></w:endnote></w:endnotes>`,
    'word/comments.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W_NS}><w:comment w:id="0" w:author="Ines Marlow" w:date="2026-10-08T09:30:00Z" w:initials="IM">${p(r('Say which datum: chart datum, not mean sea level.'))}</w:comment><w:comment w:id="1" w:author="Tom Reyes" w:date="2026-10-09T16:05:00Z" w:initials="TR">${p(r('March suits the launch crew.'))}</w:comment></w:comments>`,
    'word/media/tides.png': tidePng(),
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties ${CORE_NS}><dc:title>Harbour Survey 2026</dc:title><dc:creator>Ines Marlow</dc:creator><cp:lastModifiedBy>Tom Reyes</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-10-02T08:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-09T16:10:00Z</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><Pages>3</Pages><Words>310</Words></Properties>',
  };
}

const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const at = (s: string, rPr = ''): string => `<a:r><a:rPr lang="en-GB"${rPr}/><a:t>${X(s)}</a:t></a:r>`;
const ap = (runs: string, pPr = ''): string => `<a:p>${pPr ? `<a:pPr${pPr}>` : ''}${pPr ? '</a:pPr>' : ''}${runs}</a:p>`;
const sp = (ph: string | null, paras: string, name = 'Shape'): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph ${ph}/>` : ''}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`;
const slideXml = (shapes: string, attrs = ''): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${P_NS}${attrs}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`;
const notesXml = (text: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${P_NS}><p:cSld><p:spTree>${sp('type="sldImg"', ap(''))}${sp('type="body" idx="1"', text)}${sp('type="sldNum" idx="5"', ap(at('1')))}</p:spTree></p:cSld></p:notes>`;

/** The parts of the sample deck. */
export function deckParts(): Record<string, string | Uint8Array> {
  const slides = [
    slideXml(`${sp('type="ctrTitle"', ap(at('Tide Gauge Upgrade')))}${sp('type="subTitle" idx="1"', ap(at('Harbour board, October 2026')))}${sp('type="ftr" idx="11"', ap(at('Confidential draft')))}`),
    slideXml(
      `${sp('type="title"', ap(at('Why replace the gauge')))}${sp('idx="1"', `${ap(at('The float gauge drifts 3 cm a year'))}${ap(at('Readings are logged by hand'), ' lvl="1"')}${ap(at('Twice a day, by the harbour master'), ' lvl="2"')}${ap(at('A radar gauge needs no stilling well'))}${ap(`${at('Spec: ')}${at('IEC 60529', ' b="1"')}${at(' and ')}${at('IP68', ' i="1"')}`)}`)}`,
    ),
    slideXml(
      `${sp('type="title"', ap(at('Costs')))}<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tr><a:tc><a:txBody>${ap(at('Item'))}</a:txBody></a:tc><a:tc><a:txBody>${ap(at('Cost'))}</a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody>${ap(at('Radar head'))}</a:txBody></a:tc><a:tc><a:txBody>${ap(at('£4,200'))}</a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody>${ap(at('Mast and fitting'))}</a:txBody></a:tc><a:tc><a:txBody>${ap(at('£1,150'))}</a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>${sp(null, ap(`${at('Quote from ')}<a:r><a:rPr lang="en-GB"><a:hlinkClick r:id="rIdLink"/></a:rPr><a:t>the supplier</a:t></a:r>${at(', valid to December.')}`), 'TextBox 5')}`,
    ),
    slideXml(
      `${sp('type="title"', ap(at('A week of readings')))}<p:pic><p:nvPicPr><p:cNvPr id="5" name="Picture 4" descr="Tide curve for the week of 5 October: two highs a day"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill><p:spPr/></p:pic>${sp(null, `${ap(at('Steps'))}${ap(at('Order the head'), '><a:buAutoNum type="arabicPeriod"/')}${ap(at('Fit it at neaps'), '><a:buAutoNum type="arabicPeriod"/')}`, 'TextBox 6')}`,
    ),
    slideXml(`${sp('idx="1"', ap(at('Questions, and a vote: depth > budget?')))}`, ' show="0"'),
  ];
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${P_NS}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rIdS${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`,
    'ppt/media/tides.png': tidePng(),
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties ${CORE_NS}><dc:title>Tide Gauge Upgrade</dc:title><dc:creator>Tom Reyes</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-10-05T09:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-07T17:45:00Z</dcterms:modified></cp:coreProperties>`,
  };
  const notes: Record<number, string> = {
    1: ap(at('Open with the drift figure; the board knows the old gauge.')),
    2: `${ap(at('Stress the stilling well: it silts up every winter.'))}${ap(at('Mention the 2019 survey.'))}`,
    4: ap(at('The picture is from the north gauge.')),
  };
  slides.forEach((xml, i) => {
    const n = i + 1;
    parts[`ppt/slides/slide${n}.xml`] = xml;
    const rels = [`<Relationship Id="rIdLayout" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
    if (notes[n]) {
      rels.push(`<Relationship Id="rIdNotes" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`);
      parts[`ppt/notesSlides/notesSlide${n}.xml`] = notesXml(notes[n]!);
    }
    if (n === 3) rels.push(`<Relationship Id="rIdLink" Type="${REL}/hyperlink" Target="https://example.org/radar-gauge" TargetMode="External"/>`);
    if (n === 4) rels.push(`<Relationship Id="rIdImg" Type="${REL}/image" Target="../media/tides.png"/>`);
    parts[`ppt/slides/_rels/slide${n}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
  });
  return parts;
}

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';

/** The parts of a short OpenDocument text: a heading, styled spans, a list, a table, a note, a comment and a link. */
export function odtParts(): Record<string, string | Uint8Array> {
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style><text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="1"/><text:list-level-style-bullet text:level="2" text:bullet-char="•"/></text:list-style></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">Mooring Register</text:h><text:p>Each buoy is <text:span text:style-name="T1">checked</text:span> in <text:span text:style-name="T2">spring</text:span>.<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>Before Easter.</text:p></text:note-body></text:note><office:annotation><dc:creator>Ines Marlow</dc:creator><dc:date>2026-10-08T10:00:00</dc:date><text:p>Add the new buoys.</text:p></office:annotation></text:p><text:list text:style-name="L1"><text:list-item><text:p>Lift the chain</text:p><text:list><text:list-item><text:p>Measure the wear</text:p></text:list-item></text:list></text:list-item><text:list-item><text:p>Paint the buoy</text:p></text:list-item></text:list><table:table table:name="Buoys"><table:table-row><table:table-cell><text:p>Buoy</text:p></table:table-cell><table:table-cell><text:p>Chain</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>B7</text:p></table:table-cell><table:table-cell><text:p>16 mm</text:p></table:table-cell></table:table-row></table:table><text:p>Rates are on <text:a xlink:type="simple" xlink:href="https://example.org/moorings">the board’s page</text:a>.</text:p></office:text></office:body></office:document-content>`;
  return {
    mimetype: 'application/vnd.oasis.opendocument.text',
    'content.xml': content,
    'meta.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${ODF_NS}><office:meta><dc:title>Mooring Register</dc:title><meta:initial-creator>Ines Marlow</meta:initial-creator><meta:creation-date>2026-09-30T09:00:00</meta:creation-date><dc:date>2026-10-08T10:05:00</dc:date></office:meta></office:document-meta>`,
  };
}

/** The parts of a two-page OpenDocument presentation with an outline and notes. */
export function odpParts(): Record<string, string | Uint8Array> {
  const frame = (cls: string, body: string): string => `<draw:frame presentation:class="${cls}"><draw:text-box>${body}</draw:text-box></draw:frame>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:body><office:presentation><draw:page draw:name="page1">${frame('title', '<text:p>Winter Moorings</text:p>')}${frame('outline', '<text:list><text:list-item><text:p>Lift the small buoys</text:p></text:list-item><text:list-item><text:p>Leave the fairway marks</text:p></text:list-item></text:list>')}<presentation:notes>${frame('notes', '<text:p>Ask about the fairway marks.</text:p>')}</presentation:notes></draw:page><draw:page draw:name="page2">${frame('title', '<text:p>Dates</text:p>')}${frame('outline', '<text:p>From 1 November</text:p>')}</draw:page></office:presentation></office:body></office:document-content>`;
  return { mimetype: 'application/vnd.oasis.opendocument.presentation', 'content.xml': content };
}

/** A part reader over `parts`, as the shell's zip reader hands parts over. */
export const partsReader =
  (parts: Readonly<Record<string, string | Uint8Array>>) =>
  async (name: string): Promise<Uint8Array | null> => {
    const v = parts[name];
    return v === undefined ? null : typeof v === 'string' ? enc.encode(v) : v;
  };
