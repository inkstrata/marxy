// A font's page from its facts: the line above the specimen, what each set of the specimen
// holds of the font's characters, a variable font's style at its sliders, the Font card's words, and a collection's face
// lifted into a font of its own (the webview draws only a collection's first face). The facts are the shell's
// (`font_facts`, src-tauri/src/font); nothing here reads a table but the collection's directory. Pure: no DOM, no I/O.

import { shortSize } from './archive.ts';
import { plural } from '../util/count.ts';

export interface FontNames {
  readonly copyright: string | null;
  readonly family: string | null;
  readonly style: string | null;
  readonly full: string | null;
  readonly version: string | null;
  readonly postscript: string | null;
  readonly trademark: string | null;
  readonly maker: string | null;
  readonly designer: string | null;
  readonly description: string | null;
  readonly vendorUrl: string | null;
  readonly designerUrl: string | null;
  readonly licence: string | null;
  readonly licenceUrl: string | null;
  readonly typoFamily: string | null;
  readonly typoStyle: string | null;
  readonly sample: string | null;
}

export interface FontAxis {
  readonly tag: string;
  readonly name: string;
  readonly min: number;
  readonly default: number;
  readonly max: number;
  readonly hidden: boolean;
}

export interface FontInstance {
  readonly name: string;
  readonly coords: readonly number[];
}

export interface FontFace {
  readonly names: FontNames;
  readonly tables: readonly string[];
  /** `glyf`, `CFF`, `CFF2`, `bitmaps` or `none`. */
  readonly outlines: string;
  readonly unitsPerEm: number;
  readonly glyphs: number;
  readonly weight: number | null;
  readonly widthClass: number | null;
  readonly embedding: number | null;
  readonly vendor: string | null;
  readonly capHeight: number | null;
  readonly xHeight: number | null;
  readonly fixedPitch: boolean;
  readonly italic: boolean;
  readonly axes: readonly FontAxis[];
  readonly instances: readonly FontInstance[];
  readonly chars: number;
  readonly coverage: readonly { readonly name: string; readonly count: number }[];
  readonly mapped: readonly number[];
  readonly glyphNames: boolean;
}

/** What a font file is, as the shell reads it (`font_facts`). */
export interface FontFacts {
  /** `truetype`, `cff`, `woff`, `woff2` or `collection`. */
  readonly format: string;
  readonly size: number;
  readonly unpacked: number | null;
  readonly directory: readonly { readonly tag: string; readonly length: number; readonly packed: number | null; readonly transformed: boolean }[];
  readonly faces: readonly FontFace[];
  readonly why: string | null;
}

/** One glyph, as the shell reads it (`font_glyph`). */
export interface GlyphFacts {
  readonly glyph: number;
  readonly name: string | null;
  readonly advance: number | null;
  /** -1: made of other glyphs. */
  readonly contours: number | null;
  readonly components: number | null;
  readonly points: number | null;
  readonly bbox: readonly [number, number, number, number] | null;
}

/** The largest font the page draws, as the shell reads (src-tauri/src/font, MAX_FONT_BYTES). */
export const FONT_BYTES_MAX = 30 * 1024 * 1024;
/** The waterfall's sizes, in pixels. */
export const WATERFALL = [12, 14, 18, 24, 32, 48, 72] as const;
/** The sample line when the font's name table has none. */
export const SAMPLE = 'The tide turns at the harbour mouth.';
/** The glyph grid's cells drawn at most; past it the page says how many more. */
export const GRID_MAX = 2_000;

const n2 = (n: number): string => n.toLocaleString('en-GB');

const FORMAT_WORDS: Readonly<Record<string, string>> = {
  truetype: 'TrueType',
  cff: 'OpenType (CFF)',
  woff: 'WOFF',
  woff2: 'WOFF2',
  collection: 'a font collection',
};

/** "TrueType", "WOFF2", "a font collection". */
export const fontFormatWords = (format: string): string => FORMAT_WORDS[format] ?? format;

const OUTLINE_WORDS: Readonly<Record<string, string>> = {
  glyf: 'TrueType (quadratics)',
  CFF: 'CFF (PostScript cubics)',
  CFF2: 'CFF2 (cubics, variable)',
  bitmaps: 'bitmaps only',
  none: 'none found',
};

export const outlineWords = (outlines: string): string => OUTLINE_WORDS[outlines] ?? outlines;

/** OS/2 fsType in words: what the font's maker allows of embedding it. */
export function embeddingWords(fsType: number | null): string {
  if (fsType === null) return 'not said: the font has no OS/2 table';
  const kind = fsType & 0xf;
  const base =
    kind === 0 ? 'installable: no limits set' : kind & 2 ? 'restricted: not to be embedded' : kind & 4 ? 'preview and print only' : kind & 8 ? 'editable' : `fsType ${fsType}`;
  const more = [fsType & 0x100 ? 'no subsetting' : null, fsType & 0x200 ? 'bitmaps only' : null].filter(Boolean);
  return more.length ? `${base} · ${more.join(', ')}` : base;
}

