// The open path (B-15, lifted from app.ts): read a file, open its store, show it in the view, typeset,
// restore the stored place, run the deferred start-up and the user theme, watch it and title it; and
// `boot`, a launch's first open (or its frontispiece). The open store is a field of the object
// `createOpenPath` returns, never module state, so a second app instance in one page starts clean
// (ADR-0037). Every edit, save and fold of the open document goes through its store here.
import { KIND_HEAD_BYTES, lastChunkedParse, parseMarkdownChunked, type Buffer, type DetectResult, type KindRule } from '@marxy/core';
import { detectFileKind, emptyKindsEnvelope, type KindsEnvelope } from '@marxy/core/src/kind/show-as.ts';
import { parseConfig } from '@marxy/theme';
import { buildNodeMapInSlices } from '../render/post.ts';
import { dirname } from '@marxy/core/src/index-model/paths.ts';
import type { AppShell, OpenDocumentState } from '../app.ts';
import { confirmLeaveDocument } from '../close.ts';
import { setFrontispiece, showFrontispiece } from '../frontispiece/mount.ts';
import type { PieceSource } from '../frontispiece/pieces.ts';
import type { IndexService } from '../index/service.ts';
import { setPaneKind } from '../pane/dom.ts';
import { clearDismissForPath } from '../notices/blocked.ts';
import { clearNotices, paneOf } from '../notices/index.ts';
import type { ReadingPersistence } from '../position/reading-persistence.ts';
import { save, type SaveDeps, type SaveResult } from '../save.ts';
import type { RenderedSelection } from '../selection/view.ts';
import { defaultModeForPath } from '../source/default-mode.ts';
import { whenIdle } from '../startup/idle-work.ts';
import { yieldToEventLoop } from '../startup/yield.ts';
import { t0, type LaunchMeasure, type RenderEvidence } from '../startup/measure.ts';
import { readKindsFile, type AppConfig } from '../theme/app-config.ts';
import { applyWeightOffset, platformOf } from '../theme/offset.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
// Static, as it was through save.ts before B-11: a lazy chunk here would put the first title (and the
// late trust read queued after it) behind a fetch.
import { updateTitle } from '../title.ts';
import type { TrustController } from '../trust/controller.ts';
import type { RenderedView } from '../view/rendered-view.ts';
import type { DocumentWatch } from './live-reload.ts';
import type { StoreRegistry } from './registry.ts';
import { openDocumentStore, openUntitledStore, type DocumentSnapshot, type DocumentStore, type Preparsed } from './store.ts';
import { documentName, isUntitled } from './untitled.ts';

/**
 * How a document is opened (`AppHandle.open`, `PaneSet.openIn`, a pane's `open` and `replace`): `at` is a
 * byte held at the reading line; `onLanded` runs once the document is on screen in the pane it was opened
 * in, never when the open is refused or the reader dismisses the unsaved-edits prompt (C-17, D-01).
 * `onCommitted` (a pane's `open` only) runs once the open goes ahead, before anything is read or shown, and
 * on the same terms (never on a Dismiss): state that must not lag the page across its awaits, such as a link
 * history, is set there (F-21).
 * `scratch` is what a scratch path (`untitled.ts`) opens: the bytes the document was born with, and a label
 * for its window title (E-13). A scratch path another pane already shows needs none.
 */
export interface OpenOptions {
  readonly at?: number;
  readonly onLanded?: () => void;
  readonly onCommitted?: () => void;
  readonly scratch?: { readonly bytes: Uint8Array; readonly label?: string };
}

/** The window's live reload: one watch per store, started by whichever pane shows it first (D-10). */
export interface StoreWatches {
  /** The store's watch; asking again for a store already watched starts nothing. */
  watch(store: DocumentStore): Promise<DocumentWatch>;
  /** The watch started for `store`, or null when none was. */
  of(store: DocumentStore): Promise<DocumentWatch> | null;
}

