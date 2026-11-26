// A PDF's page arithmetic: the column, the place kept across a zoom, the card's words, Find's text and Export's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_GAP,
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  PX_PER_PT,
  currentPage,
  fitZoom,
  flattenOutline,
  layoutPages,
  madeByWords,
  matchesIn,
  pageAsked,
  pageAt,
  pageText,
  pagesNear,
  paperWords,
  pdfDateWords,
  pdfMarkdown,
  pdfPlainText,
  piecesOf,
  placeAt,
  rangePieces,
  scrollFor,
  stepPdfZoom,
} from './pdf.ts';

const A5 = { w: 420, h: 595 };
const A4 = { w: 595, h: 842 };

test('zoom steps stop at their ends', () => {
  assert.equal(stepPdfZoom(1, 1), 1.1);
  assert.equal(stepPdfZoom(1, -1), 0.9);
  assert.equal(stepPdfZoom(1.78, 1), 2, 'from a fit between the steps, the next one up');
  assert.equal(stepPdfZoom(1.78, -1), 1.75);
  assert.equal(stepPdfZoom(PDF_ZOOM_MAX, 1), PDF_ZOOM_MAX);
  assert.equal(stepPdfZoom(PDF_ZOOM_MIN, -1), PDF_ZOOM_MIN);
});

test('Fit width fills the room less the gaps; Fit page also fits the height', () => {
  const w = fitZoom('width', 1000, 600, A5);
  assert.ok(Math.abs(A5.w * PX_PER_PT * w - (1000 - 2 * PAGE_GAP)) < 1e-6);
  const p = fitZoom('page', 1000, 600, A5);
  assert.ok(Math.abs(A5.h * PX_PER_PT * p - (600 - 2 * PAGE_GAP)) < 1e-6, 'a tall page in a wide room is fitted by its height');
  assert.ok(p < w);
  assert.equal(fitZoom('width', 100000, 100, A5), PDF_ZOOM_MAX, 'clamped');
  assert.equal(fitZoom('width', 10, 10, A5), PDF_ZOOM_MIN);
});

test('pages lie down one column, each found by its offset, and only those near the view are drawn', () => {
  const sizes = [A5, A5, A4, A5];
  const l = layoutPages(sizes, 1);
  assert.equal(l.tops[0], PAGE_GAP);
  assert.equal(l.heights[0], Math.round(595 * PX_PER_PT));
  assert.equal(l.tops[1], PAGE_GAP + l.heights[0]! + PAGE_GAP);
  assert.equal(l.width, Math.round(595 * PX_PER_PT) + 2 * PAGE_GAP, 'as wide as the widest page');
  assert.equal(l.height, l.tops[3]! + l.heights[3]! + PAGE_GAP);
  assert.equal(pageAt(l, 0), 0);
  assert.equal(pageAt(l, l.tops[2]! + 5), 2);
  assert.equal(pageAt(l, l.tops[2]! - 1), 1, 'the gap belongs to the page above');
  assert.equal(pageAt(l, 1e9), 3);
  assert.deepEqual(pagesNear(l, l.tops[1]! + 10, 100, 0), [1, 1]);
  assert.deepEqual(pagesNear(l, l.tops[1]! + 10, 100, l.heights[1]!), [0, 2]);
  assert.deepEqual(pagesNear(layoutPages([], 1), 0, 100, 0), [0, -1]);
  const many = layoutPages(Array.from({ length: 5000 }, () => A4), 1);
  const [a, b] = pagesNear(many, many.tops[4000]!, 900, 900);
  assert.ok(a >= 3998 && b <= 4002 && b - a <= 4, `a 5,000-page column draws ${b - a + 1} pages near page 4,001`);
});

test('the place is a page and a fraction: a zoom keeps it', () => {
  const sizes = [A5, A5, A5];
  const at1 = layoutPages(sizes, 1);
  const top = at1.tops[1]! + at1.heights[1]! / 4;
  const place = placeAt(at1, top);
  assert.equal(place.page, 1);
  assert.ok(Math.abs(place.fraction - 0.25) < 0.01);
  const at2 = layoutPages(sizes, 2);
  const again = placeAt(at2, scrollFor(at2, place));
  assert.equal(again.page, 1);
  assert.ok(Math.abs(again.fraction - 0.25) < 0.01);
  assert.equal(scrollFor(at2, { page: 99, fraction: 0 }), at2.tops[2], 'a place past the end is the last page');
  assert.equal(currentPage(at1, 0, 900), 0);
  assert.equal(currentPage(at1, at1.tops[2]! - 200, 900), 2, 'the page a third of the way down');
});

