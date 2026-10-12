// The document store: the one owner of an open document's bytes (ADR-0037 as amended, Amendment 1).
// It holds what is true of the bytes (path, disk, buffer, ast, nodeMap, history, version) and nothing
// that belongs to a view of them: no mode, no anchor, no DOM, no rendering, no notices.
//
// Every change is a named transition. A transition computes the next state in full (splice, parse,
// node map) and only then assigns it, bumps `version` and tells subscribers, so a step that throws or
// an effect that fails leaves the store exactly as it was (ADR-0037 §4). History follows the buffer:
// `apply` and `commitSource` push exactly one entry each, and nothing compares hashes (§3). Nothing
// here writes except `save`; `dirty` is derived as `buffer ≠ disk` (§5). Transitions run one at a time
// on the store's own queue (§2).

import { createBuffer, parseMarkdown, reparseMarkdown, splice, type Buffer, type Document, type Edit } from '@marxy/core';
import { buildNodeMap, type NodeMap } from '../render/post.ts';
import { leaveSourceMode } from '../source/buffer-commit.ts';
import { isUntitled } from './untitled.ts';

/** The privileged effects a store needs. `apps/desktop/src/shell` implements them; tests fake them. */
export interface StoreIo {
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  /** Tauri's stale-write guard (shell/tauri.ts recordRead); optional in tests. */
  recordRead?(path: string, bytes: Uint8Array): void;
  /**
   * Reads `path` without arming that guard. A save compares disk with the store's own `disk` through it, so
   * the baseline is the store's (what it last loaded or wrote), not the shell's last look: Marxy's own reads
   * and writes of a file the reader has open (a config key, `.editorconfig`, a link's target) cannot move it.
   */
  peekFile?(path: string): Promise<Uint8Array>;
  /** Whether anything (a file, a folder, a link) is at `path`: a copy is never written over one (V-07). */
  exists?(path: string): Promise<boolean>;
}

/** How a changed-on-disk conflict ended (V-07). 'none': there was nothing pending; nothing was done. */
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
   * clean buffer (E-17). View state, held in memory only: never written, never persisted, null until a reload
   * adopts a change, and dropped with the store on `close`. A reload kept over unsaved edits sets nothing.
   */
  readonly previousDisk: Uint8Array | null;
}

/** What a committed change was. `undo` and `redo` carry the history entry they stepped over. */
export type Transition =
  | { readonly kind: 'open' }
  | { readonly kind: 'reload' }
  | { readonly kind: 'apply'; readonly edit: Edit }
  | { readonly kind: 'commitSource'; readonly edit: Edit }
  | { readonly kind: 'undo'; readonly edit: Edit }
  | { readonly kind: 'redo'; readonly edit: Edit }
  /** `renamedFrom` is set when the save went to another path: `path` and `disk` moved together. */
  | { readonly kind: 'save'; readonly path: string; readonly renamedFrom?: string }
  | { readonly kind: 'rename'; readonly from: string; readonly to: string }
  | { readonly kind: 'close' };

