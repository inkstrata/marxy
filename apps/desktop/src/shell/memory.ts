// In-memory Shell for the app harness: a recorded filesystem keyed by POSIX path.
import { imageSizeFromBytes, isInsideImageRoot } from '@marxy/core/src/render/images.ts';
import { isDeniedName } from '@marxy/core/src/index-model/deny.ts';
import { basename, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { searchContent, searchablePaths } from '@marxy/core/src/index-model/content-search.ts';
import type { ContentSignals } from '@marxy/core/src/kind/registry.ts';
import { imageFactsFromBytes, imageFormatOf } from '@marxy/core/src/viewer/image-facts.ts';
import { looksLikeMessage } from '@marxy/core/src/mail/sniff.ts';
import { extensionOf, magicOf, textTest } from '@marxy/core/src/viewer/bytes.ts';
import { decodedFrame, parseDecodedFrame, type DecodedText, type EncodingReadings } from '@marxy/core/src/encoding/byte-map.ts';
import { decodeBytes, encodeTextBytes, headEncoding, readingsOf } from '@marxy/core/src/encoding/decode.ts';
import { listArchiveBytes, readArchiveEntryBytes, readArchiveHeadsBytes } from '@marxy/core/src/viewer/archive-read.ts';
import type { ArchiveEntryRef, ClipboardRep, DbRowsPage, FileStat, ImageFacts, SheetPage, Shell, TablesSummary, WatchEvent } from '@marxy/shell-api';
import type { FontFacts, GlyphFacts } from '@marxy/core/src/viewer/font.ts';
import type { Envelope, MediaFacts } from '@marxy/core/src/viewer/media.ts';
import { standInEnvelope, standInFontFacts, standInGlyph, standInMail, standInMediaFacts, standInOffice } from '../harness/native-stand-in.ts';
import type { OutlookMail } from '@marxy/core/src/mail/outlook.ts';
import type { LegacyOffice } from '@marxy/core/src/office/legacy.ts';
import { archiveCall, boundedInflate, PAGE_ARCHIVE_LIMITS } from '../viewers/archive-bytes.ts';
import { clipboard } from './clipboard.ts';

const { BUNDLE_ID, CONCEALED, READABLE, SOURCE, TRANSIENT, checkWrite, shellError } = clipboard;

/** A fixed, realistic file time (2023-11) for every memory-shell file: a stub of 1 read as 1970 and aged "56y". */
const MEMORY_MTIME_MS = 1_700_000_000_000;

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a === b || (a.length === b.length && a.every((v, i) => v === b[i]));

export type Call = {
  readonly method: string;
  readonly args: readonly unknown[];
};

/** 1×1 PNG so fetchRemoteImage has bytes without touching the network. */
const DATA_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

export type MemoryShell = Pick<
  Shell,
  | 'readFile'
  | 'readHead'
  | 'readRange'
  | 'imageFacts'
  | 'listArchive'
  | 'readArchiveEntry'
  | 'readArchiveHeads'
  | 'tablesOpen'
  | 'tablesRows'
  | 'tablesBlob'
  | 'stat'
  | 'writeFileAtomic'
  | 'writeFileNew'
  | 'watch'
  | 'platform'
  | 'startupMarks'
  | 'readDir'
  | 'realPath'
  | 'setTitle'
  | 'setFullscreen'
  | 'isFullscreen'
  | 'saveDialog'
  | 'onCloseRequested'
  | 'confirmClose'
  | 'searchContent'
  | 'clipboardTypes'
  | 'clipboardRead'
  | 'clipboardWriteItem'
> & {
  args(): Promise<string[]>;
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
  readonly calls: Call[];
  emit(events: WatchEvent[]): void;
  /** Delete `path` from the store, as another program would (harness; recorded, emits nothing). */
  remove(path: string): void;
  /** Make `from` a symlink to the folder `to` for `realPath` (harness; the store itself holds no links). */
  link(from: string, to: string): void;
  queueSaveDialog(path: string | null): void;
  /** Next writeFileAtomic (or writeFileNew) rejects with this shell error code (harness). */
  rejectNextWrite(code: 'permission' | 'io'): void;
  /**
   * Put `bytes` at `path` as another program would (harness): unrecorded, emits nothing, no checks. With `beforeWriteNew` it is a
   * creator that wins the name between a caller's look and its write.
   */
  plant(path: string, bytes: Uint8Array): void;
  /** Put a symbolic link at the file name `path` leading to `target`, which need not exist (harness; unrecorded). */
  symlink(path: string, target: string): void;
  /** Runs at the start of every `writeFileNew`, before it looks at the name (harness): the place for a racing creator to `plant`. */
  beforeWriteNew(hook: ((path: string) => void) | null): void;
  lastTitle: string | null;
  /** Whether the window is full screen (harness): what `setFullscreen` last said, or what `leaveFullscreen` set as the OS would. */
  fullscreen: boolean;
  /** The OS takes the window out of full screen without being asked (harness; the page is told on its next look). */
  leaveFullscreen(): void;
  /** Fires every listener installed through onCloseRequested (harness). */
  emitCloseRequested(): void;
  saveDialog(opts?: { defaultPath?: string }): Promise<string | null>;
  clipboardWrite(data: { readonly text: string; readonly html?: string }): Promise<void>;
  /**
   * The fake pasteboard (harness): the items on it, first item first, as `{ type: bytes }` maps.
   * Set it as another app's copy would; `clipboardWriteItem` replaces it with the one item written.
   */
  setPasteboard(items: readonly Record<string, Uint8Array>[]): void;
  /** What `clipboardWriteItem` last put on the pasteboard, markers included; null before any write. */
  readonly lastPasteboardWrite: Readonly<Record<string, Uint8Array>> | null;
  /** The types `clipboardRead` has taken bytes of, in order: the data reads, as the native side counts them. */
  readonly pasteboardDataReads: readonly string[];
  /** How many times the native write ran (one per `clipboardWriteItem` that was not refused first). */
  readonly pasteboardNativeWrites: number;
  revealInExternalEditor(path: string, line?: number): Promise<void>;
  openExternal(url: string): Promise<void>;
  fetchRemoteImage(url: string): Promise<string>;
  configPaths(): Promise<{ config: string; data: string }>;
  /**
   * Whether `path` is already in the store. Unrecorded: a missing positions.json or history.json
   * must not appear as a `readFile` on first launch (the app-harness call record is fixed).
   */
  hasFile(path: string): boolean;
  /**
   * The file's bytes without arming anything, as Tauri's `peekFile` (the stale-write guard's blind read; this shell
   * keeps no read record, and checks only a write's own `expected`). Recorded as `readFile`: the app reads through `peekFile` where a shell has one and through
   * `readFile` where it does not, and the app-harness call record (a live reload's read, an index read) is fixed.
   */
  peekFile(path: string): Promise<Uint8Array>;
  /** Whether anything (a file, or a folder: a path some file lies under) is at `path`. Unrecorded, as `hasFile` is. */
  exists(path: string): Promise<boolean>;
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  allowAssetScope(dir: string): Promise<void>;
  /** As the desktop shell's `mark_opened`; unrecorded (the app-harness call record is fixed). Only a `scoped` shell keeps it. */
  markOpened(path: string, as?: 'file' | 'root' | 'indexRoot'): Promise<void>;
  /** As the desktop shell's `forget_root`: the folder stops being a root. Only a `scoped` shell keeps it. */
  forgetRoot(path: string): Promise<void>;
  assetUrl(path: string): string;
  /** A blob URL of the file's bytes, typed by its magic (an SVG as image/svg+xml): what an image page draws. */
  fileUrl(path: string): string;
  /** What each file's head says it is: the text test and a binary's format, as the Rust detection gives them. */
  detectFiles(paths: readonly string[]): Promise<(ContentSignals | null)[]>;
  /** The native readers' facts for the demo's fonts and media (harness/native-stand-in.ts); null for anything else. */
  fontFacts(path: string, inArchive?: ArchiveEntryRef): Promise<FontFacts | null>;
  fontGlyph(path: string, face: number, code: number, inArchive?: ArchiveEntryRef): Promise<GlyphFacts | null>;
  mediaFacts(path: string, inArchive?: ArchiveEntryRef): Promise<MediaFacts | null>;
  mediaEnvelope(path: string, buckets: number, inArchive?: ArchiveEntryRef): Promise<Envelope | null>;
  hasGitMarker(dir: string): boolean;
  decodeText(bytes: Uint8Array, chosen?: string | null): Promise<DecodedText>;
  encodeText(text: Uint8Array, label: string, bom: boolean): Promise<Uint8Array>;
  encodingReadings(bytes: Uint8Array): Promise<EncodingReadings>;
  /** The Rust reader's answer for the demo's Outlook messages (harness/native-stand-in.ts); refused for any other. */
  mailFromMsg(bytes: Uint8Array): Promise<OutlookMail>;
  /** The Rust reader's answer for the demo's Word 97-2003 document and deck; refused for any other. */
  officeFromOle(bytes: Uint8Array): Promise<LegacyOffice>;
};

/**
 * A file too large to hold, made in the page and never held (a 2 GB disk image): its size and each byte on request.
 * `readFile` refuses it, as the Rust shell refuses a file over 256 MB; its head and any range read.
 */
export interface SparseFile {
  readonly size: number;
  byteAt?(offset: number): number;
}

/** The format word detection gives for magic the app reads (as `infer` names it in the Rust shell). */
const FORMAT_WORDS: Readonly<Record<string, string>> = {
  PNG: 'png', JPEG: 'jpg', GIF: 'gif', WebP: 'webp', HEIC: 'heic', AVIF: 'avif', BMP: 'bmp', ICO: 'ico', TIFF: 'tif', 'JPEG XL': 'jxl', QOI: 'qoi',
  OpenEXR: 'exr', PDF: 'pdf', 'a zip archive': 'zip', gzip: 'gz', 'a 7z archive': '7z', 'a Windows program': 'exe', 'an SQLite database': 'sqlite',
  'a font': 'ttf', 'a WOFF font': 'woff', 'a WOFF2 font': 'woff2', 'a font collection': 'ttc', 'WAV audio': 'wav', 'an MP4 container': 'mp4', 'QuickTime video': 'mov',
  'MP3 audio': 'mp3', 'Matroska or WebM video': 'mkv',
};

const MIME: Readonly<Record<string, string>> = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
};

