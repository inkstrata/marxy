// Outline (the third panel): the file's structure and a handle on it. A field filters. Markdown: the sections
// with their size, fold the page to level 1, 2, 3 or all, and a section moved by Alt+Up/Down or a drag (the outline's
// own move, staged, one undo step). A table: its columns, each sorting the view (never the file). A log: its strip of
// time, its levels and what was loud in it. A data tree: its keys, and how deep the page is opened. Other kinds: their
// parts. The row of the place the page is at carries the dot, and follows the page as it scrolls.
import type { Heading } from '@marxy/core';
import { readingOf, treeFromOf, type Reading } from '@marxy/core/src/reading/index.ts';
import { utf16ToByte } from '@marxy/core/src/buffer/buffer.ts';
import { fileTypeFor } from '@marxy/core/src/kind/registry.ts';
import { zoneName } from '@marxy/core/src/log/summary.ts';
import { logStamp } from '@marxy/core/src/log/head.ts';
import { plural, segmented } from '../../frame/dom.ts';
import { logZoneOn, setLogZone } from '../../proposals/log-zone.ts';
import { proposalOn } from '../../proposals/state.ts';
import { setLogLevel } from '../../commands/log.ts';
import { depthsOf, setFoldsOn } from '../../depths/dress.ts';
import { foldTreeTo } from '../../parts/tree-folds.ts';
import { anchorBelow, openMenu } from '../../frame/menu.ts';
import { outlineModelFor, runOutlineAction, type HeadingRow, type OutlineAction } from '../../frame/model/outline.ts';
import { levelOf, LEVELS } from '../../kinds/log-filter.ts';
import { notify } from '../../notices/index.ts';
import { partsOf } from '../../parts/cursor.ts';
import { drawTreeFrom } from '../../view/tree-from.ts';
import { linesViewIn, markdownHeadings } from '../../view/reading-lines.ts';
import { SCANNED_HEADINGS_MAX } from '@marxy/core/src/reading/heading-scan.ts';
import { OUTLINE_MAX } from '@marxy/core/src/outline/outline.ts';
import type { ReadingLines } from '@marxy/core/src/reading/lines.ts';
import type { PartTree, PartUnit, ViewerOutline } from '../../viewers/types.ts';
import { byteSplice, foldedLevel, lastAtOrBefore, logShapeFor, sectionRows, siblingsOf, timeStrip, type LogShape, type SectionRow } from '../doc-model.ts';
import { cardContext, copyText, depthTarget, emptyFor, followSignals, goByte, hostCard, hostedFor, subjectOf, type HostedCards } from '../doc-shared.ts';
import { mayRead } from '../painted.ts';
import { clearRowFilter, filterRows, readingTable, rowFilterOf, rowsHolding } from '../../view/reading-filter.ts';
import type { PanelContext, PanelDef, PaneView, RowEvent } from '../types.ts';
import { empty, fld, h, hint, lab, mark, row, scrollWithin, sec, sg, tool } from '../ui.ts';
import { describeRow } from '../aria.ts';
import { WINDOW_FROM, windowOf, windowRows, type RowWindow } from '../row-window.ts';
import { appendAll, maxOf, minOf } from '@marxy/core/src/util/spread.ts';

export interface OutlineState {
  q: string;
  /** Rows folded in the panel (not on the page), by path and key. */
  readonly shut: Set<string>;
  offs?: () => void;
  /** Where each marked row starts, by its key, for `light`. */
  starts: Map<string, number>;
  /** Where each row of a list drawn a window at a time starts, in the window's order, for `light`. */
  order?: number[];
  /** The key of the row last marked current: the panel follows the page only when the mark moves to another row. */
  at?: string | null;
  /** Units of a viewer's or a reading's parts, by row key, for `light`. */
  units: Map<string, PartUnit>;
  /** The parts tree the unit rows were drawn from. */
  tree?: PartTree;
  drag?: { readonly key: string; readonly path: string } | null;
  slot?: { readonly row: SectionRow; readonly to: number; readonly sibs: SectionRow[] } | null;
  ins?: HTMLElement;
  hosted?: HostedCards;
  memo?: { sig: string; rows: SectionRow[]; heads: HeadingRow[]; capped: boolean };
  /** A data tree's depth as last chosen, by path. */
  depth: Map<string, string>;
  /** The Line's `@` result kept here (Tab): a heading by its first byte, or a kind's part by its id; shown even if the filter would not. */
  keep?: { readonly at?: number; readonly unit?: string };
}

type Ctx = PanelContext<OutlineState>;

const nf = (n: number): string => n.toLocaleString('en-GB');
/** A row's text takes its own direction, as the page's blocks do. */
const own = (el: HTMLElement): HTMLElement => {
  el.dir = 'auto';
  return el;
};
const words = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);
const hits = (qs: readonly string[], ...texts: string[]): boolean => qs.every((w) => texts.some((t) => t.toLowerCase().includes(w)));

// ---- Markdown -----------------------------------------------------------------------------------------------------

function mdRows(ctx: Ctx, pane: PaneView): { rows: SectionRow[]; heads: HeadingRow[]; capped: boolean } {
  const store = pane.content.store()!;
  const snap = store.snapshot();
  const sig = `${pane.path()}:${snap.version}`;
  if (ctx.st.memo?.sig === sig) return ctx.st.memo;
  const model = outlineModelFor(snap.ast, snap.buffer);
  const heads = model.rows.filter((r): r is HeadingRow => r.kind === 'heading');
  const rows = sectionRows(heads.map((r) => ({ text: r.text, level: r.level, start: r.start, end: r.end, words: r.words })));
  ctx.st.memo = { sig, rows, heads, capped: model.capped };
  return ctx.st.memo;
}

