// Links (the fourth panel): every link and written path in the open file, resolved against the files here. To
// files here (grouped by file, each place a row), Lead nowhere, Within this file, Outside (never fetched), and Pointing
// here: the other files here that name this one, looked for when the panel is shown and kept only by the window's `rev`.
// The cursor walks the places and the page follows; `o` goes where a link leads, `p` peeks at it without going.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { slugOf, type PlacedLink } from '../doc-model.ts';
import { linksOfPane, pointingHere, type Inbound } from '../doc-links.ts';
import { byteOfLine, copyText, emptyFor, goByte, lineStarts, subjectOf } from '../doc-shared.ts';
import { anchorBelow, openMenu } from '../../frame/menu.ts';
import { onLinksFound } from '../../frame/model/links-found.ts';
import { notify } from '../../notices/index.ts';
import { mayRead } from '../painted.ts';
import { textThroughLine } from '../peek-read.ts';
import type { PanelContext, PanelDef, PaneView, RowEvent, Verb } from '../types.ts';
import { empty, fld, h, hit, mark, row, sec } from '../ui.ts';

export interface LinksState {
  q: string;
  /** Groups opened or shut by the reader, by key. */
  readonly open: Map<string, boolean>;
  /** Groups showing every place, not the first four. */
  readonly more: Set<string>;
  /** Files whose every group is listed, not the first seven. */
  readonly allFiles: Set<string>;
  peek?: HTMLElement | null;
  /** The links that lead nowhere, as the panel last worked them out: the rail's badge reads it, and works nothing out. */
  dead?: { readonly path: string; readonly version: number; readonly n: number };
  /** Takes the wait for a large page's links off: set while the panel says it is finding them. */
  offFound?: () => void;
  /** Takes the peek's Escape listener off. */
  offPeek?: () => void;
}

type Ctx = PanelContext<LinksState>;

const nf = (n: number): string => n.toLocaleString('en-GB');
const words = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);
const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/') + 1);

