// Transforms (the sixth panel): a list, grouped, and nothing else. A filter, and the one choice that matters:
// the selection or the whole file. Each row says how many lines it would change in this file, worked out after the list
// is drawn; one with nothing to do is grey. Resting the panel cursor on a row marks on the page (the spine and a quiet
// wash) the lines it would change; Enter stages it as one undo step, p shows its patch first, u undoes. Your commands
// are config.toml's, run as they always are: their output in the sheet, applied as one undo step.
import { fileTypeFor } from '@marxy/core/src/kind/registry.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { ReaderCommand } from '@marxy/theme';
import type { AppHandle } from '../../app-types.ts';
import { changesOf } from '../../changes/patch.ts';
import { COMMANDS_APP_ONLY, openReaderCommand } from '../../commands/transform.ts';
import { isArchiveEntry } from '../../document/entries.ts';
import type { ParsedText } from '@marxy/core';
import type { DocumentStore } from '../../document/store.ts';
import { isUntitled } from '../../document/untitled.ts';
import { chordText } from '../../frame/branch-info.ts';
import { runCommand } from '../../frame/branches/run.ts';
import { encodingSection } from '../../frame/encoding.ts';
import { anchorBelow, openMenu } from '../../frame/menu.ts';
import { spineMarks } from '../../frame/spine.ts';
import { notify } from '../../notices/index.ts';
import { lineSpan } from '../../selection/cursor.ts';
import { buildAppContext } from '../../selection/bind.ts';
import { readConfigNow } from '../../theme/live-config.ts';
import { minimalSplice, patchRows, utf8Of } from '../search-model.ts';
import { changedOld, drain, effectWords, groupsFor, INVISIBLE, invisibleCounts, removeInvisible, txRowFor, type Effect, type FileFamily, type LineSel, type Steps, type TxItem } from '../transforms-model.ts';
import type { PanelContext, PanelDef, Verb } from '../types.ts';
import { empty, fld, h, hint, hit, mono, row, sec, sg } from '../ui.ts';