function headingsAt(pane: PaneView, level: number): Heading[] {
  const ast = pane.content.store()?.snapshot().ast;
  if (!ast) return [];
  return ast.children.filter((b): b is Heading => b.type === 'heading' && b.level === level);
}

async function foldPage(ctx: Ctx, pane: PaneView, lv: string): Promise<void> {
  if (pane.view.mode === 'source') await ctx.handle.toggleMode();
  setFoldsOn(depthTarget(pane), lv === 'all' ? [] : headingsAt(pane, Number(lv)));
  notify({ kind: 'info', fades: true, text: lv === 'all' ? 'Unfolded' : `Folded to level ${lv} headings. Nothing in the file changed.` });
  ctx.redraw();
}

/** The section of `row` traded with its sibling, staged in the store: one undo step, nothing written. */
async function moveOne(ctx: Ctx, pane: PaneView, row: SectionRow, action: OutlineAction): Promise<boolean> {
  const store = pane.content.store();
  if (!store) return false;
  const r = await runOutlineAction(ctx.handle, store, row.start, action);
  return r.applied;
}

/**
 * A drag: the section moved past its siblings by the outline's own move, repeated, then made one undo step: the moves are
 * taken back and their whole result applied as one splice of the bytes that differ.
 */
async function moveTo(ctx: Ctx, pane: PaneView, row: SectionRow, to: number, sibs: readonly SectionRow[]): Promise<void> {
  const store = pane.content.store();
  if (!store) return;
  const i = sibs.findIndex((s) => s.start === row.start);
  const n = to > i ? to - i - 1 : i - to;
  if (i < 0 || n <= 0) return;
  const action: OutlineAction = to > i ? 'move-down' : 'move-up';
  const before = store.snapshot().buffer.bytes;
  let start = row.start;
  let done = 0;
  for (; done < n; done++) {
    const r = await runOutlineAction(ctx.handle, store, start, action);
    if (!r.applied) break;
    start = r.start;
  }
  if (done === 0) return;
  if (done > 1) {
    const after = store.snapshot().buffer.bytes;
    const s = byteSplice(before, after);
    for (let k = 0; k < done; k++) await store.undo();
    let ok = false;
    try {
      ok = s !== null && (await store.apply({ range: { file: store.snapshot().path, start: s.start, end: s.end }, replacement: s.replacement, label: 'Move section', baseVersion: store.snapshot().version }));
    } catch {
      // Put back below.
    }
    if (!ok) {
      // The one splice was refused: the moves are taken forward again, each its own undo step, so nothing is lost.
      for (let k = 0; k < done; k++) await store.redo();
      notify({ kind: 'info', fades: true, text: `Moved “${row.text}” in ${done} steps: U puts it back one step at a time.` });
      return;
    }
  }
  const other = to > i ? sibs[Math.min(to, sibs.length) - 1]! : sibs[to]!;
  notify({ kind: 'done', fades: true, text: `Moved “${row.text}” ${to > i ? 'below' : 'above'} “${other.text}”, with what is under it. Staged, not written; U puts it back.` });
}

/** Puts a drop line before the row at place `t` of the rows listed (after the last, at the list's length). */
type PutLine = (ins: HTMLElement, t: number) => void;

function wireDrag(ctx: Ctx, pane: PaneView, el: HTMLElement, r: SectionRow, rows: readonly SectionRow[], placeOf: ReadonlyMap<string, number>, put: PutLine, win: RowWindow | null): void {
  const st = ctx.st;
  const path = pane.path()!;
  el.draggable = true;
  // The drawer keeps focus by cancelling mousedown on a row, and a drag cannot start through that.
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('dragstart', (e) => {
    st.drag = { key: r.key, path };
    // Kept drawn while it is dragged, however far the list scrolls under the drag.
    win?.mark('marxy-l-dragging', `h:${r.key}`, true);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', r.text);
      } catch {
        // Some engines refuse data on a synthetic drag; the move does not need it.
      }
    }
    el.classList.add('marxy-l-dragging');
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('marxy-l-dragging');
    win?.mark('marxy-l-dragging', null);
    st.drag = null;
    st.slot = null;
    st.ins?.remove();
  });
  const slotFor = (e: DragEvent): { row: SectionRow; to: number; sibs: SectionRow[] } | null => {
    const d = st.drag && st.drag.path === path ? rows.find((x) => x.key === st.drag!.key) : undefined;
    if (!d) return null;
    const sibs = siblingsOf(rows, d);
    // The row under the pointer, or the sibling whose section holds it.
    let a: SectionRow | undefined = r;
    while (a && !sibs.includes(a)) a = rows.find((x) => x.start === a!.parent);
    if (!a) return null;
    const box = el.getBoundingClientRect();
    const top = a === r && e.clientY < box.top + box.height / 2;
    return { row: d, sibs, to: sibs.indexOf(a) + (top ? 0 : 1) };
  };
  const drop = (): void => {
    const s = st.slot;
    st.ins?.remove();
    st.slot = null;
    st.drag = null;
    if (s) void moveTo(ctx, pane, s.row, s.to, s.sibs);
  };
  const place = (s: { row: SectionRow; to: number; sibs: SectionRow[] }): void => {
    const ins = (st.ins ??= h('div', 'marxy-l-dropline'));
    ins.ondragover = (e) => {
      if (st.slot) e.preventDefault();
    };
    ins.ondrop = (e) => {
      e.preventDefault();
      drop();
    };
    let t = -1;
    if (s.to < s.sibs.length) t = placeOf.get(s.sibs[s.to]!.key) ?? -1;
    else {
      const last = s.sibs[s.sibs.length - 1]!;
      const li = rows.indexOf(last);
      let end = -1;
      for (let q = li; q < rows.length && (q === li || rows[q]!.level > last.level); q++) end = placeOf.get(rows[q]!.key) ?? end;
      if (end >= 0) t = end + 1;
    }
    if (t >= 0) put(ins, t);
    ins.style.marginLeft = `${25 + s.row.depth * 13}px`;
  };
  el.addEventListener('dragover', (e) => {
    const s = slotFor(e);
    if (!s) {
      st.slot = null;
      st.ins?.remove();
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    st.slot = s;
    place(s);
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    drop();
  });
}

