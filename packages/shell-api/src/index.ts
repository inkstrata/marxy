/**
 * shell-api: everything privileged the UI can do, as a handful of named functions. No invoke()
 * calls anywhere else, and `pnpm check` tests the boundaries. Switching shells means
 * reimplementing this file.
 */
export interface FileStat {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly isDir: boolean;
  /** When the file was made, from `stat` only and where the platform keeps it; absent otherwise. */
  readonly createdMs?: number;
}

/** The camera's own notes in an image's EXIF, as the shell reads them; each is absent when the file does not say it. */
export interface ImageExif {
  readonly camera?: string;
  readonly lens?: string;
  /** "1/250 s". */
  readonly exposure?: string;
  /** "f/5.6". */
  readonly aperture?: string;
  readonly iso?: number;
  /** "23 mm". */
  readonly focalLength?: string;
  /** As the camera's clock wrote it ("2026:10:12 07:41:09"): no zone. */
  readonly taken?: string;
  readonly software?: string;
}

/**
 * What an image is, read from its own bytes by the shell (the `image_facts` command). `width` and `height` are as
 * stored, before `orientation` (EXIF 1 to 8, 1 when none) turns them. `show` says how the page draws it: the webview
 * draws the file (`webview`), the shell decodes it to PNG behind `marxy-file://…?decoded` (`decoded`), or this system
 * cannot draw it (`none`, with `why`, the sentence the file card says). `location` is read but the page shows it only
 * when the reader asks, for that tab only.
 */
export interface ImageFacts {
  /** Lower case: png jpeg gif webp avif bmp ico svg tiff tga exr hdr qoi jxl heic raw pbm pgm ppm pam farbfeld dds psd svgz. */
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly orientation: number;
  /** Bits per channel. */
  readonly bitDepth: number | null;
  /** "RGB", "RGBA", "Gray", "GrayA" or "Indexed". */
  readonly channels: string | null;
  /** The ICC profile's description, or null. */
  readonly colorProfile: string | null;
  /** 1 unless animated. */
  readonly frames: number;
  readonly show: 'webview' | 'decoded' | 'none';
  readonly why: string | null;
  readonly exif: ImageExif | null;
  readonly location: { readonly lat: number; readonly lon: number } | null;
  /** What is drawn, where it is not the file's own pixels (a PSD's thumbnail); absent otherwise. */
  readonly note?: string | null;
}

/**
 * One entry of an archive as the shell lists it. `path` is sanitised: `/`-separated, relative, with no `.` or `..`
 * segment, no drive and no root, a folder ending in `/`; it names nothing on disk. `rawName` is the name as the archive
 * wrote it, when listing it changed more than its slashes (`../../evil.txt`). `index` is what `readArchiveEntry` asks for.
 */
export interface ArchiveEntry {
  readonly index: number;
  readonly path: string;
  readonly kind: 'file' | 'dir' | 'link' | 'other';
  /** Unpacked, as the archive declares it; null when it does not say (a lone `.bz2`). */
  readonly size: number | null;
  /** Packed (zip); null where the format keeps none per entry (tar). */
  readonly packed: number | null;
  /** `2026-10-14T16:16:00Z` when the time is known in UTC; without the `Z` when the archive gave a clock time (zip). */
  readonly mtime: string | null;
  readonly encrypted: boolean;
  /** A zip's compression when it is not one the shell reads (stored, deflated): "bzip2", "zstd", "AES"... */
  readonly method: string | null;
  readonly rawName: string | null;
  /** A link's target, for showing only: never followed. */
  readonly link: string | null;
  /** zip: its local header's byte in the file. tar: its header's byte in the unpacked stream. A lone gz, bz2 or xz: null. */
  readonly offset: number | null;
  /** zip: the CRC-32 its central directory records; null elsewhere. */
  readonly crc: number | null;
  /** zip: the system that wrote it ("DOS or Windows", "Unix", "macOS", "Windows NTFS", "VFAT", "system 7"); null elsewhere. */
  readonly host: string | null;
  /** zip: its Unix mode, when written on Unix and kept; tar: its header's mode; else null. */
  readonly mode: number | null;
  /** zip: its general-purpose bit flags; null elsewhere. */
  readonly flags: number | null;
  /** zip: its own comment, control characters replaced as a name's are; null when empty or elsewhere. */
  readonly comment: string | null;
}