test('a page typed in the bar is clamped to the pages there are', () => {
  assert.equal(pageAsked('2', 3), 1);
  assert.equal(pageAsked(' 9 ', 3), 2);
  assert.equal(pageAsked('0', 3), 0);
  assert.equal(pageAsked('two', 3), null);
  assert.equal(pageAsked('1', 0), null);
});

test('the Document card reads the file\'s own fields in words', () => {
  assert.equal(pdfDateWords("D:20250302180000+00'00'"), '2 Mar 2025, 18:00 UTC');
  assert.equal(pdfDateWords("D:20251027093000-07'00'"), '27 Oct 2025, 09:30 UTC-07:00');
  assert.equal(pdfDateWords('D:2024'), '2024');
  assert.equal(pdfDateWords('D:20241399'), null, 'a month 13 is not a date');
  assert.equal(pdfDateWords(''), null);
  assert.equal(paperWords(A5), '148 × 210 mm, A5');
  assert.equal(paperWords(A4), '210 × 297 mm, A4');
  assert.equal(paperWords({ w: 792, h: 612 }), '279 × 216 mm, Letter, landscape');
  assert.equal(paperWords({ w: 300, h: 300 }), '106 × 106 mm');
  assert.equal(madeByWords('Writer', 'LibreOffice 7.6'), 'Writer · LibreOffice 7.6');
  assert.equal(madeByWords('Skia/PDF m156', 'Skia/PDF m156'), 'Skia/PDF m156');
  assert.equal(madeByWords(null, ' '), null);
});

test('Find reads a page as its pieces with line breaks, and a match maps back to the pieces it covers', () => {
  const { text, starts, ends } = pageText([
    { str: 'rivers of ', hasEOL: false },
    { str: 'white', hasEOL: true },
    { str: undefined },
    { str: '', hasEOL: true },
    { str: 'running down' },
  ]);
  assert.equal(text, 'rivers of white\n\nrunning down');
  assert.deepEqual(starts, [0, 10, 16, 17]);
  assert.deepEqual(ends, [10, 15, 16, 29]);
  const re = /of\swhite\s+running/gi;
  const [m] = matchesIn(text, 4, re);
  assert.deepEqual(m, { page: 4, start: 7, end: 24 });
  assert.deepEqual(piecesOf(starts, ends, m!.start, m!.end), [
    { piece: 0, from: 7, to: 10 },
    { piece: 1, from: 0, to: 5 },
    { piece: 3, from: 0, to: 7 },
  ], 'the line breaks between are no piece\'s');
  assert.equal(matchesIn('aaa', 0, /x*/g).length, 0, 'an empty match is skipped, and the loop ends');
  assert.equal(matchesIn('Rivers, rivers', 0, /rivers/gi).length, 2);
});

test('Export writes the text with a form feed between pages, or as Markdown that reads as itself', () => {
  assert.equal(pdfPlainText(['One\n', 'Two  ']), 'One\n\f\nTwo\n');
  const md = pdfMarkdown('The case for ragged lines', ['# not a heading\n1. not a list\nplain *text*', 'Page two']);
  assert.equal(md, '# The case for ragged lines\n\n\\# not a heading\n1\\. not a list\nplain \\*text\\*\n\n---\n\nPage two\n');
  assert.equal(pdfMarkdown(null, ['x']), 'x\n', 'no title, no heading');
});

test('a read is cut into ranges the shell answers whole', () => {
  assert.deepEqual(rangePieces(0, 10, 4), [[0, 4], [4, 8], [8, 10]]);
  assert.deepEqual(rangePieces(5, 6, 4), [[5, 6]]);
  assert.deepEqual(rangePieces(5, 5, 4), []);
});

test('the outline flattens in reading order with its depth, capped', () => {
  const leaf = (title: string): { title: string; dest: string; items: [] } => ({ title, dest: title, items: [] });
  const outline = [{ title: ' Part  one ', dest: 'p1', items: [leaf('Chapter 1'), { title: '', dest: 'c2', items: [leaf('Deep')] }] }, leaf('Part two')];
  assert.deepEqual(flattenOutline(outline).map((e) => [e.title, e.depth, e.dest]), [
    ['Part one', 0, 'p1'],
    ['Chapter 1', 1, 'Chapter 1'],
    ['Untitled', 1, 'c2'],
    ['Deep', 2, 'Deep'],
    ['Part two', 0, 'Part two'],
  ]);
  assert.equal(flattenOutline(outline, 2).length, 2);
  assert.deepEqual(flattenOutline(outline, 500, 1).map((e) => e.title), ['Part one', 'Part two']);
});
