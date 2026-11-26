/**
 * The only file that talks to Tauri. Implements the parts of shell-api the shell needs.
 *
 * Documents cross this boundary as bytes in both directions and are never turned into text here: a
 * decode and re-encode is where a byte-order mark gets eaten, a CRLF document comes back with LF
 * endings and a last line grows a newline it never had. Text is the
 * view's business; `pnpm gate:fidelity` fails if this directory starts converting.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { fileKey, normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { isInsideImageRoot } from '@marxy/core/src/render/images.ts';
import { searchablePaths } from '@marxy/core/src/index-model/content-search.ts';
import type { ContentSignals } from '@marxy/core/src/kind/registry.ts';
import { parseDecodedFrame, type DecodedText, type EncodingReadings } from '@marxy/core/src/encoding/byte-map.ts';
import { readOutlookFrame, type OutlookMail } from '@marxy/core/src/mail/outlook.ts';
import type { LegacyOffice } from '@marxy/core/src/office/legacy.ts';
import type { ArchiveEntryRef, ArchiveHead, ArchiveListing, ContentSearchResult, DbRowsPage, FileStat, ImageFacts, SheetPage, Shell, ShellError, TablesSummary, WatchEvent } from '@marxy/shell-api';
import { clipboard } from './clipboard.ts';
import { createEarlyBuffer, eventsForWatch, isNotWatching, refusalForWatch } from './watch-filter.ts';
import type { CommandRun } from '../app-types.ts';
import type { FontFacts, GlyphFacts } from '@marxy/core/src/viewer/font.ts';
import type { Envelope, MediaFacts } from '@marxy/core/src/viewer/media.ts';

/** Session-only `marxy-file:` roots. Rust also records each one; this copy is the app's check. */
const assetScopes = new Set<string>();

function assertAssetScope(path: string): void {
  for (const dir of assetScopes) {
    if (isInsideImageRoot(path, dir)) return;
  }
  const error = new Error(`asset scope does not include ${path}`) as Error & { code: 'permission'; path: string };
  error.code = 'permission';
  error.path = path;
  throw error;
}

/** Names each content search for `cancel_content_search`; a random start keeps a reload's tokens apart. */
let nextSearchToken = Math.floor(Math.random() * 2 ** 32) * 1024;

function abortError(): Error {
  const error = new Error('content search aborted');
  error.name = 'AbortError';
  return error;
}

// Files dropped from the system on Windows (src-tauri/src/drop_windows.rs): WebView2 gives the page the files but not
// their paths, so they go back to the host as additional objects, which it reads the paths from. Captured on the window
// so no view (Source's editor above all) takes an OS file drop as text to insert. A tab or text drag carries no 'Files'.
function listenForFileDrops(signal: AbortSignal): void {
  const webview = (window as { chrome?: { webview?: { postMessageWithAdditionalObjects?(message: string, objects: FileList): void } } }).chrome?.webview;
  const post = webview?.postMessageWithAdditionalObjects?.bind(webview);
  if (!post) return;
  const isFileDrag = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;
  // The cue goes when dragover stops coming: a drag that leaves the window gives no dependable dragleave.
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const cue = (on: boolean): void => {
    clearTimeout(quiet);
    document.body.toggleAttribute('data-marxy-dropping', on);
    if (on) quiet = setTimeout(() => cue(false), 250);
  };
  const over = (e: DragEvent): void => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    cue(true);
  };
  signal.addEventListener('abort', () => cue(false), { once: true });
  window.addEventListener('dragenter', over, { capture: true, signal });
  window.addEventListener('dragover', over, { capture: true, signal });
  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    cue(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    try {
      post('marxy-drop', files);
    } catch (error) {
      // WebView2 refuses a file with no path on disk (an entry dragged out of a zip, a mail attachment): nothing opens.
      console.warn('marxy: a dropped item is not a file on disk, so it was not opened', error);
    }
  }, { capture: true, signal });
}