/** The first bytes of one entry (`readArchiveHeads`), or the sentence why there are none. */
/**
 * One entry of the archive at a reader's `path`: its ordinal and the name the listing gave it. A reader
 * given one reads that entry, held in memory, in place of the file at `path`; a name that no longer matches is "The
 * archive changed since it was listed."
 */
export interface ArchiveEntryRef {
  readonly index: number;
  readonly name: string;
}

export interface ArchiveHead {
  readonly index: number;
  /** At most the `maxEach` asked for, and never past 256 KB; empty when refused. */
  readonly bytes: Uint8Array;
  /** The entry ended inside `bytes`. */
  readonly whole: boolean;
  /** The sentence the page says: encrypted, a method not read, a folder, a link, or "The archive changed since it was listed.". */
  readonly refused: string | null;
}

/** An archive's listing: read from its directory or its headers, never extracted, capped against bombs. */
export interface ArchiveListing {
  /** zip, tar, tar.gz, tar.bz2, tar.xz, tar.zst, 7z, deb (or another ar), cab, iso, rar, or a lone gz, bz2, xz or zst. */
  readonly format: string;
  readonly entries: readonly ArchiveEntry[];
  readonly comment: string | null;
  /** The sentence the page says when the listing stopped at a cap or a damaged part; null when it is whole. */
  readonly truncated: string | null;
  /** Entries left out: a name past 1,024 bytes or 64 folders deep, or one with nothing left once sanitised. */
  readonly skipped: number;
  /** A zip's entry count as its end record declares it. */
  readonly declared: number | null;
  /** The archive's own bytes. */
  readonly size: number;
  /** A compressed tar's unpacked stream, when it was walked to its end. */
  readonly unpacked: number | null;
  /** A zip's central directory, where it lies in the file (after any prefix); null for other formats. */
  readonly directory: { readonly at: number; readonly size: number } | null;
  /** What of the archive the app does not read, said under the lede: a RAR's contents, a cabinet's LZX folders. */
  readonly note?: string | null;
}

/**
 * One value of a table page: a database's NULL, or a sheet's empty cell, is null. An integer comes as text so 64
 * bits arrive whole; a real that is not finite comes as `s`; text past the cap is cut and `more` says how many characters
 * were left out; a BLOB is its size. A sheet's `none` is a formula's cell with no saved value.
 */
export type TableValue =
  | null
  | { readonly k: 'int'; readonly v: string }
  | { readonly k: 'real'; readonly v?: number; readonly s?: string }
  | { readonly k: 'text'; readonly v: string; readonly more?: number }
  | { readonly k: 'blob'; readonly n: number }
  | { readonly k: 'bool'; readonly v: boolean }
  | { readonly k: 'err'; readonly v: string }
  | { readonly k: 'date'; readonly v: number; readonly iso: string }
  | { readonly k: 'iso'; readonly v: string }
  | { readonly k: 'none' };

export interface DbColumn {
  readonly name: string;
  /** The declared type, as the CREATE statement writes it; '' when none. */
  readonly decl: string;
  readonly key: boolean;
  /** The column is the rowid itself (an INTEGER PRIMARY KEY). */
  readonly rowid: boolean;
}

/** A table or a view: `internal` is SQLite's own (`sqlite_sequence`). */
export interface DbPart {
  readonly name: string;
  readonly kind: 'table' | 'view' | 'internal';
  /** Counted from its b-tree as the database opened; null for a view, or a count stopped at its cap. */
  readonly rows: number | null;
  readonly columns: readonly DbColumn[];
  readonly columnsMore: number;
  /** The page shows a rowid column of its own. */
  readonly rowid: boolean;
  /** WITHOUT ROWID: stored in key order. */
  readonly keyOrder: boolean;
  readonly sql: string | null;
}

