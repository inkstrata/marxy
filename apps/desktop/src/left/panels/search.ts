// Search (the fifth panel): Find and Replace as one box, Aa · .* · word, and where: this file, its folder, or
// every place. Matches are grouped by file, the matched words marked; J K walk them and the page follows. Ticks choose
// which files a replace may touch. Staging puts each file's replace in its own store, one undo step per file, written
// only by Save (left/held.ts keeps a file no pane shows). Files are read as they are now: an open file from its store,
// the rest from disk, narrowed first by the shell's content search where the text is plain.
import { searchSkipReason, fileTypeFor } from '@marxy/core/src/kind/registry.ts';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../../app-types.ts';
import { changesOf } from '../../changes/patch.ts';
import { beginSaveQuery, collectionOf, saveQuery } from '../../collection/load.ts';
import { isUntitled } from '../../document/untitled.ts';
import type { DocumentStore } from '../../document/store.ts';
import { activeFind } from '../../find/view.ts';
import { chordText } from '../../frame/branch-info.ts';
import { runCommand } from '../../frame/branches/run.ts';
import { plural } from '../../frame/dom.ts';
import { anchorBelow, openMenu, type MenuItem } from '../../frame/menu.ts';
import { notify } from '../../notices/index.ts';
import { collect, collectMany } from '../../tray/tray.ts';
import { heldStores, onHeld, settle, storeToStage } from '../held.ts';
import {
  byteAt,
  compileSearch,
  filesHolding,
  literalOf,
  matchLines,
  minimalSplice,
  optWords,
  patchRows,
  replaceAll,
  replaceOne,
  savedName,
  savedOf,
  snippet,
  splitLines,
  swap,
  leftAloneWhy,
  tickedByDefault,
  wordPair,
  type LineHit,
  type SavedSearch,
  type ScopeId,
} from '../search-model.ts';
import type { SearchDone, SearchJob } from '../search.worker.ts';
import type { PanelContext, PanelDef, RowEvent, Verb } from '../types.ts';
import { btns, ck, empty, fld, h, hint, hit, lab, row, sec, sg, stack, tool } from '../ui.ts';

interface Group {
  readonly path: string;
  readonly hits: readonly LineHit[];
  readonly lines: readonly string[];
  /** Each line's first character in the text searched. */
  readonly starts: readonly number[];
  readonly text: string;
}

interface Result {
  readonly short?: boolean;
  readonly bad?: string;
  /** The pattern did not finish in time: no matches are shown, and a replace is refused. */
  readonly slow?: boolean;
  readonly re?: RegExp;
  /** The .* it was worked out with: a replace reads $1 by it, not by the toggle now. */
  readonly regex?: boolean;
  /** The query and scope it answers (`SearchState.qkey`): Stage and r refuse a result for another. */
  readonly qkey?: string;
  readonly groups: readonly Group[];
  readonly total: number;
  /** What was not read, said under the count. */
  readonly note: string;
}

interface Scope {
  readonly id: ScopeId;
  readonly name: string;
  /** Which file, folder or roots: two README.md files share a name. */
  readonly where: string;
  readonly paths: readonly string[];
}

export interface SearchState {
  q: string;
  r: string;
  case: boolean;
  regex: boolean;
  word: boolean;
  scope: ScopeId;
  /** A folder named from elsewhere (a place's "find in this place"); null: the open file's folder. */
  dir: string | null;
  readonly tick: Map<string, boolean>;
  readonly shut: Set<string>;
  readonly more: Set<string>;
  /** How many files the list draws: a common word in a large place finds thousands, and each is rows. */
  files: number;
  peek: boolean;
  res: Result | null;
  /** What `res` was worked out for; '' makes the next draw work it out again. */
  key: string;
  qkey: string;
  run: number;
  pending: boolean;
  /** Ends the regular-expression worker a search is waiting on. */
  stop?: () => void;
  /** The open file when the search last changed: its group stays first while J opens the others. */
  first: string | null;
  offHeld?: () => void;
  /** Counts the index's changes: a file changed on disk changes its entry, not their number. */
  indexRev: number;
  offIndex?: () => void;
}

/** Files read past this many are left out, and said: a regular expression cannot be narrowed by the shell. */
const READ_CAP = 2000;
const MAX_BYTES = 4 * 1024 * 1024;
/** Files drawn at first, and added by each "more files" row: every redraw rebuilds the list, so it stays short. */
const FILE_STEP = 100;
/** A pause before a search reads, so each key typed does not start its own pass over every file. */
const SETTLE_MS = 120;
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

