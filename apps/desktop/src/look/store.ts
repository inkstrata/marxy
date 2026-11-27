// The reader's looks for the window: the state the look engine resolves from, read from and
// written to the settings folder beside config.toml, as other settings are. `look.toml` holds which look, how night is
// decided, lean back, the rules' switches, rules and changes of the reader's own; `looks/<id>.look.toml` holds each look of
// their own in the form they can read. Until look.toml says looks are on, the theme config.toml names paints the page as
// it always has, and nothing here touches it.
import {
  LOOKS_DIR,
  LOOK_STATE_FILE,
  defaultLookState,
  fromFile,
  layOver,
  lookFileError,
  lookFileName,
  lookFileOn,
  removedLookFile,
  stateFromToml,
  stateToToml,
  toFile,
  type Look,
  type LookState,
} from '@marxy/theme';
import { dirname, joinPath } from '@marxy/core/src/index-model/paths.ts';
import { failureText, readOrMissing } from '@marxy/core/src/util/read-or-missing.ts';
import type { AppShell } from '../app-types.ts';
import { notify, type NoticeInput } from '../notices/index.ts';
import { noteWritten } from '../theme/written.ts';

type Shell = Pick<AppShell, 'readFile' | 'writeFileAtomic' | 'readDir'> & Partial<Pick<AppShell, 'configPaths'>>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** A burst of changes (a dial dragged) is written once, this long after the last. */
const WRITE_AFTER_MS = 400;

let state: LookState = defaultLookState();
let on = false;
let loaded = false;
let shell: Shell | null = null;
let dir = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
/** Looks of the reader's own whose file has not been written since they changed. */
const dirtyMine = new Set<string>();
const removedMine = new Set<string>();
/** A change shown but not yet in the state (the Studio's dial, committed a moment after it moves). */
let held: (() => void) | null = null;
/** A change not yet written: a quit flushes, and with nothing changed it writes no look.toml at all. */
let unwritten = false;
/** look.toml was there but not read (not TOML, unreadable, or naming a look whose file did not read): never written over. */
let unreadable = false;
/** Changes made before look.toml was read: laid over what it says once it is, never replaced by it. */
let early: { readonly base: LookState; next: LookState; on: boolean } | null = null;

export const lookState = (): LookState => state;
/** Whether the looks paint the page now. */
export const looksOn = (): boolean => on;
export const looksLoaded = (): boolean => loaded;

export function onLookChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function changed(): void {
  for (const cb of [...listeners]) cb();
}

/**
 * The state becomes `next`, and the looks paint the page (a change made through a look is a choice of looks). Written
 * a moment later; `mine` names a look of the reader's own whose file is to be written again.
 */
export function setLookState(next: LookState, opts: { readonly mine?: string; readonly removed?: string; readonly on?: boolean } = {}): void {
  if (!loaded) early = { base: early?.base ?? state, next, on: opts.on ?? true };
  state = next;
  on = opts.on ?? true;
  if (opts.mine) {
    dirtyMine.add(opts.mine);
    removedMine.delete(opts.mine);
  }
  if (opts.removed) {
    removedMine.add(opts.removed);
    dirtyMine.delete(opts.removed);
  }
  changed();
  schedule();
}

/** The theme config.toml names paints the page again; the looks are kept for when they are wanted. */
export function turnLooksOff(): void {
  if (!on) return;
  on = false;
  if (early) early.on = false;
  changed();
  schedule();
}

function schedule(): void {
  unwritten = true;
  if (shell === null || dir === '') return;
  clearTimeout(timer);
  timer = setTimeout(() => void flushLooks(), WRITE_AFTER_MS);
}

async function write(path: string, text: string): Promise<void> {
  const s = shell!;
  const before = await s.readFile(path).catch(() => new Uint8Array());
  const after = encoder.encode(text);
  await s.writeFileAtomic(path, after);
  noteWritten(path, before, after);
}

/** The Studio's commit, run before a flush so a quit keeps the dial it just moved; null lets it go. */
export function holdLookChange(commit: (() => void) | null): void {
  held = commit;
}

