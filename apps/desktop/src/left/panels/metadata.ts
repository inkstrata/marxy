// Metadata (the second panel): the app's account of the open file. A hero line says how it is read, why, and
// what was guessed (a file with no reading says what was tried); "Shown at" switches the depths (Read, Reveal, X-ray,
// Source); "Read as" is the ladder of readings, Bytes last; then the file as stored, what is odd in it, what is written
// in it (front matter, a patch's header, a viewer's own metadata), what it holds (each count a lens on the page), and the
// part under the cursor. Worked out when drawn from the file as it is; nothing is kept but the panel's own state.
import type { Document, ListItem, Node } from '@marxy/core';
import { readingOf, type Reading } from '@marxy/core/src/reading/index.ts';
import { PART_WORDS, namesPart } from '@marxy/core/src/reading/parts.ts';
import { fileTypeFor } from '@marxy/core/src/kind/registry.ts';
import { magicOf } from '@marxy/core/src/viewer/bytes.ts';
import { walk } from '@marxy/core/src/transforms/prose.ts';
import type { Reason } from '@marxy/core/src/kind/detect.ts';
import { partRange } from '../../commands/cursor.ts';
import { setLogLevel } from '../../commands/log.ts';
import { depthsChanged, depthsOf, lensOf, revealOn, setLensOn, toggleReveal, toggleXray } from '../../depths/dress.ts';
import { lensesOf, setLens } from '../../depths/lens.ts';
import { heldEncoding } from '../../document/encoding.ts';
import { isArchiveEntry } from '../../document/entries.ts';
import { isUntitled } from '../../document/untitled.ts';
import { accountLinesIn } from '../../frame/account.ts';
import { canRun, runCommand } from '../../frame/branches/run.ts';
import { encodingFactWords, renderEncodingBlock } from '../../frame/encoding.ts';
import { renderTier, textFactsCard } from '../../frame/cards/index.ts';
import { comparison } from '../../frame/cards/more.ts';
import { notesInMargin } from '../../proposals/notes-in-place.ts';
import { proposalOn } from '../../proposals/state.ts';
import { countWords, countsAsMarkdown, kindLabel } from '../../frame/model/facts.ts';
import { frontMatterOf, modifiedWords, scanHidden, sizeFact } from '../../frame/model/metadata.ts';
import { outlineModelFor, type HeadingRow } from '../../frame/model/outline.ts';
import { partGuessed } from '../../frame/model/guess.ts';
import { levelOf } from '../../kinds/log-filter.ts';
import { notesFor } from '../../notes/store.ts';
import { notify } from '../../notices/index.ts';
import { choosePart, partLongName, partsNow, type PartNow } from '../../render/parts.ts';
import { bytesChosen } from '../../read-as/bytes-choice.ts';
import { onColourChoice } from '../../render/colour-tier.ts';
import { KIND_NAMES, VIEWER_NAMES, readAs, readingsFor } from '../../read-as/ladder.ts';
import { showRendered } from '../../read-as/show-rendered.ts';
import { markdownPastLines } from '@marxy/core/src/reading/lines.ts';
import { buildAppContext } from '../../selection/bind.ts';
import { encodingFact } from '../../source/frame-facts.ts';
import type { PaneViewer } from '../../viewers/types.ts';
import { eolWords, hexRows, INDENT_WORDS, logShapeFor, readable, storedFacts, utf8Trial, type StoredFacts } from '../doc-model.ts';
import { linkCount } from '../doc-links.ts';
import { byteOfLine, cardContext, copyText, depthTarget, emptyFor, followSignals, goByte, hostCard, hostedFor, lineOfByte, lineStarts, subjectOf, whereWords, type HostedCards } from '../doc-shared.ts';
import { mayRead } from '../painted.ts';
import type { PanelContext, PanelDef, PaneView, RowOptions, Verb } from '../types.ts';
import { empty, h, hero, hint, kv, lab, rd, row, sec, sg, tool } from '../ui.ts';

export interface MetadataState {
  offs?: () => void;
  offColour?: () => void;
  /** Worked out once per file and text: what the panel derives from it. */
  memo: Map<string, { sig: string; v: unknown }>;
  /** When the file was last changed on disk, by path, as the shell said it. */
  mtimes: Map<string, number | null>;
  /** The store's disk bytes each mtime was asked for. */
  statOf: Map<string, Uint8Array | null>;
  sizes: Map<string, number>;
  /** A file with no reading's first bytes, by path. */
  heads: Map<string, Uint8Array | null>;
  /** Files whose other readings are listed, not folded under one row. */
  ladder: Set<string>;
  hosted?: HostedCards;
  /** Bring the read-as rows into view on the next draw (`r` from Places, the head's guess). */
  toReadAs?: boolean;
  /** The reading's details (tiers, encoding), kept while the file is the same. */
  how?: { key: string; el: HTMLElement };
}

type Ctx = PanelContext<MetadataState>;
type Range = { start: number; end: number };

/** The lenses It holds draws a row for (`lensRow`), by the id the Line's `%` gives them too. */
const LENS_ROWS = new Set(['tasks', 'code', 'tables', 'notes']);

function memo<T>(st: MetadataState, key: string, sig: string, make: () => T): T {
  const hit = st.memo.get(key);
  if (hit && hit.sig === sig) return hit.v as T;
  const v = make();
  st.memo.set(key, { sig, v });
  if (st.memo.size > 60) st.memo.delete(st.memo.keys().next().value!);
  return v;
}

