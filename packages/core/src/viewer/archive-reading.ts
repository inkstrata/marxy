// What an archive's entry reads as: the reading the app would give that file on disk, found the same way
// (the name's row, then the head's magic and text test, then `contentTypeFor`), said as the row's words. Pure: the head
// comes from the shell's `readArchiveHeads`; before it arrives an entry reads by its name.
import { detectKind } from '../kind/detect.ts';
import { contentTypeFor, fileTypeForExtension, nameTypeOf, type FileTypeRow } from '../kind/registry.ts';
import { extensionOf, magicOf, textTest } from './bytes.ts';

/** How much of an entry is asked for to read it. */
export const READING_HEAD_BYTES = 4096;

export interface EntryReading {
  /** What it reads as, as the list says it: "Markdown", "an image", "a Windows program". */
  readonly label: string;
  /** Its kind of reading for Metadata's count ("Pictures", "Code", "No reading"). */
  readonly group: string;
  /** The registry row it reads as; null when none does (bytes no row names). */
  readonly row: string | null;
  /** Found from its first bytes, not from its name alone. */
  readonly fromBytes: boolean;
  /** The bytes say other than the name: `ext` is what the name says. */
  readonly disagrees: boolean;
  readonly ext: string;
  /** Drawn as itself in the plan: a picture the webview draws from bytes. */
  readonly picture: boolean;
  readonly encrypted: boolean;
}

/** Magic formats as detection names them (`detect.rs`, the memory shell's FORMAT_WORDS), to the row's extension. */
const FORMAT_EXT: Readonly<Record<string, string>> = {
  PNG: 'png', JPEG: 'jpg', GIF: 'gif', WebP: 'webp', HEIC: 'heic', AVIF: 'avif', BMP: 'bmp', ICO: 'ico', TIFF: 'tif', 'JPEG XL': 'jxl', QOI: 'qoi',
  OpenEXR: 'exr', PDF: 'pdf', 'a zip archive': 'zip', gzip: 'gz', 'a 7z archive': '7z', 'a Windows program': 'exe', 'an SQLite database': 'sqlite',
  'a font': 'ttf', 'a WOFF font': 'woff', 'a WOFF2 font': 'woff2', 'a font collection': 'ttc', 'WAV audio': 'wav', 'an MP4 container': 'mp4', 'QuickTime video': 'mov',
  'MP3 audio': 'mp3', 'Matroska or WebM video': 'mkv', 'a program (ELF)': 'elf', 'a macOS program': 'dylib', WebAssembly: 'wasm', Ogg: 'ogg', 'FLAC audio': 'flac',
  Photoshop: 'psd',
};

/** Pictures the webview draws from bytes, by the format their magic names. */
const DRAWN = new Set(['PNG', 'JPEG', 'GIF', 'WebP', 'BMP', 'ICO', 'AVIF']);

const ROW_LABEL: Readonly<Record<string, string>> = {
  markdown: 'Markdown', mdx: 'Markdown', quarto: 'Markdown', 'r-markdown': 'Markdown', 'markdown-alias': 'Markdown', 'markdown-name': 'Markdown',
  text: 'plain text', 'text-readme': 'plain text', 'text-changelog': 'a changelog', 'text-notes': 'notes', 'text-article': 'plain text',
  log: 'a log', diff: 'a patch', terminal: 'a terminal session', json: 'a tree', toml: 'a tree', yaml: 'a tree', xml: 'a tree', jsonl: 'records',
  csv: 'a table', ipynb: 'a notebook', eml: 'a mail message', svg: 'an SVG drawing', html: 'a web page', 'theme-css': 'a theme file',
  'theme-toml': 'a theme file', image: 'an image', audio: 'a recording', video: 'a recording', midi: 'MIDI notes',
  archive: 'an archive', 'archive-other': 'an archive', font: 'a font', 'font-other': 'a font', pdf: 'a PDF', program: 'a Windows program or library', executable: 'a program or a library',
  office: 'an office document', spreadsheet: 'a workbook', database: 'a database', shellscript: 'a shell script', dotenv: 'settings',
  book: 'a book',
};

/** Language names, by the row's grammar, where the id is not the word. */
const LANG_NAME: Readonly<Record<string, string>> = {
  typescript: 'TypeScript', tsx: 'TypeScript', javascript: 'JavaScript', jsx: 'JavaScript', rust: 'Rust', python: 'Python', go: 'Go', java: 'Java',
  kotlin: 'Kotlin', c: 'C', cpp: 'C++', ruby: 'Ruby', php: 'PHP', swift: 'Swift', sql: 'SQL', graphql: 'GraphQL', lua: 'Lua', r: 'R', elixir: 'Elixir',
  haskell: 'Haskell', css: 'CSS', scss: 'SCSS', csharp: 'C#', powershell: 'PowerShell', zig: 'Zig', dart: 'Dart', ini: 'settings (INI)', bat: 'a batch file',
  docker: 'a Dockerfile', make: 'a makefile',
};

