// The cursor's keys and verbs over a kind's parts. Rendered's commands keep their ids and keys;
// `partsAware` lets each answer for the parts cursor where a viewer or a reading gives the parts, and the change verbs
// refuse on a kind that is only read. `o` opens a part that is a file; `r` reads the file another way.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { appHandle } from '../commands/app-handle.ts';
import { writeCopy } from '../commands/copy-write.ts';
import type { AppContext, Command } from '../commands/registry.ts';
import { entryAddress, isArchiveEntry, LINES_READ_ONLY_WORDS } from '../document/entries.ts';
import { notify } from '../notices/index.ts';
import { openReadAsMenu } from '../read-as/menu.ts';
import { VIEWER_NAMES } from '../read-as/ladder.ts';
import { openVerbMenu, type VerbMenuRow } from '../selection/verb-menu.ts';
import { lineSpan } from '../selection/cursor.ts';
import { linesOf } from '../notes/anchor.ts';
import { beginNote } from '../notes/margin.ts';
import { partPiece, pieceRef } from '../tray/markdown.ts';
import { collect } from '../tray/tray.ts';
import {
  partsActive,
  partsClear,
  partsEnterFence,
  partsExtend,
  partsHere,
  partsInFence,
  partsLeaveFence,
  partsMove,
  partsSetHead,
  partsStep,
  partsXray,
  type PartsHere,
} from './cursor.ts';
import { fencedReading } from './reading-parts.ts';
import { depthsChanged } from '../depths/dress.ts';
import { onKindRevealOff, revealKindOf, toggleKindReveal } from './kind-reveal.ts';
import { foldTreeTo, toggleBranch, treeFolded, treeRoot } from './tree-folds.ts';
import type { PartsMove } from './moves.ts';
import type { PaneViewer, PartUnit } from '../viewers/types.ts';
import { linesViewIn } from '../view/reading-lines.ts';

const MOVES: Readonly<Record<string, PartsMove>> = {
  'cursor.next': 'next',
  'cursor.prev': 'prev',
  'cursor.in': 'in',
  'cursor.out': 'out',
  'cursor.first': 'first',
  'cursor.last': 'last',
};

/** The change verbs: on a kind that is only read they say so, and change nothing. */
const CHANGES = new Set(['cursor.edit', 'cursor.tick', 'change.remove', 'change.move-up', 'change.move-down', 'change.promote', 'change.demote']);

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Why nothing here is changed, in one plain sentence. */
export function readOnlyWords(here: PartsHere): string {
  const path = here.pane.path() ?? '';
  if (isArchiveEntry(path)) return 'A file from inside another is only read here.';
  if (linesViewIn(here.pane.article)?.lines.readOnly) return LINES_READ_ONLY_WORDS;
  const viewer = here.pane.view.viewer();
  if (!viewer || viewer.kind === 'card' || here.pane.view.mode === 'source') return 'Bytes are only read here: r reads the file another way.';
  return `${VIEWER_NAMES[viewer.kind]} is only read here; nothing in it is changed. r reads it another way.`;
}

async function storedOf(units: readonly PartUnit[]): Promise<string> {
  const parts = await Promise.all(units.map((u) => u.stored()));
  return parts.join('\n');
}

/** `C`: the part, then where it is from: `path` and its address. */
export function citeUnit(text: string, path: string, address: string): string {
  const quote = text.split(/\r\n|\r|\n/).map((line) => `> ${line}`).join('\n');
  return `${quote}\n\n— \`${path}${address}\`\n`;
}

/** The bar's word for what the cursor holds. */
export function hereLabel(here: PartsHere): string {
  return here.run.length > 1 ? plural(here.run.length, 'part') : (here.head?.label ?? '');
}

/** `name` and the head's address, as the bar writes it; a run is addressed by its first part. An archive's entry is named
 * from the archive on disk, every level joined. */
export function hereAddress(here: PartsHere): string {
  const first = here.run[0] ?? here.head;
  const path = here.pane.path() ?? '';
  return `${entryAddress(path) ?? basename(path)}${first?.address ?? ''}`;
}

async function copy(ctx: AppContext, cite: boolean): Promise<void> {
  const here = partsHere();
  if (!here?.head) return;
  const text = await storedOf(here.run);
  const what = here.run.length > 1 ? plural(here.run.length, 'part') : `the ${here.head.label.split(' ')[0]}`;
  const first = here.run[0]!;
  const rep = cite ? citeUnit(text, here.pane.path() ?? '', first.address) : text;
  await writeCopy(ctx, { text: rep }, cite ? `Copied ${what} with its address` : `Copied ${what} as stored`);
}

