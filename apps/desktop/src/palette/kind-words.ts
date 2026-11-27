// The Line names a kind in the query: "ragged pdf " is the files called ragged that are PDFs. Only a short list of words a
// reader says for a kind narrows, so that "desktop" or "data model" never drops a file; any registered extension written
// with its dot (".rs") narrows as well. Pure: no DOM.
import { FILE_TYPES, fileTypeFor, type FileViewer, type IndexEntry } from '@marxy/core';

interface Spec {
  readonly exts?: readonly string[];
  readonly viewer?: FileViewer;
  /** The reader's kind the registry gives the file. */
  readonly reads?: string;
}

const AUDIO = ['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'opus'];
const VIDEO = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'ogv'];

const entries: readonly (readonly [readonly string[], Spec])[] = [
  [['pdf'], { exts: ['pdf'] }],
  [['image', 'images', 'picture', 'pictures', 'photo', 'photos'], { viewer: 'image' }],
  [['sheet', 'sheets', 'spreadsheet', 'spreadsheets'], { viewer: 'sheet' }],
  [['csv'], { exts: ['csv'] }],
  [['xlsx'], { exts: ['xlsx'] }],
  [['log', 'logs'], { exts: ['log'], reads: 'log' }],
  [['deck', 'decks', 'slides', 'pptx'], { exts: ['pptx', 'ppt', 'odp'] }],
  [['docx'], { exts: ['docx', 'doc'] }],
  [['epub', 'epubs'], { viewer: 'book' }],
  [['mail', 'email', 'emails', 'eml', 'msg'], { viewer: 'mail' }],
  [['font', 'fonts'], { viewer: 'font' }],
  [['audio', 'music'], { exts: AUDIO }],
  [['video', 'videos'], { exts: VIDEO }],
  [['archive', 'archives'], { viewer: 'archive' }],
  [['zip'], { exts: ['zip'] }],
  [['sqlite', 'database', 'databases', 'db'], { viewer: 'sqlite' }],
  [['notebook', 'notebooks', 'ipynb'], { exts: ['ipynb'] }],
  [['markdown', 'md'], { exts: ['md', 'markdown', 'mdx'] }],
  [['json'], { exts: ['json'] }],
  [['yaml', 'yml'], { exts: ['yaml', 'yml'] }],
];

const WORDS = new Map<string, Spec>(entries.flatMap(([names, spec]) => names.map((n) => [n, spec] as const)));

let registered: ReadonlySet<string> | undefined;
const isRegisteredExtension = (ext: string): boolean => {
  registered ??= new Set(FILE_TYPES.flatMap((t) => t.match.ext ?? []));
  return registered.has(ext);
};

export interface KindWord {
  /** As typed, lower case, without the dot. */
  readonly text: string;
  /** Written with its dot: it narrows for certain, and the file's name is not looked in. */
  readonly dotted: boolean;
  readonly spec: Spec;
}

export interface KindQuery {
  readonly words: readonly KindWord[];
  /** The words left to fuzzy-match, as typed; empty when every word names a kind. */
  readonly rest: string;
  /** Some word was written `.ext`. */
  readonly explicit: boolean;
}

/**
 * The query split into the words that name a kind and the rest, or null when no word names one. A word narrows as soon as
 * it is a whole word of the list, even the one still being typed.
 */
export function kindQuery(text: string): KindQuery | null {
  const parts = text.toLowerCase().split(/\s+/).filter((w) => w !== '');
  const words: KindWord[] = [];
  const rest: string[] = [];
  parts.forEach((raw) => {
    const dotted = raw.length > 1 && raw.startsWith('.');
    const word = dotted ? raw.slice(1) : raw;
    const spec = dotted ? (isRegisteredExtension(word) ? { exts: [word] } : undefined) : WORDS.get(word);
    if (spec === undefined) rest.push(raw);
    else words.push({ text: word, dotted, spec });
  });
  const left = rest.join(' ');
  // `@` and `#` as a first character belong to the headings, not to a kind.
  if (words.length === 0 || /^[@#]/.test(left)) return null;
  return { words, rest: left, explicit: words.some((w) => w.dotted) };
}

interface Facts {
  readonly ext: string;
  readonly viewer: FileViewer;
  readonly reads: string;
  /** Whole words of the path inside its place, folders included, and of the title. */
  readonly tokens: ReadonlySet<string>;
}

const factsOf = new WeakMap<IndexEntry, Facts>();

function facts(entry: IndexEntry): Facts {
  let held = factsOf.get(entry);
  if (held === undefined) {
    const type = fileTypeFor(entry.path);
    const inside = entry.root.length > 1 && entry.path.startsWith(`${entry.root}/`) ? entry.path.slice(entry.root.length + 1) : entry.path;
    const base = entry.path.slice(entry.path.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    const tokens = new Set(`${inside} ${entry.title}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t !== ''));
    held = { ext: dot > 0 ? base.slice(dot + 1).toLowerCase() : '', viewer: type.viewer, reads: entry.readerKind ?? type.readerKind, tokens };
    factsOf.set(entry, held);
  }
  return held;
}

/**
 * Whether a file answers every kind word. A word that is also a name counts both ways: "md" keeps "md-guide.txt" as
 * well as every Markdown file, and never "cmd.ts", because only whole words of the path count; a word and its
 * plural are one word, so "log" keeps files in `logs/`.
 */
export function answersKinds(entry: IndexEntry, query: KindQuery): boolean {
  const f = facts(entry);
  return query.words.every(({ text, dotted, spec }) =>
    (spec.exts?.includes(f.ext) ?? false) || (spec.viewer !== undefined && spec.viewer === f.viewer) || (spec.reads !== undefined && spec.reads === f.reads) || (!dotted && (f.tokens.has(text) || f.tokens.has(text.endsWith('s') ? text.slice(0, -1) : `${text}s`))),
  );
}

/** The words of a kind-only query, as the fuzzy matcher takes them. */
export const kindText = (query: KindQuery): string => query.words.map((w) => w.text).join(' ');

/** A key for the files a kind query accepts: the same words, the same list. */
export const kindKey = (query: KindQuery): string => query.words.map((w) => (w.dotted ? `.${w.text}` : w.text)).join(' ');
