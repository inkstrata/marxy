// A PDF's page state: its place kept per file while the app runs, Find's matches as pages are read, and the
// engine's terms: pdf.js with nothing evaluated, no WebAssembly, no XFA, read by range and never ahead of the view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEPT_MAX, PdfMatches, forgetKeptPdfs, keptPdf } from './pdf-state.ts';

test('a file opens at Fit width on its first page; its place, zoom and card choice are kept for it', () => {
  forgetKeptPdfs();
  const a = keptPdf('/r/a.pdf');
  assert.deepEqual({ ...a }, { zoom: 1, fit: 'width', place: { page: 0, fraction: 0 }, asCard: false });
  a.place = { page: 41, fraction: 0.5 };
  a.zoom = 1.5;
  a.fit = null;
  assert.equal(keptPdf('/r/a.pdf'), a, 'a reload, or a tab opened on it again, lands where the reader was');
  assert.deepEqual(keptPdf('/r/b.pdf').place, { page: 0, fraction: 0 }, 'another file starts at its first page');
});

test('at most KEPT_MAX files are kept; the one longest unopened goes first', () => {
  forgetKeptPdfs();
  keptPdf('/r/first.pdf').place = { page: 3, fraction: 0 };
  for (let i = 0; i < KEPT_MAX - 1; i++) keptPdf(`/r/${i}.pdf`);
  keptPdf('/r/first.pdf');
  keptPdf('/r/one-more.pdf');
  assert.equal(keptPdf('/r/first.pdf').place.page, 3, 'opened again lately, so kept');
  assert.equal(keptPdf('/r/0.pdf').place.page, 0);
});

test('Find\'s matches arrive a page at a time; the first one at or after the view waits until it is found', () => {
  const m = new PdfMatches(4);
  m.add(0, [{ page: 0, start: 1, end: 3 }]);
  assert.equal(m.first(2), -1, 'page 2 is not read yet: no answer');
  m.add(1, []);
  m.add(2, [{ page: 2, start: 0, end: 4 }, { page: 2, start: 9, end: 12 }]);
  assert.equal(m.first(2), 1);
  assert.equal(m.first(3), -1);
  m.add(3, []);
  assert.equal(m.done, true);
  assert.equal(m.first(3), 0, 'past the last match, Find wraps to the first');
  assert.deepEqual(m.onPage(2).map((x) => x.at), [1, 2]);
  assert.equal(new PdfMatches(2).first(0), -1);
});

test('pdf.js is bundled with nothing evaluated, and the engine asks for no WebAssembly, no XFA and nothing ahead', () => {
  const at = (p: string): string => readFileSync(new URL(`../../node_modules/pdfjs-dist/legacy/build/${p}`, import.meta.url), 'utf8');
  for (const file of ['pdf.mjs', 'pdf.worker.min.mjs']) {
    const src = at(file);
    assert.doesNotMatch(src, /\beval\(/, `${file}: no eval`);
    assert.doesNotMatch(src, /new Function\(/, `${file}: no new Function`);
  }
  const version = JSON.parse(readFileSync(new URL('../../node_modules/pdfjs-dist/package.json', import.meta.url), 'utf8')).version as string;
  const [major, minor] = version.split('.').map(Number);
  assert.ok(major! > 4 || (major === 4 && minor! >= 2), `pdf.js ${version} is past CVE-2024-4367's fix (4.2.67)`);
  const engine = readFileSync(new URL('./pdf-engine.ts', import.meta.url), 'utf8');
  for (const term of ['useWasm: false', 'enableXfa: false', 'disableAutoFetch: true', 'disableStream: true', 'range,']) assert.ok(engine.includes(term), term);
  assert.doesNotMatch(engine, /\burl:/, 'never a URL for pdf.js to fetch: the shell reads the ranges');
  assert.doesNotMatch(engine, /pdf\.sandbox/, 'the scripting sandbox is never loaded');
});
