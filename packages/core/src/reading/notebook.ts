// A Jupyter notebook as Read sets it ("A Jupyter notebook"): its cells in order, Markdown
// cells through Marxy's own Markdown path, code cells as fences in the kernel's language (so the page's highlight pass
// colours them as it colours any fence), and the outputs as they were saved. Nothing runs: HTML is cleaned by an
// allow-list (notebook-html.ts) and a line says what was left out; JavaScript and widget outputs are named and shown as
// text on request; a traceback loses its colour codes. Every block carries the file's own bytes, so the reading line,
// find, the panel, copy and Export work as on any reading. Source stays the JSON. nbformat 4, and 3. Pure.
import { accountHtml } from './account.ts';
import type { ByteOffsets } from '../parse/byte-offsets.ts';
import { langOfFence } from '../kind/registry.ts';
import { renderSafeHtml } from '../render/pipeline.ts';
import { cleanOutputHtml, leftOutWords } from './notebook-html.ts';
import { parseJson, TreeError } from './tree.ts';
import type { Reading, ReadingItem } from './index.ts';
import { atxHeading, own } from '../util/text.ts';
import { plural, utf8Length } from '../util/count.ts';

/** Past this a notebook is not set as cells: the JSON is shown as code, as a data file past its tree's cap is. */
export const NOTEBOOK_MAX_BYTES = 64 * 1024 * 1024;
/** One text output's lines drawn; past it the page says how many there are and that Source has them all. */
export const OUTPUT_MAX_LINES = 2000;
const OUTPUT_MAX_CHARS = 200_000;
/** An HTML or Markdown output past this is not cleaned and shown; it is named and its size said. */
export const OUTPUT_MAX_HTML = 1024 * 1024;
/** An image output's encoded data past this is not shown. */
const OUTPUT_MAX_IMAGE = 16 * 1024 * 1024;
/**
 * The page draws a notebook's first cells, as a tree draws its first values: to this many, or this much HTML
 * (characters), whichever comes first. Past it a line says how many cells are left and where Source has them, and the
 * panel still lists every cell. Each Markdown cell is a parse and a render of its own, so the count bounds the time.
 */
export const NOTEBOOK_MAX_CELLS = 1000;
export const NOTEBOOK_MAX_HTML = 1536 * 1024;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sizeWords = (n: number): string => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ---- where each value sits in the text ------------------------------------------------------------------------------

/** A JSON value's span (UTF-16 offsets, a string's quotes included), and its members'. */
interface Loc {
  readonly s: number;
  readonly e: number;
  /** An object's member names, beside `kids`. */
  readonly keys?: string[];
  readonly kids?: Loc[];
}

/**
 * Spans for every value of `text`, which `JSON.parse` has already accepted: a scan that skips string contents rather
 * than decoding them, so a notebook of base64 images is walked once and nothing in it is copied.
 */
function locate(text: string): Loc {
  let i = 0;
  const ws = (): void => {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else return;
    }
  };
  const skipString = (): void => {
    i++;
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 92) i += 2;
      else if (c === 34) {
        i++;
        return;
      } else if (Number.isNaN(c)) return;
      else i++;
    }
  };
  const value = (): Loc => {
    ws();
    const s = i;
    const c = text[i];
    if (c === '{' || c === '[') {
      const isObject = c === '{';
      i++;
      const keys: string[] = [];
      const kids: Loc[] = [];
      ws();
      if (text[i] === (isObject ? '}' : ']')) {
        i++;
        return isObject ? { s, e: i, keys, kids } : { s, e: i, kids };
      }
      for (;;) {
        if (isObject) {
          ws();
          const ks = i;
          skipString();
          const raw = text.slice(ks + 1, i - 1);
          keys.push(raw.includes('\\') ? (JSON.parse(text.slice(ks, i)) as string) : raw);
          ws();
          i++; // the colon
        }
        kids.push(value());
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        i++; // the closing bracket
        return isObject ? { s, e: i, keys, kids } : { s, e: i, kids };
      }
    }
    if (c === '"') {
      skipString();
      return { s, e: i };
    }
    while (i < text.length && !',]} \t\r\n'.includes(text[i]!)) i++;
    return { s, e: i };
  };
  return value();
}