const storeAt = (handle: AppHandle, path: string): DocumentStore | null => handle.panes().stores.held(path);
const textOf = (store: DocumentStore): string => decoder.decode(store.snapshot().buffer.bytes);
const inDot = (path: string, root: string): boolean => path.slice(root.length).split('/').slice(0, -1).some((s) => s.startsWith('.'));
const searchable = (path: string, kind: string): boolean => kind !== 'binary' && searchSkipReason(fileTypeFor(path)) === null;

function scopeOf(ctx: PanelContext<SearchState>): Scope {
  const { handle, st } = ctx;
  const here = ctx.pane()?.path() ?? null;
  const entries = handle.index.entries();
  if (st.scope === 'file' && here !== null) return { id: 'file', name: basename(here), where: here, paths: [here] };
  const dir = st.scope === 'dir' ? (st.dir ?? (here !== null && !isUntitled(here) ? dirname(here) : null)) : null;
  const open = handle.panes().panes.map((p) => p.path()).filter((p): p is string => p !== null && !p.startsWith('marxy:'));
  if (dir !== null) {
    const under = (p: string): boolean => p.startsWith(`${dir.replace(/\/$/, '')}/`);
    const paths = entries.filter((e) => under(e.path) && !inDot(e.path, dir) && searchable(e.path, e.kind)).map((e) => e.path);
    for (const p of open) if (under(p) && !paths.includes(p) && (isUntitled(p) || searchable(p, 'text'))) paths.push(p);
    return { id: 'dir', name: `${basename(dir)}/`, where: dir, paths };
  }
  const roots = handle.index.roots();
  const paths = entries.filter((e) => !inDot(e.path, e.root) && searchable(e.path, e.kind)).map((e) => e.path);
  for (const p of open) if (!paths.includes(p) && (isUntitled(p) || searchable(p, 'text'))) paths.push(p);
  return { id: 'ws', name: roots.length === 1 ? basename(roots[0]!) : 'every place', where: roots.join('\u0002'), paths };
}

/** Changes whenever a text the search reads may have: any open or held store's bytes (a reload too), the index. */
function textsKey(handle: AppHandle, st: SearchState): string {
  const stores = new Set<DocumentStore>(heldStores());
  for (const p of handle.panes().panes) {
    const s = p.content.store();
    if (s) stores.add(s);
  }
  // A store at version 0 holds the bytes it was opened with: opening a found file is no reason to read every file again.
  return `${[...stores].filter((s) => s.snapshot().version > 0).map((s) => `${s.snapshot().path}@${s.snapshot().version}`).sort().join('|')}#${st.indexRev}`;
}

/** Each path's size: the index's where it lists the path, else a stat; null when it is gone. */
async function sizesOf(handle: AppHandle, paths: readonly string[], live: () => boolean): Promise<Map<string, number | null>> {
  const known = new Map(handle.index.entries().map((e) => [e.path, e.size] as const));
  const out = new Map<string, number | null>();
  const unknown = paths.filter((p) => {
    const size = known.get(p);
    if (size !== undefined) out.set(p, size);
    return size === undefined;
  });
  for (let i = 0; i < unknown.length && live(); i += 16) {
    await Promise.all(
      unknown.slice(i, i + 16).map(async (p) => {
        out.set(p, await handle.shell.stat(p).then((st) => st?.size ?? null, () => null));
      }),
    );
  }
  return out;
}

/** The texts of `paths`; a file found over MAX_BYTES only once read (it grew) is added to `big`. */
async function readTexts(handle: AppHandle, paths: readonly string[], big: Set<string>, live: () => boolean): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < paths.length && live(); i += 16) {
    await Promise.all(
      paths.slice(i, i + 16).map(async (p) => {
        try {
          const bytes = await (handle.shell.peekFile ?? handle.shell.readFile).call(handle.shell, p);
          if (bytes.length > MAX_BYTES) big.add(p);
          if (bytes.length > MAX_BYTES || bytes.subarray(0, 8192).includes(0)) return;
          out.set(p, decoder.decode(bytes));
        } catch {
          // Gone since the index listed it: not searched.
        }
      }),
    );
  }
  return out;
}

/** How long a regular expression may search before it is called too slow and its worker ended. */
const BUDGET_MS = 1500;
const SLOW_NOTE = 'This pattern is too slow to search: simplify it.';

type Hits = Map<string, LineHit[]>;

/**
 * The lines of `texts` that `re` matches. A pattern the reader typed runs in a worker, which is ended when the budget
 * passes ('slow') or `st.stop` is called by the next search (null): a backtracking pattern holds one `exec` for minutes and
 * only a worker can be stopped. Plain text, which cannot backtrack, runs here, with no copy of the texts.
 */
