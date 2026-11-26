import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileTypeFor } from '../kind/registry.ts';
import { readingOf, type Reading } from './index.ts';
import { cleanOutputHtml, leftOutWords } from './notebook-html.ts';
import { NOTEBOOK_MAX_CELLS, OUTPUT_MAX_LINES } from './notebook.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const DEMO = new Uint8Array(readFileSync(new URL('../../../../fixtures/demo/notebooks/tide-heights.ipynb', import.meta.url)));

function read(nb: unknown, path = '/n/x.ipynb'): { r: Reading; bytes: Uint8Array } {
  const bytes = enc(typeof nb === 'string' ? nb : JSON.stringify(nb, null, 1));
  const r = readingOf(path, bytes, 'data');
  assert.ok(r, 'a reading');
  return { r, bytes };
}

const nb4 = (cells: unknown[], metadata: unknown = { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', version: '3.12.4' } }) => ({
  cells,
  metadata,
  nbformat: 4,
  nbformat_minor: 5,
});
const code = (source: string | string[], outputs: unknown[] = [], n: number | null = 1) => ({ cell_type: 'code', execution_count: n, metadata: {}, outputs, source });
const md = (source: string | string[]) => ({ cell_type: 'markdown', metadata: {}, source });

/** Every `data-marxy-s`/`data-marxy-e` pair, as the bytes it names. */
/** `re` in `html`, failing with the part of the page around where it was expected rather than the whole page. */
function has(html: string, re: RegExp, yes = true): void {
  if (re.test(html) === yes) return;
  const key = re.source.replace(/\\/g, '').slice(0, 24);
  const at = Math.max(0, html.indexOf(key.slice(0, 12)));
  assert.fail(`${yes ? 'missing' : 'present'}: ${re} near ${JSON.stringify(html.slice(at, at + 400).replace(/base64,[A-Za-z0-9+/=]{40,}/g, 'base64,…'))}`);
}

function spans(html: string, bytes: Uint8Array): string[] {
  const dec = new TextDecoder();
  return [...html.matchAll(/data-marxy-s="(\d+)" data-marxy-e="(\d+)"/g)].map((m) => dec.decode(bytes.subarray(Number(m[1]), Number(m[2]))));
}

test('the registry: .ipynb is a notebook reading, data, read whole by Find, Source in the JSON grammar', () => {
  const t = fileTypeFor('/a/tide-heights.ipynb');
  assert.equal(t.id, 'ipynb');
  assert.equal(t.reading, 'notebook');
  assert.equal(t.readerKind, 'data');
  assert.equal(t.viewer, 'text');
  assert.equal(t.cm, 'json');
  assert.equal(t.searchable, true);
});

test('the demo notebook: cells in order, Markdown set, code fenced in the kernel language, outputs as saved', () => {
  const r = readingOf('/demo/notebooks/tide-heights.ipynb', DEMO, 'data')!;
  assert.equal(r.id, 'notebook');
  assert.equal(r.name, 'a notebook');
  assert.equal(r.failed, null);
  has(r.html, /Jupyter notebook · Python 3 \(ipykernel\) · 9 cells: 3 Markdown, 6 code</);
  has(r.html, /Marxy has no kernel and runs nothing\./);
  has(r.html, /<h1 id="tide-heights-at-the-harbour"[^>]*>Tide heights at the harbour<\/h1>/);
  assert.equal((r.html.match(/<pre class="language-python" data-marxy-lang="python"><code class="language-python">/g) ?? []).length, 6);
  // Run numbers are attributes, drawn in the margin: never part of the text find and copy read.
  has(r.html, /data-marxy-run="2"/);
  has(r.html, />\[2\]</, false);
  // The pandas table: cleaned, its style block left out and said.
  has(r.html, /<td>2026-10-12 00:30:00<\/td>/);
  has(r.html, /HTML output, cleaned: 1 style block left out\./);
  // The image output, carried as a data URL and marked done for the page's image pass.
  has(r.html, /<img class="marxy-nb-img" alt="&lt;Figure size 600x260 with 1 Axes&gt;" src="data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+" data-marxy-done="images" \/>/);
  // Cell 5: script, handler and network image left out; the JavaScript output named and shown only as written.
  has(r.html, /HTML output, cleaned: 1 script, 1 event handler, 1 image from the network, 1 other part left out\./);
  has(r.html, /<script|onerror|tidekit\.example|document\.body\.style/, false);
  has(r.html, /<details class="marxy-nb-asis"><summary><span class="marxy-nb-said">A JavaScript output, 1 line: never run\.<\/span> <span class="marxy-nb-show">Show it as written<\/span><\/summary><pre class="marxy-nb-text">window\.__nbRan = 3;<\/pre><\/details>/);
  // The error: name and message, the traceback without its colour codes, and how many there were.
  has(r.html, /<p class="marxy-nb-ename"><b>KeyError<\/b>: '2026-10-13'<\/p>/);
  has(r.html, /\u001b/, false);
  has(r.html, /27 colour codes in the traceback left out; Source has them\./);
  has(r.html, /Source has the notebook’s JSON as written\./);
});