export interface DbSummary {
  /** In place; in place with its log over the file; the file without its log (the reader's choice); a copy in memory. */
  readonly state: 'place' | 'wal' | 'alone' | 'copy';
  /**
   * Why a copy: another program holds it (`locked`), its log has no index SQLite could read without making one (`index`),
   * or it is an archive's entry held in memory, with no place on disk and nothing beside it (`entry`).
   */
  readonly copyWhy: 'locked' | 'index' | 'entry' | null;
  readonly header: {
    readonly pageSize: number;
    readonly pages: number;
    readonly freelist: number;
    readonly encoding: string;
    readonly journal: 'wal' | 'rollback';
    readonly userVersion: number;
    readonly applicationId: number;
    /** SQLITE_VERSION_NUMBER of the SQLite that last wrote it (3049001). */
    readonly writtenBy: number;
    readonly schemaFormat: number;
  };
  readonly wal: {
    readonly name: string;
    readonly bytes: number;
    readonly frames: number;
    readonly commits: number;
    /** Frames not yet copied back into the file, as the -shm says. */
    readonly pending: number | null;
    /** The log was read: its pages stand over the file's. */
    readonly read: boolean;
  } | null;
  readonly shm: string | null;
  readonly parts: readonly DbPart[];
  readonly schema: readonly { readonly kind: string; readonly name: string; readonly table: string; readonly sql: string | null }[];
  readonly schemaMore: boolean;
  /** The SQLite that reads it here. */
  readonly library: string;
  readonly size: number;
}

export interface SheetPart {
  readonly name: string;
  readonly state: 'visible' | 'hidden' | 'very';
  readonly kind: 'worksheet' | 'chart' | 'dialog' | 'macro' | 'vba';
  /** The last row and column with something in them, counted from A1. */
  readonly rows: number;
  readonly cols: number;
  readonly cells: number;
  readonly formulas: number;
  readonly merged: number;
  /** Said when the sheet was read only so far. */
  readonly cut: string | null;
}

export interface BookSummary {
  readonly format: 'xlsx' | 'xlsm' | 'xls' | 'ods';
  readonly sheets: readonly SheetPart[];
  /** Number formats as the file writes them; a cell's `x` names one. */
  readonly formats: readonly string[];
  /** The file's number formats were read: an xlsx's styles, an xls's FORMAT and XF records, an ods's data styles. */
  readonly formatsRead: boolean;
  readonly properties: {
    readonly application: string | null;
    readonly appVersion: string | null;
    readonly creator: string | null;
    readonly lastModifiedBy: string | null;
    readonly created: string | null;
    readonly modified: string | null;
    readonly title: string | null;
  };
  readonly macros: boolean;
  /** Other files the workbook links to, by the name it gives them: never opened. */
  readonly links: readonly string[];
  readonly parts: number | null;
  readonly compound: { readonly sector: number; readonly streams: readonly (readonly [string, number])[] } | null;
  readonly size: number;
}

/** What `tablesOpen` found: a database or a workbook. */
export interface TablesSummary {
  readonly kind: 'sqlite' | 'sheet';
  readonly db: DbSummary | null;
  readonly book: BookSummary | null;
}

/** A page of a database's rows, from row `from` (0-based) in stored order. */
export interface DbRowsPage {
  readonly from: number;
  readonly rows: readonly (readonly TableValue[])[];
  readonly rowids: readonly number[] | null;
  /** A view's column names, as its query names them. */
  readonly columns: readonly string[] | null;
  readonly total: number | null;
  /** Said when the query was stopped at its time cap. */
  readonly stopped: string | null;
}

export interface SheetCell {
  readonly v?: TableValue;
  /** The formula as written, without its `=`. */
  readonly f?: string;
  /** The index of its number format in `BookSummary.formats`. */
  readonly x?: number;
}

/** A sheet's rows `from` up to `to`: its cells `[row, column, cell]` 0-based from A1, and the merges that touch them. */
export interface SheetPage {
  readonly from: number;
  readonly to: number;
  readonly cells: readonly (readonly [number, number, SheetCell])[];
  readonly merges: readonly (readonly [number, number, number, number])[];
}

export interface WatchEvent {
  readonly kind: 'modified' | 'created' | 'removed' | 'renamed';
  readonly path: string;
  /** For renames: the new path. Atomic write-temp-then-rename arrives as 'renamed' onto the watched path. */
  readonly to?: string;
}

