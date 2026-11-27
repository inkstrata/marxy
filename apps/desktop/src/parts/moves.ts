// The cursor's moves over a page's parts: the same `j k l h`, `J K`, `g g`, `G` as Rendered's
// (selection/cursor.ts), over the ordered tree of units a viewer or reading gives (`PartTree`). Pure: no DOM is read here.
import type { PartTree, PartUnit } from '../viewers/types.ts';

export type PartsMove = 'next' | 'prev' | 'in' | 'out' | 'first' | 'last';

function siblingsOf(parts: PartTree, unit: PartUnit): readonly PartUnit[] {
  return parts.parent(unit)?.children ?? parts.top();
}

/** The unit beside `unit` at its own depth, or null at the end of its holder. */
export function besideUnit(parts: PartTree, unit: PartUnit, dir: 1 | -1): PartUnit | null {
  if (parts.sibling) return parts.sibling(unit, dir);
  const list = siblingsOf(parts, unit);
  const at = list.findIndex((u) => u.id === unit.id);
  return at < 0 ? null : (list[at + dir] ?? null);
}

/** `j` / `k`: the next or previous part; at the end of a holder the step is taken from the holder, as in Rendered. */
export function stepUnit(parts: PartTree, from: PartUnit, dir: 1 | -1): PartUnit | null {
  for (let x: PartUnit | null = from; x; x = parts.parent(x)) {
    const found = besideUnit(parts, x, dir);
    if (found) return found;
  }
  return null;
}

export function edgeUnit(parts: PartTree, edge: 'first' | 'last'): PartUnit | null {
  if (parts.edge) return parts.edge(edge);
  const top = parts.top();
  return (edge === 'first' ? top[0] : top.at(-1)) ?? null;
}

/** Where a move takes the cursor from `from` (null: no cursor yet, so every move but `out` starts it). */
export function moveUnit(parts: PartTree, from: PartUnit | null, move: PartsMove): PartUnit | null {
  if (move === 'first' || move === 'last') return edgeUnit(parts, move);
  if (!from) return move === 'out' ? null : parts.start();
  if (move === 'next' || move === 'prev') return stepUnit(parts, from, move === 'next' ? 1 : -1);
  if (move === 'in') return from.children?.[0] ?? null;
  return parts.parent(from);
}

/** `J` / `K`: a run's free end moved one part along its holder; null at the holder's edge. */
export function extendUnit(parts: PartTree, anchor: PartUnit, head: PartUnit, dir: 1 | -1): PartUnit | null {
  if (parts.parent(anchor)?.id !== parts.parent(head)?.id) return null;
  return besideUnit(parts, head, dir);
}

/** The units of a run from `a` to `b` at one depth, in order. */
export function runUnits(parts: PartTree, a: PartUnit, b: PartUnit): PartUnit[] {
  if (a.id === b.id) return [a];
  const list = parts.sibling ? null : siblingsOf(parts, a);
  if (list) {
    const i = list.findIndex((u) => u.id === a.id);
    const j = list.findIndex((u) => u.id === b.id);
    if (i < 0 || j < 0) return [a];
    return list.slice(Math.min(i, j), Math.max(i, j) + 1);
  }
  // A page drawn a window at a time: walk toward `b` the way their bytes say, else both ways in step, so the cost is the
  // run's length, not the page's.
  const dirs: (1 | -1)[] = a.at !== undefined && b.at !== undefined && a.at !== b.at ? [b.at > a.at ? 1 : -1] : [1, -1];
  const walks = dirs.map((dir) => ({ dir, list: [a], x: besideUnit(parts, a, dir) }));
  for (let n = 0; n < 100_000 && walks.some((w) => w.x); n++) {
    for (const w of walks) {
      if (!w.x) continue;
      w.list.push(w.x);
      if (w.x.id === b.id) return w.dir === 1 ? w.list : w.list.reverse();
      w.x = besideUnit(parts, w.x, w.dir);
    }
  }
  return [a];
}

/** A tree of units made whole (a page that draws every part): `find`, `parent` and `top` over it. */
export function treeParts(top: readonly PartUnit[], o: { readOnly: boolean; start?: () => PartUnit | null; step?: PartTree['step'] }): PartTree {
  const byId = new Map<string, PartUnit>();
  const parentOf = new Map<string, PartUnit>();
  const walk = (list: readonly PartUnit[], up: PartUnit | null): void => {
    for (const u of list) {
      byId.set(u.id, u);
      if (up) parentOf.set(u.id, up);
      if (u.children) walk(u.children, u);
    }
  };
  walk(top, null);
  return {
    top: () => top,
    find: (id) => byId.get(id) ?? null,
    parent: (u) => parentOf.get(u.id) ?? null,
    start: o.start ?? (() => top[0] ?? null),
    step: o.step,
    readOnly: o.readOnly,
  };
}

/** `]` / `[` where the kind names no outline of its own: the next or previous part at the top level. */
export function topStep(parts: PartTree, from: PartUnit | null, dir: 1 | -1): PartUnit | null {
  if (!from) return edgeUnit(parts, dir === 1 ? 'first' : 'last');
  let top = from;
  for (let up = parts.parent(top); up; up = parts.parent(up)) top = up;
  // From inside a part, `[` goes to the part's own top first.
  if (top.id !== from.id && dir === -1) return top;
  return besideUnit(parts, top, dir);
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The bar's word for a run of `n` parts. */
export function unitsLabel(n: number): string {
  return plural(n, 'part');
}
