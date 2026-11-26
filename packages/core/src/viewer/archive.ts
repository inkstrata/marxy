// An archive's page: the shell's flat listing made into a tree of folders with their file
// counts and sizes, the lede's facts, and the words each row says. Pure: the listing comes from the shell (Rust, or the
// browser build's `archive-read.ts`), and nothing here reads a byte.
import type { ArchiveEntryLike, ArchiveListingLike } from './archive-read.ts';

/** The most an entry may open with, as the page says it: "16.0 MB". */
export const ENTRY_OPEN_CAP = 16 * 1024 * 1024;

/** Past this many rows the folders start folded, so a 50,000-entry archive draws only its top. */
export const FOLD_ABOVE_ROWS = 2_000;

const n2 = (n: number): string => n.toLocaleString('en-GB');

/** "418 bytes", "2.1 KB", "20.0 MB": the row's size, in the binary units the file card uses. */
export function shortSize(bytes: number): string {
  if (bytes < 1024) return `${n2(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

export interface ArchiveNode {
  /** The segment's name, without its slash. */
  readonly name: string;
  /** The sanitised path inside the archive; a folder's ends in `/`. */
  readonly path: string;
  readonly dir: boolean;
  /** The listed entry, for a file, a link, or a folder the archive names itself. */
  entry: ArchiveEntryLike | null;
  readonly kids: Map<string, ArchiveNode>;
  /** Files below (a file counts itself). */
  files: number;
  /** Their declared unpacked sizes. */
  size: number;
}

const node = (name: string, path: string, dir: boolean): ArchiveNode => ({ name, path, dir, entry: null, kids: new Map(), files: 0, size: 0 });

/**
 * The entries as a tree. A folder the archive never names is made from its entries' paths; a file and a folder of one
 * name (a damaged or hostile archive) are kept apart by the folder's slash. The order is folders first, then by name.
 */
export function archiveTree(entries: readonly ArchiveEntryLike[]): ArchiveNode {
  const root = node('', '', true);
  for (const e of entries) {
    const dir = e.kind === 'dir';
    const segs = e.path.replace(/\/$/, '').split('/');
    let at = root;
    segs.forEach((seg, i) => {
      const leaf = i === segs.length - 1;
      const isDir = !leaf || dir;
      let key = isDir ? `${seg}/` : seg;
      // A second entry of one path (named twice) is kept as a row of its own, not written over the first.
      if (leaf && !isDir && at.kids.get(key)?.entry) key = `${seg}\u0000${e.index}`;
      let next = at.kids.get(key);
      if (!next) {
        next = node(seg, `${segs.slice(0, i + 1).join('/')}${isDir ? '/' : ''}`, isDir);
        at.kids.set(key, next);
      }
      if (leaf) next.entry = e;
      at = next;
    });
  }
  const sum = (n: ArchiveNode): void => {
    if (!n.dir) {
      n.files = 1;
      n.size = n.entry?.size ?? 0;
      return;
    }
    for (const k of n.kids.values()) {
      sum(k);
      n.files += k.files;
      n.size += k.size;
    }
  };
  sum(root);
  return root;
}

// One collator for every sort: `localeCompare` with options makes one a call, too slow for 20,000 names.
const NAMES = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export const sortedKids = (n: ArchiveNode): ArchiveNode[] => [...n.kids.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || NAMES.compare(a.name, b.name));

export interface ArchiveRow {
  readonly node: ArchiveNode;
  readonly depth: number;
}

/** The rows on the page: every node not under a folded folder, in tree order. */
export function visibleRows(root: ArchiveNode, folded: ReadonlySet<string>): ArchiveRow[] {
  const rows: ArchiveRow[] = [];
  const walk = (n: ArchiveNode, depth: number): void => {
    for (const k of sortedKids(n)) {
      rows.push({ node: k, depth });
      if (k.dir && !folded.has(k.path)) walk(k, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** The folders that start folded: none in a small archive; below the top level in a large one. */
export function initialFolds(root: ArchiveNode, count: number): Set<string> {
  const out = new Set<string>();
  if (count <= FOLD_ABOVE_ROWS) return out;
  const walk = (n: ArchiveNode, depth: number): void => {
    for (const k of n.kids.values()) {
      if (!k.dir) continue;
      // A lone top folder (tidemark-0.5.0/) stays open: folding it would show one row.
      if (depth > 0 || root.kids.size > 1) out.add(k.path);
      walk(k, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export interface ArchiveSums {
  readonly files: number;
  readonly folders: number;
  readonly unpacked: number;
  /** Packed sizes summed (zip), else null. */
  readonly packed: number | null;
  /** Some file's size the archive does not say. */
  readonly unknownSize: boolean;
  readonly encrypted: number;
}

export function archiveSums(listing: ArchiveListingLike): ArchiveSums {
  const folders = new Set<string>();
  let files = 0;
  let unpacked = 0;
  let packed = 0;
  let anyPacked = false;
  let unknownSize = false;
  let encrypted = 0;
  for (const e of listing.entries) {
    const segs = e.path.replace(/\/$/, '').split('/');
    for (let i = 1; i < segs.length + (e.kind === 'dir' ? 1 : 0); i++) folders.add(segs.slice(0, i).join('/'));
    if (e.kind === 'dir') continue;
    files++;
    if (e.size === null) unknownSize = true;
    else unpacked += e.size;
    if (e.packed !== null) {
      packed += e.packed;
      anyPacked = true;
    }
    if (e.encrypted) encrypted++;
  }
  return { files, folders: folders.size, unpacked, packed: anyPacked ? packed : null, unknownSize, encrypted };
}

/** "524 : 1 on 39.1 KB" for the Archive card's unpacked row; null when it means nothing (nothing unpacked). */
export function ratioWords(unpacked: number, onDisk: number): string | null {
  if (unpacked <= 0 || onDisk <= 0) return null;
  return `${n2(Math.max(1, Math.round(unpacked / onDisk)))} : 1 on ${shortSize(onDisk)}`;
}

/** Why an entry cannot open here, or null when it can: the row's note and the refusal said on Enter. */
export function entryBar(e: ArchiveEntryLike): string | null {
  if (e.kind === 'dir') return null;
  if (e.kind === 'link') return e.link ? `a link to ${e.link}: not followed` : 'a link: not followed';
  if (e.kind === 'other') return 'not a file: a device, a pipe or the like';
  if (e.encrypted) return 'encrypted: the app does not ask for archive passwords';
  if (e.method) return `compressed with ${e.method}, which the app does not read`;
  if (e.size !== null && e.size > ENTRY_OPEN_CAP) return `over the ${shortSize(ENTRY_OPEN_CAP)} an entry opens with`;
  return null;
}

/** "14 Oct 2026, 16:16" from the shell's time: a zoned time in local time, a clock time (a zip's) as written. */
export function entryDate(mtime: string | null): string {
  if (!mtime) return '';
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(mtime);
  if (!m) return mtime;
  const d = mtime.endsWith('Z') ? new Date(mtime) : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(d.getTime())) return mtime;
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The largest files, for the Archive card. */
export function largestEntries(listing: ArchiveListingLike, n = 4): ArchiveEntryLike[] {
  return listing.entries.filter((e) => e.kind === 'file' && e.size !== null).sort((a, b) => (b.size ?? 0) - (a.size ?? 0)).slice(0, n);
}

const FORMS: Readonly<Record<string, string>> = {
  zip: 'A ZIP archive', tar: 'A tar archive', 'tar.gz': 'A tar archive, gzipped', 'tar.bz2': 'A tar archive, packed with bzip2',
  'tar.xz': 'A tar archive, packed with xz', gz: 'A gzip file', bz2: 'A bzip2 file', xz: 'An xz file', '7z': 'A 7z archive',
  'tar.zst': 'A tar archive, packed with Zstandard', zst: 'A Zstandard file', deb: 'A Debian package', ar: 'An ar archive',
  cab: 'A Windows cabinet', iso: 'An ISO 9660 disc image', rar: 'A RAR archive',
};

/** The form as the lede says it: "A ZIP archive", "A tar archive, gzipped". */
export const formWords = (format: string): string => FORMS[format] ?? `An archive (${format})`;

/** The one folder that holds everything, followed down while it is alone ("all inside x/"); null when there is none. */
export function wrapOf(root: ArchiveNode): ArchiveNode | null {
  let at: ArchiveNode | null = null;
  let n = root;
  while (n.kids.size === 1) {
    const only = n.kids.values().next().value!;
    if (!only.dir) break;
    at = only;
    n = only;
  }
  return at;
}

/** What a root file says the archive is: Cargo.toml, a Rust crate. */
const SHAPES: readonly (readonly [RegExp, string])[] = [
  [/^cargo\.toml$/i, 'a Rust crate'],
  [/^package\.json$/i, 'an npm package'],
  [/^(pyproject\.toml|setup\.py)$/i, 'a Python project'],
  [/^go\.mod$/i, 'a Go module'],
  [/^AndroidManifest\.xml$/, 'an Android app'],
  [/^mimetype$/, 'a document packed as an archive'],
];

export interface ArchiveLede {
  readonly form: string;
  readonly files: number;
  /** Folders below the one that holds everything. */
  readonly folders: number;
  /** The folder that holds everything, with its slash; null when none does. */
  readonly wrap: string | null;
  readonly inFile: number;
  readonly unpacked: number;
  /** What its root says it is, and the file that says so. */
  readonly shape: { readonly what: string; readonly by: string } | null;
  readonly comment: string | null;
}

/** The facts the lede's first sentence says. */
export function archiveLede(listing: ArchiveListingLike, root: ArchiveNode): ArchiveLede {
  const s = archiveSums(listing);
  const wrap = wrapOf(root);
  const top = wrap ?? root;
  let folders = 0;
  const count = (n: ArchiveNode): void => {
    for (const k of n.kids.values()) {
      if (!k.dir) continue;
      folders++;
      count(k);
    }
  };
  count(top);
  let shape: ArchiveLede['shape'] = null;
  for (const k of top.kids.values()) {
    if (k.dir) continue;
    const hit = SHAPES.find(([re]) => re.test(k.name));
    if (hit) {
      shape = { what: hit[1], by: k.name };
      break;
    }
  }
  return { form: formWords(listing.format), files: s.files, folders, wrap: wrap?.path ?? null, inFile: listing.size, unpacked: s.unpacked, shape, comment: listing.comment };
}

/** The lede's second sentence, in the warning colour: what is encrypted, and how many entries need a careful look. */
export function careSentence(encrypted: number, careful: number): string | null {
  const parts: string[] = [];
  if (encrypted > 0) parts.push(`${encrypted === 1 ? '1 entry is' : `${n2(encrypted)} entries are`} encrypted.`);
  if (careful > 0) parts.push(`${careful === 1 ? '1 entry needs' : `${n2(careful)} entries need`} a careful look.`);
  return parts.length > 0 ? parts.join(' ') : null;
}
