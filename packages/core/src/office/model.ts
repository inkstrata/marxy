// What a Word document or a deck says, once read from its XML and before it is written as Markdown: blocks of runs,
// lists, tables, notes and asides, with the pictures it names. The readers (word.ts, slides.ts, odf.ts) fill it; the
// writer (markdown.ts) turns it into the Markdown the page renders. Fonts, colours, sizes and layout never reach it.

export interface Run {
  readonly t: 'run';
  readonly text: string;
  readonly b?: boolean;
  readonly i?: boolean;
  readonly s?: boolean;
  /** Set in a fixed-width face, or a style named for code: shown as code. */
  readonly code?: boolean;
  readonly sub?: boolean;
  readonly sup?: boolean;
}

export type Inline =
  | Run
  | { readonly t: 'link'; readonly href: string; readonly kids: Inline[] }
  | { readonly t: 'br' }
  /** A footnote or endnote mark: the note's label in `OfficeDoc.notes`. */
  | { readonly t: 'note'; readonly label: string }
  /** A picture, chart or other drawing: its index in `OfficeDoc.images`. */
  | { readonly t: 'image'; readonly image: number };

export type Block =
  | { readonly t: 'heading'; level: number; readonly kids: Inline[]; readonly slide?: { readonly n: number; readonly hidden: boolean } }
  | { readonly t: 'para'; readonly kids: Inline[] }
  | { readonly t: 'code'; readonly text: string }
  | { readonly t: 'quote'; readonly blocks: Block[] }
  | { readonly t: 'list'; readonly ordered: boolean; readonly start: number; readonly items: Block[][] }
  | { readonly t: 'table'; readonly rows: Inline[][][] }
  /** A comment or a slide's speaker notes: set apart beside the text it belongs to. */
  | { readonly t: 'aside'; readonly who: string; readonly when: string | null; readonly blocks: Block[] }
  | { readonly t: 'rule' }
  /** Writes nothing: records the byte the next block starts at, under `id` (a book's chapter, or a place a link names). */
  | { readonly t: 'mark'; readonly id: string };

export interface OfficeImage {
  /** The zip entry holding its bytes, or null when the file holds none (a chart, a linked picture). */
  readonly entry: string | null;
  readonly alt: string;
  /** `held picture`: one the file holds that the page names and does not draw (an RTF picture). */
  readonly what: 'picture' | 'held picture' | 'linked picture' | 'chart' | 'diagram' | 'object';
}

export interface OfficeNote {
  readonly label: string;
  readonly blocks: Block[];
}

export interface OfficeProps {
  readonly title: string | null;
  readonly subject: string | null;
  readonly creator: string | null;
  readonly lastModifiedBy: string | null;
  readonly created: string | null;
  readonly modified: string | null;
  readonly application: string | null;
  /** Pages as the saving app last counted them; Marxy lays out no pages. */
  readonly pages: number | null;
}

export type OfficeFormat = 'docx' | 'pptx' | 'odt' | 'odp' | 'rtf' | 'doc' | 'ppt';

export interface OfficeDoc {
  readonly format: OfficeFormat;
  readonly blocks: Block[];
  readonly notes: OfficeNote[];
  readonly images: OfficeImage[];
  readonly props: OfficeProps;
  readonly counts: { comments: number; footnotes: number; endnotes: number; slides: number; hiddenSlides: number; speakerNotes: number };
  /** What the file holds that the page does not show, as words for the account: `charts`, `equations`… */
  readonly leftOut: Set<string>;
  /**
   * The file's own bytes each block (and each table row) was read from, for a format that is text, so the page's elements
   * name bytes of the file rather than of the Markdown written from it.
   */
  readonly sources?: ReadonlyMap<object, readonly [number, number]>;
  /** Where reading stopped short at a cap, as sentences the page shows above the text. */
  readonly cut?: readonly string[];
  /** What the reader has to say of how it read this file (its code page), for the account. */
  readonly said?: readonly string[];
}

export const run = (text: string, f: Omit<Run, 't' | 'text'> = {}): Run => ({ t: 'run', text, ...f });

/** The plain text of some inlines: a heading's words, a slide's title. */
export function inlineText(kids: readonly Inline[]): string {
  let s = '';
  for (const k of kids) {
    if (k.t === 'run') s += k.text;
    else if (k.t === 'link') s += inlineText(k.kids);
    else if (k.t === 'br') s += ' ';
  }
  return s;
}

/** Words in the body: runs of letters and figures between spaces, as a word processor counts them. */
export function countWords(blocks: readonly Block[]): number {
  let n = 0;
  const words = (s: string): number => s.match(/\S+/g)?.length ?? 0;
  const walk = (list: readonly Block[]): void => {
    for (const b of list) {
      if (b.t === 'heading' || b.t === 'para') n += words(inlineText(b.kids).replace(/­/g, ''));
      else if (b.t === 'code') n += words(b.text);
      else if (b.t === 'quote') walk(b.blocks);
      else if (b.t === 'list') for (const item of b.items) walk(item);
      else if (b.t === 'table') for (const row of b.rows) for (const cell of row) n += words(inlineText(cell));
    }
  };
  walk(blocks);
  return n;
}

export const emptyProps = (): OfficeProps => ({ title: null, subject: null, creator: null, lastModifiedBy: null, created: null, modified: null, application: null, pages: null });
