// The app's types: what a shell must offer `startApp`, and the handle it returns. Apart from
// app.ts so the composition root stays under 300 lines; app.ts re-exports them, and every module that
// imports them from there still does.
import type { Buffer, ContentSignals, Document, Edit } from '@marxy/core';
import type { FontFacts, GlyphFacts } from '@marxy/core/src/viewer/font.ts';
import type { Envelope, MediaFacts } from '@marxy/core/src/viewer/media.ts';
import type { DecodedText, EncodingReadings } from '@marxy/core/src/encoding/byte-map.ts';
import type { OutlookMail } from '@marxy/core/src/mail/outlook.ts';
import type { LegacyOffice } from '@marxy/core/src/office/legacy.ts';
import type { ArchiveEntryRef, Shell } from '@marxy/shell-api';
import type { OpenOptions } from './document/open.ts';
import type { DocumentStore } from './document/store.ts';
import type { IndexService } from './index/service.ts';
import type { AppPanes } from './pane/index.ts';
import type { PaletteSession } from './palette/session.ts';
import type { NodeMap } from './render/post.ts';
import type { SaveResult } from './save.ts';
import type { Frame } from './frame/types.ts';
import type { RenderedSelection } from './selection/view.ts';
import type { OpenDocument } from './view/rendered-view.ts';

/** The shell surface: frozen Shell members tauri.ts already implements, plus startup extras. */
export type AppShell = Pick<
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
  | 'allowAssetScope'
  | 'onCloseRequested'
  | 'confirmClose'
  | 'searchContent'
> & {
  args(): Promise<string[]>;
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
  /** Tauri shell only: read without arming the stale-write guard. */
  peekFile?(path: string): Promise<Uint8Array>;
  recordRead?(path: string, bytes: Uint8Array): void;
  forgetRead?(path: string): () => void;
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  allowAssetScope(dir: string): Promise<void>;
  /**
   * The reader opened `path` (a file), or chose it as a folder for the index (`root`). The shell's path commands answer
   * only for what this, the launch, a drop and the pickers recorded, and for Marxy's own folders: reading or indexing a
   * file never adds it. Call it before reading what the reader opened. A path that is not there is still recorded, so
   * its read says `not-found`; a folder that cannot be a root rejects `outside`.
   */
  markOpened?(path: string, as?: 'file' | 'root' | 'indexRoot'): Promise<void>;
  /** The index let go of a folder `markOpened` recorded as a root: the shell stops answering for it. */
  forgetRoot?(path: string): Promise<void>;
  assetUrl(path: string): string;
  /**
   * A URL the webview may load for a file the page itself opened (its head read): an image page's picture, served with
   * Range by `marxy-file://`. Unlike `assetUrl` it needs no folder scoped, and the shell still refuses any file the page
   * did not open.
   */
  fileUrl(path: string): string;
  /**
   * Tauri shell only: hands a file the page opened to the system: `open` in the program the system uses for its kind
   * (never a program itself: that is refused), `reveal` selected in the system's file manager. Throws when refused.
   */
  openInSystem?(path: string, how: 'open' | 'reveal'): Promise<void>;
  /** Tauri shell only: a document the reader opened, for the system's Recent list (a no-op off Windows). Never throws. */
  noteRecent?(path: string): Promise<void>;
  /** Tauri shell only: what each file's head says it is, null where it could not be read. Without it, names alone decide. */
  detectFiles?(paths: readonly string[]): Promise<(ContentSignals | null)[]>;
  configPaths?(): Promise<{ config: string; data: string }>;
  /** Tauri shell only: the system's picker; what the reader chose, or none when they cancelled. */
  openDialog?(opts: { readonly directory?: boolean; readonly multiple?: boolean }): Promise<readonly string[]>;
  /** Returns what takes `cb` off, as its boot ends. */
  onOpenFiles?(cb: (paths: readonly string[]) => void): () => void;
  /** Tauri shell only: a character's Unicode name, said in lower case; null when it has none. */
  charName?(code: number): Promise<string | null>;
  /** A font file's facts (src-tauri/src/font): null when it is not a font. The browser build answers for the demo's own. */
  fontFacts?(path: string, inArchive?: ArchiveEntryRef): Promise<FontFacts | null>;
  /** What face `face` of a font maps `code` to; null when it maps nothing. */
  fontGlyph?(path: string, face: number, code: number, inArchive?: ArchiveEntryRef): Promise<GlyphFacts | null>;
  /** An audio or video file's facts from its container's header; null when it is not a container the shell reads. */
  mediaFacts?(path: string, inArchive?: ArchiveEntryRef): Promise<MediaFacts | null>;
  /** A PCM WAV's waveform in `buckets` steps; null for anything else. `inArchive` reads an archive's entry (`tablesOpen`). */
  mediaEnvelope?(path: string, buckets: number, inArchive?: ArchiveEntryRef): Promise<Envelope | null>;
  /**
   * Tauri shell only: runs the `[[command]]` of config.toml named `id`, its program and arguments read from
   * config.toml by the Rust side (an id it does not name is refused), the program started directly (no shell), `input` on
   * its stdin and `cwd` as its folder (null: the app's). Throws an Error whose `code` is a `CommandRunCode`.
   */
  runCommand?(id: string, input: Uint8Array, cwd: string | null): Promise<CommandRun>;
  /** Opens an http, https or mailto address in the system's browser or mail app, on the reader's press. */
  openExternal?(url: string): Promise<void>;
  /**
   * Fetches one image from the network through the shell, after the reader asked, and gives
   * a URL the page may draw it from; the webview itself never reaches the network.
   */
  fetchRemoteImage?(url: string): Promise<string>;
  /**
   * Text that is not UTF-8 (src-tauri/src/encoding): `bytes` already read, as UTF-8 text with the byte map back to them,
   * read as `chosen` or as their BOM or a guess says. Nothing is read from disk.
   */
  decodeText?(bytes: Uint8Array, chosen?: string | null): Promise<DecodedText>;
  /** `text` (UTF-8) as the bytes of `label`, its BOM first when `bom`; rejects with a plain sentence naming a character it cannot write. */
  encodeText?(text: Uint8Array, label: string, bom: boolean): Promise<Uint8Array>;
  /** Read with encoding...: each encoding's reading of the same few bytes of `bytes`, and what it cannot read. */
  encodingReadings?(bytes: Uint8Array): Promise<EncodingReadings>;
  /**
   * An Outlook message's bytes, already read, as the message it would be as it travels (src-tauri/src/outlook); rejects
   * with a sentence when they are not one or are damaged. The browser build answers for the demo's own.
   */
  mailFromMsg?(bytes: Uint8Array): Promise<OutlookMail>;
  /**
   * A Word 97-2003 document's or deck's bytes, already read, as the document the office page draws
   * (src-tauri/src/legacy_office); rejects with a sentence when they are not one, are locked or are damaged. The browser
   * build answers for the demo's own.
   */
  officeFromOle?(bytes: Uint8Array): Promise<LegacyOffice>;
};