function renderMarkdown(ctx: Ctx, pane: PaneView, body: HTMLElement, top: HTMLElement): void {
  const { handle, st } = ctx;
  const path = pane.path()!;
  const { rows, heads, capped } = mdRows(ctx, pane);
  const qs = words(st.q);
  const folds = depthsOf(pane.article).folds.map((f) => f.start);
  const right = h('span', 'marxy-l-v', sg(['1', '2', '3', 'all'], foldedLevel(heads, folds) ?? '', (lv) => void foldPage(ctx, pane, lv), 'Fold to level'));
  top.append(fld({ name: 'outline-q', placeholder: 'Filter headings', value: st.q, right, oninput: (v) => {
    st.q = v;
    ctx.redraw();
  } }));
  if (rows.length === 0) {
    body.append(empty('No headings in this document, so it has no sections to list. The Line (Ctrl K) still reaches any line.'));
    return;
  }
  // A changelog's sections are its releases, as its contents card was named.
  if (pane.kind() === 'changelog') body.append(sec('Releases', capped ? `the first ${nf(OUTLINE_MAX)}` : ''));
  else if (capped) body.append(sec('Headings', `the first ${nf(OUTLINE_MAX)}`));
  st.starts.clear();
  let hideBelow = Number.POSITIVE_INFINITY;
  const shutKey = (r: SectionRow): string => `${path}#${r.key}`;
  const keepAt = st.keep?.at;
  const shown: SectionRow[] = [];
  for (const r of rows) {
    if (qs.length > 0) {
      if (!hits(qs, r.text) && r.start !== keepAt) continue;
    } else {
      if (r.level > hideBelow) continue;
      hideBelow = st.shut.has(shutKey(r)) ? r.level : Number.POSITIVE_INFINITY;
    }
    shown.push(r);
    st.starts.set(`h:${r.key}`, r.start);
  }
  const placeOf = new Map(shown.map((r, i) => [r.key, i]));
  const make = (r: SectionRow): HTMLElement => {
    const open = !st.shut.has(shutKey(r));
    const go = (e?: RowEvent): void => void goByte(handle, path, r.start, e?.beside);
    const on = (action: OutlineAction) => (): void => void moveOne(ctx, pane, r, action);
    return row({
      k: `h:${r.key}`,
      d: r.depth,
      tw: qs.length ? '' : r.kids ? (open ? '▾' : '▸') : '',
      nm: own(mark(r.text || '(untitled)', qs)),
      bar: r.bar,
      n: r.words,
      cls: r.depth >= 2 ? 'sub' : '',
      title: `${r.text} · ${plural(r.words, 'word')}`,
      ...(r.kids && !qs.length
        ? { open, toggle: () => {
            if (open) st.shut.add(shutKey(r));
            else st.shut.delete(shutKey(r));
            ctx.redraw();
          } }
        : {}),
      go: 'go',
      what: r.text,
      run: go,
      verbs: () => [
        ['Alt+ArrowUp', 'move up', on('move-up')],
        ['Alt+ArrowDown', 'move down', on('move-down')],
        ['<', 'promote', on('promote')],
        ['>', 'demote', on('demote')],
        ['z', 'fold on the page', () => {
          const now = new Set(depthsOf(pane.article).folds.map((f) => f.start));
          if (now.has(r.start)) now.delete(r.start);
          else now.add(r.start);
          const ast = pane.content.store()?.snapshot().ast;
          setFoldsOn(depthTarget(pane), (ast?.children ?? []).filter((b): b is Heading => b.type === 'heading' && now.has(b.src.start)));
        }],
        ['c', 'copy the section', () => {
          const bytes = pane.content.store()?.snapshot().buffer.bytes;
          if (bytes) copyText(handle, new TextDecoder().decode(bytes.subarray(r.start, r.end)), `Copied “${r.text}” as written`);
        }],
        ['u', 'undo', () => void pane.content.store()?.undo()],
      ],
    });
  };
  const drags = qs.length === 0;
  st.order = undefined;
  if (shown.length >= WINDOW_FROM) {
    // Thousands of sections: only the rows near the panel's view are drawn (row-window.ts).
    let win: RowWindow | null = null;
    const put: PutLine = (ins, t) => {
      if (!win) return;
      ins.style.top = `${win.top(t)}px`;
      if (ins.parentElement !== win.el) win.el.append(ins);
    };
    win = windowRows(body, {
      keys: shown.map((r) => `h:${r.key}`),
      depths: shown.map((r) => r.depth),
      // A nested row's name is set smaller (`sub`), and its row is shorter.
      shapes: shown.map((r) => (r.depth >= 2 ? 'sub' : '')),
      make: (i) => {
        const r = shown[i]!;
        const el = make(r);
        if (drags) wireDrag(ctx, pane, el, r, rows, placeOf, put, win);
        return el;
      },
      describe: (el, nests) => describeRow(el, nests),
    });
    st.order = shown.map((r) => r.start);
  } else {
    const els = shown.map(make);
    appendAll(body, els);
    const put: PutLine = (ins, t) => {
      if (t < els.length) els[t]!.before(ins);
      else els[els.length - 1]?.after(ins);
    };
    if (drags) shown.forEach((r, i) => wireDrag(ctx, pane, els[i]!, r, rows, placeOf, put, null));
  }
  if (keepAt !== undefined) {
    st.keep = undefined;
    const kept = shown.find((r) => r.start === keepAt);
    if (kept) ctx.cursorTo(`h:${kept.key}`);
  }
  if (shown.length === 0) body.append(empty('No heading has those words.'));
  markAt(ctx, body);
}

