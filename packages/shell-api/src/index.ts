/**
 * shell-api — reviewed contract (ADR-0010, ADR-0045): changes by pull request; a new privileged
 * capability gets an ADR; boundaries are tested by `pnpm check`. Everything privileged the UI can do,
 * as a handful of named functions. No invoke() calls anywhere else. Switching shells means
 * reimplementing this file.
 */
export interface FileStat { readonly path: string; readonly size: number; readonly mtimeMs: number; readonly isDir: boolean; }

export interface WatchEvent {
  readonly kind: 'modified' | 'created' | 'removed' | 'renamed';
  readonly path: string;
  /** For renames: the new path. Atomic write-temp-then-rename arrives as 'renamed' onto the watched path. */
  readonly to?: string;
}

export type ShellError = {
  readonly code: 'not-found' | 'permission' | 'io' | 'invalid' | 'unsupported';
  readonly message: string;
  readonly path?: string;
};

export interface Shell {
  /** Raw bytes; the buffer layer decodes and keeps the original for byte-faithful saves. */
  readFile(path: string): Promise<Uint8Array>;
  /** Atomic: write to a temp file in the same directory, fsync, rename over. Never in place. */
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  stat(path: string): Promise<FileStat | null>;
  /**
   * Directory watch, debounced by the shell; the callback receives batches. By default the folder's
   * own files (and the folders of symlinked documents in it). With `recursive`, every file in the
   * tree, never following a symlink and skipping the index's deny-listed directories; it rejects
   * when the tree is too large or the OS refuses the watch, so the caller can fall back.
   */
  watch(
    root: string,
    onEvents: (events: readonly WatchEvent[]) => void,
    opts?: { readonly recursive?: boolean },
  ): Promise<{ close(): void }>;
  /** @deprecated ADR-0026 — Files under root honouring .gitignore/.ignore and the deny list; never follows into node_modules. */
  listRoot(root: string, opts: { readonly extensions: readonly string[]; readonly limit: number }): Promise<readonly FileStat[]>;
  /** @deprecated ADR-0026 — Fuzzy match over the shell's index for this root (nucleo). Returns paths and scores. */
  fuzzy(root: string, query: string, limit: number): Promise<readonly { path: string; score: number }[]>;
  /** The nearest ancestor containing .git, or null. */
  repositoryRoot(path: string): Promise<string | null>;
  openDialog(opts: { readonly directory?: boolean; readonly multiple?: boolean }): Promise<readonly string[]>;
  revealInExternalEditor(path: string, line?: number): Promise<void>;
  clipboardWrite(data: { readonly text: string; readonly html?: string }): Promise<void>;
  /** A URL the webview may load for a local file (asset protocol), scoped to the document's directory. */
  assetUrl(path: string): string;
  /** Files handed to a running instance by the OS or a second launch (single-instance). */
  onOpenFiles(cb: (paths: readonly string[]) => void): void;
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
  /** Set the window title. A title change never moves or reveals the window controls. */
  setTitle(title: string): Promise<void>;
  /**
   * Show or hide the window's native controls (the macOS traffic lights) and size the strip they sit in.
   * `stripHeight` is in CSS px; the controls are centred in it. Resolves as a no-op where the
   * platform draws no native controls in the page's area.
   */
  setWindowControls(opts: { readonly visible: boolean; readonly stripHeight: number }): Promise<void>;
  /** Intrinsic dimensions of a local image file, or null when unknown. */
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  /** Open an http, https, or mailto URL externally; other schemes reject with code unsupported. */
  openExternal(url: string): Promise<void>;
  /** WebKitGTK version on Linux, or null on other platforms. */
  webkitVersion(): Promise<{ major: number; minor: number; micro: number } | null>;
  /** Resolved paths for app config and data directories. */
  configPaths(): Promise<{ config: string; data: string }>;
  /** Add a recursive asset-protocol scope for this session only. */
  allowAssetScope(dir: string): Promise<void>;
  /** Native save dialog; returns the chosen path or null if cancelled. */
  saveDialog(opts: { defaultPath?: string }): Promise<string | null>;
  /** Fetch a remote image through the shell and return a marxy-remote URL (ADR-0027). */
  fetchRemoteImage(url: string): Promise<string>;
  /** The window's own close was requested (the OS close box, Cmd+W, Cmd+Q); the app decides whether
   *  to let it proceed, via `confirmClose` (MARXY-49). */
  onCloseRequested(cb: () => void): void;
  /** Let a previously-requested window close proceed. */
  confirmClose(): Promise<void>;
}

/** No-op Shell used only for compile-time completeness checks (MARXY-94, ADR-0039). */
function stubShellImpl(): Shell {
  return {
    readFile: async () => new Uint8Array(),
    writeFileAtomic: async () => {},
    stat: async () => null,
    watch: async () => ({ close() {} }),
    listRoot: async () => [],
    fuzzy: async () => [],
    repositoryRoot: async () => null,
    openDialog: async () => [],
    revealInExternalEditor: async () => {},
    clipboardWrite: async () => {},
    assetUrl: () => '',
    onOpenFiles: () => {},
    platform: 'macos',
    startupMarks: async () => ({}),
    args: async () => [],
    mark: async () => {},
    quit: async () => {},
    readDir: async () => [],
    setTitle: async () => {},
    setWindowControls: async () => {},
    imageSize: async () => null,
    openExternal: async () => {},
    webkitVersion: async () => null,
    configPaths: async () => ({ config: '', data: '' }),
    allowAssetScope: async () => {},
    saveDialog: async () => null,
    fetchRemoteImage: async () => '',
    onCloseRequested: () => {},
    confirmClose: async () => {},
  };
}

function stubShellWithout<K extends keyof Shell>(omit: K): Omit<Shell, K> {
  const shell = stubShellImpl();
  const { [omit]: _removed, ...rest } = shell;
  return rest;
}

/** Compile-time check that Shell lists every ADR-0026 §2 member (MARXY-94). */
const memoryShellLike: Shell = stubShellImpl();
void memoryShellLike;

// @ts-expect-error fetchRemoteImage is required on Shell (ADR-0026 §2)
const _shellMissingFetchRemote: Shell = stubShellWithout('fetchRemoteImage');
void _shellMissingFetchRemote;

// @ts-expect-error setWindowControls is required on Shell (ADR-0038)
const _shellMissingSetWindowControls: Shell = stubShellWithout('setWindowControls');
void _shellMissingSetWindowControls;