export interface OpenPathDeps {
  readonly shell: AppShell;
  /** The view every open shows its store in: one pane's (D-01). */
  readonly view: RenderedView;
  /**
   * The stores open in the window, one per path (D-01): a document another pane already shows is shown
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
  /** The pieces a launch with no document chooses from; null is the bundled Commonplace (MARXY-256). */
  readonly pieces: readonly PieceSource[] | null;
  /**
   * A Save As moved `store` onto a path another pane shows through a second store (D-10.1): that pane
   * lets its store go and shows `store`, so the path has one store and one watch.
   */
  rejoin?(store: DocumentStore): Promise<void>;
  /**
   * True while another pane is on screen (D-15): a large document is then read in slices with the event loop
   * given back between them, so the other pane keeps painting and scrolling. Unset, or false for a window's
   * only pane, which has nothing else to keep alive and reads at once, the fastest road to first text.
   */
  sliced?(): boolean;
  /** This open path's document titles the window (the focused pane's, D-01); unset, it always does. */
  ownsTitle?(): boolean;
}

export interface OpenPath {
  /** The launch: the document `argv` names (the shell's arguments when it names none), else the frontispiece. */
  boot(argv: readonly string[]): Promise<void>;
  /** `AppHandle.open`: after any open under way, and asking first over unsaved edits. */
  open(path: string, opts?: OpenOptions): Promise<void>;
  /** `open` without asking: the caller already has (closing the left pane, D-01). */
  replace(path: string, opts?: OpenOptions): Promise<void>;
  /**
   * `replace` for a caller already on this view's queue, so it does not queue (a watch following a rename
   * on disk, D-10): `at` is the byte held at the reading line.
   */
  follow(path: string, at: number): Promise<void>;
  /** Show this pane's path again through the store the registry now holds for it (D-10.1), at the place it was. */
  rejoin(): Promise<void>;
  currentPath(): string | null;
  /** The open document's store, or null. */
  store(): DocumentStore | null;
  /**
   * What the open document was decided to be when it opened (K-05a): the kind and every reason that fired.
   * Decided once per open and kept through live reloads; null when nothing is open. The kind chip (K-07) reads it here.
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
  return { path: snap.path, buffer: snap.buffer, ast: snap.ast, nodeMap: snap.nodeMap };
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

/** A document of at least this many bytes is read in slices while another pane is on screen (D-15); below it the work is a frame or less. */
const SLICED_BYTES = 64 * 1024;

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
   * The open document (ADR-0037): its path, its bytes and the bytes on disk, its parse and its history.
   * Every change to them is one of the store's transitions, and the page follows them through the
   * view's subscription.
   */
  let current: DocumentStore | null = null;
  let closed = false;
  /** What the open scratch document is called in the window title, if it was given a name (E-13). */
  let scratchLabel: string | undefined;
  /** `onDocumentChange` subscribers: each moves its subscription to a newly opened store (B-12). */
  const followers = new Set<(next: DocumentStore) => void>();
  /** The byte the open in progress lands on (an `at`, or the stored place), read before anything re-notes it. */
  let landing: number | undefined;
  /** The open in progress was read in slices (D-15): its later stages give the frame back too. */
  let openedInSlices = false;
  /** The launch document's walk, so `ready` (and a harness quit) follows its `index_loaded` mark. */
  let indexing: Promise<void> = Promise.resolve();

  /** The open document's kind and reasons, decided in `readAndShow` and not again until it is opened again (ADR-0060 item 6). */
  let detected: DetectResult | null = null;
  /** The launch's kind when kinds.json was still being read as the page was first written: settled once it is decided again (K-05a.1). */
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
  function applyKind(file: string, bytes: Uint8Array, inputs: KindInputs): DetectResult {
    const result = detectFileKind({ path: file, head: bytes.subarray(0, KIND_HEAD_BYTES), rules: inputs.rules, choices: inputs.choices });
    detected = result;
    setPaneKind(doc.closest('section.marxy-pane'), result.kind);
    return result;
  }

  /**
   * Decides what `file` is, from its first bytes: the reader's *show as* beats a rule and a rule beats detection
   * (`detectFileKind`), and the pane's root is given the result.
   */
  async function decideKind(file: string, bytes: Uint8Array, inputs: Promise<KindInputs> = readKindInputs()): Promise<void> {
    applyKind(file, bytes, await inputs);
  }

