// The derived transcript view's page half (K-12; ADR-0061): a `.jsonl` agent session, in Read, as the conversation it
// records. Rendered (`view/rendered-view.ts`) mounts it in the pane's article in place of a page, loaded on demand: nothing
// on the way to first text imports this module (F-111).
//
// What it promises:
// - **It never writes** (commitment 3, ADR-0061 item 6). The tree is core's `jsonl-transcript` deriver over the store's
//   bytes; folds, filters and the selected turn are view state; no derived range reaches a splice. The app's own selection
//   never resolves inside it (`selection/view.ts` leaves `[data-marxy-derived]` alone), so no registered operation is
//   offered on what it shows: its menus hold only verbs that read (Copy, Copy as, Source lines, Jump to source).
// - **Nothing hidden silently** (commitment 4). The view opens with one line saying what it was derived from and what it
//   left out, each count unfolding to its lines by record type, each line a Jump to source. A bidi control, a zero-width
//   character and an ESC are their markers; a replacement character Marxy made is marked apart from one the file holds.
//   A filter leaves one line where each run of turns it hides was, saying how many.
// - **First text never waits for the whole file** (commitment 5). The first slice of lines is derived and its turns drawn
//   in the task that mounts the view; the rest is derived and drawn a few milliseconds a slice, the loop given back
//   between slices. `state().firstPaint` records how far the deriver had read when the first rows were painted.
import type { DerivedThinking, DerivedTool, DerivedTranscript, DerivedTurn, TranscriptPending, TranscriptUnreadable } from '@marxy/core/src/contracts/derived.ts';
import { createTranscriptDeriver, lineStartOf, type TranscriptDeriver } from '@marxy/core/src/derive/jsonl-transcript.ts';
import {
  countsOf,
  headHtml,
  rowHtml,
  sourceLinesOf,
  thinkingBodyHtml,
  toolBodyHtml,
  toolName,
  toolOutput,
  turnText,
  unreadableBodyHtml,
  userPrompts,
  type TranscriptRow,
} from '@marxy/core/src/derive/transcript-html.ts';
import { appHandle } from '../commands/app-handle.ts';
import { writeCopy } from '../commands/copy-write.ts';
import { applyLinkDestinations } from '../render/link-dest.ts';
import type { Block, BlockList } from '../render/post.ts';
import { buildAppContext } from '../selection/bind.ts';
import { closeVerbMenu, openVerbMenu, type MenuAnchor, type VerbMenuRow } from '../selection/verb-menu.ts';