export interface DocumentStore {
  snapshot(): DocumentSnapshot;
  /**
   * Whether the current bytes have been parsed. A store opened with `lazy` parses them when `snapshot().ast`
   * or `.nodeMap` is first read (a file that opens in Source needs no AST until Rendered is asked for); any
   * other store has always parsed.
   */
  parsed(): boolean;
  /** Called after every committed transition. A subscriber that throws is logged and skipped. */
  subscribe(cb: (snap: DocumentSnapshot, change: Transition) => void): () => void;
  /**
   * An operation's splice; one history entry. Never writes. Resolves false, with the store untouched,
   * when the replacement equals the bytes it replaces (a no-op) or when `baseVersion` is given and the
   * bytes have changed since that version by the time this edit's turn comes: the range was resolved
   * against a snapshot another view's edit has since replaced (ADR-0037 Amendment 1, point 3). A
   * transition that leaves the bytes alone (a save, a rename) does not make a range stale. Omit `baseVersion` to
   * apply against whatever the buffer is at that turn. A range outside the buffer or cutting a UTF-8
   * code point rejects with `splice`'s RangeError, also with the store untouched.
   */
  apply(input: { range: Edit['range']; replacement: string | Uint8Array; label: string; baseVersion?: number }): Promise<boolean>;
  /**
   * Leaving Source: one history entry, labelled `edit in Source`. Never writes. Resolves false when
   * nothing changed, or on a stale `baseVersion` (as for `apply`).
   *
   * `docText` must use the file's own line separator, as the editor does when it sets `lineSeparator`
   * from `buffer.eol` (no BOM: see `cmDocText`). Core's `foldText` converts LF to CRLF only for an
   * all-CRLF file; on a mixed-ending file, LF-normalised text is a real difference at every CRLF line
   * between the first and last change, and those endings are rewritten (pinned in store.test.ts).
   */
  commitSource(docText: string, opts?: { baseVersion?: number }): Promise<boolean>;
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
   * The new bytes are reparsed from the store's own parse: only the blocks the change touched are
   * parsed again (B-23, `reparseMarkdown`).
   */
  reload(bytes: Uint8Array, opts?: { holds?: () => boolean }): Promise<'reloaded' | 'unchanged' | 'kept'>;
  /**
   * The bytes of the real external change a `reload` kept (the reader has unsaved edits), or null. It is
   * the store's, so every view of the store sees the one pending choice (D-10). A later external change
   * replaces it; the disk coming back to the bytes the buffer came from, or the buffer's own, clears it.
   * Holding it writes nothing and changes no snapshot: a save still refuses (the stale-write guard).
   */
  conflict(): Uint8Array | null;
  /**
   * The reader's choice over a pending conflict (V-07), made explicitly and never by default. 'mine' writes
   * the buffer, byte for byte, to a NEW file beside the original (`name (mine).ext`, then `(mine 2)`; an
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
   * Synchronous and outside the queue: it marks the store closed and tells subscribers at once. A
   * transition already running (an in-flight save) still finishes and commits; one still waiting in
   * the queue rejects when its turn comes.
   */
  close(): void;
  /**
   * One queue per store: transitions never interleave (ADR-0037 §2). Every mutator above already runs
   * on it; `fn` must not await one of them, or it waits for itself.
   */
  serially<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Undo depth. Mirrors `DEPTH` in packages/core/src/buffer/history.ts (not exported), so the store and
 * core's `History` bound a session the same way (ADR-0004).
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
  /** Reads (and, the first time, makes) the parse. */
  get(): { readonly ast: Document; readonly nodeMap: NodeMap };
  /** Whether the parse has been made. */
  readonly made: boolean;
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

/**
 * The parse of `buffer` as `path`, made now; or, for a store opened lazily whose parse nobody has read yet
 * (`lazy`), made when first read. Every node carries `{file, start, end}` for that path.
 */
function parsed(path: string, buffer: Buffer, made?: Preparsed, lazy?: { readonly onMade: () => void }): Pick<State, 'buffer' | 'tree'> {
  if (made) return { buffer, tree: treeOf(made.ast, made.nodeMap) };
  if (lazy) {
    return {
      buffer,
      tree: lazyTree(() => {
        const ast = parseMarkdown(buffer.bytes, { file: path });
        return { ast, nodeMap: buildNodeMap(ast) };
      }, lazy.onMade),
    };
  }
  const ast = parseMarkdown(buffer.bytes, { file: path });
  return { buffer, tree: treeOf(ast, buildNodeMap(ast)) };
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

/** A parse of a document's bytes and its node map, made by a caller that built them in slices (D-15). */
export interface Preparsed {
  readonly ast: Document;
  readonly nodeMap: NodeMap;
}

/**
 * The `open` transition for a scratch document (E-13): a store for `bytes` that came from no file, under a
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
 * parse of exactly these bytes as `path` when the caller made it in slices (`parseMarkdownChunked`, D-15);
 * without it the store parses them here, all at once.
 */
export function openDocumentStore(
  io: StoreIo,
  path: string,
  bytes: Uint8Array,
  preparsed?: Preparsed,
  opts?: { readonly lazy?: boolean },
): DocumentStore {
  const buffer = createBuffer(path, bytes);
  // Lazy until the AST is first read; from then on the store parses at once, as every store does.
  let lazy: { readonly onMade: () => void } | undefined = opts?.lazy && !preparsed ? { onMade: () => { lazy = undefined; } } : undefined;
  const parse = (at: string, from: Buffer): Pick<State, 'buffer' | 'tree'> => parsed(at, from, undefined, lazy);
  let state: State = {
    path,
    disk: buffer.bytes,
    ...(lazy ? parse(path, buffer) : parsed(path, buffer, preparsed)),
    past: [],
    future: [],
    version: 0,
    bytesVersion: 0,
    previousDisk: null,
  };
  let snap = freezeSnapshot(state);
  let closed = false;
  /** The disk's bytes a reload refused to adopt over the reader's edits: the pending choice (V-07). */
  let pending: Uint8Array | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const subscribers = new Set<(snap: DocumentSnapshot, change: Transition) => void>();

  const commit = (next: Omit<State, 'version' | 'bytesVersion'>, change: Transition): void => {
    const version = state.version + 1;
    state = { ...next, version, bytesVersion: next.buffer.bytes === state.buffer.bytes ? state.bytesVersion : version };
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
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
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
    return parse(state.path, splice(state.buffer, range, to));
  };

  const store: DocumentStore = {
    snapshot: () => snap,

    parsed: () => state.tree.made,

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
        commit({ ...state, ...parse(state.path, next), past: pushed(state.past, edit), future: [] }, { kind: 'apply', edit });
        return true;
      });
    },

