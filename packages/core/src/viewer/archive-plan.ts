// The plan of an archive: its contents to scale, a squarified treemap. Every file
// is a cell whose area is its size; a folder is a frame around its files two levels deep, deeper folders one cell; things
// too small to draw are gathered into one cell per folder, and the whole stays under a cap of cells. Pure: no DOM.
// Sizes are summed by folder once before anything is laid out, so 100,000 entries cost one pass and one sort a folder.

export interface PlanInput {
  readonly path: string;
  readonly size: number;
  readonly packed: number;
  readonly isDir: boolean;
  readonly index: number;
}

export interface PlanCell {
  /** In the given box, px. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly kind: 'file' | 'folder' | 'gathered';
  /** A file's or folder's path; a gathered cell's folder (`''` at the top). */
  readonly path: string;
  /** A file's entry index. */
  readonly index: number | null;
  /** Files it stands for (1 for a file). */
  readonly count: number;
  /** By the chosen scale. */
  readonly bytes: number;
  /** 0 at the top level. */
  readonly depth: number;
  /** A folder drawn as a frame: its own files are cells inside `innerOf(cell)` at `depth + 1`. */
  readonly frame?: boolean;
}

export interface PlanOptions {
  readonly scale: 'unpacked' | 'packed';
  /** Cells at most (400). */
  readonly maxCells?: number;
  /** Folder levels drawn as frames (2). */
  readonly depth?: number;
  /** A cell smaller than this square is gathered (12 px). */
  readonly minSide?: number;
}

/** A frame's band for its name, and its hairline sides. */
export const PLAN_FRAME = { head: 16, side: 1 } as const;
/** A folder is framed only when its frame has room for something inside. */
const FRAME_MIN = { w: 40, h: 34 } as const;

/** Where a frame's own cells are laid. */
export function innerOf(c: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): { x: number; y: number; w: number; h: number } {
  return { x: c.x + PLAN_FRAME.side, y: c.y + PLAN_FRAME.head, w: c.w - 2 * PLAN_FRAME.side, h: c.h - PLAN_FRAME.head - PLAN_FRAME.side };
}

interface File {
  readonly path: string;
  readonly index: number;
  readonly v: number;
}

interface Folder {
  readonly path: string;
  readonly folders: Map<string, Folder>;
  readonly files: File[];
  bytes: number;
  count: number;
  items?: Item[];
}

type Item = { v: number; file: File } | { v: number; folder: Folder } | { v: number; gathered: number };

const folder = (path: string): Folder => ({ path, folders: new Map(), files: [], bytes: 0, count: 0 });

function sumTree(entries: readonly PlanInput[], scale: PlanOptions['scale']): Folder {
  const root = folder('');
  for (const e of entries) {
    if (e.isDir) continue;
    const v = scale === 'packed' ? e.packed : e.size;
    if (!(v > 0)) continue;
    let at = root;
    at.bytes += v;
    at.count++;
    let from = 0;
    for (let slash = e.path.indexOf('/'); slash >= 0; slash = e.path.indexOf('/', from)) {
      const name = e.path.slice(from, slash);
      from = slash + 1;
      if (name === '') continue;
      let next = at.folders.get(name);
      if (!next) {
        next = folder(e.path.slice(0, slash + 1));
        at.folders.set(name, next);
      }
      at = next;
      at.bytes += v;
      at.count++;
    }
    at.files.push({ path: e.path, index: e.index, v });
  }
  return root;
}

/** A folder's things, largest first, sorted once. */
function itemsOf(f: Folder): Item[] {
  if (!f.items) {
    const items: Item[] = [];
    for (const sub of f.folders.values()) items.push({ v: sub.bytes, folder: sub });
    for (const file of f.files) items.push({ v: file.v, file });
    items.sort((a, b) => b.v - a.v);
    f.items = items;
  }
  return f.items;
}