test('the demo notebook: the Cells card and the Notebook card', () => {
  const r = readingOf('/demo/notebooks/tide-heights.ipynb', DEMO, 'data')!;
  assert.equal(r.contents?.title, 'Cells');
  assert.equal(r.contents?.detail, '9');
  assert.deepEqual(
    r.contents?.items.map((i) => [i.text, i.sub, i.tone]),
    [
      ['Tide heights at the harbour', '', 'heading'],
      ['[1] import pandas as pd', '', 'code'],
      ['[2] df = pd.read_csv("gauge-2026-10-12.csv", parse_…', 'HTML', 'code'],
      ['Low water', '', 'heading'],
      ['[3] low = df.loc[df.height_m.idxmin()]', 'text', 'code'],
      ['[4] plt.figure(figsize=(6, 2.6))', 'image', 'code'],
      ['[5] from tidekit import embed', 'HTML', 'code'],
      ['[6] df.set_index("at").height_m.resample("1h").mean…', 'error', 'code'],
    ],
  );
  const dec = new TextDecoder();
  // A heading row goes to its own bytes; a code row to its cell.
  assert.ok(dec.decode(DEMO.subarray(r.contents!.items[0]!.byte)).startsWith('# Tide heights'));
  assert.ok(dec.decode(DEMO.subarray(r.contents!.items[1]!.byte)).startsWith('{\n   "cell_type": "code"'));
  assert.equal(r.meta?.title, 'Notebook');
  assert.deepEqual(Object.fromEntries(r.meta!.rows.map((x) => [x.key, x.value])), {
    kernel: 'Python 3 (ipykernel)',
    language: 'python 3.12.4',
    format: 'nbformat 4.5',
    cells: '9: 3 Markdown, 6 code',
    outputs: '5 saved: 1 image, 2 HTML, 1 text, 1 error',
    runs: 'never: Marxy has no kernel; 1 JavaScript output not run',
  });
});