/** A player's type for media the webview may play from a blob, by its magic (an image's is `MIME`'s). */
const MEDIA_MIME: Readonly<Record<string, string>> = {
  'WAV audio': 'audio/wav', 'an MP4 container': 'video/mp4', 'QuickTime video': 'video/quicktime', 'MP3 audio': 'audio/mpeg', 'Matroska or WebM video': 'video/webm', Ogg: 'audio/ogg', 'FLAC audio': 'audio/flac',
};

function notFound(path: string): Error & { code: 'not-found'; path: string } {
  const err = new Error(`not found: ${path}`) as Error & { code: 'not-found'; path: string };
  err.code = 'not-found';
  err.path = path;
  return err;
}

/** The most the Rust shell's `read_head` returns. */
const HEAD_CAP_BYTES = 256 * 1024;

/** The most one pasteboard representation the Rust shell returns. */
const PASTEBOARD_CAP = 16 * 1024 * 1024;

const platformOf = (): MemoryShell['platform'] => {
  if (typeof navigator === 'undefined') return 'linux';
  if (navigator.platform.startsWith('Mac')) return 'macos';
  if (navigator.platform.startsWith('Win')) return 'windows';
  return 'linux';
};

/** One file of `harness/tables-demo.json`: what the desktop shell's readers gave for it, read whole. */
interface TablesRead {
  readonly summary: TablesSummary;
  readonly pages: Record<string, DbRowsPage | SheetPage>;
  readonly blobs: Record<string, string>;
}
type TablesDemo = Record<string, { readonly read: TablesRead; readonly alone?: TablesRead }>;

