// PDFs written by hand for the demo and the checks: the standard Times faces (named, never embedded, so the file
// carries no font), an Info dictionary, an outline, and as many pages as asked. `node scripts/pdf-fixture.mjs` writes the
// demo's fixtures/demo/reading/the-case-for-ragged-lines.pdf from the essay beside it; the checks import `buildPdf` to make
// a long one in a temporary folder.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const A5 = [420, 595];
const MARGIN = 54;

/** A PDF string literal: ( ) and \ escaped, and only Latin-1 (the essay is ASCII). */
const str = (s) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** Lines of at most `chars` characters, broken at spaces: ragged, as the essay asks. */
function wrap(text, chars) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > chars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * `spec.pages` is a list of pages, each a list of blocks `{ font: 'body' | 'italic' | 'title' | 'heading', text }`;
 * `spec.outline` a list of `{ title, page }`; `spec.info` the Info dictionary's fields. Returns the file's bytes.
 */
export function buildPdf(spec) {
  const [W, H] = spec.size ?? A5;
  const fonts = { body: ['F1', 11, 15.5], italic: ['F2', 11, 15.5], heading: ['F3', 13, 18], title: ['F1', 22, 27] };
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pagesId = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>');
  const f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  spec.pages.forEach((blocks, i) => {
    let y = H - MARGIN;
    const ops = ['BT'];
    for (const b of blocks) {
      const [font, size, lead] = fonts[b.font] ?? fonts.body;
      const chars = Math.floor((W - 2 * MARGIN) / (size * 0.5));
      for (const line of wrap(b.text, chars)) {
        y -= lead;
        ops.push(`/${font} ${size} Tf 1 0 0 1 ${MARGIN} ${y.toFixed(1)} Tm ${str(line)} Tj`);
      }
      y -= lead * 0.6;
    }
    ops.push(`/F1 9 Tf 1 0 0 1 ${(W / 2 - 3).toFixed(1)} 30 Tm ${str(String(i + 1))} Tj`, 'ET');
    const content = ops.join('\n');
    const stream = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> >> /Contents ${stream} 0 R >>`));
  });
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let outlines = '';
  if (spec.outline?.length) {
    const root = add(null);
    const ids = spec.outline.map(() => add(null));
    spec.outline.forEach((o, k) => {
      const links = [k > 0 ? `/Prev ${ids[k - 1]} 0 R` : '', k + 1 < ids.length ? `/Next ${ids[k + 1]} 0 R` : ''].join(' ');
      objects[ids[k] - 1] = `<< /Title ${str(o.title)} /Parent ${root} 0 R ${links} /Dest [${pageIds[o.page]} 0 R /XYZ null null null] >>`;
    });
    objects[root - 1] = `<< /Type /Outlines /First ${ids[0]} 0 R /Last ${ids.at(-1)} 0 R /Count ${ids.length} >>`;
    outlines = ` /Outlines ${root} 0 R`;
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${outlines} >>`;
  const info = add(`<< ${Object.entries(spec.info ?? {}).map(([k, v]) => `/${k} ${str(v)}`).join(' ')} >>`);
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** The demo's essay as three A5 pages, its title and byline on the first, an outline of its three parts. */
export function demoPdf() {
  const essay = readFileSync(new URL('../../../fixtures/demo/reading/the-case-for-ragged-lines.md', import.meta.url), 'utf8');
  const paras = essay.replace(/^---[\s\S]*?---\s*/, '').split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith('#'));
  return buildPdf({
    pages: [
      [{ font: 'title', text: 'The case for ragged lines' }, { font: 'italic', text: 'M. Okafor - 2 March 2025' }, { font: 'body', text: paras[0] }],
      [{ font: 'heading', text: 'Looking ahead' }, { font: 'body', text: paras[1] }],
      [{ font: 'heading', text: 'Losing the place' }, { font: 'body', text: paras[2] }],
    ],
    outline: [
      { title: 'The case for ragged lines', page: 0 },
      { title: 'Looking ahead', page: 1 },
      { title: 'Losing the place', page: 2 },
    ],
    info: { Title: 'The case for ragged lines', Creator: 'Marxy\'s demo, set by hand', Producer: 'pdf-fixture.mjs', CreationDate: "D:20250302180000+00'00'" },
  });
}

/** A long PDF: `n` A4 pages, each naming its number, the word `needle` on the last. */
export function longPdf(n) {
  const pages = Array.from({ length: n }, (_, i) => [
    { font: 'heading', text: `Page ${i + 1} of ${n}` },
    { font: 'body', text: i === n - 1 ? 'The needle is on the last page.' : 'Nothing to find here but the number of the page.' },
  ]);
  return buildPdf({ pages, size: [595, 842], info: { Title: `${n} pages` } });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = new URL('../../../fixtures/demo/reading/the-case-for-ragged-lines.pdf', import.meta.url);
  const bytes = demoPdf();
  writeFileSync(out, bytes);
  console.log(`wrote ${fileURLToPath(out)} (${bytes.length} bytes)`);
}