function matchAll(st: SearchState, texts: ReadonlyMap<string, string>, re: RegExp, user: boolean): Promise<Hits | 'slow' | null> {
  const here = (): Hits => {
    const out: Hits = new Map();
    for (const [p, t] of texts) {
      const h = matchLines(t, re);
      if (h.length > 0) out.set(p, h);
    }
    return out;
  };
  if (!user) return Promise.resolve(here());
  if (typeof Worker === 'undefined') return Promise.resolve(here());
  let w: Worker;
  try {
    w = new Worker(new URL('../search.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return Promise.resolve(here());
  }
  return new Promise((resolve) => {
    const end = (v: Hits | 'slow' | null): void => {
      clearTimeout(timer);
      w.terminate();
      if (st.stop === stop) st.stop = undefined;
      resolve(v);
    };
    const stop = (): void => end(null);
    const timer = setTimeout(() => end('slow'), BUDGET_MS);
    st.stop = stop;
    w.onmessage = (e: MessageEvent<SearchDone>) => end(new Map(e.data.hits.map(([p, h]) => [p, h.slice()])));
    // A worker that cannot start or load (a CSP, an engine without module workers) searches here instead.
    w.onerror = () => {
      clearTimeout(timer);
      w.terminate();
      if (st.stop === stop) st.stop = undefined;
      resolve(here());
    };
    const job: SearchJob = { source: re.source, flags: re.flags, texts: [...texts] };
    w.postMessage(job);
  });
}

/** Works the search out for what the panel shows now, when that changed; draws again once it has. */
function ensure(ctx: PanelContext<SearchState>, sc: Scope): void {
  const { handle, st } = ctx;
  const qkey = [st.q, st.case, st.regex, st.word, sc.id, sc.where].join('\u0001');
  if (st.qkey !== qkey) {
    st.first = ctx.pane()?.path() ?? null;
    st.qkey = qkey;
  }
  const key = `${qkey}\u0001${sc.paths.join('\u0002')}\u0001${textsKey(handle, st)}`;
  if (st.key === key) return;
  st.key = key;
  const run = ++st.run;
  st.stop?.();
  const c = compileSearch(st);
  if (c === null) {
    st.res = { short: true, qkey, groups: [], total: 0, note: '' };
    st.pending = false;
    return;
  }
  if ('error' in c) {
    st.res = { bad: c.error, qkey, groups: [], total: 0, note: '' };
    st.pending = false;
    return;
  }
  st.pending = true;
  const regex = st.regex;
  // A search the fields have moved past stops reading: typing a word would otherwise leave a pass running per key.
  const live = (): boolean => run === st.run;
  void (async () => {
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    if (!live()) return;
    const texts = new Map<string, string>();
    const closed: string[] = [];
    for (const p of sc.paths) {
      const s = storeAt(handle, p);
      if (s) texts.set(p, textOf(s));
      else closed.push(p);
    }
    // Sized before any read: the shell's search skips a file over 4 MB without a word, and a whole read only to drop it is waste.
    const sizes = await sizesOf(handle, closed, live);
    if (!live()) return;
    const big = new Set(closed.filter((p) => (sizes.get(p) ?? 0) > MAX_BYTES));
    const rest = closed.filter((p) => !big.has(p) && sizes.get(p) !== null);
    let read = rest;
    let note = '';
    const lit = literalOf(st);
    const shell = handle.shell;
    if (lit !== null && shell.searchContent && rest.length > 0) {
      try {
        read = await filesHolding(rest, (paths) => shell.searchContent!(paths, lit, { roots: handle.index.roots(), limit: 10_000, perFile: 1 }));
      } catch {
        // Read them all instead.
      }
    }
    if (read.length > READ_CAP) {
      note = `${plural(read.length - READ_CAP, 'file')} not read: narrow the search to a folder`;
      read = read.slice(0, READ_CAP);
    }
    if (!live()) return;
    for (const [p, t] of await readTexts(handle, read, big, live)) texts.set(p, t);
    if (!live()) return;
    if (big.size > 0) note = [note, `${plural(big.size, 'file')} over 4 MB not searched`].filter(Boolean).join('; ');
    const found = await matchAll(st, texts, c.re, regex);
    if (!live() || found === null) return;
    if (found === 'slow') {
      st.res = { slow: true, qkey, groups: [], total: 0, note: '' };
      st.pending = false;
      ctx.redraw();
      return;
    }
    const groups: Group[] = [];
    let total = 0;
    for (const p of sc.paths) {
      const text = texts.get(p);
      const hits = found.get(p);
      if (text === undefined || hits === undefined) continue;
      const sp = splitLines(text);
      const starts: number[] = [];
      let at = 0;
      for (let i = 0; i < sp.lines.length; i++) {
        starts.push(at);
        at += sp.lines[i]!.length + sp.eols[i]!.length;
      }
      groups.push({ path: p, hits, lines: sp.lines, starts, text });
      total += hits.length;
    }
    groups.sort((a, b) => Number(b.path === st.first) - Number(a.path === st.first) || b.hits.length - a.hits.length || a.path.localeCompare(b.path));
    st.res = { re: c.re, regex, qkey, groups, total, note };
    st.pending = false;
    ctx.redraw();
  })();
}

const ticked = (st: SearchState, path: string): boolean => st.tick.get(path) ?? tickedByDefault(path);

/** The result, when it answers what the fields say now; while a new search reads, the old one is only looked at. */
function current(st: SearchState): (Result & { readonly re: RegExp }) | null {
  const res = st.res;
  if (res?.slow && res.qkey === st.qkey) {
    notify({ kind: 'refused', text: SLOW_NOTE, fades: true });
    return null;
  }
  if (!res?.re) return null;
  if (res.qkey === st.qkey) return res as Result & { readonly re: RegExp };
  notify({ kind: 'info', text: 'Still searching for what Find says now: replace once its matches are shown.', fades: true });
  return null;
}

/** The byte of a hit's first match in its file as it was searched. */
const byteOfHit = (g: Group, x: LineHit): number => byteAt(g.text, g.starts[x.l]! + (x.ms[0]?.[0] ?? 0));

/** In-page find shows the panel's text, where it can say the same thing: plain text, any case, not words alone. */
async function lightFind(ctx: PanelContext<SearchState>): Promise<void> {
  const { handle, st } = ctx;
  if (st.regex || st.case || st.word) return;
  const pane = handle.panes().focused;
  if (pane.view.mode !== 'rendered') return;
  const f = activeFind();
  if (f?.pane === pane && f.isOpen() && f.state().query === st.q) return;
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await runCommand(handle, 'view.find');
  const input = pane.host.querySelector<HTMLInputElement>('.marxy-find-input');
  if (input) {
    input.value = st.q;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  back?.focus({ preventScroll: true });
}

/** The page's cursor on the hit, once the find has had its frame. */
function land(handle: AppHandle, byte: number): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (handle.panes().focused.view.mode !== 'rendered') return;
      handle.mountThrough(byte);
      handle.selection.cursorAt(byte);
    }),
  );
}

