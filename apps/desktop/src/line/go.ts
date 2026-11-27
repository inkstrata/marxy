// Where the Line's choices land: a byte, a line or a range of the focused pane's document, with
// the cursor put on the part that holds it. Rendered text has the selection's cursor; a kind's page has the parts cursor
// put on the unit by its id; Source puts its caret on the line.
import { appHandle } from '../commands/app-handle.ts';
import { partsGoTo, partsHere, partsMove } from '../parts/cursor.ts';
import type { PartTree, PartUnit } from '../viewers/types.ts';
import { byteOfLine, lineStarts } from './refs.ts';

type Handle = NonNullable<ReturnType<typeof appHandle>>;
export type LinePane = ReturnType<Handle['panes']>['focused'];

export function focusedPane(): LinePane | null {
  const handle = appHandle();
  return handle && typeof handle.panes === 'function' ? handle.panes().focused : null;
}

/** The focused pane's text, when it has a store: its path and bytes. */
export function paneText(pane: LinePane | null): { readonly path: string; readonly bytes: Uint8Array } | null {
  const path = pane?.path() ?? null;
  const store = pane?.content.store() ?? null;
  return path === null || store === null ? null : { path, bytes: store.snapshot().buffer.bytes };
}

/** The units from the top down to `unit`. */
function chainOf(tree: PartTree, unit: PartUnit): PartUnit[] {
  const out: PartUnit[] = [unit];
  for (let up = tree.parent(unit); up; up = tree.parent(up)) out.unshift(up);
  return out;
}

const MAX_STEPS = 4000;

/**
 * The parts cursor put on `unit`: by its id (`partsGoTo`), else walked there with the cursor's own moves (`g g`, `j`, `l`),
 * for a tree that finds no unit by id it has not drawn. False when neither reached it.
 */
export function walkToUnit(unit: PartUnit): boolean {
  if (partsGoTo(unit.id)) return true;
  const start = partsHere();
  if (!start) return false;
  const chain = chainOf(start.tree, unit);
  if (!partsMove('first')) return false;
  let steps = 0;
  for (let depth = 0; depth < chain.length; depth++) {
    const want = chain[depth]!.id;
    while (partsHere()?.head?.id !== want) {
      if (++steps > MAX_STEPS || !partsMove('next')) return false;
    }
    if (depth < chain.length - 1 && !partsMove('in')) return false;
  }
  return true;
}

/** `:12–18` or `:12` at the start of a unit's address: its lines. */
function addressLines(address: string): { first: number; last: number } | null {
  const m = /^:(\d+)(?:[–-](\d+))?/.exec(address);
  return m ? { first: Number(m[1]), last: Number(m[2] ?? m[1]) } : null;
}

/** The innermost unit holding byte `byte` (by `at`), else line `line` (by a `:12–18` address). */
export function unitAt(tree: PartTree, byte: number | null, line: number | null): PartUnit | null {
  const holds = (u: PartUnit, next: PartUnit | undefined): boolean => {
    const lines = addressLines(u.address);
    if (line !== null && lines) return line >= lines.first && line <= lines.last;
    if (byte !== null && u.at !== undefined) return u.at <= byte && (next?.at === undefined || byte < next.at);
    return false;
  };
  let level: readonly PartUnit[] = tree.top();
  let found: PartUnit | null = null;
  for (let guard = 0; guard < 32 && level.length > 0; guard++) {
    let hit: PartUnit | null = null;
    for (let i = 0; i < level.length; i++) {
      if (holds(level[i]!, level[i + 1])) hit = level[i]!;
      else if (hit) break;
    }
    if (!hit) break;
    found = hit;
    level = hit.children ?? [];
  }
  return found;
}

/**
 * Puts the cursor on the part holding `[byte, byte + length)` in the focused pane: Rendered's cursor, the parts cursor,
 * or Source's caret on its line. False when nothing there can hold a cursor.
 */
export async function landAt(byte: number, length?: number, line?: number): Promise<boolean> {
  const handle = appHandle();
  const pane = focusedPane();
  if (!handle || !pane) return false;
  if (pane.view.mode === 'source' && pane.content.store()) {
    await handle.jumpToSource(byte);
    return true;
  }
  if (handle.selection.cursorReady()) {
    handle.mountThrough(byte);
    return handle.selection.cursorAt(byte, length);
  }
  const here = partsHere();
  if (here) {
    const unit = unitAt(here.tree, byte, line ?? null);
    if (unit) return walkToUnit(unit);
  }
  return false;
}

/** Line `from` (1-based), or the range to `to`, of the focused pane's document: the cursor on the part holding it. */
export async function landAtLine(from: number, to: number | null): Promise<boolean> {
  const text = paneText(focusedPane());
  if (!text) return false;
  const at = byteOfLine(text.bytes, from);
  if (at === null) return false;
  const starts = lineStarts(text.bytes);
  const end = to === null ? undefined : (to < starts.length ? starts[to]! : text.bytes.length);
  return landAt(at, end === undefined ? undefined : Math.max(0, end - at), from);
}