const nf = (n: number): string => n.toLocaleString('en-GB');
const plural = (n: number, one: string, many = `${one}s`): string => `${nf(n)} ${n === 1 ? one : many}`;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const numWord = (n: number): string => WORDS[n] ?? nf(n);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const g = (text: string): HTMLElement => h('span', 'marxy-l-g', text);

/** A reason in the hero's words: "its name ends .md", "most lines open as a log's lines do (line 3)". */
function because(r: Reason): string {
  const ext = /^extension (\.\S+)$/.exec(r.signal);
  if (ext) return `its name ends ${ext[1]}`;
  if (r.signal === 'file name') return `its name is ${r.at}`;
  if (r.signal === 'shebang') return 'it begins with #!';
  if (r.signal === 'dotfile') return 'its name begins with a dot';
  if (r.signal === 'build file') return `${r.at} is a build file’s name`;
  if (r.signal === 'no extension') return 'nothing in its name says, so its bytes were read';
  if (r.signal === 'reader rule') return `a rule of yours matches ${r.at}`;
  if (r.signal === 'nothing else fired') return 'nothing else fit';
  return `${r.signal}${/^line \d/.test(r.at) ? ` (${r.at})` : ''}`;
}

function modifiedOf(ctx: Ctx, path: string): string {
  const st = ctx.st;
  if (isUntitled(path)) return 'Not saved yet';
  // The bytes last read or written: a save or a reload gives new ones, and the stat is asked again.
  const disk = ctx.pane()?.content.store()?.snapshot().disk ?? null;
  if (!st.mtimes.has(path) || st.statOf.get(path) !== disk) {
    st.statOf.set(path, disk);
    st.mtimes.set(path, null);
    void ctx.handle.shell
      .stat(path)
      .then((s) => {
        st.mtimes.set(path, s?.mtimeMs ?? null);
        if (s) st.sizes.set(path, s.size);
        ctx.redraw();
      })
      .catch(() => undefined);
    return '…';
  }
  const ms = st.mtimes.get(path);
  return ms ? modifiedWords(ms) : 'Not said';
}

// ---- Shown at ---------------------------------------------------------------------------------------------------------

type Depth = 'read' | 'reveal' | 'xray' | 'source';

/** A viewer's own Reveal (an archive's file as stored), when its page has one. */
const viewerReveal = (pane: PaneView): PaneViewer['reveal'] => pane.content.viewer()?.reveal;

function shownAt(pane: PaneView): Depth {
  if (pane.view.mode === 'source') return 'source';
  if (revealOn(pane) || viewerReveal(pane)?.on()) return 'reveal';
  if (depthsOf(pane.article).xrays.length > 0) return 'xray';
  return 'read';
}

async function pickShown(ctx: Ctx, pane: PaneView, id: string, markdown: boolean): Promise<void> {
  const { handle } = ctx;
  const target = depthTarget(pane);
  const toRead = async (): Promise<void> => {
    if (pane.view.mode === 'source') await handle.toggleMode();
  };
  if (id === 'source') {
    if (pane.view.mode !== 'source') await handle.toggleMode();
  } else if (id === 'read') {
    await toRead();
    viewerReveal(pane)?.set(false);
    if (revealOn(pane)) toggleReveal(target);
    for (const x of depthsOf(pane.article).xrays) toggleXray(target, x);
  } else if (id === 'reveal' && viewerReveal(pane)) {
    await toRead();
    viewerReveal(pane)!.set(true);
    depthsChanged();
  } else if (id === 'reveal') {
    if (!markdown) {
      notify({ kind: 'info', fades: true, text: 'Reveal puts back what the reading left out; this kind of file has nothing more to show that way.' });
      return;
    }
    await toRead();
    if (!revealOn(pane)) toggleReveal(target);
  } else if (id === 'xray') {
    if (pane.view.mode === 'source') {
      notify({ kind: 'info', fades: true, text: 'In Source every line is already as written; the invisibles are shown from the View menu.' });
      return;
    }
    if (canRun(handle, 'depths.xray')) await runCommand(handle, 'depths.xray');
    else notify({ kind: 'info', fades: true, text: 'X-ray shows the exact bytes of the selected part. Select one on the page (J K), then choose X-ray or press X.' });
  }
  ctx.redraw();
}

function shownTool(ctx: Ctx, pane: PaneView, markdown0: boolean, depths0: boolean): HTMLElement {
  // A viewer with a Reveal of its own (an archive) has all four depths; x-ray is its parts'.
  const own = viewerReveal(pane) !== undefined;
  const depths = depths0 || own;
  const markdown = markdown0 || own;
  const items: [string, string][] = depths ? [['read', 'Read'], ...(markdown ? ([['reveal', 'Reveal']] as [string, string][]) : []), ['xray', 'X-ray'], ['source', 'Source']] : [['read', 'Read'], ['source', 'Source']];
  const on = shownAt(pane);
  return tool(lab('Shown at'), sg(items, on === 'reveal' || on === 'xray' ? (depths ? on : 'read') : on, (id) => void pickShown(ctx, pane, id, markdown), 'Shown at'));
}

// ---- Read as ----------------------------------------------------------------------------------------------------------