/** J K resting on a hit: the page shows it, and the keys stay in the panel. */
function follow(ctx: PanelContext<SearchState>, g: Group, x: LineHit): void {
  const { handle } = ctx;
  const byte = byteOfHit(g, x);
  if (handle.panes().focused.path() === g.path) {
    void lightFind(ctx).then(() => land(handle, byte));
    return;
  }
  void handle.open(g.path, { at: byte, focus: 'stay', onLanded: () => void lightFind(ctx).then(() => land(handle, byte)) });
}

function openHit(ctx: PanelContext<SearchState>, g: Group, x: LineHit, e?: RowEvent): void {
  const { handle } = ctx;
  const byte = byteOfHit(g, x);
  if (e?.beside) {
    void handle.open(g.path, { at: byte, target: 'other' });
    return;
  }
  void handle.open(g.path, { at: byte, onLanded: () => void lightFind(ctx).then(() => land(handle, byte)) });
}

const saveChord = (): string => chordText('Mod+S');

async function foldFirst(handle: AppHandle): Promise<void> {
  if (handle.hasUnfoldedSource()) await handle.foldSource();
}

/** One staged splice into `store`: true when the store took it. */
async function stageInto(store: DocumentStore, before: string, after: string, label: string, version: number): Promise<boolean> {
  const s = minimalSplice(before, after);
  if (!s) return false;
  const path = store.snapshot().path;
  try {
    return await store.apply({ range: { file: path, start: s.start, end: s.end }, replacement: s.replacement, label, baseVersion: version });
  } catch {
    return false;
  }
}

async function replaceHit(ctx: PanelContext<SearchState>, g: Group, x: LineHit): Promise<void> {
  const { handle, st } = ctx;
  const res = current(st);
  if (!res) return;
  await foldFirst(handle);
  const store = await storeToStage(handle, g.path);
  if (typeof store === 'string') {
    notify({ kind: 'refused', text: store });
    return;
  }
  const snap = store.snapshot();
  const text = decoder.decode(snap.buffer.bytes);
  const next = replaceOne(text, x.l, res.re, st.r, res.regex === true);
  const ok = next !== text && (await stageInto(store, text, next, `Replace on line ${x.l + 1}`, snap.version));
  if (!ok) {
    settle(store);
    notify({ kind: 'info', text: 'Nothing would change on that line.', fades: true });
    return;
  }
  notify({ kind: 'done', text: `Replaced on line ${x.l + 1} of ${basename(g.path)}: staged. ${saveChord()} writes it, U undoes it.`, fades: true });
  st.key = '';
  ctx.redraw();
}

