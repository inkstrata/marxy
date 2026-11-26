// Places as data: each file's kind group (the count line's words), the filter's terms (`kind:x`, `>size`, `<size`, and
// words of the path), the orders, and a root's files as a tree. Pure: the panel (panels/places.ts) draws what this says.
import { fileTypeFor } from '@marxy/core/src/kind/registry.ts';

/** The count line's kinds, in their fixed order. */
export const KIND_GROUPS = ['prose', 'code', 'data', 'logs', 'patches', 'text', 'pages', 'pictures', 'sound and film', 'containers', 'fonts', 'bytes'] as const;
export type KindGroup = (typeof KIND_GROUPS)[number];

export interface PlaceFile {
  readonly path: string;
  /** The place (index root) holding it; null for a loose file. */
  readonly root: string | null;
  readonly size: number;
  readonly mtimeMs: number;
}

const VIEWER_GROUP: Readonly<Partial<Record<string, KindGroup>>> = {
  image: 'pictures',
  pdf: 'pages',
  archive: 'containers',
  sqlite: 'data',
  sheet: 'data',
  font: 'fonts',
  media: 'sound and film',
  mail: 'prose',
  office: 'prose',
  book: 'prose',
  card: 'bytes',
};

/** The group a file's name puts it in; a file whose reading the reader changed is counted where its name says. */
export function groupOf(path: string): KindGroup {
  const type = fileTypeFor(path);
  const byViewer = VIEWER_GROUP[type.viewer];
  if (byViewer) return byViewer;
  if (type.kind === 'binary') return 'bytes';
  if (type.kind === 'markdown') return 'prose';
  if (type.kind === 'text' && type.readerKind !== 'log' && type.readerKind !== 'terminal' && type.readerKind !== 'diff' && type.readerKind !== 'transcript') return 'text';
  switch (type.readerKind) {
    case 'code':
    case 'html':
      return 'code';
    case 'data':
    case 'transcript':
      return 'data';
    case 'log':
    case 'terminal':
      return 'logs';
    case 'diff':
      return 'patches';
    default:
      return type.kind === 'source' ? 'code' : 'text';
  }
}

export const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The path inside its place, without the place: `plans/pg16.md`. */
export const relOf = (f: PlaceFile): string => (f.root === null ? nameOf(f.path) : f.path.slice(f.root.replace(/\/$/, '').length + 1));

/** A dot file, or a file in a dot folder, inside its place. */
export const isDot = (f: PlaceFile): boolean => relOf(f).split('/').some((seg) => seg.startsWith('.'));

export interface Filter {
  /** Words that must each be in the path (lower case), for marking. */
  readonly words: readonly string[];
  readonly kinds: readonly string[];
  readonly sizes: readonly { readonly over: boolean; readonly bytes: number }[];
  /** Something narrows the list. */
  readonly any: boolean;
}

const UNIT: Readonly<Record<string, number>> = { b: 1, kb: 1024, mb: 1024 * 1024 };

export function parseFilter(q: string): Filter {
  const words: string[] = [];
  const kinds: string[] = [];
  const sizes: { over: boolean; bytes: number }[] = [];
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const size = /^([<>])(\d+(?:\.\d+)?)(kb|mb|b)?$/.exec(w);
    if (w.startsWith('kind:')) {
      if (w.length > 5) kinds.push(w.slice(5));
    } else if (size) sizes.push({ over: size[1] === '>', bytes: Number(size[2]) * (UNIT[size[3] ?? 'b'] ?? 1) });
    else words.push(w);
  }
  return { words, kinds, sizes, any: words.length + kinds.length + sizes.length > 0 };
}

export function passes(f: PlaceFile, filter: Filter): boolean {
  const g = groupOf(f.path);
  for (const k of filter.kinds) if (!g.startsWith(k) && !fileTypeFor(f.path).readerKind.startsWith(k)) return false;
  for (const s of filter.sizes) if (s.over ? f.size <= s.bytes : f.size >= s.bytes) return false;
  const rel = relOf(f).toLowerCase();
  return filter.words.every((w) => rel.includes(w));
}

export type Order = 'name' | 'kind' | 'size' | 'modified';

export function sorter(order: Order): (a: PlaceFile, b: PlaceFile) => number {
  const byName = (a: PlaceFile, b: PlaceFile): number => Number(isDot(a)) - Number(isDot(b)) || nameOf(a.path).localeCompare(nameOf(b.path));
  if (order === 'kind') return (a, b) => KIND_GROUPS.indexOf(groupOf(a.path)) - KIND_GROUPS.indexOf(groupOf(b.path)) || byName(a, b);
  if (order === 'size') return (a, b) => b.size - a.size || byName(a, b);
  if (order === 'modified') return (a, b) => b.mtimeMs - a.mtimeMs || byName(a, b);
  return byName;
}

const ONE: Readonly<Record<KindGroup, string>> = {
  prose: 'prose',
  code: 'code',
  data: 'data',
  logs: 'log',
  patches: 'patch',
  text: 'text',
  pages: 'page',
  pictures: 'picture',
  'sound and film': 'sound or film',
  containers: 'container',
  fonts: 'font',
  bytes: 'file of bytes',
};

/** The count line's words for `n` files of group `g`: "1 log", "2 patches". "3 bytes" would read as a size. */
export const kindCount = (n: number, g: KindGroup): string => `${n.toLocaleString('en-GB')} ${n === 1 ? ONE[g] : g === 'bytes' ? 'files of bytes' : g}`;

/** How many files of each group, in their fixed order; groups with none are left out. */
export function census(files: readonly PlaceFile[]): [KindGroup, number][] {
  const n = new Map<KindGroup, number>();
  for (const f of files) {
    const g = groupOf(f.path);
    n.set(g, (n.get(g) ?? 0) + 1);
  }
  return KIND_GROUPS.filter((g) => n.has(g)).map((g) => [g, n.get(g)!]);
}

export interface TreeDir {
  readonly name: string;
  /** The folder's whole path. */
  readonly path: string;
  readonly dirs: Map<string, TreeDir>;
  readonly files: PlaceFile[];
  /** Files anywhere under it. */
  count: number;
}

/** A place's files as folders, from the files' own paths (the index lists every file it holds). */
export function treeOf(root: string, files: readonly PlaceFile[]): TreeDir {
  const base = root.replace(/\/$/, '');
  const top: TreeDir = { name: nameOf(base), path: base, dirs: new Map(), files: [], count: 0 };
  for (const f of files) {
    let at = top;
    at.count++;
    const parts = relOf(f).split('/');
    let path = base;
    for (const seg of parts.slice(0, -1)) {
      path = `${path}/${seg}`;
      let next = at.dirs.get(seg);
      if (!next) {
        next = { name: seg, path, dirs: new Map(), files: [], count: 0 };
        at.dirs.set(seg, next);
      }
      next.count++;
      at = next;
    }
    at.files.push(f);
  }
  return top;
}

/** The folders between `root` and `path`'s own folder, outermost first: what opens to show it. */
export function foldersTo(root: string, path: string): string[] {
  const base = root.replace(/\/$/, '');
  if (!path.startsWith(`${base}/`)) return [];
  const parts = path.slice(base.length + 1).split('/').slice(0, -1);
  return parts.map((_, i) => `${base}/${parts.slice(0, i + 1).join('/')}`);
}