/** The root's attribute (scripts/registry.json): the deriver that made the view. */
export const DERIVED_ATTRIBUTE = 'data-marxy-derived';
/** Bytes the first slice reads before anything is drawn: well over a screen of turns. */
const FIRST_SLICE_BYTES = 64 * 1024;
/** Rows drawn before the first frame, at least (fewer when the file has fewer). */
const FIRST_ROWS = 24;
/** Bytes each later slice reads. */
const SLICE_BYTES = 256 * 1024;
/** A slice of deriving and drawing holds the main thread about this long. */
const SLICE_MS = 8;

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Gives the loop back through a message, not a timer (a timer's clamp would add 4 ms a slice). */
function yieldNow(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export type Only = 'you' | 'agent' | null;

export interface TranscriptState {
  readonly done: boolean;
  /** Slices the deriver has read so far, and the bytes and lines. */
  readonly slices: number;
  readonly bytesRead: number;
  readonly bytes: number;
  readonly lines: number;
  /** Rows on the page, and rows in the tree. */
  readonly rows: number;
  readonly treeRows: number;
  /** When the first rows were painted: how far the deriver had read, and how long the mount had taken. */
  readonly firstPaint: { readonly slices: number; readonly bytesRead: number; readonly rows: number; readonly ms: number; readonly at: number } | null;
  readonly only: Only;
  readonly toolsCollapsed: boolean;
  /** Turns a filter hides now, and tool units folded into run lines. */
  readonly hiddenTurns: number;
  readonly hiddenTools: number;
  /** The selected turn's index among the rows, or null. */
  readonly selected: number | null;
}

export interface TranscriptMountOptions {
  readonly article: HTMLElement;
  readonly bytes: Uint8Array;
  readonly path: string;
  /** Rows through this byte are drawn before the first frame (a place to land on). */
  readonly through?: number;
  /** The filters of the view this one replaces (a reload): kept, as the reader left them. */
  readonly carry?: { readonly only: Only; readonly toolsCollapsed: boolean };
  /** Rows were added: the view's block list and held place follow. */
  readonly onGrow: () => void;
  /** Leaves Read for Source with bytes `[start, end)` selected. */
  readonly jumpToSource: (start: number, end: number) => Promise<void>;
  /** Leaves Read for Source at the place the reader is. */
  readonly openSource: () => Promise<void>;
}

export interface TranscriptView {
  readonly root: HTMLElement;
  readonly bytes: Uint8Array;
  readonly tree: DerivedTranscript;
  /** The block list of what is on the page: each leaf, tool, thinking and row, at the start of its line. */
  blocks(): BlockList;
  /** Derives and draws every row through `byte`, now. */
  ensureThrough(byte: number): void;
  /** Resolves once the whole file is derived and drawn. */
  settled(): Promise<void>;
  setOnly(who: Only): void;
  setToolsCollapsed(on: boolean): void;
  selectTurn(index: number | null): void;
  copySelection(): Promise<void>;
  state(): TranscriptState;
  destroy(): void;
}

const views = new WeakMap<HTMLElement, TranscriptView>();

/** The transcript view mounted in `article`, if one is. */
export function transcriptIn(article: HTMLElement | null | undefined): TranscriptView | null {
  return article ? (views.get(article) ?? null) : null;
}

/** Text a reader sees, with what is only drawn left out: an invisible's label (its character is kept) and a link's destination. */
const DISPLAY_ONLY = '.marxy-invisible-glyph, .marxy-link-dest';

/** Mounts the view in `opts.article`, replacing what it held; the first rows are on the page when this returns. */
export function mountTranscript(opts: TranscriptMountOptions): TranscriptView {
  const { article, bytes, path } = opts;
  const t0 = performance.now();
  const deriver: TranscriptDeriver = createTranscriptDeriver(bytes, path);
  const tree = deriver.tree;
  const root = document.createElement('div');
  root.setAttribute(DERIVED_ATTRIBUTE, 'jsonl-transcript');
  root.className = 'marxy-transcript';
  const head = document.createElement('div');
  head.className = 'marxy-transcript-header';
  root.append(head);
  /** The row elements in tree order, and the row each stands for. */
  const rowEls: HTMLElement[] = [];
  const rowOf = new WeakMap<HTMLElement, TranscriptRow>();
  /** The tool and thinking nodes of a drawn row's folds, by element. */
  const foldOf = new WeakMap<HTMLElement, DerivedTool | DerivedThinking | TranscriptUnreadable | TranscriptPending>();
  const open = new WeakSet<DerivedTool | DerivedThinking>();
  let only: Only = opts.carry?.only ?? null;
  let toolsCollapsed = opts.carry?.toolsCollapsed ?? false;
  let selected: number | null = null;
  let closed = false;
  let firstPaint: TranscriptState['firstPaint'] = null;
  let headDone: boolean | null = null;
  let headCounts = '';
  let reading: Promise<void> = Promise.resolve();
  const template = document.createElement('template');

  function drawHead(): void {
    const counts = countsOf(tree);
    const key = `${deriver.done}:${counts.lines}:${counts.notShown}:${counts.unknown}:${counts.unreadable}`;
    if (key === headCounts) return;
    // A count unfolded stays unfolded as it grows.
    const openLists = [...head.querySelectorAll<HTMLElement>('.marxy-transcript-count[aria-expanded="true"]')].map((b) => b.dataset.marxyDropped);
    headCounts = key;
    headDone = deriver.done;
    template.innerHTML = headHtml(counts, { done: deriver.done, sourceKey: sourceKey() });
    head.replaceChildren(template.content);
    for (const which of openLists) toggleDropped(which ?? '', true);
  }

  /** Draws the settled rows not yet on the page (every row once the file is read), up to `deadline`. */
  function drawRows(deadline = Number.POSITIVE_INFINITY): number {
    const upto = deriver.settled;
    let added = 0;
    const batch: TranscriptRow[] = [];
    let html = '';
    while (rowEls.length + batch.length < upto) {
      const row = tree.children[rowEls.length + batch.length]!;
      batch.push(row);
      html += rowHtml(row, bytes, { path });
      if (performance.now() > deadline && batch.length >= 1) break;
    }
    if (batch.length === 0) return 0;
    template.innerHTML = html;
    const made = [...template.content.children] as HTMLElement[];
    for (let k = 0; k < made.length; k++) {
      const el = made[k]!;
      const row = batch[k]!;
      rowOf.set(el, row);
      if (row.type === 'turn') {
        const folds = el.querySelectorAll<HTMLElement>(':scope > .marxy-tool, :scope > .marxy-thinking');
        const units = row.children.filter((c): c is DerivedTool | DerivedThinking => c.type === 'tool' || c.type === 'thinking');
        folds.forEach((f, i) => foldOf.set(f, units[i]!));
      } else if (row.type === 'unreadable') foldOf.set(el, row);
      rowEls.push(el);
      added++;
    }
    applyLinkDestinations(template.content);
    root.append(template.content);
    if (only !== null || toolsCollapsed) markRuns();
    return added;
  }

  /** Derives and draws until `enough` says so or the file is read, without giving the loop back. */
  function readNow(enough: () => boolean): void {
    while (!deriver.done && !enough()) deriver.step(SLICE_BYTES);
    drawRows();
    drawHead();
  }

  async function readRest(): Promise<void> {
    while (!closed && (!deriver.done || rowEls.length < tree.children.length)) {
      await yieldNow();
      if (closed) return;
      const deadline = performance.now() + SLICE_MS;
      let added = 0;
      while (!closed && performance.now() < deadline) {
        if (!deriver.done && rowEls.length >= deriver.settled) deriver.step(SLICE_BYTES);
        added += drawRows(deadline);
        if (deriver.done && rowEls.length >= tree.children.length) break;
      }
      drawHead();
      if (added > 0) opts.onGrow();
    }
    if (!closed && headDone !== true) drawHead();
  }

  // ---- the first screen, in this task ------------------------------------------------------------------------------------
  deriver.step(FIRST_SLICE_BYTES);
  readNow(() => deriver.settled >= FIRST_ROWS || (opts.through !== undefined && deriver.bytesRead > opts.through && deriver.settled > 0));
  if (only !== null) root.setAttribute('data-marxy-transcript-only', only);
  if (toolsCollapsed) root.setAttribute('data-marxy-transcript-tools', 'collapsed');
  article.replaceChildren(root);
  if (only !== null || toolsCollapsed) markRuns();
  requestAnimationFrame(() => {
    if (closed || firstPaint !== null) return;
    const at = performance.now();
    firstPaint = { slices: deriver.slices, bytesRead: deriver.bytesRead, rows: rowEls.length, ms: at - t0, at };
    console.info(`marxy: transcript first paint after ${firstPaint.ms.toFixed(1)} ms, ${firstPaint.slices} of the deriver's slices, ${firstPaint.bytesRead} of ${bytes.length} bytes`);
  });
  reading = readRest();

  // ---- filters: Only you, Only assistant, Collapse tools -----------------------------------------------------------------

  /**
   * The filters on the page: each turn or tool unit a filter hides is `hidden` (no rule of a theme is needed for it), and
   * one line stands where each run of them was, saying how many (ADR-0061 item 7; the card's filters).
   */
  function markRuns(): void {
    for (const el of root.querySelectorAll('.marxy-transcript-hidden-run')) el.remove();
    for (const el of rowEls) {
      const row = rowOf.get(el);
      if (row?.type !== 'turn') continue;
      el.hidden = only !== null && row.speaker !== only;
      for (const child of el.children) if (child.classList.contains('marxy-tool')) (child as HTMLElement).hidden = toolsCollapsed;
    }
    if (only !== null) {
      let run: HTMLElement[] = [];
      const flush = (): void => {
        if (run.length === 0) return;
        const line = document.createElement('p');
        line.className = 'marxy-transcript-hidden-run';
        const who = only === 'you' ? 'the assistant' : 'you';
        line.textContent = `${plural(run.length, 'turn')} from ${who} hidden`;
        run[0]!.before(line);
        run = [];
      };
      for (const el of rowEls) {
        const row = rowOf.get(el);
        if (row?.type === 'turn' && row.speaker !== only) run.push(el);
        else flush();
      }
      flush();
    }
    if (toolsCollapsed) {
      for (const el of rowEls) {
        const row = rowOf.get(el);
        if (row?.type !== 'turn') continue;
        let run: HTMLElement[] = [];
        const flush = (): void => {
          if (run.length === 0) return;
          const names = run.map((f) => {
            const unit = foldOf.get(f);
            return unit?.type === 'tool' ? (unit.orphan ? 'result' : toolName(unit)) : 'thinking';
          });
          const line = document.createElement('p');
          line.className = 'marxy-transcript-hidden-run';
          const shown = [...new Set(names)].slice(0, 4).join(', ');
          line.textContent = `${plural(run.length, 'tool call')} collapsed: ${shown}${new Set(names).size > 4 ? ', …' : ''}`;
          run[0]!.before(line);
          run = [];
        };
        for (const child of el.children) {
          if (child.classList.contains('marxy-tool')) run.push(child as HTMLElement);
          else if (!child.classList.contains('marxy-transcript-hidden-run')) flush();
        }
        flush();
      }
    }
  }

  function hiddenCounts(): { turns: number; tools: number } {
    let turns = 0;
    let tools = 0;
    for (const el of rowEls) {
      const row = rowOf.get(el);
      if (row?.type !== 'turn') continue;
      if (only !== null && row.speaker !== only) turns++;
      else if (toolsCollapsed) tools += row.children.filter((c) => c.type === 'tool').length;
    }
    return { turns, tools };
  }

  // ---- folds, selection, copy, menus ------------------------------------------------------------------------------------

  function setFold(el: HTMLElement, on: boolean): void {
    const unit = foldOf.get(el);
    const line = el.querySelector<HTMLElement>(':scope > .marxy-tool-line');
    const body = el.querySelector<HTMLElement>(':scope > .marxy-tool-body');
    if (!unit || !line || !body) return;
    if (on && body.childElementCount === 0) {
      template.innerHTML =
        unit.type === 'tool' ? toolBodyHtml(unit) : unit.type === 'thinking' ? thinkingBodyHtml(unit, { path }) : unreadableBodyHtml(unit, bytes);
      applyLinkDestinations(template.content);
      body.replaceChildren(template.content);
    }
    body.hidden = !on;
    line.setAttribute('aria-expanded', String(on));
    if (unit.type === 'tool' || unit.type === 'thinking') {
      if (on) open.add(unit);
      else open.delete(unit);
    }
    opts.onGrow();
  }

  function toggleDropped(which: string, on?: boolean): void {
    const button = head.querySelector<HTMLElement>(`.marxy-transcript-count[data-marxy-dropped="${which}"]`);
    const list = head.querySelector<HTMLElement>(`ul.marxy-transcript-dropped[data-marxy-dropped="${which}"]`);
    if (!button || !list) return;
    const next = on ?? button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(next));
    list.hidden = !next;
  }

  function selectTurn(index: number | null, focus = true): void {
    for (const el of root.querySelectorAll('.marxy-turn-selected')) el.classList.remove('marxy-turn-selected');
    const el = index === null ? null : rowEls[index];
    selected = el && rowOf.get(el)?.type === 'turn' ? index : null;
    if (selected !== null && el) {
      el.classList.add('marxy-turn-selected');
      if (focus) el.focus({ preventScroll: true });
    }
  }

  const selectedTurn = (): DerivedTurn | null => {
    const row = selected === null ? null : rowOf.get(rowEls[selected]!);
    return row?.type === 'turn' ? row : null;
  };

  const ctx = () => buildAppContext(appHandle());

  async function copyTurn(turn: DerivedTurn): Promise<void> {
    await writeCopy(ctx(), { text: turnText(turn, (unit) => open.has(unit)) }, `Copied the ${turn.speaker === 'you' ? 'prompt' : 'turn'}`);
  }

  async function copyOutput(tool: DerivedTool): Promise<void> {
    // The whole output, folded or not, bounded on the page or not (ADR-0061 item 5).
    await writeCopy(ctx(), { text: toolOutput(tool) }, `Copied the output of ${tool.orphan ? 'the tool' : toolName(tool)}`);
  }

  async function copySourceLines(node: { readonly from: readonly { readonly start: number; readonly end: number }[] }): Promise<void> {
    const lines = sourceLinesOf(tree, bytes, node);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(lines);
    const count = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    await writeCopy(ctx(), { text }, `Copied ${plural(count, 'source line')} (JSONL)`);
  }

  async function copyPrompts(): Promise<void> {
    await reading;
    const text = userPrompts(tree);
    if (text === '') {
      ctx().showNotice('No prompt of yours in this session · nothing was copied', { kind: 'info', fades: true });
      return;
    }
    await writeCopy(ctx(), { text }, 'Copied your prompts');
  }

  const anchorOf = (el: Element | null): MenuAnchor => {
    const box = (el ?? root).getBoundingClientRect();
    return { x: Math.round(box.left), y: Math.round(Math.min(box.bottom, box.top + 40)), top: Math.round(box.top) };
  };

  function openCopyAs(target: { turn?: DerivedTurn; tool?: DerivedTool }, at: MenuAnchor): void {
    const rows: VerbMenuRow[] = [];
    if (target.tool) rows.push({ command: null, key: 'transcript.copy-output', title: 'Output (plain text)', run: () => copyOutput(target.tool!) });
    else if (target.turn) rows.push({ command: null, key: 'transcript.copy-turn', title: 'Turn (plain text)', run: () => copyTurn(target.turn!) });
    const node = target.tool ?? target.turn;
    if (node) rows.push({ command: null, key: 'transcript.copy-source-lines', title: 'Source lines (JSONL)', run: () => copySourceLines(node) });
    openVerbMenu(at, ctx(), { registered: [], allActions: () => {}, rows, label: 'Copy as' });
  }

  /** The `turn` and `tool` verbs, in ADR-0061 item 6's order: only verbs that read. */
  function openMenu(target: { turn?: DerivedTurn; tool?: DerivedTool; fold?: HTMLElement }, at: MenuAnchor): void {
    const rows: VerbMenuRow[] = [];
    if (target.tool) {
      const tool = target.tool;
      rows.push({ command: null, key: 'transcript.copy-output', title: 'Copy output', chord: 'Mod+C', run: () => copyOutput(tool) });
      rows.push({ command: null, key: 'transcript.copy-as', title: 'Copy as…', chord: 'Mod+Shift+C', run: () => openCopyAs({ tool }, at) });
      rows.push({ command: null, key: 'transcript.copy-source-lines', title: 'Source lines (JSONL)', run: () => copySourceLines(tool) });
      if (target.fold) {
        const fold = target.fold;
        const isOpen = fold.querySelector(':scope > .marxy-tool-line')?.getAttribute('aria-expanded') === 'true';
        rows.push({ command: null, key: 'transcript.fold', title: isOpen ? 'Collapse' : 'Expand', run: () => setFold(fold, !isOpen) });
      }
      rows.push({ command: null, key: 'transcript.jump', title: 'Jump to source', run: () => jump(tool.src.start, tool.src.end) });
    } else if (target.turn) {
      const turn = target.turn;
      rows.push({ command: null, key: 'transcript.copy-turn', title: 'Copy turn', chord: 'Mod+C', run: () => copyTurn(turn) });
      rows.push({ command: null, key: 'transcript.copy-as', title: 'Copy as…', chord: 'Mod+Shift+C', run: () => openCopyAs({ turn }, at) });
      rows.push({ command: null, key: 'transcript.copy-source-lines', title: 'Source lines (JSONL)', run: () => copySourceLines(turn) });
      rows.push({ command: null, key: 'transcript.copy-prompts', title: 'Copy your prompts', run: copyPrompts });
      rows.push({ command: null, key: 'transcript.jump', title: 'Jump to source', run: () => jump(turn.src.start, turn.src.end) });
    } else return;
    rows.push({ command: null, key: 'transcript.open-source', title: 'Open in Source', chord: 'Mod+E', run: () => opts.openSource() });
    openVerbMenu(at, ctx(), { registered: [], allActions: () => {}, rows, label: target.tool ? 'Tool' : 'Turn' });
  }

  async function jump(start: number, end: number): Promise<void> {
    closeVerbMenu();
    await opts.jumpToSource(start, end);
  }

  /** What a press inside the view is on: a fold (with its tool, if it is one), a turn. */
  function targetOf(node: EventTarget | null): { turn?: DerivedTurn; tool?: DerivedTool; fold?: HTMLElement; turnEl?: HTMLElement } {
    const el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
    const turnEl = el?.closest<HTMLElement>('.marxy-turn') ?? undefined;
    const fold = el?.closest<HTMLElement>('.marxy-tool, .marxy-thinking, .marxy-unreadable') ?? undefined;
    const unit = fold ? foldOf.get(fold) : undefined;
    const row = turnEl ? rowOf.get(turnEl) : undefined;
    return { turn: row?.type === 'turn' ? row : undefined, tool: unit?.type === 'tool' ? unit : undefined, fold, turnEl };
  }

  /** A drag's text as displayed: labels it covered included, an invisible's character not its label (ADR-0061 item 5). */
  function displayedText(range: Range): string {
    const holder = document.createElement('div');
    holder.className = 'marxy-transcript-copy';
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;left:-100000px;top:0;width:40em;';
    holder.append(range.cloneContents());
    // A marker's character is the text; its label is drawing (its byte is visually hidden, so innerText would skip it).
    for (const marker of holder.querySelectorAll('.marxy-invisible')) {
      marker.replaceWith(document.createTextNode(marker.querySelector('.marxy-invisible-byte')?.textContent ?? ''));
    }
    for (const el of holder.querySelectorAll(DISPLAY_ONLY)) el.remove();
    root.append(holder);
    const text = holder.innerText;
    holder.remove();
    return text;
  }

  const onCopy = (event: ClipboardEvent): void => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !event.clipboardData) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    event.clipboardData.setData('text/plain', displayedText(range));
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // In the capture phase on the document: ahead of the app's own copy listener, which reads a page's bytes.
  document.addEventListener('copy', onCopy, true);

  const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  const isMod = (e: KeyboardEvent): boolean => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

  root.addEventListener('click', (event) => {
    const t = event.target instanceof Element ? event.target : null;
    if (!t) return;
    const link = t.closest('a[href]');
    // A link in an agent's reply is not followed from here: its destination is shown, and nothing leaves the page.
    if (link) {
      event.preventDefault();
      return;
    }
    const count = t.closest<HTMLElement>('.marxy-transcript-count');
    if (count) {
      toggleDropped(count.dataset.marxyDropped ?? '');
      return;
    }
    const jumpButton = t.closest<HTMLElement>('.marxy-transcript-jump');
    if (jumpButton) {
      void jump(Number(jumpButton.dataset.marxyS), Number(jumpButton.dataset.marxyE));
      return;
    }
    const line = t.closest<HTMLElement>('.marxy-tool-line');
    if (line) {
      const fold = line.parentElement as HTMLElement;
      setFold(fold, line.getAttribute('aria-expanded') !== 'true');
      // The unit clicked is what ⌘C takes now (a tool's output), not a turn chosen before: WebKit does not focus a button on a click.
      selectTurn(null, false);
      line.focus({ preventScroll: true });
      return;
    }
    const native = document.getSelection();
    if (native && !native.isCollapsed) return;
    const label = t.closest('[data-marxy-speaker]');
    const turnEl = t.closest<HTMLElement>('.marxy-turn');
    if (label && turnEl) selectTurn(rowEls.indexOf(turnEl));
    else if (!turnEl) selectTurn(null);
  });

  root.addEventListener('contextmenu', (event) => {
    // The app's menu never opens here: its verbs act on a page, and this view is not one to act on.
    event.preventDefault();
    event.stopPropagation();
    const target = targetOf(event.target);
    if (target.turnEl && !target.tool) selectTurn(rowEls.indexOf(target.turnEl), false);
    openMenu(target, { x: event.clientX, y: event.clientY });
  });

  root.addEventListener('keydown', (event) => {
    const target = targetOf(event.target);
    const turn = target.turn ?? selectedTurn() ?? undefined;
    let handled = true;
    if ((event.key === 'c' || event.key === 'C') && isMod(event) && !event.altKey) {
      const native = document.getSelection();
      if (!event.shiftKey && native && !native.isCollapsed && root.contains(native.anchorNode)) {
        // A drag is `derived-text`: the copy event takes it as displayed. The app's chord handler stays out of it.
        event.stopPropagation();
        return;
      }
      if (event.shiftKey) openCopyAs({ turn, tool: target.tool }, anchorOf(target.fold ?? target.turnEl ?? null));
      else if (target.tool) void copyOutput(target.tool);
      else if (turn) void copyTurn(turn);
      else handled = false;
    } else if (event.key === 'Escape' && selected !== null && !event.altKey && !isMod(event)) selectTurn(null);
    else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey) || (event.key === 'Enter' && !target.fold && turn)) {
      openMenu({ turn, tool: target.tool, fold: target.fold }, anchorOf(target.fold ?? (selected === null ? null : rowEls[selected]!) ?? null));
    } else handled = false;
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  });

  function blocks(): BlockList {
    const origin = article.getBoundingClientRect().top;
    const out: Block[] = [];
    const push = (el: HTMLElement): void => {
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) return;
      out.push({ el, start: lineStartOf(tree, Number(el.dataset.marxyS)), top: rect.top - origin, height: rect.height });
    };
    for (const el of rowEls) {
      if (el.classList.contains('marxy-turn')) {
        for (const child of el.children) if (child instanceof HTMLElement && child.dataset.marxyS !== undefined) push(child);
      } else push(el);
    }
    return out;
  }

  const view: TranscriptView = {
    root,
    bytes,
    tree,
    blocks,
    ensureThrough(byte) {
      if (closed) return;
      const before = rowEls.length;
      readNow(() => deriver.bytesRead > byte && deriver.settled > rowEls.length);
      if (rowEls.length !== before) opts.onGrow();
    },
    async settled() {
      for (;;) {
        const r = reading;
        await r;
        if (r === reading) return;
      }
    },
    setOnly(who) {
      only = who;
      if (who === null) root.removeAttribute('data-marxy-transcript-only');
      else root.setAttribute('data-marxy-transcript-only', who);
      if (selected !== null && only !== null && selectedTurn()?.speaker !== only) selectTurn(null, false);
      markRuns();
      opts.onGrow();
    },
    setToolsCollapsed(on) {
      toolsCollapsed = on;
      if (on) root.setAttribute('data-marxy-transcript-tools', 'collapsed');
      else root.removeAttribute('data-marxy-transcript-tools');
      markRuns();
      opts.onGrow();
    },
    selectTurn: (index) => selectTurn(index),
    async copySelection() {
      const turn = selectedTurn();
      if (turn) await copyTurn(turn);
    },
    state() {
      const hidden = hiddenCounts();
      return {
        done: deriver.done,
        slices: deriver.slices,
        bytesRead: deriver.bytesRead,
        bytes: bytes.length,
        lines: deriver.lines,
        rows: rowEls.length,
        treeRows: tree.children.length,
        firstPaint,
        only,
        toolsCollapsed,
        hiddenTurns: hidden.turns,
        hiddenTools: hidden.tools,
        selected,
      };
    },
    destroy() {
      if (closed) return;
      closed = true;
      closeVerbMenu();
      document.removeEventListener('copy', onCopy, true);
      views.delete(article);
      root.remove();
    },
  };
  views.set(article, view);
  return view;
}

/** The key that shows Source, as the header line names it. */
function sourceKey(): string {
  const mac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  return mac ? '⌘E' : 'Ctrl+E';
}