const GROUP: Readonly<Record<string, string>> = {
  image: 'Pictures', svg: 'Pictures', audio: 'Sound and film', video: 'Sound and film', midi: 'Sound and film',
  archive: 'Containers', 'archive-other': 'Containers', font: 'Fonts', 'font-other': 'Fonts', pdf: 'Pages', html: 'Pages', office: 'Pages', ipynb: 'Pages', book: 'Pages',
  eml: 'Mail', log: 'Logs', terminal: 'Logs', diff: 'Patches', json: 'Data', toml: 'Data', yaml: 'Data', xml: 'Data', jsonl: 'Data', csv: 'Data',
  spreadsheet: 'Data', database: 'Data', program: 'No reading', executable: 'No reading',
};

/** The words for what `row` reads as. */
export function rowLabel(row: FileTypeRow): string {
  const own = ROW_LABEL[row.id];
  if (own) return own;
  if (row.kind === 'markdown') return 'Markdown';
  if (row.kind === 'text') return 'plain text';
  if (row.kind === 'binary') return 'bytes';
  const lang = row.lang ?? row.id;
  return LANG_NAME[lang] ?? LANG_NAME[row.id] ?? `code (${lang})`;
}

function rowGroup(row: FileTypeRow): string {
  const own = GROUP[row.id];
  if (own) return own;
  if (row.kind === 'markdown' || row.kind === 'text') return 'Prose';
  if (row.kind === 'binary') return 'No reading';
  if (row.reading === 'tree' || row.reading === 'records' || row.reading === 'table') return 'Data';
  return 'Code';
}

const of = (row: FileTypeRow | null, ext: string, more: Partial<EntryReading> = {}): EntryReading => ({
  label: row ? rowLabel(row) : 'no reading',
  group: row ? rowGroup(row) : 'No reading',
  row: row?.id ?? null,
  fromBytes: false,
  disagrees: false,
  ext,
  picture: row?.id === 'svg',
  encrypted: false,
  ...more,
});

/** An encrypted entry: nothing of it is read. */
export const ENCRYPTED_READING: EntryReading = {
  label: 'encrypted', group: 'Encrypted', row: null, fromBytes: false, disagrees: false, ext: '', picture: false, encrypted: true,
};

/** Rows whose files are another format's container: a workbook, an office file or a jar is a zip; m4a and mp4 one box. */
const ZIP_BASED = new Set(['spreadsheet', 'office', 'office-document', 'archive', 'archive-other', 'book']);
const SOUND = new Set(['audio', 'video']);
function agrees(named: FileTypeRow, byFormat: FileTypeRow): boolean {
  if (named.id === byFormat.id) return true;
  if (byFormat.id === 'archive' && ZIP_BASED.has(named.id)) return true;
  return SOUND.has(named.id) && SOUND.has(byFormat.id);
}

/** What `path` reads as by its name alone, as a row does before its head arrives. */
export function readingByName(path: string): EntryReading {
  const named = nameTypeOf(path) ?? null;
  const ext = extensionOf(path);
  // An image's name is a picture only once its bytes agree; an SVG is drawn from its text.
  return of(named, ext, { label: named ? rowLabel(named) : ext ? 'no reading' : 'text, set as written', group: named ? rowGroup(named) : 'No reading' });
}

/**
 * What `path` reads as from its first bytes: the magic a format has, or the text test, decides; the name's row says the
 * rest. A head whose bytes name another format than the name does (an MZ program called `.jpg`), or text under a binary
 * name, or bytes under a text name, disagrees.
 */
export function readingOfHead(path: string, head: Uint8Array): EntryReading {
  const named = nameTypeOf(path) ?? null;
  const ext = extensionOf(path);
  if (head.length === 0) return of(named, ext, { label: 'empty', fromBytes: true });
  const magic = magicOf(head);
  const t = textTest(head.subarray(0, 8192));
  const binary = magic !== null || t.nul > 0;
  if (binary) {
    const fext = magic ? FORMAT_EXT[magic.format] : undefined;
    const byFormat = fext ? (fileTypeForExtension(fext) ?? null) : null;
    const nameBinary = named?.kind === 'binary' ? named : null;
    const agree = nameBinary !== null && (byFormat === null ? magic === null : agrees(nameBinary, byFormat));
    const row = agree ? nameBinary : byFormat;
    const disagrees = named !== null && !agree && (magic !== null || named.kind !== 'binary');
    // A program, or bytes no row reads, is said by its magic as it begins: "a Windows program", "a GPT disk".
    // Bytes with no magic under a program's name are not known to be one.
    const program = row?.id === 'executable' || row?.id === 'program';
    const label = magic && (row === null || program) ? magic.format : row && !program ? rowLabel(row) : 'no reading';
    const picture = row?.id === 'image' && magic !== null && DRAWN.has(magic.format);
    return of(row, ext, { label, group: row ? rowGroup(row) : 'No reading', fromBytes: true, disagrees, picture });
  }
  // Text: a binary name over text bytes is text no row names (`contentTypeFor`), and says so.
  const shebang = /^#!\s*(?:\/usr\/bin\/env\s+)?(?:\S*\/)?(\S+)/.exec(new TextDecoder().decode(head.subarray(0, 128)))?.[1];
  const row = contentTypeFor(path, { class: 'text', ...(shebang ? { shebang } : {}) });
  if (row) return of(row, ext, { fromBytes: row !== named, disagrees: named?.kind === 'binary' });
  const kind = detectKind({ path, head }).kind;
  return of(null, ext, { label: kind === 'log' ? 'a log' : 'plain text', group: kind === 'log' ? 'Logs' : 'Prose', fromBytes: true, disagrees: named?.kind === 'binary' });
}
