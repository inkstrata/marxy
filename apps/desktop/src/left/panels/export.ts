// Export (the seventh panel): what leaves the reader. What (this file, the part the cursor is on, the files
// ticked in Places, the tray), as what (a web page, a PDF through the system's print, the file as written, plain text,
// JSON Lines for a table; one page, one Markdown file or a bundle of the ticked files; the tray as Markdown or a brief),
// then only the options of the form chosen. Saved through the system's save dialog to where the reader chooses; nothing
// here changes a file, and nothing is sent anywhere.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { isMarkdownPath } from '@marxy/core/src/kind/registry.ts';
import { delimiterFor, deriveTable } from '@marxy/core/src/data/delimited.ts';
import type { TabSet } from '@marxy/core/src/layout/frame-storage.ts';
import type { AppHandle } from '../../app-types.ts';
import { changesOf } from '../../changes/patch.ts';
import { appHandle } from '../../commands/app-handle.ts';
import { writeCopy } from '../../commands/copy-write.ts';
import { partRange } from '../../commands/cursor.ts';
import type { Command } from '../../commands/registry.ts';
import type { DocumentStore } from '../../document/store.ts';
import { PAPER, htmlDocument } from '../../export/build.ts';
import { bundleBase, bundleEntries, briefOf, chosenAs, defaultWhat, exportName, formsFor, isTextual, joinedMarkdown, jsonLines, leftOut, linesBytes, MANIFEST, manifestOf, notesMarkdown, pointedPaths, relativeTo, stemOf, type BundleFile, type BundleOptions, type ExportAs, type ExportForm, type ExportWhat, type FileKind } from '../../export/model.ts';
import { lookColours, partHtml, partText, printPane, type Folds } from '../../export/page.ts';
import { fileHtml } from '../../render/export-file.ts';
import { saveExport } from '../../export/write.ts';
import { zipStore, ZipTooLarge, type ZipEntry } from '../../export/zip.ts';
import { notify } from '../../notices/index.ts';
import { linesOf } from '../../notes/anchor.ts';
import { notesFor, onNotes } from '../../notes/store.ts';
import { buildAppContext } from '../../selection/bind.ts';
import { lineStarts } from '../../line/refs.ts';
import { lineSpan, partLabel } from '../../selection/cursor.ts';
import { piecesAsMarkdown } from '../../tray/markdown.ts';
import { onTray, trayPieces } from '../../tray/tray.ts';
import { onChangesSummary } from '../../changes/state.ts';
import type { PanelContext, PanelDef, Verb } from '../types.ts';
import { btns, ck, empty, h, hint, rd, row, sec, sg, tog } from '../ui.ts';

export interface ExportState {
  what: ExportWhat | null;
  readonly as: Partial<Record<ExportWhat, ExportAs>>;
  readonly opt: BundleOptions;
  look: 'worn' | 'plain';
  folds: Folds;
  notes: boolean;
  paper: 'A4' | 'Letter';
  /** What the last build made, for the reader's notice and the tests: its name, its bytes and where it went. */
  last: { readonly name: string; readonly bytes: Uint8Array; readonly text: string | null; readonly path: string | null; readonly entries: readonly string[] } | null;
  /** An export is running: its button says so and pressing it again does nothing until it is done. */
  busy?: boolean;
  wired?: boolean;
  selKey?: string;
}