export interface TransformsState {
  q: string;
  scope: 'sel' | 'whole';
  /** Effects worked out for one text and selection; the rest are worked out after the list is drawn. */
  fx: { key: string; readonly map: Map<string, Effect>; running?: { readonly id: string; readonly steps: Steps } };
  peek: string | null;
  /** The selection the list was drawn for: a new one draws it again. */
  drawn: string;
  commands: readonly ReaderCommand[] | null;
  working: boolean;
  offSel?: () => void;
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

interface Doc {
  readonly path: string;
  readonly store: DocumentStore;
  readonly text: string;
  readonly version: number;
  /** The store's parse of `text`, which every row that reads structure shares; null when the store has none to lend. */
  readonly parsed: ParsedText | null;
}

const docOf = (ctx: PanelContext<TransformsState>): Doc | null => {
  const d = ctx.doc();
  if (!d || isArchiveEntry(d.path)) return null;
  const snap = d.store.snapshot();
  const parsed = d.store.textParse();
  return { path: d.path, store: d.store, text: parsed?.text ?? decoder.decode(snap.buffer.bytes), version: snap.version, parsed };
};

/** The cursor's part as lines of the file, when the page has one. */
function cursorLines(handle: AppHandle, store: DocumentStore): (LineSel & { readonly start: number }) | null {
  if (handle.selection.runtime()?.buffer !== store.snapshot().buffer) return null;
  const sel = handle.selection.state().selection;
  const range = sel.kind === 'node' ? sel.node.src : sel.kind === 'section' || sel.kind === 'blocks' ? sel.range : null;
  if (!range) return null;
  const span = lineSpan(store.snapshot().buffer.bytes, range.start, range.end);
  return { a: span.first - 1, b: span.last, start: range.start };
}

const familyOf = (path: string): FileFamily => {
  const t = fileTypeFor(path);
  return isUntitled(path) || t.kind === 'markdown' ? 'markdown' : t.id === 'json' ? 'json' : 'other';
};

const selKey = (ctx: PanelContext<TransformsState>): string => {
  const d = ctx.doc();
  const c = d ? cursorLines(ctx.handle, d.store) : null;
  return `${d?.path ?? ''}|${c ? `${c.a}-${c.b}` : ''}`;
};

function effectOf(ctx: PanelContext<TransformsState>, doc: Doc, sel: LineSel | null, it: TxItem): Effect {
  const key = `${doc.path}|${doc.version}|${sel ? `${sel.a}-${sel.b}` : 'all'}`;
  if (ctx.st.fx.key !== key) ctx.st.fx = { key, map: new Map() };
  let e = ctx.st.fx.map.get(it.id);
  if (!e) {
    try {
      e = ctx.st.fx.running?.id === it.id ? drain(ctx.st.fx.running.steps) : it.fx(doc.text, sel, doc.parsed);
    } catch {
      e = { text: doc.text, c: 0, d: 0 };
    }
    ctx.st.fx.map.set(it.id, e);
    if (ctx.st.fx.running?.id === it.id) ctx.st.fx.running = undefined;
  }
  return e;
}

/**
 * The counts not yet known, worked out after the list is drawn, then the list again. Each row's work comes in pieces
 * (`steps`), and the budget is checked between pieces, so one row on a large file is many short tasks, not one long one.
 */
function workOut(ctx: PanelContext<TransformsState>, doc: Doc, sel: LineSel | null, items: readonly TxItem[]): void {
  if (ctx.st.working) return;
  ctx.st.working = true;
  const key = ctx.st.fx.key;
  const step = (): void => {
    if (ctx.st.fx.key !== key) {
      ctx.st.working = false;
      ctx.redraw();
      return;
    }
    const until = performance.now() + 12;
    let left = false;
    const fx = ctx.st.fx;
    for (const it of items) {
      if (fx.map.has(it.id)) continue;
      fx.running ??= { id: it.id, steps: it.steps(doc.text, sel, doc.parsed) };
      for (;;) {
        if (performance.now() > until) {
          left = true;
          break;
        }
        let r: IteratorResult<void, Effect>;
        try {
          r = fx.running.steps.next();
        } catch {
          r = { done: true, value: { text: doc.text, c: 0, d: 0 } };
        }
        if (r.done) {
          fx.map.set(it.id, r.value);
          fx.running = undefined;
          break;
        }
      }
      if (left) break;
    }
    if (left) setTimeout(step, 0);
    else {
      ctx.st.working = false;
      ctx.redraw();
    }
  };
  setTimeout(step, 0);
}

// ---- marks on the page while the panel cursor rests on a row ------------------------------------------------------

const WASH = 'data-marxy-tx-wash';
let marked: { readonly pane: ReturnType<AppHandle['panes']>['focused']; readonly els: Element[]; readonly k: string; readonly timer: ReturnType<typeof setInterval> } | null = null;

function unmark(): void {
  if (!marked) return;
  clearInterval(marked.timer);
  for (const el of marked.els) el.removeAttribute(WASH);
  spineMarks(marked.pane).set('transform', []);
  marked = null;
}

/** The byte each line of `bytes` starts at. */
function lineStarts(bytes: Uint8Array): number[] {
  const out = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a || (bytes[i] === 0x0d && bytes[i + 1] !== 0x0a)) out.push(i + 1);
  return out;
}

function markLines(handle: AppHandle, store: DocumentStore, lines: readonly number[], k: string): void {
  unmark();
  const pane = handle.panes().focused;
  if (lines.length === 0 || pane.content.store() !== store) return;
  const starts = lineStarts(store.snapshot().buffer.bytes);
  const ranges = lines.slice(0, 600).map((l) => ({ start: starts[l] ?? 0, end: starts[l + 1] ?? starts[l] ?? 0 }));
  spineMarks(pane).set('transform', ranges);
  const blocks = [...pane.view.host.article.querySelectorAll<HTMLElement>('[data-marxy-s]')].map((el) => ({ el, s: Number(el.dataset.marxyS), e: Number(el.dataset.marxyE) }));
  const els = new Set<Element>();
  for (const r of ranges.slice(0, 400)) {
    let best: (typeof blocks)[number] | null = null;
    for (const b of blocks) if (b.s <= r.start && r.start < Math.max(b.e, b.s + 1) && (!best || b.e - b.s < best.e - best.s)) best = b;
    if (best) els.add(best.el);
  }
  for (const el of els) el.setAttribute(WASH, '');
  const drawer = handle.frame().left.drawer;
  const timer = setInterval(() => {
    const cur = drawer.querySelector<HTMLElement>('.marxy-l-prow.marxy-l-cur');
    if (!drawer.contains(document.activeElement) || handle.frame().left.shown() !== 'transforms' || cur?.dataset.marxyLeftRow !== k || handle.panes().focused !== pane) unmark();
  }, 150);
  marked = { pane, els: [...els], k, timer };
}

// ---- staging ---------------------------------------------------------------------------------------------------------