const member = (loc: Loc | undefined, key: string): Loc | undefined => {
  const at = loc?.keys?.indexOf(key) ?? -1;
  return at < 0 ? undefined : loc!.kids![at];
};
const item = (loc: Loc | undefined, n: number): Loc | undefined => loc?.kids?.[n];

// ---- a cell's text, and the way back to the file's bytes -----------------------------------------------------------

/** Text joined from a notebook's string or list of strings, with each code unit's place in the file's text. */
interface Mapped {
  readonly text: string;
  /** Where each code unit's spelling starts and ends in the file's text (an escape is one spelling). */
  readonly from: Int32Array;
  readonly to: Int32Array;
  /** The value's own span, for an empty one. */
  readonly loc: Loc;
}

const joined = (v: unknown): string => (Array.isArray(v) ? v.join('') : typeof v === 'string' ? v : '');

/** What a JSON escape's letter stands for; `u` is read from its four digits. */
const ESCAPED: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };

/** `value` (a string, or a list of strings, as the notebook keeps text), with its map back to `text`. */
function mapped(text: string, value: unknown, loc: Loc, prefix = ''): Mapped {
  const parts = Array.isArray(value) ? (loc.kids ?? []) : typeof value === 'string' ? [loc] : [];
  // Typed and sized once (an escape only shortens), with plain runs sliced whole: a 10 MB notebook's sources were seconds
  // of one character at a time.
  let room = prefix.length;
  for (const part of parts) room += Math.max(0, part.e - part.s - 2);
  const from = new Int32Array(room);
  const to = new Int32Array(room);
  let n = 0;
  const out: string[] = [prefix];
  // A prefix the reading adds (an nbformat 3 heading's marks) stands where the text starts.
  const first = parts[0] ? parts[0].s + 1 : loc.s;
  for (let k = 0; k < prefix.length; k++) {
    from[n] = first;
    to[n++] = first;
  }
  for (const part of parts) {
    let i = part.s + 1;
    const end = part.e - 1;
    while (i < end) {
      let run = text.indexOf('\\', i);
      if (run === -1 || run > end) run = end;
      if (run > i) {
        out.push(text.slice(i, run));
        for (; i < run; i++) {
          from[n] = i;
          to[n++] = i + 1;
        }
      }
      if (i >= end) break;
      const e = text[i + 1]!;
      const len = e === 'u' ? 6 : 2;
      out.push(e === 'u' ? String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)) : (ESCAPED[e] ?? e));
      from[n] = i;
      to[n++] = i + len;
      i += len;
    }
  }
  return { text: out.join(''), from: from.subarray(0, n), to: to.subarray(0, n), loc };
}

/** The code unit at each UTF-8 byte boundary of `text`, so a render's byte offsets can be followed back. */
function unitsOfBytes(text: string): Int32Array {
  const bytes = utf8Length(text);
  const units = new Int32Array(bytes + 1).fill(-1);
  let b = 0;
  for (let k = 0; k < text.length; k++) {
    units[b] = k;
    const c = text.charCodeAt(k);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c <= 0xdbff && (text.charCodeAt(k + 1) & 0xfc00) === 0xdc00) {
      b += 4;
      k++;
    } else b += 3;
  }
  units[bytes] = text.length;
  return units;
}

/** The file byte of an offset into `m`'s text: a start names its character's first byte, an end the byte after it. */
function fileByte(m: Mapped, offsets: ByteOffsets, unit: number, end: boolean): number {
  const n = m.from.length;
  if (n === 0) return offsets.at(end ? m.loc.e : m.loc.s);
  if (end) return offsets.at(unit <= 0 ? m.from[0]! : m.to[Math.min(unit, n) - 1]!);
  return offsets.at(unit >= n ? m.to[n - 1]! : m.from[Math.max(0, unit)]!);
}

const range = (s: number, e: number): string => ` data-marxy-s="${s}" data-marxy-e="${e}"`;
const spanOf = (loc: Loc, offsets: ByteOffsets): string => range(offsets.at(loc.s), offsets.at(loc.e));

