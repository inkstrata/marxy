// A font as a specimen: drawn by the webview from the file through `FontFace`, as any web font
// is, and never installed. The name in its own face, its sets, a sample line from its own name table that the reader may
// type over (this tab's, never kept), a waterfall from 12 to 72, and every character it maps with its code point. A
// variable font has a slider per axis and its named instances as chips; a collection's faces are a row above, each
// lifted into a font of its own in memory, since the webview draws only a collection's first face. When the webview will
// not draw a face, the page says so and its tables are the facts (a tier, said in grey). Source is the hex view.
import { accountElement } from '../frame/account.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import {
  FONT_BYTES_MAX,
  GRID_MAX,
  SAMPLE,
  WATERFALL,
  axisStep,
  codeWords,
  containerWords,
  coverageWords,
  defaultValues,
  embeddingWords,
  faceName,
  fontFormatWords,
  fontLine,
  gridChars,
  instanceAt,
  isCollection,
  liftFace,
  nameRows,
  outlineOf,
  outlineWords,
  specimenSets,
  styleAt,
  tableWords,
  unitsWords,
  valuesOf,
  variationSettings,
  weightWords,
  type FontFace as FaceFacts,
  type FontFacts,
  type GlyphFacts,
} from '@marxy/core/src/viewer/font.ts';
import { extensionOf, magicOf, sizeWords } from '@marxy/core/src/viewer/bytes.ts';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import type { AppShell } from '../app-types.ts';
import { el, factRow } from '../frame/dom.ts';
import { kindRow, kindSection } from './kind-sections.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { fileCardElement, handOver } from './card.ts';
import { byteCard, factsCard, readingCard } from './cards.ts';
import { asItIs, bytesOf } from './exports.ts';
import type { ViewedFile } from './file.ts';
import { createHexView, type HexView } from './hex.ts';
import { nextViewerId, viewerChanged } from './signal.ts';
import { tabState, type TabState } from './tab-state.ts';
import type { PaneViewer, PartTree, PartUnit, ViewerPlace, ViewMode } from './types.ts';
import { treeParts } from '../parts/moves.ts';
import { bytesBox } from '../parts/xray-box.ts';
import { offsetLabel } from '@marxy/core/src/viewer/hex.ts';
import css from './font.css?inline';

/** A table's run of the file's bytes, from the font's own table directory; null `at` where it has none apart. */
interface TableRun {
  readonly tag: string;
  readonly at: number | null;
  readonly length: number;
}

/**
 * Face `face`'s tables as the directory records them: the offset and length of each, as `liftFace` reads a collection's.
 * A WOFF's run is the table as stored (deflated, where it is); a WOFF2 stores its tables as one Brotli stream, so the
 * shell's directory gives only their lengths.
 */
