// What the Metadata, Outline and Links panels share: the pane's depths target, going to a byte with the page cursor put
// there, the signals that redraw them, the line arithmetic of a buffer, and the hosting of a viewer's own cards (a
// viewer's metadata slot, its fourth card, a part picked) in a panel's section, with their own markup and acts.
import type { Buffer } from '@marxy/core';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../app-types.ts';
import { writeCopy } from '../commands/copy-write.ts';
import { onDepths, type DepthTarget } from '../depths/dress.ts';
import { entryWhere, isArchiveEntry } from '../document/entries.ts';
import { documentName, isUntitled } from '../document/untitled.ts';
import type { CardContext, CardDef } from '../frame/cards/types.ts';
import { groupOfPane } from '../frame/cards/types.ts';
import { onLinksFound } from '../frame/model/links-found.ts';
import { onNotes } from '../notes/store.ts';
import { onPartsChange } from '../parts/cursor.ts';
import { onNotesMargin } from '../proposals/notes-in-place.ts';
import { onPartChoice } from '../render/parts.ts';
import { buildAppContext } from '../selection/bind.ts';
import { onViewerChange } from '../viewers/signal.ts';
import type { PanelContext, PaneView } from './types.ts';
import { lineStartsOf } from './doc-model.ts';
import { empty, h } from './ui.ts';

export const depthTarget = (pane: PaneView): DepthTarget => ({ article: pane.article, store: () => pane.view.store(), mountThrough: (b) => pane.view.mountThrough(b) });

/** The panels' subject: the name of the file in the focused pane. */
export function subjectOf(ctx: PanelContext<unknown>): string {
  const path = ctx.pane()?.path() ?? null;
  if (path === null) return '';
  return isUntitled(path) ? documentName(path) : basename(path);
}

/** Why a panel about the open file has nothing to say: nothing open, or one of the app's own pages. */
export function emptyFor(ctx: PanelContext<unknown>): HTMLElement {
  const path = ctx.handle.panes().focused.path();
  return path === null
    ? empty('Nothing is open. Open a file and this panel gives its account of it.')
    : empty('This is one of the app’s own pages, not a file, so there is nothing here to account for.');
}

/** Where the file is: its folder, an archive's entry, or not saved yet. */
export function whereWords(path: string): string {
  if (isUntitled(path)) return 'Not saved yet';
  if (isArchiveEntry(path)) return entryWhere(path) ?? path;
  return dirname(path);
}

/** Opens `path` at `byte` (beside, when asked) and puts the page cursor on the part there. */
export async function goByte(handle: AppHandle, path: string, byte: number, beside = false): Promise<void> {
  if (beside) {
    await handle.open(path, { at: byte, target: 'other' });
    return;
  }
  await handle.open(path, { at: byte });
  if (handle.panes().focused.path() === path && handle.selection.cursorReady()) handle.selection.cursorAt(byte);
}

export const copyText = (handle: AppHandle, text: string, said: string): void => void writeCopy(buildAppContext(handle), { text }, said);

/** Line starts of a buffer (byte offsets), made once per buffer. */
const startsKept = new WeakMap<Buffer, Int32Array>();
export function lineStarts(buffer: Buffer): Int32Array {
  let starts = startsKept.get(buffer);
  if (!starts) {
    starts = lineStartsOf(buffer.bytes);
    startsKept.set(buffer, starts);
  }
  return starts;
}

/** The 1-based line `byte` is on. */
export function lineOfByte(starts: Int32Array, byte: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= byte) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export const byteOfLine = (starts: Int32Array, line: number): number => starts[Math.max(0, Math.min(starts.length - 1, line - 1))] ?? 0;

/** What a panel's rows are drawn from, besides the page cursor: the focused pane, its file, its mode and the bytes. */
function shapeOf(ctx: PanelContext<unknown>): readonly unknown[] {
  const pane = ctx.handle.panes().focused;
  return [pane, pane.path(), pane.view.mode, pane.content.store()?.parsed() ?? null, ctx.rev()];
}

/**
 * Redraws the panel (once a frame) when the page cursor, a depth, the parts cursor, a viewer, the notes or the links move.
 * With `cursor: 'light'`, a panel that shows the cursor only by its mark (the Outline) is lit, not drawn, when the cursor
 * moves and the pane, its file, its mode and its bytes are as they were: a long Outline is thousands of rows to make again.
 */
export function followSignals(ctx: PanelContext<unknown>, opts: { readonly cursor?: 'draw' | 'light' } = {}): () => void {
  let queued = false;
  let draw = false;
  let drawn = shapeOf(ctx);
  const frame = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const now = shapeOf(ctx);
      if (draw || now.some((v, i) => v !== drawn[i])) {
        draw = false;
        drawn = now;
        ctx.redraw();
      } else ctx.light();
    });
  };
  const soon = (): void => {
    draw = true;
    frame();
  };
  const moved = opts.cursor === 'light' ? frame : soon;
  const offs = [ctx.handle.selection.onChange(moved), onDepths(soon), onPartsChange(soon), onViewerChange(soon), onNotes(soon), onLinksFound(soon), onNotesMargin(soon), onPartChoice(soon)];
  return () => {
    for (const off of offs) off();
  };
}

// ---- a viewer's own cards ------------------------------------------------------------------------------------------

export interface HostedCards {
  key: string;
  els: Map<string, HTMLElement>;
  offs: (() => void)[];
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** The context a viewer's card is drawn in. */
export function cardContext(handle: AppHandle, pane: PaneView, path: string): CardContext {
  return { handle, frame: handle.frame(), pane, group: groupOfPane(pane, path), path };
}

/**
 * A viewer's card drawn as it always was (its head, its body, its own buttons), inside `.marxy-l-cards` so the panel's
 * section holds it; kept by `held` until `key` changes, so a redraw of the panel does not draw it again.
 */
export function hostCard(held: HostedCards, id: string, def: CardDef, cctx: CardContext): HTMLElement | null {
  const have = held.els.get(id);
  if (have) return have;
  if (!safe(() => def.relevant(cctx), false)) return null;
  const card = h('section', 'marxy-card');
  card.dataset.marxyCard = id;
  if (id.startsWith('now-')) card.dataset.marxyTransient = '';
  const head = h('h3', 'marxy-card-head', h('span', '', safe(() => def.title(cctx), '')));
  const detail = safe(() => def.detail?.(cctx) ?? '', '');
  if (detail) head.append(h('small', '', detail));
  const body = h('div', 'marxy-card-body');
  card.append(head, body);
  try {
    const off = def.render(body, cctx);
    if (off) held.offs.push(off);
  } catch (error) {
    console.warn(`marxy: the ${id} card could not be drawn`, error);
    body.textContent = 'This could not be drawn.';
  }
  const wrap = h('div', 'marxy-l-cards', card);
  held.els.set(id, wrap);
  return wrap;
}

/** Starts the hosted cards again when `key` (the file, its mode, the viewer's own key, the part picked) changes. */
export function hostedFor(prev: HostedCards | undefined, key: string): HostedCards {
  if (prev && prev.key === key) return prev;
  for (const off of prev?.offs ?? []) safe(off, undefined);
  return { key, els: new Map(), offs: [] };
}