// ---- the notebook, read --------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** nbformat 3 keeps an output's data under short names on the output itself. */
const V3_MIME: Readonly<Record<string, string>> = {
  text: 'text/plain', html: 'text/html', markdown: 'text/markdown', latex: 'text/latex', png: 'image/png', jpeg: 'image/jpeg',
  svg: 'image/svg+xml', javascript: 'application/javascript', json: 'application/json', pdf: 'application/pdf',
};
const V3_TYPE: Readonly<Record<string, string>> = { pyout: 'execute_result', pyerr: 'error' };

interface Output {
  readonly type: string;
  readonly raw: Json;
  readonly loc: Loc;
  /** The MIME bundle, nbformat 4's names, with each value's span. */
  readonly data: ReadonlyMap<string, { value: unknown; loc: Loc }>;
}

interface Cell {
  readonly type: 'markdown' | 'code' | 'raw';
  readonly raw: Json;
  readonly loc: Loc;
  /** Its text with the map back to the file's: made when first read (a cell past the page's budget never needs it). */
  readonly source: Mapped;
  /** Its text alone. */
  readonly sourceText: string;
  readonly count: number | null;
  readonly outputs: readonly Output[];
  /** A cell's own language (nbformat 3's `language`, VS Code's `languageId`), over the kernel's. */
  readonly lang: string | null;
}

interface Notebook {
  readonly major: number;
  readonly minor: number;
  readonly meta: Json;
  readonly cells: readonly Cell[];
}

function outputOf(raw: Json, loc: Loc, v3: boolean): Output {
  const data = new Map<string, { value: unknown; loc: Loc }>();
  if (v3) {
    for (const [k, mime] of Object.entries(V3_MIME)) {
      const at = member(loc, k);
      if (at && k in raw && !(k === 'text' && raw.output_type === 'stream')) data.set(mime, { value: raw[k], loc: at });
    }
  } else {
    const bundle = obj(raw.data);
    const at = member(loc, 'data');
    for (const k of Object.keys(bundle)) {
      const l = member(at, k);
      if (l) data.set(k, { value: bundle[k], loc: l });
    }
  }
  const type = str(raw.output_type);
  return { type: own(V3_TYPE, type) ?? type, raw, loc, data };
}

function readNotebook(text: string, root: unknown, rootLoc: Loc): Notebook | string {
  const nb = obj(root);
  if (typeof nb.nbformat !== 'number') return 'a notebook: there is no nbformat';
  const major = nb.nbformat;
  if (major !== 3 && major !== 4) return `a notebook this reads: nbformat ${major} (4 and 3 are read)`;
  const v3 = major === 3;
  let cellsValue: unknown;
  let cellsLoc: Loc | undefined;
  if (v3) {
    const sheet = Array.isArray(nb.worksheets) ? obj(nb.worksheets[0]) : {};
    cellsValue = sheet.cells;
    cellsLoc = member(item(member(rootLoc, 'worksheets'), 0), 'cells');
  } else {
    cellsValue = nb.cells;
    cellsLoc = member(rootLoc, 'cells');
  }
  if (!Array.isArray(cellsValue) || !cellsLoc) return 'a notebook: there is no list of cells';
  const cells: Cell[] = [];
  cellsValue.forEach((value, n) => {
    const raw = obj(value);
    const loc = item(cellsLoc, n)!;
    const kind = str(raw.cell_type);
    const sourceKey = v3 && kind === 'code' ? 'input' : 'source';
    const sourceLoc = member(loc, sourceKey) ?? loc;
    // nbformat 3's heading cell is Markdown with its level's marks.
    const prefix = kind === 'heading' ? `${'#'.repeat(Math.min(6, Math.max(1, Number(raw.level) || 1)))} ` : '';
    let source: Mapped | undefined;
    const outLoc = member(loc, 'outputs');
    const outputs = Array.isArray(raw.outputs) ? raw.outputs.map((o, k) => outputOf(obj(o), item(outLoc, k)!, v3)) : [];
    const countValue = v3 ? raw.prompt_number : raw.execution_count;
    const vscode = obj(obj(raw.metadata).vscode).languageId;
    cells.push({
      type: kind === 'markdown' || kind === 'heading' ? 'markdown' : kind === 'code' ? 'code' : 'raw',
      raw,
      loc,
      get source() {
        return (source ??= mapped(text, raw[sourceKey], sourceLoc, prefix));
      },
      sourceText: prefix + joined(raw[sourceKey]),
      count: typeof countValue === 'number' ? countValue : null,
      outputs,
      lang: typeof raw.language === 'string' ? raw.language : typeof vscode === 'string' ? vscode : null,
    });
  });
  return { major, minor: typeof nb.nbformat_minor === 'number' ? nb.nbformat_minor : 0, meta: obj(nb.metadata), cells };
}