let tablesDemo: Promise<TablesDemo> | null = null;

/**
 * The browser build has no SQLite and no calamine: the demo's databases and workbooks answer from what the desktop
 * shell's readers gave for them (`cargo test write_the_demo_tables -- --ignored` writes it), matched by the end of the
 * path and the file's size. Any other one is said to be the desktop app's to read.
 */
async function tablesFor(path: string, size: number, alone: boolean): Promise<TablesRead> {
  tablesDemo ??= import('../harness/tables-demo.json?raw').then((m) => JSON.parse(m.default) as TablesDemo);
  const demo = await tablesDemo;
  const key = Object.keys(demo).find((k) => path.endsWith(`/${k}`));
  const read = key ? (alone ? (demo[key]!.alone ?? demo[key]!.read) : demo[key]!.read) : null;
  const own = read?.summary.db?.size ?? read?.summary.book?.size;
  if (!read || own !== size) {
    throw Object.assign(new Error('This build reads only the demo’s own databases and workbooks: the desktop app reads any.'), { code: 'unsupported', path });
  }
  return read;
}

/**
 * What the Rust shell's reader says of an archive's entry: the same file, read from memory as a copy
 * with nothing beside it.
 */
function asEntry(summary: TablesSummary): TablesSummary {
  return summary.db ? { ...summary, db: { ...summary.db, state: 'copy', copyWhy: 'entry', wal: null, shm: null } } : summary;
}

const b64bytes = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

type Need = 'read' | 'list' | 'folder' | 'write' | 'create';

function outside(path: string): Error & { code: 'outside'; path: string } {
  return Object.assign(new Error(`${path}: Marxy reads only the files you opened and the folders you chose`), { code: 'outside' as const, path });
}

/**
 * The desktop shell's scope (src-tauri/src/scope.rs) over POSIX paths: the files the reader opened, the folders they
 * chose (roots, and folders scoped for a document), and Marxy's own (`/data`; the config folder is `/`, so only the files
 * directly in it, and its `looks/` and `themes/`). `served` is what `marxy-file://` answers: an opened file, or a file in a scoped
 * folder that is no dot name and not under a dot or denied folder there.
 */
function createScope(fold: (path: string) => string, assetScopes: ReadonlySet<string>, isFolder: (path: string) => boolean) {
  const files = new Set<string>();
  const places = new Set<string>();
  /** Roots something besides the index chose: letting go of the index's hold leaves them. */
  const kept = new Set<string>();
  const key = (path: string): string => fold(normalizePath(path).replace(/(.)\/$/, '$1'));
  const under = (path: string, dir: string): boolean => dir === '/' || path === dir || path.startsWith(`${dir}/`);
  const own = (p: string): boolean => under(p, '/data') || under(p, '/looks') || under(p, '/themes') || (p.lastIndexOf('/') === 0 && p !== '/' && !isFolder(p));
  // A folder scoped for a document is one the reader chose too, as `allow_asset_scope`'s folders are in Rust.
  const chosen = (): string[] => [...places, ...[...assetScopes].map(key)];
  const inside = (p: string): boolean => files.has(p) || chosen().some((d) => under(p, d)) || own(p);
  const above = (dir: string): boolean => [...files, ...chosen(), '/data'].some((held) => under(held, dir));
  const gitDir = (p: string): string | null =>
    p.endsWith('/.git') ? p.slice(0, -'/.git'.length) || '/' : p.endsWith('/.git/HEAD') ? p.slice(0, -'/.git/HEAD'.length) || '/' : null;
  const parent = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/';
  return {
    holds(path: string, need: Need): boolean {
      if (path.split(/[\\/]/).includes('..')) return false;
      const p = key(path);
      const probe = gitDir(p);
      // Writing is narrower than reading: a file opened or named, and Marxy's own folders; a root or a scoped folder is
      // read-only. A probe is not limited to the nearest repository here, as it is on the desktop.
      const writable = files.has(p) || own(p);
      switch (need) {
        case 'write':
          return writable;
        case 'create':
          return writable || [...files].some((f) => parent(f) === parent(p));
        case 'read':
          return inside(p) || (probe !== null && above(probe));
        case 'list':
          return inside(p) || above(p) || (probe !== null && above(probe));
        case 'folder':
          return inside(p) || [...files].some((f) => parent(f) === p);
      }
    },
    served(path: string): boolean {
      const p = key(path);
      if (files.has(p)) return true;
      return [...assetScopes].some((dir) => {
        const d = key(dir);
        if (!under(p, d)) return false;
        const rest = (d === '/' ? p.slice(1) : p.slice(d.length + 1)).split('/');
        return !rest.some((name, i) => name.startsWith('.') || (i + 1 < rest.length && isDeniedName(name)));
      });
    },
    open(path: string, as: 'file' | 'root' | 'indexRoot'): void {
      (as === 'file' ? files : places).add(key(path));
      if (as === 'root') kept.add(key(path));
    },
    forget(path: string): void {
      if (!kept.has(key(path))) places.delete(key(path));
    },
  };
}