/** Writes what has changed now, rather than a moment from now. */
export function flushLooks(): Promise<void> {
  held?.();
  clearTimeout(timer);
  timer = undefined;
  if (shell === null || dir === '' || !unwritten) return pending;
  unwritten = false;
  const snapshot = state;
  const wasOn = on;
  const mine = [...dirtyMine];
  const removed = [...removedMine];
  dirtyMine.clear();
  removedMine.clear();
  pending = pending.then(async () => {
    try {
      for (const id of mine) {
        if (snapshot.mine.some((m) => m.id === id)) await write(joinPath(joinPath(dir, LOOKS_DIR), lookFileName(id)), toFile(snapshot, id));
      }
      for (const id of removed) await write(joinPath(joinPath(dir, LOOKS_DIR), lookFileName(id)), removedLookFile(id));
      if (!unreadable) await write(joinPath(dir, LOOK_STATE_FILE), stateToToml(snapshot, wasOn));
    } catch (e) {
      notify({ kind: 'error', text: `${LOOK_STATE_FILE} could not be written · ${e instanceof Error ? e.message : String(e)} · the look is in force until Marxy closes` });
    }
  });
  return pending;
}

/**
 * Reads look.toml and the reader's own looks from the settings folder. Missing, it is a new state, and looks stay off.
 * There and unreadable (or naming an own look whose file is), it is never written this session, and `say` tells once.
 */
export async function loadLooks(from: Shell, say: (n: NoticeInput) => unknown = notify): Promise<void> {
  shell = from;
  try {
    const paths = from.configPaths ? await from.configPaths() : null;
    dir = paths ? dirname(paths.config) : '';
  } catch {
    dir = '';
  }
  const mine: Look[] = [];
  /** Own looks whose file is there but did not read or parse: look.toml's word on them is kept as written. */
  const broken = new Map<string, string>();
  let text: string | null = null;
  let error: string | null = null;
  if (dir !== '') {
    try {
      for (const stat of await from.readDir(joinPath(dir, LOOKS_DIR))) {
        const name = stat.path.slice(stat.path.lastIndexOf('/') + 1);
        if (stat.isDir || !name.endsWith('.look.toml')) continue;
        const id = name.slice(0, -'.look.toml'.length);
        const read = await readOrMissing(() => from.readFile(stat.path));
        if (read.kind === 'failed') broken.set(id, `${LOOKS_DIR}/${name} could not be read · ${failureText(read.error)}`);
        if (read.kind !== 'bytes') continue;
        const body = decoder.decode(read.bytes);
        const look = fromFile(id, body);
        if (look) mine.push(look);
        else if (lookFileError(body) !== null) broken.set(id, `${LOOKS_DIR}/${name} could not be read · ${lookFileError(body)}`);
      }
    } catch {
      /* no looks folder yet */
    }
    const read = await readOrMissing(() => from.readFile(joinPath(dir, LOOK_STATE_FILE)));
    if (read.kind === 'bytes') text = decoder.decode(read.bytes);
    else if (read.kind === 'failed') error = `${LOOK_STATE_FILE} could not be read · ${failureText(read.error)}`;
  }
  if (text !== null) {
    const parseError = lookFileError(text);
    if (parseError !== null) error = `${LOOK_STATE_FILE} could not be read · ${parseError}`;
    // Read without a look it names, the state would fall back to the default look and drop that look's tweaks on the next
    // write. Any mention counts: keeping a file that did not need keeping costs nothing.
    else for (const [id, why] of broken) if (text.includes(id)) error ??= why;
  }
  unreadable = error !== null;
  if (error !== null) say({ kind: 'error', text: `${error} · the theme paints the page, and ${LOOK_STATE_FILE} is not written over until it reads` });
  state = text === null ? { ...defaultLookState(), mine } : stateFromToml(text, mine);
  on = text !== null && lookFileOn(text);
  loaded = true;
  if (early) {
    state = layOver(state, early.base, early.next);
    on = early.on;
    early = null;
    schedule();
  }
  changed();
}

/** The settings folder the looks are kept in, for a page that says where ('' when there is none). */
export const looksFolder = (): string => dir;