async function stageAll(ctx: PanelContext<SearchState>): Promise<void> {
  const { handle, st } = ctx;
  const res = current(st);
  if (!res) return;
  const todo = res.groups.filter((g) => ticked(st, g.path));
  if (todo.length === 0) {
    notify({ kind: 'refused', text: 'No file is ticked. Space on a file ticks it.' });
    return;
  }
  await foldFirst(handle);
  let places = 0;
  let files = 0;
  const refused: string[] = [];
  for (const g of todo) {
    const store = await storeToStage(handle, g.path);
    if (typeof store === 'string') {
      refused.push(basename(g.path));
      continue;
    }
    const snap = store.snapshot();
    const text = decoder.decode(snap.buffer.bytes);
    const r = replaceAll(text, res.re, st.r, res.regex === true);
    if (r.n > 0 && (await stageInto(store, text, r.text, `Replace ${st.q} with ${st.r}`, snap.version))) {
      places += r.n;
      files++;
    } else settle(store);
  }
  st.peek = false;
  st.key = '';
  const left = refused.length > 0 ? ` Not changed: ${refused.join(', ')} (not UTF-8 text here).` : '';
  notify(
    files > 0
      ? { kind: 'done', text: `Staged ${plural(places, 'place')} in ${plural(files, 'file')}, each file its own undo. Nothing is written until ${saveChord()}.${left}` }
      : { kind: 'info', text: `The replacement is the same text: nothing would change.${left}` },
  );
  ctx.redraw();
}

/** How many open or held documents have changes not yet saved. */
function unsavedCount(handle: AppHandle): number {
  const stores = new Set<DocumentStore>(heldStores());
  for (const p of handle.panes().panes) {
    const s = p.content.store();
    if (s?.snapshot().dirty) stores.add(s);
  }
  return stores.size;
}

const wordsNode = (parts: readonly (readonly [string, boolean])[], tag: 'del' | 'ins', from: number): HTMLElement => {
  const out = h('span', '');
  let pos = 0;
  if (from > 0) out.append('…');
  for (const [t, changed] of parts) {
    const p0 = pos;
    pos += t.length;
    if (pos <= from) continue;
    const piece = t.slice(Math.max(0, from - p0));
    out.append(changed ? h(tag, tag === 'del' ? 'marxy-l-del' : 'marxy-l-ins', piece) : piece);
  }
  return out;
};
const signed = (sign: '−' | '+', body: Node): HTMLElement => h('span', '', h('span', sign === '−' ? 'marxy-l-minus' : 'marxy-l-plus', sign), ' ', body);

/** A file's replace as a patch (changes/patch.ts): each changed line struck and put in, the first three. */
function peekRows(st: SearchState, re: RegExp, regex: boolean, g: Group, body: HTMLElement): void {
  const next = replaceAll(g.text, re, st.r, regex).text;
  const c = changesOf(g.path, encoder.encode(g.text), encoder.encode(next));
  const rows = patchRows(c?.patch ?? '');
  const minus: [number, string][] = rows.filter((r) => r.sign === '-').map((r) => [r.no, r.text]);
  const plus: string[] = rows.filter((r) => r.sign === '+').map((r) => r.text);
  body.append(row({ nm: h('b', '', basename(g.path)), small: `${basename(dirname(g.path))}/`, as: minus.length ? plural(minus.length, 'line') : 'nothing to change', cls: minus.length ? '' : 'dim' }));
  minus.slice(0, 3).forEach(([l, a], i) => {
    const w = wordPair(a, plus[i] ?? '');
    body.append(hit(String(l), signed('−', wordsNode(w.a, 'del', w.from))), hit('', signed('+', wordsNode(w.b, 'ins', w.from))));
  });
  if (minus.length > 3) body.append(hit('', h('span', 'marxy-l-ui', plural(minus.length - 3, 'more line'))));
}

function savedSearches(handle: AppHandle): SavedSearch[] {
  return (collectionOf(handle)?.queries() ?? []).map((q) => savedOf(q.name)).filter((s): s is SavedSearch => s !== null);
}

async function saveThis(ctx: PanelContext<SearchState>): Promise<void> {
  const { handle, st } = ctx;
  if (st.q.length < 2) {
    notify({ kind: 'refused', text: 'Type two characters or more first.' });
    return;
  }
  const s: SavedSearch = { q: st.q, case: st.case, regex: st.regex, word: st.word, scope: st.scope };
  const shell = handle.shell as never;
  const draft = await beginSaveQuery(shell);
  if (!draft) return;
  if (await saveQuery(shell, draft, { name: savedName(s), q: s.q })) {
    await collectionOf(handle)?.reload();
    notify({ kind: 'done', text: 'Saved in collection.toml, beside your saved queries. It is in this menu.', fades: true });
  }
}