type Ctx = PanelContext<ExportState>;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const kb = (n: number): string => (n < 1024 ? plural(n, 'byte', 'bytes') : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const enc = new TextEncoder();

interface Part {
  readonly start: number;
  readonly end: number;
  readonly first: number;
  readonly last: number;
  readonly short: string;
  readonly label: string;
}

interface Job {
  readonly what: ExportWhat | null;
  readonly path: string | null;
  readonly store: DocumentStore | null;
  readonly kind: FileKind | null;
  readonly part: Part | null;
  readonly ticked: readonly string[];
  readonly tray: number;
  readonly can: Readonly<Record<ExportWhat, boolean>>;
  readonly forms: readonly ExportForm[];
  readonly as: ExportAs | null;
  readonly base: string;
  readonly name: string;
}

function kindOf(ctx: Ctx, path: string): FileKind {
  const pane = ctx.pane();
  const viewer = pane?.content.viewer();
  // A viewer's page (an image, a PDF, bytes alone) is not text the page sets: only its bytes go.
  if (pane && viewer?.owns(pane.view.mode)) return { text: false, markdown: false, table: false };
  return { text: true, markdown: isMarkdownPath(path), table: delimiterFor(path) !== null };
}

/** The part the page's cursor is on in the pane in front, with its lines; null when there is none. */
function partOf(ctx: Ctx, store: DocumentStore | null): Part | null {
  const { handle } = ctx;
  const pane = ctx.pane();
  if (!store || !pane || !handle.selection.cursorReady() || handle.selection.article() !== pane.view.host.article) return null;
  const sel = handle.selection.state().selection;
  const r = partRange(sel);
  if (!r) return null;
  const span = lineSpan(store.snapshot().buffer.bytes, r.start, r.end);
  const lines = span.last > span.first ? `lines ${span.first} to ${span.last}` : `line ${span.first}`;
  const name = partLabel(sel)?.replace(/^§\s*/, '');
  return { start: r.start, end: r.end, first: span.first, last: span.last, short: lines, label: name ? `${name}, ${lines}` : lines };
}

function tickedOf(handle: AppHandle): string[] {
  const places = handle.frame().left.stateOf('places') as { readonly sel?: ReadonlySet<string> } | undefined;
  if (!places?.sel?.size) return [];
  const known = new Set(handle.index.entries().map((e) => e.path));
  for (const p of handle.panes().panes) if (p.path()) known.add(p.path()!);
  return [...places.sel].filter((p) => known.has(p));
}

const trayShown = (): boolean => document.querySelector('.marxy-apppage[aria-label="Tray"]') !== null;

function job(ctx: Ctx): Job {
  const st = ctx.st;
  const doc = ctx.doc();
  // A file a viewer shows as bytes has no store: its path is the pane's.
  const shown = doc?.path ?? ctx.pane()?.path() ?? null;
  const path = shown !== null && !shown.startsWith('marxy:') ? shown : null;
  const store = doc?.store ?? null;
  const kind = path ? kindOf(ctx, path) : null;
  const part = kind?.text ? partOf(ctx, store) : null;
  const ticked = tickedOf(ctx.handle);
  const tray = trayPieces().length;
  const can = { file: path !== null, selection: part !== null, ticked: ticked.length > 0, tray: tray > 0 };
  const what = st.what && can[st.what] ? st.what : defaultWhat(can, trayShown(), ticked.length);
  const forms = what ? formsFor(what, kind) : [];
  const as = what ? chosenAs(what, forms, st.as[what]) : null;
  const fileName = path ? basename(path) : '';
  const sets = (ctx.handle.frame().store.state.sets ?? []) as readonly TabSet[];
  const base = what === 'ticked' ? bundleBase(ticked, sets) : what === 'tray' ? 'tray' : what === 'selection' && part ? `${stemOf(fileName)}-lines-${part.first}-${part.last}` : stemOf(fileName) || 'export';
  const name = as && what ? exportName(as, what, base, fileName) : base;
  return { what, path, store, kind, part, ticked, tray, can, forms, as, base, name };
}

function subjectOf(J: Job): string {
  switch (J.what) {
    case 'file':
      return J.path ? basename(J.path) : '';
    case 'selection':
      return J.part?.short ?? '';
    case 'ticked':
      return `${plural(J.ticked.length, 'file', 'files')} ticked in Places`;
    case 'tray':
      return `${plural(J.tray, 'piece', 'pieces')} in the tray`;
    default:
      return '';
  }
}

// ---- what a build reads ------------------------------------------------------------------------------------------

const storeOf = (handle: AppHandle, path: string): DocumentStore | null => {
  for (const p of handle.panes().panes) {
    const s = p.content.store();
    if (s && s.snapshot().path === path) return s;
  }
  return null;
};

/** What is on disk for `path`: an open store's disk copy, else the file read now. */
async function diskOf(handle: AppHandle, path: string): Promise<Uint8Array> {
  const store = storeOf(handle, path);
  const snap = store?.snapshot();
  if (snap) return snap.disk ?? snap.buffer.bytes;
  return (handle.shell.peekFile ?? handle.shell.readFile).call(handle.shell, path);
}

const sizeOf = (handle: AppHandle, path: string): number => {
  const s = storeOf(handle, path)?.snapshot();
  if (s) return (s.disk ?? s.buffer.bytes).length;
  return handle.index.entries().find((e) => e.path === path)?.size ?? 0;
};

async function bundleFiles(handle: AppHandle, paths: readonly string[]): Promise<BundleFile[]> {
  const root = commonRoot(paths);
  const out: BundleFile[] = [];
  for (const path of paths) {
    const disk = await diskOf(handle, path);
    const snap = storeOf(handle, path)?.snapshot();
    const dirty = snap?.dirty === true;
    const notes = notesFor(path);
    const text = new TextDecoder().decode(snap?.buffer.bytes ?? disk);
    out.push({
      zip: relativeTo(root, path),
      name: basename(path),
      disk,
      dirty,
      patch: dirty && snap ? (changesOf(path, snap.disk, snap.buffer.bytes)?.patch ?? null) : null,
      notes: notes.length ? notesMarkdown(path, linesOf(text), notes) : null,
      noteCount: notes.length,
    });
  }
  return out;
}

/** The folder above the files' common folder: every path in the zip starts with that folder's name ("plans/a.md"). */
function commonRoot(paths: readonly string[]): string | null {
  const dirs = paths.map((p) => p.slice(0, p.lastIndexOf('/')).split('/'));
  const common: string[] = [];
  for (let i = 0; dirs.length > 0 && dirs.every((d) => d[i] !== undefined && d[i] === dirs[0]![i]); i++) common.push(dirs[0]![i]!);
  return common.length > 0 ? common.slice(0, -1).join('/') : null;
}

/** The files the ticked Markdown files point to that exist and are not ticked themselves. */
async function pointedFrom(handle: AppHandle, files: readonly BundleFile[], paths: readonly string[], root: string | null): Promise<ZipEntry[]> {
  const known = new Set(handle.index.entries().map((e) => e.path));
  const have = new Set(paths);
  const out = new Map<string, ZipEntry>();
  for (const [i, f] of files.entries()) {
    const path = paths[i]!;
    if (!isMarkdownPath(path)) continue;
    const dir = path.slice(0, path.lastIndexOf('/'));
    for (const rel of pointedPaths(new TextDecoder().decode(f.disk))) {
      const target = normalise(rel.startsWith('/') ? rel : `${dir}/${rel}`);
      if (have.has(target) || out.has(target) || !known.has(target)) continue;
      try {
        out.set(target, { path: relativeTo(root, target), bytes: await diskOf(handle, target) });
      } catch {
        // A file the index named and the disk no longer has is left out, as one never pointed to.
      }
    }
  }
  return [...out.values()];
}

function normalise(path: string): string {
  const parts: string[] = [];
  for (const p of path.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.' && (p !== '' || parts.length === 0)) parts.push(p);
  }
  // A UNC path keeps its two slashes: `//server/share`, not `/server/share`.
  return path.startsWith('//') ? `/${parts.join('/')}` : parts.join('/');
}

/** The page of one file: its pane's article when it is open and shown, else its bytes read as Markdown or as lines. */
async function pageHtmlOf(handle: AppHandle, path: string, st: ExportState): Promise<string> {
  const pane = handle.panes().panes.find((p) => p.path() === path && !p.content.viewer()?.owns(p.view.mode));
  if (pane) {
    await handle.contentComplete();
    return partHtml(pane.view.host.article, { range: null, folds: st.folds, notes: st.notes ? notesFor(path) : null, lineOf: lineOfIn(pane.content.store()?.snapshot().buffer.bytes ?? new Uint8Array()) });
  }
  return fileHtml(await diskOf(handle, path), isMarkdownPath(path));
}

function lineOfIn(bytes: Uint8Array): (byte: number) => number {
  const starts = lineStarts(bytes);
  return (byte) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= byte) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

interface Built {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly text: string | null;
  readonly entries: readonly string[];
}

async function build(ctx: Ctx, J: Job, peek: boolean): Promise<Built | string | null> {
  const { handle, st } = ctx;
  const pane = ctx.pane();
  const article = pane?.view.host.article ?? null;
  const colours = st.look === 'worn' && article ? lookColours(article) : PAPER;
  if (J.as === 'zip') {
    const files = await bundleFiles(handle, J.ticked);
    const root = commonRoot(J.ticked);
    const pointed = await pointedFrom(handle, files, J.ticked, root);
    const pages: ZipEntry[] = [];
    if (st.opt.pages) for (const p of J.ticked) pages.push({ path: `pages/${stemOf(basename(p))}.html`, bytes: enc.encode(htmlDocument({ title: basename(p), html: await pageHtmlOf(handle, p, { ...st, folds: 'open', notes: false }), colours: article ? lookColours(article) : PAPER })) });
    const ents = bundleEntries(files, st.opt, { pointed, pages });
    const man = await manifestOf(J.name, ents, leftOut(files, st.opt, pointed.length), st.opt.manifest, peek);
    if (peek) return man;
    const all = st.opt.manifest ? [...ents, { path: MANIFEST, bytes: enc.encode(man) }] : ents;
    return { name: J.name, bytes: zipStore(all), text: man, entries: all.map((e) => e.path) };
  }
  const store = J.store;
  const snap = store?.snapshot();
  let text: string | null = null;
  let bytes: Uint8Array | null = null;
  const range = J.what === 'selection' && J.part ? { start: J.part.start, end: J.part.end } : null;
  if (J.as === 'html') {
    if (!article || !snap) return null;
    await handle.contentComplete();
    const html = partHtml(article, { range, folds: st.folds, notes: st.notes ? notesFor(J.path!) : null, lineOf: lineOfIn(snap.buffer.bytes) });
    text = htmlDocument({ title: stemOf(J.name), html, colours });
  } else if (J.as === 'html1') {
    const parts: string[] = [];
    for (const p of J.ticked) parts.push(`<section><p><small>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</small></p>\n${await pageHtmlOf(handle, p, st)}</section>`);
    text = htmlDocument({ title: J.base, html: parts.join('\n'), colours });
  } else if (J.as === 'raw') {
    if (!snap) {
      if (!J.path) return null;
      bytes = await (handle.shell.peekFile ?? handle.shell.readFile).call(handle.shell, J.path);
    } else bytes = J.part && J.what === 'selection' ? linesBytes(snap.buffer.bytes, J.part.first, J.part.last).slice() : snap.buffer.bytes;
  } else if (J.as === 'text') {
    if (!article) return null;
    await handle.contentComplete();
    text = partText(article, range);
  } else if (J.as === 'jsonl') {
    if (!snap || !J.path) return null;
    const table = deriveTable(snap.buffer.bytes, J.path);
    text = jsonLines(table.children.filter((r) => r.type === 'row').map((r) => (r.type === 'row' ? r.children.map((c) => c.value) : [])));
  } else if (J.as === 'md1') {
    const files: { path: string; text: string }[] = [];
    for (const p of J.ticked) files.push({ path: p, text: new TextDecoder().decode(storeOf(handle, p)?.snapshot().buffer.bytes ?? (await diskOf(handle, p))) });
    text = joinedMarkdown(files);
  } else if (J.as === 'trmd') text = piecesAsMarkdown(trayPieces());
  else if (J.as === 'brief') text = briefOf(piecesAsMarkdown(trayPieces()), trayPieces().length);
  if (bytes === null) bytes = enc.encode(text ?? '');
  if (text === null) {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = null;
    }
  }
  return { name: J.name, bytes, text, entries: [J.name] };
}