test('every block names the file’s own bytes, in the file’s order', () => {
  const r = readingOf('/demo/notebooks/tide-heights.ipynb', DEMO, 'data')!;
  const starts = [...r.html.matchAll(/data-marxy-s="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(starts.length >= 10);
  assert.deepEqual([...starts].sort((a, b) => a - b), starts, 'blocks start in the file’s order');
  const named = spans(r.html, DEMO);
  assert.equal(named[0], '# Tide heights at the harbour');
  assert.ok(named.some((s) => s === '## Low water'));
  assert.ok(named.filter((s) => s.startsWith('{\n   "cell_type": "code"')).length === 6, 'each code cell is one block');
});

test('a Markdown cell’s blocks map through JSON escapes and multi-byte text to the bytes that spell them', () => {
  const { r, bytes } = read(nb4([md(['# Café “quoted” \\u00e9\n', '\n', 'A line with a \t tab and \\"quotes\\".\n'])]));
  const named = spans(r.html, bytes);
  assert.equal(named[0], '# Café “quoted” \\\\u00e9');
  assert.equal(named[1], 'A line with a \\t tab and \\\\\\"quotes\\\\\\".');
  // Raw text written in the source (\u escapes included) round-trips through the JSON.
  const raw = '{"cells":[{"cell_type":"markdown","metadata":{},"source":["# \\u00c9t\\u00e9\\n","\\n","Fin \\ud83c\\udf0a ok"]}],"metadata":{},"nbformat":4,"nbformat_minor":5}';
  const b = enc(raw);
  const got = readingOf('/n/raw.ipynb', b, 'data')!;
  has(got.html, /<h1[^>]*>Été<\/h1>/);
  assert.deepEqual(spans(got.html, b), ['# \\u00c9t\\u00e9', 'Fin \\ud83c\\udf0a ok']);
});

test('two cells with the same heading get two ids', () => {
  const { r } = read(nb4([md('## Results'), md('## Results')]));
  has(r.html, /id="results"/);
  has(r.html, /id="results-2"/);
});

test('the language: the kernel’s, a cell magic’s, a cell’s own; none named, none guessed', () => {
  const { r } = read(nb4([code('x <- 1'), code('%%bash\nls -la')], { kernelspec: { display_name: 'R', language: 'R', name: 'ir' }, language_info: { name: 'R' } }));
  has(r.html, /<pre class="language-r" data-marxy-lang="r"><code class="language-r">x &lt;- 1\n<\/code><\/pre>/);
  has(r.html, /<pre class="language-shellscript" data-marxy-lang="shellscript">/);
  const vs = read(nb4([{ ...code('SELECT 1'), metadata: { vscode: { languageId: 'sql' } } }]));
  has(vs.r.html, /class="language-sql"/);
  const bare = read(nb4([code('print(1)')], {}));
  has(bare.r.html, /<pre><code>print\(1\)\n<\/code><\/pre>/);
  has(bare.r.html, /Jupyter notebook · no kernel named · 1 cell: 1 code/);
});

test('outputs: stdout and stderr as text, colour codes and carriage returns as a terminal ends them', () => {
  const { r } = read(
    nb4([
      code('run()', [
        { name: 'stdout', output_type: 'stream', text: ['10%\r50%\r100%\n', 'done\n'] },
        { name: 'stderr', output_type: 'stream', text: '\u001b[31mwarning\u001b[0m: slow\n' },
      ]),
    ]),
  );
  has(r.html, /<pre class="marxy-nb-text">100%\ndone<\/pre>/);
  has(r.html, /marxy-nb-stream marxy-nb-stderr"><pre class="marxy-nb-text">warning: slow<\/pre><p class="marxy-nb-note">stderr · 2 colour codes left out; Source has them\.<\/p>/);
});

test('outputs: a long text output is capped and says so', () => {
  const lines = Array.from({ length: OUTPUT_MAX_LINES + 500 }, (_, i) => `line ${i + 1}\n`);
  const { r } = read(nb4([code('spam()', [{ name: 'stdout', output_type: 'stream', text: lines }])]));
  has(r.html, /line 2000\n?<\/pre>|line 2000<\/pre>/);
  has(r.html, /line 2001/, false);
  has(r.html, /The first 2,000 lines of 2,500; Source has them all\./);
});

test('outputs: Markdown and LaTeX as Marxy reads them; SVG only as an image; a widget and an unknown kind named', () => {
  const { r } = read(
    nb4([
      code('show()', [
        { output_type: 'display_data', metadata: {}, data: { 'text/markdown': '**bold** and `x`', 'text/plain': 'md' } },
        { output_type: 'display_data', metadata: {}, data: { 'text/latex': '\\frac{a}{b}', 'text/plain': 'a/b' } },
        { output_type: 'display_data', metadata: {}, data: { 'image/svg+xml': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="4" height="4"/></svg>' } },
        { output_type: 'display_data', metadata: {}, data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'abc', version_major: 2 }, 'text/plain': 'IntSlider(value=3)' } },
        { output_type: 'display_data', metadata: {}, data: { 'application/vnd.plotly.v1+json': {} } },
      ]),
    ]),
  );
  has(r.html, /<div class="marxy-nb-md-out"><p><strong>bold<\/strong> and <code>x<\/code><\/p><\/div>/);
  has(r.html, /<pre class="marxy-math-block"><code>\\frac\{a\}\{b\}\n<\/code><\/pre>/);
  // The SVG is never inlined: an <img> of a data URL, whose script cannot run.
  has(r.html, /<img class="marxy-nb-img" alt="An SVG output" src="data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  has(r.html, /<svg|<script/, false);
  has(r.html, /<pre class="marxy-nb-text">IntSlider\(value=3\)<\/pre><details class="marxy-nb-asis"><summary><span class="marxy-nb-said">A Jupyter widget: never run, as it needs a kernel\.<\/span>/);
  has(r.html, /An output of application\/vnd\.plotly\.v1\+json, which Marxy does not show; Source has it\./);
  assert.match(r.meta!.rows.find((x) => x.key === 'runs')!.value, /1 widget not run/);
});

test('nbformat 3: worksheets, heading cells, input and prompt numbers, outputs under short names', () => {
  const v3 = {
    metadata: { name: 'old' },
    nbformat: 3,
    nbformat_minor: 0,
    worksheets: [
      {
        cells: [
          { cell_type: 'heading', level: 2, metadata: {}, source: ['Old times'] },
          { cell_type: 'code', collapsed: false, input: ['1 + 1'], language: 'python', metadata: {}, outputs: [{ metadata: {}, output_type: 'pyout', prompt_number: 3, text: ['2'] }], prompt_number: 3 },
          { cell_type: 'code', input: 'boom()', language: 'python', metadata: {}, outputs: [{ ename: 'NameError', evalue: "name 'boom' is not defined", output_type: 'pyerr', traceback: ['\u001b[0;31mNameError\u001b[0m'] }], prompt_number: 4 },
          { cell_type: 'code', input: 'print(1)', language: 'python', metadata: {}, outputs: [{ output_type: 'stream', stream: 'stdout', text: '1\n' }], prompt_number: 5 },
        ],
        metadata: {},
      },
    ],
  };
  const { r, bytes } = read(v3);
  has(r.html, /<h2 id="old-times"[^>]*>Old times<\/h2>/);
  assert.equal(spans(r.html, bytes)[0], 'Old times', 'the heading’s marks are the reading’s; its range is its text');
  has(r.html, /data-marxy-run="3"[^>]*><pre class="language-python" data-marxy-lang="python"><code class="language-python">1 \+ 1\n/);
  has(r.html, /marxy-nb-result" data-marxy-run="3"><pre class="marxy-nb-text">2<\/pre>/);
  has(r.html, /<b>NameError<\/b>: name 'boom' is not defined/);
  has(r.html, /<pre class="marxy-nb-text">1<\/pre>/);
  assert.match(r.meta!.rows.find((x) => x.key === 'format')!.value, /nbformat 3\.0/);
});

test('a raw cell is shown as written', () => {
  const { r } = read(nb4([{ cell_type: 'raw', metadata: {}, source: '<b>not markup</b>' }]));
  has(r.html, /A raw cell, as written<\/p><pre class="marxy-nb-text" data-marxy-s="\d+" data-marxy-e="\d+">&lt;b&gt;not markup&lt;\/b&gt;<\/pre>/);
});

test('a file that is not a notebook is set as written, with the line and why', () => {
  const broken = readingOf('/n/broken.ipynb', enc('{\n "cells": [\n  {"cell_type": "code",,}\n ]\n}\n'), 'data')!;
  assert.equal(broken.id, 'written');
  assert.equal(broken.failed?.line, 3);
  has(broken.html, /A notebook Marxy cannot read: at line 3/);
  const noCells = readingOf('/n/plain.ipynb', enc('{"nbformat": 4, "metadata": {}}'), 'data')!;
  assert.equal(noCells.id, 'written');
  assert.match(noCells.failed!.why, /no list of cells/);
  const v5 = readingOf('/n/new.ipynb', enc('{"nbformat": 5, "cells": []}'), 'data')!;
  assert.match(v5.failed!.why, /nbformat 5/);
  // Shown as something else (code), the notebook is that kind's page.
  assert.equal(readingOf('/n/x.ipynb', enc(JSON.stringify(nb4([]))), 'code'), null);
});

// ---- the allow-list -------------------------------------------------------------------------------------------------

test('cleaning: a script, an onerror, a javascript: link and a remote image are each removed and counted', () => {
  const html =
    '<p>Keep <b>this</b>.</p>' +
    '<script>window.ran = 1</script>' +
    '<img src="data:image/png;base64,iVBORw0KGgo=" onerror="window.ran = 2" alt="dot">' +
    '<a href="javascript:window.ran = 3">click</a>' +
    '<img src="https://tracker.example/p.gif" alt="">';
  const c = cleanOutputHtml(html);
  assert.equal(c.left.script, 1);
  assert.equal(c.left.handler, 1);
  assert.equal(c.left.jsLink, 1);
  assert.equal(c.left.remote, 1);
  assert.equal(c.left.other, 0);
  assert.doesNotMatch(c.html, /script|onerror|javascript:|tracker\.example|window\.ran/);
  assert.match(c.html, /<p>Keep <b>this<\/b>\.<\/p>/);
  assert.match(c.html, /<img src="data:image\/png;base64,iVBORw0KGgo=" alt="dot" data-marxy-done="images" \/>/);
  assert.match(c.html, /<a>click<\/a>/);
  assert.equal(leftOutWords(c.left), '1 script, 1 event handler, 1 image from the network, 1 link that runs script');
});

test('cleaning: frames, forms, styles, inline SVG and local files go; ids, names and classes are not kept', () => {
  const c = cleanOutputHtml(
    '<style>p{color:red}</style><iframe src="https://x.example"></iframe><form action="/x"><input name="q"><button>Go</button></form>' +
      '<svg onload="x()"><circle r="2"/></svg><img src="plot.png" alt="local"><table class="dataframe" id="cookie"><tr><th name="n" style="x">a</th><td onclick="x()">1</td></tr></table>' +
      '<object data="x.swf"></object><link rel="stylesheet" href="https://cdn.example/a.css"><a href="https://example.org/" class="marxy-reading-head">ok</a>',
  );
  assert.equal(c.left.style, 1);
  assert.equal(c.left.frame, 2);
  assert.equal(c.left.form, 1);
  assert.equal(c.left.handler, 1);
  assert.ok(c.left.other >= 3, 'the SVG, the local image and the link element');
  assert.doesNotMatch(c.html, /iframe|form|input|button|svg|plot\.png|cookie|dataframe|marxy-reading-head|cdn\.example|style|onclick|object/);
  assert.match(c.html, /<table><tr><th>a<\/th><td>1<\/td><\/tr><\/table>/);
  assert.match(c.html, /<a href="https:\/\/example\.org\/">ok<\/a>/);
  assert.equal(leftOutWords({ script: 0, handler: 0, remote: 0, jsLink: 0, style: 0, frame: 0, form: 0, other: 0 }), '');
});

test('cleaning: a data URL that is not an image never reaches an <img>, nor a link', () => {
  const c = cleanOutputHtml('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="x"><a href="data:text/html,<script>1</script>">d</a>');
  assert.doesNotMatch(c.html, /data:text/);
  assert.doesNotMatch(c.html, /<img/);
});

test('a lone surrogate in a Markdown cell keeps every later block on its own bytes', () => {
  const cell = `${String.fromCharCode(0xd800)}${String.fromCharCode(0xe9)}\n\n# Head`;
  const text = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: 'markdown', source: cell, metadata: {} }] });
  const bytes = new TextEncoder().encode(text);
  const read = readingOf('s.ipynb', bytes)!;
  assert.equal(read.id, 'notebook');
  const at = Number(/<h1[^>]* data-marxy-s="(\d+)"/.exec(read.html)![1]);
  assert.equal(new TextDecoder().decode(bytes.subarray(at, at + 6)), '# Head');
});

test('a 10 MB notebook draws its first cells, says how many more and where, and lists every cell', () => {
  const cells: unknown[] = [];
  let size = 0;
  for (let i = 0; size < 10 * 1024 * 1024; i++) {
    const cell =
      i % 2 === 0
        ? { cell_type: 'markdown', metadata: {}, source: [`## Step ${i}\n`, `Words about step ${i}, with *emphasis* and a [link](https://example.com).\n`] }
        : code([`x = ${i}\n`, 'print(x * 2)\n'], [{ output_type: 'stream', name: 'stdout', text: [`${i * 2}\n`] }], i);
    size += JSON.stringify(cell).length;
    cells.push(cell);
  }
  const t0 = cpuNow();
  const { r } = read(nb4(cells));
  const ms = cpuNow() - t0;
  assert.ok(r.html.length < 2 * 1024 * 1024, `${r.html.length} characters of html`);
  // This file once took 7 s and 25 MB of html; warm, about 0.45 s now. The bound is a slow machine's; the clock is CPU time, so a busy one does not count.
  assert.ok(ms < 1500, `${Math.round(ms)} ms`);
  assert.equal((r.html.match(/<section class="marxy-nb-cell/g) ?? []).length, NOTEBOOK_MAX_CELLS);
  const stop = /<p class="marxy-nb-note marxy-nb-stop" data-marxy-s="(\d+)" data-marxy-e="\1"><b>([\d,]+) more cells here, not drawn\.<\/b>/.exec(r.html);
  assert.ok(stop, 'the stop line');
  assert.equal(Number(stop[2]!.replace(/,/g, '')), cells.length - NOTEBOOK_MAX_CELLS);
  // The panel lists every cell: a code cell's row, a Markdown cell's heading.
  assert.equal(r.contents?.items.length, cells.length);
  assert.equal(r.contents?.items.filter((item) => item.sub === 'not drawn; Source has it').length, Math.floor((cells.length - NOTEBOOK_MAX_CELLS) / 2));
  assert.match(r.meta!.rows.find((row) => row.key === 'outputs')!.value, /in cells not drawn/);
});

test('a Markdown cell’s code text keeps its quotes and attribute-shaped words', () => {
  const { r } = read(nb4([md('Use `<div id="main">` and `x data-marxy-s="5"`.\n')]));
  const shown = r.html.replace(/<[^>]*>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"');
  assert.match(shown, /<div id="main">/);
  assert.match(shown, /x data-marxy-s="5"/);
});