/**
 * The file-drop listeners belong to the app instance that installed them. The shell lives as long as the window and every
 * boot subscribes again, so a subscription replaces the last one under its name.
 */
const subscriptions = new Map<string, AbortController>();

function subscribe(name: string): AbortSignal {
  subscriptions.get(name)?.abort();
  const own = new AbortController();
  subscriptions.set(name, own);
  return own.signal;
}

/** Who hears each Tauri event now: the newest boot's callback. */
const current = new Map<string, (payload: never) => void>();
/** The one `listen` per event name, kept for the life of the shell so a reboot never leaves a gap or stacks a second. */
const listening = new Map<string, Promise<void>>();

/** cb hears event from now on, in place of any earlier callback; resolves once the event is being listened for. */
function hear<T>(event: string, cb: (payload: T) => void): Promise<void> {
  current.set(event, cb as (payload: never) => void);
  let live = listening.get(event);
  if (!live) {
    live = listen<T>(event, (e) => (current.get(event) as ((payload: T) => void) | undefined)?.(e.payload)).then(() => undefined);
    listening.set(event, live);
    live.catch(() => listening.delete(event));
  }
  return live;
}

/** Stops cb hearing event, unless a newer boot has already taken its place. */
function unhear(event: string, cb: (payload: never) => void): void {
  if (current.get(event) === cb) current.delete(event);
}

/** Opens taken from the queue while no boot was subscribed: kept for the next boot, which Rust no longer holds them for. */
const unclaimedOpens: string[][] = [];

/** Hands a payload to whichever callback hears `event` now. */
function deliver<T>(event: string, payload: T): void {
  (current.get(event) as ((payload: T) => void) | undefined)?.(payload);
}

/**
 * What `readFile` last returned for a path (or what was last written or adopted there), as its length and SHA-256: a save
 * with no `expected` of its own is refused if disk no longer matches. A fingerprint, not the bytes, so holding it costs
 * nothing however large the file; Rust compares it with the file (`atomic_write::Expected`).
 */
// By `fileKey`: one record and one write queue per file, however a caller spells its path.
const lastRead = new Map<string, Promise<Uint8Array>>();

/** The length (8 bytes) then the SHA-256 of `bytes`. `digest` copies its input when called, so `bytes` may change after. */
function fingerprint(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return digest.then((d) => {
    const out = new Uint8Array(8 + d.byteLength);
    new DataView(out.buffer).setBigUint64(0, BigInt(bytes.byteLength));
    out.set(new Uint8Array(d), 8);
    return out;
  });
}

/** Fingerprints by the array they were made from: a store's `disk` is hashed once, however many saves are checked against it. */
const prints = new WeakMap<Uint8Array, Promise<Uint8Array>>();

function fingerprintOf(bytes: Uint8Array): Promise<Uint8Array> {
  let print = prints.get(bytes);
  if (!print) {
    print = fingerprint(bytes);
    // Awaited only by a later write; one that never comes must not leave an unhandled rejection.
    print.catch(() => undefined);
    prints.set(bytes, print);
  }
  return print;
}