async function run(ctx: Ctx, how: 'save' | 'peek' | 'copy'): Promise<void> {
  if (ctx.st.busy) return;
  ctx.st.busy = true;
  ctx.redraw();
  try {
    await runJob(ctx, how);
  } finally {
    ctx.st.busy = false;
    ctx.redraw();
  }
}

async function runJob(ctx: Ctx, how: 'save' | 'peek' | 'copy'): Promise<void> {
  const J = job(ctx);
  const { handle, st } = ctx;
  if (!J.as || !J.what) return;
  if (J.as === 'pdf') {
    const pane = ctx.pane();
    if (!pane) return;
    await handle.contentComplete();
    notify({ kind: 'info', text: 'The page is with the system’s print · choose Save as PDF there · nothing is sent anywhere', fades: true });
    printPane({ host: pane.host, article: pane.view.host.article }, { colours: st.look === 'worn' ? 'look' : 'paper', paper: st.paper, folds: st.folds, notes: st.notes, range: J.what === 'selection' && J.part ? { start: J.part.start, end: J.part.end } : null });
    return;
  }
  let out: Built | string | null;
  try {
    out = await build(ctx, J, how === 'peek');
  } catch (e) {
    notify(e instanceof ZipTooLarge ? { kind: 'refused', text: `${J.name} is not built · ${e.message} · nothing was written` } : { kind: 'error', text: `Could not build ${J.name} · ${e instanceof Error ? e.message : String(e)} · nothing was written` });
    return;
  }
  if (out === null) return;
  if (typeof out === 'string') {
    // A peek: the manifest beside, as a scratch page; nothing is built or written.
    const here = handle.panes().focused;
    await handle.panes().openScratch(enc.encode(out), { label: `${J.name}, the manifest (a peek)`, beside: true, onLanded: () => handle.panes().focus(here) });
    notify({ kind: 'info', text: 'The manifest, before anything is built · nothing is written', fades: true });
    return;
  }
  if (how === 'copy') {
    if (out.text === null) return;
    st.last = { ...out, path: null };
    await writeCopy(buildAppContext(handle), { text: out.text }, `Copied ${stemOf(out.name)}: ${kb(out.bytes.length)} of text · nothing is sent anywhere`);
    return;
  }
  const path = await saveExport(handle, out.name, out.bytes, J.what === 'ticked' ? (J.ticked[0] ?? null) : J.path);
  if (path) st.last = { ...out, path };
}

