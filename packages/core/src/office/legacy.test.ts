// A Word 97-2003 document's or deck's reading, as the shell answers it, made the office page's: its shape checked, its
// head line and account, and text that looks like markup kept as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeAccount, officeFormatOf, officeHeadLine, OfficeError, readLegacyOffice, type LegacyOffice } from './index.ts';

const base = { images: [], props: { title: 'Survey', subject: null, creator: 'R. Marsh', lastModifiedBy: null, created: null, modified: null, application: null, pages: null }, slides: 0, hiddenSlides: 0, speakerNotes: 0, leftOut: [], cut: [] };

test('a .doc and a .ppt are named for the office page', () => {
  assert.equal(officeFormatOf('/r/Old Report.DOC'), 'doc');
  assert.equal(officeFormatOf('/r/deck.ppt'), 'ppt');
});

test('a document reads as its blocks, its text escaped, with what it holds and leaves out said', () => {
  const doc: LegacyOffice = {
    ...base,
    format: 'doc',
    blocks: [
      { t: 'heading', level: 1, kids: [{ t: 'run', text: 'Soundings' }] },
      { t: 'para', kids: [{ t: 'run', text: '# not a heading, **not bold**', b: true }, { t: 'image', image: 0 }] },
    ],
    images: [{ what: 'held picture', alt: '' }],
    leftOut: ['macros'],
    cut: ['The text runs past 16 MB: the rest of it is not read.'],
  };
  const r = readLegacyOffice(doc);
  assert.match(r.markdown, /^# Soundings\n/);
  assert.ok(r.markdown.includes('<strong>\\# not a heading, \\*\\*not bold\\*\\*</strong>![](office-image:0)'), r.markdown);
  assert.equal(officeHeadLine(r), 'Word 97-2003 document · 7 words');
  const account = officeAccount(r).join('\n');
  assert.match(account, /numbered list are not read/);
  assert.match(account, /named where they stand, never drawn or run/);
  assert.match(account, /Also left out: macros\./);
  assert.deepEqual(r.doc.cut, doc.cut);
  assert.equal(r.doc.props.creator, 'R. Marsh');
  assert.equal(r.doc.images[0]?.entry, null);
});

test('a deck reads as its slides with their numbers', () => {
  const r = readLegacyOffice({
    ...base,
    format: 'ppt',
    blocks: [
      { t: 'heading', level: 2, kids: [{ t: 'run', text: 'One' }], slide: { n: 1, hidden: false } },
      { t: 'heading', level: 2, kids: [], slide: { n: 2, hidden: true } },
    ],
    slides: 2,
    hiddenSlides: 1,
  });
  assert.equal(officeHeadLine(r), 'PowerPoint 97-2003 deck · 2 slides · 1 hidden');
  assert.deepEqual(r.slides.map((s) => [s.n, s.title, s.hidden]), [[1, 'One', false], [2, '', true]]);
});

test('an answer of another shape is refused with a sentence', () => {
  assert.throws(() => readLegacyOffice({ ...base, format: 'xls' as 'doc', blocks: [] }), OfficeError);
  assert.throws(() => readLegacyOffice({ ...base, format: 'doc', blocks: null as unknown as [] }), OfficeError);
});