function menu(ctx: PanelContext<SearchState>, at: Element): void {
  const { handle, st } = ctx;
  const res = st.res;
  const ok = (res?.groups.length ?? 0) > 0;
  const redo = (): void => {
    st.more.clear();
    st.files = FILE_STEP;
    st.shut.clear();
    st.peek = false;
    st.key = '';
    ctx.redraw();
  };
  const saved = savedSearches(handle);
  const items: MenuItem[] = [
    {
      title: ok ? `Collect all ${res!.total}` : 'Collect all',
      detail: 'to the tray',
      run: () => {
        if (!ok) return void notify({ kind: 'info', text: 'Nothing to collect.', fades: true });
        const n = collectMany(res!.groups.flatMap((g) => g.hits.map((x) => ({ path: g.path, first: x.l + 1, last: x.l + 1, text: g.lines[x.l] ?? '', note: '' }))));
        notify({ kind: 'done', text: `Collected ${plural(res!.total, 'line')}, each with its file and line. ${plural(n, 'piece')} in the tray (T).`, fades: true });
      },
    },
    { title: 'Save this search', run: () => void saveThis(ctx) },
    ...(saved.length > 0
      ? [
          { title: 'Saved searches', note: true },
          ...saved.map((s): MenuItem => ({
            title: s.q,
            detail: optWords(s),
            run: () => {
              Object.assign(st, { q: s.q, case: s.case, regex: s.regex, word: s.word, scope: s.scope, dir: null });
              redo();
            },
          })),
        ]
      : []),
    {
      title: 'Clear',
      run: () => {
        st.q = '';
        st.r = '';
        st.tick.clear();
        redo();
      },
    },
  ];
  openMenu(anchorBelow(at), 'Search', items);
}

function emptyNote(sc: Scope): string {
  if (sc.id === 'file') return `Searches ${sc.name} as it is now. Two characters or more; Aa, .* and word narrow it.`;
  return sc.id === 'dir' ? `Searches the text of the ${plural(sc.paths.length, 'file')} in ${sc.name}, as it is now.` : `Searches the text of all ${plural(sc.paths.length, 'file')} in ${sc.name}, as it is now.`;
}