/** `\`: Source at the part. A text kind's lines go to Source's editor; a kind read from bytes flips to its bytes and back. */
async function source(): Promise<void> {
  const here = partsHere();
  const handle = appHandle();
  if (!here || !handle) return;
  const viewer = here.pane.view.viewer();
  const at = here.head?.at;
  if (viewer && viewer.binary) {
    const to = here.pane.view.mode === 'source' ? 'rendered' : 'source';
    if (to === 'source' && at !== undefined) viewer.land?.(at);
    await here.pane.view.setMode(to);
    return;
  }
  if (at !== undefined) await handle.jumpToSource(at);
  else await here.pane.view.setMode('source');
}

/** `y`: the part's stored text into the tray, with its file and its address (its lines, for a part of a text kind). */
async function collectPart(): Promise<void> {
  const here = partsHere();
  const first = here?.run[0];
  const path = here?.pane.path();
  if (!here || !first || !path) return;
  const piece = partPiece(path, await storedOf(here.run), first.address);
  const n = collect(piece);
  notify({ kind: 'done', text: `Collected ${pieceRef(piece)} · ${n} in the tray (T)` });
}

/**
 * `n`: a note on the part. A kind read from text anchors it by its lines, as on a Markdown page; a kind read from bytes
 * by the part's address, drawn beside the part (notes/part-notes.ts). Both are kept in notes.json.
 */
function notePart(): void {
  const here = partsHere();
  const unit = here?.run[0];
  const path = here?.pane.path();
  if (!here || !unit || !path) return;
  const store = here.pane.view.viewer() ? null : here.pane.content.store();
  if (!store) {
    beginNote(path, { l0: 0, l1: 0, key: '', text: '', address: unit.address });
    return;
  }
  const snap = store.snapshot();
  const lines = /^:(\d+)(?:–(\d+))?/.exec(unit.address);
  // A part that owns no bytes of its own (a notebook's output) stands on the lines of what holds it.
  let at = unit.at;
  for (let up = here.tree.parent(unit); at === undefined && up; up = here.tree.parent(up)) at = up.at;
  const first = lines ? Number(lines[1]) : lineSpan(snap.buffer.bytes, at ?? 0, at ?? 0).first;
  const last = lines?.[2] ? Number(lines[2]) : first;
  beginNote(path, { l0: first - 1, l1: last, key: linesOf(snap.buffer.text)[first - 1] ?? '', text: '' });
}

/** The fenced part of a Markdown page Rendered's cursor is on, when it is read on its own and has parts. */
function fenceUnderCursor(): HTMLElement | null {
  const s = appHandle()?.selection.state().selection;
  return s && s.kind === 'node' ? fencedReading(s.el) : null;
}

function enterFence(): boolean {
  const fence = fenceUnderCursor();
  if (!fence || !partsEnterFence(fence)) return false;
  // The parts cursor speaks for the page while it is inside: Rendered's lets go of the fence.
  appHandle()?.selection.clear();
  return true;
}

/** Out of a fenced part: Rendered's cursor back on the fence. False when the cursor was in none. */
function leaveFence(): boolean {
  const at = partsLeaveFence();
  if (at === null) return false;
  appHandle()?.selection.cursorAt(at);
  return true;
}

/**
 * `X`: Reveal on a kind's page. A text kind whose reading leaves markup out has it put back (parts/kind-reveal.ts); a page
 * drawn as written has nothing to put back, and a kind read from bytes has no markup at all: each says so plainly.
 */
function revealPage(): void {
  const here = partsHere();
  if (!here) return;
  const viewer = here.pane.view.viewer();
  const say = (text: string): void => void notify({ kind: 'info', text, transient: true });
  if (viewer?.reveal) return void revealViewer(here.pane.view, viewer.reveal);
  if (viewer?.kind === 'page') return say('An HTML page is shown as it is, cleaned; Reveal leaves it so. \\ shows its lines as written.');
  if (viewer) {
    const name = viewer.kind === 'card' || here.pane.view.mode === 'source' ? 'Bytes' : VIEWER_NAMES[viewer.kind];
    return say(`${name} ${name === 'Bytes' ? 'are' : 'is'} read from the file's bytes: there is no markup for Reveal to put back. x shows a part as stored; \\ shows the bytes.`);
  }
  const article = here.pane.article;
  if (!revealKindOf(article)) return say('This reading is drawn as the file is written: Reveal has nothing left out to put back. \\ shows its lines.');
  const pane = here.pane;
  toggleKindReveal(article, () => pane.content.store()?.snapshot().buffer.bytes ?? null);
  depthsChanged();
}