/** "93 characters: Basic Latin 83, Latin-1 2, Punctuation 6, Currency 1, Arrows 1". */
export function coverageWords(face: Pick<FontFace, 'chars' | 'coverage'>): string {
  const blocks = face.coverage.map((b) => `${b.name} ${n2(b.count)}`).join(', ');
  return blocks ? `${plural(face.chars, 'character')}: ${blocks}` : plural(face.chars, 'character');
}

/** "1000 to the em · caps 700, x-height 500". */
export function unitsWords(face: Pick<FontFace, 'unitsPerEm' | 'capHeight' | 'xHeight'>): string {
  const caps = face.capHeight !== null && face.capHeight > 0 ? ` · caps ${face.capHeight}${face.xHeight ? `, x-height ${face.xHeight}` : ''}` : '';
  return `${face.unitsPerEm || 'not said'} to the em${caps}`;
}

/** "400 · width class 5 · fixed pitch". */
export function weightWords(face: Pick<FontFace, 'weight' | 'widthClass' | 'fixedPitch' | 'italic'>): string {
  return [face.weight ?? 'not said', face.widthClass !== null ? `width class ${face.widthClass}` : null, face.fixedPitch ? 'fixed pitch' : null, face.italic ? 'italic' : null]
    .filter((x) => x !== null)
    .join(' · ');
}

/** The Font card's format row: "WOFF2 · Brotli, 9.8 KB for 22.9 KB", "WOFF · 10 tables, inflated from 4.7 KB". */
export function containerWords(facts: Pick<FontFacts, 'format' | 'size' | 'unpacked' | 'directory'>): string {
  const name = fontFormatWords(facts.format);
  if (facts.format === 'woff2' && facts.unpacked) return `${name} · Brotli, ${shortSize(facts.size)} for ${shortSize(facts.unpacked)}`;
  if (facts.format === 'woff') return `${name} · ${plural(facts.directory.length, 'table')}, inflated from ${shortSize(facts.size)}`;
  return name;
}

