// Word documents and decks read as text (the office page, apps/desktop/src/viewers/office.ts): the file's parts are
// read through the shell's zip reader, under its caps, and handed here by name; what comes back is the document as
// Markdown for the one renderer, the marks the page sets apart, and the facts the panel lists. Pure.
import { writeMarkdown, type OfficeMarkdown } from './markdown.ts';
import { countWords, type OfficeDoc, type OfficeFormat } from './model.ts';
import { legacyDoc, type LegacyOffice } from './legacy.ts';
import type { PartRead } from './parts.ts';
import { readOdf } from './odf.ts';
import { readRtf, type RtfOptions } from './rtf.ts';
import { readSlides } from './slides.ts';
import { readWord } from './word.ts';
import { OFFICE_LIMITS } from './xml.ts';
import { pushAll } from '../util/spread.ts';

export { IMAGE_SCHEME, escapeText, sourceRangeOf, writeMarkdown, type OfficeMarks, type OfficeMarkdown, type SourceSpan } from './markdown.ts';
export { RTF_LIMITS, startsAsRtf, type RtfOptions } from './rtf.ts';
export type { OfficeDoc, OfficeFormat, OfficeImage, OfficeProps } from './model.ts';
export type { PartRead } from './parts.ts';
export type { LegacyOffice } from './legacy.ts';
export { OFFICE_LIMITS, OfficeError } from './xml.ts';

export interface OfficeReading extends OfficeMarkdown {
  readonly doc: OfficeDoc;
  readonly words: number;
}

const FORMATS: Readonly<Record<string, OfficeFormat>> = { docx: 'docx', pptx: 'pptx', odt: 'odt', odp: 'odp', rtf: 'rtf', doc: 'doc', ppt: 'ppt' };

/** The format a name says, or null when it is not one the page reads. */
export function officeFormatOf(path: string): OfficeFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return FORMATS[ext] ?? null;
}

export const isDeck = (f: OfficeFormat): boolean => f === 'pptx' || f === 'odp' || f === 'ppt';

/** A Word 97-2003 document or deck: a compound file the shell reads, not a zip of parts. */
export const isLegacy = (f: OfficeFormat): f is 'doc' | 'ppt' => f === 'doc' || f === 'ppt';

/** The most of a .doc or .ppt read: it is read whole, as the shell's reader takes it. */
export const LEGACY_FILE_MAX = 64 * 1024 * 1024;

/** Reads the file whose parts `read` hands over. Throws `OfficeError` with the sentence the page says. */
export async function readOffice(format: Exclude<OfficeFormat, 'rtf' | 'doc' | 'ppt'>, read: PartRead): Promise<OfficeReading> {
  const doc = format === 'docx' ? await readWord(read) : format === 'pptx' ? await readSlides(read) : await readOdf(format, read);
  return reading(doc);
}

/** The shell's reading of a .doc or .ppt as the page's. Throws `OfficeError` when it is not the shape the page knows. */
export function readLegacyOffice(r: LegacyOffice): OfficeReading {
  const doc = legacyDoc(r);
  return reading(doc);
}

/** Reads an RTF file's bytes, as Source holds them. Throws `OfficeError` with the sentence the page says. */
export function readRtfOffice(bytes: Uint8Array, options: RtfOptions = {}): OfficeReading {
  const doc = readRtf(bytes, options);
  return reading(doc);
}

/** The page's reading of `doc`: its Markdown, written to the block cap, and the sentences of every cap it met. */
/** What the line for the block cap begins with: the RTF account leaves it to the line the page draws above the text. */
export const BLOCKS_CUT = ' paragraphs, headings, tables and lists are shown;';

function reading(doc: OfficeDoc): OfficeReading {
  const written = writeMarkdown(doc, { blocks: OFFICE_LIMITS.blocks });
  return { ...written, doc: written.cut.length > 0 ? { ...doc, cut: [...(doc.cut ?? []), ...written.cut] } : doc, words: countWords(doc.blocks) };
}

