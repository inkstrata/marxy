// The open path (B-15, lifted from app.ts): read a file, open its store, show it in the view, typeset,
// restore the stored place, run the deferred start-up and the user theme, watch it and title it; and
// `boot`, a launch's first open (or its frontispiece). The open store is a field of the object
// `createOpenPath` returns, never module state, so a second app instance in one page starts clean
// (ADR-0037). Every edit, save and fold of the open document goes through its store here.
import type { Buffer } from '@marxy/core';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import type { AppShell, OpenDocumentState } from '../app.ts';
import { confirmLeaveDocument } from '../close.ts';
import { setFrontispiece, showFrontispiece } from '../frontispiece/mount.ts';
import type { PieceSource } from '../frontispiece/pieces.ts';
import type { IndexService } from '../index/service.ts';
import { clearDismissForPath } from '../notices/blocked.ts';
import { clearNotices } from '../notices/index.ts';
import type { ReadingPersistence } from '../position/reading-persistence.ts';
import { save, type SaveDeps, type SaveResult } from '../save.ts';
import type { RenderedSelection } from '../selection/view.ts';
import { defaultModeForPath } from '../source/default-mode.ts';
import { whenIdle } from '../startup/idle-work.ts';
import { t0, type LaunchMeasure, type RenderEvidence } from '../startup/measure.ts';
import type { AppConfig } from '../theme/app-config.ts';
import { applyWeightOffset, platformOf } from '../theme/offset.ts';
// Static, as it was through save.ts before B-11: a lazy chunk here would put the first title (and the
// late trust read queued after it) behind a fetch.
import { updateTitle } from '../title.ts';
import type { TrustController } from '../trust/controller.ts';
import type { RenderedView } from '../view/rendered-view.ts';
import { oneWatchPerStore, watchDocument } from './live-reload.ts';
import { openDocumentStore, type DocumentSnapshot, type DocumentStore } from './store.ts';

export interface OpenPathDeps {
  readonly shell: AppShell;
  /** The view every open shows its store in (one, on `#doc`, until Phase D). */
  readonly view: RenderedView;
  readonly persistence: ReadingPersistence;
  readonly index: IndexService;
  readonly trust: TrustController;
  readonly measure: LaunchMeasure;
  readonly config: AppConfig;
  selection(): RenderedSelection | null;
  /** The pieces a launch with no document chooses from; null is the bundled Commonplace (MARXY-256). */
  readonly pieces: readonly PieceSource[] | null;
}

export interface OpenPath {
  /** The launch: the document `argv` names (the shell's arguments when it names none), else the frontispiece. */
  boot(argv: readonly string[]): Promise<void>;
  /** `AppHandle.open`: after any open under way, and asking first over unsaved edits. */
  open(path: string, opts?: { at?: number }): Promise<void>;
  currentPath(): string | null;
  /** The open document's store, or null. */
  store(): DocumentStore | null;
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
  /** `onDocumentChange` subscribers: each moves its subscription to a newly opened store (B-12). */
  const followers = new Set<(next: DocumentStore) => void>();
  /** The byte the open in progress lands on (an `at`, or the stored place), read before anything re-notes it. */
  let landing: number | undefined;
  /** The launch document's walk, so `ready` (and a harness quit) follows its `index_loaded` mark. */
  let indexing: Promise<void> = Promise.resolve();

  const serially = <T>(fn: () => Promise<T>): Promise<T> => view.serially(fn);
  const currentPath = (): string | null => current?.snapshot().path ?? null;

  /**
   * Live reload, one watch per store (B-14): it follows the store through a rename or a Save as and
   * closes with it. Its `open` is the non-queuing `openReplacing`: a rename follow runs inside
   * `serially`, and a queued open would wait on the task waiting for it.
   */
  const watches = oneWatchPerStore((open) =>
    watchDocument(open, () => [view], {
      shell,
      open: openReplacing,
      serially,
      foldSource,
      async renamed(path) {
        document.title = `${basename(path)} — Marxy`;
        deps.selection()?.afterRender();
        await refreshTitle();
      },
      changed(path) {
        void index.rootFor(path).then((root) => index.refresh(root));
      },
    }),
  );