/** Opens `path` at a line (1-based) or its start, beside when asked. */
async function openAt(ctx: Ctx, path: string, line: number | undefined, beside: boolean, anchor?: string): Promise<void> {
  const { handle } = ctx;
  if (line === undefined && !anchor) {
    await handle.open(path, beside ? { target: 'other' } : {});
    return;
  }
  // The target's bytes are only known once it is open: open it, then go to the line in it.
  await handle.open(path, beside ? { target: 'other' } : {});
  const pane = handle.panes().panes.find((p) => p.path() === path);
  const store = pane?.content.store();
  if (!pane || !store) return;
  let byte = 0;
  if (line !== undefined) byte = byteOfLine(lineStarts(store.snapshot().buffer), line);
  else if (anchor && store.parsed()) {
    const ast = store.snapshot().ast;
    const head = ast.children.find((b) => b.type === 'heading' && slugOf(new TextDecoder().decode(store.snapshot().buffer.bytes.subarray(b.src.start, b.src.end)).replace(/^#+\s*|\s*#*\s*$/g, '')) === anchor);
    if (head) byte = head.src.start;
  }
  await goByte(handle, path, byte, false);
}

/** A peek at where a link leads: the lines around the one it cites, under the row, until Escape or another peek. */
async function peekAt(ctx: Ctx, rowEl: HTMLElement, path: string, line: number | undefined): Promise<void> {
  ctx.st.peek?.remove();
  ctx.st.offPeek?.();
  let text: string | null;
  try {
    text = await textThroughLine(ctx.handle.shell, path, (line ?? 1) + 5);
  } catch {
    notify({ kind: 'refused', fades: true, text: `${basename(path)} could not be read for a peek.` });
    return;
  }
  if (text === null) {
    notify({ kind: 'refused', fades: true, text: `${basename(path)}:${line} is too far into the file for a peek; o opens it there.` });
    return;
  }
  const lines = text.split(/\r\n|\n|\r/);
  const at = Math.max(1, Math.min(lines.length, line ?? 1));
  const box = h('div', 'marxy-l-peek');
  box.setAttribute('role', 'note');
  box.append(h('b', '', `${basename(path)}:${at}`));
  for (let i = Math.max(1, at - 3); i <= Math.min(lines.length, at + 5); i++) {
    const l = h('div', i === at ? 'marxy-l-hit marxy-l-at' : 'marxy-l-hit', h('span', 'marxy-l-no', String(i)), h('span', 'marxy-l-tx', lines[i - 1] ?? ''));
    box.append(l);
  }
  // Another peek may have landed while this file was read.
  ctx.st.peek?.remove();
  ctx.st.offPeek?.();
  rowEl.after(box);
  ctx.st.peek = box;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    box.remove();
    stop();
  };
  const stop = (): void => {
    document.removeEventListener('keydown', onKey, true);
    if (ctx.st.offPeek === stop) ctx.st.offPeek = undefined;
  };
  document.addEventListener('keydown', onKey, true);
  ctx.st.offPeek = stop;
}

/** The page follows the cursor: the line a place is written on is scrolled into view. */
function pageTo(ctx: Ctx, pane: PaneView, line: number): void {
  const store = pane.content.store();
  if (!store) return;
  const byte = byteOfLine(lineStarts(store.snapshot().buffer), line);
  pane.view.mountThrough(byte);
  const el = [...pane.article.querySelectorAll<HTMLElement>('[data-marxy-s][data-marxy-e]')].find((e) => Number(e.dataset.marxyS) <= byte && byte < Number(e.dataset.marxyE) && !e.parentElement?.closest('[data-marxy-s]'));
  el?.scrollIntoView({ block: 'nearest' });
}

const panel: PanelDef<LinksState> = {
  id: 'links',
  name: 'Links',
  field: true,
  rest: 'Tab comes here. J K walk the places, and the page follows; O goes to what a link names.',
  init: () => ({ q: '', open: new Map(), more: new Set(), allFiles: new Set() }),
  take(ctx, arg) {
    const q = (arg as { q?: string } | null)?.q;
    if (typeof q === 'string') ctx.st.q = q;
  },
  subject: subjectOf,
  badge(ctx) {
    const d = ctx.st.dead;
    const pane = ctx.pane();
    if (!d || d.n === 0 || !pane || pane.path() !== d.path || (pane.content.store()?.snapshot().version ?? -1) !== d.version) return null;
    return { text: String(d.n), tone: 'warn', say: `${d.n} ${d.n === 1 ? 'link leads' : 'links lead'} nowhere` };
  },
  buttons(ctx) {
    const pane = ctx.pane();
    const path = pane?.path() ?? null;
    if (!pane || path === null) return [];
    return [{ label: '⋯', icon: 'more', title: 'Copy what this file names', run: (e) => {
      const l = linksOfPane(ctx.handle, pane, path);
      const all = l?.all ?? [];
      openMenu(anchorBelow(e.currentTarget as Element), 'What this file names', [
        { title: 'Copy every file it names', run: () => {
          const ps = [...new Set(all.filter((x) => x.place === 'file').map((x) => x.path!))];
          copyText(ctx.handle, ps.join('\n'), `Copied ${ps.length} ${ps.length === 1 ? 'path' : 'paths'}`);
        } },
        { title: 'Copy the links that lead nowhere', run: () => {
          const ds = all.filter((x) => x.place === 'dead').map((x) => `${path}:${x.line}  ${x.w}`);
          copyText(ctx.handle, ds.join('\n'), `Copied ${ds.length} ${ds.length === 1 ? 'link' : 'links'}`);
        } },
      ]);
    } }];
  },
  render(ctx, body, top) {
    const { handle, st } = ctx;
    st.peek = null;
    const pane = ctx.pane();
    const path = pane?.path() ?? null;
    if (!pane || path === null) {
      body.append(emptyFor(ctx));
      return;
    }
    if (!mayRead(path, pane.content.store()?.snapshot().buffer.bytes.length ?? 0)) {
      body.append(empty('Reading…'));
      return;
    }
    const found = linksOfPane(handle, pane, path);
    if (found === null) {
      const viewer = pane.content.viewer();
      if (viewer?.owns(pane.view.mode)) {
        const card = viewer.cards(pane.view.mode).links;
        if (card) {
          // A message's links are its own card's: drawn as they always were.
          const wrap = h('div', 'marxy-l-cards');
          const sect = h('section', 'marxy-card');
          sect.dataset.marxyCard = 'links';
          const b = h('div', 'marxy-card-body');
          sect.append(h('h3', 'marxy-card-head', h('span', '', 'Links')), b);
          wrap.append(sect);
          try {
            card.render(b, { handle, frame: handle.frame(), pane, group: 'prose', path });
          } catch {
            b.textContent = 'This could not be drawn.';
          }
          body.append(wrap);
          return;
        }
      }
      body.append(empty(viewer?.kind === 'card' ? 'Bytes are not read for links. Read as reads the file another way.' : 'This kind of file is not read for links.'));
      return;
    }
    if (found === undefined) {
      // This panel may be the only one showing, so nothing else redraws it when the links are found.
      st.offFound ??= onLinksFound(() => {
        st.offFound?.();
        st.offFound = undefined;
        ctx.redraw();
      });
      body.append(empty('Finding the links…'));
      return;
    }
    const qs = words(st.q);
    const matches = (...t: (string | undefined)[]): boolean => qs.length === 0 || qs.every((w) => t.some((x) => (x ?? '').toLowerCase().includes(w)));
    const all = found.all;
    st.dead = { path, version: pane.content.store()?.snapshot().version ?? -1, n: all.filter((x) => x.place === 'dead').length };
    const file = all.filter((x) => x.place === 'file' && matches(x.w, x.path));
    const dead = all.filter((x) => x.place === 'dead' && matches(x.w));
    const self = all.filter((x) => x.place === 'self' && matches(x.w));
    const web = all.filter((x) => x.place === 'web' && matches(x.w));
    const looked = pointingHere(handle, path, ctx.rev(), () => ctx.redraw());
    const inbound = looked === 'failed' ? [] : looked;
    const inShown = (inbound ?? []).filter((x) => matches(x.from, x.w));
    const shown = file.length + dead.length + self.length + web.length;
    top.append(fld({ name: 'links-q', placeholder: found.markdown ? 'Filter links' : 'Filter written paths', value: st.q, right: h('span', 'marxy-l-v', qs.length ? `${shown} of ${all.length}` : `${nf(all.length)} in all`), oninput: (v) => {
      st.q = v;
      ctx.redraw();
    } }));
    const mk = (t: string): HTMLElement => mark(t, qs);
    // A long page can hold thousands of one kind: the first hundred are drawn, and a row draws the rest when asked.
    const drawCapped = (kind: string, xs: PlacedLink[], draw: (x: PlacedLink, i: number) => HTMLElement): void => {
      const key = `${path}>${kind}`;
      const every = xs.length <= 100 || qs.length > 0 || st.more.has(key);
      (every ? xs : xs.slice(0, 100)).forEach((x, i) => body.append(draw(x, i)));
      if (!every)
        body.append(hit('', `${nf(xs.length - 100)} more`, { k: `more:${kind}`, what: `${nf(xs.length - 100)} more`, go: 'show them', run: () => {
          st.more.add(key);
          ctx.redraw();
        } }));
    };
    const placeRow = (x: PlacedLink, k: string, o: { red?: boolean; noGo?: boolean; go?: string; run?: (e?: RowEvent) => void }): HTMLElement => {
      const text = o.red ? h('span', 'marxy-l-red', mk(x.w)) : mk(x.w);
      let el: HTMLElement | null = null;
      el = hit(String(x.line), text, {
        k,
        what: `line ${x.line}`,
        at: () => pageTo(ctx, pane, x.line),
        ...(o.run ? { run: o.run, go: o.go ?? 'go' } : {}),
        verbs: () =>
          [
            o.noGo || x.place !== 'file' ? null : (['p', 'peek', () => el && void peekAt(ctx, el, x.path!, x.at)] as Verb),
            ['c', 'copy it as written', () => copyText(handle, x.w, `Copied ${x.w}`)],
            ['w', 'where it is written', () => void goByte(handle, path, byteOfLine(lineStarts(pane.content.store()!.snapshot().buffer), x.line))],
          ] as (Verb | null)[],
      });
      return el;
    };

    // To files here, grouped by the file each leads to.
    const groups = new Map<string, PlacedLink[]>();
    for (const x of file) groups.set(x.path!, [...(groups.get(x.path!) ?? []), x]);
    const glist = [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    body.append(sec(`To files here · ${file.length}`, 'each one checked'));
    if (glist.length === 0) body.append(row({ nm: qs.length ? 'None of these has those words' : found.markdown ? 'No link or written path here names a file here' : 'No written path here names a file here', cls: 'dim' }));
    const allFiles = qs.length > 0 || st.allFiles.has(path) || glist.length <= 8;
    glist.slice(0, allFiles ? glist.length : 7).forEach(([to, xs], gi) => {
      const key = `${path}>${to}`;
      const open = qs.length ? true : (st.open.get(key) ?? gi === 0);
      const name = basename(to);
      const nm = h('span', '', mk(name));
      const dir = dirOf(to);
      if (dir) nm.append(' ', h('small', '', mk(dir)));
      body.append(row({ k: `t:${to}`, tw: open ? '▾' : '▸', nm, n: xs.length, title: to, open, what: name, toggle: () => {
        st.open.set(key, !open);
        ctx.redraw();
      }, run: (e) => void openAt(ctx, to, undefined, !!e?.beside), go: 'open it', verbs: () => [['c', 'copy its path', () => copyText(handle, to, `Copied ${to}`)]] }));
      if (!open) return;
      const every = qs.length > 0 || st.more.has(key);
      (every ? xs : xs.slice(0, 4)).forEach((x, i) => body.append(placeRow(x, `p:${to}:${x.line}:${i}`, { go: 'go', run: (e) => void openAt(ctx, to, x.at, !!e?.beside, x.anchor) })));
      if (!every && xs.length > 4)
        body.append(hit('', `${xs.length - 4} more`, { k: `more:${to}`, what: `${xs.length - 4} more`, go: 'show them', run: () => {
          st.more.add(key);
          ctx.redraw();
        } }));
    });
    if (!allFiles)
      body.append(row({ k: 'morefiles', tw: '', nm: `${glist.length - 7} more files`, cls: 'dim', go: 'show them', run: () => {
        st.allFiles.add(path);
        ctx.redraw();
      } }));

    // Lead nowhere.
    body.append(sec(`Lead nowhere · ${dead.length}`, 'no such file'));
    if (dead.length === 0) body.append(row({ nm: all.some((x) => x.place === 'dead') ? 'None of these has those words' : found.markdown ? 'Every link here leads to a file.' : 'Nothing written here that looks like a link.', cls: 'dim' }));
    drawCapped('dead', dead, (x, i) => placeRow(x, `d:${x.line}:${i}`, { red: true, noGo: true, go: 'where it is written', run: () => void goByte(handle, path, byteOfLine(lineStarts(pane.content.store()!.snapshot().buffer), x.line)) }));

    if (found.markdown) {
      // Within this file: each anchor once, said in red when no heading has it.
      const store = pane.content.store()!;
      const snap = store.snapshot();
      const slugs = new Map<string, number>();
      for (const b of snap.ast.children) if (b.type === 'heading') slugs.set(slugOf(new TextDecoder().decode(snap.buffer.bytes.subarray(b.src.start, b.src.end)).replace(/^#+\s*|\s*#*\s*$/g, '').replace(/\r?\n[=-]+\s*$/, '')), b.src.start);
      const anchors = new Map<string, PlacedLink[]>();
      for (const x of self) anchors.set(x.w, [...(anchors.get(x.w) ?? []), x]);
      body.append(sec(`Within this file · ${self.length}`, ''));
      if (anchors.size === 0) body.append(row({ nm: all.some((x) => x.place === 'self') ? 'None of these has those words' : 'No links to headings in this file.', cls: 'dim' }));
      for (const [w, xs] of anchors) {
        const at = slugs.get(xs[0]!.anchor ?? '');
        const ok = at !== undefined;
        body.append(row({ k: `a:${w}`, nm: h('span', 'marxy-l-mono', mk(w)), as: ok ? '' : 'no such heading', red: !ok, n: xs.length, title: ok ? 'Goes to its heading' : 'No heading in this file has that name', what: w, go: 'go', run: () => {
          if (!ok) {
            notify({ kind: 'info', fades: true, text: `No heading here is called ${w}` });
            return;
          }
          void goByte(handle, path, at);
        }, at: () => pageTo(ctx, pane, xs[0]!.line), verbs: () => [['c', 'copy it', () => copyText(handle, w, `Copied ${w}`)], ['w', 'where it is written', () => void goByte(handle, path, byteOfLine(lineStarts(snap.buffer), xs[0]!.line))]] }));
      }
      // Outside: never fetched.
      body.append(sec(`Outside · ${web.length}`, 'never fetched'));
      if (web.length === 0) body.append(row({ nm: all.some((x) => x.place === 'web') ? 'None of these has those words' : 'No outside links.', cls: 'dim' }));
      drawCapped('web', web, (x, i) => placeRow(x, `w:${x.line}:${i}`, { noGo: true, go: 'say where it goes', run: () => notify({ kind: 'info', fades: true, text: `Outside the files here: ${x.w}. Nothing here fetches it; C copies it.` }) }));
    }

    // Pointing here: worked out now, from the files as they are.
    body.append(sec(`Pointing here · ${inbound === null ? '…' : looked === 'failed' ? '?' : inShown.length}`, 'looked for when you open this'));
    if (looked === 'failed') body.append(row({ nm: 'The files here could not be searched; shown again, it looks again', cls: 'dim' }));
    else if (inbound === null) body.append(row({ nm: 'Looking through the files here…', cls: 'dim' }));
    else if (inShown.length === 0) body.append(row({ nm: qs.length ? 'None of these has those words' : 'No other file here names this one', cls: 'dim' }));
    const from = new Map<string, Inbound[]>();
    for (const x of inShown) from.set(x.from, [...(from.get(x.from) ?? []), x]);
    for (const [fp, xs] of from) {
      const key = `in>${path}>${fp}`;
      const open = st.open.get(key) !== false;
      const nm = h('span', '', mk(basename(fp)), ' ', h('small', '', dirOf(fp)));
      body.append(row({ k: `i:${fp}`, tw: open ? '▾' : '▸', nm, n: xs.length, title: fp, open, what: basename(fp), toggle: () => {
        st.open.set(key, !open);
        ctx.redraw();
      }, go: 'open it', run: (e) => void openAt(ctx, fp, undefined, !!e?.beside) }));
      if (open)
        xs.forEach((x, i) => {
          let el: HTMLElement | null = null;
          el = hit(String(x.line), mk(x.w), { k: `ip:${fp}:${x.line}:${i}`, what: `${basename(fp)}:${x.line}`, go: 'go', run: (e) => void openAt(ctx, fp, x.line, !!e?.beside), verbs: () => [['p', 'peek', () => el && void peekAt(ctx, el, fp, x.line)], ['c', 'copy where it is', () => copyText(handle, `${fp}:${x.line}`, `Copied ${fp}:${x.line}`)]] });
          body.append(el);
        });
    }
  },
};

export default panel;