// ---- a table ---------------------------------------------------------------------------------------------------------

function renderColumns(ctx: Ctx, pane: PaneView, reading: Reading, body: HTMLElement, top: HTMLElement): void {
  const { st } = ctx;
  const items = reading.contents?.items ?? [];
  const qs = words(st.q);
  top.append(fld({ name: 'outline-q', placeholder: 'Filter columns', value: st.q, right: h('span', 'marxy-l-v', plural(items.length, 'column')), oninput: (v) => {
    st.q = v;
    ctx.redraw();
  } }));
  // The rows holding these words stay in the view (the Line's `=` drives the same filter); the file is untouched.
  if (readingTable(pane.article)) {
    const kept = rowFilterOf(pane.article);
    const counted = kept === null ? null : rowsHolding(pane.article, kept, () => ctx.redraw());
    body.append(
      fld({
        name: 'outline-rows',
        placeholder: 'Rows holding…',
        value: kept ?? '',
        right: counted ? h('span', 'marxy-l-v', `${counted.shown} of ${counted.total}`) : null,
        oninput: (v) => {
          if (v.trim() === '') clearRowFilter(pane.article);
          else void filterRows(pane.article, v, () => pane.path()).then(() => ctx.redraw());
          ctx.redraw();
        },
      }),
    );
  }
  body.append(sec(reading.contents?.title ?? 'Columns', 'the view only'));
  const header = (i: number): HTMLElement | null => pane.article.querySelector<HTMLElement>(`.marxy-reading-table th[data-marxy-sort="${i}"]`);
  items.forEach((item, i) => {
    if (qs.length && !hits(qs, item.text)) return;
    const th = header(i);
    const sorted = th?.getAttribute('aria-sort');
    const sort = (): void => {
      const cell = header(i);
      if (!cell) {
        notify({ kind: 'info', fades: true, text: 'Sorting is on the table as it is shown in Read.' });
        return;
      }
      cell.click();
      ctx.redraw();
    };
    body.append(
      row({
        k: `c:${i}`,
        nm: mark(item.text || '(empty)', qs),
        as: `${sorted === 'ascending' ? '↑ sorted · ' : sorted === 'descending' ? '↓ sorted · ' : ''}${item.sub}`,
        cls: sorted ? 'sel' : '',
        what: item.text,
        go: sorted ? 'sort the other way, then back' : 'sort',
        run: sort,
        verbs: () => [['S', 'sort', sort], ['c', 'copy its name', () => copyText(ctx.handle, item.text, `Copied ${item.text}`)]],
      }),
    );
  });
  body.append(hint('Sorting changes what you see. The file is never reordered.'));
}

// ---- a log -----------------------------------------------------------------------------------------------------------

const LEVEL_WORDS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