// ---- the page --------------------------------------------------------------------------------------------------------

/** Every escape sequence a terminal reads (colour, cursor, a title): a traceback's colour codes are these. */
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** A cell magic that names the cell's language: `%%bash` is shell, `%%html` is HTML, whatever the kernel. */
const MAGIC_LANG: Readonly<Record<string, string>> = {
  bash: 'shellscript', sh: 'shellscript', script: 'shellscript', javascript: 'javascript', js: 'javascript', html: 'html',
  latex: 'latex', markdown: 'markdown', ruby: 'ruby', perl: 'perl', sql: 'sql', python: 'python', python3: 'python', svg: 'xml',
};

/** A text as a terminal showed it: colour codes out, a line overwritten by a carriage return kept as it ended. */
function terminalText(text: string): { text: string; codes: number } {
  const codes = (text.match(ANSI) ?? []).length;
  const plain = codes ? text.replace(ANSI, '') : text;
  return { text: plain.includes('\r') ? plain.replace(/\r\n/g, '\n').split('\n').map((l) => l.slice(l.lastIndexOf('\r') + 1)).join('\n') : plain, codes };
}

/** A text output's `<pre>`, its first lines past the caps, and the line that says so. */
function textBlock(text: string, cls = 'marxy-nb-text'): string {
  const lines = text.replace(/\n$/, '').split('\n');
  let shown = lines.length > OUTPUT_MAX_LINES ? lines.slice(0, OUTPUT_MAX_LINES).join('\n') : lines.join('\n');
  const cut = shown.length > OUTPUT_MAX_CHARS;
  if (cut) shown = shown.slice(0, OUTPUT_MAX_CHARS);
  const more =
    lines.length > OUTPUT_MAX_LINES || cut
      ? `<p class="marxy-nb-note">The first ${cut ? plural(shown.split('\n').length, 'line') : plural(OUTPUT_MAX_LINES, 'line')} of ${lines.length.toLocaleString('en-GB')}; Source has them all.</p>`
      : '';
  return `<pre class="${cls}">${esc(shown)}</pre>${more}`;
}

/** Markdown through Marxy's own path; its byte offsets (into `m`'s text) moved onto the file's, or dropped. */
function markdownHtml(source: string, path: string, map: { m: Mapped; offsets: ByteOffsets } | null, ids: Set<string>): string {
  const { html } = renderSafeHtml(source, { file: path, frontmatter: false });
  const units = map ? unitsOfBytes(source) : null;
  let out = html.replace(/ data-marxy-([se])="(\d+)"/g, (_all, which: string, n: string) => {
    if (!map || !units) return '';
    const unit = units[Number(n)] ?? -1;
    return unit < 0 ? '' : ` data-marxy-${which === 's' ? 's' : 'e'}="${fileByte(map.m, map.offsets, unit, which === 'e')}"`;
  });
  // Each cell is rendered alone, so two cells' headings can share an id: the later one is numbered, as a page's are.
  out = out.replace(/<(h[1-6]) id="([^"]+)"/g, (_all, tag: string, id: string) => {
    let name = id;
    for (let k = 2; ids.has(name); k++) name = `${id}-${k}`;
    ids.add(name);
    return `<${tag} id="${name}"`;
  });
  return out;
}