async function freshDoc(ctx: PanelContext<TransformsState>): Promise<Doc | null> {
  if (ctx.handle.hasUnfoldedSource()) await ctx.handle.foldSource();
  return docOf(ctx);
}

interface Staged {
  /** Every edit this panel staged in the file; the store hands the same edit back on its undo and redo. */
  readonly ours: WeakSet<object>;
  /** Those staged and not undone since the file was last clean: what the rail's badge counts. */
  readonly live: Set<object>;
  mine: boolean;
}
const stagedIn = new WeakMap<DocumentStore, Staged>();

function stagedOf(store: DocumentStore): Staged {
  const known = stagedIn.get(store);
  if (known) return known;
  const t: Staged = { ours: new WeakSet(), live: new Set(), mine: false };
  store.subscribe((snap, change) => {
    if (change.kind === 'apply' && t.mine) {
      t.ours.add(change.edit);
      t.live.add(change.edit);
    } else if (change.kind === 'undo') t.live.delete(change.edit);
    else if (change.kind === 'redo' && t.ours.has(change.edit)) t.live.add(change.edit);
    if (!snap.dirty || change.kind === 'close') t.live.clear();
  });
  stagedIn.set(store, t);
  return t;
}

async function stage(ctx: PanelContext<TransformsState>, doc: Doc, next: string, label: string): Promise<void> {
  // A bad byte decodes to U+FFFD, three bytes: every splice offset after it would be off.
  if (utf8Of(doc.store.snapshot().buffer.bytes) === null) {
    notify({ kind: 'refused', text: `${basename(doc.path)} is not UTF-8 text here: “${label}” changed nothing.` });
    return;
  }
  const s = minimalSplice(doc.text, next);
  if (!s) {
    notify({ kind: 'info', text: `“${label}” changes nothing here.`, fades: true });
    return;
  }
  unmark();
  const at = cursorLines(ctx.handle, doc.store)?.start ?? null;
  let ok = false;
  const staged = stagedOf(doc.store);
  staged.mine = true;
  try {
    ok = await doc.store.apply({ range: { file: doc.path, start: s.start, end: s.end }, replacement: s.replacement, label, baseVersion: doc.version });
  } catch {
    ok = false;
  } finally {
    staged.mine = false;
  }
  if (!ok) {
    notify({ kind: 'refused', text: `The file changed while “${label}” was worked out. Nothing was changed; try again.` });
    return;
  }
  if (at !== null) ctx.handle.selection.cursorAt(Math.min(at, s.start));
  notify({ kind: 'done', text: `${label}: staged. ${chordText('Mod+S')} writes it, U undoes it, Shift R shows the patch.`, fades: true });
}

const selNow = (ctx: PanelContext<TransformsState>, doc: Doc): LineSel | null => (ctx.st.scope === 'sel' ? cursorLines(ctx.handle, doc.store) : null);

async function act(ctx: PanelContext<TransformsState>, it: TxItem): Promise<void> {
  const doc = await freshDoc(ctx);
  if (!doc) return;
  const sel = selNow(ctx, doc);
  if (!it.ask) {
    await stage(ctx, doc, it.fx(doc.text, sel, doc.parsed).text, it.label);
    return;
  }
  const found = invisibleCounts(doc.text, sel);
  const kinds = INVISIBLE.filter(([id]) => found[id]);
  if (kinds.length === 0) {
    notify({ kind: 'info', text: 'No invisible characters here. Trailing spaces have their own transform.', fades: true });
    return;
  }
  const at = ctx.handle.frame().left.drawer.querySelector('.marxy-l-prow.marxy-l-cur') ?? ctx.handle.frame().left.drawer;
  const all = kinds.reduce((n, [id]) => n + (found[id] ?? 0), 0);
  openMenu(anchorBelow(at), 'Remove which?', [
    ...kinds.map(([id, label]) => ({
      title: label,
      detail: String(found[id]),
      run: () => void stage(ctx, doc, removeInvisible(doc.text, sel, [id]).text, `Removed ${label.toLowerCase().replace(/, made plain spaces$/, ' (now plain spaces)')}`),
    })),
    ...(kinds.length > 1 ? [{ title: 'All of these', detail: String(all), run: () => void stage(ctx, doc, removeInvisible(doc.text, sel, kinds.map(([id]) => id)).text, 'Removed invisible characters') }] : []),
  ]);
}

const signed = (sign: '−' | '+', text: string): HTMLElement =>
  h('span', '', h('span', sign === '−' ? 'marxy-l-minus' : 'marxy-l-plus', sign), ' ', h(sign === '−' ? 'del' : 'ins', sign === '−' ? 'marxy-l-del' : 'marxy-l-ins', text || ' '));

