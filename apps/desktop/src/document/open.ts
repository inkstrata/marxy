// The open path (lifted from app.ts): read a file, open its store, show it in the view, typeset,
// restore the stored place, run the deferred start-up and the user theme, watch it and title it; and
// `boot`, a launch's first open (or its frontispiece). The open store is a field of the object
// `createOpenPath` returns, never module state, so a second app instance in one page starts clean.
// Every edit, save and fold of the open document goes through its store here.
import { keepBeforeOverwrite } from '../versions/recorder.ts';
import { KIND_HEAD_BYTES, lastChunkedParse, parseMarkdownChunked, slicesWithin, type Buffer, type Document, type DetectResult, type KindRule, readsAsPage } from '@marxy/core';
import { detectFileKind, emptyKindsEnvelope, ruleReadFor, type KindsEnvelope } from '@marxy/core/src/kind/show-as.ts';
import { fileTypeFor, nameTypeOf, noteContent, noteSniffed, type ContentSignals } from '@marxy/core/src/kind/registry.ts';
import { setsPlainReading } from '@marxy/core/src/reading/index.ts';
import { LINES_READ_ONLY_FROM, linesTier } from '@marxy/core/src/reading/lines.ts';
import { parseConfig } from '@marxy/theme';
import { buildNodeMapInSlices } from '../render/post.ts';
import { parseInWorker, parseWorkerAvailable } from './parse-worker.ts';
import { dirname } from '@marxy/core/src/index-model/paths.ts';
import type { AppShell, OpenDocumentState } from '../app.ts';
import { confirmLeaveDocument } from '../close.ts';
import { setFrontispiece, showFrontispiece } from '../frontispiece/mount.ts';
import type { PieceSource } from '../frontispiece/pieces.ts';
import type { IndexService } from '../index/service.ts';
import { setPaneKind } from '../pane/dom.ts';
import { clearDismissForPath } from '../notices/blocked.ts';
import { clearNotices, notify, paneOf } from '../notices/index.ts';
import type { ReadingPersistence } from '../position/reading-persistence.ts';
import { save, type SaveDeps, type SaveResult } from '../save.ts';
import type { RenderedSelection } from '../selection/view.ts';
import { isWebPage, landingModeForPath, landsInRead } from '../source/default-mode.ts';
import { sourceChosen } from '../read-as/source-choice.ts';
import { whenIdle } from '../startup/idle-work.ts';
import { yieldToEventLoop } from '../startup/yield.ts';
import { t0, type LaunchMeasure, type RenderEvidence } from '../startup/measure.ts';
import { readKindsFile, type AppConfig } from '../theme/app-config.ts';
import { applyWeightOffset, platformOf } from '../theme/offset.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
// Static, as it was through save.ts: a lazy chunk here would put the first title (and the
// late trust read queued after it) behind a fetch.
import { updateTitle } from '../title.ts';
import type { TrustController } from '../trust/controller.ts';
import type { Landing, RenderedView } from '../view/rendered-view.ts';
import type { DocumentWatch } from './live-reload.ts';
import { bytesChosen } from '../read-as/bytes-choice.ts';
import type { PaneViewer, ViewerMemory, ViewerPlace } from '../viewers/types.ts';
import type { WatchEvent } from '@marxy/shell-api';
import { effectForOpenDocument } from '@marxy/core/src/position/watch-events.ts';
import { fileOnDiskNotice, fileRemovedNotice } from '../notices/disk.ts';
import { LARGE_OPEN_BYTES, paintThenGo, readingWords, WORKING } from '../render/working.ts';
import type { StoreRegistry } from './registry.ts';
import { encodedIo, lookForStore, textForStore } from './encoding.ts';
import { openDocumentStore, openUntitledStore, parserOfPath, type DocumentSnapshot, type DocumentStore, type Preparsed } from './store.ts';
import { readCertificates } from '@marxy/core/src/viewer/cert.ts';
import { guardSaveAsDialog } from './save-as-guard.ts';
import { documentName, isUntitled } from './untitled.ts';
import { editsOnlyInSource, entryGone, entryLine, entrySignals, heldEntry, isArchiveEntry, LINES_READ_ONLY_WORDS, readOnlyStore } from './entries.ts';

/**
 * How a document is opened (`AppHandle.open`, `PaneSet.openIn`, a pane's `open` and `replace`): `at` is a
 * byte held at the reading line; `onLanded` runs once the document is on screen in the pane it was opened
 * in, never when the open is refused or the reader dismisses the unsaved-edits prompt.
 * `onCommitted` (a pane's `open` only) runs once the open goes ahead, before anything is read or shown, and
 * on the same terms (never on a Dismiss): state that must not lag the page across its awaits, such as a link
 * history, is set there.
 * `scratch` is what a scratch path (`untitled.ts`) opens: the bytes the document was born with, and a label
 * for its window title, and `saveIn`, the folder its Save As opens in (*New file here*). A scratch path another pane
 * already shows needs none.
 */
export interface OpenOptions {
  readonly at?: number;
  readonly onLanded?: () => void;
  readonly onCommitted?: () => void;
  readonly scratch?: { readonly bytes: Uint8Array; readonly label?: string; readonly saveIn?: string };
}

/** The window's live reload: one watch per store, started by whichever pane shows it first. */
export interface StoreWatches {
  /** The store's watch; asking again for a store already watched starts nothing. */
  watch(store: DocumentStore): Promise<DocumentWatch>;
  /** The watch started for `store`, or null when none was. */
  of(store: DocumentStore): Promise<DocumentWatch> | null;
}

export interface OpenPathDeps {
  readonly shell: AppShell;
  /** The view every open shows its store in: one pane's. */
  readonly view: RenderedView;
  /**
   * The stores open in the window, one per path: a document another pane already shows is shown
   * through its store rather than read and parsed again. Without it, each open makes its own store.
   */
  readonly stores?: StoreRegistry;
  /** The window's watches: a store is watched once, however many panes show it, and follows its own path. */
  readonly watches: StoreWatches;
  /** Every view in the window that shows `store`, left to right, this one included. */
  viewsOver(store: DocumentStore): readonly RenderedView[];
  readonly persistence: ReadingPersistence;
  readonly index: IndexService;
  readonly trust: TrustController;
  readonly measure: LaunchMeasure;
  readonly config: AppConfig;
  selection(): RenderedSelection | null;
  /** The pieces a launch with no document chooses from; null is the bundled Commonplace. */
  readonly pieces: readonly PieceSource[] | null;
  /**
   * A Save As moved `store` onto a path another pane shows through a second store: that pane
   * lets its store go and shows `store`, so the path has one store and one watch.
   */
  rejoin?(store: DocumentStore): Promise<void>;
  /**
   * True while another pane is on screen: a large document is then read in slices with the event loop
   * given back between them, so the other pane keeps painting and scrolling. Unset, or false for a window's
   * only pane, which has nothing else to keep alive and reads at once, the fastest road to first text.
   */
  sliced?(): boolean;
  /** This open path's document titles the window (the focused pane's); unset, it always does. */
  ownsTitle?(): boolean;
}