/** One place a content search matched. */
export interface ContentHit {
  readonly path: string;
  /** 1-based, counting `\n` (a CRLF file numbers its lines as an LF one does). */
  readonly line: number;
  /** Absolute byte offset of the match in the file as written: UTF-8, byte-order mark and CRLF included. */
  readonly byteOffset: number;
  /** The matching line, cut to at most 160 characters around the match, control characters as spaces. */
  readonly preview: string;
  /** UTF-16 offsets of the match in `preview`. */
  readonly matchStart: number;
  readonly matchEnd: number;
}

export interface ContentSearchOptions {
  /**
   * The collection's roots. A path outside every root, in a built-in deny-listed directory, matched
   * by `denyGlobs`, or reached through a symlink is never read.
   */
  readonly roots: readonly string[];
  /** The reader's deny globs from `collection.toml`, as the index walk applies them. */
  readonly denyGlobs?: readonly string[];
  /** Hits in all; default 200. */
  readonly limit?: number;
  /** Hits per file; default 5. */
  readonly perFile?: number;
  /** Aborting stops the scan in the shell and rejects with an `AbortError`. */
  readonly signal?: AbortSignal;
}

export interface ContentSearchResult {
  readonly hits: readonly ContentHit[];
  /** Files read and searched; skipped files do not count. */
  readonly scannedFiles: number;
  /** Files the scan was allowed to read and did not search: binary, over 256 MB or unreadable (a path that no longer exists is not counted). */
  readonly skippedFiles: number;
  /** More hits exist than were returned, or the scan stopped at a cap before reading every path. */
  readonly truncated: boolean;
  /** The budget that ended the scan early (bytes read, time, number of files), or null. */
  readonly stopped: 'bytes' | 'time' | 'files' | null;
}

/**
 * The types on the pasteboard's first item (UTI strings, as the OS reports them), plus
 * `org.nspasteboard.ConcealedType` when any item carries it. Listing reads no data.
 */
export type PasteboardTypes = readonly string[];

/** One representation of a clipboard item: a type and its bytes (text types are UTF-8). */
export interface ClipboardRep { readonly type: string; readonly bytes: Uint8Array; }

export interface ClipboardMeta {
  /** Mark the item `org.nspasteboard.TransientType` so clipboard managers skip it. Default false. */
  readonly transient?: boolean;
}

export type ShellError = {
  /** `outside`: a path that is no file the reader opened, no folder they chose and none of Marxy's own (the shell's scope). */
  readonly code: 'not-found' | 'permission' | 'io' | 'invalid' | 'unsupported' | 'refused' | 'exists' | 'changed' | 'outside';
  readonly message: string;
  readonly path?: string;
};

