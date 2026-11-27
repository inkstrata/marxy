// The rows of the Line's scopes past Go, commands and the workspace search: `@` this document's
// parts, `:` a line, `/` find here, `=` a page's row filter, `!` transforms with the patch each would stage, `%` lenses,
// `~` compare, `&` read as, `?` help. Each scope is worked out from the focused pane as it is now; nothing is kept.
import { outlineFrom, type IndexEntry } from '@marxy/core';
import { changesOf } from '../changes/patch.ts';
import { appHandle } from '../commands/app-handle.ts';
import { compareTwoFiles, showVersionChanges, keptWhen } from '../commands/compare.ts';
import { findInPane } from '../commands/find.ts';
import { logFilterChoices } from '../commands/log.ts';
import type { AppContext, Command } from '../commands/registry.ts';
import { stageTransform } from '../commands/transform.ts';
import { partsHere } from '../parts/cursor.ts';
import { readAs, readingsFor } from '../read-as/ladder.ts';
import { filePreview, type PreviewData } from '../render/palette-preview.ts';
import { addStep, canApply, createChain, eolOf, output } from '../transform/chain.ts';
import { versionRecorder } from '../versions/recorder.ts';
import type { ListedVersion } from '../versions/store.ts';
import { TRANSFORMS } from '@marxy/core';
import { focusedPane, landAt, landAtLine, paneText, walkToUnit, type LinePane } from './go.ts';
import { lensesOf, lensOn, clearLens, setLens, type LensId } from '../depths/lens.ts';
import { clearRowFilter, filterRows as keepRows, readingTable, rowFilterOf, rowsHolding } from '../view/reading-filter.ts';
import { runBudgeted } from '../left/budgeted-worker.ts';
import type { FindDone, FindJob } from './find.worker.ts';
import { excerpt, findPattern, fuzzy, lineCount, lineHits, type LineHit, lineOfByte, lineQuery, linesOf } from './refs.ts';
import { around, type LinePreview, type LineRow } from './rows.ts';
import { SCOPES, type ScopeId } from './scopes.ts';

export interface ScopeEnv {
  /** Paint again: something asked for after the first paint has come (a file's earlier copies). */
  readonly refresh: () => void;
  /** Puts `value` in the field (a help row picks a scope). */
  readonly setQuery: (value: string) => void;
  readonly ctx: () => AppContext;
  readonly entries: () => readonly IndexEntry[];
}