/** The patch a row would stage (changes/patch.ts), its first ten lines. */
function peekRows(doc: Doc, e: Effect, body: HTMLElement): void {
  if (e.text === doc.text) {
    body.append(hit('', h('span', 'marxy-l-ui', 'Would change nothing')));
    return;
  }
  const c = changesOf(doc.path, encoder.encode(doc.text), encoder.encode(e.text));
  const rows: [string, '−' | '+', string][] = patchRows(c?.patch ?? '').map((r) => [String(r.no), r.sign === '-' ? '−' : '+', r.text]);
  for (const [no, sign, text] of rows.slice(0, 10)) body.append(hit(no, signed(sign, text)));
  if (rows.length > 10) body.append(hit('', h('span', 'marxy-l-ui', `${rows.length - 10} more ${rows.length - 10 === 1 ? 'line' : 'lines'} in the patch`)));
}

async function loadCommands(ctx: PanelContext<TransformsState>): Promise<void> {
  const config = await readConfigNow(ctx.handle);
  const next = config?.commands ?? [];
  if (ctx.st.commands !== null && JSON.stringify(next) === JSON.stringify(ctx.st.commands)) return;
  ctx.st.commands = next;
  ctx.redraw();
}

function undo(ctx: PanelContext<TransformsState>): void {
  const store = ctx.doc()?.store;
  if (store?.snapshot().canUndo) void store.undo();
  else notify({ kind: 'info', text: 'Nothing to undo in this file.', fades: true });
}