/** A viewer's own Reveal, switched; from Source it comes back to Read, where Reveal is drawn. */
async function revealViewer(view: { readonly mode: string; setMode(m: 'rendered'): Promise<unknown> }, reveal: NonNullable<PaneViewer['reveal']>): Promise<void> {
  const on = !reveal.on();
  if (on && view.mode === 'source') await view.setMode('rendered');
  reveal.set(on);
  depthsChanged();
}

const isBranch = (el: Element | null): el is HTMLDetailsElement => el instanceof HTMLDetailsElement && el.matches('details.marxy-tree-branch');

/** A tree shown in Read in the focused pane: its folds are the cursor's. */
function treeHere(): boolean {
  const here = partsHere();
  return here !== null && !here.pane.view.viewer() && here.pane.view.mode === 'rendered' && treeRoot(here.pane.article) !== null;
}

/** The cursor out of whatever a fold just closed over it, to the nearest part still shown. */
function outOfFolds(): void {
  const here = partsHere();
  let u = here?.head ?? null;
  while (here && u && u.el()?.getClientRects().length === 0) u = here.tree.parent(u);
  if (here && u && u.id !== here.head?.id) partsSetHead(u);
}

/** `z`: on a tree, the node's branch folded or opened (from a leaf, the branch holding it, and the cursor goes there). */
function foldPart(): void {
  const here = partsHere();
  if (!here) return;
  const refuse = (text: string): void => void notify({ kind: 'refused', text, transient: true });
  // A page with folds of its own (an archive's folders): the head's nearest foldable part folds, and the cursor rests on it.
  const fold = here.tree.fold;
  if (fold) {
    let at: PartUnit | null = here.head;
    if (!at) return refuse('Put the cursor on a folder first: j or a click.');
    while (at && !fold(at)) at = here.tree.parent(at);
    if (!at) return refuse('Folding works on a folder and what is in it; this entry is at the top.');
    if (at.id !== here.head?.id) partsSetHead(at);
    return;
  }
  if (!treeHere()) return refuse('Folding works on a tree’s nodes and on a document’s sections; this page has none to fold.');
  let u: PartUnit | null = here.head;
  if (!u) return refuse('Put the cursor on a node first: j or a click.');
  while (u && !isBranch(u.el())) u = here.tree.parent(u);
  if (!u) return refuse('A value at the top holds nothing to fold.');
  toggleBranch(here.pane.article, here.pane.path(), u.el()!);
  if (u.id !== here.head?.id) partsSetHead(u);
}

/** `Z`: a tree folded to its second level, or opened whole again. */
function foldWhole(): void {
  const here = partsHere();
  if (!here) return;
  if (!treeHere()) {
    notify({ kind: 'refused', text: 'Folding works on a tree’s nodes and on a document’s sections; this page has none to fold.', transient: true });
    return;
  }
  const path = here.pane.path();
  foldTreeTo(here.pane.article, path, treeFolded(here.pane.article, path) ? null : 2);
  outOfFolds();
}

/** The depth commands (Source's "Fold to depth", "Unfold all") on a tree shown in Read: the same folds as `Z`. */
function foldTreeHere(depth: number | null): void {
  const here = partsHere();
  if (!here) return;
  foldTreeTo(here.pane.article, here.pane.path(), depth);
  outOfFolds();
}

async function openPart(): Promise<void> {
  const unit = partsHere()?.head;
  if (unit?.open) await unit.open();
}

function menu(ctx: AppContext, registered: () => readonly Command[]): void {
  const here = partsHere();
  const el = here?.head?.el();
  if (!here?.head || !el) return;
  const box = el.getBoundingClientRect();
  const rows: VerbMenuRow[] = [];
  const add = (id: string, title: string): void => {
    const cmd = registered().find((c) => c.id === id);
    if (cmd?.key && cmd.when(ctx)) rows.push({ command: null, title, chord: cmd.key, key: `parts.${id}`, run: () => cmd.run(ctx) });
  };
  add('cursor.copy', 'Copy the part as stored');
  add('cursor.copy-cite', 'Copy it with its address');
  add('depths.xray', 'X-ray: as stored');
  add('cursor.open', 'Open it in a tab of its own');
  add('cursor.source', here.pane.view.viewer()?.binary ? 'The bytes, and back' : 'Source, at the part');
  add('read.as', 'Read the file another way…');
  add('tray.collect', 'Collect it in the tray');
  add('note.write', 'Write a note on it');
  const vh = document.documentElement.clientHeight || window.innerHeight;
  const top = Math.min(Math.max(box.top, 0), vh);
  openVerbMenu({ x: Math.max(box.left, 0), y: Math.min(Math.max(box.bottom, top), vh), top }, ctx, { registered: [], allActions: () => {}, rows, label: hereLabel(here) });
}