function renderLog(ctx: Ctx, pane: PaneView, shape: LogShape | null, body: HTMLElement, top: HTMLElement): void {
  const { handle, st } = ctx;
  const path = pane.path()!;
  const buffer = pane.content.store()!.snapshot().buffer;
  if (shape === null) {
    body.append(empty('Reading the log…'));
    return;
  }
  const { summary: s, timed } = shape;
  const byteOf = (at: number): number => (shape.byByte ? at : utf16ToByte(buffer, at));
  const qs = words(st.q);
  const total = s.counts.reduce((a, b) => a + b, 0);
  top.append(fld({ name: 'outline-q', placeholder: 'Filter what is listed', value: st.q, right: h('span', 'marxy-l-v', plural(total, 'entry', 'entries')), oninput: (v) => {
    st.q = v;
    ctx.redraw();
  } }));
  // The strip of time: a bar per step, errors marked; a bar goes to its first entry.
  const strip = timeStrip(timed);
  if (strip && !qs.length) {
    const max = maxOf(strip.buckets.map((b) => b.count), 1);
    const hm = (t: string): string => logStamp(t).clock.slice(0, 5);
    const hist = h('div', 'marxy-l-hist');
    for (const b of strip.buckets) {
      const u = h('u', b.errors ? 'marxy-l-e' : '');
      u.style.height = `${Math.round((b.count / max) * 100)}%`;
      u.title = b.first ? `${b.first.time} · ${plural(b.count, 'entry', 'entries')}${b.errors ? `, ${plural(b.errors, 'error')}` : ''}` : 'nothing';
      const first = b.first;
      if (first) u.addEventListener('click', () => void goByte(handle, path, byteOf(first.at)));
      hist.append(u);
    }
    body.append(sec(`${hm(timed[0]!.time)} to ${hm(timed[timed.length - 1]!.time)}`, 'click to go'), hist);
  }
  // The times as written, or in the reader's zone (the log_zone proposal), as the Levels card offered.
  if (proposalOn('log_zone') && s.zoned && s.first) {
    const zone = zoneName(-new Date(Date.parse(s.first.replace(' ', 'T'))).getTimezoneOffset());
    const local = logZoneOn(pane.article);
    body.append(tool(lab('Times'), segmented<'written' | 'zone'>('Times', [['written', 'as written'], ['zone', `in your zone, ${zone}`]], local ? 'zone' : 'written', (v) => {
      setLogZone(pane.article, v === 'zone');
      ctx.redraw();
    })));
  }
  body.append(sec('Levels', 'the view only'));
  const max = maxOf(s.counts, 1);
  s.counts.forEach((n, rank) => {
    if (n === 0) return;
    const level = LEVELS[rank]!;
    const id = LEVEL_WORDS[rank]!.toLowerCase();
    if (qs.length && !hits(qs, id)) return;
    body.append(
      row({
        k: `lv:${id}`,
        nm: h('span', `marxy-l-lv marxy-l-lv${rank}`, LEVEL_WORDS[rank]!),
        bar: n / max,
        n,
        what: `${LEVEL_WORDS[rank]} · ${plural(n, 'entry', 'entries')}`,
        go: rank === 0 ? 'show every line' : `show ${level.label.toLowerCase()} and above`,
        run: () => void setLogLevel(levelOf(level.id)),
      }),
    );
  });
  if (s.notable.length > 0) {
    body.append(sec('Warnings and errors', s.notableTotal > s.notable.length ? `${nf(s.notable.length)} of ${nf(s.notableTotal)}` : ''));
    s.notable.forEach((e, i) => {
      const text = e.text.replace(/\u001b\[[\d;]*m/g, '');
      if (qs.length && !hits(qs, text, e.level)) return;
      body.append(row({ k: `e:${i}`, nm: h('span', '', h('span', `marxy-l-lv marxy-l-lv${e.rank}`, e.level), ` ${text}`), pv: e.time === '' ? '' : logStamp(e.time).clock.slice(0, 8), title: `${e.level} ${text}`, what: e.level, go: 'go', run: (ev) => void goByte(handle, path, byteOf(e.at), ev?.beside) }));
    });
  }
  if (s.escapes > 0) body.append(hint(`${plural(s.escapes, 'escape code')} in the file, hidden and drawn as colour; X-ray shows them.`));
}

// ---- a reading's contents (keys, stanzas, releases), and parts ---------------------------------------------------------

function renderContents(ctx: Ctx, pane: PaneView, reading: Reading, body: HTMLElement, top: HTMLElement): void {
  const { handle, st } = ctx;
  const path = pane.path()!;
  const items = reading.contents?.items ?? [];
  const qs = words(st.q);
  const tree = reading.id === 'tree';
  const right = tree
    ? h('span', 'marxy-l-v', sg(['1', '2', '3', 'all'], st.depth.get(path) ?? '', (n) => {
        st.depth.set(path, n);
        // The tree's one fold state, shared with z, Z and the depth commands. Its depth 1 closes the top level, so
        // Outline's 1 (the top level open) is its 2.
        foldTreeTo(pane.article, path, n === 'all' ? null : Number(n) + 1);
        ctx.redraw();
      }, 'Fold to level'))
    : h('span', 'marxy-l-v', plural(items.length, 'row'));
  top.append(fld({ name: 'outline-q', placeholder: `Filter ${(reading.contents?.title ?? 'parts').toLowerCase()}`, value: st.q, right, oninput: (v) => {
    st.q = v;
    ctx.redraw();
  } }));
  if (items.length === 0) {
    body.append(empty('Nothing in it to list as parts.'));
    return;
  }
  body.append(sec(reading.contents?.title ?? 'Parts', [reading.contents?.detail ?? '', tree ? 'the page opened to a depth' : ''].filter(Boolean).join(' · ')));
  st.starts.clear();
  let n = 0;
  items.forEach((item, i) => {
    if (qs.length && !hits(qs, item.text, item.sub)) return;
    n++;
    const from = item.from === undefined ? null : treeFromOf(item.from);
    const k = `o:${i}`;
    st.starts.set(k, item.byte);
    body.append(
      row({
        k,
        nm: own(mark(item.text || '(empty)', qs)),
        as: item.sub,
        cls: item.tone === 'code' ? 'sub' : '',
        title: from ? `Draw the tree from ${item.text || 'here'}` : item.text,
        what: item.text,
        go: from ? 'draw the tree from here' : 'go',
        run: (e) => (from ? drawTreeFrom(pane.host, path, from) : void goByte(handle, path, item.byte, e?.beside)),
      }),
    );
  });
  if (n === 0) body.append(empty('Nothing here has those words.'));
  markAt(ctx, body);
}

// ---- big Markdown read as lines ------------------------------------------------------------------------------------

/** The most rows the scanned Outline draws at once. */
const SCANNED_ROWS = 1000;
/** Fewer rows than this at the levels that fit is no contents: the first rows are listed instead. */
const SCANNED_FEWEST = 20;

/** A big Markdown file's headings from the scan of its lines: each goes to its line. Show rendered gives the full outline. */
function renderScanned(ctx: Ctx, pane: PaneView, lines: ReadingLines, body: HTMLElement, top: HTMLElement): void {
  const { handle, st } = ctx;
  const path = pane.path()!;
  // Heard only while this pane still shows these lines: a panel moved on to another file is not drawn again for it.
  const found = markdownHeadings(lines, () => {
    if (pane.path() === path && readingOf(path, pane.content.store()?.snapshot().buffer.bytes ?? new Uint8Array(), pane.kind())?.lines === lines) ctx.redraw();
  });
  const qs = words(st.q);
  top.append(fld({ name: 'outline-q', placeholder: 'Filter headings', value: st.q, right: h('span', 'marxy-l-v', found ? plural(found.items.length, 'heading') : ''), oninput: (v) => {
    st.q = v;
    ctx.redraw();
  } }));
  if (found === null) {
    body.append(empty('Finding the headings…'));
    return;
  }
  if (found.items.length === 0) {
    body.append(empty('No headings in this document. Find and the Line (Ctrl K) still reach any line.'));
    return;
  }
  const least = found.items.reduce((m, x) => Math.min(m, x.level), 6);
  // A panel of tens of thousands of rows takes seconds to draw, and draws again as the page moves: past SCANNED_ROWS the
  // deepest levels that fit are listed (or, when those are too few to be a contents, the first rows), and the field
  // reaches every heading.
  let upTo = 6;
  let listed = found.items.length;
  if (qs.length === 0 && listed > SCANNED_ROWS) {
    const perLevel = [0, 0, 0, 0, 0, 0, 0];
    for (const x of found.items) perLevel[x.level]!++;
    let sum = 0;
    upTo = least - 1;
    for (let lv = least; lv <= 6 && sum + perLevel[lv]! <= SCANNED_ROWS; lv++) {
      sum += perLevel[lv]!;
      upTo = lv;
    }
    if (sum < SCANNED_FEWEST) upTo = 6;
    listed = upTo === 6 ? SCANNED_ROWS : sum;
  }
  const said = [found.capped ? `the first ${nf(SCANNED_HEADINGS_MAX)}` : '', 'found by a scan of the lines'];
  if (qs.length === 0 && listed < found.items.length) said.push(upTo < 6 ? `levels to ${upTo} here, filter for the rest` : `the first ${nf(listed)} here, filter for the rest`);
  body.append(sec('Headings', said.filter(Boolean).join(' · ')));
  let n = 0;
  found.items.forEach((item, i) => {
    if (n >= SCANNED_ROWS || item.level > upTo) return;
    if (qs.length && !hits(qs, item.text)) return;
    n++;
    const k = `s:${i}`;
    st.starts.set(k, item.start);
    const depth = qs.length ? 0 : item.level - least;
    body.append(
      row({
        k,
        d: depth,
        nm: own(mark(item.text || '(untitled)', qs)),
        cls: depth >= 2 ? 'sub' : '',
        title: `${item.text} · line ${nf(item.line + 1)}`,
        what: item.text,
        go: 'go',
        run: (e) => {
          // The lines on the page go to the line themselves: the Markdown cursor a place sets would parse the whole file.
          const shown = !e?.beside && pane.view.mode === 'rendered' ? linesViewIn(pane.article) : null;
          if (shown?.lines === lines) shown.showByte(item.start);
          else void goByte(handle, path, item.start, e?.beside);
        },
      }),
    );
  });
  if (n === 0) body.append(empty('No heading has those words.'));
  // The first rows only: past the last one the dot stays on it (`markAt`), and the list says it stops there.
  if (qs.length === 0 && upTo === 6 && listed < found.items.length) {
    const last = found.items[listed - 1]!;
    body.append(hint(`The list stops at “${last.text || '(untitled)'}”, line ${nf(last.line + 1)}. Past it the dot stays on that row; filter to reach the ${nf(found.items.length - listed)} headings after it.`));
  }
  if (pane.view.mode === 'rendered') body.append(hint('Shown as lines by its size. Show rendered (g r) draws the page, and lists its sections in full.'));
  markAt(ctx, body);
}

function renderParts(ctx: Ctx, pane: PaneView, body: HTMLElement, top: HTMLElement, word: string): boolean {
  const { st } = ctx;
  const tree = partsOf(pane);
  const units = tree?.top() ?? [];
  if (!tree || units.length === 0) return false;
  const qs = words(st.q);
  top.append(fld({ name: 'outline-q', placeholder: `Filter ${word}`, value: st.q, oninput: (v) => {
    st.q = v;
    st.keep = undefined;
    ctx.redraw();
  } }));
  st.units.clear();
  st.tree = tree;
  let n = 0;
  const add = (u: PartUnit, d: number): void => {
    if (n >= 600) return;
    const name = `${u.label} ${u.address}`;
    if (qs.length && !hits(qs, name) && st.keep?.unit !== u.id) return;
    n++;
    const k = `u:${u.id}`;
    st.units.set(k, u);
    const go = (): void => {
      const el = u.el();
      if (el) el.scrollIntoView({ block: 'center' });
    };
    body.append(
      row({
        k,
        d,
        nm: mark(u.label, qs),
        pv: u.address,
        cls: d > 0 ? 'sub' : '',
        what: name,
        go: 'go',
        run: go,
        verbs: () => [
          ['c', 'copy as stored', () => void Promise.resolve(u.stored()).then((t) => copyText(ctx.handle, t, `Copied the ${u.label}`))],
          u.open ? ['O', 'open it', () => void u.open?.()] : null,
        ],
      }),
    );
  };
  for (const u of units) {
    add(u, 0);
    if (units.length <= 40) for (const c of u.children ?? []) add(c, 1);
  }
  if (n === 0) body.append(empty('Nothing here has those words.'));
  return true;
}

// ---- a page's own contents (a book's chapters) -------------------------------------------------------------------------

/**
 * A viewer's contents, drawn as a Markdown page's sections are (their size, the levels to fold to, a twisty for rows that
 * hold rows), with only the verbs that read: go, fold on the page, copy. Nothing here moves, promotes or undoes.
 */
function renderViewerOutline(ctx: Ctx, pane: PaneView, contents: ViewerOutline, body: HTMLElement, top: HTMLElement): void {
  const { st } = ctx;
  const path = pane.path()!;
  const qs = words(st.q);
  const right = h('span', 'marxy-l-v', sg(['1', '2', '3', 'all'], contents.level() ?? '', (lv) => {
    contents.setLevel(lv);
    notify({ kind: 'info', fades: true, text: lv === 'all' ? 'Unfolded' : `Folded to level ${lv}. Nothing in the file changed.` });
    ctx.redraw();
  }, 'Fold to level'));
  top.append(fld({ name: 'outline-q', placeholder: `Filter ${contents.word}`, value: st.q, right, oninput: (v) => {
    st.q = v;
    ctx.redraw();
  } }));
  const rows = contents.rows;
  if (rows.length === 0) {
    body.append(empty(`No ${contents.word} to list.`));
    return;
  }
  st.units.clear();
  st.tree = undefined;
  const max = maxOf(rows.map((r) => r.words), 1);
  const shutKey = (key: string): string => `${path}#v:${key}`;
  let hideBelow = Number.POSITIVE_INFINITY;
  let n = 0;
  for (const r of rows) {
    if (qs.length > 0) {
      if (!hits(qs, r.text)) continue;
    } else {
      if (r.depth > hideBelow) continue;
      hideBelow = st.shut.has(shutKey(r.key)) ? r.depth : Number.POSITIVE_INFINITY;
    }
    n++;
    const open = !st.shut.has(shutKey(r.key));
    const k = `v:${r.key}`;
    st.units.set(k, { id: r.key, label: r.text, address: '', el: () => r.el(), stored: () => r.copy().text });
    body.append(
      row({
        k,
        d: r.depth,
        tw: qs.length ? '' : r.kids ? (open ? '▾' : '▸') : '',
        nm: own(mark(r.text || '(untitled)', qs)),
        bar: r.words / max,
        n: r.words,
        cls: r.depth >= 1 ? 'sub' : '',
        title: `${r.text} · ${plural(r.words, 'word')}`,
        ...(r.kids && !qs.length
          ? { open, toggle: () => {
              if (open) st.shut.add(shutKey(r.key));
              else st.shut.delete(shutKey(r.key));
              ctx.redraw();
            } }
          : {}),
        go: 'go',
        what: r.text,
        run: () => r.go(),
        verbs: () => [
          ['z', 'fold', () => {
            r.fold();
            ctx.redraw();
          }],
          [
            'c',
            `copy the ${r.depth === 0 ? contents.word.replace(/s$/, '') : 'section'}`,
            () => {
              const got = r.copy();
              copyText(ctx.handle, got.text, got.as);
            },
          ],
        ],
      }),
    );
  }
  if (n === 0) body.append(empty('Nothing here has those words.'));
  markAt(ctx, body);
}

// ---- the dot that follows the page -------------------------------------------------------------------------------------

/**
 * Marks the row of the place the page is at. With `follow` (the page moved, not the panel drawn), a mark that moved to
 * another row brings that row into the panel's view.
 */
function markAt(ctx: Ctx, body: HTMLElement, follow = false): void {
  const pane = ctx.pane();
  if (!pane) return;
  const { st } = ctx;
  // Follows only a panel that was showing the mark: one the reader scrolled elsewhere to browse is left where it is.
  const moved = (key: string | null, seen: (was: string) => boolean): boolean => {
    const was = st.at;
    st.at = key;
    return follow && key !== null && key !== was && (was == null || seen(was));
  };
  const shown = (rows: readonly HTMLElement[]) => (was: string): boolean => {
    const el = rows.find((r) => r.dataset.marxyLeftRow === was);
    if (!el) return true;
    const r = el.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    return r.bottom > b.top && r.top < b.bottom;
  };
  const byteHere = (): number => {
    const sel = ctx.handle.selection.state().selection;
    return sel.kind === 'section' ? sel.heading.src.start : sel.kind === 'node' ? sel.node.src.start : pane.view.position().byteOffset;
  };
  const win = windowOf(body);
  if (win && st.order) {
    const i = lastAtOrBefore(st.order, byteHere());
    const key = i >= 0 ? win.keys[i]! : null;
    win.mark('marxy-l-at', key);
    if (moved(key, (was) => { const j = win.indexOf(was); return j < 0 || win.inView(j); })) win.bring(i, 'auto');
    return;
  }
  const rows = [...body.querySelectorAll<HTMLElement>('.marxy-l-row[data-marxy-left-row]')];
  if (st.starts.size > 0) {
    const keyed = rows.filter((r) => st.starts.has(r.dataset.marxyLeftRow!));
    const i = lastAtOrBefore(keyed.map((r) => st.starts.get(r.dataset.marxyLeftRow!)!), byteHere());
    rows.forEach((r) => r.classList.toggle('marxy-l-at', r === keyed[i]));
    const hit = keyed[i];
    if (moved(hit?.dataset.marxyLeftRow ?? null, shown(rows)) && hit) scrollWithin(hit, 'auto');
    return;
  }
  if (ctx.st.units.size > 0) {
    const scroller = pane.slot === 0 ? document.documentElement : pane.host;
    const line = (pane.slot === 0 ? 0 : scroller.getBoundingClientRect().top) + (scroller.clientHeight || window.innerHeight) * 0.4;
    let hit: HTMLElement | null = null;
    for (const r of rows) {
      const u = ctx.st.units.get(r.dataset.marxyLeftRow!);
      // As the page stands: a page drawn a window at a time (a PDF) draws, and scrolls to, a unit asked for its element, so
      // the dot that follows the page asks `drawn`, or showing Outline moved a PDF to its last page.
      const el = u ? (ctx.st.tree?.drawn ? ctx.st.tree.drawn(u) : u.el()) : null;
      if (el && el.getClientRects().length > 0 && el.getBoundingClientRect().top <= line) hit = r;
    }
    rows.forEach((r) => r.classList.toggle('marxy-l-at', r === hit));
    if (moved(hit?.dataset.marxyLeftRow ?? null, shown(rows)) && hit) scrollWithin(hit, 'auto');
  }
}

const panel: PanelDef<OutlineState> = {
  id: 'outline',
  name: 'Outline',
  field: true,
  rest: 'Tab comes here. J K move, O goes there; drag a row, or Alt ↑ ↓, to move its section.',
  init: () => ({ q: '', shut: new Set(), starts: new Map(), units: new Map(), depth: new Map() }),
  take(ctx, arg) {
    // The Line's `@` keeps `{ q, at: byte }` (a heading), `{ q, unit: id }` (a kind's part), `{ q, scope: 'outline' }`.
    const a = (arg ?? {}) as { q?: unknown; at?: unknown; unit?: unknown };
    if (typeof a.q === 'string') ctx.st.q = a.q;
    ctx.st.keep = typeof a.at === 'number' ? { at: a.at } : typeof a.unit === 'string' ? { unit: a.unit } : undefined;
    if (typeof a.unit === 'string') ctx.cursorTo(`u:${a.unit}`);
  },
  subject: subjectOf,
  buttons(ctx) {
    const pane = ctx.pane();
    if (!pane?.content.store()?.parsed() || pane.content.viewer()?.owns(pane.view.mode)) return [];
    return [{ label: '⋯', icon: 'more', title: 'Open or fold every row', run: (e) => {
      const path = pane.path()!;
      const { rows } = mdRows(ctx, pane);
      openMenu(anchorBelow(e.currentTarget as Element), 'The outline', [
        { title: 'Open every row', run: () => {
          for (const x of [...ctx.st.shut]) if (x.startsWith(`${path}#`)) ctx.st.shut.delete(x);
          ctx.redraw();
        } },
        { title: 'Fold every row to its top level', run: () => {
          const min = minOf(rows.map((r) => r.level));
          for (const r of rows) if (r.level === min && r.kids) ctx.st.shut.add(`${path}#${r.key}`);
          ctx.redraw();
        } },
        { title: 'Fold the page to its second-level headings', chord: 'Shift+Z', run: () => void foldPage(ctx, pane, '2') },
      ]);
    } }];
  },
  render(ctx, body, top) {
    const { st } = ctx;
    st.offs ??= followSignals(ctx, { cursor: 'light' });
    st.starts.clear();
    st.units.clear();
    const pane = ctx.pane();
    const path = pane?.path() ?? null;
    if (!pane || path === null) {
      body.append(emptyFor(ctx));
      return;
    }
    const store = pane.content.store();
    if (!mayRead(path, store?.snapshot().buffer.bytes.length ?? 0)) {
      body.append(empty('Reading…'));
      return;
    }
    const viewer = pane.content.viewer();
    const owned = viewer?.owns(pane.view.mode) ? viewer : null;
    if (owned) {
      const contents = owned.outline?.();
      if (contents) return renderViewerOutline(ctx, pane, contents, body, top);
      if (owned.kind === 'card') {
        body.append(empty('Bytes have no parts to list: they are shown sixteen to a row, as stored. Read as reads the file another way.'));
        return;
      }
      const listed = renderParts(ctx, pane, body, top, 'parts');
      st.hosted = hostedFor(st.hosted, JSON.stringify([path, pane.view.mode, owned.panelKey(), ctx.rev()]));
      const def = owned.cards(pane.view.mode).contents;
      const cctx = cardContext(ctx.handle, pane, path);
      const card = def ? hostCard(st.hosted, 'contents', def, cctx) : null;
      // The fourth card's own name (Pages, Sheets, Image…) is its section's note.
      const note = def ? [def.title(cctx), def.detail?.(cctx) ?? ''].filter(Boolean).join(' · ') : '';
      if (card) body.append(sec(listed ? 'About them' : 'Its parts', note), card);
      if (!listed && !card) body.append(empty('Nothing in it to list as parts.'));
      markAt(ctx, body);
      return;
    }
    if (!store) {
      body.append(empty('Reading…'));
      return;
    }
    const reading = readingOf(path, store.snapshot().buffer.bytes, pane.kind());
    if (reading && (reading.id === 'table' || reading.id === 'records') && reading.contents) return renderColumns(ctx, pane, reading, body, top);
    if (reading?.contents && reading.contents.items.length > 0) return renderContents(ctx, pane, reading, body, top);
    if (reading?.lines?.markdown) return renderScanned(ctx, pane, reading.lines, body, top);
    if (pane.kind() === 'log') {
      const shape = logShapeFor(pane.article, store.snapshot().buffer, () => pane.content.store()?.snapshot().buffer.bytes ?? null, () => ctx.redraw());
      if (shape === null || shape.summary.counts.some((n) => n > 0)) return renderLog(ctx, pane, shape, body, top);
    }
    if (!reading && store.parsed() && fileTypeFor(path).kind === 'markdown') return renderMarkdown(ctx, pane, body, top);
    if (pane.view.mode === 'rendered' && renderParts(ctx, pane, body, top, 'parts')) {
      markAt(ctx, body);
      return;
    }
    // Code is parsed as one block: it has no sections to list.
    if (store.parsed() && !reading && pane.kind() !== 'code') return renderMarkdown(ctx, pane, body, top);
    if (store.snapshot().buffer.bytes.length === 0) body.append(empty('An empty file has no parts to list.'));
    else body.append(empty('Plain text has no parts to list. Find and the Line (Ctrl K) still reach any line.'));
  },
  light(ctx, body) {
    markAt(ctx, body, true);
  },
};

export default panel;