interface Rect<T> {
  readonly it: T;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Squarified layout (Bruls, Huizing, van Wijk) of `items`, largest first, filling the box exactly. */
function squarify<T extends { v: number }>(items: readonly T[], x: number, y: number, w: number, h: number): Rect<T>[] {
  const out: Rect<T>[] = [];
  let total = 0;
  for (const it of items) total += it.v;
  if (total <= 0 || w <= 0 || h <= 0) return out;
  const k = (w * h) / total;
  let i = 0;
  while (i < items.length) {
    const side = Math.min(w, h);
    let sum = 0;
    let worst = Infinity;
    let j = i;
    const first = items[i]!.v * k;
    while (j < items.length) {
      const a = items[j]!.v * k;
      const s = sum + a;
      // The row's worst aspect with this item added: its largest (the first) and its smallest (this one).
      const next = Math.max((side * side * first) / (s * s), (s * s) / (side * side * a));
      if (j > i && next > worst) break;
      sum = s;
      worst = next;
      j++;
    }
    const last = j === items.length;
    // The last row takes what is left exactly, so the cells sum to the box without drift.
    const thick = last ? (w >= h ? w : h) : sum / side;
    let off = 0;
    for (let q = i; q < j; q++) {
      const len = q === j - 1 ? side - off : (items[q]!.v * k) / thick;
      out.push(w >= h ? { it: items[q]!, x, y: y + off, w: thick, h: len } : { it: items[q]!, x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
    i = j;
  }
  return out;
}

function lay(root: Folder, box: { w: number; h: number }, maxDepth: number, minArea: number): PlanCell[] {
  const cells: PlanCell[] = [];
  const go = (f: Folder, x: number, y: number, w: number, h: number, depth: number): void => {
    const all = itemsOf(f);
    const k = (w * h) / f.bytes;
    let cut = all.length;
    while (cut > 0 && all[cut - 1]!.v * k < minArea) cut--;
    let items: Item[] = all;
    if (all.length - cut > 1) {
      let v = 0;
      let count = 0;
      for (let i = cut; i < all.length; i++) {
        const it = all[i]!;
        v += it.v;
        count += 'folder' in it ? it.folder.count : 1;
      }
      const gathered: Item = { v, gathered: count };
      let at = cut;
      while (at > 0 && all[at - 1]!.v < v) at--;
      items = [...all.slice(0, at), gathered, ...all.slice(at, cut)];
    }
    for (const r of squarify(items, x, y, w, h)) {
      const it = r.it;
      if ('file' in it) {
        cells.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'file', path: it.file.path, index: it.file.index, count: 1, bytes: it.v, depth });
      } else if ('gathered' in it) {
        cells.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'gathered', path: f.path, index: null, count: it.gathered, bytes: it.v, depth });
      } else {
        const frame = depth < maxDepth && r.w >= FRAME_MIN.w && r.h >= FRAME_MIN.h;
        cells.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: 'folder', path: it.folder.path, index: null, count: it.folder.count, bytes: it.v, depth, ...(frame ? { frame } : {}) });
        if (frame) {
          const inner = innerOf(r);
          go(it.folder, inner.x, inner.y, inner.w, inner.h, depth + 1);
        }
      }
    }
  };
  if (root.bytes > 0) go(root, 0, 0, box.w, box.h, 0);
  return cells;
}

/** Summed trees by entry list and scale: a drag lays the same entries out once a frame, and the list is never changed after it is made. */
const trees = new WeakMap<readonly PlanInput[], Partial<Record<PlanOptions['scale'], { length: number; root: Folder }>>>();

function summed(entries: readonly PlanInput[], scale: PlanOptions['scale']): Folder {
  const by = trees.get(entries) ?? {};
  const hit = by[scale];
  if (hit && hit.length === entries.length) return hit.root;
  const root = sumTree(entries, scale);
  by[scale] = { length: entries.length, root };
  trees.set(entries, by);
  return root;
}

/**
 * The plan of `entries` in `box`. Paths are as listed (a folder's ends in `/`); folders are made from the paths, so a
 * folder the archive never names is drawn too. Nothing of size 0 by the scale is drawn.
 */
export function archivePlan(entries: readonly PlanInput[], box: { w: number; h: number }, o: PlanOptions): PlanCell[] {
  if (box.w <= 0 || box.h <= 0) return [];
  const root = summed(entries, o.scale);
  const maxCells = o.maxCells ?? 400;
  const depth = o.depth ?? 2;
  let minArea = (o.minSide ?? 12) ** 2;
  let cells = lay(root, box, depth, minArea);
  // Too many cells: the floor rises until the small ones gather into few enough.
  for (let tries = 0; cells.length > maxCells && tries < 40; tries++) {
    minArea *= Math.max(1.25, Math.sqrt(cells.length / maxCells));
    cells = lay(root, box, depth, minArea);
  }
  return cells;
}
