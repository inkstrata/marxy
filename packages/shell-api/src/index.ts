/**
 * shell-api — FROZEN (ADR-0010). Everything privileged the UI can do, as a handful of named
 * functions. No invoke() calls anywhere else. Switching shells means reimplementing this file.
 */
export interface FileStat { readonly path: string; readonly size: number; readonly mtimeMs: number; readonly isDir: boolean; }

export interface WatchEvent {
  readonly kind: 'modified' | 'created' | 'removed' | 'renamed';
  readonly path: string;
  /** For renames: the new path. Atomic write-temp-then-rename arrives as 'renamed' onto the watched path. */
  readonly to?: string;
}

export interface Shell {
  /** Raw bytes; the buffer layer decodes and keeps the original for byte-faithful saves. */
  readFile(path: string): Promise<Uint8Array>;
  /** Atomic: write to a temp file in the same directory, fsync, rename over. Never in place. */
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  stat(path: string): Promise<FileStat | null>;
  /** Recursive directory watch, debounced by the shell; the callback receives batches. */
  watch(root: string, onEvents: (events: readonly WatchEvent[]) => void): Promise<{ close(): void }>;
  /** Files under root honouring .gitignore/.ignore and the deny list; never follows into node_modules. */
  listRoot(root: string, opts: { readonly extensions: readonly string[]; readonly limit: number }): Promise<readonly FileStat[]>;
  /** Fuzzy match over the shell's index for this root (nucleo). Returns paths and scores. */
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
}