/** Rendered's cursor commands, each answering for the parts cursor where it applies. */
export function partsAware(list: readonly Command[]): Command[] {
  const registered = (): readonly Command[] => (appHandle()?.commands() ?? []) as readonly Command[];
  const out = list.map((cmd): Command => {
    const id = cmd.id;
    const move = MOVES[id];
    const over = (when: () => boolean, run: (ctx: AppContext) => Promise<unknown> | unknown): Command => ({
      ...cmd,
      when: (ctx) => when() || cmd.when(ctx),
      run: async (ctx) => {
        if (when()) await run(ctx);
        else await cmd.run(ctx);
      },
    });
    const withHead = (): boolean => partsHere()?.head != null;
    // A fenced part of a Markdown page: `l` on it goes into its rows or nodes, `h` from its top comes back out to it.
    if (id === 'cursor.in') return over(() => partsActive() || fenceUnderCursor() !== null, () => (partsActive() ? partsMove('in') : enterFence()));
    if (id === 'cursor.out') return over(partsActive, () => partsMove('out') || leaveFence());
    if (move) return over(partsActive, () => partsMove(move));
    if (id === 'cursor.extend-down' || id === 'cursor.extend-up') return over(partsActive, () => partsExtend(id === 'cursor.extend-down' ? 1 : -1));
    if (id === 'cursor.next-heading' || id === 'cursor.prev-heading') return over(partsActive, () => partsStep(id === 'cursor.next-heading' ? 1 : -1));
    if (id === 'cursor.copy' || id === 'cursor.copy-cite') return over(withHead, (ctx) => copy(ctx, id === 'cursor.copy-cite'));
    if (id === 'cursor.menu') return over(withHead, (ctx) => menu(ctx, registered));
    if (id === 'depths.xray') return over(() => partsHere()?.head?.xray !== undefined, () => partsXray());
    if (id === 'cursor.source') {
      return over(() => {
        const here = partsHere();
        return here !== null && (here.head?.at !== undefined || here.pane.view.viewer()?.binary === true);
      }, () => source());
    }
    if (id === 'selection.clear') return over(() => withHead() || partsInFence(), () => leaveFence() || partsClear());
    if (id === 'tray.collect') return over(withHead, () => collectPart());
    if (id === 'note.write') return over(withHead, () => notePart());
    // Inside a fenced part, Reveal is the Markdown page's own.
    if (id === 'depths.reveal') return over(() => partsActive() && !partsInFence(), () => revealPage());
    if (id === 'depths.fold') return over(partsActive, () => foldPart());
    if (id === 'depths.fold-all') return over(partsActive, () => foldWhole());
    const depth = /^source\.fold-depth-(\d)$/.exec(id);
    if (depth || id === 'source.unfold-all') return over(treeHere, () => foldTreeHere(depth ? Number(depth[1]) : null));
    if (CHANGES.has(id)) {
      return over(
        () => partsHere()?.tree.readOnly === true,
        () => {
          const here = partsHere();
          if (here) notify({ kind: 'refused', text: readOnlyWords(here), transient: true });
        },
      );
    }
    return cmd;
  });
  return out;
}

/** The verbs that are the parts cursor's own. */
export function partsCommands(): readonly Command[] {
  onKindRevealOff(depthsChanged);
  return [
    {
      id: 'cursor.open',
      title: 'Open the part in a tab of its own: an entry, an attachment, an embedded file',
      key: 'o',
      group: 'selection',
      when: () => partsHere()?.head?.open !== undefined,
      run: () => openPart(),
    },
    {
      id: 'read.as',
      title: 'Read this file another way, with Bytes always last',
      key: 'r',
      group: 'document',
      when: () => appHandle()?.panes().focused.path() != null,
      async run(ctx) {
        const pane = appHandle()?.panes().focused;
        const path = pane?.path();
        if (pane && path) openReadAsMenu(path, ctx, pane.host);
      },
    },
  ];
}