// ---- the panel ---------------------------------------------------------------------------------------------------

function wire(ctx: Ctx): void {
  if (ctx.st.wired) return;
  ctx.st.wired = true;
  const again = (): void => ctx.redraw();
  onTray(again);
  onNotes(again);
  onChangesSummary(again);
  ctx.handle.selection.onChange(() => {
    // The cursor moved: draw again only when the part Export names is no longer the one on the page.
    const part = partOf(ctx, ctx.doc()?.store ?? null);
    const key = part ? `${part.start}-${part.end}` : '';
    if (key !== ctx.st.selKey) ctx.redraw();
  });
}

const bold = (text: string, on: boolean): Node => (on ? h('b', '', text) : document.createTextNode(text));

function render(ctx: Ctx, body: HTMLElement): void {
  wire(ctx);
  const { st, handle } = ctx;
  const J = job(ctx);
  st.selKey = J.part ? `${J.part.start}-${J.part.end}` : '';
  if (!J.what) {
    body.append(empty(handle.panes().focused.path() === null && !trayShown() ? 'Nothing is open. Open a file, or tick files in Places, to export them.' : 'Export works on a file, the files ticked in Places, or the tray. This page is none of them.'));
    return;
  }
  const pick = (id: ExportWhat) => (): void => {
    st.what = id;
    ctx.redraw();
  };
  const what = (id: ExportWhat, label: string, pv: string): HTMLElement => {
    const ok = J.can[id];
    return row({ k: `w:${id}`, pre: rd(J.what === id), nm: bold(label, J.what === id), pv, cls: ok ? '' : 'dim', what: label, go: 'choose', ...(ok ? { run: pick(id), tick: pick(id) } : {}) });
  };
  body.append(
    sec('What', 'never changes a file'),
    what('file', 'This file', J.path ? basename(J.path) : 'no file here'),
    what('selection', 'The selection', J.part?.label ?? 'nothing selected'),
    what('ticked', 'The files ticked in Places', J.ticked.length ? `${J.ticked.length} · ${kb(J.ticked.reduce((n, p) => n + sizeOf(handle, p), 0))}` : 'none ticked'),
    what('tray', 'The tray', J.tray ? plural(J.tray, 'piece', 'pieces') : 'empty'),
  );

  const form = J.forms.find((f) => f.id === J.as);
  const textual = J.as ? isTextual(J.as, J.kind) : false;
  const primary = st.busy ? (J.as === 'zip' ? 'Building…' : 'Saving…') : J.as === 'zip' ? `Build ${J.name}` : (form?.act ?? `Save ${J.name}…`);
  const go = (): void => void run(ctx, 'save');
  const peek = (): void => void run(ctx, 'peek');
  const copy = (): void => void run(ctx, 'copy');
  const pickAs = (id: ExportAs) => (): void => {
    if (J.what) st.as[J.what] = id;
    ctx.redraw();
  };
  body.append(sec('As', ''));
  for (const f of J.forms) {
    const on = f.id === J.as;
    const act = J.as === 'zip' ? 'build it' : J.as === 'pdf' ? 'print it' : 'save it';
    body.append(
      row({
        k: `a:${f.id}`,
        pre: rd(on),
        nm: bold(f.label, on),
        ...(f.pv.length > 22 ? { as: f.pv } : { pv: f.pv }),
        what: f.label,
        go: 'choose',
        run: pickAs(f.id),
        tick: pickAs(f.id),
        verbs: (): (Verb | null)[] => (on ? [['Enter', act, go], J.as === 'zip' ? ['p', 'peek the manifest', peek] : null, textual ? ['c', 'copy instead', copy] : null, ['o', 'choose', pickAs(f.id)]] : [['o', 'choose', pickAs(f.id)]]),
      }),
    );
  }

  if (J.as === 'zip') {
    const o = st.opt;
    const flip = (key: keyof BundleOptions) => (): void => {
      o[key] = !o[key];
      ctx.redraw();
    };
    const box = (key: keyof BundleOptions, label: string, extra: { n?: number; as?: string }): HTMLElement => row({ k: `b:${key}`, pre: ck(o[key]), nm: label, what: label, ...extra, run: flip(key), tick: flip(key), go: o[key] ? 'leave out' : 'put in' });
    const notes = J.ticked.reduce((n, p) => n + notesFor(p).length, 0);
    const dirty = J.ticked.filter((p) => storeOf(handle, p)?.snapshot().dirty === true).length;
    const size = J.ticked.reduce((n, p) => n + sizeOf(handle, p), 0);
    body.append(
      sec('In the bundle', `${kb(size)} before packing`),
      row({ k: 'b:files', pre: ck(true), nm: 'The files, byte for byte', n: J.ticked.length, go: 'always in', run: () => notify({ kind: 'info', text: 'The files themselves are always in the bundle, as they are on disk', fades: true }) }),
      box('manifest', 'A manifest', { as: 'paths, sizes, checksums' }),
      box('notes', 'Your notes on them', { n: notes }),
      box('patches', 'Unsaved changes, as patches', { n: dirty }),
      box('pointed', 'The files they point to', {}),
      box('pages', 'A web page of each', { as: 'in the look worn' }),
      btns({ label: primary, pri: true, run: go }, { label: 'Peek the manifest', run: peek }),
    );
  } else if (J.as === 'html' || J.as === 'pdf' || J.as === 'html1') {
    const seg = (key: 'look' | 'paper' | 'folds', items: readonly (readonly [string, string])[], label: string): HTMLElement => {
      const set = (v: string): void => {
        (st as unknown as Record<string, string>)[key] = v;
        ctx.redraw();
      };
      const ids = items.map((x) => x[0]);
      return row({ k: `s:${key}`, nm: label, post: sg(items, st[key], set, label), go: 'next', run: () => set(ids[(ids.indexOf(st[key]) + 1) % ids.length]!) });
    };
    const flipNotes = (): void => {
      st.notes = !st.notes;
      ctx.redraw();
    };
    body.append(sec('Set as', ''), seg('look', [['worn', 'The look worn'], ['plain', 'Plain']], 'Look'));
    if (J.as === 'pdf') body.append(seg('paper', [['A4', 'A4'], ['Letter', 'Letter']], 'Paper'));
    body.append(
      seg('folds', [['shown', 'as shown'], ['open', 'open']], 'Folded sections'),
      row({ k: 's:notes', nm: 'Your notes in the margin', post: tog(st.notes, flipNotes, 'Your notes in the margin'), run: flipNotes, tick: flipNotes, go: st.notes ? 'leave them out' : 'put them in' }),
      btns({ label: primary, pri: true, run: go }),
    );
  } else if (J.as) body.append(btns({ label: primary, pri: true, run: go }, textual ? { label: 'Copy instead', run: copy } : null));
  body.append(hint(J.as === 'pdf' ? 'Goes to the system’s print, where Save as PDF makes the file. Nothing is sent anywhere.' : 'Saved where you choose. Nothing is sent anywhere.'));
}

const panel: PanelDef<ExportState> = {
  id: 'export',
  name: 'Export',
  rest: 'What, as what, then its options. Nothing here changes a file.',
  init: () => ({ what: null, as: {}, opt: { manifest: true, notes: true, patches: false, pointed: false, pages: false }, look: 'worn', folds: 'shown', notes: false, paper: 'A4', last: null }),
  take(ctx, arg) {
    const a = arg as { readonly what?: ExportWhat; readonly as?: ExportAs } | null;
    if (a?.what) ctx.st.what = a.what;
    if (a?.what && a.as) ctx.st.as[a.what] = a.as;
  },
  subject: (ctx) => subjectOf(job(ctx)),
  render,
  commands(): readonly Command[] {
    return [
      {
        id: 'export.bundle',
        title: 'Export: build a bundle of the ticked files',
        group: 'document',
        when: () => true,
        async run() {
          const handle = appHandle();
          if (!handle) return;
          if (tickedOf(handle).length === 0) {
            notify({ kind: 'info', text: 'Nothing is ticked in Places · Space ticks a file there', fades: true });
            return;
          }
          handle.frame().left.show('export', { what: 'ticked', as: 'zip' });
        },
      },
    ];
  },
};

export default panel;