const BASE64 = /^[A-Za-z0-9+/=\s]*$/;

/** How an output is counted on the card and the Cells card: what it shows. */
type Shown = 'image' | 'HTML' | 'Markdown' | 'LaTeX' | 'text' | 'error' | 'JavaScript' | 'widget' | 'other';

interface Said {
  readonly html: string;
  readonly shown: Shown;
  readonly js: boolean;
  readonly widget: boolean;
}

const IMAGES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const WIDGET = 'application/vnd.jupyter.widget-view+json';

/** What an output is and that it never ran, with the output as written behind "Show it as written": never parsed. */
function asWritten(note: string, text: string): string {
  return `<details class="marxy-nb-asis"><summary><span class="marxy-nb-said">${esc(note)}</span> <span class="marxy-nb-show">Show it as written</span></summary>${textBlock(text)}</details>`;
}

function outputHtml(o: Output, path: string, ids: Set<string>): Said {
  // The cell's range is on its section: an output has none of its own (see `notebookReading`).
  const count = o.raw.execution_count ?? o.raw.prompt_number;
  const run = o.type === 'execute_result' && typeof count === 'number' ? ` data-marxy-run="${count}"` : '';
  if (o.type === 'stream') {
    const name = str(o.raw.name) || str(o.raw.stream) || 'stdout';
    const { text, codes } = terminalText(joined(o.raw.text));
    const err = name === 'stderr';
    const note = [err ? 'stderr' : '', codes ? `${plural(codes, 'colour code')} left out; Source has them` : ''].filter(Boolean).join(' · ');
    return {
      html: `<div class="marxy-nb-out marxy-nb-stream${err ? ' marxy-nb-stderr' : ''}">${textBlock(text)}${note ? `<p class="marxy-nb-note">${esc(note)}.</p>` : ''}</div>`,
      shown: 'text',
      js: false,
      widget: false,
    };
  }
  if (o.type === 'error') {
    const tb = Array.isArray(o.raw.traceback) ? o.raw.traceback.map(String).join('\n') : '';
    const { text, codes } = terminalText(tb);
    const head = `<p class="marxy-nb-ename"><b>${esc(str(o.raw.ename))}</b>: ${esc(str(o.raw.evalue))}</p>`;
    const note = codes ? `<p class="marxy-nb-note">${plural(codes, 'colour code')} in the traceback left out; Source has them.</p>` : '';
    return { html: `<div class="marxy-nb-out marxy-nb-error">${head}${text ? textBlock(text) : ''}${note}</div>`, shown: 'error', js: false, widget: false };
  }
  const d = o.data;
  const parts: string[] = [];
  let shown: Shown = 'other';
  const value = (mime: string): string => joined(d.get(mime)?.value);
  const image = IMAGES.find((m) => d.has(m));
  if (image) {
    const data = value(image);
    if (data.length > OUTPUT_MAX_IMAGE) parts.push(`<p class="marxy-nb-note">An image output of ${sizeWords(data.length)}, past what Marxy shows; Source has it.</p>`);
    else if (!BASE64.test(data)) parts.push('<p class="marxy-nb-note">An image output whose data does not read as base64; Source has it.</p>');
    else {
      const alt = value('text/plain').trim() || 'An image output';
      const size = obj(obj(o.raw.metadata)[image]);
      const w = typeof size.width === 'number' ? ` width="${Math.round(size.width)}"` : '';
      const h = typeof size.height === 'number' ? ` height="${Math.round(size.height)}"` : '';
      parts.push(`<img class="marxy-nb-img" alt="${esc(alt)}"${w}${h} src="data:${image};base64,${data.replace(/\s/g, '')}" data-marxy-done="images" />`);
    }
    shown = 'image';
  } else if (d.has('image/svg+xml')) {
    const svg = value('image/svg+xml');
    if (svg.length > OUTPUT_MAX_HTML) parts.push(`<p class="marxy-nb-note">An SVG output of ${sizeWords(svg.length)}, past what Marxy shows; Source has it.</p>`);
    // Through <img> only, as a data URL: an SVG drawn as an image never runs its script and fetches nothing.
    else parts.push(`<img class="marxy-nb-img" alt="${esc(value('text/plain').trim() || 'An SVG output')}" src="data:image/svg+xml;charset=utf-8,${esc(encodeURIComponent(svg))}" data-marxy-done="images" />`);
    shown = 'image';
  } else if (d.has('text/html')) {
    const html = value('text/html');
    if (html.length > OUTPUT_MAX_HTML) parts.push(`<p class="marxy-nb-note">An HTML output of ${sizeWords(html.length)}, past what Marxy cleans and shows; Source has it.</p>`);
    else {
      const clean = cleanOutputHtml(html);
      const said = leftOutWords(clean.left);
      parts.push(`<div class="marxy-nb-html">${clean.html}</div><p class="marxy-nb-note">HTML output, cleaned${said ? `: ${said} left out` : ''}.</p>`);
    }
    shown = 'HTML';
  } else if (d.has('text/markdown')) {
    const md = value('text/markdown');
    parts.push(md.length > OUTPUT_MAX_HTML ? `<p class="marxy-nb-note">A Markdown output of ${sizeWords(md.length)}, past what Marxy shows; Source has it.</p>` : `<div class="marxy-nb-md-out">${markdownHtml(md, path, null, ids)}</div>`);
    shown = 'Markdown';
  } else if (d.has('text/latex')) {
    const tex = value('text/latex').trim();
    // Read as Marxy reads math in Markdown: display math when the output is not already in dollars.
    const md = /^\$/.test(tex) ? tex : `$$\n${tex}\n$$`;
    parts.push(`<div class="marxy-nb-md-out">${markdownHtml(md, path, null, ids)}</div>`);
    shown = 'LaTeX';
  } else if (d.has('text/plain')) {
    parts.push(textBlock(terminalText(value('text/plain')).text));
    shown = 'text';
  }
  const js = d.has('application/javascript');
  if (js) {
    const code = value('application/javascript');
    parts.push(asWritten(`A JavaScript output, ${plural(code.replace(/\n$/, '').split('\n').length, 'line')}: never run.`, code));
    if (shown === 'other') shown = 'JavaScript';
  }
  const widget = d.has(WIDGET);
  if (widget) {
    const spec = d.get(WIDGET)!;
    const written = typeof spec.value === 'string' ? spec.value : JSON.stringify(spec.value, null, 1);
    parts.push(asWritten('A Jupyter widget: never run, as it needs a kernel.', written));
    if (shown === 'other') shown = 'widget';
  }
  if (parts.length === 0) {
    const kinds = [...d.keys()];
    parts.push(`<p class="marxy-nb-note">${kinds.length ? `An output of ${kinds.map(esc).join(', ')}, which Marxy does not show` : 'An empty output'}; Source has it.</p>`);
  }
  const kind = o.type === 'execute_result' ? 'marxy-nb-result' : 'marxy-nb-display';
  return { html: `<div class="marxy-nb-out ${kind}"${run}>${parts.join('')}</div>`, shown, js, widget };
}