const panel: PanelDef<TransformsState> = {
  id: 'transforms',
  name: 'Transforms',
  field: true,
  rest: 'Tab comes here. Enter stages, P shows the patch first, U undoes.',
  init: () => ({ q: '', scope: 'whole', fx: { key: '', map: new Map() }, peek: null, drawn: '', commands: null, working: false }),
  take(ctx, arg) {
    // The Line's `!` keeps `{ q, id }` (core's transform id) or `{ q, scope: 'tx' }`.
    const a = typeof arg === 'string' ? { q: arg } : ((arg ?? {}) as { q?: unknown; id?: unknown });
    const item = typeof a.id === 'string' ? txRowFor(a.id) : null;
    if (typeof a.q === 'string') {
      const words = a.q.toLowerCase().split(/\s+/).filter(Boolean);
      // The Line's words are fuzzy: they filter here only where the row kept still passes them.
      ctx.st.q = !item || words.every((w) => `${item.label} ${item.id} ${item.group}`.toLowerCase().includes(w)) ? a.q : '';
    }
    if (item) ctx.cursorTo(`t:${item.id}`);
  },
  subject: (ctx) => basename(ctx.pane()?.path() ?? ''),
  badge(ctx) {
    const store = ctx.doc()?.store;
    const n = store ? (stagedIn.get(store)?.live.size ?? 0) : 0;
    return n > 0 ? { text: String(n), tone: 'accent', say: `${n} ${n === 1 ? 'change' : 'changes'} staged` } : null;
  },
  buttons: (ctx) =>
    ctx.doc()
      ? [
          {
            label: '⋯',
            icon: 'more',
            title: 'Undo, and the patch of what you have changed',
            run: (e) =>
              openMenu(anchorBelow(e.currentTarget as Element), 'Transforms', [
                { title: 'Undo the last change to this file', chord: 'u', run: () => undo(ctx) },
                { title: 'Read what you have changed', chord: 'Shift+R', run: () => void runCommand(ctx.handle, 'changes.read') },
              ]),
          },
        ]
      : [],
  render(ctx, body, top) {
    const { handle, st } = ctx;
    st.offSel ??= handle.selection.onChange(() => {
      if (handle.frame().left.shown() === 'transforms' && st.scope === 'sel' && selKey(ctx) !== st.drawn) ctx.redraw();
    });
    st.drawn = selKey(ctx);
    if (st.commands === null) void loadCommands(ctx);
    const pane = ctx.pane();
    const doc = docOf(ctx);
    if (!pane) {
      body.append(empty('Open a file, and what can change its text is listed here.'));
      return;
    }
    if (!doc) {
      const path = pane.path() ?? '';
      body.append(
        empty(
          isArchiveEntry(path)
            ? 'A file from inside another is only read here; nothing changes it.'
            : path.startsWith('marxy:')
              ? 'This page is the app’s own; it has no text to change.'
              : `${basename(path)} is only read here, as its bytes; nothing in it is changed.`,
        ),
      );
      return;
    }
    const cur = cursorLines(handle, doc.store);
    const sel = st.scope === 'sel' ? cur : null;
    top.append(
      fld({
        name: 'tx-q',
        placeholder: 'Filter transforms',
        value: st.q,
        right: sg([['sel', 'Selection'], ['whole', 'Whole file']], sel ? 'sel' : 'whole', (id) => {
          if (id === 'sel' && !cursorLines(handle, doc.store)) {
            notify({ kind: 'info', text: 'Select a part on the page first; Selection then acts on it alone.', fades: true });
            return;
          }
          st.scope = id as 'sel' | 'whole';
          st.peek = null;
          ctx.redraw();
        }, 'Apply to'),
        oninput: (v) => {
          st.q = v;
          ctx.redraw();
        },
      }),
    );
    if (sel) top.append(hint(sel.b - sel.a > 1 ? `On lines ${sel.a + 1} to ${sel.b}` : `On line ${sel.a + 1}`));

    const fxKey = `${doc.path}|${doc.version}|${sel ? `${sel.a}-${sel.b}` : 'all'}`;
    if (st.fx.key !== fxKey) st.fx = { key: fxKey, map: new Map() };
    const words = st.q.toLowerCase().split(/\s+/).filter(Boolean);
    const fits = (label: string, id: string, group: string): boolean => words.every((w) => `${label} ${id} ${group}`.toLowerCase().includes(w));
    const pending: TxItem[] = [];
    let first = true;
    for (const grp of groupsFor(familyOf(doc.path))) {
      const its = grp.items.filter((it) => fits(it.label, it.id, grp.group));
      if (its.length === 0) continue;
      body.append(sec(grp.group, first ? 'staged · the patch shows first' : '', first));
      first = false;
      for (const it of its) {
        const known = st.fx.map.get(it.id);
        if (!known) pending.push(it);
        const as = known ? (it.ask && known.c ? `${effectWords(known)} · asks which` : effectWords(known)) : '…';
        body.append(
          row({
            k: `t:${it.id}`,
            nm: it.label,
            as,
            cls: known && known.c === 0 ? 'dim' : '',
            what: it.label,
            go: it.ask ? 'choose' : 'stage',
            run: () => void act(ctx, it),
            enter: () => void act(ctx, it),
            at: () => {
              const d = docOf(ctx);
              if (!d) return unmark();
              if (st.peek && st.peek !== it.id) {
                st.peek = null;
                ctx.redraw();
              }
              const s = selNow(ctx, d);
              const e = effectOf(ctx, d, s, it);
              if (e.c === 0) return unmark();
              markLines(handle, d.store, changedOld(d.text, e.text), `t:${it.id}`);
            },
            verbs: (): (Verb | null)[] => [
              ['p', st.peek === it.id ? 'hide the patch' : 'peek the patch', () => {
                st.peek = st.peek === it.id ? null : it.id;
                ctx.redraw();
              }],
              ['u', 'undo the last change', () => undo(ctx)],
            ],
          }),
        );
        if (st.peek === it.id) peekRows(doc, effectOf(ctx, doc, sel, it), body);
      }
    }
    if (pending.length > 0) workOut(ctx, doc, sel, pending);

    const cmds = (st.commands ?? []).filter((c) => fits(c.name, c.run.join(' '), 'Your commands'));
    if (words.length === 0 || cmds.length > 0) {
      body.append(sec('Your commands', 'config.toml', first));
      first = false;
      const canStart = handle.shell.runCommand !== undefined;
      for (const c of cmds)
        body.append(
          row({
            k: `c:${c.name}`,
            nm: mono(c.name),
            as: c.prints ? 'prints' : 'rewrites',
            cls: canStart ? '' : 'dim',
            title: c.run.join(' '),
            what: c.name,
            go: c.prints ? 'print' : 'run',
            run: () => void openReaderCommand(buildAppContext(handle), c),
            enter: () => void openReaderCommand(buildAppContext(handle), c),
            verbs: () => [['u', 'undo the last change', () => undo(ctx)]],
          }),
        );
      if (st.commands !== null && st.commands.length === 0) body.append(hint('None yet. A [[command]] in config.toml names one: name, then run = ["fold", "-s", "-w", "72"].'));
      if (!canStart) body.append(hint(COMMANDS_APP_ONLY));
    }
    if (first) body.append(empty('No transform is called that.'));
    // Read with encoding… stays here, where the Reading card's link leads.
    if (words.length === 0) body.append(encodingSection(handle, doc.path, () => ctx.redraw()));
  },
};

export default panel;
