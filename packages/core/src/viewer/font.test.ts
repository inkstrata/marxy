// A font's page model: the line, the specimen's sets, a variable font's style at its sliders, the Font card's words,
// and a collection's face lifted into a font of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  codeWords,
  containerWords,
  coverageWords,
  embeddingWords,
  fontLine,
  gridChars,
  instanceAt,
  isCollection,
  liftFace,
  nameRows,
  outlineOf,
  specimenSets,
  styleAt,
  tableWords,
  unitsWords,
  valuesOf,
  variationSettings,
  weightWords,
  type FontFace,
  type FontFacts,
  type FontNames,
} from './font.ts';

const demo = (p: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../fixtures/demo/fonts/${p}`, import.meta.url)));

const names = (o: Partial<FontNames> = {}): FontNames => ({
  copyright: null, family: 'Tidemark Sans', style: 'Regular', full: 'Tidemark Sans Regular', version: null, postscript: null, trademark: null, maker: null,
  designer: null, description: null, vendorUrl: null, designerUrl: null, licence: null, licenceUrl: null, typoFamily: null, typoStyle: null, sample: null, ...o,
});

const face = (o: Partial<FontFace> = {}): FontFace => ({
  names: names(), tables: ['OS/2', 'cmap', 'glyf', 'head', 'name'], outlines: 'glyf', unitsPerEm: 1000, glyphs: 94, weight: 400, widthClass: 5, embedding: 0, vendor: null,
  capHeight: 700, xHeight: 500, fixedPitch: false, italic: false, axes: [], instances: [], chars: 93,
  coverage: [{ name: 'Basic Latin', count: 83 }, { name: 'Latin-1', count: 2 }], mapped: [0x20, 0x41, 0x42, 0x61, 0x31, 0x2192], glyphNames: false, ...o,
});

const variable = face({
  axes: [{ tag: 'wght', name: 'Weight', min: 300, default: 400, max: 800, hidden: false }, { tag: 'wdth', name: 'Width', min: 75, default: 100, max: 100, hidden: false }],
  instances: [{ name: 'Regular', coords: [400, 100] }, { name: 'Bold', coords: [700, 100] }, { name: 'Condensed Bold', coords: [700, 75] }],
});

const facts = (o: Partial<FontFacts> = {}): FontFacts => ({ format: 'truetype', size: 9356, unpacked: null, directory: [], faces: [face()], why: null, ...o });

test('the line above the specimen says the format, the glyphs and the axes', () => {
  assert.equal(fontLine(facts(), face()), 'TrueType · 94 glyphs');
  assert.equal(fontLine(facts({ faces: [variable] }), variable), 'TrueType · 94 glyphs · variable: wght, wdth');
  assert.equal(fontLine(facts({ format: 'collection', faces: [face(), face(), face()] }), face()), 'a font collection · 3 faces · 94 glyphs');
});

test('a variable font between instances says its values; on one, the instance', () => {
  assert.equal(styleAt(variable, { wght: 700, wdth: 100 }), 'Bold');
  assert.equal(styleAt(variable, { wght: 720, wdth: 78 }), 'wght 720 · wdth 78');
  assert.equal(variationSettings(variable, { wght: 720, wdth: 78 }), "'wght' 720, 'wdth' 78");
  assert.equal(variationSettings(face(), {}), 'normal');
  assert.equal(instanceAt(variable, valuesOf(variable, variable.instances[2]!))?.name, 'Condensed Bold');
  assert.equal(instanceAt(variable, { wght: 701, wdth: 100 }), null);
  assert.equal(styleAt(face(), {}), 'Regular');
});

test('the specimen keeps each set to what the font maps, and the grid leaves out space', () => {
  assert.deepEqual(specimenSets([0x41, 0x42, 0x61, 0x31, 0x2192]), [
    { label: 'Capitals', text: 'AB' },
    { label: 'Lower case', text: 'a' },
    { label: 'Figures', text: '1' },
    { label: 'Marks', text: '→' },
  ]);
  assert.equal(specimenSets(null)[0]!.text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  assert.deepEqual(gridChars([0x20, 0x41, 0x7f, 0x85, 0xa3]), [0x41, 0xa3]);
  assert.equal(codeWords(0x41), '0041');
  assert.equal(codeWords(0x1f600), '1F600');
});

test('the Font card says units, weight, coverage, embedding, container and tables in its words', () => {
  assert.equal(unitsWords(face()), '1000 to the em · caps 700, x-height 500');
  assert.equal(weightWords(face({ fixedPitch: true })), '400 · width class 5 · fixed pitch');
  assert.equal(coverageWords(face()), '93 characters: Basic Latin 83, Latin-1 2');
  assert.equal(embeddingWords(0), 'installable: no limits set');
  assert.equal(embeddingWords(2), 'restricted: not to be embedded');
  assert.equal(embeddingWords(4 | 0x100), 'preview and print only · no subsetting');
  assert.equal(embeddingWords(null), 'not said: the font has no OS/2 table');
  assert.equal(containerWords(facts({ format: 'woff2', size: 10052, unpacked: 23452 })), 'WOFF2 · Brotli, 9.8 KB for 22.9 KB');
  const directory = [{ tag: 'glyf', length: 1, packed: 1, transformed: true }, { tag: 'OS/2', length: 1, packed: 1, transformed: false }];
  assert.equal(containerWords(facts({ format: 'woff', size: 4856, directory })), 'WOFF · 2 tables, inflated from 4.7 KB');
  assert.equal(tableWords({ directory }, face()), 'OS/2 glyf*');
  assert.equal(tableWords({ directory: [] }, face()), 'OS/2 cmap glyf head name');
});

test('a glyph says its outline in words', () => {
  assert.equal(outlineOf({ contours: 5, points: 34, components: null }, 'glyf'), '5 contours, 34 points');
  assert.equal(outlineOf({ contours: 0, points: 0, components: null }, 'glyf'), 'none: a blank glyph');
  assert.equal(outlineOf({ contours: -1, points: null, components: 2 }, 'glyf'), 'made of 2 other glyphs');
});

test('the Names card keeps the names the font has, in order', () => {
  assert.deepEqual(nameRows(names({ licence: 'SIL Open Font License 1.1', copyright: '' }), 'RLAB'), [
    ['family', 'Tidemark Sans'],
    ['style', 'Regular'],
    ['full name', 'Tidemark Sans Regular'],
    ['licence', 'SIL Open Font License 1.1'],
    ['vendor', 'RLAB'],
  ]);
});

test("a collection's face is lifted into a font of its own, its tables copied and its offsets rewritten", () => {
  const ttc = demo('Tidemark.ttc');
  assert.ok(isCollection(ttc));
  assert.ok(!isCollection(demo('TidemarkSans-Regular.ttf')));
  const faces = new DataView(ttc.buffer, ttc.byteOffset).getUint32(8);
  assert.equal(faces, 3);
  for (let i = 0; i < faces; i++) {
    const one = liftFace(ttc, i);
    const view = new DataView(one.buffer);
    assert.equal(view.getUint32(0), 0x00010000);
    const n = view.getUint16(4);
    for (let t = 0; t < n; t++) {
      const at = view.getUint32(12 + 16 * t + 8);
      const len = view.getUint32(12 + 16 * t + 12);
      assert.ok(at >= 12 + 16 * n && at + len <= one.length, `table ${t} of face ${i}`);
      assert.equal(at % 4, 0);
    }
    // The name table names the face: Mono only in the third.
    const text = new TextDecoder('utf-16be').decode(one);
    assert.equal(text.includes('Tidemark Mono'), i === 2, `face ${i}`);
  }
  assert.throws(() => liftFace(ttc, 3), /no face 4/);
  assert.throws(() => liftFace(ttc.subarray(0, 40), 0), /past the end/);
});

test('a collection whose records overlap is refused before the face is built', () => {
  const n = 1000;
  const tail = 4 * 1024 * 1024;
  const b = new Uint8Array(16 + 12 + 16 * n + tail);
  const v = new DataView(b.buffer);
  b.set([0x74, 0x74, 0x63, 0x66]);
  v.setUint32(8, 1);
  v.setUint32(12, 16);
  v.setUint16(16 + 4, n);
  const base = 16 + 12 + 16 * n;
  for (let i = 0; i < n; i++) {
    v.setUint32(16 + 12 + 16 * i + 8, base);
    v.setUint32(16 + 12 + 16 * i + 12, tail);
  }
  assert.throws(() => liftFace(b, 0), /more than the file holds/);
});
