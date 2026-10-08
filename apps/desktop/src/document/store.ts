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

import { createBuffer, parseMarkdown, splice, type Buffer, type Document, type Edit } from '@marxy/core';
import { buildNodeMap, type NodeMap } from '../render/post.ts';
import { leaveSourceMode } from '../source/buffer-commit.ts';

/** The privileged effects a store needs. `apps/desktop/src/shell` implements them; tests fake them. */
export interface StoreIo {
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  /** Tauri's stale-write guard (shell/tauri.ts recordRead); optional in tests. */
  recordRead?(path: string, bytes: Uint8Array): void;
}

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
  apply(input: { range: Edit['range']; replacement: string; label: string; baseVersion?: number }): Promise<boolean>;
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
   */
  reload(bytes: Uint8Array): Promise<'reloaded' | 'unchanged' | 'kept'>;
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
  readonly ast: Document;
  readonly nodeMap: NodeMap;
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
}

const encoder = new TextEncoder();

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The parse of `buffer` as `path`. Every node carries `{file, start, end}` for that path. */
function parsed(path: string, buffer: Buffer): Pick<State, 'buffer' | 'ast' | 'nodeMap'> {
  const ast = parseMarkdown(buffer.bytes, { file: path });
  return { buffer, ast, nodeMap: buildNodeMap(ast) };
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
  return Object.freeze({
    path: state.path,
    disk: state.disk,
    buffer: state.buffer,
    ast: state.ast,
    nodeMap: state.nodeMap,
    version: state.version,
    dirty: state.disk === null || !sameBytes(state.disk, state.buffer.bytes),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  });
}

/** The `open` transition: a store for `bytes` read from `path`, with an empty history. */
export function openDocumentStore(io: StoreIo, path: string, bytes: Uint8Array): DocumentStore {
  const buffer = createBuffer(path, bytes);
  let state: State = {
    path,
    disk: buffer.bytes,
    ...parsed(path, buffer),
    past: [],
    future: [],
    version: 0,
    bytesVersion: 0,
  };
  let snap = freezeSnapshot(state);
  let closed = false;
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
  const step = (edit: Edit, direction: 'forward' | 'back'): Pick<State, 'buffer' | 'ast' | 'nodeMap'> => {
    const [from, to] = direction === 'forward' ? [edit.before, edit.after] : [edit.after, edit.before];
    const range = { file: state.path, start: edit.range.start, end: edit.range.start + from.length };
    return parsed(state.path, splice(state.buffer, range, to));
  };

  const store: DocumentStore = {
    snapshot: () => snap,

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
        const after = encoder.encode(input.replacement);
        const next = splice(state.buffer, range, after);
        const before = state.buffer.bytes.slice(range.start, range.end);
        if (sameBytes(before, after)) return false;
        const edit: Edit = { range, before, after, label: input.label };
        commit({ ...state, ...parsed(state.path, next), past: pushed(state.past, edit), future: [] }, { kind: 'apply', edit });
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
          { ...state, ...parsed(state.path, left.buffer), past: pushed(state.past, edit), future: [] },
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

    reload(bytes) {
      return transition((): 'reloaded' | 'unchanged' | 'kept' => {
        if (sameBytes(bytes, state.buffer.bytes)) {
          if (state.disk === null || !sameBytes(state.disk, bytes)) {
            // Adopted: the stale-write guard now expects these bytes on disk (B-11).
            io.recordRead?.(state.path, bytes);
            commit({ ...state, disk: state.buffer.bytes }, { kind: 'reload' });
          }
          return 'unchanged';
        }
        // Our own save coming back through the watcher, after the reader edited again: not a conflict.
        if (state.disk !== null && sameBytes(bytes, state.disk)) return 'unchanged';
        // Kept, not adopted: the guard stays armed on what was read, so a save cannot overwrite the change.
        if (snap.dirty) return 'kept';
        // A clean reload is a new document: undoing across it would splice bytes the reader never saw.
        // Phase B clears it rather than mapping it through the change (ADR-0037 §3; roadmap 02-phase-b.md).
        const buffer = createBuffer(state.path, bytes);
        const next = parsed(state.path, buffer);
        io.recordRead?.(state.path, buffer.bytes);
        commit({ ...state, disk: buffer.bytes, ...next, past: [], future: [] }, { kind: 'reload' });
        return 'reloaded';
      });
    },

    save(opts) {
      return transition(async () => {
        const target = opts?.to ?? state.path;
        if (target === state.path && !snap.dirty) return { result: 'unchanged' as const };
        const from = state.path;
        const bytes = state.buffer.bytes;
        // Parse under the new name before writing, so nothing after a successful write can throw.
        const moved = target === from ? null : { path: target, ...parsed(target, renamed(state.buffer, target)) };
        try {
          await io.writeFileAtomic(target, bytes);
        } catch (error) {
          return { result: 'failed' as const, error };
        }
        // The write succeeded; the store moves in one transition, so no subscriber ever sees the old
        // path with the new disk bytes. History is untouched.
        io.recordRead?.(target, bytes);
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
      commit({ ...state }, { kind: 'close' });
      subscribers.clear();
    },

    serially,
  };

  /** The file now answers to `to`: same bytes, same disk, same history; the AST carries the new name. */
  function renameNow(to: string): void {
    const from = state.path;
    if (from === to) return;
    commit({ ...state, path: to, ...parsed(to, renamed(state.buffer, to)) }, { kind: 'rename', from, to });
  }

  return store;
}