function tableRuns(b: Uint8Array, facts: FontFacts | null, face: number): TableRun[] {
  if (b.length < 12) return [];
  const u16 = (o: number): number => (b[o]! << 8) | b[o + 1]!;
  const u32 = (o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  const tag = (o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  const sig = tag(0);
  if (sig === 'wOF2') return (facts?.directory ?? []).map((t) => ({ tag: t.tag, at: null, length: t.length }));
  const out: TableRun[] = [];
  if (sig === 'wOFF') {
    for (let i = 0, n = u16(12); i < n && 44 + 20 * i + 20 <= b.length; i++) out.push({ tag: tag(44 + 20 * i), at: u32(44 + 20 * i + 4), length: u32(44 + 20 * i + 8) });
    return out;
  }
  let off = 0;
  if (sig === 'ttcf') {
    if (face >= u32(8) || 16 + 4 * face > b.length) return [];
    off = u32(12 + 4 * face);
  }
  if (off + 12 > b.length) return [];
  for (let i = 0, n = u16(off + 4); i < n && off + 28 + 16 * i <= b.length; i++) {
    const r = off + 12 + 16 * i;
    out.push({ tag: tag(r), at: u32(r + 8), length: u32(r + 12) });
  }
  return out;
}

/** What a font is, read as it opens: its bytes (for the webview) and its facts (the shell's). */
export interface FontSetup {
  readonly bytes: Uint8Array;
  readonly facts: FontFacts | null;
}

/** Why a font has no specimen, as the file card says it. */
export interface FontRefusal {
  readonly kicker: string;
  readonly line: string;
}

/** Reads the font's bytes and asks the shell for its facts; a refusal when it is too large or not a font at all. */
export async function openFontFor(shell: AppShell, file: ViewedFile): Promise<FontSetup | FontRefusal> {
  if (file.size > FONT_BYTES_MAX) {
    return { kicker: 'A font past 30 MB', line: `Fonts are drawn up to ${sizeWords(FONT_BYTES_MAX)}; this one is ${sizeWords(file.size)}. Open it in your default app to see it.` };
  }
  const [bytes, facts] = await Promise.all([bytesOf(shell, file), shell.fontFacts ? shell.fontFacts(file.path).catch(() => null) : Promise.resolve(null)]);
  const magic = magicOf(bytes)?.format ?? '';
  if (!facts && !/font/.test(magic)) return { kicker: 'Not a font the app reads', line: 'Its first bytes are not a TrueType, OpenType, WOFF or WOFF2 font, nor a collection of them.' };
  return { bytes, facts };
}

/** A face as the webview holds it: loaded under a family of the page's own, or refused, and why. */
interface Drawn {
  readonly family: string;
  face: globalThis.FontFace | null;
  state: 'loading' | 'drawn' | 'refused';
  why: string;
}

/** What the reader set in this tab: never kept past it (the fence). */
interface FontTab {
  face: number;
  values: Map<number, Record<string, number>>;
  sample: string | null;
  glyph: number | null;
}

const tabs = new WeakMap<TabState, Map<string, FontTab>>();
let families = 0;

function fontTab(state: TabState, path: string): FontTab {
  let m = tabs.get(state);
  if (!m) tabs.set(state, (m = new Map()));
  let t = m.get(path);
  if (!t) m.set(path, (t = { face: 0, values: new Map(), sample: null, glyph: null }));
  return t;
}

export interface FontOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  readonly setup: FontSetup;
  readonly paneHost: HTMLElement;
  readonly place?: ViewerPlace;
}

const n2 = (n: number): string => n.toLocaleString('en-GB');
/** The format a name says, when the shell has not read the file. */
const formatOfName = (path: string): string => ({ ttf: 'truetype', otf: 'cff', ttc: 'collection', otc: 'collection' })[extensionOf(path)] ?? extensionOf(path);

export function createFontViewer(o: FontOptions): PaneViewer {
  const { shell, file, paneHost } = o;
  const { bytes, facts } = o.setup;
  const path = file.path;
  adoptRuntimeSheet(document, 'marxy-font-style', css);
  const id = nextViewerId();
  const faces: readonly FaceFacts[] = facts?.faces ?? [];
  const count = Math.max(1, faces.length);
  const collection = isCollection(bytes);
  const tab = (): FontTab => fontTab(tabState(paneHost, path), path);
  if (tab().face >= count) tab().face = 0;
  let host: HTMLElement | null = null;
  let mode: ViewMode = 'rendered';
  let hex: HexView | null = null;
  let asCard = false;
  let closed = false;
  let scrollBack = o.place?.scroll?.top ?? null;
  const drawn = new Map<number, Drawn>();
  const glyphs = new Map<string, GlyphFacts | null | 'asking'>();
  let answered = 0;
  const names = new Map<number, string | null | 'asking'>();
  const ensureHex = (): HexView => (hex ??= createHexView(file, (offset, length) => shell.readRange(path, offset, length)));
  if (o.place?.hex) ensureHex().restore(o.place.hex);

  const faceNow = (): FaceFacts | null => faces[tab().face] ?? null;
  const valuesNow = (): Record<string, number> => {
    const t = tab();
    const f = faceNow();
    let v = t.values.get(t.face);
    if (!v) t.values.set(t.face, (v = f ? defaultValues(f) : {}));
    return v;
  };

  /** Face `i` loaded into the webview, once: a collection's face lifted out first. */
  function ensureDrawn(i: number): Drawn {
    let d = drawn.get(i);
    if (d) return d;
    d = { family: `marxy-specimen-${++families}`, face: null, state: 'loading', why: '' };
    drawn.set(i, d);
    const held = d;
    let source: Uint8Array;
    try {
      if (collection) source = liftFace(bytes, i);
      else if (i === 0) source = bytes;
      else throw new Error('the webview draws only a collection’s first face, and this one, inside a web font, cannot be lifted apart here');
    } catch (e) {
      held.state = 'refused';
      held.why = e instanceof Error ? e.message : String(e);
      return held;
    }
    const face = new FontFace(held.family, source.slice().buffer);
    held.face = face;
    face.load().then(
      () => {
        if (closed) return;
        document.fonts.add(face);
        held.state = 'drawn';
        if (tab().face === i) {
          const spec = host?.querySelector<HTMLElement>('.marxy-font-spec');
          if (spec) spec.style.visibility = '';
          else draw();
        }
        viewerChanged();
      },
      (e: unknown) => {
        if (closed) return;
        held.state = 'refused';
        held.why = e instanceof Error ? e.message : String(e);
        if (tab().face === i) draw();
        viewerChanged();
      },
    );
    return held;
  }

  const refused = (): boolean => (drawn.get(tab().face)?.state ?? 'loading') === 'refused';

  function pickGlyph(code: number | null): void {
    tab().glyph = code;
    for (const b of host?.querySelectorAll('.marxy-font-glyphs button[aria-pressed="true"]') ?? []) b.setAttribute('aria-pressed', 'false');
    if (code !== null) host?.querySelector(`.marxy-font-glyphs button[aria-label="U+${codeWords(code)}"]`)?.setAttribute('aria-pressed', 'true');
    viewerChanged();
  }

  function setValues(next: Record<string, number>): void {
    const t = tab();
    t.values.set(t.face, { ...next });
    const f = faceNow();
    if (!f || !host) return;
    const spec = host.querySelector<HTMLElement>('.marxy-font-spec');
    if (spec) spec.style.fontVariationSettings = variationSettings(f, next);
    const style = host.querySelector('.marxy-font-style');
    if (style) style.textContent = styleAt(f, next);
    for (const a of f.axes) {
      const input = host.querySelector<HTMLInputElement>(`.marxy-font-axis input[aria-label="${CSS.escape(a.name)}"]`);
      if (input && Number(input.value) !== next[a.tag]) input.value = String(next[a.tag]);
      const out = input?.closest('.marxy-font-axis')?.querySelector('.marxy-font-axis-value');
      if (out) out.textContent = n2(Math.round((next[a.tag] ?? a.default) * 10) / 10);
    }
    const on = instanceAt(f, next);
    host.querySelectorAll('.marxy-font-named .marxy-chip').forEach((chip, k) => chip.setAttribute('aria-pressed', String(f.instances[k] === on)));
    if (tab().glyph !== null) viewerChanged();
  }

  function facesRow(): HTMLElement {
    const row = el('div', 'marxy-font-faces');
    row.setAttribute('role', 'tablist');
    row.setAttribute('aria-label', 'Faces in this collection');
    row.append(el('span', 'marxy-font-label', 'Faces'));
    faces.forEach((f, i) => {
      const b = el('button', 'marxy-font-face', faceName(f, i));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === tab().face));
      b.addEventListener('click', () => {
        if (tab().face === i) return;
        tab().face = i;
        tab().glyph = null;
        draw();
        viewerChanged();
      });
      row.append(b);
    });
    return row;
  }

  function axesBox(f: FaceFacts): HTMLElement {
    const box = el('div', 'marxy-font-axes');
    const values = valuesNow();
    for (const a of f.axes.filter((x) => !x.hidden)) {
      const label = el('label', 'marxy-font-axis');
      const name = el('span', 'marxy-font-axis-name', `${a.name} `);
      name.append(el('code', '', a.tag));
      const input = el('input');
      input.type = 'range';
      input.min = String(a.min);
      input.max = String(a.max);
      input.step = String(axisStep(a));
      input.value = String(values[a.tag] ?? a.default);
      input.setAttribute('aria-label', a.name);
      input.addEventListener('input', () => setValues({ ...valuesNow(), [a.tag]: Number(input.value) }));
      label.append(name, input, el('span', 'marxy-font-axis-value', n2(values[a.tag] ?? a.default)), el('span', 'marxy-font-axis-range', `${n2(a.min)} to ${n2(a.max)}`));
      box.append(label);
    }
    if (f.instances.length > 0) {
      const named = el('div', 'marxy-font-named');
      named.append(el('span', 'marxy-font-label', 'Named'));
      const on = instanceAt(f, values);
      for (const x of f.instances) {
        const chip = el('button', 'marxy-chip', x.name);
        chip.type = 'button';
        chip.setAttribute('aria-pressed', String(x === on));
        chip.addEventListener('click', () => setValues(valuesOf(f, x)));
        named.append(chip);
      }
      box.append(named);
    }
    return box;
  }

  function specimen(f: FaceFacts | null, d: Drawn): HTMLElement {
    const spec = el('div', 'marxy-font-spec');
    spec.style.fontFamily = `"${d.family}", var(--marxy-face-chrome)`;
    spec.style.fontVariationSettings = f ? variationSettings(f, valuesNow()) : 'normal';
    // Hidden until the webview has the face: a fallback face drawn in its place would read as this font.
    if (d.state !== 'drawn') spec.style.visibility = 'hidden';
    const name = el('p', 'marxy-font-name', `${f?.names.typoFamily ?? f?.names.family ?? basename(path)} `);
    name.append(el('span', 'marxy-font-style', f ? styleAt(f, valuesNow()) : ''));
    spec.append(name);
    for (const set of specimenSets(f ? f.mapped : null)) {
      const row = el('div', 'marxy-font-row');
      row.append(el('span', 'marxy-font-label', set.label), el('p', set.label === 'Marks' ? 'marxy-font-set marxy-font-marks' : 'marxy-font-set', set.text));
      spec.append(row);
    }
    const t = tab();
    const sample = t.sample ?? f?.names.sample ?? SAMPLE;
    const sampleRow = el('div', 'marxy-font-row');
    const input = el('input', 'marxy-font-sample');
    input.type = 'text';
    input.value = sample;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Sample text: type to try your own');
    sampleRow.append(el('span', 'marxy-font-label', 'Sample'), input);
    spec.append(sampleRow);
    const water = el('div', 'marxy-font-water');
    for (const size of WATERFALL) {
      const row = el('div', 'marxy-font-wr');
      const p = el('p', 'marxy-font-wf', sample);
      p.style.fontSize = `${size}px`;
      row.append(el('span', 'marxy-font-label', String(size)), p);
      water.append(row);
    }
    // The tab is asked again: while the file lands, the first draw's tab is not yet the one it lands in.
    input.addEventListener('input', () => {
      tab().sample = input.value;
      for (const p of water.querySelectorAll('.marxy-font-wf')) p.textContent = input.value;
    });
    spec.append(water);
    if (f) {
      const chars = gridChars(f.mapped);
      const head = el('h3', 'marxy-font-gh', 'Every character it maps');
      head.append(el('span', '', `${n2(chars.length)} ${chars.length === 1 ? 'character' : 'characters'}, ${n2(f.glyphs)} ${f.glyphs === 1 ? 'glyph' : 'glyphs'}`));
      const grid = el('div', 'marxy-font-glyphs');
      for (const c of chars.slice(0, GRID_MAX)) {
        const b = el('button');
        b.type = 'button';
        b.setAttribute('aria-label', `U+${codeWords(c)}`);
        b.setAttribute('aria-pressed', String(t.glyph === c));
        b.append(el('span', 'marxy-font-g', String.fromCodePoint(c)), el('span', 'marxy-font-c', codeWords(c)));
        b.addEventListener('click', () => pickGlyph(tab().glyph === c ? null : c));
        grid.append(b);
      }
      spec.append(head, grid);
      const more = Math.max(0, chars.length - GRID_MAX) + Math.max(0, f.chars - f.mapped.length);
      if (more > 0) spec.append(el('p', 'marxy-font-note', `${n2(more)} more ${more === 1 ? 'character is' : 'characters are'} mapped; the grid draws the first ${n2(Math.min(chars.length, GRID_MAX))}.`));
    } else {
      spec.append(el('p', 'marxy-font-note', 'Its characters and tables are read by the desktop app; this build has no reader for them, so the sets above are drawn whole.'));
    }
    return spec;
  }

  const runsNow = (): TableRun[] => tableRuns(bytes, facts, tab().face);
  let tablesBox: HTMLElement | null = null;
  const tableRows = new Map<string, HTMLElement>();

  // Hidden until the cursor goes into the tables: the specimen's page looks as it did, and the tables are there to point at.
  function tablesSection(): HTMLElement {
    const runs = runsNow();
    const box = kindSection('Its tables', `${n2(runs.length)}, from the file’s own table directory`, ['table', 'at byte', 'bytes']);
    tableRows.clear();
    for (const t of runs) {
      const row = kindRow(t.tag.trim(), t.at === null ? 'inside the one compressed stream' : '', { at: t.at === null ? '' : `0x${offsetLabel(t.at, 4)}`, size: n2(t.length) });
      tableRows.set(t.tag, row);
      box.append(row);
    }
    tablesBox = box;
    return box;
  }

  const pageNow = (): HTMLElement | null => (host && mode === 'rendered' && !asCard ? host : null);

  let partsMade: { key: string; tree: PartTree } | null = null;
  /** The specimen's lines, the glyphs drawn and the tables as the cursor's parts. */
  function fontParts(): PartTree {
    const key = `${tab().face}:${refused()}`;
    if (partsMade?.key === key) return partsMade.tree;
    const f = faceNow();
    const q = (sel: string): HTMLElement | null => pageNow()?.querySelector<HTMLElement>(sel) ?? null;
    const all = (sel: string): HTMLElement[] => [...(pageNow()?.querySelectorAll<HTMLElement>(sel) ?? [])];
    const top: PartUnit[] = [];
    if (!refused()) {
      const line = (id: string, label: string, at: () => HTMLElement | null, text: (e: HTMLElement | null) => string): PartUnit => ({
        id: `specimen=${id}`,
        label: `line ${label}`,
        address: `#specimen=${id}`,
        el: at,
        stored: () => text(at()),
      });
      const sets = specimenSets(f ? f.mapped : null);
      const lines: PartUnit[] = [line('name', 'name', () => q('.marxy-font-name'), (e) => e?.textContent ?? '')];
      sets.forEach((s, k) => {
        const id = s.label.toLowerCase().replace(/\s+/g, '-');
        lines.push(line(id, s.label.toLowerCase(), () => all('.marxy-font-spec > .marxy-font-row')[k] ?? null, () => s.text));
      });
      lines.push(line('sample', 'sample', () => all('.marxy-font-spec > .marxy-font-row')[sets.length] ?? null, (e) => e?.querySelector('input')?.value ?? tab().sample ?? f?.names.sample ?? SAMPLE));
      WATERFALL.forEach((size, k) => {
        lines.push(line(`${size}px`, `${size} px`, () => all('.marxy-font-wr')[k] ?? null, (e) => e?.querySelector('.marxy-font-wf')?.textContent ?? ''));
      });
      top.push({
        id: 'specimen',
        label: 'specimen',
        address: '#specimen',
        children: lines,
        el: () => q('.marxy-font-spec'),
        stored: async () => (await Promise.all(lines.map((u) => u.stored()))).join('\n'),
      });
      const chars = f ? gridChars(f.mapped).slice(0, GRID_MAX) : [];
      if (chars.length > 0) {
        const glyphs = chars.map(
          (c): PartUnit => ({
            id: `U+${codeWords(c)}`,
            label: `glyph ${String.fromCodePoint(c)}`,
            address: `#U+${codeWords(c)}`,
            el() {
              const b = q(`.marxy-font-glyphs button[aria-label="U+${codeWords(c)}"]`);
              // The Glyph card follows the cursor, as it follows a click.
              if (b && tab().glyph !== c) pickGlyph(c);
              return b;
            },
            stored: () => String.fromCodePoint(c),
          }),
        );
        top.push({
          id: 'characters',
          label: 'characters',
          address: '#characters',
          children: glyphs,
          el: () => q('.marxy-font-glyphs'),
          stored: () => chars.map((c) => String.fromCodePoint(c)).join(''),
        });
      }
    }
    const runs = runsNow();
    if (runs.length > 0) {
      const shown = (): HTMLElement | null => (pageNow() && tablesBox?.isConnected ? tablesBox : null);
      const tables = runs.map(
        (t): PartUnit => ({
          id: `table=${t.tag}`,
          label: `table ${t.tag.trim()}`,
          address: `#table=${t.tag.trim()}`,
          at: t.at ?? undefined,
          el: () => (shown() ? (tableRows.get(t.tag) ?? null) : null),
          stored: () => `${t.tag.trim()}\t${t.at === null ? '' : `0x${offsetLabel(t.at, 4)}`}\t${n2(t.length)}`,
          xray:
            t.at === null
              ? undefined
              : () => bytesBox(`As stored · the ${t.tag.trim()} table · bytes ${n2(t.at!)}–${n2(t.at! + t.length - 1)}`, bytes.subarray(t.at!, t.at! + Math.min(t.length, 1024)), t.at!),
        }),
      );
      top.push({
        id: 'tables',
        label: 'tables',
        address: '#tables',
        at: tables[0]?.at,
        children: tables,
        el: shown,
        stored: async () => (await Promise.all(tables.map((u) => u.stored()))).join('\n'),
      });
    }
    // A glyph's el() picks it for the Glyph card; drawn() only finds its button.
    const tree: PartTree = {
      ...treeParts(top, { readOnly: true }),
      drawn: (u) => (u.id.startsWith('U+') ? q(`.marxy-font-glyphs button[aria-label="${u.id}"]`) : u.el()),
    };
    partsMade = { key, tree };
    return tree;
  }

  function specimenPage(): HTMLElement {
    const page = el('div', 'marxy-fontpage');
    page.tabIndex = -1;
    const col = el('div', 'marxy-font');
    const f = faceNow();
    const d = ensureDrawn(tab().face);
    const account = accountElement(
      [
        'Drawn from the file by the webview, as a web page draws a web font. It is never installed, and nothing in it runs.',
        'The sample text belongs to this tab and is not kept.',
      ],
      facts ? fontLine(facts, f) : fontFormatWords(formatOfName(path)),
      'marxy-font-line',
    );
    if (account) col.append(account);
    if (faces.length > 1) col.append(facesRow());
    if (d.state === 'refused') {
      col.append(el('p', 'marxy-font-note', `The webview would not draw this face: ${d.why}. Metadata lists its tables, and Source has the bytes.`), tablesSection());
      page.append(col);
      return page;
    }
    if (f && f.axes.some((a) => !a.hidden)) col.append(axesBox(f));
    col.append(specimen(f, d), tablesSection());
    const foot = el('p', 'marxy-font-foot');
    const open = el('button', 'marxy-linkish', 'Open in default app');
    open.type = 'button';
    open.addEventListener('click', () => void handOver(shell, path, 'open', host?.closest<HTMLElement>('section.marxy-pane') ?? undefined));
    foot.append(open, ' hands it to the system’s font viewer, which can install it.');
    col.append(foot);
    page.append(col);
    return page;
  }

  function cardPage(): HTMLElement {
    const page = el('div', 'marxy-fcpage');
    const side = el('div', 'marxy-fchex');
    const view = ensureHex();
    side.append(view.el);
    page.append(fileCardElement({ shell, file, back: { words: 'Back to the specimen', run: () => setCard(false) } }, () => paneHost), side);
    requestAnimationFrame(() => view.draw());
    return page;
  }

  function setCard(on: boolean): void {
    asCard = on;
    draw();
    viewerChanged();
  }

  function draw(): void {
    if (!host) return;
    const scroller = host.querySelector<HTMLElement>('.marxy-fontpage');
    const top = scrollBack ?? scroller?.scrollTop ?? 0;
    scrollBack = null;
    if (mode === 'source') {
      const view = ensureHex();
      const page = el('div', 'marxy-hexpage');
      page.append(view.el);
      host.replaceChildren(page);
      requestAnimationFrame(() => view.draw());
      return;
    }
    if (asCard) {
      host.replaceChildren(cardPage());
      return;
    }
    const page = specimenPage();
    host.replaceChildren(page);
    page.scrollTop = top;
  }

  const reading = readingCard({
    file,
    facts: () => null,
    shownAs: () => (asCard && mode === 'rendered' ? 'a file card and the bytes' : `a font · ${fontFormatWords(facts?.format ?? formatOfName(path))}`),
    tiers: () => ({
      items: [
        { name: 'A specimen', words: 'drawn by the webview from the file' },
        { name: 'Its tables only', words: 'when the webview will not draw it' },
        { name: 'The bytes', words: 'when it is not a font' },
      ],
      at: asCard ? 2 : refused() ? 1 : 0,
    }),
    caps: () => ['drawn through the webview’s font checker, as a web font is', 'never installed', 'fonts up to 30 MB'],
    other: () =>
      mode === 'rendered'
        ? asCard
          ? { words: 'Back to the specimen', run: () => setCard(false) }
          : { words: 'Show the file card and the bytes instead', run: () => setCard(true) }
        : null,
  });

  const fontCard: CardDef = {
    id: 'contents',
    title: () => 'Font',
    detail: () => {
      const f = faceNow();
      return f ? `${n2(f.glyphs)} glyphs` : '';
    },
    relevant: () => true,
    render(body) {
      const f = faceNow();
      if (!facts) {
        body.append(el('p', 'marxy-card-note', 'Its tables are read by the desktop app; this build has no reader for them.'));
        return;
      }
      body.append(factRow('format', containerWords(facts)));
      if (!f) {
        body.append(factRow('tables', tableWords(facts, null)), el('p', 'marxy-card-note', `Its faces could not be read: ${facts.why ?? 'it holds none'}.`));
        return;
      }
      body.append(factRow('outlines', outlineWords(f.outlines)), factRow('units', unitsWords(f)), factRow('weight', weightWords(f)), factRow('covers', coverageWords(f)));
      if (f.axes.length > 0) {
        const axes = el('span');
        f.axes.forEach((a, i) => {
          if (i > 0) axes.append(el('br'));
          axes.append(`${a.name} `, el('code', 'marxy-fact-code', a.tag), ` ${n2(a.min)} to ${n2(a.max)}, default ${n2(a.default)}${a.hidden ? ', hidden' : ''}`);
        });
        body.append(factRow('axes', axes));
        if (f.instances.length > 0) body.append(factRow('named', f.instances.map((x) => x.name).join(', ')));
      }
      const tables = el('code', 'marxy-fact-code', tableWords(facts, f));
      body.append(factRow('embedding', embeddingWords(f.embedding)), factRow('tables', tables));
      if (facts.directory.some((t) => t.transformed)) body.append(el('p', 'marxy-card-note', 'A starred table is stored transformed, and rebuilt as it is read.'));
      if (faces.length > 1) {
        const list = el('span');
        faces.forEach((x, i) => {
          if (i > 0) list.append(el('br'));
          list.append(`${i + 1}. ${faceName(x, i)}`);
        });
        body.append(factRow('faces', list));
      }
    },
  };

  const namesCard: CardDef = {
    id: 'frontmatter',
    title: () => 'Names',
    detail: () => 'the font’s name table',
    relevant: () => faceNow() !== null,
    render(body) {
      const f = faceNow();
      if (!f) {
        body.append(el('p', 'marxy-card-note', 'Its name table was not read.'));
        return;
      }
      for (const [k, v] of nameRows(f.names, f.vendor)) body.append(factRow(k, v));
    },
  };

  function askGlyph(face: number, code: number): GlyphFacts | null | 'asking' {
    const key = `${face}:${code}`;
    const have = glyphs.get(key);
    if (have !== undefined) return have;
    glyphs.set(key, 'asking');
    const ask = shell.fontGlyph ? shell.fontGlyph(path, face, code).catch(() => null) : Promise.resolve(null);
    void ask.then((g) => {
      glyphs.set(key, g);
      answered++;
      viewerChanged();
    });
    if (!names.has(code)) {
      names.set(code, 'asking');
      void (shell.charName ? shell.charName(code).catch(() => null) : Promise.resolve(null)).then((n) => {
        names.set(code, n);
        answered++;
        viewerChanged();
      });
    }
    return 'asking';
  }

  const glyphCard: CardDef = {
    id: 'selection',
    title: () => 'Glyph',
    detail: () => {
      const c = tab().glyph;
      return c === null ? '' : `U+${codeWords(c)}`;
    },
    relevant: () => tab().glyph !== null,
    render(body) {
      const c = tab().glyph;
      const f = faceNow();
      if (c === null) return;
      const big = el('div', 'marxy-font-big', String.fromCodePoint(c));
      const d = drawn.get(tab().face);
      if (d) big.style.fontFamily = `"${d.family}"`;
      if (f) big.style.fontVariationSettings = variationSettings(f, valuesNow());
      body.append(big);
      const g = askGlyph(tab().face, c);
      const n = names.get(c);
      body.append(factRow('character', n === 'asking' ? 'reading…' : (n ?? '—')));
      if (g === 'asking') {
        body.append(el('p', 'marxy-card-note', 'Reading it…'));
        return;
      }
      if (!g) {
        body.append(el('p', 'marxy-card-note', shell.fontGlyph && facts ? 'The font maps no glyph to it.' : 'Its glyph is read by the desktop app; this build has no reader for it.'));
        return;
      }
      body.append(factRow('glyph', `number ${n2(g.glyph)} · ${g.name ? `named ${g.name}` : 'no names in the file'}`));
      if (g.advance !== null) body.append(factRow('advance', `${g.advance} of ${f?.unitsPerEm ?? 0} units${f && f.axes.length > 0 ? ', at the default axes' : ''}`));
      body.append(factRow('outline', outlineOf(g, f?.outlines ?? '')));
      if (g.bbox) body.append(factRow('box', g.bbox.join(', ')));
    },
  };

  const facts_ = factsCard(file);
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });

  return {
    path,
    kind: 'font',
    group: 'font',
    binary: true,
    owns: () => true,
    show(m, into) {
      mode = m;
      host = into;
      into.setAttribute('data-marxy-viewer', 'font');
      draw();
    },
    hide() {
      host = null;
    },
    cards: () => ({ reading, contents: fontCard, frontmatter: namesCard, facts: facts_ }),
    passing: (m) => (m === 'source' || asCard ? [byte] : tab().glyph !== null ? [glyphCard] : []),
    headSay() {
      if (file.guessed) return { text: 'font · guessed', tone: 'guess', title: 'Read from its first bytes: its name does not say what it is · Metadata says why' };
      if (mode === 'rendered' && !asCard && refused()) return { text: 'Tables only · the webview will not draw it', tone: 'tier', title: 'The webview’s font checker refused it · Metadata says what else' };
      return null;
    },
    key(e, m) {
      if (m === 'source' || asCard) return hex?.key(e) ?? false;
      // Escape lets the glyph go and is not taken, so the cursor lets go with it.
      if (e.key === 'Escape' && tab().glyph !== null) pickGlyph(null);
      return false;
    },
    parts: (m) => (m === 'source' || asCard ? ensureHex().parts() : fontParts()),
    floor: { on: () => asCard, set: (on) => setCard(on) },
    panelKey: () => {
      const t = tab();
      return `${id}:${mode}:${asCard}:${t.face}:${t.glyph ?? ''}:${JSON.stringify(t.values.get(t.face) ?? {})}:${drawn.get(t.face)?.state ?? ''}:${hex?.selected() ?? ''}:${answered}`;
    },
    place() {
      const page = mode === 'rendered' && !asCard ? host?.querySelector<HTMLElement>('.marxy-fontpage') : null;
      return { hex: hex?.place(), scroll: page ? { top: page.scrollTop, left: 0 } : undefined };
    },
    land(at) {
      ensureHex().restore({ selected: at, top: null });
      return mode === 'rendered' && asCard ? 'rendered' : 'source';
    },
    exports: () => [asItIs(shell, file, 'file')],
    destroy() {
      closed = true;
      for (const d of drawn.values()) if (d.face) document.fonts.delete(d.face);
      drawn.clear();
      hex?.destroy();
      hex = null;
      host = null;
    },
  };
}