export interface OpenPath {
  /** The launch: the document `argv` names (the shell's arguments when it names none), else the frontispiece. */
  boot(argv: readonly string[]): Promise<void>;
  /** `AppHandle.open`: after any open under way, and asking first over unsaved edits. */
  open(path: string, opts?: OpenOptions): Promise<void>;
  /** `open` without asking: the caller already has (closing the left pane). */
  replace(path: string, opts?: OpenOptions): Promise<void>;
  /**
   * `replace` for a caller already on this view's queue, so it does not queue (a watch following a rename
   * on disk): `at` is the byte held at the reading line.
   */
  follow(path: string, at: number): Promise<void>;
  /** Show this pane's path again through the store the registry now holds for it, at the place it was. */
  rejoin(): Promise<void>;
  currentPath(): string | null;
  /** What a scratch document was opened as ("a.md against b.md"), for its tab; undefined for a file or an unnamed scratch. */
  scratchLabel(): string | undefined;
  /** The open document's store, or null (a file shown by a viewer has none). */
  store(): DocumentStore | null;
  /** The page of the app's own the pane shows (an image, the file card), or null for the text views. */
  viewer(): PaneViewer | null;
  /**
   * What the open document was decided to be when it opened: the kind and every reason that fired.
   * Decided once per open and kept through live reloads; null when nothing is open. The kind chip reads it here.
   */
  detected(): DetectResult | null;
  openDocument(): OpenDocumentState | null;
  onDocumentChange(cb: (open: OpenDocumentState | null) => void): () => void;
  /** The store's buffer differs from disk, or Source holds text not yet folded into it. */
  hasUnsavedChanges(): boolean;
  commitEdit(next: Buffer): Promise<void>;
  /** Source text into the store (`commitSource`), before a save or a rename reads the buffer. */
  foldSource(): Promise<void>;
  save(opts?: { as?: boolean }): Promise<SaveResult>;
  refreshTitle(): Promise<void>;
  /** The open store closes (and its watch with it), and nothing opens after this. */
  close(): void;
}

function documentState(snap: DocumentSnapshot): OpenDocumentState {
  // Read through the snapshot: a document that opened in Source has no parse until something asks for one.
  return {
    path: snap.path,
    buffer: snap.buffer,
    get ast() {
      return snap.ast;
    },
    get nodeMap() {
      return snap.nodeMap;
    },
  };
}

/**
 * The one range by which `next` differs from `bytes`, widened so neither end cuts a UTF-8 sequence;
 * null when they are the same bytes.
 */