function remember(path: string, bytes: Uint8Array): void {
  lastRead.set(fileKey(path), fingerprintOf(bytes));
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** The shell returns the file as a raw IPC body, so the bytes arrive as an ArrayBuffer rather than JSON. */
const readBytes = async (path: string): Promise<Uint8Array> => {
  onDiskOnly(path);
  try {
    return new Uint8Array(await invoke<ArrayBuffer>('read_file', { path }));
  } catch (err) {
    // Rust rejects with a ShellError (not-found, refused, io); callers (trust.json, reader config, live reload) go by `code`.
    const error = shellErrorFromInvoke(err) as ReturnType<typeof shellErrorFromInvoke> & { path?: string };
    error.path = path;
    throw error;
  }
};

/** The write running (or last queued) for each path: `writeFileAtomic` runs one per path at a time. */
const writing = new Map<string, Promise<void>>();

/**
 * One atomic write. Rust refuses it (`changed`) when the file is no longer `expected`, or what was last read when there is no
 * `expected`; it checks on the open file just before the rename, so nothing is read back here first. A file that is gone is
 * written. A file Rust cannot read to check is a refusal with its own message.
 */
async function writeAtomicNow(path: string, bytes: Uint8Array, expected?: Uint8Array): Promise<void> {
  const print = expected ? fingerprintOf(expected) : lastRead.get(fileKey(path));
  // A raw body, not `Array.from(bytes)`: a JSON array costs ~3.7 bytes per byte each way. The path
  // goes in a header, percent-encoded so any file name survives it.
  const headers: Record<string, string> = { 'x-marxy-path': encodeURIComponent(path) };
  if (print) headers['x-marxy-expect'] = hex(await print);
  try {
    await invoke('write_file_atomic', bytes, { headers });
  } catch (err) {
    throw shellErrorFromInvoke(err);
  }
  remember(path, bytes);
}

function shellErrorFromInvoke(err: unknown): Error & { code?: ShellError['code']; message: string } {
  const payload =
    err && typeof err === 'object' && 'code' in err && 'message' in err
      ? (err as ShellError)
      : {
          code: 'io' as const,
          message: err instanceof Error ? err.message : String(err),
        };
  const error = new Error(payload.message) as Error & { code?: ShellError['code']; message: string };
  error.code = payload.code;
  return error;
}

/**
 * A path that names no place on disk (an archive's entry held in memory, `archive-entry:4/notes`, or anything relative) is
 * never sent: Rust would read it against its working folder. The Rust commands refuse one too.
 */
function onDiskOnly(path: string): void {
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(path)) return;
  const error = new Error(`${path}: not a path on disk (every path the app reads is absolute)`) as Error & { code?: ShellError['code']; path?: string };
  error.code = 'invalid';
  error.path = path;
  throw error;
}

/** run_command's body: the head's JSON length (u32, little-endian), the head `{ status, stderr }`, then stdout. */
export function runFrame(body: Uint8Array): CommandRun {
  const n = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, true);
  const head = JSON.parse(clipboard.textLoose(body.subarray(4, 4 + n))) as { status: number | null; stderr: string };
  return { status: head.status, stderr: head.stderr, stdout: body.slice(4 + n) };
}

/** read_archive_heads' body: the lines' JSON length (u32, little-endian), `[{ index, length, whole, refused }]`, then each head's bytes in order. */
export function headsFrame(body: Uint8Array): ArchiveHead[] {
  const n = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, true);
  const lines = JSON.parse(clipboard.textLoose(body.subarray(4, 4 + n))) as { index: number; length: number; whole: boolean; refused: string | null }[];
  let at = 4 + n;
  return lines.map((line) => {
    const bytes = body.slice(at, at + line.length);
    at += line.length;
    return { index: line.index, bytes, whole: line.whole, refused: line.refused };
  });
}

export const shell: Pick<
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
  | 'onOpenFiles'
  | 'clipboardWrite'
  | 'clipboardTypes'
  | 'clipboardRead'
  | 'clipboardWriteItem'
  | 'configPaths'
  | 'readDir'
  | 'realPath'
  | 'setTitle'
  | 'setFullscreen'
  | 'isFullscreen'
  | 'saveDialog'
  | 'openDialog'
  | 'onCloseRequested'
  | 'confirmClose'
  | 'openExternal'
  | 'fetchRemoteImage'
  | 'revealInExternalEditor'
  | 'searchContent'