export interface ScopeResult {
  readonly rows: readonly LineRow[];
  /** One quiet line under the rows: why there are none, or how to write the query. */
  readonly note?: string;
  /** The field's count ("12 matches"). */
  readonly count?: string;
  /** Enter with no row: the scope's own act on the query (find opens in-page find with it). */
  readonly enter?: (how: { beside: boolean; alt: boolean }) => void;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
const basename = (p: string): string => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
const decoder = new TextDecoder('utf-8', { fatal: false });
// The `!` preview splices its text back over the bytes: a mark at the start must stay in it, as Apply keeps it.
const keepMark = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/** The pane's text as lines, decoded once per buffer. */
const linesCache = new WeakMap<Uint8Array, string[]>();
function textLines(bytes: Uint8Array): string[] {
  let held = linesCache.get(bytes);
  if (!held) {
    held = linesOf(decoder.decode(bytes));
    linesCache.set(bytes, held);
  }
  return held;
}

function placePreview(path: string, lines: readonly string[], from: number, to: number | null): Promise<LinePreview> {
  return Promise.resolve({ type: 'lines', head: `${basename(path)}:${from + 1}${to !== null && to > from ? `-${to + 1}` : ''}`, lines: around(lines, from, to) });
}

const NO_FILE = 'Open a file first.';

/* ---------- @ ---------- */

function outlineRows(q: string, pane: LinePane | null): ScopeResult {
  const text = paneText(pane);
  const store = pane?.content.store() ?? null;
  const path = pane?.path() ?? null;
  if (pane && store && text && pane.view.viewer() === null && store.snapshot().ast) {
    const lines = textLines(text.bytes);
    const outline = outlineFrom(store.snapshot().ast);
    const rows: LineRow[] = [];
    for (const [i, h] of outline.entries()) {
      const m = q === '' ? { idx: [] as number[] } : fuzzy(q, h.text);
      if (!m) continue;
      const indent = ' '.repeat(Math.min(h.level - 1, 4));
      const line = lineOfByte(text.bytes, h.src.start);
      rows.push({
        key: `h${i}:${h.src.start}`,
        group: '',
        title: `${indent}${h.text}`,
        marks: m.idx.map((x) => x + indent.length),
        detail: `line ${line}`,
        run: () => void landAt(h.src.start, undefined, line),
        preview: () => placePreview(text.path, lines, line - 1, null),
        keep: { panel: 'outline', arg: { q, at: h.src.start } },
      });
    }
    if (rows.length > 0 || outline.length > 0) return { rows, note: rows.length === 0 ? 'No heading here holds that.' : undefined };
  }
  const here = partsHere();
  if (here && here.pane === pane) {
    const rows: LineRow[] = [];
    const visit = (units: readonly import('../viewers/types.ts').PartUnit[], depth: number): void => {
      for (const u of units) {
        if (rows.length >= 400) return;
        const label = `${u.label} ${u.address}`;
        const m = q === '' ? { idx: [] as number[] } : fuzzy(q, label);
        const indent = ' '.repeat(depth);
        if (m) rows.push({ key: `u:${u.id}`, group: '', title: `${indent}${label}`, marks: m.idx.map((x) => x + indent.length), run: () => void walkToUnit(u), keep: { panel: 'outline', arg: { q, unit: u.id } } });
        if (depth === 0 && u.children) visit(u.children, 1);
      }
    };
    visit(here.tree.top(), 0);
    return { rows, note: rows.length === 0 ? (q === '' ? 'This page has no parts to list.' : 'No part here is called that.') : undefined };
  }
  return { rows: [], note: path === null ? NO_FILE : 'This kind of file has no parts to list.' };
}

/* ---------- : ---------- */

function gotoRows(q: string, pane: LinePane | null): ScopeResult {
  const text = paneText(pane);
  if (!text) return { rows: [], note: pane?.path() ? 'This page has no lines to go to.' : NO_FILE };
  const n = lineCount(text.bytes);
  const want = lineQuery(q);
  if (!want || want.from > n) return { rows: [], note: `A line from 1 to ${n.toLocaleString('en-GB')}, or a range such as 40-52.` };
  const to = want.to === null ? null : Math.min(want.to, n);
  const lines = textLines(text.bytes);
  return {
    rows: [
      {
        key: `goto:${want.from}-${to}`,
        group: '',
        title: to === null ? `Go to line ${want.from}` : `Go to line ${want.from} and select to ${to}`,
        detail: `of ${n.toLocaleString('en-GB')}`,
        run: () => void landAtLine(want.from, to),
        preview: () => placePreview(text.path, lines, want.from - 1, to === null ? null : to - 1),
      },
    ],
  };
}

/* ---------- / ---------- */

/** How long a typed regular expression may search a page before it is called too slow. */
const FIND_BUDGET_MS = 1500;
const SLOW_NOTE = 'This pattern is too slow to search: simplify it.';

/** The `/re/` search now running or last done: one at a time, a new query or page ends the one before. */
let finding: { bytes: Uint8Array; q: string; got: 'run' | 'slow' | readonly LineHit[]; stop?: () => void } | null = null;

/** The hits of `re` over `lines`: at once for plain text; for a typed pattern from a worker, 'run' until it answers, 'slow' past the budget. */
function findHits(q: string, re: RegExp, bytes: Uint8Array, lines: readonly string[], env: ScopeEnv): readonly LineHit[] | 'run' | 'slow' {
  if (!/^\/.+\/[a-z]*$/.test(q) || typeof Worker === 'undefined') return lineHits(lines, re, 500);
  if (finding && finding.bytes === bytes && finding.q === q) return finding.got;
  finding?.stop?.();
  const mine: NonNullable<typeof finding> = { bytes, q, got: 'run' };
  finding = mine;
  const job: FindJob = { source: re.source, flags: re.flags, lines, cap: 500 };
  void runBudgeted<FindJob, FindDone>(() => new Worker(new URL('./find.worker.ts', import.meta.url), { type: 'module' }), job, FIND_BUDGET_MS, mine).then((ran) => {
    if (ran === 'stopped' || finding !== mine) return;
    mine.got = ran === 'slow' ? 'slow' : ran === 'none' ? lineHits(lines, re, 500) : ran.done;
    env.refresh();
  });
  return 'run';
}

function findRows(q: string, pane: LinePane | null, env: ScopeEnv): ScopeResult {
  const { re, error } = findPattern(q);
  const seek = (how: { alt: boolean }): void => {
    if (!re) return;
    if (how.alt) {
      const kept = setLens(focusedPane(), 'find', `“${q}”`, re);
      if (kept === null) findInPane(q, re);
      return;
    }
    findInPane(q, re);
  };
  if (!pane?.path()) return { rows: [], note: NO_FILE };
  if (error) return { rows: [], note: `Not a regular expression: ${error}` };
  if (q === '') return { rows: [], note: 'Type to find. /pattern/ is a regular expression. A capital letter makes it exact case.' };
  const text = paneText(pane);
  // A page of the app's own (a PDF) finds in its own text: Enter opens in-page find on it.
  if (!text || pane.view.viewer() !== null) return { rows: [], note: 'Enter finds it on this page.', enter: seek };
  const lines = textLines(text.bytes);
  const found = re ? findHits(q, re, text.bytes, lines, env) : [];
  // No Enter until the worker answers: in-page find would run the same pattern here, where nothing can stop it.
  if (found === 'run') return { rows: [], note: 'Searching…' };
  if (found === 'slow') return { rows: [], note: SLOW_NOTE };
  const hits = found;
  const rows: LineRow[] = hits.slice(0, 200).map((h, i) => ({
    key: `f${i}:${h.line}:${h.at}`,
    group: '',
    title: lines[h.line]!,
    ex: excerpt(lines[h.line]!, h.at, h.len),
    detail: String(h.line + 1),
    run: async (how) => {
      if (how.alt) return seek(how);
      await landAtLine(h.line + 1, null);
      if (re) findInPane(q, re);
    },
    preview: () => placePreview(text.path, lines, h.line, null),
    keep: { panel: 'search', arg: { q, scope: 'find' } },
  }));
  return { rows, count: hits.length > 0 ? plural(hits.length, 'match', 'matches') + (hits.length >= 500 ? ' or more' : '') : undefined, note: hits.length === 0 ? 'No matches.' : undefined, enter: seek };
}

/* ---------- = ---------- */

const filterCache = new WeakMap<object, { at: number; got: Awaited<ReturnType<typeof logFilterChoices>> | undefined }>();

function filterRows(q: string, pane: LinePane | null, env: ScopeEnv): ScopeResult {
  if (!pane?.path()) return { rows: [], note: NO_FILE };
  const kind = pane.content.detected()?.kind;
  if (kind === 'log' && pane.view.mode === 'rendered') {
    const kept = filterCache.get(pane.article);
    if (!kept || (kept.got !== undefined && Date.now() - kept.at > 1500)) {
      filterCache.set(pane.article, { at: Date.now(), got: kept?.got });
      void logFilterChoices().then((got) => {
        filterCache.set(pane.article, { at: Date.now(), got });
        env.refresh();
      });
    }
    const held = filterCache.get(pane.article)!.got;
    if (held === undefined) return { rows: [], note: 'Reading the log’s levels…' };
    if (held === null || held.levels.length === 0) return { rows: [], note: 'This log’s lines do not open with a level, so it has no levels to filter by.' };
    const rows: LineRow[] = [];
    for (const level of held.levels) {
      const m = q === '' ? { idx: [] as number[] } : fuzzy(q, level.title);
      if (!m) continue;
      rows.push({ key: `lvl:${level.id}`, group: 'Keep the lines at', title: level.title, marks: m.idx, detail: level.now ? 'now' : '', run: () => void level.choose() });
    }
    return { rows, note: rows.length === 0 ? 'Levels: all, info, warn, error.' : undefined };
  }
  // A table or records reading: the rows holding the words stay in the view (view/reading-filter.ts); the file is untouched.
  if (pane.view.mode === 'rendered' && readingTable(pane.article)) {
    const article = pane.article;
    const rows: LineRow[] = [];
    const on = rowFilterOf(article);
    if (on !== null) rows.push({ key: 'rows:off', group: `The rows now: holding “${on}”`, title: 'Show every row', run: () => void clearRowFilter(article) });
    // A long table is counted in the background, every row of it; the row's count comes when it is done.
    const held = q === '' ? null : rowsHolding(article, q, () => env.refresh());
    if (q !== '') rows.push({ key: 'rows:q', group: 'Keep the rows', title: `Holding “${q}”`, detail: held ? `${held.shown.toLocaleString('en-GB')} of ${held.total.toLocaleString('en-GB')} rows` : 'counting every row…', run: () => void keepRows(article, q, () => pane.path()) });
    return { rows, note: q === '' ? 'Type words: the rows holding them stay, in the view only. The file is untouched.' : undefined };
  }
  // A page of rows of its own (an archive's entries) keeps the rows matching, in the view only.
  const own = pane.view.viewer()?.rows;
  if (own && pane.view.mode === 'rendered') {
    const rows: LineRow[] = [];
    const on = own.on();
    if (on !== null) rows.push({ key: 'entries:off', group: `The entries now: matching “${on}”`, title: 'Show every entry', run: () => own.clear() });
    if (q === '') return { rows, note: 'Type words of a name, or name:, reading:picture, size>1mb, packed<10kb: the entries matching all of them stay, in the view only.' };
    const got = own.test(q);
    if ('error' in got) return { rows, note: got.error };
    if (got.shown === 0) return { rows, note: 'No entry matches that.' };
    rows.push({ key: 'entries:q', group: 'Keep the entries', title: `Matching “${q.trim()}”`, detail: `${got.shown.toLocaleString('en-GB')} of ${got.total.toLocaleString('en-GB')} ${got.words}`, run: () => void own.filter(q) });
    return { rows };
  }
  const viewer = pane.view.viewer()?.kind;
  const what = viewer === 'sqlite' ? 'A database' : viewer === 'sheet' ? 'A workbook' : kind === 'data' ? 'A table or records file' : 'This page';
  return { rows: [], note: `${what} has no row filter in Marxy yet; only a log filters its lines (by level). Sort and column facts are in a table’s own head.` };
}

/* ---------- ! ---------- */

const PREVIEW_MAX = 1024 * 1024;

/** The range of the document a transform runs on now: the selection's, else all of it. */
function txRange(ctx: AppContext, bytes: Uint8Array): { start: number; end: number; scope: string } {
  const sel = ctx.selection;
  if (sel.kind === 'text' && sel.src) return { start: sel.src.start, end: sel.src.end, scope: 'the selection' };
  if (sel.kind === 'node' || sel.kind === 'section' || sel.kind === 'blocks') {
    const input = ctx.operationInput();
    if (input) return { start: input.range.start, end: input.range.end, scope: 'the part under the cursor' };
  }
  return { start: 0, end: bytes.length, scope: 'the whole file' };
}

function txPreview(id: string, name: string, ctx: AppContext, pane: LinePane | null): Promise<LinePreview | null> {
  const store = pane?.content.store() ?? null;
  const path = pane?.path() ?? null;
  if (!store || path === null) return Promise.resolve(null);
  const snap = store.snapshot();
  const bytes = snap.buffer.bytes;
  if (bytes.length > PREVIEW_MAX) return Promise.resolve({ type: 'lines', head: name, lines: [], note: 'Too large to show the patch here; Enter still stages it, and the changes page (R) reads it.' });
  const r = txRange(ctx, bytes);
  const before = keepMark.decode(bytes.subarray(r.start, r.end));
  const chain = addStep(createChain(before, [], eolOf(snap.buffer.eol)), id);
  if (!canApply(chain)) return Promise.resolve({ type: 'lines', head: name, lines: [], note: `${name} makes new text from ${r.scope}; Enter shows it in the transform sheet, where it can be copied or opened.` });
  let after: string;
  try {
    after = output(chain, null);
  } catch (e) {
    return Promise.resolve({ type: 'lines', head: name, lines: [], note: `It could not run here: ${e instanceof Error ? e.message : String(e)}` });
  }
  const enc = new TextEncoder().encode(after);
  const whole = new Uint8Array(r.start + enc.length + (bytes.length - r.end));
  whole.set(bytes.subarray(0, r.start), 0);
  whole.set(enc, r.start);
  whole.set(bytes.subarray(r.end), r.start + enc.length);
  const changes = changesOf(path, bytes, whole);
  if (!changes || changes.patch === '') return Promise.resolve({ type: 'lines', head: 'Would change nothing', lines: [], note: `On ${r.scope}.` });
  const lines = changes.patch.split('\n').slice(2, 60).map((t) => ({ no: '', text: t, at: /^[+-]/.test(t), ...(t.startsWith('+') ? { sign: '+' as const } : t.startsWith('-') ? { sign: '-' as const } : {}) }));
  return Promise.resolve({ type: 'lines', head: `What it would change, on ${r.scope}`, lines, note: `${plural(changes.added, 'line')} added, ${plural(changes.removed, 'line')} removed. Enter stages it; nothing is written until you save.` });
}

function txRows(q: string, pane: LinePane | null, env: ScopeEnv): ScopeResult {
  if (!pane?.content.store()) return { rows: [], note: pane?.path() ? 'This page holds no text to change.' : NO_FILE };
  const ctx = env.ctx();
  const r = txRange(ctx, pane.content.store()!.snapshot().buffer.bytes);
  const group = r.scope === 'the whole file' ? 'On the whole file' : r.scope === 'the selection' ? 'On the selection' : 'On the part under the cursor';
  const rows: LineRow[] = [];
  const scored = TRANSFORMS.map((t, order) => ({ t, order, m: q === '' ? { idx: [] as number[], score: 0 } : fuzzy(q, t.name) }))
    .filter((x) => x.m !== null)
    .sort((a, b) => b.m!.score - a.m!.score || a.order - b.order);
  for (const { t, m } of scored) {
    rows.push({
      key: `tx:${t.id}`,
      group,
      title: t.name,
      marks: m!.idx,
      detail: t.group,
      run: () => void stageTransform(env.ctx(), t.id),
      preview: () => txPreview(t.id, t.name, env.ctx(), pane),
      keep: { panel: 'transforms', arg: { q, id: t.id } },
    });
  }
  return { rows, note: rows.length === 0 ? 'No transform is called that.' : undefined };
}

/* ---------- % ---------- */

function lensRows(q: string, pane: LinePane | null): ScopeResult {
  const lenses = lensesOf(pane);
  if (lenses.length === 0) return { rows: [], note: pane?.path() ? 'Lenses work on a text page read in Rendered.' : NO_FILE };
  const rows: LineRow[] = [];
  const on = lensOn(pane);
  if (on !== null) rows.push({ key: 'lens:off', group: `The lens now: ${on}`, title: 'Show everything', run: () => void clearLens(pane) });
  for (const l of lenses) {
    const m = q === '' ? { idx: [] as number[] } : fuzzy(q, l.label);
    if (!m) continue;
    rows.push({
      key: `lens:${l.id}`,
      group: 'It holds',
      title: l.label,
      marks: m.idx,
      detail: l.count,
      run: () => {
        setLens(focusedPane(), l.id as LensId, l.label);
      },
      keep: { panel: 'metadata', arg: { q, lens: l.id } },
    });
  }
  return { rows, note: rows.length === 0 ? 'No lens is called that.' : undefined };
}

/* ---------- ~ ---------- */

const versionsCache = new Map<string, { at: number; list: readonly ListedVersion[] | null }>();

function versionsOf(path: string, env: ScopeEnv): readonly ListedVersion[] | null {
  const held = versionsCache.get(path);
  if (held && (held.list === null || Date.now() - held.at < 5000)) return held.list;
  const recorder = versionRecorder();
  if (!recorder) return [];
  versionsCache.set(path, { at: Date.now(), list: held?.list ?? null });
  void recorder.store
    .list(path)
    .then((listing) => (listing.kind === 'ok' ? listing.versions.filter((v) => v.bytes === 'ok') : []))
    .catch(() => [] as ListedVersion[])
    .then((list) => {
      versionsCache.set(path, { at: Date.now(), list });
      env.refresh();
    });
  return held?.list ?? null;
}

function pairRows(q: string, pane: LinePane | null, env: ScopeEnv): ScopeResult {
  const here = pane?.path() ?? null;
  const store = pane?.content.store() ?? null;
  if (here === null) return { rows: [], note: NO_FILE };
  const rows: LineRow[] = [];
  const ctx = env.ctx();
  const handle = appHandle();
  const run = (id: string) => () => {
    const cmd = (handle?.commands() as readonly Command[] | undefined)?.find((c) => c.id === id);
    if (cmd) void cmd.run(ctx);
  };
  const snap = store?.snapshot();
  const earlier: { title: string; detail: string; run: () => void }[] = [];
  if (snap?.dirty) earlier.push({ title: 'The file on disk', detail: 'against your unsaved changes', run: run('compare.unsaved') });
  if (snap?.previousDisk) earlier.push({ title: 'The file before it last changed on disk', detail: 'against the file on disk now', run: run('compare.since-reload') });
  const versions = store ? versionsOf(here, env) : [];
  for (const v of versions ?? []) {
    earlier.push({
      title: `The copy kept ${keptWhen(v.time)}`,
      detail: v.reason,
      run: () =>
        void (async () => {
          const read = await versionRecorder()?.store.read(here, v.id);
          const now = pane?.content.store()?.snapshot();
          if (read?.kind === 'bytes' && now) await showVersionChanges(now, read.bytes, v.time);
          else ctx.showNotice('That copy could not be read.', { kind: 'refused' });
        })(),
    });
  }
  for (const [i, e] of earlier.entries()) {
    const m = q === '' ? { idx: [] as number[] } : fuzzy(q, e.title);
    if (m) rows.push({ key: `pe:${i}:${e.title}`, group: 'An earlier copy', title: e.title, marks: m.idx, detail: e.detail, run: e.run });
  }
  const dir = here.slice(0, Math.max(here.lastIndexOf('/'), here.lastIndexOf('\\')) + 1);
  const files = env
    .entries()
    .filter((e) => e.path !== here)
    .map((e) => ({ e, m: q === '' ? { idx: [] as number[], score: e.path.startsWith(dir) ? 1 : 0 } : fuzzy(q, e.path) }))
    .filter((x) => x.m !== null)
    .sort((a, b) => b.m!.score - a.m!.score || a.e.path.localeCompare(b.e.path))
    .slice(0, 12);
  for (const { e, m } of files) {
    rows.push({ key: `pf:${e.path}`, group: 'Another file', title: e.path, marks: m!.idx, detail: e.readerKind ?? e.kind, run: () => void compareTwoFiles(e.path, here, ctx.showNotice) });
  }
  return { rows, note: versions === null ? 'Looking for earlier copies…' : rows.length === 0 ? 'Nothing to compare with by that name.' : undefined };
}

/* ---------- & ---------- */

function hexRows(bytes: Uint8Array, rows = 16): LinePreview['lines'] {
  const out: { no: string; text: string }[] = [];
  for (let r = 0; r < rows && r * 16 < bytes.length; r++) {
    const row = bytes.subarray(r * 16, r * 16 + 16);
    const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...row].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    out.push({ no: (r * 16).toString(16).padStart(4, '0'), text: `${hex.padEnd(47)}  ${ascii}` });
  }
  return out;
}