const panel: PanelDef<SearchState> = {
  id: 'search',
  name: 'Search',
  field: true,
  rest: 'Tab comes here. J K walk the matches and the page follows; Space ticks a file.',
  init: () => ({ q: '', r: '', case: false, regex: false, word: false, scope: 'ws', dir: null, tick: new Map(), shut: new Set(), more: new Set(), files: FILE_STEP, peek: false, res: null, key: '', qkey: '', run: 0, pending: false, first: null, indexRev: 0 }),
  subject: (ctx) => scopeOf(ctx).name,
  buttons: (ctx) => [{ label: '⋯', icon: 'more', title: 'Collect, saved searches, clear', run: (e) => menu(ctx, e.currentTarget as Element) }],
  badge({ st }) {
    const res = st.res;
    if (st.q.trim() === '' || !res || res.qkey !== st.qkey || res.short || res.bad !== undefined) return null;
    return { text: res.total > 999 ? '999+' : String(res.total), tone: 'faint', say: plural(res.total, 'match', 'matches') };
  },
  take(ctx, arg) {
    const st = ctx.st;
    // The Line's `#` keeps `{ q, scope: 'grep', path?, line? }` (line 1-based, the hit under its cursor); `/` keeps `{ q, scope: 'find' }`.
    const a = typeof arg === 'string' ? { q: arg } : ((arg ?? {}) as { q?: unknown; scope?: unknown; dir?: unknown; path?: unknown; line?: unknown });
    if (typeof a.path === 'string' && typeof a.line === 'number') ctx.cursorTo(`h:${a.path}:${a.line - 1}`);
    if (typeof a.q === 'string' && a.q !== '') {
      let q = a.q;
      // A place's "find in this place" names it: in:<place> narrows to that folder.
      const inPlace = /(?:^|\s)in:(\S+)/.exec(q);
      if (inPlace) {
        q = q.replace(inPlace[0], ' ').trim();
        const root = ctx.handle.index.roots().find((r) => basename(r).toLowerCase() === inPlace[1]!.toLowerCase().replace(/\/$/, ''));
        if (root) Object.assign(st, { scope: 'dir', dir: root });
      }
      // As the Line reads it: /pattern/ is a regular expression, and a capital letter makes the case exact.
      const m = /^\/(.+)\/([a-z]*)$/.exec(q);
      if (m) Object.assign(st, { q: m[1], regex: true, case: !m[2]!.includes('i'), word: false });
      else Object.assign(st, { q, regex: false, case: /\p{Lu}/u.test(q), word: false });
    }
    if (a.scope === 'find') Object.assign(st, { scope: ctx.pane() ? 'file' : 'ws', dir: null });
    else if (a.scope === 'grep') Object.assign(st, { scope: 'ws', dir: null });
    else if (a.scope === 'file' || a.scope === 'dir' || a.scope === 'ws') Object.assign(st, { scope: a.scope, dir: typeof a.dir === 'string' ? a.dir : null });
    st.more.clear();
    st.shut.clear();
    st.files = FILE_STEP;
    st.peek = false;
    // The kept hit is drawn even past its file's first few.
    if (typeof a.path === 'string' && typeof a.line === 'number') st.more.add(a.path);
  },
  render(ctx, body, top) {
    const { handle, st } = ctx;
    // A staged file no pane shows changes without a pane saying so: its undo or save draws the list again.
    st.offHeld ??= onHeld(() => ctx.redraw());
    st.offIndex ??= handle.index.subscribe(() => st.indexRev++);
    const sc = scopeOf(ctx);
    const changed = (): void => {
      st.more.clear();
      st.files = FILE_STEP;
      st.peek = false;
      ctx.redraw();
    };
    const opt = (k: 'case' | 'regex' | 'word', label: string, title: string, name: string): HTMLElement => {
      const b = h('button', st[k] ? 'marxy-l-on' : '', label);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-pressed', String(st[k]));
      b.addEventListener('click', () => {
        st[k] = !st[k];
        changed();
      });
      return b;
    };
    top.append(
      stack(
        fld({
          name: 'search-q',
          lb: 'Find',
          mono: true,
          placeholder: 'Find',
          value: st.q,
          right: h('span', 'marxy-l-opt', opt('case', 'Aa', 'Match case', 'Match case'), opt('regex', '.*', 'A regular expression: $1 in Replace is its first group', 'Regular expression'), opt('word', 'word', 'Whole words only', 'Whole words')),
          oninput: (v) => {
            st.q = v;
            changed();
          },
        }),
        fld({
          name: 'search-r',
          lb: 'Replace',
          mono: true,
          placeholder: 'Replace',
          value: st.r,
          oninput: (v) => {
            st.r = v;
            ctx.redraw();
          },
        }),
      ),
    );
    const here = ctx.pane()?.path() ?? null;
    const items: [ScopeId, string][] = [];
    if (here !== null) items.push(['file', 'This file']);
    if (here !== null && !isUntitled(here)) items.push(['dir', `${basename(st.dir ?? dirname(here))}/`]);
    const roots = handle.index.roots();
    items.push(['ws', roots.length === 1 ? basename(roots[0]!) : 'Every place']);
    top.append(
      tool(
        lab('In'),
        sg(items, sc.id, (id) => {
          st.scope = id as ScopeId;
          if (id !== 'dir') st.dir = null;
          changed();
        }, 'Search in'),
      ),
    );

    ensure(ctx, sc);
    const res = st.res;
    if (!res || (st.pending && res.groups.length === 0 && !res.short && !res.bad)) {
      body.append(empty(st.q.length < 2 ? emptyNote(sc) : `Reading ${plural(sc.paths.length, 'file')}…`));
      return;
    }
    if (res.short) {
      body.append(empty(st.q ? 'Two characters at least.' : emptyNote(sc)));
      return;
    }
    if (res.bad) {
      body.append(empty(`Not a regular expression yet: ${res.bad}`));
      return;
    }
    if (res.slow) {
      body.append(empty(SLOW_NOTE));
      return;
    }
    if (res.groups.length === 0) {
      body.append(empty(st.pending ? `Reading ${plural(sc.paths.length, 'file')}…` : `Nothing in ${sc.name} holds that.`));
      return;
    }
    const re = res.re!;
    const single = res.groups.length === 1;
    body.append(sec(`${plural(res.total, 'match', 'matches')} in ${plural(res.groups.length, 'file')}`, res.note));
    const shown = res.groups.filter((g, i) => i < st.files || st.more.has(g.path));
    shown.forEach((g, gi) => {
      const on = ticked(st, g.path);
      const open = !st.shut.has(g.path);
      const flip = (): void => {
        st.tick.set(g.path, !ticked(st, g.path));
        ctx.redraw();
      };
      const store = storeAt(handle, g.path);
      const name = basename(g.path);
      const kept = leftAloneWhy(g.path);
      const off = on ? '' : kept !== null && !st.tick.has(g.path) ? `${kept}: Replace leaves it alone until ticked` : 'unticked: Replace leaves it alone';
      body.append(
        row({
          k: `g:${g.path}`,
          pre: ck(on),
          tw: open ? '▾' : '▸',
          nm: h('b', '', name),
          small: `${basename(dirname(g.path))}/${off ? ` · ${off}` : ''}`,
          n: g.hits.length,
          cls: `${g.path === here ? 'at ' : ''}${store?.snapshot().dirty ? 'dirty' : ''}`,
          title: g.path + (off ? `  (${off})` : ''),
          what: name,
          open,
          toggle: () => {
            if (open) st.shut.add(g.path);
            else st.shut.delete(g.path);
            ctx.redraw();
          },
          tick: flip,
          go: 'go',
          run: (e) => openHit(ctx, g, g.hits[0]!, e),
          verbs: (): (Verb | null)[] => [
            ['Space', on ? 'untick: leave it alone' : 'tick', flip],
            store?.snapshot().canUndo ? ['u', 'undo its last change', () => void store!.undo()] : null,
          ],
        }),
      );
      if (!open) return;
      const cap = st.more.has(g.path) ? Number.POSITIVE_INFINITY : single ? 8 : gi < 2 ? 2 : 1;
      for (const x of g.hits.slice(0, cap)) {
        const cut = snippet(g.lines[x.l] ?? '', x.ms);
        const text = h('span', '', cut.pre ? '…' : '', ...cut.parts.map(([t, m]) => (m ? h('mark', 'marxy-l-mark', t) : t)));
        const replace = st.r !== '' ? (): void => void replaceHit(ctx, g, x) : undefined;
        body.append(
          hit(String(x.l + 1), text, {
            k: `h:${g.path}:${x.l}`,
            what: `line ${x.l + 1}`,
            go: 'go',
            run: (e) => openHit(ctx, g, x, e),
            at: () => follow(ctx, g, x),
            ...(replace ? { enter: replace } : {}),
            verbs: (): (Verb | null)[] => [
              replace ? ['r', 'replace on this line', replace] : null,
              ['o', 'go', (e) => openHit(ctx, g, x, e as RowEvent | undefined)],
              ['Space', on ? 'untick its file' : 'tick its file', flip],
              ['y', 'collect', () => {
                const n = collect({ path: g.path, first: x.l + 1, last: x.l + 1, text: g.lines[x.l] ?? '', note: '' });
                notify({ kind: 'done', text: `Collected ${g.path}:${x.l + 1}. ${plural(n, 'piece')} in the tray (T).`, fades: true });
              }],
            ],
          }),
        );
      }
      if (g.hits.length > cap) {
        const more = g.hits.length - cap;
        body.append(
          hit('', h('span', 'marxy-l-ui', `${more} more`), {
            k: `m:${g.path}`,
            what: `${more} more in ${name}`,
            go: 'show them',
            run: () => {
              st.more.add(g.path);
              ctx.redraw();
            },
          }),
        );
      }
    });
    const unshown = res.groups.length - shown.length;
    if (unshown > 0) {
      const next = Math.min(FILE_STEP, unshown);
      body.append(
        row({
          k: 'm:files',
          nm: h('span', 'marxy-l-ui', plural(unshown, 'more file')),
          small: next < unshown ? `${next} at a time` : '',
          what: `${plural(unshown, 'more file')} with matches`,
          go: 'show them',
          run: () => {
            st.files += FILE_STEP;
            ctx.redraw();
          },
        }),
      );
    }

    if (st.r === '') return;
    const todo = res.groups.filter((g) => ticked(st, g.path));
    const places = todo.reduce((s, g) => s + g.hits.filter((x) => swap(re, g.lines[x.l] ?? '', st.r, res.regex === true) !== g.lines[x.l]).length, 0);
    body.append(sec('Replace', 'staged, never written here', true));
    body.append(
      btns(
        { label: `Stage ${plural(places, 'place')} in ${plural(todo.length, 'file')}`, pri: true, title: 'Each file gets its own undo step and its own unsaved patch', run: () => void stageAll(ctx) },
        {
          label: st.peek ? 'Hide the patch' : 'Peek the patch',
          title: 'What would change, without staging it',
          run: () => {
            st.peek = !st.peek;
            ctx.redraw();
          },
        },
      ),
    );
    if (st.peek) for (const g of todo.slice(0, st.files)) peekRows(st, re, res.regex === true, g, body);
    body.append(hint('Unticked files are left alone.'));
    const unsaved = unsavedCount(handle);
    if (unsaved > 0) body.append(hint(`${plural(unsaved, 'file has', 'files have')} unsaved changes. ${saveChord()} in each writes it; Shift R reads its patch.`));
  },
};

export default panel;
