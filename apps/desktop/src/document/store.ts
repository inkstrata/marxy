// The document store: the one owner of an open document's bytes.
// It holds what is true of the bytes (path, disk, buffer, ast, nodeMap, history, version) and nothing
// that belongs to a view of them: no mode, no anchor, no DOM, no rendering, no notices.
//
// Every change is a named transition. A transition computes the next state in full (splice, parse,
// node map) and only then assigns it, bumps `version` and tells subscribers, so a step that throws or
// an effect that fails leaves the store exactly as it was. History follows the buffer:
// `apply` and `commitSource` push exactly one entry each, and nothing compares hashes. Nothing
// here writes except `save`; `dirty` is derived as `buffer ≠ disk`. Transitions run one at a time
// on the store's own queue.

import { codeLanguageOf, createBuffer, parseCode, parseMarkdown, parserOf, reparseMarkdown, splice, type Buffer, type Document, type Edit, type FileParser, type Kind, type ParsedText } from '@marxy/core';
import { buildNodeMap, type NodeMap } from '../render/post.ts';
import { leaveSourceMode } from '../source/buffer-commit.ts';
import { writeBeside } from './fork.ts';
import { isUntitled } from './untitled.ts';

/** The privileged effects a store needs. `apps/desktop/src/shell` implements them; tests fake them. */
export interface StoreIo {
  /**
   * With `expected`, refused (`code: 'changed'`, nothing written) when the file is no longer those bytes; a save in place passes
   * the store's `disk`, so the file is never read again to save it.
   */
  writeFileAtomic(path: string, bytes: Uint8Array, expected?: Uint8Array): Promise<void>;
  /** Tauri's stale-write guard (shell/tauri.ts recordRead); optional in tests. */
  recordRead?(path: string, bytes: Uint8Array): void;
  /**
   * Reads `path` without arming that guard: what a conflict's choice and a Save As onto another file look at. A save's
   * baseline is the store's own `disk` (what it last loaded or wrote), handed to `writeFileAtomic`, not the shell's last
   * look: Marxy's own reads and writes of a file the reader has open (a config key, `.editorconfig`, a link's target)
   * cannot move it.
   */
  peekFile?(path: string): Promise<Uint8Array>;
  /**
   * Create-only: the bytes at `path` only if nothing (a file, a folder, a link) is there, else rejects `code: 'exists'`
   * and writes nothing. A copy beside the file is written with it, never with `writeFileAtomic`, which replaces.
   */
  writeFileNew?(path: string, bytes: Uint8Array): Promise<void>;
  /**
   * Local versions: asked, and awaited, for the bytes a `save` writes over: for a save in place the store's own `disk`, once the
   * shell has accepted the write (it checks the file is still those bytes, so a refused save keeps nothing) and before the store
   * moves; for a Save As onto a file that is there, the bytes read from the target, before the write. Either way it is done
   * before the save resolves, so a quit right after the save cannot lose it. It does not reject, and the save does not
   * wait on its success: a copy that could not be made is the hook's to say.
   */
  beforeOverwrite?(path: string, replacing: Uint8Array): Promise<void>;
  /** The store for `path` closed: what an io holds for it can go (document/encoding.ts). */
  closed?(path: string): void;
}

/** How a changed-on-disk conflict ended. 'none': there was nothing pending; nothing was done. */
export type ConflictResolution =
  | { readonly result: 'none' }
  /** The disk's bytes are now the buffer; with `copy`, the reader's buffer is at that new path first. */
  | { readonly result: 'resolved'; readonly copy?: string }
  /** Nothing changed, the conflict is still pending. */
  | { readonly result: 'failed'; readonly error: unknown };

/** One immutable reading of the store. `version` says whether a held snapshot is stale. */
export interface DocumentSnapshot {
  readonly path: string;
  /** The bytes last read or written; null for an untitled buffer. */
  readonly disk: Uint8Array | null;
  readonly buffer: Buffer;
  readonly ast: Document;
  readonly nodeMap: NodeMap;
  /** +1 on every committed transition. */
  readonly version: number;
  /** Derived: `disk === null` or the buffer's bytes differ from it. */
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /**
   * The bytes the last `reload` replaced: what Marxy had loaded when another program rewrote the file under a
   * clean buffer. View state, held in memory only: never written, never persisted, null until a reload
   * adopts a change, and dropped with the store on `close`. A reload kept over unsaved edits sets nothing.
   */
  readonly previousDisk: Uint8Array | null;
}