> & {
  args(): Promise<string[]>;
  /** Marks also drive the shell's harness-mode paint deadline; see `mark_from_webview`. */
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
  /** A native menu click that stands for a key chord (`marxy:menu`); the payload is the menu item's id. */
  onMenuCommand(cb: (id: string) => void): () => void;
  /** Enables or disables the native menu's registry-command items, by registry id. */
  setMenuEnabled(states: Record<string, boolean>): Promise<void>;
  /**
   * Reads without arming the stale-write guard. The live-reload watcher looks at disk to decide
   * whether to follow it; that look must not count as the app having seen (adopted) the change.
   */
  peekFile(path: string): Promise<Uint8Array>;
  /** Record `bytes` as what the app now holds for `path`, once it has actually adopted them. */
  recordRead(path: string, bytes: Uint8Array): void;
  /**
   * The document for `path` closed: what was recorded for it goes when the returned call runs (once a save it had under way
   * is done), and only if nothing has recorded `path` again since: a reopened document's record is its own.
   */
  forgetRead(path: string): () => void;
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  allowAssetScope(dir: string): Promise<void>;
  markOpened(path: string, as?: 'file' | 'root' | 'indexRoot'): Promise<void>;
  /** The index let go of a folder `markOpened` recorded as a root. */
  forgetRoot(path: string): Promise<void>;
  assetUrl(path: string): string;
  /** `marxy-file://` for a file the page opened; Rust refuses any other. */
  fileUrl(path: string): string;
  /** commands/os.rs `open_with_system`: a file the page opened, to its default program or selected in the file manager. */
  openInSystem(path: string, how: 'open' | 'reveal'): Promise<void>;
  /** commands/recent.rs `note_recent`: a document opened, for the system's Recent list. */
  noteRecent(path: string): Promise<void>;
  /** What each file's head says it is (src/detect.rs); null for a path that is not a readable regular file. */
  detectFiles(paths: readonly string[]): Promise<(ContentSignals | null)[]>;
  /** A character's Unicode name from the table compiled into the app (commands/chars.rs); null when it has none. */
  charName(code: number): Promise<string | null>;
  runCommand(id: string, input: Uint8Array, cwd: string | null): Promise<CommandRun>;
  /** commands/font.rs and commands/media.rs: only for a file the page opened. */
  fontFacts(path: string, inArchive?: ArchiveEntryRef): Promise<FontFacts | null>;
  fontGlyph(path: string, face: number, code: number, inArchive?: ArchiveEntryRef): Promise<GlyphFacts | null>;
  mediaFacts(path: string, inArchive?: ArchiveEntryRef): Promise<MediaFacts | null>;
  mediaEnvelope(path: string, buckets: number, inArchive?: ArchiveEntryRef): Promise<Envelope | null>;
  decodeText(bytes: Uint8Array, chosen?: string | null): Promise<DecodedText>;
  encodeText(text: Uint8Array, label: string, bom: boolean): Promise<Uint8Array>;
  encodingReadings(bytes: Uint8Array): Promise<EncodingReadings>;
  mailFromMsg(bytes: Uint8Array): Promise<OutlookMail>;
  officeFromOle(bytes: Uint8Array): Promise<LegacyOffice>;
} = {
  // src-tauri/src/encoding: bytes the page already read, in and out as raw bodies; the encoding rides in a header.
  decodeText: async (bytes, chosen) => {
    try {
      return parseDecodedFrame(new Uint8Array(await invoke<ArrayBuffer>('decode_text', bytes, { headers: { 'x-marxy-encoding': chosen ?? '' } })));
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  encodeText: async (text, label, bom) => {
    try {
      return new Uint8Array(await invoke<ArrayBuffer>('encode_text', text, { headers: { 'x-marxy-encoding': label, 'x-marxy-bom': bom ? '1' : '0' } }));
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  encodingReadings: async (bytes) => {
    try {
      return await invoke<EncodingReadings>('encoding_readings', bytes);
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  // src-tauri/src/outlook: the message's bytes the page already read, in as a raw body; the frame back (`readOutlookFrame`).
  mailFromMsg: async (bytes) => {
    try {
      return readOutlookFrame(new Uint8Array(await invoke<ArrayBuffer>('mail_from_msg', bytes)));
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  // src-tauri/src/legacy_office: the file's bytes the page already read, in as a raw body; the document back.
  officeFromOle: async (bytes) => {
    try {
      return await invoke<LegacyOffice>('office_from_ole', bytes);
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  charName: (code) => invoke<string | null>('char_name', { code }),
  fontFacts: async (path, inArchive) => {
    try {
      return await invoke<FontFacts | null>('font_facts', { path, inArchive: inArchive ?? null });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  fontGlyph: async (path, face, code, inArchive) => {
    try {
      return await invoke<GlyphFacts | null>('font_glyph', { path, face, code, inArchive: inArchive ?? null });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  mediaFacts: async (path, inArchive) => {
    try {
      return await invoke<MediaFacts | null>('media_facts', { path, inArchive: inArchive ?? null });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  mediaEnvelope: async (path, buckets, inArchive) => {
    try {
      return await invoke<Envelope | null>('media_envelope', { path, buckets, inArchive: inArchive ?? null });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  /** commands/run.rs: the input as a raw body, the request in `x-marxy-run`; the answer is its frame (`runFrame`). */
  runCommand: async (id, input, cwd) => {
    const request = encodeURIComponent(JSON.stringify({ id, cwd }));
    try {
      return runFrame(new Uint8Array(await invoke<ArrayBuffer>('run_command', input, { headers: { 'x-marxy-run': request } })));
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  platform: navigator.platform.startsWith('Mac') ? 'macos' : navigator.platform.startsWith('Win') ? 'windows' : 'linux',
  // Windows hands paths back with backslashes; the page spells every path with slashes (the index, Search, the tabs), so one file is one tab and one store.
  args: async () => (await invoke<string[]>('args')).map((a) => (a.startsWith('-') ? a : normalizePath(a))),
  detectFiles: (paths) => invoke<(ContentSignals | null)[]>('detect_files', { paths }),
  // A window of the file through marxy-file:// (file_scheme.rs answers one Range with 206, at most 4 MB): the hex view
  // reads a screen at a time and never the whole file, so a 2 GB file costs what is on screen.
  readRange: async (path, offset, length) => {
    if (length <= 0) return new Uint8Array();
    const res = await fetch(convertFileSrc(path, 'marxy-file'), { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (res.status === 416) return new Uint8Array();
    if (!res.ok) throw Object.assign(new Error(`${path}: could not be read (${res.status})`), { code: res.status === 403 ? 'refused' : 'io', path });
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A whole answer (no Range honoured) is cut to the window asked for.
    return res.status === 206 ? bytes.subarray(0, length) : bytes.subarray(offset, offset + length);
  },
  // image_facts is the decoders' command; a build without it (or a refusal) answers null, and the page draws
  // from what the webview loads.
  imageFacts: async (path) => {
    try {
      return await invoke<ImageFacts | null>('image_facts', { path });
    } catch (err) {
      console.info(`marxy: no image facts for ${path}: ${String(err)}`);
      return null;
    }
  },
  // commands/archive.rs: a listing, and one entry's bytes as a raw body; both only for a file the page opened.
  listArchive: async (path) => {
    try {
      return await invoke<ArchiveListing | null>('list_archive', { path });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  readArchiveEntry: async (path, index, name) => {
    try {
      return new Uint8Array(await invoke<ArrayBuffer>('read_archive_entry', { path, index, name }));
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  // The first bytes of many entries in one raw body (`headsFrame`).
  readArchiveHeads: async (path, wants, maxEach) => {
    try {
      return headsFrame(new Uint8Array(await invoke<ArrayBuffer>('read_archive_heads', { path, wants, maxEach })));
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  // commands/tables.rs: a database or a workbook, read-only, and a BLOB's bytes as a raw body.
  tablesOpen: async (path, alone, inArchive) => {
    try {
      return await invoke<TablesSummary | null>('tables_open', { path, alone: alone ?? false, inArchive: inArchive ?? null });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  tablesRows: async (path, part, from, count, alone, full, inArchive) => {
    try {
      return await invoke<DbRowsPage | SheetPage>('tables_rows', { path, part, from, count, alone: alone ?? false, full: full ?? false, inArchive: inArchive ?? null });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  tablesBlob: async (path, part, rowid, row, column, max, alone, inArchive) => {
    try {
      return new Uint8Array(await invoke<ArrayBuffer>('tables_blob', { path, part, rowid, row, column, max, alone: alone ?? false, inArchive: inArchive ?? null }));
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  fileUrl: (path) => convertFileSrc(path, 'marxy-file'),
  openInSystem: async (path, how) => {
    try {
      await invoke('open_with_system', { path, reveal: how === 'reveal' });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  noteRecent: async (path) => {
    try {
      await invoke('note_recent', { path });
    } catch {
      // Only a list the system keeps; a refusal costs the reader nothing.
    }
  },
  /** The file's bytes as they are on disk, byte-order mark and line endings included. */
  readFile: async (path) => {
    const bytes = await readBytes(path);
    remember(path, bytes);
    return bytes;
  },
  peekFile: (path) => readBytes(path),
  /** The head of a regular file; Rust refuses a symlink or anything that is not a regular file. */
  readHead: async (path, maxBytes) => {
    onDiskOnly(path);
    try {
      return new Uint8Array(await invoke<ArrayBuffer>('read_head', { path, maxBytes }));
    } catch (err) {
      const error = shellErrorFromInvoke(err) as ReturnType<typeof shellErrorFromInvoke> & { path?: string };
      error.path = path;
      throw error;
    }
  },
  realPath: async (path) => {
    onDiskOnly(path);
    try {
      return normalizePath(await invoke<string>('real_path', { path }));
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  stat: async (path) => {
    onDiskOnly(path);
    try {
      return await invoke<FileStat | null>('stat_file', { path });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  recordRead: (path, bytes) => {
    remember(path, bytes);
  },
  forgetRead: (path) => {
    const key = fileKey(path);
    const record = lastRead.get(key);
    return () => {
      if (lastRead.get(key) === record) lastRead.delete(key);
    };
  },
  /**
   * Writes exactly these bytes, staged beside the destination and renamed over it; never in place.
   * Refused when disk no longer matches `expected` (or the last read), so an external edit is never
   * silently overwritten by last-writer-wins.
   */
  writeFileAtomic: (path, bytes, expected) => {
    // One write per path at a time: a write's expectation is the record before it, and the record moves to its bytes only
    // once Rust answers, so a second write to the same path sent meanwhile would find the first one's bytes and take them
    // for another program's (positions.json, written on a timer and on an open at once, was refused so in the real window).
    const key = fileKey(path);
    const run = (writing.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => writeAtomicNow(path, bytes, expected));
    writing.set(key, run);
    void run.then(
      () => writing.get(key) === run && writing.delete(key),
      () => writing.get(key) === run && writing.delete(key),
    );
    return run;
  },
  /**
   * Create-only: the bytes at `path` only if nothing is there. No precondition and no `lastRead` entry: it never replaces
   * a file the stale-write guard has seen, and a file it makes is read (and armed) when it is opened. `exists` is the refusal.
   */
  writeFileNew: async (path, bytes) => {
    try {
      await invoke('write_file_new', bytes, { headers: { 'x-marxy-path': encodeURIComponent(path) } });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  /**
   * One `search_content` call per query. The paths are first narrowed by the same rules as the
   * index walk (roots, the built-in deny list, the reader's deny globs); Rust checks the roots, the
   * deny list and symlinks again on its side before it opens a file. Aborting cancels the scan in Rust.
   */
  searchContent: async (paths, query, opts) => {
    const signal = opts.signal;
    if (signal?.aborted) throw abortError();
    for (const root of opts.roots) onDiskOnly(root);
    const allowed = searchablePaths(paths, opts.roots, opts.denyGlobs ?? []);
    const token = nextSearchToken++;
    const onAbort = () => {
      void invoke('cancel_content_search', { token });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await invoke<ContentSearchResult>('search_content', {
        paths: allowed,
        query,
        roots: opts.roots,
        limit: opts.limit ?? null,
        perFile: opts.perFile ?? null,
        token,
      });
      if (signal?.aborted) throw abortError();
      return result;
    } catch (err) {
      if (signal?.aborted) throw abortError();
      throw shellErrorFromInvoke(err);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  },
  setTitle: (title) => invoke('set_title', { title }),
  setFullscreen: (on) => invoke('set_fullscreen', { on }),
  isFullscreen: () => invoke('is_fullscreen'),
  saveDialog: async (opts) => {
    const picked = await invoke<string | null>('save_dialog', { defaultPath: opts.defaultPath ?? null });
    return picked === null ? null : normalizePath(picked);
  },
  openDialog: async (opts) => (await invoke<string[]>('open_dialog', { directory: opts.directory ?? false, multiple: opts.multiple ?? false })).map(normalizePath),
  onCloseRequested: (cb) => {
    const heard = () => cb();
    void hear<void>('marxy:close-requested', heard);
    return () => unhear('marxy:close-requested', heard);
  },
  confirmClose: () => invoke('close_confirmed'),
  /**
   * Recurring watch of `root`, flat or `recursive`. Events arrive on the one `fs-watch` channel every
   * watcher listens to, tagged with the key of the shell watch that saw them, so each keeps only its
   * own watch's and debounces them, as the contract requires. No chrome.
   */
  watch: async (root, onEvents, opts) => {
    onDiskOnly(root);
    const recursive = opts?.recursive === true;
    let pending: WatchEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      onEvents(batch);
    };
    const receive = (payload: unknown, key: string) => {
      const refusal = refusalForWatch(payload, key);
      if (refusal !== undefined) {
        if (timer !== undefined) clearTimeout(timer);
        flush();
        opts?.onRefused?.(refusal);
        return;
      }
      const mine = eventsForWatch(payload, key);
      if (mine.length === 0) return;
      pending.push(...mine);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, 25);
    };
    // Listen BEFORE asking for the watch: the shell emits to nobody who is not listening, and a tree
    // watch can refuse (or report a change) a moment after `watch_root` returns, before this
    // function would have registered. What arrives before the key is known is kept, then replayed.
    let key: string | undefined;
    const early = createEarlyBuffer();
    const stop = await listen<unknown>('fs-watch', (event) => {
      if (key === undefined) early.add(event.payload);
      else receive(event.payload, key);
    });
    let id: number;
    try {
      ({ key, id } = await invoke<{ key: string; id: number }>('watch_root', {
        root,
        recursive,
        ignore: recursive ? (opts?.ignore ?? []).filter(isPathOnDisk) : [],
      }));
    } catch (err) {
      stop();
      throw err;
    }
    for (const payload of early.drain()) receive(payload, key);
    return {
      setIgnore: async (folders) => {
        if (!recursive) return;
        await invoke<void>('watch_ignore', { root, id, ignore: folders.filter(isPathOnDisk) });
      },
      close() {
        if (timer !== undefined) clearTimeout(timer);
        flush();
        stop();
        // A watch the shell already ended (it refused) has no entry left to release, or a newer watch
        // of the same tree holds the key: `id` names this one, and the shell answers "not watching".
        // Any other failure is real: the returned promise rejects with it (a caller that ignores the
        // promise, as the `close(): void` contract allows, sees an unhandled rejection in the console).
        return invoke<void>('unwatch_root', { root, recursive, id }).catch((err) => {
          if (!isNotWatching(err)) throw err;
        });
      },
    };
  },
  mark: (name, t, data) => invoke('mark_from_webview', { name, t, data: data ?? null }),
  quit: (code) => invoke('quit', { code: code ?? 0 }),
  startupMarks: () => invoke('startup_marks'),
  imageSize: async (path) => {
    onDiskOnly(path);
    return invoke<{ width: number; height: number } | null>('image_size', { path });
  },
  allowAssetScope: async (dir) => {
    onDiskOnly(dir);
    await invoke('allow_asset_scope', { dir });
    assetScopes.add(normalizePath(dir));
  },
  // src-tauri/src/scope.rs: what the path commands answer for. A path that names no place on disk is never sent.
  markOpened: async (path, as) => {
    if (!/^([A-Za-z]:[\\/]|[\\/])/.test(path)) return;
    try {
      await invoke('mark_opened', { path, root: as === 'root', indexed: as === 'indexRoot' });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  forgetRoot: async (path) => {
    if (!/^([A-Za-z]:[\\/]|[\\/])/.test(path)) return;
    try {
      await invoke('forget_root', { path });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
  assetUrl: (path) => {
    assertAssetScope(path);
    // Served by src-tauri/src/file_scheme.rs, with Range, from what the reader opened.
    return convertFileSrc(path, 'marxy-file');
  },
  setMenuEnabled: (states) => invoke('set_menu_enabled', { states }),
  onMenuCommand: (cb) => {
    void hear<string>('marxy:menu', cb);
    return () => unhear('marxy:menu', cb as (payload: never) => void);
  },
  onOpenFiles: (cb) => {
    // A drop's paths come back as `marxy:open-files` too, from drop_windows.rs; a no-op outside WebView2.
    const signal = subscribe('open-files');
    listenForFileDrops(signal);
    const heard = (paths: string[]) => cb(paths.map(normalizePath));
    void (async () => {
      await hear<string[]>('marxy:open-files', heard);
      if (signal.aborted) return;
      for (const paths of unclaimedOpens.splice(0)) deliver('marxy:open-files', paths);
      const pending = await invoke<string[][]>('take_pending_opens');
      // To whoever listens now: a boot that came and went while the queue was being taken must not get the batches,
      // and with none listening they wait for the next, since the queue is already emptied.
      for (const paths of pending) {
        if (current.has('marxy:open-files')) deliver('marxy:open-files', paths);
        else unclaimedOpens.push(paths);
      }
    })();
    return () => {
      unhear('marxy:open-files', heard as (payload: never) => void);
      const own = subscriptions.get('open-files');
      if (own?.signal === signal) own.abort();
    };
  },
  clipboardWrite: async (data) => {
    await invoke('clipboard_write', { text: data.text, html: data.html ?? null });
  },
  ...clipboard.tauri(invoke),
  configPaths: () => invoke<{ config: string; data: string }>('config_paths'),
  readDir: async (dir) => {
    onDiskOnly(dir);
    return (await invoke<FileStat[]>('read_dir', { dir })).map((s) => ({ ...s, path: normalizePath(s.path) }));
  },
  openExternal: async (url) => {
    await invoke('open_external', { url });
  },
  // The narrow fetch, after the reader asked: the image is held in Rust and drawn from marxy-remote://.
  fetchRemoteImage: async (url) => convertFileSrc(await invoke<string>('fetch_remote_image', { url }), 'marxy-remote'),
  /** Rust reads `external_editor` and runs it without a shell; only the path and line cross. */
  revealInExternalEditor: async (path, line) => {
    try {
      await invoke('reveal_in_editor', { path, line: line ?? null });
    } catch (err) {
      throw shellErrorFromInvoke(err);
    }
  },
};

const isPathOnDisk = (path: string): boolean => /^([A-Za-z]:[\\/]|[\\/])/.test(path);
