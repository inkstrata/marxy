// Margin notes kept beside the files, never in them: one sidecar, notes.json in Marxy's data folder,
// keyed by each file's path. Read once when first asked, written a moment after a change. A file it cannot read is left as it
// is and nothing is written over it this session. Notes follow their line through edits and outside changes (`followLines`).
// A scratch document's notes are kept in memory only, and go with it to the path a Save As gives it.
import { normalizePath } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../app-types.ts';
import { onChangesSummary, storeFor } from '../changes/state.ts';
import { isUntitled } from '../document/untitled.ts';
import { followLines, linesOf, type Note } from './anchor.ts';

const FILE = 'notes.json';
const WRITE_DELAY_MS = 400;

type NotesShell = Pick<AppHandle['shell'], 'readFile' | 'writeFileAtomic' | 'configPaths'>;

let shell: NotesShell | null = null;
let notes = new Map<string, readonly Note[]>();
let loading: Promise<void> | null = null;
/** notes.json was read, or is not there yet: only then may it be written. */
let reached = false;
let readOnly = false;
/** The lines each noted file had when its notes last followed it: what the next change is measured against. */
const seen = new Map<string, readonly string[]>();
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(path: string) => void>();

const dataFile = async (): Promise<string | null> => {
  const paths = await shell?.configPaths?.();
  return paths && paths.data !== '' ? `${paths.data.replace(/[\\/]+$/, '')}/${FILE}` : null;
};

function isNote(n: unknown): n is Note {
  if (n === null || typeof n !== 'object') return false;
  const o = n as Record<string, unknown>;
  return Number.isInteger(o.l0) && Number.isInteger(o.l1) && typeof o.key === 'string' && typeof o.text === 'string';
}

/** The notes as notes.json holds them; throws on a file that is not one. */
export function parseNotesFile(text: string): Map<string, Note[]> {
  const raw = JSON.parse(text) as { version?: unknown; files?: unknown };
  if (raw.version !== 1 || raw.files === null || typeof raw.files !== 'object') throw new Error('not a notes file');
  const out = new Map<string, Note[]>();
  for (const [path, list] of Object.entries(raw.files as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const kept = list.filter(isNote).map((n) => ({ l0: n.l0, l1: n.l1, key: n.key, text: n.text, ...(typeof n.address === 'string' ? { address: n.address } : {}) }));
    if (kept.length === 0) continue;
    // Builds before the shell spelled Windows paths with slashes kept backslash keys: two spellings of one file merge, each note once.
    const key = isUntitled(path) ? path : normalizePath(path);
    const had = out.get(key) ?? [];
    out.set(key, [...had, ...kept.filter((n) => !had.some((h) => h.key === n.key))]);
  }
  return out;
}

export function formatNotesFile(all: ReadonlyMap<string, readonly Note[]>): string {
  const files: Record<string, readonly Note[]> = {};
  for (const [path, list] of [...all].sort(([a], [b]) => a.localeCompare(b))) if (list.length > 0 && !isUntitled(path)) files[path] = list;
  return `${JSON.stringify({ version: 1, files }, null, 2)}\n`;
}

const notFound = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'not-found';

function load(): Promise<void> {
  if (!shell) return Promise.resolve();
  loading ??= (async () => {
    if (!shell) return;
    let bytes: Uint8Array;
    try {
      const file = await dataFile();
      if (!file) return;
      try {
        bytes = await shell.readFile(file);
      } catch (e) {
        if (!notFound(e)) throw e;
        reached = true;
        return;
      }
    } catch (e) {
      // Not read, and not taken for empty: the next load tries again, and nothing is written over the file meanwhile.
      loading = null;
      console.warn(`marxy: ${FILE} could not be read yet: ${String(e)}`);
      return;
    }
    reached = true;
    try {
      const read = parseNotesFile(new TextDecoder().decode(bytes));
      for (const [path, list] of read) if (!notes.has(path) && !isUntitled(path)) notes.set(path, list);
    } catch (e) {
      readOnly = true;
      console.warn(`marxy: ${FILE} could not be read, and is left as it is: ${String(e)}`);
    }
  })();
  return loading;
}

async function write(): Promise<void> {
  clearTimeout(timer);
  await load();
  const file = await dataFile().catch(() => null);
  if (!file || !shell || readOnly || !reached) return;
  try {
    await shell.writeFileAtomic(file, new TextEncoder().encode(formatNotesFile(notes)));
  } catch (e) {
    console.warn(`marxy: ${FILE} could not be written: ${String(e)}`);
  }
}

const tell = (path: string): void => {
  for (const cb of [...listeners]) cb(path);
};

export const notesFor = (path: string): readonly Note[] => notes.get(path) ?? [];

/** The notes of `path` now; they are written to the sidecar a moment later. */
export function setNotes(path: string, next: readonly Note[]): void {
  if (next.length === 0) notes.delete(path);
  else notes.set(path, next);
  if (next.length > 0 && !seen.has(path)) {
    const text = storeFor(path)?.snapshot().buffer.text;
    if (text !== undefined) seen.set(path, linesOf(text));
  }
  tell(path);
  clearTimeout(timer);
  timer = setTimeout(() => void write(), WRITE_DELAY_MS);
}

/** `cb` hears the path whose notes changed; returns the off switch. */
export function onNotes(cb: (path: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Settles once notes.json has been read. */
export const notesLoaded = (): Promise<void> => load();

/** Writes now what is waiting to be written. */
export const flushNotes = (): Promise<void> => write();

/** The notes of `path` against its text now: moved to their lines again when the text moved under them. */
function follow(path: string, movedFrom?: string): void {
  if (movedFrom !== undefined && movedFrom !== path) {
    const took = notes.get(movedFrom);
    const lines = seen.get(movedFrom);
    seen.delete(movedFrom);
    seen.delete(path);
    if (lines) seen.set(path, lines);
    if (took) {
      // The text is the moved document's: notes the target path had were on other text.
      notes.delete(movedFrom);
      tell(movedFrom);
      setNotes(path, took);
    }
  }
  const list = notes.get(path);
  const store = storeFor(path);
  if (!list || !store) {
    seen.delete(path);
    return;
  }
  const lines = linesOf(store.snapshot().buffer.text);
  const moved = followLines(list, seen.get(path) ?? null, lines);
  seen.set(path, lines);
  if (moved !== list) setNotes(path, moved);
}

export function installNotesStore(handle: AppHandle): () => void {
  shell = handle.shell;
  void load().then(() => {
    for (const path of notes.keys()) {
      follow(path);
      tell(path);
    }
  });
  return onChangesSummary(follow);
}