  /**
   * The launch document's kind (K-05a.1), decided before its first paint from what the pre-paint config read already
   * holds: the rules from its bytes, and kinds.json if that read, started beside the document's own, has finished.
   * A kinds.json still being read is not waited for (commitment 5): the kind is decided without it, and the
   * returned promise redecides once it arrives, unless the answer is the same or another document has opened.
   */
  function decideLaunchKind(file: string, bytes: Uint8Array): Promise<void> | null {
    const known = config.launchKindInputs();
    const first = applyKind(file, bytes, { rules: known.rules, choices: known.choices ?? emptyKindsEnvelope() });
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
  const currentPath = (): string | null => current?.snapshot().path ?? null;

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
    // store does not (D-10): the focused pane is not the only one that can.
    await updateTitle(shell, snap?.path ?? null, (snap?.dirty ?? false) || (current !== null && unfoldedAnywhere(current)), scratchLabel);
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
  function teardownDocument(): void {
    view.clear();
    // The store goes with its page: a transition still queued on it is refused, not applied elsewhere.
    // Its watch closes with it (document/live-reload.ts). One another pane still shows stays open, and
    // only this open path's watch on it closes.
    if (current) release(current);
    current = null;
  }

  /**
   * This open path lets `store` go. The last holder closes it, and its watch with it; a store another pane
   * still shows stays open, and so does its watch: it reloads that pane's page too (D-10).
   */
  function release(store: DocumentStore): void {
    if (!deps.stores) return store.close();
    // The store's watch is the window's: it closes with the store, when its last view lets go.
    deps.stores.release(store);
  }

  /** The store's save, with what only the app can do around it (save.ts). */
  function saveDeps(open: DocumentStore): SaveDeps {
    // The path the reader picks may be one another pane shows through its own store: a second store for it
    // would break one-store-per-path, and unsaved text in that pane would be thrown away (D-10.1).
    const pickAround = async (options: Parameters<AppShell['saveDialog']>[0]): Promise<string | null> => {
      const picked = await shell.saveDialog(options);
      if (!picked) return picked;
      const other = deps.stores?.held(picked) ?? null;
      if (other && other !== open) {
        const unsaved = other.snapshot().dirty || deps.viewsOver(other).some((v) => v.sourceHasUnfoldedEdits());
        if (unsaved) {
          const { notify } = await import('../notices/index.ts');
          notify(
            { kind: 'info', text: `${documentName(picked)} is open in the other pane with changes that are not saved. Save or close it there first; nothing was written.` },
            { pane: paneOf(doc) },
          );
          return null;
        }
      }
      return picked;
    };
    return {
      store: open,
      shell: Object.assign(Object.create(shell), { saveDialog: pickAround }) as AppShell,
      foldSource: async () => {
        if (current === open) await foldSource();
      },
      holdsUnfoldedSource: () => current === open && unfoldedAnywhere(open),
      pane: paneOf(doc),
      onSaveAs: async (path, from) => {
        if (current !== open) return;
        await shell.allowAssetScope(dirname(path));
        // The watch moved with the store when it took the new path (document/live-reload.ts). The save
        // resolves once the new folder's watch is registered, so a write right after it is seen. A scratch
        // document had no watch: it is now a file, so it gets one, and its place in the folder's index.
        if (isUntitled(from)) {
          scratchLabel = undefined;
          await (await watches.watch(open)).moved();
          if (ownsTitle()) document.title = `${documentName(path)} — Marxy`;
          persistence.trackOpen(path, () => index.rootFor(path));
          void index.ensureFor(path, open.snapshot().buffer.bytes);
        } else {
          await (await watches.of(open))?.moved();
        }
        // Another pane showing the path through its own (clean) store now shows this one (D-10.1).
        await deps.rejoin?.(open);
        deps.selection()?.afterRender();
      },
    };
  }

  /** After `first_text`, positions.json may ask to move the document already on screen (MARXY-195). */
  async function restorePersistedPosition(): Promise<void> {
    if (!current || !view.document()) return;
    const { path, buffer } = current.snapshot();
    const stored = persistence.storedFor(path, buffer.bytes.length);
    if (!stored) return;
    landing = stored.byteOffset;
    // A file that opens in Source is already in Source (V-11); its stored place is a byte in it, not a block of a page.
    if (defaultModeForPath(path) === 'source') {
      if (view.mode === 'source') await view.showSource(stored.byteOffset);
      return;
    }
    // A place kept in Source is a line, not a fraction of a block: its block, at the top (S-08-0001).
    const position = stored.mode === 'source' ? { ...stored, fraction: 0, mode: 'rendered' as const } : stored;
    view.restore(position);
    view.landOn(stored.byteOffset);
  }

  /**
   * Read and render `file` through the `render` mark; cold-start paint runs after this (MARXY-183).
   * A large document's idle chunks wait for `start` (A-02), so nothing is appended before first text.
   */
  async function readAndShow(
    file: string,
    at: number | undefined,
    start: Promise<unknown>,
    scratch?: OpenOptions['scratch'],
    kind: 'now' | 'keep' | 'launch' = 'now',
  ): Promise<RenderEvidence> {
    // A file that opens in Source loads Source's code while the file is read, not after it (V-11).
    const opensInSource = defaultModeForPath(file) === 'source';
    if (opensInSource) view.warmSource(file);
    // The reader's rules and choices are read beside the file, not after it.
    const kindInputs = kind === 'now' ? readKindInputs() : null;
    // config.toml is read beside the document, not after it (and, at launch, kinds.json starts with it).
    const applying = config.applyOnce(document.documentElement, { kinds: kind === 'launch' });
    // Shown in another pane: its store is the document, unsaved edits and all, and is not read again.
    const shown = deps.stores?.held(file) ?? null;
    const untitled = isUntitled(file);
    let bytes: Uint8Array;
    if (shown && shown !== current) bytes = shown.snapshot().buffer.bytes;
    // A scratch document is not on disk: its bytes are the ones it was handed, and nothing is read (E-13).
    else if (untitled) {
      if (!scratch) throw new Error('That new document is no longer open.');
      bytes = scratch.bytes;
    } else bytes = await shell.readFile(file);
    await applying;
    let lands = at;
    if (lands === undefined && !untitled) {
      const stored = persistence.storedFor(file, bytes.length);
      if (stored) lands = stored.byteOffset;
    }
    landing = lands;
    // Another pane on screen: a large document is parsed in slices, before this pane's page is touched.
    const slices = deps.sliced?.() === true && bytes.length >= SLICED_BYTES;
    openedInSlices = slices;
    let preparsed: Preparsed | undefined;
    let cut = 0;
    if (slices && !(deps.stores?.held(file) ?? null)) {
      const ast = await parseMarkdownChunked(bytes, { file, yieldNow: yieldToEventLoop, aborted: () => closed });
      const stats = lastChunkedParse();
      cut = stats.kind === 'slices' ? stats.slices : 0;
      preparsed = { ast, nodeMap: await buildNodeMapInSlices(ast, yieldToEventLoop, undefined, () => closed) };
      if (closed) throw new Error('closed while the document was read');
    }
    teardownDocument();
    // The kind is decided here, once per open, from the file's own first bytes (`decideKind`), before the page is
    // touched. A reload of this document never comes back through here; only an open does. `rejoin` shows the same
    // document again and keeps its kind. The launch's document is decided from the reads the pre-paint config
    // read already made, without waiting for any that is still out (`decideLaunchKind`).
    if (kindInputs) await decideKind(file, bytes, kindInputs);
    else if (kind === 'launch') launchRedecide = decideLaunchKind(file, bytes);
    scratchLabel = untitled ? scratch?.label : undefined;
    clearDismissForPath(file);
    await shell.mark('file_read', Date.now(), `bytes=${bytes.length}`);
    // The open transition (ADR-0037): the store copies the bytes, parses them once and starts an empty
    // history with `disk` as read. The page renders from its snapshot and follows it from here on.
    let parsedHere = false;
    const make = (): DocumentStore => {
      parsedHere = true;
      const io = {
        writeFileAtomic: (path: string, written: Uint8Array) => shell.writeFileAtomic(path, written),
        recordRead: shell.recordRead ? (path: string, read: Uint8Array) => shell.recordRead?.(path, read) : undefined,
        peekFile: shell.peekFile ? (path: string) => shell.peekFile!(path) : undefined,
        exists: async (path: string) => (await shell.stat(path)) !== null,
      };
      return untitled ? openUntitledStore(io, file, bytes) : openDocumentStore(io, file, bytes, preparsed);
    };
    const opened = deps.stores ? deps.stores.acquire(file, make) : make();
    current = opened;
    if (slices) await yieldToEventLoop();
    // One parse for a file however many panes show it: a pane that shares the store makes none (D-10).
    if (parsedHere) await shell.mark('parsed', Date.now(), preparsed ? `slices=${cut}` : undefined);
    // A different document starts with no notices in this pane; another pane's are its own (D-10).
    clearNotices(paneOf(doc));
    // The view renders from the store's snapshot and follows it from here on (B-13).
    const evidence = await view.show(opened, {
      at: lands,
      start,
      sliced: slices,
      source: opensInSource,
      onMounted: () => {
        for (const follow of [...followers]) follow(opened);
      },
    });
    if (ownsTitle()) document.title = `${untitled ? documentName(file) : file.split('/').pop()} — Marxy`;
    return evidence;
  }

  /**
   * After the first screens: typeset, the stored place (`firstOpen`: the launch's document, whose
   * positions.json is read only now, after first text), deferred start-up and the user theme at idle,
   * the mode, the watch and the title.
   */
  async function finishDocumentOpen(file: string, opts: { at?: number; firstOpen?: boolean; sliced?: boolean } = {}): Promise<void> {
    // A file that opens in Source was shown there by `readAndShow`, with no page made (V-11): nothing is typeset
    // and there is no page for images, math or highlighting; the Rendered pass waits for the reader's first ask.
    const inSource = defaultModeForPath(file) === 'source';
    if (opts.firstOpen) await persistence.ensureLoaded(dirname(file));
    if (opts.sliced) await yieldToEventLoop();
    if (!inSource) await view.typeset();
    if (opts.firstOpen) await restorePersistedPosition();
    const deferred = inSource ? null : view.deferredWork(file);
    // A scratch document is in no repository: it is not indexed, watched or offered a theme beside it (E-13).
    const scratch = isUntitled(file);
    await whenIdle(async () => {
      await deferred?.();
      if (!scratch) {
        indexing = index.ensureFor(file, current?.snapshot().buffer.bytes);
        void indexing;
      }
      await config.startUserTheme();
    });
    await shell.mark('position_restored', Date.now());
    if (!inSource) view.showRenderedChrome();
    if (!scratch) {
      await config.offerThemeDocument(file);
      if (current) await watches.watch(current);
    }
    await refreshTitle();
  }

  async function openReplacing(file: string, at?: number, scratch?: OpenOptions['scratch'], again = false): Promise<void> {
    if (closed) return;
    const openPath = currentPath();
    // A scratch document asked for again, with no bytes to open it from: it is already here, and nothing
    // else could say what it was (there is no file to read back).
    if (!again && file === openPath && isUntitled(file) && !scratch && view.document()) return;
    if (openPath && file !== openPath) await persistence.flushReading(view);
    if (!again && file === openPath && view.document() && at !== undefined) {
      // A heading in the document already on screen: move, do not read and set it again.
      if (view.mode === 'source') await view.leaveSource();
      view.landOn(at);
      return;
    }
    const chunks = gate();
    // Until this open ends, a mode press is dropped: it meant the page the reader was looking at (V-11).
    const endOpen = view.beginOpen();
    try {
      await readAndShow(file, at, chunks.promise, scratch, again && detected !== null ? 'keep' : 'now');
      chunks.release();
      if (!isUntitled(file)) persistence.trackOpen(file, () => index.rootFor(file));
      await finishDocumentOpen(file, { at, sliced: openedInSlices });
    } catch (e) {
      chunks.release();
      // The pane was closed under the open: nothing is shown, written or torn down for a page that is gone.
      if (closed) return;
      // Nothing of the last document may outlive the page that showed it.
      teardownDocument();
      detected = null;
      setPaneKind(doc.closest('section.marxy-pane'), null);
      deps.selection()?.afterRender();
      view.showRenderedChrome();
      // A read error names the path, and a path is not markup.
      const message = document.createElement('p');
      message.textContent = String(e);
      doc.replaceChildren(message);
    } finally {
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
        // Only once `file` is on screen: after a confirmed "Save and open" too, never on the old document (C-17).
        if (currentPath() === file) opts?.onLanded?.();
      });
    // Another document over unsaved edits asks first (save / discard / dismiss), as a close does. Moving
    // within the open document, or opening with nothing unsaved, goes straight through.
    // Only this pane's unsaved edits ask (D-01), and the notice names, sits in and saves this pane's
    // document (D-08): the guard finds the pane by its view.
    if (file !== currentPath() && hasUnsavedChanges() && confirmLeaveDocument(view, run)) return Promise.resolve();
    return run();
  }