/** The tables row: a WOFF or WOFF2's own directory (a transformed table starred), else the face's. */
export function tableWords(facts: Pick<FontFacts, 'directory'>, face: Pick<FontFace, 'tables'> | null): string {
  const tags = facts.directory.length > 0 ? facts.directory.map((t) => `${t.tag.trim()}${t.transformed ? '*' : ''}`) : (face?.tables ?? []).map((t) => t.trim());
  return [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(' ');
}

/** The face's name as the page sets it: its full name, else family and style. */
export const faceName = (face: FontFace, i: number): string =>
  face.names.full ?? ([face.names.family, face.names.style].filter(Boolean).join(' ') || `Face ${i + 1}`);

/** The line above the specimen: "TrueType · 94 glyphs · variable: wght, wdth". */
export function fontLine(facts: FontFacts, face: FontFace | null): string {
  const parts = [fontFormatWords(facts.format)];
  if (facts.faces.length > 1) parts.push(plural(facts.faces.length, 'face'));
  if (face) parts.push(plural(face.glyphs, 'glyph'));
  if (face && face.axes.length > 0) parts.push(`variable: ${face.axes.map((a) => a.tag).join(', ')}`);
  return parts.join(' · ');
}

/** The sliders' first values: each axis at its default. */
export const defaultValues = (face: Pick<FontFace, 'axes'>): Record<string, number> => Object.fromEntries(face.axes.map((a) => [a.tag, a.default]));

/** The named instance the values sit on, or null between instances. */
export function instanceAt(face: Pick<FontFace, 'axes' | 'instances'>, values: Readonly<Record<string, number>>): FontInstance | null {
  return face.instances.find((x) => face.axes.every((a, k) => Math.abs((values[a.tag] ?? a.default) - (x.coords[k] ?? a.default)) < 0.01)) ?? null;
}

/** The values a named instance sets. */
export const valuesOf = (face: Pick<FontFace, 'axes'>, x: FontInstance): Record<string, number> => Object.fromEntries(face.axes.map((a, k) => [a.tag, x.coords[k] ?? a.default]));

/** A variable font's style at its sliders: the named instance's name, or the values themselves ("wght 720 · wdth 78"). */
export function styleAt(face: FontFace, values: Readonly<Record<string, number>>): string {
  if (face.axes.length === 0) return face.names.typoStyle ?? face.names.style ?? '';
  const named = instanceAt(face, values);
  return named ? named.name : face.axes.map((a) => `${a.tag} ${round(values[a.tag] ?? a.default)}`).join(' · ');
}

const round = (v: number): number => Math.round(v * 10) / 10;

/** CSS `font-variation-settings` for the values: "'wght' 720, 'wdth' 78". */
export function variationSettings(face: Pick<FontFace, 'axes'>, values: Readonly<Record<string, number>>): string {
  if (face.axes.length === 0) return 'normal';
  return face.axes.map((a) => `'${a.tag}' ${round(values[a.tag] ?? a.default)}`).join(', ');
}

/** A slider's step: a whole unit on a wide axis, finer on a narrow one (an opsz of 8 to 12, a slant of -12 to 0). */
export const axisStep = (a: Pick<FontAxis, 'min' | 'max'>): number => (a.max - a.min >= 50 ? 1 : a.max - a.min >= 5 ? 0.5 : 0.01);

/** The specimen's sets, each kept to what the font maps (all of each set when the facts are not known). */
export const SETS = [
  ['Capitals', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  ['Lower case', 'abcdefghijklmnopqrstuvwxyz'],
  ['Figures', '0123456789'],
  ['Marks', '.,:;!?\'"-–—()&/%+=@#*_’“”…°€£→'],
] as const;

export function specimenSets(mapped: readonly number[] | null): { readonly label: string; readonly text: string }[] {
  const has = mapped ? new Set(mapped) : null;
  return SETS.map(([label, all]) => ({ label, text: [...all].filter((ch) => !has || has.has(ch.codePointAt(0)!)).join('') })).filter((s) => s.text.length > 0);
}

/** The characters the grid shows: what the font maps, but space and the controls. */
export const gridChars = (mapped: readonly number[]): number[] => mapped.filter((c) => c > 0x20 && !(c >= 0x7f && c < 0xa0));

/** A code point as the grid and the Glyph card say it: "0041", "1F600". */
export const codeWords = (c: number): string => c.toString(16).toUpperCase().padStart(4, '0');

/** The Glyph card's outline row. */
export function outlineOf(g: Pick<GlyphFacts, 'contours' | 'points' | 'components'>, outlines: string): string {
  if (g.contours === null) return outlines.startsWith('CFF') ? 'CFF: a charstring the reader could not count' : 'not read';
  if (g.contours === 0) return 'none: a blank glyph';
  if (g.contours < 0) return `made of ${g.components ? plural(g.components, 'other glyph') : 'other glyphs'}`;
  return `${plural(g.contours, 'contour')}, ${plural(g.points ?? 0, 'point')}`;
}

const u16 = (b: Uint8Array, at: number): number => ((b[at]! << 8) | b[at + 1]!) >>> 0;
const u32 = (b: Uint8Array, at: number): number => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

/** Whether the bytes are a TrueType or OpenType collection. */
export const isCollection = (b: Uint8Array): boolean => b.length >= 12 && b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 && b[3] === 0x66;

/**
 * Face `index` of a collection as a font of its own: its table directory with each table copied after it, offsets
 * rewritten. Throws when the collection's directory does not hold the face or a table runs past the file.
 */
export function liftFace(b: Uint8Array, index: number): Uint8Array {
  const count = u32(b, 8);
  if (!isCollection(b) || index < 0 || index >= count || 12 + 4 * (index + 1) > b.length) throw new Error(`the collection has no face ${index + 1}`);
  const off = u32(b, 12 + 4 * index);
  if (off + 12 > b.length) throw new Error(`face ${index + 1} starts past the end of the file`);
  const n = u16(b, off + 4);
  if (off + 12 + 16 * n > b.length) throw new Error(`face ${index + 1}'s table directory runs past the end of the file`);
  const recs = Array.from({ length: n }, (_, i) => {
    const r = off + 12 + 16 * i;
    return { r, at: u32(b, r + 8), len: u32(b, r + 12), to: 0 };
  });
  let size = 12 + 16 * n;
  for (const rec of recs) {
    if (rec.at + rec.len > b.length) throw new Error(`a table of face ${index + 1} runs past the end of the file`);
    rec.to = size;
    size += (rec.len + 3) & ~3;
    // Overlapping records can each name the whole file; a face's tables never sum to more than the file itself.
    if (size > 2 * b.length) throw new Error(`face ${index + 1}'s tables add up to more than the file holds`);
  }
  const out = new Uint8Array(size);
  out.set(b.subarray(off, off + 12));
  const view = new DataView(out.buffer);
  recs.forEach((rec, i) => {
    const d = 12 + 16 * i;
    out.set(b.subarray(rec.r, rec.r + 16), d);
    view.setUint32(d + 8, rec.to);
    out.set(b.subarray(rec.at, rec.at + rec.len), rec.to);
  });
  return out;
}

/** The Names card's rows, in the order the card says them, with the font's own words. */
export function nameRows(n: FontNames, vendor: string | null): [string, string][] {
  const rows: [string, string | null][] = [
    ['family', n.family],
    ['style', n.style],
    ['full name', n.full],
    ['PostScript', n.postscript],
    ['version', n.version],
    ['maker', n.maker],
    ['designer', n.designer],
    ['copyright', n.copyright],
    ['trademark', n.trademark],
    ['licence', n.licence],
    ['licence URL', n.licenceUrl],
    ['sample', n.sample],
    ['vendor', vendor],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null && r[1] !== '');
}