/** The first line of a cell worth naming: not blank, not a comment, unless that is all there is. */
function firstLine(text: string): string {
  const lines = text.split('\n');
  const line = lines.find((l) => l.trim() !== '' && !/^\s*(#|\/\/|--)/.test(l)) ?? lines.find((l) => l.trim() !== '') ?? '';
  const t = line.trim();
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

/** The headings a Markdown cell holds (outside its fences), each with where its line starts in `m`'s text. */
function headingsOf(text: string): { level: number; text: string; unit: number }[] {
  const out: { level: number; text: string; unit: number }[] = [];
  let fence = false;
  let at = 0;
  for (const line of text.split('\n')) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    const h = fence ? null : atxHeading(line, 3, true);
    if (h) out.push({ level: h.level, text: h.text.replace(/[*_`]/g, ''), unit: at });
    at += line.length + 1;
  }
  return out;
}

/**
 * The notebook reading of `text` (the file decoded, `offsets` its byte table), or why it is not one: `failed` holds the
 * line and what was expected when the file is not JSON, and `notNotebook` what was missing when it is JSON but not a
 * notebook this reads.
 */
export function notebookReading(
  path: string,
  text: string,
  offsets: ByteOffsets,
  lineAt: (cu: number) => number,
): Reading | { readonly failed: { readonly line: number; readonly why: string } } {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    // The page's own parser says where, in words, as a data file's does.
    try {
      parseJson(text);
      return { failed: { line: 1, why: 'expected JSON' } };
    } catch (error) {
      if (!(error instanceof TreeError)) throw error;
      return { failed: { line: lineAt(error.at), why: error.message } };
    }
  }
  const rootLoc = locate(text);
  const nb = readNotebook(text, root, rootLoc);
  if (typeof nb === 'string') return { failed: { line: 1, why: `expected ${nb}` } };

  const ks = obj(nb.meta.kernelspec);
  const info = obj(nb.meta.language_info);
  const language = str(info.name) || str(ks.language) || str(nb.meta.language);
  const kernel = str(ks.display_name) || str(ks.name) || (language ? language : 'no kernel named');
  const kernelLang = language ? langOfFence(language) : '';

  const ids = new Set<string>();
  const counts = { markdown: 0, code: 0, raw: 0 };
  const items: ReadingItem[] = [];
  const outs: Shown[] = [];
  let js = 0;
  let widgets = 0;
  const body: string[] = [];
  let drawn = 0;
  let stoppedAt: number | null = null;
  let undrawnOutputs = 0;
  const drawCell = (cell: Cell, n: number): void => {
    const src = cell.source;
    if (cell.type === 'markdown') {
      for (const h of headingsOf(src.text)) items.push({ text: h.text, sub: '', byte: fileByte(src, offsets, h.unit, false), tone: 'heading' });
      const html = src.text.trim() ? markdownHtml(src.text, path, { m: src, offsets }, ids) : '';
      body.push(`<section class="marxy-nb-cell marxy-nb-md" data-marxy-cell="${n}">${html}</section>`);
      return;
    }
    if (cell.type === 'raw') {
      const at = range(fileByte(src, offsets, 0, false), fileByte(src, offsets, src.text.length, true));
      body.push(`<section class="marxy-nb-cell marxy-nb-raw" data-marxy-cell="${n}"><p class="marxy-nb-note">A raw cell, as written</p><pre class="marxy-nb-text"${at}>${esc(src.text)}</pre></section>`);
      return;
    }
    const magic = /^%%(\w+)/.exec(src.text)?.[1];
    const lang = (magic && own(MAGIC_LANG, magic)) || (cell.lang ? langOfFence(cell.lang) : kernelLang);
    const cls = lang ? ` class="language-${esc(lang)}"` : '';
    const langAttr = lang ? ` data-marxy-lang="${esc(lang)}"` : '';
    const said = cell.outputs.map((o) => outputHtml(o, path, ids));
    for (const s of said) {
      outs.push(s.shown);
      if (s.js) js++;
      if (s.widget) widgets++;
    }
    const code = src.text.endsWith('\n') ? src.text : `${src.text}\n`;
    const run = cell.count === null ? ' ' : String(cell.count);
    const kinds = [...new Set(said.map((s) => s.shown))];
    items.push({ text: `[${run}] ${firstLine(src.text) || '(empty)'}`, sub: kinds.join(', '), byte: offsets.at(cell.loc.s), tone: 'code' });
    // One range for the code cell, its source and outputs together: Jupyter writes a cell's keys in order, so its
    // outputs come before its source in the bytes, and blocks must start in the file's order for the reading line.
    body.push(
      `<section class="marxy-nb-cell marxy-nb-code" data-marxy-cell="${n}" data-marxy-run="${run}"${spanOf(cell.loc, offsets)}><pre${cls}${langAttr}><code${cls}>${esc(code)}</code></pre>${
        said.length ? `<div class="marxy-nb-outputs">${said.map((s) => s.html).join('')}</div>` : ''
      }</section>`,
    );
  };
  nb.cells.forEach((cell, n) => {
    counts[cell.type]++;
    if (stoppedAt === null && (n >= NOTEBOOK_MAX_CELLS || drawn > NOTEBOOK_MAX_HTML)) stoppedAt = n;
    if (stoppedAt !== null) {
      // Past the budget a cell is listed, not drawn: nothing of it is rendered, cleaned or mapped, so a heading there is
      // listed at its cell's byte rather than its own.
      if (cell.type === 'markdown') {
        for (const h of headingsOf(cell.sourceText)) items.push({ text: h.text, sub: '', byte: offsets.at(cell.loc.s), tone: 'heading' });
      } else if (cell.type === 'code') {
        undrawnOutputs += cell.outputs.length;
        const run = cell.count === null ? ' ' : String(cell.count);
        items.push({ text: `[${run}] ${firstLine(cell.sourceText) || '(empty)'}`, sub: 'not drawn; Source has it', byte: offsets.at(cell.loc.s), tone: 'code' });
      }
      return;
    }
    const before = body.length;
    drawCell(cell, n);
    for (let i = before; i < body.length; i++) drawn += body[i]!.length;
  });
  if (stoppedAt !== null) {
    const at = nb.cells[stoppedAt]!.loc.s;
    const more = nb.cells.length - stoppedAt;
    body.push(
      `<p class="marxy-nb-note marxy-nb-stop"${range(offsets.at(at), offsets.at(at))}><b>${plural(more, 'more cell')} here, not drawn.</b> Read draws a notebook's first ${NOTEBOOK_MAX_CELLS.toLocaleString('en-GB')} cells, or ${sizeWords(NOTEBOOK_MAX_HTML)} of them; the panel lists them all, and Source has the rest, from line ${lineAt(at).toLocaleString('en-GB')}.</p>`,
    );
  }

  const cellWords = [counts.markdown && `${counts.markdown} Markdown`, counts.code && `${counts.code} code`, counts.raw && `${counts.raw} raw`].filter(Boolean).join(', ');
  const headLine = `Jupyter notebook · ${kernel} · ${plural(nb.cells.length, 'cell')}${cellWords ? `: ${cellWords}` : ''}`;
  const account = accountHtml([
    'The outputs are the ones saved in the file, from the last time someone ran it. Marxy has no kernel and runs nothing.',
    'HTML outputs are cleaned before they are shown. JavaScript outputs and widgets are never run; Show it as written shows one as text.',
    'Source has the notebook’s JSON as written.',
  ], esc(headLine));
  const tally = new Map<Shown, number>();
  for (const s of outs) tally.set(s, (tally.get(s) ?? 0) + 1);
  const order: Shown[] = ['image', 'HTML', 'Markdown', 'LaTeX', 'text', 'error', 'JavaScript', 'widget', 'other'];
  const outWords = order.filter((k) => tally.has(k)).map((k) => `${tally.get(k)} ${k}`).join(', ');
  const runs = ['never: Marxy has no kernel', js ? `${plural(js, 'JavaScript output')} not run` : '', widgets ? `${plural(widgets, 'widget')} not run` : ''].filter(Boolean).join('; ');
  const version = str(info.version);
  return {
    id: 'notebook',
    name: 'a notebook',
    format: 'Jupyter notebook',
    html: `<div class="marxy-reading marxy-notebook" data-marxy-reading="notebook">${account}${body.join('')}</div>`,
    contents: { title: 'Cells', items, detail: String(nb.cells.length) },
    meta: {
      title: 'Notebook',
      rows: [
        { key: 'kernel', value: kernel },
        { key: 'language', value: language ? `${language}${version ? ` ${version}` : ''}` : 'not named' },
        { key: 'format', value: `nbformat ${nb.major}.${nb.minor}` },
        { key: 'cells', value: `${nb.cells.length}${cellWords ? `: ${cellWords}` : ''}` },
        { key: 'outputs', value: outs.length + undrawnOutputs ? `${outs.length + undrawnOutputs} saved: ${outWords}${undrawnOutputs ? `, ${undrawnOutputs} in cells not drawn` : ''}` : 'none saved' },
        { key: 'runs', value: runs },
      ],
    },
    failed: null,
  };
}