  /** The launch's document, through first text, then the rest of the open with its stored place. */
  async function bootDocument(file: string, after: number, chunks: ReturnType<typeof gate>): Promise<void> {
    // The kind is on the pane root before the first write (a profile that changes the face or the column would
    // otherwise move the page after first text). Its inputs are the reads the launch makes anyway; none is waited for.
    const evidence = await readAndShow(file, undefined, chunks.promise, undefined, 'launch');
    const renderedAt = Date.now();
    // First text is what the reader sees: Source for a file that opened there, else the article (V-11).
    const outcome = await measure.waitForFirstText(view.mode === 'source' ? view.host.sourceHost : doc, evidence, after, renderedAt);
    // F-17: a document with no text (only images) was not painted as text, and the measurement said so
    // with `no_text`, but it is a document: it opens like any other and ends with finish(0). F-17.1: what
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
    // Before anything is laid out, so no weight is set twice. shell-api declares webkitVersion(), but no
    // desktop shell calls it yet, so the version is null and the table's unknown-version row applies.
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
      endOpen();
    }
  }

  /**
   * Makes `next` the open document's bytes, as one `apply` of the range by which it differs, labelled
   * `edit`; disk is updated only on explicit save (MARXY-49). Bytes equal to the buffer change nothing in
   * the store, but the page is set again, as it always was for this call.
   */
  function commitEdit(next: Buffer): Promise<void> {
    return serially(async () => {
      const open = current;
      if (!open || next.path !== open.snapshot().path || !view.document()) throw new Error('the edited document is no longer open');
      // `next` was built from the bytes before the reader typed; applying it would be folded back over by
      // the typed text, or lose the typed text. Refused, nothing written (F-12).
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
    boot: (argv) => serially(() => boot(argv)),
    open,
    replace: (file, opts) =>
      serially(async () => {
        await openReplacing(file, opts?.at, opts?.scratch);
        if (currentPath() === file) opts?.onLanded?.();
      }),
    currentPath,
    store: () => current,
    detected: () => detected,
    openDocument: () => (current ? documentState(current.snapshot()) : null),
    onDocumentChange(cb) {
      let unsubscribe: (() => void) | null = null;
      const follow = (next: DocumentStore): void => {
        unsubscribe?.();
        unsubscribe = next.subscribe((snap, change) => cb(change.kind === 'close' ? null : documentState(snap)));
      };
      const opened = (next: DocumentStore): void => {
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
    follow: (file, at) => openReplacing(file, at),
    rejoin: () =>
      serially(async () => {
        const file = currentPath();
        if (file === null || isUntitled(file)) return;
        await openReplacing(file, view.position().byteOffset, undefined, true);
      }),
    close() {
      closed = true;
      followers.clear();
      if (current) release(current);
      current = null;
      detected = null;
    },
  };
}