/** What a command printed and how it ended: `status` is null when a signal ended it. */
export interface CommandRun {
  readonly status: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

/** Why a command gave nothing back: no such program, past the time limit, past the output cap, or the run itself. */
export type CommandRunCode = 'not-found' | 'timed-out' | 'too-large' | 'invalid' | 'io';

export type { OpenDocument };
/** The open document as the app holds it: what operations resolve and splice against. */
export interface OpenDocumentState {
  readonly path: string;
  readonly buffer: Buffer;
  readonly ast: Document;
  readonly nodeMap: NodeMap;
}

/**
 * What `AppHandle.dispatch` routes to the focused view's store or view. An `apply` names the
 * store version its range was resolved at (`baseVersion`, required), so the store's stale-edit check always runs.
 */
export type AppAction =
  | { readonly type: 'apply'; readonly range: Edit['range']; readonly replacement: string; readonly label: string; readonly baseVersion: number }
  | { readonly type: 'undo' | 'redo' | 'toggle-mode' }
  | { readonly type: 'save'; readonly as?: boolean };

/**
 * `AppHandle.open`'s options. `target: 'other'` opens in the other pane (made when there is one pane and
 * the window holds two columns); nothing opens when it cannot. Focus then moves to the opened pane
 * once its document is on screen, unless `focus` is `'stay'` (a link followed beside keeps the origin).
 */
export interface AppOpenOptions extends OpenOptions {
  readonly target?: 'here' | 'other';
  readonly focus?: 'move' | 'stay';
}

export type AppHandle = {
  readonly state: { document: OpenDocument | null };
  /**
   * A command's way to the store's transitions: `apply`, `undo` and `redo` reach the
   * focused view's store as the registry's commands do, `save` the explicit save, `toggle-mode` the view.
   */
  dispatch(action: AppAction): Promise<unknown>;
  commands(): readonly unknown[];
  readonly shell: AppShell;
  readonly ready: Promise<void>;
  /**
   * Opens `path` in the focused pane (`panes().openIn('focused', …)`), after any open already under way
   * there: launch, open events and the palette all end here. `at` is a byte offset; the block containing it is held at the
   * reading line until the reader scrolls. `at` for the document already on screen moves to it
   * without reading the file again. `onLanded` runs once `path` is the document on screen; over unsaved
   * edits the promise settles as soon as the reader is asked, and `onLanded` waits for their choice
   * (never on "Dismiss").
   */
  open(path: string, opts?: AppOpenOptions): Promise<void>;
  /** The focused pane's document, or null before the first one. */
  currentPath(): string | null;
  /** The folder every image and link of the document at `path` must stay inside: its repository root, else its folder. */
  imageRoot(path: string): string;
  /** Playwright harness: buffer fingerprint and reading position. */
  sourceHarness(): {
    readonly mode: 'rendered' | 'source';
    readonly bufferHash: string;
    readonly byteOffset: number;
  } | null;
  /** Playwright harness: live typesetters and resize observers, so N opens are seen to leave one of each. */
  debugCounts(): { typesetters: number; resizeObservers: number };
  /** The open document's buffer and parse, from its store's snapshot, or null. */
  openDocument(): OpenDocumentState | null;
  /** The open document's store, or null before the first document. */
  document(): DocumentStore | null;
  /**
   * The open document's explicit save (save.ts) with the deps only the app has: the fold from Source
   * and what follows a Save as. Resolves once the title shows the result.
   */
  save(opts?: { as?: boolean }): Promise<SaveResult>;
  /**
   * Shows `text` as a scratch document: it renders and edits like any document, is called "Untitled",
   * and no file exists until Save As. Resolves true when the open was not refused, false when it was; over unsaved edits it
   * resolves while the prompt stands, so `onLanded` is what says it is on screen. Opens in the other pane when two are shown.
   */
  openScratch(text: string, opts?: { readonly label?: string; readonly saveIn?: string; readonly onLanded?: () => void }): Promise<boolean>;
  /**
   * The first pane's document, as the selection is (`panes().onAnyDocumentChange` follows every pane): called with the document
   * on every committed transition and on each open, which moves the subscription to the new store, and
   * with null when the store closes. A page set again with the same bytes is not a change.
   */
  onDocumentChange(cb: (open: OpenDocumentState | null) => void): () => void;
  /** The Rendered selection on `#doc`: what is selected, and the open document as it resolves it. */
  readonly selection: RenderedSelection;
  /**
   * Applies an operation's result: makes `buffer` the open document and renders it through the same
   * path an open takes. The file is not written; that is an explicit save. Refused if a different
   * document is open by then, or while Source holds text not yet folded into the document.
   */
  commitEdit(buffer: Buffer): Promise<void>;
  /** Source text typed and not yet in the document goes into it, as one history entry (undo and redo call this first). */
  foldSource(): Promise<void>;
  /** True while Source holds typed text the document does not have yet (it would become an undo step). */
  hasUnfoldedSource(): boolean;
  /** Pin or unpin a document for palette history (same as Mod+. on a document row). */
  pinPaletteDocument(path: string): void;
  /**
   * The mounted palette's session (main.ts, once the palette is mounted): what a pin and the quit
   * flush of history.json read. Before it is called there is no palette session.
   */
  setPaletteSession(session: () => PaletteSession): void;
  /** The palette index: one walk per repository root, every root opened so far published. */
  readonly index: IndexService;
  /**
   * Resolves when the open document is wholly in the article: at once for a document under the
   * progressive threshold, after the last idle chunk for a larger one.
   */
  contentComplete(): Promise<void>;
  /** Mounts, now, every block up to the one holding `byteOffset` (a link to a heading not yet shown). */
  mountThrough(byteOffset: number): void;
  /** Rendered to Source or back, as `Mod+E` does; resolves when the switch is done. */
  toggleMode(): Promise<void>;
  /**
   * Source with the line holding `byteOffset` at the reading line (Jump to source). The same Source as
   * `Mod+E`: what is typed there is saved, guarded and undoable.
   */
  jumpToSource(byteOffset: number): Promise<void>;
  /** The focused pane's Source editor takes the keys, at the reading line (or the reader's own kept caret). */
  focusSource(): void;
  /**
   * Sets every pane's rendered page again after a change of variant or size, on the grid, with the reader
   * on the same line; not only the focused one's. Nothing to do in Source mode or with no document open.
   */
  relayout(): Promise<void>;
  /** The window's panes: one, or two side by side; every member above reads the focused one. */
  panes(): AppPanes;
  /** The rail, drawer, heads and panel around the panes, and the fold that leaves the page alone. */
  frame(): Frame;
  /** The theme config.toml names, started again now (a theme folder is followed while it is in force). */
  restartTheme(): Promise<void>;
  /**
   * Releases everything this instance started: its open store and watch, its view, its selection, its
   * persistence listeners and its user theme. `startApp` calls it on the instance it replaces in a page.
   */
  destroy(): void;
};