    commitSource(docText, opts) {
      return transition(() => {
        if (stale(opts?.baseVersion)) return false;
        const left = leaveSourceMode(state.buffer, docText);
        if (!left.changed || !left.edit) return false;
        const edit = left.edit;
        commit(
          { ...state, ...parse(state.path, left.buffer), past: pushed(state.past, edit), future: [] },
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
        // A scratch document has no file to change under it (E-13).
        if (isUntitled(state.path)) return 'kept';
        if (sameBytes(bytes, state.buffer.bytes)) {
          pending = null;
          if (state.disk === null || !sameBytes(state.disk, bytes)) {
            // Adopted: the stale-write guard now expects these bytes on disk (B-11).
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
        // The bytes are remembered for the reader's choice (V-07); a copy, so the caller's array may be reused.
        if (snap.dirty || opts?.holds?.()) {
          if (pending === null || !sameBytes(pending, bytes)) pending = bytes.slice();
          return 'kept';
        }
        // The buffer is clean here, so it is exactly what was on disk: the version the reader was reading.
        adopt(bytes, state.buffer.bytes);
        return 'reloaded';
      });
    },

    conflict: () => pending,

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
        // A scratch document has no file (E-13): writing "to" its own name would make one in the working
        // directory. The first write is a Save As to a path the reader picked.
        if (isUntitled(target)) {
          return { result: 'failed' as const, error: new Error('this document is not saved yet; use Save As to choose where it goes') };
        }
        if (target === state.path && !snap.dirty) return { result: 'unchanged' as const };
        const from = state.path;
        const bytes = state.buffer.bytes;
        // The baseline is `disk`, the bytes this store last loaded or wrote: if the file is no longer them,
        // another program wrote it (or Marxy did, for something else) and a save would overwrite that.
        if (target === from && state.disk !== null && io.peekFile) {
          let onDisk: Uint8Array | null = null;
          try {
            onDisk = await io.peekFile(target);
          } catch {
            // Gone, or unreadable: nothing there to overwrite, or the write itself will say why.
          }
          if (onDisk !== null && !sameBytes(onDisk, state.disk)) {
            return { result: 'failed' as const, error: new Error(`${target}: changed on disk since it was opened; refusing to overwrite`) };
          }
        }
        // Parse under the new name before writing, so nothing after a successful write can throw.
        const moved = target === from ? null : { path: target, ...parse(target, renamed(state.buffer, target)) };
        try {
          await io.writeFileAtomic(target, bytes);
        } catch (error) {
          return { result: 'failed' as const, error };
        }
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

    close() {
      if (closed) return;
      closed = true;
      commit({ ...state, previousDisk: null }, { kind: 'close' });
      subscribers.clear();
    },

    serially,
  };

  /** The buffer, byte for byte, at the first free `(mine)` name beside the file: its path, or the failure. Never over a file. */
  async function writeCopy(): Promise<string | { readonly result: 'failed'; readonly error: unknown }> {
    if (!io.exists) return { result: 'failed', error: new Error('cannot tell whether a copy would overwrite a file') };
    try {
      for (let n = 1; n <= 999; n++) {
        const candidate = conflictCopyPath(state.path, n);
        if (await io.exists(candidate)) continue;
        await io.writeFileAtomic(candidate, state.buffer.bytes);
        return candidate;
      }
      throw new Error('no free name for a copy');
    } catch (error) {
      return { result: 'failed', error };
    }
  }

  /**
   * `bytes`, read from disk, become the buffer and `disk`. A new document: undoing across it would splice
   * bytes the reader never saw, so history is cleared rather than mapped through the change (ADR-0037 §3).
   * The guard is armed on them, and any pending conflict is over.
   */
  function adopt(bytes: Uint8Array, replaced: Uint8Array | null = null): void {
    pending = null;
    if (sameBytes(bytes, state.buffer.bytes)) {
      io.recordRead?.(state.path, bytes);
      commit({ ...state, disk: state.buffer.bytes }, { kind: 'reload' });
      return;
    }
    const buffer = createBuffer(state.path, bytes);
    // Only the blocks the change touched are parsed again, from the parse the store holds; a parse nobody has
    // read yet is not made for it (the new one is made when read, from the bytes).
    const tree: Tree = state.tree.made
      ? (() => {
          const ast = reparseMarkdown(state.tree.get().ast, state.buffer.bytes, buffer.bytes, { file: state.path });
          return treeOf(ast, buildNodeMap(ast));
        })()
      : parse(state.path, buffer).tree;
    io.recordRead?.(state.path, buffer.bytes);
    commit(
      { ...state, disk: buffer.bytes, buffer, tree, past: [], future: [], previousDisk: replaced },
      { kind: 'reload' },
    );
  }

  /**
   * The file now answers to `to`: same bytes, same disk, same history; the AST carries the new name. The
   * stale-write guard follows it (D-10): it is armed on `to` with the bytes last read or written, so a save
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