/** What a committed change was. `undo` and `redo` carry the history entry they stepped over. */
export type Transition =
  | { readonly kind: 'open' }
  /** `appended`: how many bytes the file gained, spliced at the old end (`append`); unset for a whole new read. */
  | { readonly kind: 'reload'; readonly appended?: number }
  | { readonly kind: 'apply'; readonly edit: Edit }
  | { readonly kind: 'commitSource'; readonly edit: Edit }
  | { readonly kind: 'undo'; readonly edit: Edit }
  | { readonly kind: 'redo'; readonly edit: Edit }
  /** `renamedFrom` is set when the save went to another path: `path` and `disk` moved together. */
  | { readonly kind: 'save'; readonly path: string; readonly renamedFrom?: string }
  | { readonly kind: 'rename'; readonly from: string; readonly to: string }
  /** The kind the reader chose changed how the bytes parse (`rechoose`): same bytes, a new AST. */
  | { readonly kind: 'reparse' }
  | { readonly kind: 'close' };

export interface DocumentStore {
  snapshot(): DocumentSnapshot;
  /**
   * Whether the current bytes have been parsed. A store opened with `lazy` parses them when `snapshot().ast`
   * or `.nodeMap` is first read (a file that opens in Source needs no AST until Rendered is asked for); any
   * other store has always parsed.
   */
  parsed(): boolean;
  /**
   * A parse of exactly `bytes`, the store's own current bytes, made elsewhere (in slices, behind a page that did not need
   * it): taken as the store's parse when it has not made one yet. False, and nothing changes, when the store has parsed
   * already or holds other bytes now.
   */
  takeParse(bytes: Uint8Array, made: Preparsed): boolean;
  /**
   * The current bytes as text with the store's own parse of them, for a transform or Copy as to reuse instead of
   * parsing the same bytes again; one pair per buffer version, made on the first ask and held until the bytes
   * change (a new array: `bytesVersion`). Null, and the caller parses for itself, when the pair would not be exactly
   * what the caller reads: the bytes have not been parsed yet (a lazy store: asking never forces the parse), they are
   * not valid UTF-8 (the text is not the bytes), or the text has a byte-order mark or a CR (a transform reads LF text
   * without the mark, and the parse's offsets are for the bytes), or the file is a code file: its AST is one code
   * block per slice of the bytes (`astOf`), not a Markdown parse of the text, and a transform reads the text as
   * Markdown. The parse is the store's, made with the standard parse options and nothing else (`ParsedText`), so it
   * is what `parseMarkdown(bytes)` gives. Pure: it changes nothing.
   */
  textParse(): ParsedText | null;
  /** Called after every committed transition. A subscriber that throws is logged and skipped. */
  subscribe(cb: (snap: DocumentSnapshot, change: Transition) => void): () => void;
  /**
   * An operation's splice; one history entry. Never writes. Resolves false, with the store untouched,
   * when the replacement equals the bytes it replaces (a no-op) or when `baseVersion` is given and the
   * bytes have changed since that version by the time this edit's turn comes: the range was resolved
   * against a snapshot another view's edit has since replaced. A
   * transition that leaves the bytes alone (a save, a rename) does not make a range stale. Omit `baseVersion` to
   * apply against whatever the buffer is at that turn. A range outside the buffer or cutting a UTF-8
   * code point rejects with `splice`'s RangeError, also with the store untouched.
   */
  apply(input: { range: Edit['range']; replacement: string | Uint8Array; label: string; baseVersion?: number }): Promise<boolean>;
  /**
   * Leaving Source: one history entry, labelled `edit in Source`. Never writes. Resolves false when
   * nothing changed, or on a stale `baseVersion` (as for `apply`).
   *
   * `opts.refuse` is asked, synchronously, at the turn the fold would commit (as `reload`'s `holds`), after every
   * transition queued before it has run: a view whose text was made ready before another view's fold landed
   * answers true, and the store is untouched. A fold diffs its text against the buffer at its turn, so a text
   * prepared against the bytes before that fold would write the other view's change out.
   *
   * `docText` must use the file's own line separator, as the editor does when it sets `lineSeparator`
   * from `buffer.eol` (no BOM: see `cmDocText`). Core's `foldText` converts LF to CRLF only for an
   * all-CRLF file; on a mixed-ending file, LF-normalised text is a real difference at every CRLF line
   * between the first and last change, and those endings are rewritten (pinned in store.test.ts).
   */
  commitSource(docText: string, opts?: { baseVersion?: number; refuse?: () => boolean }): Promise<boolean>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  /**
   * New bytes from disk. 'unchanged' when they equal the buffer (`disk` follows) or equal `disk` (the
   * watcher's echo of our own save, even if the buffer has been edited since: no conflict). 'kept'
   * only for a real external change while the buffer is dirty: nothing changes. Otherwise
   * 'reloaded', and history is cleared.
   *
   * `opts.holds` is asked, synchronously, at the turn the change would commit and never before it: a view
   * of this store holding text the store cannot see (Source typed and not yet folded in, in any pane that
   * shows it) answers true, and the change is 'kept' as for a dirty buffer. Asked at the commit and not
   * earlier, so a key typed while the transition waited in the queue cannot slip between the question and
   * the answer. Nothing is recorded as read, so the stale-write guard stays on the bytes the text came from.
   *
   * `opts.readAt` is `writes()` as it was just before the bytes were read. A read taken before the store's latest write
   * reaches the queue after it, and is older than the file: 'unchanged', and nothing is done. Adopted, it would put the
   * buffer and `disk` back to before that save while the file holds the save, and the next save would be refused. A real
   * outside change after the write is heard and read again, at the current count.
   *
   * The new bytes are reparsed from the store's own parse: only the blocks the change touched are
   * parsed again (`reparseMarkdown`).
   */
  reload(bytes: Uint8Array, opts?: { holds?: () => boolean; readAt?: number }): Promise<'reloaded' | 'unchanged' | 'kept'>;
  /**
   * The bytes a file gained at its end, spliced onto the buffer at the old end: `from` is how long the buffer was when they
   * were read for. 'stale', and nothing changes, when the caller must read the whole file instead: the buffer is not `from`
   * bytes now, holds unsaved edits (or a view's Source text does), or a save of ours wrote after `readAt`. History is cleared
   * and the guard armed on the new bytes, as for `reload`. `previousDisk` is the old bytes unless `keepReplaced` is false: a
   * big log that grows all day would hold two copies of itself.
   */
  append(tail: Uint8Array, opts: { from: number; holds?: () => boolean; readAt?: number; keepReplaced?: boolean; spliced?: (bytes: Uint8Array) => void }): Promise<'reloaded' | 'stale'>;
  /** How many times this store has written its file (a save, a Save As): taken before a read, it is that read's `readAt`. */
  writes(): number;
  /**
   * The bytes of the real external change a `reload` kept (the reader has unsaved edits), or null. It is
   * the store's, so every view of the store sees the one pending choice. A later external change
   * replaces it; the disk coming back to the bytes the buffer came from, or the buffer's own, clears it.
   * Holding it writes nothing and changes no snapshot: a save still refuses (the stale-write guard).
   */
  conflict(): Uint8Array | null;
  /**
   * The reader's choice over a pending conflict, made explicitly and never by default. 'mine' writes
   * the buffer, byte for byte (the io writes it in the file's own encoding), to a NEW file beside the original (`name (mine).ext`, then `(mine 2)`; an
   * existing path is never written over) and then, like 'theirs', adopts what is on disk now: it becomes
   * the buffer and `disk`, history is cleared as a reload does, and the guard is armed on it. 'theirs'
   * discards the unsaved edits: the caller folds unfolded Source text in first, so they count. A failed
   * copy leaves the buffer and the pending conflict as they were.
   */
  resolveConflict(choice: 'mine' | 'theirs'): Promise<ConflictResolution>;
  save(opts?: { to?: string }): Promise<{ result: 'saved' | 'unchanged' | 'failed'; error?: unknown }>;
  /**
   * The file now answers to `to`. History is kept; its entries keep the `range.file` they were made
   * under, and undo/redo splice the current path regardless.
   */
  rename(to: string): Promise<void>;
  /**
   * The kind the file is read as is now `chosen`: one the reader chose (Show as, a rule), or a log, a session or a patch
   * found from a plain-text file's shape. Show as is the file's, not a pane's: a store shared by two panes is parsed again
   * under it when that changes how the bytes parse (plain text read as a prose kind is Markdown, as a log is the log's code), one `reparse` transition with history kept, and every view of it follows. Resolves whether it parsed again.
   */
  rechoose(chosen: Kind | undefined): Promise<boolean>;
  /**
   * Synchronous and outside the queue: it marks the store closed and tells subscribers at once. A
   * transition already running (an in-flight save) still finishes and commits; one still waiting in
   * the queue rejects when its turn comes. What the io holds for the file (`closed`: its encoding) is let go
   * only after them, so a save under way still writes in the file's encoding.
   */
  close(): void;
  /** Runs `fn` once every transition running or queued now is done: at once when there is none. */
  whenSettled(fn: () => void): void;
  /**
   * One queue per store: transitions never interleave. Every mutator above already runs
   * on it; `fn` must not await one of them, or it waits for itself.
   */
  serially<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Undo depth: a long session cannot grow the undo stack without limit.
 */
export const HISTORY_DEPTH = 100;

interface State {
  readonly path: string;
  /** Never null yet: the `null` branches below are for a future `openUntitled`. */
  readonly disk: Uint8Array | null;
  readonly buffer: Buffer;
  /** The parse of `buffer`: made at once, or when first read for a store opened lazily (see `openDocumentStore`). */
  readonly tree: Tree;
  /**
   * The version of the last transition that changed the bytes: a range read at or after it still holds.
   * `commit` decides "changed" by reference, `next.buffer.bytes !== state.buffer.bytes`, not by content,
   * so this depends on one invariant: every transition that changes the bytes makes a new Uint8Array
   * (`splice`, `createBuffer`), and every one that does not keeps the very same array (`save`, `rename`
   * and an unchanged `reload` spread `state` or rename the buffer around its bytes). A bytes-changing
   * transition that edited the array in place would leave `bytesVersion` behind, and a stale range
   * would pass `baseVersion`. Never mutate `buffer.bytes`; store.test.ts pins both halves.
   */
  readonly bytesVersion: number;
  /** Oldest first. Plain arrays rather than `History`: it moves its stacks before the splice succeeds. */
  readonly past: readonly Edit[];
  readonly future: readonly Edit[];
  readonly version: number;
  /** See `DocumentSnapshot.previousDisk`. */
  readonly previousDisk: Uint8Array | null;
}

const encoder = new TextEncoder();

/** A parse of a buffer: its AST and the node map over it. */
interface Tree {
  /** Reads (the first time, makes) the parse. */
  get(): { readonly ast: Document; readonly nodeMap: NodeMap };
  /** Whether the parse has been made. */
  readonly made: boolean;
  /** A lazy parse not made yet takes `made` as its parse; false, and nothing changes, once it has one. */
  offer?(made: { readonly ast: Document; readonly nodeMap: NodeMap }): boolean;
}

/** A parse made now. */
function treeOf(ast: Document, nodeMap: NodeMap): Tree {
  const made = { ast, nodeMap };
  return { get: () => made, made: true };
}

/** A parse made when first read, once; `onMade` hears of it. */
function lazyTree(make: () => { readonly ast: Document; readonly nodeMap: NodeMap }, onMade: () => void): Tree {
  let value: ReturnType<typeof make> | null = null;
  return {
    get() {
      if (value === null) {
        value = make();
        onMade();
      }
      return value;
    },
    get made() {
      return value !== null;
    },
    offer(made) {
      if (value !== null) return false;
      value = made;
      onMade();
      return true;
    },
  };
}

/** `notes.md` as `notes (mine).md`, `notes (mine 2).md`...; a name with no extension, or a dotfile, takes the tag last. */
export function conflictCopyPath(path: string, n: number): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dir = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  return `${dir}${stem} (${n === 1 ? 'mine' : `mine ${n}`})${ext}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** How `path` is parsed (the registry); `chosen` is the kind it is read as (`DocumentStore.rechoose`). A scratch document is Markdown. */
export function parserOfPath(path: string, chosen?: Kind): FileParser {
  return isUntitled(path) ? 'markdown' : parserOf(path, chosen);
}

/** How `path` is parsed as `chosen`, and in what language: a `.txt` read as a log and as a session are both code, in two. */
const parseOf = (path: string, chosen?: Kind): string => {
  const parser = parserOfPath(path, chosen);
  return parser === 'code' ? `code:${codeLanguageOf(path, chosen) ?? ''}` : parser;
};

/**
 * The AST for `bytes` as `path`: Markdown only when the registry says Markdown, or the reader chose to read plain text
 * as a prose kind (`chosen`); code and plain text are code blocks over all of the bytes, plain text with no language.
 */
export function astOf(path: string, bytes: Uint8Array, chosen?: Kind, buffer?: Pick<Buffer, 'bytes' | 'text' | 'offsets'>): Document {
  const parser = parserOfPath(path, chosen);
  // The buffer's own decode of these bytes, when it is theirs: the parse keeps it rather than a second text and table.
  const decoded = buffer?.bytes === bytes ? buffer : undefined;
  if (parser === 'markdown') return parseMarkdown(bytes, { file: path }, decoded);
  return parseCode(bytes, parser === 'code' ? { file: path, lang: codeLanguageOf(path, chosen) } : { file: path }, decoded);
}

/**
 * `astOf(path, after)`, from the parse of `before` when the file is Markdown; a code file is parsed whole, which is one
 * pass, keeping `buffer`'s decode of `after` when given.
 */
export function reparsedAst(
  path: string,
  previous: Document,
  before: Uint8Array,
  after: Uint8Array,
  chosen?: Kind,
  buffer?: Pick<Buffer, 'bytes' | 'text' | 'offsets'>,
): Document {
  return parserOfPath(path, chosen) === 'markdown' ? reparseMarkdown(previous, before, after, { file: path }) : astOf(path, after, chosen, buffer);
}

/**
 * The parse of `buffer` as `path`, made now; or, for a store opened lazily whose parse nobody has read yet
 * (`lazy`), made when first read. Every node carries `{file, start, end}` for that path.
 */
function parsed(path: string, buffer: Buffer, made?: Preparsed, lazy?: { readonly onMade: () => void }, chosen?: Kind): Pick<State, 'buffer' | 'tree'> {
  if (made) return { buffer, tree: treeOf(made.ast, made.nodeMap) };
  if (lazy) {
    return {
      buffer,
      tree: lazyTree(() => {
        const ast = astOf(path, buffer.bytes, chosen, buffer);
        return { ast, nodeMap: buildNodeMap(ast) };
      }, lazy.onMade),
    };
  }
  const ast = astOf(path, buffer.bytes, chosen, buffer);
  return { buffer, tree: treeOf(ast, buildNodeMap(ast)) };
}

const strictDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * `ast`, the parse of `bytes`, with their text: what a transform reads when it is run on the whole file.
 * Null unless the text is exactly the bytes (valid UTF-8 that encodes back to them), has no byte-order mark and no
 * CR, so the pair is one the transform registry and Copy as would accept; they check the text again themselves.
 */
function textPairOf(bytes: Uint8Array, ast: Document): ParsedText | null {
  let text: string;
  try {
    text = strictDecoder.decode(bytes);
  } catch {
    return null;
  }
  if (text.includes('\r') || text.startsWith('\ufeff')) return null;
  return { text, doc: ast };
}

/** `buffer` answering to `path`: same bytes and tables, a new name. */
function renamed(buffer: Buffer, path: string): Buffer {
  return buffer.path === path ? buffer : { ...buffer, path };
}

function pushed(past: readonly Edit[], edit: Edit): readonly Edit[] {
  const next = [...past, edit];
  return next.length > HISTORY_DEPTH ? next.slice(next.length - HISTORY_DEPTH) : next;
}

function freezeSnapshot(state: State): DocumentSnapshot {
  const { tree } = state;
  return Object.freeze({
    path: state.path,
    disk: state.disk,
    buffer: state.buffer,
    // Read through the state's parse, which a store opened lazily makes the first time it is asked for.
    get ast() {
      return tree.get().ast;
    },
    get nodeMap() {
      return tree.get().nodeMap;
    },
    version: state.version,
    dirty: state.disk === null || !sameBytes(state.disk, state.buffer.bytes),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    previousDisk: state.previousDisk,
  });
}

/** A parse of a document's bytes and its node map, made by a caller that built them in slices. */
export interface Preparsed {
  readonly ast: Document;
  readonly nodeMap: NodeMap;
}

/**
 * The `open` transition for a scratch document: a store for `bytes` that came from no file, under a
 * scratch `path` (`untitled.ts`). `disk` is what the document was born with, so `dirty` reads "changed since
 * it was opened" and a scratch the reader only read closes without a question. Nothing is written until a
 * `save` to another path, which makes it an ordinary document: `disk` and the stale-write guard follow.
 */
export function openUntitledStore(io: StoreIo, path: string, bytes: Uint8Array): DocumentStore {
  if (!isUntitled(path)) throw new Error(`${path} is not a scratch path`);
  return openDocumentStore(io, path, bytes);
}

/**
 * The `open` transition: a store for `bytes` read from `path`, with an empty history. `preparsed` is the
 * parse of exactly these bytes as `path` when the caller made it in slices (`parseMarkdownChunked`);
 * without it the store parses them here, all at once.
 */
export function openDocumentStore(
  io: StoreIo,
  path: string,
  bytes: Uint8Array,
  preparsed?: Preparsed,
  opts?: { readonly lazy?: boolean; readonly chosen?: Kind },
): DocumentStore {
  let chosen = opts?.chosen;
  const buffer = createBuffer(path, bytes);
  // Lazy until the AST is first read; from then on the store parses at once, as every store does.
  let lazy: { readonly onMade: () => void } | undefined = opts?.lazy && !preparsed ? { onMade: () => { lazy = undefined; } } : undefined;
  const parse = (at: string, from: Buffer): Pick<State, 'buffer' | 'tree'> => parsed(at, from, undefined, lazy, chosen);

  /**
   * `parse` of `from`, the buffer after a change to the one in `state`: only the blocks the change touched are
   * parsed again, from the parse the store holds. A parse nobody has read yet is not made for it.
   */
  const reparse = (from: Buffer): Pick<State, 'buffer' | 'tree'> => {
    if (!state.tree.made) return parse(state.path, from);
    const ast = reparsedAst(state.path, state.tree.get().ast, state.buffer.bytes, from.bytes, chosen, from);
    return { buffer: from, tree: treeOf(ast, buildNodeMap(ast)) };
  };
  let state: State = {
    path,
    disk: buffer.bytes,
    ...(lazy ? parse(path, buffer) : parsed(path, buffer, preparsed, undefined, chosen)),
    past: [],
    future: [],
    version: 0,
    bytesVersion: 0,
    previousDisk: null,
  };
  let snap = freezeSnapshot(state);
  let closed = false;
  /** The disk's bytes a reload refused to adopt over the reader's edits: the pending choice. */
  let pending: Uint8Array | null = null;
  /** See `writes()`. */
  let written = 0;
  let queue: Promise<unknown> = Promise.resolve();
  /** Transitions running or waiting on `queue`. */
  let queued = 0;
  /** `textParse`'s pair for the bytes it was made for: replaced when the bytes are another array, so never one of an older version. */
  let heldPair: { readonly bytes: Uint8Array; readonly ast: Document; readonly pair: ParsedText | null } | null = null;
  const subscribers = new Set<(snap: DocumentSnapshot, change: Transition) => void>();

  const commit = (next: Omit<State, 'version' | 'bytesVersion'>, change: Transition): void => {
    const version = state.version + 1;
    state = { ...next, version, bytesVersion: next.buffer.bytes === state.buffer.bytes ? state.bytesVersion : version };
    // The pair held for older bytes is let go at once, so a 1 MB text is not kept for a buffer that no longer exists.
    if (heldPair !== null && heldPair.bytes !== state.buffer.bytes) heldPair = null;
    snap = freezeSnapshot(state);
    for (const cb of [...subscribers]) {
      try {
        cb(snap, change);
      } catch (e) {
        console.warn('marxy: a document store subscriber threw; the change stands', e);
      }
    }
  };

  const serially = <T>(fn: () => Promise<T>): Promise<T> => {
    queued++;
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined).then(() => {
      queued--;
    });
    return run;
  };

  const whenSettled = (fn: () => void): void => {
    if (queued === 0) fn();
    else void serially(async () => fn()).catch((e) => console.warn('marxy: a step after a document store closed failed', e));
  };

  /** True when the bytes changed after the caller's snapshot version: its ranges are stale. */
  const stale = (baseVersion: number | undefined): boolean => baseVersion !== undefined && baseVersion < state.bytesVersion;

  /** A mutator's body, on the queue, refused once the store is closed. */
  const transition = <T>(fn: () => T | Promise<T>): Promise<T> =>
    serially(async () => {
      if (closed) throw new Error(`document store for ${state.path} is closed`);
      return fn();
    });

  /** Splice `edit` (or its inverse) into the buffer and parse it, without touching `state`. */
  const step = (edit: Edit, direction: 'forward' | 'back'): Pick<State, 'buffer' | 'tree'> => {
    const [from, to] = direction === 'forward' ? [edit.before, edit.after] : [edit.after, edit.before];
    const range = { file: state.path, start: edit.range.start, end: edit.range.start + from.length };
    return reparse(splice(state.buffer, range, to));
  };

  const store: DocumentStore = {
    snapshot: () => snap,

    parsed: () => state.tree.made,
    // A parse made in slices is taken only for the bytes it read, and never by a store closed while it was made.
    takeParse: (bytes, made) => !closed && state.buffer.bytes === bytes && (state.tree.offer?.(made) ?? false),
    textParse() {
      if (!state.tree.made || parserOfPath(state.path, chosen) !== 'markdown') return null;
      const bytes = state.buffer.bytes;
      const ast = state.tree.get().ast;
      // The pair is for these bytes and this very parse: a rename re-parses the same bytes, so the bytes alone are not the key.
      if (heldPair?.bytes !== bytes || heldPair.ast !== ast) heldPair = { bytes, ast, pair: textPairOf(bytes, ast) };
      return heldPair.pair;
    },

    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    apply(input) {
      return transition(() => {
        if (stale(input.baseVersion)) return false;
        const range = { file: state.path, start: input.range.start, end: input.range.end };
        const after = typeof input.replacement === 'string' ? encoder.encode(input.replacement) : input.replacement;
        const next = splice(state.buffer, range, after);
        const before = state.buffer.bytes.slice(range.start, range.end);
        if (sameBytes(before, after)) return false;
        const edit: Edit = { range, before, after, label: input.label };
        commit({ ...state, ...reparse(next), past: pushed(state.past, edit), future: [] }, { kind: 'apply', edit });
        return true;
      });
    },

    commitSource(docText, opts) {
      return transition(() => {
        if (stale(opts?.baseVersion) || opts?.refuse?.()) return false;
        const left = leaveSourceMode(state.buffer, docText);
        if (!left.changed || !left.edit) return false;
        const edit = left.edit;
        commit(
          { ...state, ...reparse(left.buffer), past: pushed(state.past, edit), future: [] },
          { kind: 'commitSource', edit },
        );
        return true;
      });
    },

    undo() {
      return transition(() => {
        const edit = state.past.at(-1);
        if (!edit) return false;
        const next = step(edit, 'back');
        commit({ ...state, ...next, past: state.past.slice(0, -1), future: [...state.future, edit] }, { kind: 'undo', edit });
        return true;
      });
    },

    redo() {
      return transition(() => {
        const edit = state.future.at(-1);
        if (!edit) return false;
        const next = step(edit, 'forward');
        commit({ ...state, ...next, past: [...state.past, edit], future: state.future.slice(0, -1) }, { kind: 'redo', edit });
        return true;
      });
    },

    reload(bytes, opts) {
      return transition((): 'reloaded' | 'unchanged' | 'kept' => {
        // A scratch document has no file to change under it.
        if (isUntitled(state.path)) return 'kept';
        if (opts?.readAt !== undefined && opts.readAt < written) return 'unchanged';
        if (sameBytes(bytes, state.buffer.bytes)) {
          pending = null;
          if (state.disk === null || !sameBytes(state.disk, bytes)) {
            // Adopted: the stale-write guard now expects these bytes on disk.
            io.recordRead?.(state.path, bytes);
            commit({ ...state, disk: state.buffer.bytes }, { kind: 'reload' });
          }
          return 'unchanged';
        }
        // Our own save coming back through the watcher, after the reader edited again: not a conflict.
        if (state.disk !== null && sameBytes(bytes, state.disk)) {
          pending = null; // the file is what the buffer came from again: nothing to choose
          return 'unchanged';
        }
        // Kept, not adopted: the guard stays armed on what was read, so a save cannot overwrite the change.
        // The bytes are remembered for the reader's choice; a copy, so the caller's array may be reused.
        if (snap.dirty || opts?.holds?.()) {
          if (pending === null || !sameBytes(pending, bytes)) pending = bytes.slice();
          return 'kept';
        }
        // The buffer is clean here, so it is exactly what was on disk: the version the reader was reading.
        adopt(bytes, state.buffer.bytes);
        return 'reloaded';
      });
    },

    append(tail, opts) {
      return transition((): 'reloaded' | 'stale' => {
        if (isUntitled(state.path) || tail.length === 0) return 'stale';
        if (opts.readAt !== undefined && opts.readAt < written) return 'stale';
        if (state.buffer.bytes.length !== opts.from || snap.dirty || opts.holds?.()) return 'stale';
        const end = opts.from;
        const buffer = splice(state.buffer, { file: state.path, start: end, end }, tail);
        // Told before views hear of the change, so what is known of the old bytes can be carried to the new ones.
        opts.spliced?.(buffer.bytes);
        adopt(buffer.bytes, opts.keepReplaced === false ? null : state.buffer.bytes, { buffer, appended: tail.length });
        return 'reloaded';
      });
    },

    conflict: () => pending,
    writes: () => written,

    resolveConflict(choice) {
      return transition(async (): Promise<ConflictResolution> => {
        if (pending === null) return { result: 'none' };
        // What is on disk now, if it can be read: the choice is about the file as it is, not as it was when
        // the conflict was noticed. A file that cannot be read is taken as the bytes that were refused.
        let theirs = pending;
        let gone = false;
        if (io.peekFile) {
          try {
            theirs = await io.peekFile(state.path);
          } catch {
            // Gone or unreadable: the held bytes are stale, never "theirs". Nothing is adopted.
            gone = true;
          }
        }
        if (gone) {
          if (choice === 'theirs') {
            return { result: 'failed', error: new Error('The file is no longer on disk, so there is no version to take.') };
          }
          // A copy of the buffer is still safe to make; the buffer stays, and saving it would recreate the file.
          const copy = await writeCopy();
          if (typeof copy !== 'string') return copy;
          pending = null;
          return { result: 'resolved', copy };
        }
        let copy: string | undefined;
        if (choice === 'mine' && !sameBytes(state.buffer.bytes, theirs)) {
          const made = await writeCopy();
          if (typeof made !== 'string') return made;
          copy = made;
        }
        adopt(theirs);
        return copy === undefined ? { result: 'resolved' } : { result: 'resolved', copy };
      });
    },

    save(opts) {
      return transition(async () => {
        const target = opts?.to ?? state.path;
        // A scratch document has no file: writing "to" its own name would make one in the working
        // directory. The first write is a Save As to a path the reader picked.
        if (isUntitled(target)) {
          return { result: 'failed' as const, error: new Error('this document is not saved yet; use Save As to choose where it goes') };
        }
        if (target === state.path && !snap.dirty) return { result: 'unchanged' as const };
        const from = state.path;
        const bytes = state.buffer.bytes;
        // What this write replaces, kept as a local version: the file's own `disk` in place, or whatever a Save As finds at the name
        // the reader chose. The hook is the recorder's, awaited so that closing right after the save finds it done.
        const keep = async (replacing: Uint8Array | null): Promise<void> => {
          if (!io.beforeOverwrite || replacing === null || sameBytes(replacing, bytes)) return;
          try {
            await io.beforeOverwrite(target, replacing);
          } catch (error) {
            console.warn('marxy: the copy before a save was not made', error);
          }
        };
        // A Save As onto a file that is there keeps it before the write: those bytes are on disk only.
        if (target !== from && io.beforeOverwrite && io.peekFile) {
          let replacing: Uint8Array | null = null;
          try {
            replacing = await io.peekFile(target);
          } catch {
            // Nothing there to replace, or unreadable: the write itself will say why.
          }
          await keep(replacing);
        }
        // Parse under the new name before writing, so nothing after a successful write can throw.
        const moved = target === from ? null : { path: target, ...parse(target, renamed(state.buffer, target)) };
        try {
          // The baseline is `disk`, the bytes this store last loaded or wrote: the shell refuses the write if the file is no longer
          // them (another program wrote it, or Marxy did for something else), checking just before it replaces the file.
          await io.writeFileAtomic(target, bytes, target === from && state.disk !== null ? state.disk : undefined);
        } catch (error) {
          return { result: 'failed' as const, error };
        }
        // In place, the bytes replaced are `disk`, held here: kept once the shell has found them still on disk and replaced them,
        // so a refused save keeps no version of bytes nothing replaced. The store moves only after, as before.
        if (target === from) await keep(state.disk);
        written++;
        // The write succeeded; the store moves in one transition, so no subscriber ever sees the old
        // path with the new disk bytes. History is untouched.
        io.recordRead?.(target, bytes);
        // Saved under a new name: the old file's pending change is not this document's any more.
        if (moved) pending = null;
        if (moved) commit({ ...state, ...moved, disk: bytes }, { kind: 'save', path: target, renamedFrom: from });
        else commit({ ...state, disk: bytes }, { kind: 'save', path: target });
        return { result: 'saved' as const };
      });
    },

    rename(to) {
      return transition(() => {
        renameNow(to);
      });
    },

    rechoose(next) {
      return transition(() => {
        if (next === chosen) return false;
        const before = parseOf(state.path, chosen);
        chosen = next;
        if (parseOf(state.path, chosen) === before) return false;
        commit({ ...state, ...parse(state.path, state.buffer) }, { kind: 'reparse' });
        return true;
      });
    },

    close() {
      if (closed) return;
      closed = true;
      commit({ ...state, previousDisk: null }, { kind: 'close' });
      subscribers.clear();
      whenSettled(() => io.closed?.(state.path));
    },

    serially,
    whenSettled,
  };

  /** The buffer, byte for byte, at the first free `(mine)` name beside the file: its path, or the failure. Never over anything: each name is a create-only write. */
  async function writeCopy(): Promise<string | { readonly result: 'failed'; readonly error: unknown }> {
    const writeFileNew = io.writeFileNew;
    if (!writeFileNew) return { result: 'failed', error: new Error('cannot write a copy without a create-only write, which could replace a file') };
    const from = state.path;
    const made = await writeBeside({ writeFileNew }, (n) => conflictCopyPath(from, n), state.buffer.bytes, { max: 999, what: 'copy names' });
    return made.result === 'written' ? made.path : { result: 'failed', error: made.error };
  }

  /**
   * `bytes`, read from disk, become the buffer and `disk`. A new document: undoing across it would splice
   * bytes the reader never saw, so history is cleared rather than mapped through the change.
   * The guard is armed on them, and any pending conflict is over.
   */
  function adopt(bytes: Uint8Array, replaced: Uint8Array | null = null, made?: { readonly buffer: Buffer; readonly appended: number }): void {
    pending = null;
    if (sameBytes(bytes, state.buffer.bytes)) {
      io.recordRead?.(state.path, bytes);
      commit({ ...state, disk: state.buffer.bytes }, { kind: 'reload' });
      return;
    }
    const buffer = made?.buffer ?? createBuffer(state.path, bytes);
    // Only the blocks the change touched are parsed again, from the parse the store holds; a parse nobody has
    // read yet is not made for it (the new one is made when read, from the bytes).
    const tree: Tree = state.tree.made
      ? (() => {
          const ast = reparsedAst(state.path, state.tree.get().ast, state.buffer.bytes, buffer.bytes, chosen, buffer);
          return treeOf(ast, buildNodeMap(ast));
        })()
      : parse(state.path, buffer).tree;
    io.recordRead?.(state.path, buffer.bytes);
    commit(
      { ...state, disk: buffer.bytes, buffer, tree, past: [], future: [], previousDisk: replaced },
      made ? { kind: 'reload', appended: made.appended } : { kind: 'reload' },
    );
  }

  /**
   * The file now answers to `to`: same bytes, same disk, same history; the AST carries the new name. The
   * stale-write guard follows it: it is armed on `to` with the bytes last read or written, so a save
   * is refused if the file at the new name is not what the buffer came from (another program wrote it before
   * it was renamed, or after), instead of writing over it unguarded because the new name was never read.
   */
  function renameNow(to: string): void {
    const from = state.path;
    if (from === to) return;
    if (state.disk !== null) io.recordRead?.(to, state.disk);
    commit({ ...state, path: to, ...parse(to, renamed(state.buffer, to)) }, { kind: 'rename', from, to });
  }

  return store;
}