function asRows(q: string, pane: LinePane | null, env: ScopeEnv): ScopeResult {
  const path = pane?.path() ?? null;
  if (path === null) return { rows: [], note: NO_FILE };
  const readings = readingsFor(path);
  if (readings.length === 0) return { rows: [], note: 'This page has no other reading.' };
  const bytes = pane?.content.store()?.snapshot().buffer.bytes ?? null;
  const entry = env.entries().find((e) => e.path === path) ?? null;
  const rows: LineRow[] = [];
  for (const r of readings) {
    const m = q === '' ? { idx: [] as number[] } : fuzzy(q, r.label);
    if (!m) continue;
    rows.push({
      key: `as:${r.id}`,
      group: r.group,
      title: r.label,
      marks: m.idx,
      detail: r.current ? `now${r.note ? ` · ${r.note}` : ''}` : r.note,
      run: () => void readAs(path, r.id, env.ctx()),
      keep: { panel: 'metadata', arg: { q, reading: r.id } },
      preview: async (): Promise<PreviewData | LinePreview | null> => {
        // A file that holds a private key is never previewed: not its head, not its store.
        if (pane?.content.viewer()?.bytesHidden) return { type: 'lines', head: `Read ${basename(path)} as ${r.label}`, lines: [], note: 'This file holds a private key: no preview. Never writes.' };
        const head = bytes ?? (await appHandle()?.shell.readHead(path, 4096).catch(() => null)) ?? null;
        if (head === null) return { type: 'lines', head: `Read ${basename(path)} as ${r.label}`, lines: [], note: 'Never writes.' };
        if (r.id === 'bytes') return { type: 'lines', head: `${basename(path)} as its bytes`, lines: hexRows(head), note: 'The file as it is stored, sixteen bytes to a row. Never writes.' };
        if (entry && bytes && r.id !== '' && r.id !== 'page') {
          return filePreview({ ...entry, readerKind: r.id as NonNullable<IndexEntry['readerKind']> }, bytes.subarray(0, 64 * 1024));
        }
        if (entry && bytes) return filePreview(entry, bytes.subarray(0, 64 * 1024));
        const lines = textLines(head).slice(0, 26).map((text, i) => ({ no: String(i + 1), text }));
        return { type: 'lines', head: `Read ${basename(path)} as ${r.label}`, lines, note: 'Never writes. The first row puts the reading back as it was found.' };
      },
    });
  }
  return { rows, note: rows.length === 0 ? 'No reading is called that.' : undefined };
}

/* ---------- ? ---------- */

function helpRows(env: ScopeEnv): ScopeResult {
  return {
    rows: SCOPES.map((s) => ({
      key: `help:${s.mark}`,
      group: 'What the first character means',
      title: `${s.mark}   ${s.label}`,
      detail: s.does,
      run: () => {
        env.setQuery(s.mark);
        return true;
      },
    })),
    note: 'With no character first: files, headings, open tabs, commands, and a written path:line.',
  };
}

/** The rows of `scope` for `q`, from the focused pane as it is now. */
export function scopeRows(scope: ScopeId, q: string, env: ScopeEnv): ScopeResult {
  const pane = focusedPane();
  switch (scope) {
    case 'outline':
      return outlineRows(q, pane);
    case 'goto':
      return gotoRows(q, pane);
    case 'find':
      return findRows(q, pane, env);
    case 'filter':
      return filterRows(q, pane, env);
    case 'tx':
      return txRows(q, pane, env);
    case 'lens':
      return lensRows(q, pane);
    case 'pair':
      return pairRows(q, pane, env);
    case 'as':
      return asRows(q, pane, env);
    case 'help':
      return helpRows(env);
    default:
      return { rows: [] };
  }
}