  async function refreshTitle(): Promise<void> {
    if (!shell.setTitle) return;
    const snap = current?.snapshot();
    await updateTitle(shell, snap?.path ?? null, snap?.dirty ?? false);
  }

  async function foldSource(): Promise<void> {
    if (!current) return;
    if (await view.foldSource()) await refreshTitle();
  }

  function hasUnsavedChanges(): boolean {
    if (!current) return false;
    return current.snapshot().dirty || view.sourceHasUnfoldedEdits();
  }

  /**
   * Everything one open document started: the view's page (its typesetter, resize observer, pending grid
   * pass and Source editor), the watch and the store. Run before the next document replaces it.
   */
  function teardownDocument(): void {
    view.clear();
    // The store goes with its page: a transition still queued on it is refused, not applied elsewhere.
    // Its watch closes with it (document/live-reload.ts).
    current?.close();
    current = null;
  }

  /** The store's save, with what only the app can do around it (save.ts). */
  function saveDeps(open: DocumentStore): SaveDeps {
    return {
      store: open,
      shell,
      foldSource: async () => {
        if (current === open) await foldSource();
      },
      onSaveAs: async (path) => {
        if (current !== open) return;
        await shell.allowAssetScope(dirname(path));
        // The watch moved with the store when it took the new path (document/live-reload.ts). The save
        // resolves once the new folder's watch is registered, so a write right after it is seen.
        await (await watches.of(open))?.moved();
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
    // A file that opens in Source is put there by finishDocumentOpen, at this byte.
    if (defaultModeForPath(path) === 'source') return;
    // A place kept in Source is a line, not a fraction of a block: its block, at the top (S-08-0001).
    const position = stored.mode === 'source' ? { ...stored, fraction: 0, mode: 'rendered' as const } : stored;
    view.restore(position);
    view.landOn(stored.byteOffset);
  }

  /**
   * Read and render `file` through the `render` mark; cold-start paint runs after this (MARXY-183).
   * A large document's idle chunks wait for `start` (A-02), so nothing is appended before first text.
   */
  async function readAndShow(file: string, at: number | undefined, start: Promise<unknown>): Promise<RenderEvidence> {
    const bytes = await shell.readFile(file);
    await config.applyOnce(document.documentElement);
    let lands = at;
    if (lands === undefined) {
      const stored = persistence.storedFor(file, bytes.length);
      if (stored) lands = stored.byteOffset;
    }
    landing = lands;
    teardownDocument();
    clearDismissForPath(file);
    await shell.mark('file_read', Date.now(), `bytes=${bytes.length}`);
    // The open transition (ADR-0037): the store copies the bytes, parses them once and starts an empty
    // history with `disk` as read. The page renders from its snapshot and follows it from here on.
    const opened = openDocumentStore(
      {
        writeFileAtomic: (path, written) => shell.writeFileAtomic(path, written),
        recordRead: shell.recordRead ? (path, read) => shell.recordRead?.(path, read) : undefined,
      },
      file,
      bytes,
    );
    current = opened;
    await shell.mark('parsed', Date.now());
    // A different document starts with no notices (blocked.ts no longer clears the rest on every render).
    clearNotices();
    // The view renders from the store's snapshot and follows it from here on (B-13).
    const evidence = await view.show(opened, {
      at: lands,
      start,
      onMounted: () => {
        for (const follow of [...followers]) follow(opened);
      },
    });
    document.title = `${file.split('/').pop()} — Marxy`;
    return evidence;
  }

  /**
   * After the first screens: typeset, the stored place (`firstOpen`: the launch's document, whose
   * positions.json is read only now, after first text), deferred start-up and the user theme at idle,
   * the mode, the watch and the title.
   */
  async function finishDocumentOpen(file: string, opts: { at?: number; firstOpen?: boolean } = {}): Promise<void> {
    if (opts.firstOpen) await persistence.ensureLoaded(dirname(file));
    await view.typeset();
    if (opts.firstOpen) await restorePersistedPosition();
    const deferred = view.deferredWork(file);
    await whenIdle(async () => {
      await deferred();
      indexing = index.ensureFor(file, current?.snapshot().buffer.bytes);
      void indexing;
      await config.startUserTheme();
    });
    await shell.mark('position_restored', Date.now());
    if (defaultModeForPath(file) === 'source') {
      await view.showSource(opts.at ?? landing ?? 0);
    } else {
      view.showRenderedChrome();
    }
    await config.offerThemeDocument(file);
    if (current) await watches.watch(current);
    await refreshTitle();
  }

  async function openReplacing(file: string, at?: number): Promise<void> {
    if (closed) return;
    const openPath = currentPath();
    if (openPath && file !== openPath) await persistence.flushReading();
    if (file === openPath && view.document() && at !== undefined) {
      // A heading in the document already on screen: move, do not read and set it again.
      if (view.mode === 'source') await view.leaveSource();
      view.landOn(at);
      return;
    }
    const chunks = gate();
    try {
      await readAndShow(file, at, chunks.promise);
      chunks.release();
      persistence.trackOpen(file, () => index.rootFor(file));
      await finishDocumentOpen(file, { at });
    } catch (e) {
      chunks.release();
      // Nothing of the last document may outlive the page that showed it.
      teardownDocument();
      deps.selection()?.afterRender();
      view.showRenderedChrome();
      // A read error names the path, and a path is not markup.
      const message = document.createElement('p');
      message.textContent = String(e);
      doc.replaceChildren(message);
    }
  }

  function open(file: string, opts?: { at?: number }): Promise<void> {
    const run = () =>
      serially(async () => {
        // The document already on screen, asked for again with nowhere to go (a second launch, Finder, a
        // drag, the palette on the current document): reading it back from disk would drop unsaved edits.
        if (file === currentPath() && opts?.at === undefined && hasUnsavedChanges()) return;
        await openReplacing(file, opts?.at);
      });
    // Another document over unsaved edits asks first (save / discard / dismiss), as a close does. Moving
    // within the open document, or opening with nothing unsaved, goes straight through.
    if (file !== currentPath() && confirmLeaveDocument(run)) return Promise.resolve();
    return run();
  }

  /** The launch's document, through first text, then the rest of the open with its stored place. */
  async function bootDocument(file: string, after: number, chunks: ReturnType<typeof gate>): Promise<void> {
    const evidence = await readAndShow(file, undefined, chunks.promise);
    const renderedAt = Date.now();
    const outcome = await measure.waitForFirstText(doc, evidence, after, renderedAt);
    // F-17: a document with no text (only images) was not painted as text, and the measurement said so
    // with `no_text`, but it is a document: it opens like any other and ends with finish(0). F-17.1: what
    // makes it a document is its source (a byte that is not white space), not the rendered selector, which
    // misses a lone `---`, a comment, a `<div>`. Only a blank file (an empty file) still fails with finish(1).
    const hasSource = current?.snapshot().buffer.bytes.some((b) => b !== 0x20 && (b < 0x09 || b > 0x0d)) ?? false;
    const textless = outcome === 'no_text' && hasSource;
    if (outcome !== 'painted' && !textless) return measure.finish(1);
    chunks.release();
    await finishDocumentOpen(file, { firstOpen: true });
    setTimeout(() => void trust.load().then(() => trust.maybeRerenderForLateTrust()), 0);
    await indexing;
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
    try {
      return await bootDocument(file, after, chunks);
    } finally {
      chunks.release();
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
    currentPath,
    store: () => current,
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
    close() {
      closed = true;
      followers.clear();
      current?.close();
      current = null;
    },
  };
}