const n = (x: number): string => x.toLocaleString('en-GB');
const plural = (x: number, one: string, many = `${one}s`): string => `${n(x)} ${x === 1 ? one : many}`;

export const FORMAT_WORDS: Readonly<Record<OfficeFormat, string>> = {
  docx: 'Word document',
  pptx: 'PowerPoint deck',
  odt: 'OpenDocument text',
  odp: 'OpenDocument presentation',
  rtf: 'Rich Text document',
  doc: 'Word 97-2003 document',
  ppt: 'PowerPoint 97-2003 deck',
};

/** The page's first line: what the file is and how much of it there is. */
export function officeHeadLine(r: OfficeReading): string {
  const { doc } = r;
  const bits = [FORMAT_WORDS[doc.format]];
  if (isDeck(doc.format)) {
    bits.push(plural(doc.counts.slides, 'slide'));
    if (doc.counts.hiddenSlides) bits.push(`${n(doc.counts.hiddenSlides)} hidden`);
    if (doc.counts.speakerNotes) bits.push(`notes on ${n(doc.counts.speakerNotes)}`);
  } else {
    bits.push(plural(r.words, 'word'));
    const notes = doc.counts.footnotes + doc.counts.endnotes;
    if (notes) bits.push(plural(notes, 'note'));
    if (doc.counts.comments) bits.push(plural(doc.counts.comments, 'comment'));
    if (doc.format === 'rtf') bits.push('the text, not the layout');
  }
  return bits.join(' · ');
}

/** What the page says of itself, folded under its first line. */
export function officeAccount(r: OfficeReading): string[] {
  const { doc } = r;
  if (doc.format === 'rtf') return rtfAccount(r);
  const deck = isDeck(doc.format);
  const out = [
    deck
      ? 'The slides as one page, in the deck’s order: each slide’s title, its text in the order the deck reads it, its tables, then its speaker notes. Where things sit on a slide, and how it looks, are left out.'
      : 'The text in Marxy’s own type: headings, paragraphs, lists, tables, links and notes as the document marks them. Fonts, colours, page size, headers and footers and the layout of pages are left out.',
    ...(doc.said ?? []),
  ];
  const kept: string[] = [];
  if (doc.images.some((i) => i.what === 'picture')) kept.push('Pictures held in the file are drawn, up to 300 of them; a picture over 8 MB, past those, or in a format the page does not draw, shows its alt text.');
  const said = [...doc.leftOut];
  if (said.length > 0) kept.push(`Also left out: ${said.join(', ')}.`);
  if (!deck && doc.counts.comments) kept.push('Comments are set beside the paragraph they are on, with who wrote them.');
  if (!deck && doc.counts.footnotes + doc.counts.endnotes) kept.push('Footnotes and endnotes are numbered together, in the order the text marks them, and listed at the end.');
  kept.push('Links to the web open in your browser when you follow one, and a relative link opens a document beside this one as a Markdown page’s does; nothing the file names is fetched to draw the page. Macros never run. Source shows the file’s bytes.');
  return [...out, ...kept];
}

function rtfAccount(r: OfficeReading): string[] {
  const { doc } = r;
  const out = [
    'The text in Marxy’s own type, not the layout: paragraphs, headings (by outline level, a heading style, or type set larger than the body’s), lists, tables, bold and italic as the file marks them. Fonts, colours, sizes, page size, headers and footers are left out.',
    ...(doc.said ?? []),
  ];
  if (doc.images.length > 0) out.push('Pictures and embedded objects are named where they stand, never drawn or run.');
  out.push('A field shows the text it last showed, and a link’s address is written after its words as text: nothing is followed, fetched or run.');
  const said = [...doc.leftOut];
  if (said.length > 0) out.push(`Also left out: ${said.join(', ')}.`);
  pushAll(out, (doc.cut ?? []).filter((c) => !c.includes(BLOCKS_CUT)));
  out.push('Source shows the file as it is.');
  return out;
}
