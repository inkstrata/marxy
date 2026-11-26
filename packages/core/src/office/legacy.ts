// A Word 97-2003 document (.doc) or PowerPoint 97-2003 deck (.ppt): compound files the shell reads
// (src-tauri/src/legacy_office) into the blocks the office page writes, since their streams and sector chains are read
// there under its caps. Here that answer is checked for its shape and made the document the writer takes.
import { emptyProps, type Block, type OfficeDoc, type OfficeProps } from './model.ts';
import { OfficeError } from './xml.ts';

/** The shell's reading of a .doc or .ppt. */
export interface LegacyOffice {
  readonly format: 'doc' | 'ppt';
  readonly blocks: Block[];
  readonly images: readonly { readonly what: 'held picture' | 'object'; readonly alt: string }[];
  readonly props: Partial<OfficeProps>;
  readonly slides: number;
  readonly hiddenSlides: number;
  readonly speakerNotes: number;
  readonly leftOut: readonly string[];
  readonly cut: readonly string[];
}

const SAID: Readonly<Record<LegacyOffice['format'], readonly string[]>> = {
  doc: [
    'Lists are shown with bullets: the numbers Word draws for a numbered list are not read.',
    'A field shows the text it last showed: nothing in it is run or worked out again.',
  ],
  ppt: ['Each slide’s placeholders first, then its own text boxes, in the order the deck holds them; a placeholder’s lines are listed as bullets.'],
};

export function legacyDoc(r: LegacyOffice): OfficeDoc {
  if ((r.format !== 'doc' && r.format !== 'ppt') || !Array.isArray(r.blocks)) throw new OfficeError('The reading the app made of the file is not one the page knows.');
  const said = [...SAID[r.format]];
  if (r.images.length > 0) said.push('Pictures and embedded objects are named where they stand, never drawn or run.');
  return {
    format: r.format,
    blocks: r.blocks,
    notes: [],
    images: r.images.map((i) => ({ entry: null, alt: i.alt, what: i.what })),
    props: { ...emptyProps(), ...r.props },
    counts: { comments: 0, footnotes: 0, endnotes: 0, slides: r.slides, hiddenSlides: r.hiddenSlides, speakerNotes: r.speakerNotes },
    leftOut: new Set(r.leftOut),
    cut: r.cut,
    said,
  };
}
