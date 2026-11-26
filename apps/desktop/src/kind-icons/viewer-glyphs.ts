// What a file that has a page of its own wears in the Line: a page for PDFs and documents, and for the rest a glyph drawn on
// the kind icons' 16-unit grid whose outline says what the file is (a landscape picture, a portrait grid, a wide screen).
import { fileTypeFor, type FileViewer } from '@marxy/core';
import { glyphElement, glyphSvg, KIND_GLYPHS } from './icons.ts';

export interface ViewerGlyph {
  /** What the file is, in the word a row's quiet text opens with. */
  readonly label: string;
  draw(doc: Document): HTMLSpanElement;
}

export const VIEWER_GLYPHS: Readonly<Partial<Record<FileViewer, { readonly label: string; readonly inner: string }>>> = {
  pdf: { label: 'PDF', inner: KIND_GLYPHS.report },
  office: { label: 'Document', inner: KIND_GLYPHS.article },
  book: { label: 'Book', inner: KIND_GLYPHS.book },
  image: { label: 'Image', inner: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5.5 6.5h.01" stroke-width="2.4"/><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3"/>' },
  sheet: { label: 'Sheet', inner: '<rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M3 6h10M3 10h10M8 6v8"/>' },
  sqlite: { label: 'Database', inner: '<path d="M3 4.5C3 3.5 5.2 2.8 8 2.8s5 .7 5 1.7-2.2 1.7-5 1.7-5-.7-5-1.7zM3 4.5v7c0 1 2.2 1.7 5 1.7s5-.7 5-1.7v-7M3 8c0 1 2.2 1.7 5 1.7S13 9 13 8"/>' },
  font: { label: 'Font', inner: '<path d="m3 13 5-10 5 10M5 9.5h6"/>' },
  media: { label: 'Media', inner: '<rect x="1.5" y="4" width="13" height="8" rx="2"/><path d="M6.7 6v4l3.3-2z"/>' },
  mail: { label: 'Mail', inner: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="m2.5 5 5.5 4 5.5-4"/>' },
  archive: { label: 'Archive', inner: '<rect x="2" y="3" width="12" height="3" rx="1"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3"/>' },
};

/** The glyph and label for a file a page of its own shows; null for text and for a file with no viewer (the kind's icon stands). */
export function viewerGlyphOf(path: string): ViewerGlyph | null {
  const one = VIEWER_GLYPHS[fileTypeFor(path).viewer];
  return one === undefined ? null : { label: one.label, draw: (doc) => glyphElement(doc, glyphSvg(one.inner), one.inner) };
}