export interface Shell {
  /** Raw bytes; the buffer layer decodes and keeps the original for byte-faithful saves. */
  readFile(path: string): Promise<Uint8Array>;
  /**
   * Atomic: write to a temp file in the same directory, fsync, rename over. Never in place. With `expected` (the bytes
   * the caller last read at `path`), rejects with `code: 'changed'` and writes nothing when the file there is no longer
   * those bytes; the shell checks that itself, just before the rename, so the caller never reads the file again to
   * save it. A file that is gone is written. Without it, a shell may check against what it last read at `path`.
   */
  writeFileAtomic(path: string, bytes: Uint8Array, expected?: Uint8Array): Promise<void>;
  /**
   * Create-only: writes exactly `bytes` at `path` only if nothing is there, else rejects with `code: 'exists'` and
   * writes nothing. "Nothing" is exact: a file, a folder, a symlink, a symlink that leads nowhere, and (on a case-insensitive
   * volume) a name that differs only in case all refuse. A link at `path` is never followed. The refusal is decided by the
   * operating system in the same step that makes the name appear, not by a look beforehand, so a creator racing this write is
   * never replaced. Staged and flushed first, like `writeFileAtomic`: the whole file appears, or none, and a failed write leaves no
   * temporary file. Where the volume cannot do that safely it rejects (`io`) rather than risk a replace. The write for anything
   * made beside a reader's file instead of over it; it never replaces, so it has no stale-write precondition.
   */
  writeFileNew(path: string, bytes: Uint8Array): Promise<void>;
  /**
   * One file's size and modification time without listing its folder. A narrower form of
   * `readDir`: `null` for a path that is missing, one that is itself a symlink (`readDir` omits every one) or named like a
   * deny-listed directory; a folder is reported with `isDir`.
   */
  stat(path: string): Promise<FileStat | null>;
  /**
   * At most the first `maxBytes` of a regular file, capped by the shell at 256 KB. A narrower
   * form of `readFile`: it rejects when the path itself is a symlink, a folder or any file that is not a regular one,
   * and its open neither follows a link nor blocks on a named pipe. It does not arm the stale-write guard.
   */
  readHead(path: string, maxBytes: number): Promise<Uint8Array>;
  /**
   * At most `length` bytes of a regular file from `offset` (for the hex view): a window, never the whole file, so a 2 GB
   * file is read a screen at a time. Fewer bytes at the end; none past it. Only a file the page has opened (read, its head
   * read, or under a folder it scoped) is served.
   */
  readRange(path: string, offset: number, length: number): Promise<Uint8Array>;
  /**
   * What an image is, from its own bytes (`ImageFacts`), or null when it is not an image the shell's reader knows. A
   * file the page has opened only.
   */
  imageFacts(path: string): Promise<ImageFacts | null>;
  /**
   * An archive's entries, or null when it is not an archive the shell reads. Rejects `unsupported` for one it knows
   * but cannot read (a 7z whose list of entries is encrypted or packed with a filter chain; 7z, bzip2 and xz in the
   * browser build), `refused` for a 7z whose list of entries is over 16 MB or declares over 1,000,000 entries or
   * 200,000 blocks. Nothing is extracted. A file the page has opened only.
   */
  listArchive(path: string): Promise<ArchiveListing | null>;
  /**
   * One entry's bytes, into memory only, at most 16 MB unpacked. `name` is the entry's listed `path`, which must
   * still sit at `index`. Rejects `refused` past the cap, for an encrypted entry, or for one further into an unpacked
   * stream than is walked (1 GB of a compressed tar or a 7z's solid block in the desktop build; 256 MB of a compressed
   * tar in the browser build and in an archive held inside another, where no 7z is read), `unsupported` for a compression the shell does not read, `invalid` for a folder, a link or
   * damage. A file the page has opened only.
   */
  readArchiveEntry(path: string, index: number, name: string): Promise<Uint8Array>;
  /**
   * The first bytes of many entries in one call, in the order of `wants`: at most `maxEach` (clamped
   * to 1 to 256 KB) each, and 16 MB in all; the wants past that are left out, for the page to ask again. A want that
   * cannot be answered (no longer the `name` at its `index`, encrypted, a method not read, a folder, a link) comes back
   * refused with its sentence; only a fault reaching the file itself (not held, not found, not an archive, damaged
   * before any entry) rejects the call. Nothing is written. A file the page has opened only.
   */
  readArchiveHeads(path: string, wants: readonly { index: number; name: string }[], maxEach: number): Promise<readonly ArchiveHead[]>;
  /**
   * A SQLite database or a spreadsheet, or null when its bytes are neither. `alone` reads a database without its
   * write-ahead log. Read-only: nothing is written, checkpointed or recalculated. A file the page has opened only.
   * `inArchive` reads that entry of the archive at `path` instead, from memory (it has no log beside it).
   */
  tablesOpen(path: string, alone?: boolean, inArchive?: ArchiveEntryRef): Promise<TablesSummary | null>;
  /**
   * `count` rows of a table, a view or a sheet (`part`, by name) from row `from`, bounded by the shell's caps: 200 rows of
   * a database and 2,000 of a sheet a call, text cut at 2,000 characters. `full` (Export) reads 5,000 and 100,000 rows a
   * call with text whole up to a million characters.
   */
  tablesRows(path: string, part: string, from: number, count: number, alone?: boolean, full?: boolean, inArchive?: ArchiveEntryRef): Promise<DbRowsPage | SheetPage>;
  /**
   * The first `max` bytes (at most 16 MB) of a BLOB, by its rowid where the table has one, else by its row (0-based) in
   * stored order.
   */
  tablesBlob(path: string, part: string, rowid: number | null, row: number, column: string, max: number, alone?: boolean, inArchive?: ArchiveEntryRef): Promise<Uint8Array>;
  /**
   * Directory watch, debounced by the shell; the callback receives batches. By default the folder's
   * own files (and the folders of symlinked documents in it). With `recursive`, every file in the
   * tree, never following a symlink and skipping the index's deny-listed directories; it rejects
   * when the tree is too large or the OS refuses the watch, so the caller can fall back. A tree that
   * grows too large after the watch opened ends it: `onRefused` is then called once with the reason,
   * no event follows, and the caller still `close()`s the handle.
   *
   * A recursive watch may be told folders to leave out (`ignore`, absolute paths, only those inside `root` count):
   * their files are not listed, counted or reported. `setIgnore` replaces the list on a running watch; a folder that
   * is no longer on it is listed again, and its files are reported as created.
   */
  watch(
    root: string,
    onEvents: (events: readonly WatchEvent[]) => void,
    opts?: { readonly recursive?: boolean; readonly onRefused?: (reason: string) => void; readonly ignore?: readonly string[] },
  ): Promise<{ close(): void; setIgnore?(folders: readonly string[]): Promise<void> }>;
  openDialog(opts: { readonly directory?: boolean; readonly multiple?: boolean }): Promise<readonly string[]>;
  revealInExternalEditor(path: string, line?: number): Promise<void>;
  /** @deprecated copies go through `clipboardWriteItem` (one item, every representation); this stays as the fallback where the shell answers `unsupported`. */
  clipboardWrite(data: { readonly text: string; readonly html?: string }): Promise<void>;
  /**
   * The first pasteboard item's types; reads no data. Call only from a reader action (paste,
   * transform the clipboard): nothing in the shell polls or observes the pasteboard.
   * Rejects `unsupported` where there is no native pasteboard.
   */
  clipboardTypes(): Promise<PasteboardTypes>;
  /**
   * One representation of the first item, or `null` when it holds none of that type or the type
   * is not readable (text, HTML, RTF, URL, PNG). A concealed item (a password manager's copy)
   * rejects `permission` before any of it is read; a representation over 16 MB rejects `invalid`.
   * Call only from a reader action.
   */
  clipboardRead(type: string): Promise<ClipboardRep | null>;
  /**
   * Replace the clipboard with ONE item holding every representation, tagged with Marxy as its
   * source. Only text, HTML, RTF and URL types are accepted; any other type (the pasteboard marker
   * types included), an empty list or a repeated type rejects `invalid` before the shell is called.
   * Text types must be valid UTF-8.
   */
  clipboardWriteItem(reps: readonly ClipboardRep[], meta?: ClipboardMeta): Promise<void>;
  /** A URL the webview may load for a local file (asset protocol), scoped to the document's directory. */
  assetUrl(path: string): string;
  /** Files handed to a running instance by the OS or a second launch (single-instance). */
  onOpenFiles(cb: (paths: readonly string[]) => void): () => void;
  readonly platform: 'macos' | 'linux' | 'windows';
  /** Time origin for startup measurement: ms since process start at the moment the webview loaded. */
  startupMarks(): Promise<Readonly<Record<string, number>>>;
  /** Process command-line arguments passed at launch. */
  args(): Promise<readonly string[]>;
  /** Record a startup timing mark from the webview. */
  mark(name: string, t: number, data?: string): Promise<void>;
  /** Exit the application with an optional status code. */
  quit(code?: number): Promise<void>;
  /** List one directory level with the deny list applied in the shell. */
  readDir(dir: string): Promise<readonly FileStat[]>;
  /**
   * The path with every symlink and `.`/`..` segment resolved by the OS: the spelling `readDir` and `watch`
   * report. Reads only metadata of the path and its ancestors; rejects `not-found` for a path that does not exist.
   */
  realPath(path: string): Promise<string>;
  /** Set the window title. A title change never moves or reveals the window controls. */
  setTitle(title: string): Promise<void>;
  /** Put the window in or out of full screen. */
  setFullscreen(on: boolean): Promise<void>;
  /** Whether the window is full screen now (the OS may have changed it without being asked). */
  isFullscreen(): Promise<boolean>;
  /** Intrinsic dimensions of a local image file, or null when unknown. */
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  /** Open an http, https, or mailto URL externally; other schemes reject with code unsupported. */
  openExternal(url: string): Promise<void>;
  /** Resolved paths for app config and data directories. */
  configPaths(): Promise<{ config: string; data: string }>;
  /** Add a recursive asset-protocol scope for this session only. */
  allowAssetScope(dir: string): Promise<void>;
  /** Native save dialog; returns the chosen path or null if cancelled. */
  saveDialog(opts: { defaultPath?: string }): Promise<string | null>;
  /** Fetch a remote image through the shell and return a marxy-remote URL. */
  fetchRemoteImage(url: string): Promise<string>;
  /** The window's own close was requested (the OS close box, Cmd+W, Cmd+Q); the app decides whether
   *  to let it proceed, via `confirmClose`. */
  /** Returns what takes `cb` off, as its boot ends. */
  onCloseRequested(cb: () => void): () => void;
  /** Let a previously-requested window close proceed. */
  confirmClose(): Promise<void>;
  /**
   * Search these files' contents for `query` in one shell call: nothing is
   * indexed or written, and nothing but the passed paths is read. Smart case: an all-lowercase query
   * matches ASCII case-insensitively, any uppercase means exact bytes. Hits come in path order.
   */
  searchContent(paths: readonly string[], query: string, opts: ContentSearchOptions): Promise<ContentSearchResult>;
}

