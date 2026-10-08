// The app's types (B-15): what a shell must offer `startApp`, and the handle it returns. Apart from
// app.ts so the composition root stays under 300 lines; app.ts re-exports them, and every module that
// imports them from there still does.
import type { Buffer, Document, Edit } from '@marxy/core';
import type { Shell } from '@marxy/shell-api';
import type { DocumentStore } from './document/store.ts';
import type { IndexService } from './index/service.ts';
import type { PaletteSession } from './palette/session.ts';
import type { NodeMap } from './render/post.ts';
import type { SaveResult } from './save.ts';
import type { RenderedSelection } from './selection/view.ts';
import type { OpenDocument } from './view/rendered-view.ts';

/** The Phase 0 shell surface: frozen Shell members tauri.ts already implements, plus startup extras. */
export type AppShell = Pick<
  Shell,
  | 'readFile'
  | 'readHead'
  | 'stat'
  | 'writeFileAtomic'
  | 'watch'
  | 'platform'
  | 'startupMarks'
  | 'readDir'
  | 'setTitle'
  | 'saveDialog'
  | 'allowAssetScope'
  | 'onCloseRequested'
  | 'confirmClose'
> & {
  args(): Promise<string[]>;
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
  /** Tauri shell only: read without arming the stale-write guard (MARXY-337). */
  peekFile?(path: string): Promise<Uint8Array>;
  recordRead?(path: string, bytes: Uint8Array): void;
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  allowAssetScope(dir: string): Promise<void>;
  assetUrl(path: string): string;
  configPaths?(): Promise<{ config: string; data: string }>;
  onOpenFiles?(cb: (paths: readonly string[]) => void): void;
};

export type { OpenDocument };
/** The open document as the app holds it: what operations resolve and splice against. */
export interface OpenDocumentState {
  readonly path: string;
  readonly buffer: Buffer;
  readonly ast: Document;
  readonly nodeMap: NodeMap;
}

/**
 * What `AppHandle.dispatch` routes to the focused view's store or view (ADR-0037 §2). An `apply` names the
 * store version its range was resolved at (`baseVersion`, required: B-12), so the store's stale-edit check always runs.
 */
export type AppAction =
  | { readonly type: 'apply'; readonly range: Edit['range']; readonly replacement: string; readonly label: string; readonly baseVersion: number }
  | { readonly type: 'undo' | 'redo' | 'toggle-mode' }
  | { readonly type: 'save'; readonly as?: boolean };

export type AppHandle = {
  readonly state: { document: OpenDocument | null };
  /**
   * A command's way to the store's transitions (ADR-0037 §2): `apply`, `undo` and `redo` reach the
   * focused view's store as the registry's commands do, `save` the explicit save, `toggle-mode` the view.
   */
  dispatch(action: AppAction): Promise<unknown>;
  commands(): readonly unknown[];
  readonly shell: AppShell;
  readonly ready: Promise<void>;
  /**
   * Opens `path` through the one open path, after any open already under way: launch, open events
   * and the palette all end here. `at` is a byte offset; the block containing it is held at the
   * reading line until the reader scrolls. `at` for the document already on screen moves to it
   * without reading the file again.
   */
  open(path: string, opts?: { at?: number }): Promise<void>;
  /** The document on screen, or null before the first one. */
  currentPath(): string | null;
  /** The folder every image and link of the document at `path` must stay inside: its repository root, else its folder (ADR-0027 §5). */
  imageRoot(path: string): string;
  /** Playwright harness: buffer fingerprint and reading position (MARXY-169). */
  sourceHarness(): {
    readonly mode: 'rendered' | 'source';
    readonly bufferHash: string;
    readonly byteOffset: number;
  } | null;
  /** Playwright harness: live typesetters and resize observers, so N opens are seen to leave one of each. */
  debugCounts(): { typesetters: number; resizeObservers: number };
  /** The open document's buffer and parse, from its store's snapshot, or null. */
  openDocument(): OpenDocumentState | null;
  /** The open document's store (ADR-0037), or null before the first document (B-11). */
  document(): DocumentStore | null;
  /**
   * The open document's explicit save (save.ts) with the deps only the app has: the fold from Source
   * and what follows a Save as. Resolves once the title shows the result (B-11).
   */
  save(opts?: { as?: boolean }): Promise<SaveResult>;
  /**
   * The open document's store subscription, seen through the app (ADR-0037): called with the document
   * on every committed transition and on each open, which moves the subscription to the new store, and
   * with null when the store closes. A page set again with the same bytes is not a change.
   */
  onDocumentChange(cb: (open: OpenDocumentState | null) => void): () => void;
  /** The Rendered selection on `#doc` (B-12): what is selected, and the open document as it resolves it. */
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
   * flush of history.json read. Before it is called there is no palette session (B-14).
   */
  setPaletteSession(session: () => PaletteSession): void;
  /** The palette index: one walk per repository root, every root opened so far published (A-04). */
  readonly index: IndexService;
  /**
   * Resolves when the open document is wholly in the article (A-02): at once for a document under the
   * progressive threshold, after the last idle chunk for a larger one.
   */
  contentComplete(): Promise<void>;
  /** Mounts, now, every block up to the one holding `byteOffset` (a link to a heading not yet shown). */
  mountThrough(byteOffset: number): void;
  /** Rendered to Source or back, as `Mod+E` does; resolves when the switch is done. */
  toggleMode(): Promise<void>;
  /**
   * Source with the line holding `byteOffset` at the reading line (Jump to source). The same Source as
   * `Mod+E`: what is typed there is saved, guarded and undoable (F-03).
   */
  jumpToSource(byteOffset: number): Promise<void>;
  /**
   * Sets the rendered page again after a change of variant or size, on the grid, with the reader on
   * the same line (A-14). Nothing to do in Source mode or with no document open.
   */
  relayout(): Promise<void>;
  /**
   * Releases everything this instance started: its open store and watch, its view, its selection, its
   * persistence listeners and its user theme. `startApp` calls it on the instance it replaces in a page.
   */
  destroy(): void;
};
