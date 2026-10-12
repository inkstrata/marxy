// The glyph for each kind of notice (U-02): drawn here, as SVG elements, so no markup is parsed. A glyph and a word
// say what kind of news it is; the status colour only adds to them (X-21 ruling 5, never colour alone).
import type { NoticeKind } from './index.ts';

const NS = 'http://www.w3.org/2000/svg';

/** The word each kind of news is led by. A refusal and an error are both "Not done"; their glyphs tell them apart. */
export const KIND_WORDS: Readonly<Record<NoticeKind, string>> = {
  done: 'Done',
  refused: 'Not done',
  error: 'Not done',
  decision: 'Needs you',
  info: 'Note',
  blocked: 'Note',
};

/** Path data on a 16 x 16 box, stroked. A `v.01` is a dot. */
const PATHS: Readonly<Record<NoticeKind, readonly string[]>> = {
  done: ['M3.5 8.5l3 3 6-7'],
  refused: ['M13.5 8a5.5 5.5 0 1 1-11 0a5.5 5.5 0 0 1 11 0z', 'M4.1 11.9L11.9 4.1'],
  error: ['M8 2.5l6 10.5H2z', 'M8 6.6v3', 'M8 11.3v.01'],
  decision: ['M13.5 8a5.5 5.5 0 1 1-11 0a5.5 5.5 0 0 1 11 0z', 'M6.4 6.5a1.7 1.7 0 1 1 2.3 1.6c-.5.3-.7.6-.7 1.2', 'M8 11.3v.01'],
  info: ['M13.5 8a5.5 5.5 0 1 1-11 0a5.5 5.5 0 0 1 11 0z', 'M8 7.4v3.4', 'M8 5.3v.01'],
  blocked: ['M8 2l5 1.8v3.9c0 3-2.2 5-5 6.3-2.8-1.3-5-3.3-5-6.3V3.8z'],
};

/** The glyph for `kind`: an `svg.marxy-notice-glyph`-sized icon in `currentColor`, hidden from assistive technology. */
export function glyphFor(kind: NoticeKind): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of PATHS[kind]) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