/**
 * An in-memory filesystem the Playwright harness drives. Paths are POSIX absolute; a missing
 * `readFile` rejects with `code: 'not-found'`.
 */
export function createMemoryShell(
  files: Record<string, Uint8Array>,
  options: {
    readonly caseInsensitive?: boolean;
    readonly sparse?: Readonly<Record<string, SparseFile>>;
    /**
     * Answer only as the desktop shell's scope does (src-tauri/src/scope.rs): a path command refuses (`outside`) a path
     * that is no file the reader opened (`markOpened`, a Save as name), no folder they chose (`markOpened` as a root,
     * `allowAssetScope`) and none of Marxy's own (`/data`, the config folder's own files, `looks/` and `themes/`), and
     * `readRange` and the viewers' calls serve only an opened file or one in a scoped folder. The app's browser build and
     * its harness turn it on, so a flow that reads before it tells the shell fails in the browser tests too.
     */
    readonly scoped?: boolean;
  } = {},
): MemoryShell {
  const store = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(files)) store.set(path, bytes.slice());
  const sparse = new Map<string, SparseFile>(Object.entries(options.sparse ?? {}));
  // Listed like any file (an empty placeholder in the store), its size and bytes from `sparse`.
  for (const path of sparse.keys()) store.set(path, new Uint8Array());
  const sizeOf = (path: string, bytes: Uint8Array | undefined): number => sparse.get(path)?.size ?? bytes?.byteLength ?? 0;
  const rangeOf = (path: string, offset: number, length: number): Uint8Array => {
    const big = sparse.get(path);
    if (big) {
      const end = Math.min(big.size, offset + length);
      const out = new Uint8Array(Math.max(0, end - offset));
      for (let i = 0; i < out.length; i++) out[i] = big.byteAt?.(offset + i) ?? 0;
      return out;
    }
    const bytes = store.get(path);
    if (!bytes) throw notFound(path);
    return bytes.slice(offset, offset + length);
  };
  const calls: Call[] = [];
  const record = (method: string, args: readonly unknown[] = []) => { calls.push({ method, args }); };
  /**
   * The bytes a reader reads: the file's, or entry `inArchive` of the archive at `path`, read by the twin
   * under the Rust shell's rules and sentences. `key` names it for the demo's tables: the archive's path, then the entry's.
   */
  const readerBytes = async (path: string, inArchive: ArchiveEntryRef | undefined): Promise<{ bytes: Uint8Array; key: string }> => {
    if (scope && !scope.served(path)) throw outside(path);
    const bytes = store.get(path);
    if (!bytes) throw notFound(path);
    if (!inArchive) return { bytes, key: path };
    const entry = await archiveCall(path, () => readArchiveEntryBytes(bytes, basename(path), inArchive.index, inArchive.name, boundedInflate, PAGE_ARCHIVE_LIMITS));
    return { bytes: entry, key: `${path}!/${inArchive.name}` };
  };
  const listeners: Array<(events: readonly WatchEvent[]) => void> = [];
  const closeListeners: Array<() => void> = [];
  const links = new Map<string, string>();
  /** Symbolic links at file names: the name is taken whether or not the target exists. */
  const fileLinks = new Map<string, string>();
  let beforeNew: ((path: string) => void) | null = null;
  // APFS by default is case-insensitive and case-preserving: `Notes.md` and `notes.md` are one name.
  const fold = (path: string): string => (options.caseInsensitive ? path.toLowerCase() : path);
  /** What is at `path` in the way a create-only write sees it: nothing is followed, so a link is a link. */
  const occupant = (path: string): 'file' | 'folder' | 'link' | null => {
    const want = fold(path.replace(/\/$/, ''));
    for (const key of fileLinks.keys()) if (fold(key) === want) return 'link';
    for (const key of store.keys()) if (fold(key) === want) return 'file';
    for (const key of store.keys()) if (fold(key).startsWith(`${want}/`)) return 'folder';
    return null;
  };
  let queuedSave: string | null | undefined;
  let writeReject: 'permission' | 'io' | null = null;
  const assetScopes = new Set<string>();
  // The fake pasteboard. Nothing below touches it except the three clipboard methods.
  let pasteboard: Record<string, Uint8Array>[] = [];
  const dataReads: string[] = [];
  let nativeWrites = 0;
  let lastWrite: Record<string, Uint8Array> | null = null;
  const isConcealed = () => pasteboard.some((item) => CONCEALED in item);

  const scope = options.scoped ? createScope(fold, assetScopes, (path) => occupant(path) === 'folder') : null;
  /** Throws `outside` when the scope does not hold `path` for `need`; a shell that is not `scoped` holds everything. */
  const guard = (path: string, need: Need): void => {
    if (scope && !scope.holds(path, need)) throw outside(path);
  };

  const assertAssetScope = (path: string): void => {
    for (const dir of assetScopes) {
      if (isInsideImageRoot(path, dir)) return;
    }
    const err = new Error(`asset scope does not include ${path}`) as Error & { code: 'permission'; path: string };
    err.code = 'permission';
    err.path = path;
    throw err;
  };

  const shell: MemoryShell = {
    calls,
    lastTitle: null,
    fullscreen: false,
    platform: platformOf(),
    async args() {
      record('args');
      return [];
    },
    async mark(name, t, data) {
      record('mark', [name, t, data]);
    },
    async quit(code) {
      record('quit', [code]);
    },
    async startupMarks() {
      record('startupMarks');
      return {};
    },
    async readFile(path) {
      record('readFile', [path]);
      guard(path, 'read');
      if (sparse.has(path)) {
        const err = new Error(`${path}: too large to open (over 256 MB)`) as Error & { code: 'refused'; path: string };
        err.code = 'refused';
        err.path = path;
        throw err;
      }
      const bytes = store.get(path);
      if (!bytes) throw notFound(path);
      return bytes.slice();
    },
    async readHead(path, maxBytes) {
      record('readHead', [path, maxBytes]);
      guard(path, 'read');
      if (!store.has(path)) throw notFound(path);
      return rangeOf(path, 0, Math.min(maxBytes, HEAD_CAP_BYTES));
    },
    async readRange(path, offset, length) {
      record('readRange', [path, offset, length]);
      // Through `marxy-file://` on the desktop, which answers 403 for a file it does not serve.
      if (scope && !scope.served(path)) throw Object.assign(new Error(`${path}: could not be read (403)`), { code: 'refused', path });
      if (!store.has(path)) throw notFound(path);
      return rangeOf(path, Math.max(0, offset), Math.max(0, Math.min(length, 4 * 1024 * 1024)));
    },
    async imageFacts(path): Promise<ImageFacts | null> {
      if (!store.has(path) || sparse.has(path) || (scope && !scope.served(path))) return null;
      const inflate = (packed: Uint8Array, limit?: number): Promise<Uint8Array> => boundedInflate(packed, 'deflate', limit);
      // Past the cap by one byte at most, so a bomb is never unpacked whole.
      const gunzip = (packed: Uint8Array, cap: number): Promise<Uint8Array | null> => boundedInflate(packed, 'gzip', cap + 1).catch(() => null);
      // A browser draws no HEIC, so on Windows the memory shell answers as a Windows without the codec does.
      return imageFactsFromBytes(store.get(path)!, { inflate, gunzip, extension: extensionOf(path), system: 'this browser', windows: platformOf() === 'windows' });
    },
    async listArchive(path) {
      record('listArchive', [path]);
      if (scope && !scope.served(path)) throw outside(path);
      if (!store.has(path)) throw notFound(path);
      if (sparse.has(path)) return null;
      return archiveCall(path, () => listArchiveBytes(store.get(path)!, basename(path), boundedInflate, PAGE_ARCHIVE_LIMITS));
    },
    async readArchiveEntry(path, index, name) {
      record('readArchiveEntry', [path, index, name]);
      if (scope && !scope.served(path)) throw outside(path);
      if (!store.has(path)) throw notFound(path);
      return archiveCall(path, () => readArchiveEntryBytes(store.get(path)!, basename(path), index, name, boundedInflate, PAGE_ARCHIVE_LIMITS));
    },
    async readArchiveHeads(path, wants, maxEach) {
      record('readArchiveHeads', [path, wants, maxEach]);
      if (scope && !scope.served(path)) throw outside(path);
      if (!store.has(path)) throw notFound(path);
      return archiveCall(path, () => readArchiveHeadsBytes(store.get(path)!, basename(path), wants, maxEach, boundedInflate, PAGE_ARCHIVE_LIMITS));
    },
    async tablesOpen(path, alone, inArchive) {
      record('tablesOpen', inArchive ? [path, alone ?? false, inArchive] : [path, alone ?? false]);
      const { bytes, key } = await readerBytes(path, inArchive);
      const head = clipboard.textLoose(bytes.subarray(0, 16));
      const zipOrCfb = bytes[0] === 0x50 && bytes[1] === 0x4b ? true : bytes[0] === 0xd0 && bytes[1] === 0xcf;
      if (head !== 'SQLite format 3\0' && !zipOrCfb) return null;
      const summary = (await tablesFor(key, bytes.length, !inArchive && (alone ?? false))).summary;
      return inArchive ? asEntry(summary) : summary;
    },
    async tablesRows(path, part, from, count, alone, full, inArchive) {
      record('tablesRows', inArchive ? [path, part, from, count, inArchive] : [path, part, from, count]);
      const { bytes, key } = await readerBytes(path, inArchive);
      const page = (await tablesFor(key, bytes.length, !inArchive && (alone ?? false))).pages[part];
      if (!page) throw Object.assign(new Error(`${part} is not a part of this file`), { code: 'invalid', path });
      if ('rows' in page) {
        const n = Math.min(count, full ? 5_000 : 200);
        return { ...page, from, rows: page.rows.slice(from, from + n), rowids: page.rowids?.slice(from, from + n) ?? null };
      }
      const to = from + Math.min(count, full ? 100_000 : 2_000);
      return { from, to, cells: page.cells.filter(([r]) => r >= from && r < to), merges: page.merges.filter((m) => m[2] >= from && m[0] < to) };
    },
    async tablesBlob(path, part, _rowid, row, column, max, alone, inArchive) {
      record('tablesBlob', inArchive ? [path, part, row, column, max, inArchive] : [path, part, row, column, max]);
      const { bytes, key } = await readerBytes(path, inArchive);
      const blob = (await tablesFor(key, bytes.length, !inArchive && (alone ?? false))).blobs[`${part}\u0000${row}\u0000${column}`];
      if (blob === undefined) throw Object.assign(new Error('This build holds only the demo’s small BLOBs.'), { code: 'unsupported', path });
      return b64bytes(blob).slice(0, Math.min(max, 16 * 1024 * 1024));
    },
    async fontFacts(path, inArchive) {
      if (inArchive) {
        record('fontFacts', [path, inArchive]);
        return standInFontFacts((await readerBytes(path, inArchive)).bytes);
      }
      return store.has(path) && !sparse.has(path) ? standInFontFacts(store.get(path)!) : null;
    },
    async fontGlyph(path, face, code, inArchive) {
      if (inArchive) {
        record('fontGlyph', [path, inArchive]);
        return standInGlyph((await readerBytes(path, inArchive)).bytes, face, code);
      }
      return store.has(path) && !sparse.has(path) ? standInGlyph(store.get(path)!, face, code) : null;
    },
    async mediaFacts(path, inArchive) {
      if (inArchive) {
        record('mediaFacts', [path, inArchive]);
        return standInMediaFacts((await readerBytes(path, inArchive)).bytes);
      }
      return store.has(path) && !sparse.has(path) ? standInMediaFacts(store.get(path)!) : null;
    },
    async mediaEnvelope(path, _buckets, inArchive) {
      if (inArchive) {
        record('mediaEnvelope', [path, inArchive]);
        return standInEnvelope((await readerBytes(path, inArchive)).bytes);
      }
      return store.has(path) && !sparse.has(path) ? standInEnvelope(store.get(path)!) : null;
    },
    async detectFiles(paths) {
      return paths.map((path) => {
        if (!store.has(path) || (scope && !scope.holds(path, 'read'))) return null;
        const head = rangeOf(path, 0, 8192);
        if (head.length === 0) return { class: 'empty' } as const;
        const magic = magicOf(head);
        const t = textTest(head);
        // As detect.rs decides: a UTF-16 or UTF-32 BOM is text; magic it knows, or a NUL in the head, is binary; the rest is
        // text, said as not UTF-8 when it is not.
        const encoding = headEncoding(head, sizeOf(path, store.get(path)) > head.length);
        if (encoding?.startsWith('utf-16') || encoding?.startsWith('utf-32')) return { class: 'text', encoding } as const;
        // As detect.rs: a PNM header under a PNM name is the picture, though P1 to P3 are text throughout.
        if (/\.(pbm|pgm|ppm|pnm|pam)$/i.test(path) && head[0] === 0x50 && head[1] >= 0x31 && head[1] <= 0x37 && [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20].includes(head[2])) return { class: 'binary', format: 'pnm' } as const;
        if ((magic && FORMAT_WORDS[magic.format]) || t.nul > 0) return { class: 'binary', format: magic ? FORMAT_WORDS[magic.format] : undefined } as const;
        // As detect.rs's heuristic: a file with no extension whose head is a message's headers is mail.
        if (!/\.[^./]+$/.test(path.slice(path.lastIndexOf('/') + 1)) && looksLikeMessage(head)) return { class: 'text', lang: 'eml' } as const;
        return encoding === '8-bit' ? ({ class: 'text', encoding } as const) : ({ class: 'text' } as const);
      });
    },
    // The Rust encoding module's port: bytes in, text and its byte map out, as the frame Rust answers with.
    async decodeText(bytes, chosen) {
      return parseDecodedFrame(decodedFrame(decodeBytes(bytes, chosen)));
    },
    async encodeText(text, label, bom) {
      try {
        return encodeTextBytes(text, label, bom);
      } catch (e) {
        throw shellError('refused', (e as Error).message);
      }
    },
    async encodingReadings(bytes) {
      return readingsOf(bytes);
    },
    async mailFromMsg(bytes) {
      record('mailFromMsg', [bytes.length]);
      const mail = standInMail(bytes);
      if (!mail) throw shellError('unsupported', 'This build reads only the demo’s own Outlook messages: the desktop app reads any.');
      return mail;
    },
    async officeFromOle(bytes) {
      record('officeFromOle', [bytes.length]);
      const office = standInOffice(bytes);
      if (!office) throw shellError('unsupported', 'This build reads only the demo’s own Word 97-2003 document and deck: the desktop app reads any.');
      return office;
    },
    async realPath(path) {
      record('realPath', [path]);
      guard(path, 'list');
      // Segment by segment, as the OS does: a link is replaced by its target before a later `..` pops it.
      let out: string[] = [];
      let todo = path.split('/').filter((s) => s !== '' && s !== '.');
      for (let hops = 0; todo.length > 0; ) {
        const seg = todo.shift()!;
        if (seg === '..') { out.pop(); continue; }
        out.push(seg);
        const target = links.get(`/${out.join('/')}`);
        if (target !== undefined && ++hops < 40) {
          out = [];
          todo = [...target.split('/').filter((s) => s !== '' && s !== '.'), ...todo];
        }
      }
      return `/${out.join('/')}`;
    },
    link(from, to) {
      links.set(from.replace(/\/$/, ''), to);
    },
    async stat(path) {
      record('stat', [path]);
      guard(path, 'list');
      const name = path.slice(path.lastIndexOf('/') + 1);
      const bytes = store.get(path);
      if (bytes) return { path, isDir: false, size: sizeOf(path, bytes), mtimeMs: MEMORY_MTIME_MS, createdMs: MEMORY_MTIME_MS };
      // Only a folder is denied by its name, as `stat_file` does.
      if (isDeniedName(name)) return null;
      const prefix = `${path.replace(/\/$/, '')}/`;
      for (const key of store.keys()) if (key.startsWith(prefix)) return { path, isDir: true, size: 0, mtimeMs: MEMORY_MTIME_MS };
      return null;
    },
    async readDir(dir) {
      record('readDir', [dir]);
      guard(dir, 'folder');
      const root = normalizePath(dir).replace(/\/$/, '');
      const prefix = `${root}/`;
      const children = new Map<string, FileStat>();
      for (const path of store.keys()) {
        if (path === root) continue;
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!name || (slash !== -1 && isDeniedName(name))) continue;
        const childPath = slash === -1 ? path : `${root}/${name}`;
        const existing = children.get(name);
        const isDir = slash !== -1;
        if (existing) {
          if (isDir) children.set(name, { ...existing, isDir: true, size: 0 });
          continue;
        }
        const bytes = store.get(path);
        children.set(name, {
          path: childPath,
          isDir,
          size: isDir ? 0 : sizeOf(path, bytes),
          mtimeMs: MEMORY_MTIME_MS,
        });
      }
      return [...children.values()].sort((a, b) => a.path.localeCompare(b.path));
    },
    async writeFileAtomic(path, bytes, expected) {
      record('writeFileAtomic', [path, bytes]);
      guard(path, 'write');
      // The next write a test means is the reader's or Marxy's other state; Marxy's version copies (`versions-<sha1>`) are
      // written on their own schedule after first text and must not take the refusal meant for a save.
      if (writeReject && !/\/versions-[0-9a-f]{40}(?:\.json|-\d\d)$/.test(path)) {
        const code = writeReject;
        writeReject = null;
        const err = new Error(`${path}: refused`) as Error & { code: typeof code; path: string };
        err.code = code;
        err.path = path;
        throw err;
      }
      // The Rust write's precondition (`write_atomic_unless_changed`); this shell keeps no record of its own reads.
      const there = store.get(path);
      if (expected && there && !sameBytes(there, expected)) {
        const err = new Error(`${path}: changed on disk since it was opened; refusing to overwrite`) as Error & { code: 'changed'; path: string };
        err.code = 'changed';
        err.path = path;
        throw err;
      }
      store.set(path, bytes.slice());
    },
    async writeFileNew(path, bytes) {
      record('writeFileNew', [path, bytes]);
      guard(path, 'create');
      beforeNew?.(path);
      if (writeReject) {
        const code = writeReject;
        writeReject = null;
        const err = new Error(`${path}: refused`) as Error & { code: typeof code; path: string };
        err.code = code;
        err.path = path;
        throw err;
      }
      const taken = occupant(path);
      if (taken !== null) {
        const err = new Error(`${path}: there is already a ${taken === 'link' ? 'symbolic link' : taken} with this name; marxy will not replace it`) as Error & { code: 'exists'; path: string };
        err.code = 'exists';
        err.path = path;
        throw err;
      }
      store.set(path, bytes.slice());
    },
    rejectNextWrite(code) {
      writeReject = code;
    },
    plant(path, bytes) {
      store.set(path, bytes.slice());
    },
    symlink(path, target) {
      fileLinks.set(path, target);
    },
    beforeWriteNew(hook) {
      beforeNew = hook;
    },
    async setTitle(title) {
      record('setTitle', [title]);
      shell.lastTitle = title;
    },
    async setFullscreen(on) {
      record('setFullscreen', [on]);
      shell.fullscreen = on;
    },
    async isFullscreen() {
      return shell.fullscreen;
    },
    leaveFullscreen() {
      shell.fullscreen = false;
    },
    onCloseRequested(cb) {
      closeListeners.push(cb);
      return () => {
        const at = closeListeners.indexOf(cb);
        if (at >= 0) closeListeners.splice(at, 1);
      };
    },
    async confirmClose() {
      record('confirmClose');
    },
    emitCloseRequested() {
      for (const cb of closeListeners) cb();
    },
    async watch(root, onEvents, opts) {
      record('watch', opts === undefined ? [root] : [root, opts]);
      guard(root, opts?.recursive === true ? 'read' : 'folder');
      listeners.push(onEvents);
      return {
        async setIgnore(folders) {
          record('watchIgnore', [root, folders]);
        },
        close() {
          const i = listeners.indexOf(onEvents);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
    },
    emit(events) {
      for (const listener of listeners) listener(events);
    },
    remove(path) {
      record('remove', [path]);
      store.delete(path);
    },
    queueSaveDialog(path) {
      queuedSave = path;
    },
    async saveDialog(opts) {
      record('saveDialog', [opts ?? {}]);
      const path = queuedSave ?? null;
      queuedSave = undefined;
      // The name the reader chose is theirs to write, as the desktop's `save_dialog` records it.
      if (path !== null) scope?.open(path, 'file');
      return path;
    },
    async clipboardWrite(data) {
      record('clipboardWrite', [data]);
    },
    setPasteboard(items) {
      pasteboard = items.map((item) => Object.fromEntries(Object.entries(item).map(([t, b]) => [t, b.slice()])));
    },
    get lastPasteboardWrite() {
      return lastWrite;
    },
    get pasteboardDataReads() {
      return dataReads;
    },
    get pasteboardNativeWrites() {
      return nativeWrites;
    },
    async clipboardTypes() {
      record('clipboardTypes');
      const types = Object.keys(pasteboard[0] ?? {});
      if (!types.includes(CONCEALED) && isConcealed()) types.push(CONCEALED);
      return types;
    },
    async clipboardRead(type) {
      record('clipboardRead', [type]);
      if (isConcealed()) throw shellError('permission', 'the clipboard holds a concealed item; Marxy does not read it');
      if (!READABLE.includes(type)) return null;
      const bytes = pasteboard[0]?.[type];
      if (!bytes) return null;
      if (bytes.byteLength > PASTEBOARD_CAP) throw shellError('invalid', `${type} is over the 16 MB clipboard cap`);
      dataReads.push(type);
      return { type, bytes: bytes.slice() };
    },
    async clipboardWriteItem(reps: readonly ClipboardRep[], meta) {
      checkWrite(reps);
      record('clipboardWriteItem', [reps, meta]);
      nativeWrites += 1;
      const item: Record<string, Uint8Array> = {};
      for (const r of reps) item[r.type] = r.bytes.slice();
      item[SOURCE] = clipboard.utf8(BUNDLE_ID);
      if (meta?.transient === true) item[TRANSIENT] = new Uint8Array();
      pasteboard = [item];
      lastWrite = item;
    },
    async revealInExternalEditor(path, line) {
      record('revealInExternalEditor', [path, line]);
    },
    async openExternal(url) {
      record('openExternal', [url]);
    },
    async fetchRemoteImage(url) {
      record('fetchRemoteImage', [url]);
      return DATA_PNG;
    },
    async configPaths() {
      record('configPaths');
      return { config: '/config', data: '/data' };
    },
    /**
     * The same search as Rust's `search_content`, over the store. Directories are path
     * prefixes and there are no symlinks, so the Rust-only symlink check has nothing to refuse here.
     */
    async searchContent(paths, query, opts) {
      record('searchContent', [paths, query, { ...opts, signal: undefined }]);
      const aborted = () => opts.signal?.aborted === true;
      const abort = () => Object.assign(new Error('content search aborted'), { name: 'AbortError' });
      if (aborted()) throw abort();
      // Only roots in scope are searched, as `search_content` keeps them.
      const roots = scope ? opts.roots.filter((r) => scope.holds(r, 'read')) : opts.roots;
      const allowed = searchablePaths(paths, roots, opts.denyGlobs ?? []);
      const result = searchContent(
        allowed,
        query,
        (path) => {
          const bytes = store.get(path);
          return bytes ? { size: bytes.byteLength, read: () => bytes.slice() } : null;
        },
        { limit: opts.limit, perFile: opts.perFile, cancelled: aborted },
      );
      if (aborted()) throw abort();
      return result;
    },
    hasFile(path) {
      return store.has(path);
    },
    async peekFile(path) {
      record('readFile', [path]);
      guard(path, 'read');
      const bytes = store.get(path);
      if (!bytes) throw notFound(path);
      return bytes.slice();
    },
    async exists(path) {
      if (store.has(path)) return true;
      const prefix = `${path.replace(/\/$/, '')}/`;
      for (const key of store.keys()) if (key.startsWith(prefix)) return true;
      return false;
    },
    async imageSize(path) {
      record('imageSize', [path]);
      guard(path, 'read');
      const bytes = store.get(path);
      if (!bytes) throw notFound(path);
      const size = imageSizeFromBytes(bytes);
      // As `open_measured_image`: an image measured under a scoped folder is served, even below a dot folder there.
      if (size && scope && [...assetScopes].some((d) => isInsideImageRoot(path, d))) scope.open(path, 'file');
      return size;
    },
    async allowAssetScope(dir) {
      record('allowAssetScope', [dir]);
      assetScopes.add(normalizePath(dir));
    },
    async markOpened(path, as) {
      if ((as === 'root' || as === 'indexRoot') && (normalizePath(path) === '/' || !(await shell.exists(path)))) throw outside(path);
      scope?.open(path, as ?? 'file');
    },
    async forgetRoot(path) {
      scope?.forget(path);
    },
    assetUrl(path) {
      record('assetUrl', [path]);
      assertAssetScope(path);
      const bytes = store.get(path);
      if (!bytes) throw notFound(path);
      const blob = new Blob([bytes.slice()], { type: /\.svg$/i.test(path) ? 'image/svg+xml' : 'image/png' });
      return URL.createObjectURL(blob);
    },
    fileUrl(path) {
      if (scope && !scope.served(path)) throw outside(path);
      const bytes = store.get(path);
      if (!bytes) throw notFound(path);
      const media = MEDIA_MIME[magicOf(bytes)?.format ?? ''];
      const blob = new Blob([bytes.slice()], { type: MIME[imageFormatOf(bytes) ?? ''] ?? media ?? 'application/octet-stream' });
      return URL.createObjectURL(blob);
    },
    hasGitMarker(dir) {
      const root = normalizePath(dir).replace(/\/$/, '');
      const prefix = `${root}/.git/`;
      for (const path of store.keys()) {
        if (path.startsWith(prefix) || path === `${root}/.git`) return true;
      }
      return false;
    },
  };
  return shell;
}