function byteChange(bytes: Uint8Array, next: Uint8Array): { start: number; end: number; replacement: Uint8Array } | null {
  const limit = Math.min(bytes.length, next.length);
  let prefix = 0;
  while (prefix < limit && bytes[prefix] === next[prefix]) prefix++;
  if (prefix === bytes.length && prefix === next.length) return null;
  let suffix = 0;
  while (suffix < limit - prefix && bytes[bytes.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const continues = (b: number | undefined): boolean => b !== undefined && (b & 0xc0) === 0x80;
  while (prefix > 0 && (continues(bytes[prefix]) || continues(next[prefix]))) prefix--;
  while (suffix > 0 && (continues(bytes[bytes.length - suffix]) || continues(next[next.length - suffix]))) suffix--;
  return { start: prefix, end: bytes.length - suffix, replacement: next.subarray(prefix, next.length - suffix) };
}

/** A document of at least this many bytes is read in slices while another pane is on screen; below it the work is a frame or less. */
const SLICED_BYTES = 64 * 1024;
/** The longest stretch of a text that is parsed behind its page without a place to cut it. */
const UNCUT_SLICE_BYTES = 256 * 1024;
/**
 * A document of at least this many bytes is read in slices even alone on screen. Its bytes say little of what its page
 * costs: a megabyte of short blocks (lists, quotes, tables) is half a million elements, and made whole it held the window
 * for seconds before its first text.
 */
const SLICED_ALONE_BYTES = 256 * 1024;

/**
 * The file's size and times when its store was kept warm. A return compares them with the file's now: a change whose
 * watch event has not arrived yet (the safety poll runs every two seconds, and is all a network or synced folder may
 * get) is read on return, not shown stale until the event.
 */
const keptStat = new WeakMap<DocumentStore, Promise<{ size: number; mtimeMs: number; createdMs?: number } | null>>();

/** What the reader decided about kinds, read as a file opens: the `[[kind]]` rules and `kinds.json`. */
interface KindInputs {
  readonly rules: readonly KindRule[];
  readonly choices: KindsEnvelope;
}

/** Released once: a promise for a mount's `start`, and the call that settles it. */
function gate(): { readonly promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

export function createOpenPath(deps: OpenPathDeps): OpenPath {
  const { shell, view, persistence, index, trust, measure, config } = deps;
  const doc = view.host.article;
  /**
   * The open document: its path, its bytes and the bytes on disk, its parse and its history.
   * Every change to them is one of the store's transitions, and the page follows them through the
   * view's subscription.
   */
  let current: DocumentStore | null = null;
  /** A file shown by a viewer with no store: its path, while it is the pane's. */
  let viewing: string | null = null;
  /** The watch on the folder of the file a viewer shows: a page with no store has no store's watch. */
  let viewerWatch: { close(): void } | null = null;
  /** Where the reader was in a viewer whose file was renamed on disk, for the page opened at its new name. */
  let carriedPlace: ViewerPlace | undefined;
  let closed = false;
  /** What the open scratch document is called in the window title, if it was given a name. */
  let scratchLabel: string | undefined;
  /** The folder the open scratch document's Save As opens in, if it was made for one. */
  let scratchSaveIn: string | undefined;
  /** `onDocumentChange` subscribers: each moves its subscription to a newly opened store, or to none for a viewer. */
  const followers = new Set<(next: DocumentStore | null) => void>();
  /** The byte the open in progress lands on (an `at`, or the stored place), read before anything re-notes it. */
  let landing: number | undefined;
  /** The open in progress was read in slices: its later stages give the frame back too. */
  let openedInSlices = false;
  /** The launch document's walk, so `ready` (and a harness quit) follows its `index_loaded` mark. */
  let indexing: Promise<void> = Promise.resolve();

  /** The open document's kind and reasons, decided in `readAndShow` and not again until it is opened again. */
  let detected: DetectResult | null = null;
  /** The matching `[[kind]]` rule's `read` for the file being opened, decided with its kind. */
  let ruleRead: boolean | undefined;
  /** Whether the open document opened in Source: its rule's `read`, else its kind's default mode (`modeOfOpen`). */
  let openedInSource = false;
  /** The launch's kind when kinds.json was still being read as the page was first written: settled once it is decided again. */
  let launchRedecide: Promise<void> | null = null;

  /**
   * The reader's `[[kind]]` rules (config.toml) and *show as* choices (kinds.json), for the file about to open.
   * Either missing, unreadable or unparsable is as if empty: the file opens by detection alone and the reader's
   * other files are not held up. Never rejects.
   */
  async function readKindInputs(): Promise<KindInputs> {
    const none: KindInputs = { rules: [], choices: emptyKindsEnvelope() };
    if (!shell.configPaths) return none;
    try {
      const { config: configPath, data } = await shell.configPaths();
      const [rules, choices] = await Promise.all([
        configPath === ''
          ? []
          : shell.readFile(configPath).then(
              (bytes) => parseConfig(bytes, { home: inferHomeFromConfig(configPath) }).config.kindRules,
              () => [],
            ),
        readKindsFile(shell, data),
      ]);
      return { rules, choices };
    } catch {
      return none;
    }
  }

  /** Detects what `file` is from its first bytes and the reader's rules and choices, and puts it on the pane's root. */
  function detectFor(file: string, bytes: Uint8Array, inputs: KindInputs): DetectResult {
    // A scratch document is Markdown until it is named, so it is detected as the Markdown file it will be.
    return detectFileKind({ path: isUntitled(file) ? 'untitled.md' : file, head: bytes.subarray(0, KIND_HEAD_BYTES), rules: inputs.rules, choices: inputs.choices });
  }

  /** The kind on the pane now, as the rendered view reads it for `readingOf`. */
  const paneKindNow = (): string | null => doc.closest('[data-marxy-kind]')?.getAttribute('data-marxy-kind') ?? null;

  function applyKind(file: string, bytes: Uint8Array, inputs: KindInputs): DetectResult {
    const result = detectFor(file, bytes, inputs);
    detected = result;
    ruleRead = isUntitled(file) ? undefined : ruleReadFor(file, inputs.rules);
    setPaneKind(doc.closest('section.marxy-pane'), result.kind);
    return result;
  }

  /**
   * Whether `file` opens in Source: the matching rule's `read` (`true` opens Read, `false` Source), else
   * the landing mode of its type. A `.jsonl` opens in Source unless a rule says Read: its Read is the
   * derived transcript view when its kind is `transcript`. Code that lands in Read opens in Source again when the reader
   * put it there (`keptInSource`). A *show as* kind lands where that kind lands: Read, drawn as that kind.
   */
  function modeOfOpen(file: string, size: number): boolean {
    if (ruleRead === true) return false;
    if (ruleRead === false) return true;
    // Plain text found or chosen to be a log, a session or a patch opens on that kind's page, as a `.log` does.
    if (detected !== null && readsAsPage(file, detected.kind)) return false;
    if (keptInSource(file)) return true;
    return landingModeForPath(file, size) === 'source';
  }

  /** A certificate-named file whose bytes hold a private key: it always opens in Read, never remembered into Source. */
  function holdsKey(file: string, bytes: Uint8Array): boolean {
    if (fileTypeFor(file).id !== 'certificate') return false;
    const read = readCertificates(bytes);
    return read.ok && read.file.holdsKey;
  }

  /** Code the reader switched to Source (readings.json `source`), with no rule or log-like kind saying Read. */
  function keptInSource(file: string): boolean {
    if (ruleRead !== undefined || (detected !== null && readsAsPage(file, detected.kind))) return false;
    return landsInRead(file) && sourceChosen(file);
  }

  /**
   * Decides what `file` is, from its first bytes: the reader's *show as* beats a rule and a rule beats detection
   * (`detectFileKind`), and the pane's root is given the result.
   */
  async function decideKind(file: string, bytes: Uint8Array, inputs: Promise<KindInputs> = readKindInputs()): Promise<void> {
    applyKind(file, bytes, await inputs);
  }

  /**
   * The launch document's kind, decided before its first paint from what the pre-paint config read already
   * holds: the rules from its bytes, and kinds.json if that read, started beside the document's own, has finished.
   * A kinds.json still being read is not waited for: the kind is decided without it, and the
   * returned promise redecides once it arrives, unless the answer is the same or another document has opened.
   */
  function decideLaunchKind(file: string, bytes: Uint8Array): Promise<void> | null {
    const known = config.launchKindInputs();
    const first = applyKind(file, bytes, { rules: known.rules, choices: known.choices ?? emptyKindsEnvelope() });
    // applyKind read the rule's `read` from the same rules: the launch document's mode is decided with its kind.
    if (known.choices !== null) return null;
    return known.later.then((choices) => {
      if (detected !== first || closed) return;
      const next = detectFileKind({ path: file, head: bytes.subarray(0, KIND_HEAD_BYTES), rules: known.rules, choices });
      if (next.kind === first.kind) return;
      detected = next;
      setPaneKind(doc.closest('section.marxy-pane'), next.kind);
    });
  }

  const serially = <T>(fn: () => Promise<T>): Promise<T> => view.serially(fn);
  const ownsTitle = (): boolean => deps.ownsTitle?.() ?? true;
  const currentPath = (): string | null => current?.snapshot().path ?? viewing;

  const { watches } = deps;
  /** Every view in the window over `store`; this view alone for a store no pane shows yet. */
  const viewsOf = (store: DocumentStore): readonly RenderedView[] => {
    const over = deps.viewsOver(store);
    return over.includes(view) ? over : [view, ...over];
  };
  /** Source text typed, in any pane that shows the open document, and not yet folded into its store. */
  const unfoldedAnywhere = (store: DocumentStore): boolean => viewsOf(store).some((v) => v.sourceHasUnfoldedEdits());

  async function refreshTitle(): Promise<void> {
    if (!shell.setTitle || !ownsTitle()) return;
    const snap = current?.snapshot();
    // The document is unsaved when its store is, or when any pane that shows it holds Source text the
    // store does not: the focused pane is not the only one that can.
    await updateTitle(shell, snap?.path ?? viewing, (snap?.dirty ?? false) || (current !== null && unfoldedAnywhere(current)), scratchLabel);
  }

  /** Source text typed in any pane that shows the open document goes into its store. */
  async function foldSource(): Promise<void> {
    const open = current;
    if (!open) return;
    let folded = false;
    for (const v of viewsOf(open)) if (await v.foldSource()) folded = true;
    if (folded) await refreshTitle();
  }

  function hasUnsavedChanges(): boolean {
    if (!current) return false;
    return current.snapshot().dirty || unfoldedAnywhere(current);
  }

  /**
   * Everything one open document started: the view's page (its typesetter, resize observer, pending grid
   * pass and Source editor), the watch and the store. Run before the next document replaces it.
   */
  function teardownDocument(keepSourceShowing = false, keep = false): void {
    view.clear(keepSourceShowing);
    viewing = null;
    viewerWatch?.close();
    viewerWatch = null;
    // The store goes with its page: a transition still queued on it is refused, not applied elsewhere.
    // Its watch closes with it (document/live-reload.ts). One another pane still shows stays open, and
    // only this open path's watch on it closes.
    if (current) release(current, keep);
    current = null;
  }

  /**
   * This open path lets `store` go. The last holder closes it, and its watch with it; a store another pane
   * still shows stays open, and so does its watch: it reloads that pane's page too. `keep`: the reader only
   * moved to another tab, so the registry may leave the store warm (clean, with its history) for the way back.
   */
  function release(store: DocumentStore, keep = false): void {
    if (!deps.stores) return store.close();
    // The store's watch is the window's: it closes with the store, when its last view lets go.
    deps.stores.release(store, { keep });
    if (keep && deps.stores.warm().includes(store)) keptStat.set(store, statOf(store.snapshot().path));
  }

  /** The file's size and times, or null. A shell without `stat` (a stand-in) gives null, and a return then reads the file. */
  const statOf = (path: string): Promise<{ size: number; mtimeMs: number; createdMs?: number } | null> =>
    Promise.resolve()
      .then(() => shell.stat(path))
      .catch(() => null);

  /** Whether `file` may differ from what its warm store holds: its size or times moved since the store was kept, or are unknown. */
  async function movedOnDisk(store: DocumentStore, file: string): Promise<boolean> {
    const before = await keptStat.get(store);
    keptStat.delete(store);
    const now = before ? await statOf(file) : null;
    return !before || !now || now.size !== before.size || now.mtimeMs !== before.mtimeMs || now.createdMs !== before.createdMs;
  }

  /** Whether the document this open replaces may be kept warm: not when its file was renamed on disk, which is not a tab left. */
  let keepLeaving = true;

  /** The warm store this open took from the registry and has not yet made the pane's own: let go again if the open fails. */
  let claimedOpen: DocumentStore | null = null;

  /**
   * A warm store's file is read now and handed to the store's own reload, as a watch event would: unchanged bytes change
   * nothing, others re-parse only what they touch. A file gone or unreadable discards the store and fails the open, as a
   * cold open of it would.
   */
  async function revalidate(store: DocumentStore, file: string): Promise<void> {
    try {
      const readAt = store.writes();
      const raw = await (shell.peekFile ? shell.peekFile(file) : shell.readFile(file));
      await store.reload(await lookForStore(shell, file, raw), { readAt });
    } catch (e) {
      claimedOpen = null;
      deps.stores?.discard(store);
      throw e;
    }
  }

  /** The store's save, with what only the app can do around it (save.ts). */
  function saveDeps(open: DocumentStore): SaveDeps {
    return {
      store: open,
      shell: Object.assign(Object.create(shell), {
        saveDialog: guardSaveAsDialog({
          shell,
          open,
          stores: deps.stores,
          hasUnfoldedEdits: (other) => deps.viewsOver(other).some((v) => v.sourceHasUnfoldedEdits()),
          pane: paneOf(doc),
        }),
      }) as AppShell,
      foldSource: async () => {
        if (current === open) await foldSource();
      },
      // Held apart only: a key typed after the fold, while the title refreshed, is this pane's own and stays
      // in its editor for the next save, which is no reason to refuse this one.
      holdsUnfoldedSource: () => current === open && viewsOf(open).some((v) => v.sourceHeldApart()),
      pane: paneOf(doc),
      saveIn: () => scratchSaveIn,
      onSaveAs: async (path, from) => {
        if (current !== open) return;
        await shell.allowAssetScope(dirname(path));
        // The watch moved with the store when it took the new path (document/live-reload.ts). The save
        // resolves once the new folder's watch is registered, so a write right after it is seen. A scratch
        // document had no watch: it is now a file, so it gets one, and its place in the folder's index.
        if (isUntitled(from)) {
          scratchLabel = undefined;
          scratchSaveIn = undefined;
          await (await watches.watch(open)).moved();
          if (ownsTitle()) document.title = `${documentName(path)} — Marxy`;
          persistence.trackOpen(path, () => index.rootFor(path));
          void index.ensureFor(path, open.snapshot().buffer.bytes);
        } else {
          await (await watches.of(open))?.moved();
        }
        // Another pane showing the path through its own (clean) store now shows this one.
        await deps.rejoin?.(open);
        deps.selection()?.afterRender();
      },
    };
  }

  /** After `first_text`, positions.json may ask to move the document already on screen. */
  async function restorePersistedPosition(): Promise<void> {
    if (!current || !view.document() || view.viewer()?.bytesHidden) return;
    const { path, buffer } = current.snapshot();
    const stored = persistence.storedFor(path, buffer.bytes.length, buffer.bytes);
    // Code the reader put in Source opens there again: the launch's document too, decided before readings.json was in.
    if (!openedInSource && keptInSource(path) && view.mode === 'rendered') {
      openedInSource = true;
      landing = stored?.byteOffset ?? 0;
      await view.showSource(landing);
      return;
    }
    if (!stored) return;
    landing = stored.byteOffset;
    // A file that opens in Source is already in Source; its stored place is a byte in it, not a block of a page.
    if (openedInSource) {
      if (view.mode === 'source') await view.showSource(stored.byteOffset);
      return;
    }
    // A place kept in Source is a line, not a fraction of a block: its block, at the top. A place kept
    // in Rendered is held where the reader left the line in its block, through the passes that set the page.
    view.landOn(stored.mode === 'source' ? stored.byteOffset : stored);
  }

  /**
   * Read and render `file` through the `render` mark; cold-start paint runs after this.
   * A large document's idle chunks wait for `start`, so nothing is appended before first text.
   */
  async function readAndShow(
    file: string,
    at: number | undefined,
    start: Promise<unknown>,
    scratch?: OpenOptions['scratch'],
    kind: 'now' | 'keep' | 'launch' = 'now',
  ): Promise<RenderEvidence> {
    // A file that opens in Source loads Source's code while the file is read, not after it.
    // A `[[kind]]` rule's `read` is known once the kind is decided, below; Source's code is warmed on the type's default.
    if (landingModeForPath(file) === 'source') view.warmSource(file);
    // The reader's rules and choices are read beside the file, not after it.
    const kindInputs = kind === 'now' ? readKindInputs() : null;
    // config.toml is read beside the document, not after it (at launch, kinds.json starts with it).
    const applying = config.applyOnce(document.documentElement, { kinds: kind === 'launch' });
    const untitled = isUntitled(file);
    // A store kept warm from the last time this pane left the file: held from here, so nothing evicts it while the open runs.
    const claimed = deps.stores && !untitled && !isArchiveEntry(file) && file !== currentPath() && !bytesChosen(file) ? deps.stores.claim(file) : null;
    claimedOpen = claimed;
    // Shown in another pane (or kept warm): its store is the document, unsaved edits and all, and is not read again.
    const shown = claimed ?? deps.stores?.held(file) ?? null;
    // Every open passes here (launch, a link, history, the restored layout, a drop): the shell reads only what the
    // reader opened, so it is told before the first read. A refusal is the read's to report.
    if (!untitled && !isArchiveEntry(file)) await shell.markOpened?.(file).catch(() => undefined);
    // Read as › Bytes: the floor's card and the bytes, never read whole, whatever another pane holds.
    if (!untitled && !isArchiveEntry(file) && bytesChosen(file)) {
      await applying;
      return showViewerFor(file, null, at);
    }
    let bytes: Uint8Array;
    if (shown && shown !== current) {
      if (claimed) {
        // Both asked: the mark is taken either way, and the kept stat let go.
        const marked = deps.stores!.takeUnseen(claimed);
        if ((await movedOnDisk(claimed, file)) || marked) await revalidate(claimed, file);
      }
      bytes = shown.snapshot().buffer.bytes;
    }
    // A scratch document is not on disk: its bytes are the ones it was handed, and nothing is read.
    else if (untitled) {
      if (!scratch) throw new Error('That new document is no longer open.');
      bytes = scratch.bytes;
    } else if (isArchiveEntry(file)) {
      // An archive's entry: its bytes are held in memory, read from the archive when the reader asked; the disk
      // is never asked for this path, and its kind is read from its name and its head as a file's would be.
      const entry = heldEntry(file);
      if (!entry) throw new Error(entryGone(file));
      noteContent(file, entrySignals(file));
      if (fileTypeFor(file).kind === 'binary') {
        await applying;
        return showViewerFor(file, null, at);
      }
      bytes = entry.bytes;
      noteSniffed(file, bytes);
    } else {
      // What the head says the file is is read beside the file, not after it, and corrects its name before the kind,
      // the mode and the parse are decided. Without the shell's detection, or when it fails, the name alone decides.
      const detecting = shell.detectFiles?.([file]).then((found) => found[0] ?? null, () => null);
      // A name that says binary, or says nothing, waits for the head first: bytes that are not text are never read whole
      // (a 2 GB file opens at once), and open as a page of the app's own. A certificate is PEM text or DER bytes: its head says which.
      const named = nameTypeOf(file);
      let signals: ContentSignals | null = null;
      if (detecting && (named === undefined || named.kind === 'binary' || named.id === 'certificate')) {
        signals = await detecting;
        noteContent(file, signals);
        if (fileTypeFor(file).kind === 'binary') {
          await applying;
          return showViewerFor(file, signals, at);
        }
        bytes = await shell.readFile(file);
      } else if (!detecting && named?.kind === 'binary') {
        await applying;
        return showViewerFor(file, null, at);
      } else {
        bytes = await shell.readFile(file);
        if (detecting) noteContent(file, (signals = await detecting));
      }
      // Text that is not UTF-8 is read as its BOM, a guess or the reader's choice says: the store holds it as UTF-8.
      bytes = await textForStore(shell, file, bytes, signals);
      // A name no row knows is read from its text when that is plainly XML or JSON.
      noteSniffed(file, bytes);
    }
    await applying;
    let lands: Landing | undefined = at;
    if (lands === undefined && !untitled) {
      const stored = persistence.storedFor(file, bytes.length, bytes);
      // As `restorePersistedPosition` lands it: a Source place is its line's block, a Rendered one keeps its fraction.
      if (stored) lands = stored.mode === 'source' ? stored.byteOffset : stored;
    }
    landing = typeof lands === 'number' ? lands : lands?.byteOffset;
    // A large file says so in the head while its page is made, and that is given the frame back between its slices so the
    // words paint and the window answers. Any document past SLICED_ALONE_BYTES is parsed, rendered and put in the page in
    // slices, and past SLICED_BYTES when another pane is on screen, before this pane's page is touched.
    const large = bytes.length >= LARGE_OPEN_BYTES;
    // From SLICED_ALONE_BYTES the open is read in slices, behind the last page: the head says so from there.
    if (large || bytes.length >= SLICED_ALONE_BYTES) {
      paneHostOf().setAttribute(WORKING, readingWords(bytes.length));
      await paintThenGo();
    }
    const slices = bytes.length >= SLICED_BYTES && (bytes.length >= SLICED_ALONE_BYTES || deps.sliced?.() === true);
    openedInSlices = slices;
    let preparsed: Preparsed | undefined;
    let parsedAs = '';
    // Plain prose, verse or a file as written never reads the Markdown parse in Read: the store makes it when
    // something asks (Source, the outline, a transform). One decode per kind asked about.
    const plainAsked = new Map<string | null, boolean>();
    const plainRead = (asKind: string | null): boolean => {
      if (untitled) return false;
      if (!plainAsked.has(asKind)) plainAsked.set(asKind, setsPlainReading(file, bytes, asKind));
      return plainAsked.get(asKind)!;
    };
    // The kind this open is about to put on the pane, worked out before it does.
    const kindAhead = async (): Promise<string | null> => {
      if (kindInputs) return detectFor(file, bytes, await kindInputs).kind;
      if (kind === 'launch') {
        const known = config.launchKindInputs();
        return detectFor(file, bytes, { rules: known.rules, choices: known.choices ?? emptyKindsEnvelope() }).kind;
      }
      return paneKindNow();
    };
    // A file that opens in Source is not parsed here at all: its store parses when the AST is first read.
    // Only what the registry parses as Markdown is parsed in slices here: a `.jsonl` is the derived view in Read.
    // A store another pane holds is parsed only when it never was: Markdown read as lines and then asked to be shown
    // rendered (Show rendered) is parsed here in slices and handed to it, as its page would otherwise parse it whole.
    // This pane's own store, held by no other, closes with this open: the file is parsed for the store made in its place.
    const heldNow = deps.stores?.held(file) ?? null;
    const holding = heldNow && !(heldNow === current && (deps.stores?.views(heldNow) ?? 0) <= 1) ? heldNow : null;
    if (
      slices &&
      landingModeForPath(file, bytes.length) !== 'source' &&
      parserOfPath(file) === 'markdown' &&
      (!holding || !holding.parsed()) &&
      !(await kindAhead().then((ahead) => plainRead(ahead) || readsAsPage(file, ahead)))
    ) {
      const parsing = holding ? holding.snapshot().buffer.bytes : bytes;
      const large0 = await parseLarge(parsing, file, () => closed);
      const ast = large0.ast;
      parsedAs = large0.as;
      const made = { ast, nodeMap: await buildNodeMapInSlices(ast, yieldToEventLoop, undefined, () => closed) };
      if (closed) throw new Error('closed while the document was read');
      if (!holding) preparsed = made;
      else if (!holding.parsed()) holding.takeParse(parsing, made);
    }
    // Source, if it shows, stays on screen with the old text until the next document's page replaces it.
    teardownDocument(true, keepLeaving && file !== currentPath());
    // The kind is decided here, once per open, from the file's own first bytes (`decideKind`), before the page is
    // touched. A reload of this document never comes back through here; only an open does. `rejoin` shows the same
    // document again and keeps its kind. The launch's document is decided from the reads the pre-paint config
    // read already made, without waiting for any that is still out (`decideLaunchKind`).
    if (kindInputs) await decideKind(file, bytes, kindInputs);
    else if (kind === 'launch') launchRedecide = decideLaunchKind(file, bytes);
    const opensInSource = modeOfOpen(file, bytes.length) && !holdsKey(file, bytes);
    openedInSource = opensInSource;
    // A JSONL session in Read is the derived view: no Markdown parse is made for it unless something asks for one.
    const derivedRead = !opensInSource && /\.jsonl$/i.test(file) && detected?.kind === 'transcript';
    scratchLabel = untitled ? scratch?.label : undefined;
    scratchSaveIn = untitled ? scratch?.saveIn : undefined;
    clearDismissForPath(file);
    await shell.mark('file_read', Date.now(), `bytes=${bytes.length}`);
    // The open transition: the store copies the bytes, parses them once and starts an empty
    // history with `disk` as read. The page renders from its snapshot and follows it from here on.
    let parsedHere = false;
    // A kind the reader chose (Show as, a rule) may ask for plain text to be read as Markdown; plain text found or chosen to
    // be a log, a session or a patch is parsed as that kind's code.
    const chosen = detected !== null && (detected.reasons.find((r) => r.decisive)?.tier === 1 || readsAsPage(file, detected.kind)) ? detected.kind : undefined;
    const plainLazy = !opensInSource && !derivedRead && plainRead(paneKindNow());
    // Decided once, from the kind just put on the pane: the page reads the same attribute when it asks for its reading.
    const asLines = !untitled && linesTier(file, bytes, paneKindNow()) !== null;
    const make = (): DocumentStore => {
      parsedHere = true;
      const io = encodedIo({
        writeFileAtomic: (path: string, written: Uint8Array, expected?: Uint8Array) => shell.writeFileAtomic(path, written, expected),
        recordRead: shell.recordRead ? (path: string, read: Uint8Array) => shell.recordRead?.(path, read) : undefined,
        peekFile: shell.peekFile ? (path: string) => shell.peekFile!(path) : undefined,
        beforeOverwrite: (path: string, replacing: Uint8Array) => keepBeforeOverwrite(path, replacing),
        writeFileNew: (path: string, written: Uint8Array) => shell.writeFileNew(path, written),
      }, shell, file);
      if (untitled) return openUntitledStore(io, file, bytes);
      const made = openDocumentStore(io, file, bytes, preparsed, { lazy: opensInSource || derivedRead || plainLazy, chosen });
      if (isArchiveEntry(file)) return readOnlyStore(made, (text) => notify({ kind: 'refused', text }, { pane: paneOf(doc) }));
      return asLines && bytes.length >= LINES_READ_ONLY_FROM ? editsOnlyInSource(made, () => notify({ kind: 'refused', text: LINES_READ_ONLY_WORDS, transient: true }, { pane: paneOf(doc) })) : made;
    };
    const opened = claimed ?? (deps.stores ? deps.stores.acquire(file, make) : make());
    // A store another pane holds was parsed under the choice it was opened with: Show as is the file's, so it follows.
    if (!parsedHere && !untitled) await opened.rechoose(chosen);
    current = opened;
    claimedOpen = null;
    // A change heard since the claim (no view could show it) is read before the page is made from the store.
    if (claimed) while (deps.stores!.takeUnseen(claimed)) await revalidate(claimed, file);
    if (slices) await yieldToEventLoop();
    // One parse for a file however many panes show it: a pane that shares the store makes none.
    if (parsedHere) await shell.mark('parsed', Date.now(), preparsed ? parsedAs : undefined);
    // A different document starts with no notices in this pane; another pane's are its own.
    clearNotices(paneOf(doc));
    // A text file whose Read is a page of the app's own (an SVG's image page, a message, an RTF document, a web page): its viewer, over the
    // store's own bytes. A web page shown as a kind is drawn as that kind; one whose HTML the reader trusted has it drawn in
    // the page itself, sanitised, which is what the grant allows.
    const webPage = !untitled && isWebPage(file) && detected?.reasons.find((r) => r.decisive)?.tier !== 1 && !(await trust.load().then(() => trust.grantsFor(file).html));
    const textViewer =
      !untitled && (fileTypeFor(file).viewer === 'image' || fileTypeFor(file).viewer === 'mail' || (fileTypeFor(file).viewer === 'office' && /\.rtf$/i.test(file)) || fileTypeFor(file).id === 'certificate' || webPage)
        ? await (await import('../viewers/index.ts')).createViewer({ shell, path: file, signals: null, paneHost: paneHostOf(), text: () => opened.snapshot().buffer.bytes })
        : undefined;
    if (current !== opened) {
      textViewer?.destroy();
      throw new Error('the document was replaced while its page was made');
    }
    // The view renders from the store's snapshot and follows it from here on.
    const evidence = await view.show(opened, {
      at: lands,
      start,
      sliced: slices,
      source: opensInSource,
      viewer: textViewer,
      onMounted: () => {
        const tell = (): void => {
          for (const follow of [...followers]) follow(opened);
        };
        // The panel's cards read the whole of a large page: they are drawn after its first screens have painted.
        if (large)
          void paintThenGo().then(() => {
            if (!closed && current === opened) tell();
          });
        else tell();
      },
    });
    if (ownsTitle()) document.title = `${untitled ? documentName(file) : file.split('/').pop()} — Marxy`;
    // A file read as lines is never parsed behind its page: the parse of a file that size is what the lines spare.
    if (parsedHere && plainLazy && bytes.length >= SLICED_BYTES && parserOfPath(file, chosen) === 'markdown' && !asLines) void parseBehind(opened, file);
    return evidence;
  }

  /**
   * The Markdown parse a plain reading left for later, made in slices once its page is complete and handed to its store,
   * so the first thing that needs it (a click's selection, Source, the outline) finds it made instead of making it whole.
   */
  async function parseBehind(store: DocumentStore, file: string): Promise<void> {
    const bytes = store.snapshot().buffer.bytes;
    const stale = (): boolean => closed || current !== store || store.parsed() || store.snapshot().buffer.bytes !== bytes;
    // Where no worker can make it, a text the slices cannot cut (no blank line: one paragraph, a long task of its own)
    // is not parsed behind its page: the store makes the parse if something asks for it.
    const uncut = (): boolean => !slicesWithin(bytes, UNCUT_SLICE_BYTES);
    if (!parseWorkerAvailable() && uncut()) return;
    try {
      // After the page's own idle mount, which the slices would otherwise starve.
      await view.contentComplete();
      if (stale()) return;
      const inWorker = await parseInWorker(bytes, file, stale);
      if (inWorker === 'none' && uncut()) return;
      const ast = inWorker !== 'none' ? inWorker : await parseMarkdownChunked(bytes, { file, yieldNow: yieldToEventLoop, aborted: stale });
      const nodeMap = await buildNodeMapInSlices(ast, yieldToEventLoop, undefined, stale);
      if (!stale()) store.takeParse(bytes, { ast, nodeMap });
    } catch (error) {
      if (!stale()) console.warn('marxy: the parse behind a plain reading failed', error);
    }
  }

  /**
   * The parse of a large Markdown document for its page: in a worker, so this thread only receives it, or where no worker
   * can start, in slices here as before. `as` is what the `parsed` mark says of it: `worker`, or `slices=<n>`.
   */
  async function parseLarge(bytes: Uint8Array, file: string, aborted: () => boolean): Promise<{ ast: Document; as: string }> {
    const inWorker = await parseInWorker(bytes, file, aborted);
    if (inWorker !== 'none') return { ast: inWorker, as: 'worker' };
    const ast = await parseMarkdownChunked(bytes, { file, yieldNow: yieldToEventLoop, aborted });
    const stats = lastChunkedParse();
    return { ast, as: `slices=${stats.kind === 'slices' ? stats.slices : 0}` };
  }

  /** An archive's entry says what it is while its tab is open: an entry, in memory, not on disk, not editable. */
  function sayEntry(file: string): void {
    const entry = isArchiveEntry(file) ? heldEntry(file) : null;
    if (entry && currentPath() === file) notify({ kind: 'info', text: entryLine(entry) }, { pane: paneOf(doc) });
  }

  /** The pane's section, for what a viewer keeps per tab. */
  const paneHostOf = (): HTMLElement => doc.closest<HTMLElement>('section.marxy-pane') ?? doc;

  /**
   * Where a page of the app's own that keeps a place (a book's) keeps it: positions.json, as for a text document, read
   * when the page first asks, which the page does after its first paint. None for an entry or a scratch path.
   */
  function rememberFor(file: string): ViewerMemory | undefined {
    if (isUntitled(file) || isArchiveEntry(file)) return undefined;
    return {
      stored: (length, stamp) => persistence.viewerPlace(file, length, stamp),
      note: (place, stamp) => {
        if (viewing === file) persistence.noteViewer(file, place, stamp);
      },
    };
  }

  /**
   * A file that is not a text buffer: no store, no parse, never read whole. Its viewer draws Read (the image
   * page, or the file card with the bytes beside it) and Source (the hex view); `at` is a byte the hex view lands on, in
   * whichever mode shows it. What was open before goes first, as for any open.
   */
  async function showViewerFor(file: string, signals: ContentSignals | null, at: Landing | undefined): Promise<RenderEvidence> {
    const place = carriedPlace;
    carriedPlace = undefined;
    const { createViewer } = await import('../viewers/index.ts');
    const made = await createViewer({ shell, path: file, signals, paneHost: paneHostOf(), place, remember: rememberFor(file) });
    const byte = typeof at === 'number' ? at : at?.byteOffset;
    const mode = byte !== undefined && made.land ? made.land(byte) : undefined;
    if (closed) {
      made.destroy();
      throw new Error('closed while the file was read');
    }
    teardownDocument(false, keepLeaving && file !== currentPath());
    detected = null;
    ruleRead = undefined;
    openedInSource = false;
    scratchLabel = undefined;
    scratchSaveIn = undefined;
    setPaneKind(paneHostOf(), null);
    clearDismissForPath(file);
    clearNotices(paneOf(doc));
    viewing = file;
    await shell.mark('file_read', Date.now(), `bytes=${made.binary ? 0 : -1} viewer=${made.kind}`);
    const evidence = await view.showViewer(made, {
      mode,
      onMounted: () => {
        for (const follow of [...followers]) follow(null);
      },
    });
    if (ownsTitle()) document.title = `${file.split('/').pop()} — Marxy`;
    // An entry is in memory, and nothing on disk changes it.
    if (!isArchiveEntry(file)) void watchViewer(file);
    return evidence;
  }

  /** A file that could not be opened is the pane's file now: the floor's card says so, and the tab, head and panel follow it. */
  async function showFailed(file: string, e: unknown): Promise<void> {
    scratchLabel = undefined;
    scratchSaveIn = undefined;
    clearNotices(paneOf(doc));
    try {
      const { createFailedViewer } = await import('../viewers/failed.ts');
      if (closed) return;
      viewing = file;
      await view.showViewer(createFailedViewer({ path: file, error: e }), {
        onMounted: () => {
          for (const follow of [...followers]) follow(null);
        },
      });
      if (ownsTitle()) document.title = `${file.split('/').pop()} — Marxy`;
    } catch (shown) {
      console.warn(`marxy: the card for ${file} could not be shown: ${String(shown)}`);
      viewing = null;
      deps.selection()?.afterRender();
      view.showRenderedChrome();
      // A read error names the path, and a path is not markup.
      const message = document.createElement('p');
      message.textContent = String(e);
      doc.replaceChildren(message);
    }
  }

  async function watchViewer(file: string): Promise<void> {
    try {
      const watch = await shell.watch(dirname(file), (events) => {
        void serially(() => viewerFileChanged(file, events));
      });
      // Another file, or this one opened again, took the pane while the watch was set up.
      if (closed || viewing !== file || viewerWatch) watch.close();
      else viewerWatch = watch;
    } catch (e) {
      console.warn(`marxy: not watching ${dirname(file)}: ${String(e)}`);
      await shell.mark('watch_failed', Date.now(), String(e));
    }
  }

  /**
   * The file a viewer shows changed on disk: its page is made again from what is there now, at the reader's place. Nothing
   * says what changed (the fence). A file gone keeps its page and says so, as a text file's does; renamed, it follows.
   */
  async function viewerFileChanged(file: string, events: readonly WatchEvent[]): Promise<void> {
    if (closed || viewing !== file) return;
    const effect = effectForOpenDocument(events, file);
    if (effect.action === 'ignore') return;
    if (effect.action === 'gone') {
      fileRemovedNotice({ pane: paneOf(doc) });
      return;
    }
    fileOnDiskNotice({ pane: paneOf(doc) });
    const place = view.viewer()?.place?.();
    if (effect.action === 'follow') {
      carriedPlace = place;
      await openReplacing(effect.path);
      carriedPlace = undefined;
      return;
    }
    const signals = (await shell.detectFiles?.([file]).then((found) => found[0] ?? null, () => null)) ?? null;
    if (closed || viewing !== file) return;
    if (signals) noteContent(file, signals);
    // Bytes that read as text now open as text, through the whole open.
    if (fileTypeFor(file).kind !== 'binary' && !bytesChosen(file)) {
      await openReplacing(file, undefined, undefined, true);
      return;
    }
    const { createViewer } = await import('../viewers/index.ts');
    let made: PaneViewer;
    try {
      made = await createViewer({ shell, path: file, signals, paneHost: paneHostOf(), place, remember: rememberFor(file) });
    } catch (e) {
      // Caught mid-write: the page stays as it was, and the write's last event makes it again.
      console.warn(`marxy: ${file} could not be read again: ${String(e)}`);
      return;
    }
    if (closed || viewing !== file) {
      made.destroy();
      return;
    }
    await view.showViewer(made, {
      mode: view.mode,
      onMounted: () => {
        for (const follow of [...followers]) follow(null);
      },
    });
  }

  /** The file's folder (or repository) becomes a place, so Places and the crumbs read the same for a text file and a viewer's. */
  function holdFolder(file: string, bytes?: Uint8Array): void {
    // A folder that cannot be read is no place; the page already shown stays as it is.
    indexing = index.ensureFor(file, bytes).catch((e: unknown) => console.warn(`marxy: the folder of ${file} could not be indexed: ${String(e)}`));
    void indexing;
  }

  /** A viewer's folder is held at idle, after its decoders have had the thread; nothing in the viewer waits for the index. */
  function holdViewerFolder(file: string): void {
    if (isUntitled(file)) return;
    void whenIdle(async () => holdFolder(file)).catch(() => undefined);
  }

  /**
   * After the first screens: typeset, the stored place (`firstOpen`: the launch's document, whose
   * positions.json is read only now, after first text), deferred start-up and the user theme at idle,
   * the mode, the watch and the title.
   */
  async function finishDocumentOpen(file: string, opts: { at?: number; firstOpen?: boolean; sliced?: boolean } = {}): Promise<void> {
    // A file that opens in Source was shown there by `readAndShow`, with no page made: nothing is typeset
    // and there is no page for images, math or highlighting; the Rendered pass waits for the reader's first ask.
    const inSource = openedInSource;
    if (opts.firstOpen) await persistence.ensureLoaded(dirname(file));
    if (opts.sliced) await yieldToEventLoop();
    if (!inSource) await view.typeset();
    if (opts.firstOpen) await restorePersistedPosition();
    const deferred = inSource ? null : view.deferredWork(file);
    // A scratch document is in no repository: it is not indexed, watched or offered a theme beside it. Nor is an
    // archive's entry, which is in memory only.
    const scratch = isUntitled(file) || isArchiveEntry(file);
    await whenIdle(async () => {
      await deferred?.();
      if (!scratch) holdFolder(file, current?.snapshot().buffer.bytes);
      await config.startUserTheme();
    });
    await shell.mark('position_restored', Date.now());
    // The stored place may have put code the reader left in Source back there (`restorePersistedPosition`).
    if (!inSource && !openedInSource) view.showRenderedChrome();
    if (!scratch) {
      await config.offerThemeDocument(file);
      if (current) await watches.watch(current);
    }
    await refreshTitle();
  }

  async function openReplacing(file: string, at?: number, scratch?: OpenOptions['scratch'], again = false, keep = true): Promise<void> {
    if (closed) return;
    keepLeaving = keep;
    const openPath = currentPath();
    // A scratch document asked for again, with no bytes to open it from: it is already here, and nothing
    // else could say what it was (there is no file to read back).
    if (!again && file === openPath && isUntitled(file) && !scratch && view.document()) return;
    if (openPath && file !== openPath) await persistence.flushReading(view);
    const shownViewer = viewing === file ? view.viewer() : null;
    if (!again && file === openPath && shownViewer?.land && at !== undefined) {
      const mode = shownViewer.land(at);
      // Already on this view's queue: the switch runs after it, never awaited here.
      if (mode !== view.mode) void view.setMode(mode);
      return;
    }
    if (!again && file === openPath && view.document() && at !== undefined) {
      // A heading in the document already on screen: move, do not read and set it again.
      if (view.mode === 'source') await view.leaveSource();
      view.landOn(at);
      return;
    }
    const chunks = gate();
    // Until this open ends, a mode press is dropped: it meant the page the reader was looking at.
    const endOpen = view.beginOpen();
    try {
      await readAndShow(file, at, chunks.promise, scratch, again && detected !== null ? 'keep' : 'now');
      chunks.release();
      if (!isUntitled(file) && !isArchiveEntry(file)) {
        persistence.trackOpen(file, () => index.rootFor(file));
        // Not for a reload of what is already open: the list is of what the reader opened.
        if (!again) void shell.noteRecent?.(file);
      }
      sayEntry(file);
      if (viewing === file) {
        holdViewerFolder(file);
        await refreshTitle();
        return;
      }
      await finishDocumentOpen(file, { at, sliced: openedInSlices });
    } catch (e) {
      chunks.release();
      // The pane was closed under the open: nothing is shown, written or torn down for a page that is gone.
      if (closed) return;
      // Nothing of the last document may outlive the page that showed it.
      if (claimedOpen && claimedOpen !== current) release(claimedOpen);
      claimedOpen = null;
      teardownDocument(false, keepLeaving && file !== currentPath());
      detected = null;
      setPaneKind(doc.closest('section.marxy-pane'), null);
      await showFailed(file, e);
    } finally {
      paneHostOf().removeAttribute(WORKING);
      endOpen();
    }
  }

  function open(file: string, opts?: OpenOptions): Promise<void> {
    const run = () =>
      serially(async () => {
        // The document already on screen, asked for again with nowhere to go (a second launch, Finder, a
        // drag, the palette on the current document): reading it back from disk would drop unsaved edits.
        if (file === currentPath() && opts?.at === undefined && hasUnsavedChanges()) return;
        opts?.onCommitted?.();
        await openReplacing(file, opts?.at, opts?.scratch);
        // Only once `file` is on screen: after a confirmed "Save and open" too, never on the old document.
        if (currentPath() === file) opts?.onLanded?.();
      });
    // Another document over unsaved edits asks first (save / discard / dismiss), as a close does. Moving
    // within the open document, or opening with nothing unsaved, goes straight through.
    // Only this pane's unsaved edits ask, and the notice names, sits in and saves this pane's
    // document: the guard finds the pane by its view.
    if (file !== currentPath() && hasUnsavedChanges() && confirmLeaveDocument(view, run)) return Promise.resolve();
    return run();
  }

  /** The launch's document, through first text, then the rest of the open with its stored place. */
  async function bootDocument(file: string, after: number, chunks: ReturnType<typeof gate>): Promise<void> {
    // The kind is on the pane root before the first write (a profile that changes the face or the column would
    // otherwise move the page after first text). Its inputs are the reads the launch makes anyway; none is waited for.
    const evidence = await readAndShow(file, undefined, chunks.promise, undefined, 'launch');
    // A text document is tracked here too: only the viewer branch used to be, so a launch file never reached history.
    if (!isUntitled(file)) {
      persistence.trackOpen(file, () => index.rootFor(file));
      void shell.noteRecent?.(file);
    }
    if (viewing === file) {
      chunks.release();
      holdViewerFolder(file);
      await refreshTitle();
      return measure.finish(0);
    }
    const renderedAt = Date.now();
    // First text is what the reader sees: Source for a file that opened there, else the article.
    const outcome = await measure.waitForFirstText(view.mode === 'source' ? view.host.sourceHost : doc, evidence, after, renderedAt);
    // a document with no text (only images) was not painted as text, and the measurement said so
    // with `no_text`, but it is a document: it opens like any other and ends with finish(0). What
    // makes it a document is its source (a byte that is not white space), not the rendered selector, which
    // misses a lone `---`, a comment, a `<div>`. Only a blank file (an empty file) still fails with finish(1).
    const hasSource = current?.snapshot().buffer.bytes.some((b) => b !== 0x20 && (b < 0x09 || b > 0x0d)) ?? false;
    const textless = outcome === 'no_text' && hasSource;
    if (outcome !== 'painted' && outcome !== 'frames_only' && !textless) return measure.finish(1);
    chunks.release();
    await finishDocumentOpen(file, { firstOpen: true });
    setTimeout(() => void trust.load().then(() => trust.maybeRerenderForLateTrust()), 0);
    await indexing;
    // A kinds.json that was slower than the document's read has had its say by now (a no-op for nearly every launch).
    await launchRedecide;
    return measure.finish(0);
  }

  async function boot(given: readonly string[]): Promise<void> {
    await shell.mark('script_start', t0);
    // Before anything is laid out, so no weight is set twice. The WebKit version is not asked for, so it is null
    // and the table's unknown-version row applies.
    const offset = applyWeightOffset(document.documentElement, platformOf(navigator.userAgent), null);
    void shell.mark('weight_offset', Date.now(), `offset=${offset}`);
    const argv = given.length > 0 ? given : await shell.args();
    measure.adoptArgs(argv);
    await shell.mark('args', Date.now(), `n=${argv.length}`);
    // Skip flags and the macOS launcher's -psn_… argument; the first plain argument is the document.
    const file = argv.find((a) => !a.startsWith('-'));
    // Harness-only: the negative test that `#doc { visibility: hidden }` is not first readable text.
    // The flag only hides the element; refusing `first_text` is the visibility check below, not the flag.
    if (argv.includes('--smoke-hide-doc')) doc.style.visibility = 'hidden';

    // No document means no `first_text`: nothing was read, so a launch like this must not be able to
    // hand the startup measurement a cold-start number.
    if (!file) {
      await config.applyOnce(document.documentElement);
      const piece = await showFrontispiece(view, deps.pieces);
      await shell.mark('no_document', Date.now(), piece ? `piece=${piece}` : undefined);
      if (piece) setFrontispiece(view);
      // Read with no document too: the quit flush would otherwise write this launch's opens over history.json.
      void persistence.ensureLoaded('/');
      return measure.finish(0);
    }

    const after = performance.now();
    // A large document's idle chunks wait for first text: anything appended before the paint would be
    // styled and laid out in the frame first text is waiting for.
    const chunks = gate();
    const endOpen = view.beginOpen();
    try {
      return await bootDocument(file, after, chunks);
    } finally {
      chunks.release();
      paneHostOf().removeAttribute(WORKING);
      endOpen();
    }
  }

  /**
   * Makes `next` the open document's bytes, as one `apply` of the range by which it differs, labelled
   * `edit`; disk is updated only on explicit save. Bytes equal to the buffer change nothing in
   * the store, but the page is set again, as it always was for this call.
   */
  function commitEdit(next: Buffer): Promise<void> {
    return serially(async () => {
      const open = current;
      if (!open || next.path !== open.snapshot().path || !view.document()) throw new Error('the edited document is no longer open');
      // `next` was built from the bytes before the reader typed; applying it would be folded back over by
      // the typed text, or lose the typed text. Refused, nothing written.
      if (view.sourceHasUnfoldedEdits()) throw new Error('Source holds text not yet in the document; leave Source or save first');
      const snap = open.snapshot();
      const change = byteChange(snap.buffer.bytes, next.bytes);
      if (change === null) {
        view.repaint();
      } else {
        await open.apply({
          range: { file: snap.path, start: change.start, end: change.end },
          replacement: new TextDecoder().decode(change.replacement),
          label: 'edit',
          baseVersion: snap.version,
        });
      }
      await view.settled();
    });
  }

  return {
    scratchLabel: () => scratchLabel,
    boot: (argv) => serially(() => boot(argv)),
    open,
    replace: (file, opts) =>
      serially(async () => {
        await openReplacing(file, opts?.at, opts?.scratch);
        if (currentPath() === file) opts?.onLanded?.();
      }),
    currentPath,
    store: () => current,
    viewer: () => view.viewer(),
    detected: () => detected,
    openDocument: () => (current ? documentState(current.snapshot()) : null),
    onDocumentChange(cb) {
      let unsubscribe: (() => void) | null = null;
      const follow = (next: DocumentStore): void => {
        unsubscribe?.();
        unsubscribe = next.subscribe((snap, change) => cb(change.kind === 'close' ? null : documentState(snap)));
      };
      const opened = (next: DocumentStore | null): void => {
        if (next === null) {
          unsubscribe?.();
          unsubscribe = null;
          cb(null);
          return;
        }
        follow(next);
        cb(documentState(next.snapshot()));
      };
      if (current) follow(current);
      followers.add(opened);
      return () => {
        followers.delete(opened);
        unsubscribe?.();
        unsubscribe = null;
      };
    },
    hasUnsavedChanges,
    commitEdit,
    foldSource,
    async save(opts) {
      const open = current;
      if (!open) return 'failed';
      const result = await save(saveDeps(open), opts);
      // The store's subscription refreshes the title on a save; resolve once it has.
      await view.settled();
      return result;
    },
    refreshTitle,
    follow: (file, at) => openReplacing(file, at, undefined, false, false),
    rejoin: () =>
      serially(async () => {
        const file = currentPath();
        if (file === null || isUntitled(file)) return;
        await openReplacing(file, view.position().byteOffset, undefined, true);
      }),
    close() {
      closed = true;
      followers.clear();
      viewerWatch?.close();
      viewerWatch = null;
      if (claimedOpen && claimedOpen !== current) release(claimedOpen);
      claimedOpen = null;
      if (current) release(current);
      current = null;
      viewing = null;
      detected = null;
    },
  };
}