function readAsRows(ctx: Ctx, path: string, body: HTMLElement): void {
  const ways = readingsFor(path);
  if (ways.length === 0) return;
  body.append(sec('Read as', 'Bytes is always last'));
  // The readings that could apply are many for text (every kind): folded under one row unless one of them is chosen.
  const others = ways.filter((w) => w.group === 'Read it another way');
  const open = ctx.st.ladder.has(path) || others.some((w) => w.current);
  const toggle = (): void => {
    if (open) ctx.st.ladder.delete(path);
    else ctx.st.ladder.add(path);
    ctx.redraw();
  };
  for (const way of ways) {
    if (way.group === 'Read it another way' && way === others[0])
      body.append(row({ k: 'ra:another', tw: open ? '▾' : '▸', nm: 'Read it another way', n: others.length, cls: 'dir', open, toggle, what: 'Read it another way' }));
    if (way.group === 'Read it another way' && !open) continue;
    const choose = (): void => {
      if (way.current) return;
      void readAs(path, way.id, buildAppContext(ctx.handle)).then(() => ctx.redraw());
    };
    body.append(
      row({
        k: `ra:${way.id || 'found'}`,
        d: way.group === 'Read it another way' ? 1 : 0,
        pre: rd(way.current),
        nm: way.label,
        as: way.current ? 'shown now' : way.note,
        cls: way.current ? 'sel' : '',
        go: way.current ? 'shown now' : 'read it so',
        what: way.label,
        run: choose,
      }),
    );
  }
}

// ---- lenses -----------------------------------------------------------------------------------------------------------

function lensRow(ctx: Ctx, pane: PaneView, id: string, ranges: () => Range[], o: RowOptions, more: RowOptions['verbs'] = () => []): HTMLElement {
  const on = lensOf(pane.article) === id;
  const flip = (): void => {
    const target = depthTarget(pane);
    if (on) setLensOn(target, null);
    else {
      const rs = ranges();
      if (rs.length === 0) return;
      const go = async (): Promise<void> => {
        if (pane.view.mode === 'source') await ctx.handle.toggleMode();
        setLensOn(target, { id, label: typeof o.what === 'string' ? o.what : id, ranges: rs });
      };
      void go();
    }
    ctx.redraw();
  };
  return row({
    ...o,
    k: `l:${id}`,
    cls: on ? 'sel' : '',
    go: on ? 'show everything' : 'show only these',
    run: flip,
    verbs: () => [['v', on ? 'show everything' : 'only these', flip], ...(more?.() ?? [])],
  });
}

// ---- what a Markdown page holds ---------------------------------------------------------------------------------------

interface Holds {
  readonly tasks: number;
  readonly done: number;
  readonly open: Range[];
  readonly fences: Range[];
  readonly langs: string[];
  readonly tables: Range[];
  readonly foots: number[];
}

function holdsOf(ast: Document): Holds {
  let tasks = 0;
  let done = 0;
  const open: Range[] = [];
  const fences: Range[] = [];
  const langs = new Set<string>();
  const tables: Range[] = [];
  const foots: number[] = [];
  walk(ast, (n: Node) => {
    if (n.type === 'listItem' && (n as ListItem).task) {
      tasks++;
      if ((n as ListItem).task === 'checked') done++;
      else open.push({ start: n.src.start, end: n.src.end });
    } else if (n.type === 'codeBlock') {
      fences.push({ start: n.src.start, end: n.src.end });
      const lang = (n as { lang?: string }).lang;
      if (lang) langs.add(lang);
    } else if (n.type === 'table') tables.push({ start: n.src.start, end: n.src.end });
    else if (n.type === 'footnoteDefinition') foots.push(n.src.start);
  });
  return { tasks, done, open, fences, langs: [...langs], tables, foots };
}

/** The Markdown page's fenced parts the reading names (read as a session, a log, data…). */
function namedParts(path: string, store: NonNullable<ReturnType<PaneView['content']['store']>>, reading: Reading | null): PartNow[] {
  if (!store.parsed() || reading) return [];
  const snap = store.snapshot();
  return partsNow(path, snap.ast, snap.buffer.bytes).filter((p) => namesPart(p.part, p.reading));
}

// ---- the accounts -----------------------------------------------------------------------------------------------------