/** No-op Shell used only for compile-time completeness checks. */
function stubShellImpl(): Shell {
  return {
    readFile: async () => new Uint8Array(),
    writeFileAtomic: async () => {},
    writeFileNew: async () => {},
    stat: async () => null,
    readHead: async () => new Uint8Array(),
    readRange: async () => new Uint8Array(),
    imageFacts: async () => null,
    listArchive: async () => null,
    readArchiveEntry: async () => new Uint8Array(),
    readArchiveHeads: async () => [],
    tablesOpen: async () => null,
    tablesRows: async () => ({ from: 0, rows: [], rowids: null, columns: null, total: null, stopped: null }),
    tablesBlob: async () => new Uint8Array(),
    watch: async () => ({ close() {} }),
    openDialog: async () => [],
    revealInExternalEditor: async () => {},
    clipboardWrite: async () => {},
    clipboardTypes: async () => [],
    clipboardRead: async () => null,
    clipboardWriteItem: async () => {},
    assetUrl: () => '',
    onOpenFiles: () => () => {},
    platform: 'macos',
    startupMarks: async () => ({}),
    args: async () => [],
    mark: async () => {},
    quit: async () => {},
    readDir: async () => [],
    realPath: async (path) => path,
    setTitle: async () => {},
    setFullscreen: async () => {},
    isFullscreen: async () => false,
    imageSize: async () => null,
    openExternal: async () => {},
    configPaths: async () => ({ config: '', data: '' }),
    allowAssetScope: async () => {},
    saveDialog: async () => null,
    fetchRemoteImage: async () => '',
    onCloseRequested: () => () => {},
    confirmClose: async () => {},
    searchContent: async () => ({ hits: [], scannedFiles: 0, skippedFiles: 0, truncated: false, stopped: null }),
  };
}

function stubShellWithout<K extends keyof Shell>(omit: K): Omit<Shell, K> {
  const shell = stubShellImpl();
  const { [omit]: _removed, ...rest } = shell;
  return rest;
}

/** Compile-time check that Shell lists every member. */
const memoryShellLike: Shell = stubShellImpl();
void memoryShellLike;

// @ts-expect-error fetchRemoteImage is required on Shell
const _shellMissingFetchRemote: Shell = stubShellWithout('fetchRemoteImage');
void _shellMissingFetchRemote;

// @ts-expect-error confirmClose is required on Shell
const _shellMissingConfirmClose: Shell = stubShellWithout('confirmClose');
void _shellMissingConfirmClose;