function textAccount(ctx: Ctx, pane: PaneView, path: string, body: HTMLElement): void {
  const { handle, st } = ctx;
  const store = pane.content.store();
  if (!store) {
    body.append(empty('Reading…'));
    return;
  }
  const snap = store.snapshot();
  const buffer = snap.buffer;
  const sig = `${snap.version}:${buffer.bytes.length}`;
  const detected = pane.content.detected();
  const reading = memo(st, `reading|${path}`, `${sig}:${pane.kind()}`, () => readingOf(path, buffer.bytes, pane.kind()));
  const markdown = !reading && fileTypeFor(path).kind === 'markdown';
  const parsed = store.parsed();
  const decisive = detected?.reasons.find((r) => r.decisive) ?? detected?.reasons[0];
  const chose = decisive?.tier === 1;
  const kind = detected?.kind ?? null;

  // The hero: what it is read as, in large type, and why; a guess said in the accent.
  // A file set as written, or as lines, is named by the kind it was read as (a session, a log), not by its reading.
  const asLines = reading?.id === 'written' || reading?.id === 'lines';
  // Markdown past the lines tier: shown as lines until the reader asks for its page, and the way back once asked.
  const onRequest = reading?.lines?.markdown === true ? 'lines' : markdown && markdownPastLines(path, buffer.bytes) ? 'rendered' : null;
  const big = reading && !asLines ? cap(reading.name) : markdown || onRequest ? 'Markdown' : kind ? KIND_NAMES[kind] : 'Text';
  const small = h('span', '');
  const flip = (label: string, on: boolean): HTMLElement => {
    const b = h('button', 'marxy-linkish', label);
    b.type = 'button';
    b.addEventListener('click', () => void showRendered(path, on));
    return b;
  };
  const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (onRequest === 'lines') small.append(`Shown as lines, as the file writes it: it is ${mb(buffer.bytes.length)}, and past 5 MB Markdown is rendered only when asked, as that parses the whole file. `, flip('Show rendered (g r)', true));
  else if (onRequest === 'rendered') small.append('Rendered because you asked; at this size it opens as lines. ', flip('Back to lines (g r)', false), ' ');
  else if (chose) small.append('You chose this reading; Read as puts it back. ');
  else if (reading?.failed) small.append(`It does not read as ${reading.format}: at line ${reading.failed.line}, ${reading.failed.why}. ${reading.id === 'lines' ? 'Shown as lines.' : 'Set as written.'}`);
  else if (reading && (reading.id === 'verse' || reading.id === 'prose')) small.append('Read so because ', g(`${reading.id === 'verse' ? 'its short lines and stanzas' : 'its lines of words'}: a guess from its shape, not its name`), '. ');
  else if (reading && !asLines) small.append(`Read so because its name ends .${/\.([^./]+)$/.exec(path)?.[1] ?? ''}. `);
  else if (markdown) {
    small.append(`Read so because its name ends .${/\.([^./]+)$/.exec(path)?.[1] ?? 'md'}. `);
    // A Markdown page is read as Markdown whatever kind its text suggests, so the kind is said plainly, not as a guess.
    if (kind && decisive) small.append(`${cap(kindLabel(kind, path))}: ${because(decisive)}. `);
  } else if (decisive) {
    if (decisive.tier >= 4 && decisive.tier < 7) small.append('Read so because ', g(`${because(decisive)}: a guess from its shape, not its name`), '. ');
    else small.append(`Read so because ${because(decisive)}. `);
  }
  const held = heldEncoding(path)?.found ?? null;
  if (held?.how === 'guess') small.append(g(`Its bytes are not UTF-8, so they were read as ${held.name}; that is a guess.`), ' ');
  const parts = parsed ? namedParts(path, store, reading) : [];
  if (parts.length > 0) {
    const guessed = parts.filter((p) => partGuessed(p.part, p.reading, p.chosen));
    small.append(h('br', ''), parts.length === 1 ? 'One fenced part is read on its own' : `${nf(parts.length)} fenced parts are read on their own`);
    if (guessed.length > 0) {
      const kinds = [...new Set(guessed.map((p) => PART_WORDS[p.reading].short))].map((w) => (/^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`));
      small.append('; ', g(`${guessed.length === 1 ? 'one was' : `${numWord(guessed.length)} were`} guessed to be ${kinds.join(' and ')}`));
    }
    small.append('.');
  }
  body.append(hero(big, small));
  body.append(shownTool(ctx, pane, markdown && parsed, true));
  howShown(pane, body);
  readAsRows(ctx, path, body);

  // What the Reading card said that the ladder does not: how much is coloured or drawn, and the encoding with its why.
  // Kept across redraws while the file is the same, so an opened "why?" stays open.
  const howKey = `${path}|${snap.version}|${held?.name ?? ''}|${held?.how ?? ''}`;
  if (st.how?.key !== howKey) {
    const el = h('div', 'marxy-l-how');
    try {
      renderTier(el, cardContext(handle, pane, path));
      renderEncodingBlock(el, path, handle);
    } catch (error) {
      console.warn('marxy: the reading’s details could not be drawn', error);
    }
    st.how = { key: howKey, el };
  }
  if (st.how.el.childNodes.length > 0) body.append(st.how.el);

  // The fenced parts read on their own: each goes to its lines, and its verbs read it another way.
  for (const p of parts) {
    const guessed = partGuessed(p.part, p.reading, p.chosen);
    body.append(
      row({
        k: `part:${p.part.key}`,
        d: 1,
        nm: `Lines ${p.part.firstLine} to ${p.part.lastLine}`,
        as: [PART_WORDS[p.reading].short, p.chosen ? 'yours' : guessed ? 'guessed' : ''].filter(Boolean).join(' · '),
        g: guessed,
        go: 'go',
        what: `Lines ${p.part.firstLine} to ${p.part.lastLine}`,
        run: () => void goByte(handle, path, p.part.start),
        verbs: () =>
          p.part.ways.map((way, i): Verb => [String(i + 1), `read as ${partLongName(p.part, way, buffer.bytes)}${way === p.reading ? ' (now)' : ''}`, () => choosePart(path, p.part.key, way === p.part.guess ? null : way)]),
      }),
    );
  }

  // The file, as stored.
  const facts: StoredFacts = memo(st, `stored|${path}`, sig, () => storedFacts(buffer.bytes));
  const words = memo(st, `words|${path}`, sig, () => countWords(buffer.text, { markdown: countsAsMarkdown(path) }));
  const showInvisible = (): void => {
    void (async () => {
      if (pane.view.mode !== 'source') await handle.toggleMode();
      if (canRun(handle, 'view.toggle-show-whitespace')) await runCommand(handle, 'view.toggle-show-whitespace');
    })();
  };
  const size = held ? held.fileBytes : buffer.bytes.length;
  body.append(sec('The file', 'as stored'));
  body.append(kv('Size', buffer.bytes.length === 0 ? 'Empty: 0 bytes' : `${nf(size)} bytes · ${plural(facts.lines, 'line')} · ${plural(words, 'word')}`, { title: sizeFact(size) }));
  const enc = held ? encodingFactWords(held, facts.eol.toUpperCase()) : `${encodingFact(buffer).label}, ${buffer.bom ? 'with a byte order mark' : 'no byte order mark'}`;
  body.append(kv('Bytes', enc, held?.how === 'guess' ? { vcls: 'marxy-l-odd' } : undefined));
  const oddEnds = facts.eol === 'mixed' || (facts.lines > 0 && !facts.finalNewline);
  body.append(kv('Line ends', eolWords(facts), oddEnds ? { vcls: 'marxy-l-odd', k: 'f:eol', run: showInvisible, go: 'show them', what: 'Line ends', title: 'Shows the file in Source with every line end drawn' } : undefined));
  body.append(kv('Indent', INDENT_WORDS[facts.indent], facts.indent === 'mixed' ? { vcls: 'marxy-l-odd' } : undefined));
  body.append(kv('Modified', isArchiveEntry(path) ? 'As the archive says' : modifiedOf(ctx, path)));
  body.append(kv('In', whereWords(path), { title: path }));

  // Odd: invisible and ambiguous characters, each kind a lens on the parts that hold them.
  const hidden = memo(st, `odd|${path}`, sig, () => scanHidden(buffer, parsed ? snap.ast : null, !markdown, 400));
  if (hidden.items.length === 0) body.append(kv('Odd', 'Nothing invisible or ambiguous'));
  else {
    const by = new Map<string, number[]>();
    for (const it of hidden.items) by.set(it.name, [...(by.get(it.name) ?? []), it.byte]);
    let first = true;
    const canLens = markdown && parsed && pane.view.mode === 'rendered';
    for (const [name, bytes] of by) {
      const label = first ? 'Odd' : '';
      first = false;
      const ranges = (): Range[] => bytes.map((b) => ({ start: b, end: b + 1 }));
      if (canLens) {
        const on = lensOf(pane.article) === 'odd';
        const flip = (): void => {
          setLensOn(depthTarget(pane), on ? null : { id: 'odd', label: 'Odd characters', ranges: ranges() });
          ctx.redraw();
        };
        body.append(kv(label, `${bytes.length} × ${name}`, { vcls: 'marxy-l-odd', k: `odd:${name}`, run: flip, go: on ? 'show everything' : 'only the parts with these', what: name, title: `First on line ${lineOfByte(lineStarts(buffer), bytes[0]!)}`, verbs: () => [['v', on ? 'show everything' : 'only those parts', flip], ['x', 'show them in Source', showInvisible]] }));
      } else body.append(kv(label, `${bytes.length} × ${name}`, { vcls: 'marxy-l-odd', k: `odd:${name}`, run: () => void goByte(handle, path, bytes[0]!), go: 'go to the first', what: name, verbs: () => [['x', 'show them in Source', showInvisible]] }));
    }
  }

  // Written in it: what the file says about itself.
  writtenIn(ctx, pane, path, store, reading, kind, body);

  // It holds.
  const starts = lineStarts(buffer);
  const links = linkCount(handle, pane, path);
  const toLinks = row({ k: 'h:links', nm: 'Links and written paths', as: 'in Links', n: links === null ? '…' : links, go: 'open Links', run: () => handle.frame().left.show('links') });
  if (markdown && parsed) {
    const hs = memo(st, `holds|${path}`, sig, () => holdsOf(snap.ast));
    body.append(sec('It holds', 'click a row to show only that'));
    if (hs.tasks > 0) {
      const bar = h('span', 'marxy-l-prog', h('u', ''));
      (bar.firstChild as HTMLElement).style.width = `${Math.round((hs.done / hs.tasks) * 100)}%`;
      const copyOpen = (): void => {
        const text = hs.open.map((r) => new TextDecoder().decode(buffer.bytes.subarray(r.start, r.end)).split(/\r?\n/)[0]).join('\n');
        copyText(handle, text, `Copied ${plural(hs.open.length, 'open task')} as written`);
      };
      body.append(lensRow(ctx, pane, 'tasks', () => hs.open, { nm: 'Tasks', post: h('span', 'marxy-l-holds', bar, h('span', 'marxy-l-as', `${hs.done} of ${hs.tasks} done`)), what: 'Tasks' }, () => [['c', 'copy the open ones', copyOpen]]));
    }
    if (hs.fences.length > 0) body.append(lensRow(ctx, pane, 'code', () => hs.fences, { nm: 'Fenced parts', as: hs.langs.join(' · '), n: hs.fences.length, what: 'Fenced parts' }));
    if (hs.tables.length > 0) body.append(lensRow(ctx, pane, 'tables', () => hs.tables, { nm: 'Tables', n: hs.tables.length, what: 'Tables' }));
    if (hs.foots.length > 0) body.append(row({ k: 'h:foot', nm: 'Footnotes', n: hs.foots.length, ...(proposalOn('notes_in_place') && pane.view.mode === 'rendered' ? { as: notesInMargin(pane.article) ? 'in the margin' : 'the margin has no room' } : {}), go: 'go to the first', run: () => void goByte(handle, path, hs.foots[0]!) }));
    body.append(toLinks);
    const notes = notesFor(path);
    if (notes.length > 0) body.append(lensRow(ctx, pane, 'notes', () => notes.map((n) => ({ start: byteOfLine(starts, n.l0 + 1), end: byteOfLine(starts, n.l0 + 1) + 1 })), { nm: 'Your notes', n: notes.length, what: 'Your notes' }));
    if (hs.tasks === 0 && hs.fences.length === 0 && hs.tables.length === 0 && hs.foots.length === 0 && notes.length === 0) body.append(hint('No tasks, fenced parts, tables or footnotes.'));
  } else {
    body.append(sec('It holds', ''));
    const toOutline = (k: string, nm: string, n: number | string, as?: string): HTMLElement => row({ k: `h:${k}`, nm, n, ...(as ? { as } : {}), go: 'see them in Outline', run: () => handle.frame().left.show('outline') });
    if (kind === 'log') {
      const s = logShapeFor(pane.article, buffer, () => pane.content.store()?.snapshot().buffer.bytes ?? null, () => ctx.redraw())?.summary ?? null;
      const names = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
      if (s === null) body.append(hint('Reading the log…'));
      else body.append(toOutline('entries', 'Entries', s.counts.reduce((a, b) => a + b, 0)));
      if (s?.first) body.append(kv('From', s.first));
      if (s?.last) body.append(kv('To', s.last));
      s?.counts.forEach((n, rank) => {
        if (n === 0) return;
        const id = (['all', 'info', 'warn', 'error'] as const)[rank]!;
        body.append(row({ k: `lv:${names[rank]!.toLowerCase()}`, nm: h('span', `marxy-l-lv marxy-l-lv${rank}`, names[rank]!), n, what: names[rank]!, go: rank === 0 ? 'show every line' : `show ${names[rank]!.toLowerCase()} and above`, run: () => void setLogLevel(levelOf(id)) }));
      });
    } else if (reading?.contents) {
      body.append(toOutline('contents', reading.contents.title, reading.contents.items.length, reading.contents.detail));
    } else body.append(row({ k: 'h:lines', nm: 'Lines', n: facts.lines, go: 'go to the first', run: () => void goByte(handle, path, 0) }));
    body.append(toLinks);
    const notes = notesFor(path);
    if (notes.length > 0) body.append(row({ k: 'h:notes', nm: 'Your notes', n: notes.length, go: 'go to the first', run: () => void goByte(handle, path, byteOfLine(starts, notes[0]!.l0 + 1)) }));
  }

  if (comparison.relevant(cardContext(handle, pane, path))) {
    st.hosted = hostedFor(st.hosted, JSON.stringify(['cmp', path, ctx.rev()]));
    const el = hostCard(st.hosted, 'now-comparison', comparison, cardContext(handle, pane, path));
    if (el) body.append(sec('Compared', 'nothing kept'), el);
  }

  // The part under the cursor: what the Selection and This section cards said that the verb bar does not.
  thisPart(ctx, pane, path, store, starts, body);
}

function writtenIn(ctx: Ctx, pane: PaneView, path: string, store: NonNullable<ReturnType<PaneView['content']['store']>>, reading: Reading | null, kind: string | null, body: HTMLElement): void {
  const { handle } = ctx;
  const buffer = store.snapshot().buffer;
  const starts = lineStarts(buffer);
  const said: [string, string, number][] = [];
  let note = '';
  if (reading?.meta) {
    note = reading.meta.title;
    for (const r of reading.meta.rows) said.push([r.key, r.value, -1]);
  } else if (kind === 'diff') {
    note = 'its header';
    const lines = buffer.text.split('\n', 40);
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.replace(/\r$/, '');
      if (/^(diff |--- |Index: )/.test(t)) break;
      const commit = /^From ([0-9a-f]{7,40})\b/.exec(t);
      const head = /^(From|Date|Subject|To|Cc):\s+(.*)$/.exec(t);
      if (commit) said.push(['Commit', commit[1]!.slice(0, 12), i + 1]);
      else if (head) said.push([head[1]!, head[2]!, i + 1]);
    }
  } else {
    const fm = store.parsed() ? frontMatterOf(store)?.values : null;
    if (fm && !fm.unreadable) {
      note = 'front matter';
      for (const e of fm.values) said.push([e.key, e.value, e.line]);
    } else if (fm?.unreadable) {
      body.append(sec('Written in it', 'front matter'), hint(`It could not be read: ${fm.unreadable}.`));
      return;
    }
  }
  if (said.length === 0) return;
  body.append(sec('Written in it', note));
  for (const [key, v, line] of said)
    body.append(
      kv(key, v, {
        k: `w:${key}`,
        title: v,
        what: key,
        ...(line > 0 ? { go: 'go', run: () => void goByte(handle, path, byteOfLine(starts, line)) } : { go: 'copy', run: () => copyText(handle, v, `Copied ${key}`) }),
        verbs: () => [['c', 'copy', () => copyText(handle, v, `Copied ${key}`)]],
      }),
    );
}

function thisPart(ctx: Ctx, pane: PaneView, path: string, store: NonNullable<ReturnType<PaneView['content']['store']>>, starts: Int32Array, body: HTMLElement): void {
  const r = ctx.handle.selection.cursorReady() ? partRange(ctx.handle.selection.state().selection) : null;
  if (!r) return;
  const snap = store.snapshot();
  const a = lineOfByte(starts, r.start);
  const b = lineOfByte(starts, Math.max(r.start, r.end - 1));
  const text = new TextDecoder().decode(snap.buffer.bytes.subarray(r.start, r.end));
  body.append(sec('This part', a === b ? `line ${a}` : `lines ${a} to ${b}`));
  body.append(kv('Words', plural(countWords(text, { markdown: countsAsMarkdown(path) }), 'word')));
  if (store.parsed()) {
    const heads = outlineModelFor(snap.ast, snap.buffer).rows.filter((x): x is HeadingRow => x.kind === 'heading');
    let at: HeadingRow | null = null;
    for (const hd of heads) if (hd.start <= r.start) at = hd;
    if (at) body.append(kv('In', `§ ${at.text}`, { title: `${plural(at.words, 'word')} in this section` }));
  }
}

/** A file read as its bytes: no reading (what was tried), or Bytes because the reader asked. */
function bytesAccount(ctx: Ctx, pane: PaneView, path: string, body: HTMLElement, chosen: boolean): void {
  const { handle, st } = ctx;
  const hidden = !!pane.content.viewer()?.bytesHidden;
  if (!hidden && !st.heads.has(path)) {
    st.heads.set(path, null);
    void handle.shell
      .readHead(path, 4096)
      .then((b) => {
        st.heads.set(path, b);
        ctx.redraw();
      })
      .catch(() => {
        st.heads.set(path, new Uint8Array());
        ctx.redraw();
      });
  }
  const b = st.heads.get(path) ?? null;
  const magic = b ? magicOf(b) : null;
  if (hidden) body.append(hero('A private key', 'The panel shows none of its bytes. Source shows the file, when you switch to it.'));
  else if (chosen) body.append(hero('Bytes', 'The file as it is stored, because you asked for it. Read as, below, puts the reading back.'));
  else body.append(hero('No reading', `Shown as its bytes. ${magic ? `It begins like ${magic.format}, which this app has no page for.` : 'Nothing in the first bytes or the name says what it is.'}`, true));
  body.append(shownTool(ctx, pane, false, false));
  howShown(pane, body);
  // The file card's own cards: its Reading (why, folded), its Facts, and a byte picked in the hex view.
  const viewer = pane.content.viewer();
  const mode = pane.view.mode;
  st.hosted = hostedFor(st.hosted, JSON.stringify(['bytes', path, mode, viewer?.panelKey() ?? '', ctx.rev()]));
  const cctx = cardContext(handle, pane, path);
  const cards = viewer ? safe(() => viewer.cards(mode), {}) : {};
  const passing = viewer ? safe(() => viewer.passing(mode), []) : [];
  const readingCard = cards.reading ? hostCard(st.hosted, 'reading', cards.reading, cctx) : null;
  if (readingCard) body.append(readingCard);
  if (hidden) {
    const own = cards.facts ? hostCard(st.hosted, 'facts', cards.facts, cctx) : null;
    body.append(sec('The file', 'as stored'));
    if (own) body.append(own);
    return;
  }
  if (!b) {
    body.append(empty('Reading its first bytes…'));
    return;
  }
  if (b.length > 0) {
    const box = h('div', 'marxy-l-hex');
    hexRows(b, 2, [0, magic?.len ?? 0]).forEach((cells, i) => {
      if (i > 0) box.append('\n');
      for (const c of cells) box.append(c.sep, c.marked ? h('b', '', c.hex) : c.hex);
    });
    body.append(box);
  }
  const t = utf8Trial(b);
  const rd8 = readable(b);
  const H = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
  const utf = t.bad >= 0 ? `will not decode: byte ${H(b[t.bad]!)} at ${nf(t.bad)}` : t.zero >= 0 ? `decodes, but byte 00 at ${nf(t.zero)} is no text` : 'decodes';
  const tried = (k: string, nm: string, as: string, o: RowOptions = {}): HTMLElement => row({ k, nm, as, go: 'copy', what: nm, run: () => copyText(handle, `${nm}: ${as}`, `Copied “${nm}: ${as}”`), ...o });
  if (!chosen) {
    body.append(
      sec('Tried', 'Read as tries the rest'),
      tried('t:utf8', 'Text, UTF-8', utf, { red: t.bad >= 0 || t.zero >= 0 }),
      tried('t:1252', 'Text, Windows-1252', b.length ? `${rd8.percent}% readable` : 'empty'),
      tried('t:known', 'A known format', magic ? magic.format : 'none recognised', magic ? {} : { cls: 'dim' }),
    );
  }
  readAsRows(ctx, path, body);
  const head4 = [...b.subarray(0, 4)];
  const printable = head4.length === 4 && head4.every((c) => c >= 32 && c < 127);
  const factsCard = cards.facts ? hostCard(st.hosted, 'facts', cards.facts, cctx) : null;
  body.append(sec('The file', 'as stored'));
  if (factsCard) body.append(factsCard);
  else body.append(kv('Size', plural(st.sizes.get(path) ?? b.length, 'byte')), kv('Modified', modifiedOf(ctx, path)), kv('In', whereWords(path), { title: path }));
  body.append(
    kv('Begins', b.length ? (printable ? `"${String.fromCharCode(...head4)}"` : head4.map(H).join(' ')) : 'nothing: it is empty'),
    kv('Words in it', `${plural(rd8.runs, 'run')} of readable text`),
  );
  for (const def of passing) {
    const el = hostCard(st.hosted, `now-${safe(() => def.title(cctx), '').toLowerCase()}`, def, cctx);
    if (el) body.append(sec('This part', [safe(() => def.title(cctx), ''), safe(() => def.detail?.(cctx) ?? '', '')].filter(Boolean).join(' · ')), el);
  }
}

/** A page of the app's own (an image, a PDF, a font…): its name and words, then its own cards in the panel's sections. */
function viewerAccount(ctx: Ctx, pane: PaneView, viewer: PaneViewer, path: string, body: HTMLElement): void {
  const { handle, st } = ctx;
  const mode = pane.view.mode;
  const say = viewer.headSay();
  const sel = handle.selection.state().selection;
  const selKey = sel.kind === 'node' ? `${sel.node.src.start}` : '';
  st.hosted = hostedFor(st.hosted, JSON.stringify([path, mode, viewer.panelKey(), selKey, ctx.rev()]));
  const cctx = cardContext(handle, pane, path);
  const cards = safe(() => viewer.cards(mode), {});
  const passing = safe(() => viewer.passing(mode), []);
  if (!cards.reading) body.append(hero('Not opened', 'This file could not be opened; The file says why.', true));
  else body.append(hero(VIEWER_NAMES[viewer.kind], say?.text ?? ''));
  body.append(shownTool(ctx, pane, false, false));
  howShown(pane, body);
  type Def = (typeof cards)[keyof typeof cards];
  const host = (id: string, def: Def): HTMLElement | null => (def ? hostCard(st.hosted!, id, def, cctx) : null);
  // A card's own name goes in its section's note: the section says where it belongs, the note what it is.
  const named = (def: Def): string => (def ? [safe(() => def.title(cctx), ''), safe(() => def.detail?.(cctx) ?? '', '')].filter(Boolean).join(' · ') : '');
  const reading = host('reading', cards.reading);
  if (reading) body.append(reading);
  readAsRows(ctx, path, body);
  const facts = host('facts', cards.facts ?? (viewer.binary ? undefined : textFactsCard));
  if (facts) body.append(sec('The file', 'as stored'), facts);
  else body.append(sec('The file', 'as stored'), kv('Modified', modifiedOf(ctx, path)), kv('In', whereWords(path), { title: path }));
  const meta = host('frontmatter', cards.frontmatter);
  if (meta) body.append(sec('Written in it', named(cards.frontmatter)), meta);
  const notes = host('notes', cards.notes);
  if (notes) body.append(sec('It holds', named(cards.notes)), notes);
  for (const def of passing) {
    const el = host(`now-${safe(() => def.title(cctx), '').toLowerCase()}`, def);
    if (el) body.append(sec('This part', named(def)), el);
  }
}

/** The page's account, as the page has it folded under its first line: the same sentences, open here. */
function howShown(pane: PaneView, body: HTMLElement): void {
  const lines = accountLinesIn(pane.host);
  if (lines.length === 0) return;
  body.append(sec('How this is shown', 'the app’s words, not the file’s'));
  const box = document.createElement('div');
  box.className = 'marxy-l-account';
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    box.append(p);
  }
  body.append(box);
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const panel: PanelDef<MetadataState> = {
  id: 'metadata',
  name: 'Metadata',
  rest: 'Tab comes here. J K move, V shows only that part of the page.',
  init: () => ({ memo: new Map(), mtimes: new Map(), statOf: new Map(), heads: new Map(), ladder: new Set(), sizes: new Map() }),
  subject: subjectOf,
  take(ctx, arg) {
    // The Line keeps `&`'s reading (`{ q, reading }`: '' the one found, 'bytes', a kind, 'page') and `%`'s lens (`{ q, lens }`).
    const a = (arg ?? {}) as { card?: unknown; reading?: unknown; lens?: unknown };
    if (a.card === 'reading') ctx.st.toReadAs = true;
    const pane = ctx.pane();
    const path = pane?.path() ?? null;
    if (typeof a.reading === 'string' && path !== null) {
      // Its row is shown even when it is one of the other ways, folded by default.
      ctx.st.ladder.add(path);
      ctx.cursorTo(`ra:${a.reading || 'found'}`);
    }
    if (typeof a.lens === 'string' && pane) {
      const lens = lensesOf(pane).find((l) => l.id === a.lens);
      if (lens && setLens(pane, lens.id, lens.label) !== null && LENS_ROWS.has(lens.id)) ctx.cursorTo(`l:${lens.id}`);
    }
  },
  buttons: (ctx) => {
    const path = ctx.pane()?.path();
    if (!path) return [];
    return [{ label: '⋯', icon: 'copy', title: 'Copy its path', run: () => copyText(ctx.handle, path, `Copied ${path}`) }];
  },
  render(ctx, body) {
    ctx.st.offs ??= followSignals(ctx);
    // Colour anyway changes the tier the reading's details show: they are drawn again.
    ctx.st.offColour ??= onColourChoice(() => {
      ctx.st.how = undefined;
      ctx.redraw();
    });
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
    const viewer = pane.content.viewer();
    const owned = viewer?.owns(pane.view.mode) ? viewer : null;
    // The file card with no Reading card of its own is a file that could not be opened: its own cards say why.
    if (owned?.kind === 'card' && safe(() => !!owned.cards(pane.view.mode).reading, false)) bytesAccount(ctx, pane, path, body, bytesChosen(path));
    else if (owned) viewerAccount(ctx, pane, owned, path, body);
    else textAccount(ctx, pane, path, body);
    if (ctx.st.toReadAs) {
      ctx.st.toReadAs = false;
      body.querySelector('[data-marxy-left-row^="ra:"]')?.scrollIntoView({ block: 'center' });
    }
  },
  light(ctx, body) {
    const pane = ctx.pane();
    const buttons = body.querySelectorAll<HTMLButtonElement>('.marxy-l-tool .marxy-l-sg button');
    if (!pane || buttons.length === 0) return;
    const on = shownAt(pane);
    const ids = ['read', 'reveal', 'xray', 'source'];
    for (const b of buttons) {
      const id = ids.find((x) => x === (b.textContent ?? '').toLowerCase().replace('-', '')) ?? '';
      b.classList.toggle('marxy-l-on', id === on);
      b.setAttribute('aria-pressed', String(id === on));
    }
  },
};

export default panel;
