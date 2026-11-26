// What a viewed file is, gathered before its page is drawn: its size and date, its head (never the whole file), what the
// head said, the registry's row, and the sentences the file card and the Reading card say of it.
import { fileTypeFor, guessedFromBytes, nameTypeOf, type ContentSignals, type FileType, type FileTypeRow } from '@marxy/core/src/kind/registry.ts';
import { extensionOf, firstBytes, magicOf, sizeWords, textTest, type Magic } from '@marxy/core/src/viewer/bytes.ts';
import type { ImageFacts } from '@marxy/shell-api';
import type { AppShell } from '../app-types.ts';

/** How much of the head is read for the card: the text test's window and any magic past the first sector. */
export const VIEW_HEAD_BYTES = 4096;

export interface ViewedFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number | null;
  /** When the file was made, where the platform says; null where it does not. */
  readonly createdMs: number | null;
  /** The first bytes, at most `VIEW_HEAD_BYTES`. */
  readonly head: Uint8Array;
  readonly signals: ContentSignals | null;
  /** The registry's row after the head corrected the name. */
  readonly row: FileType;
  /** What the name alone said. */
  readonly named: FileTypeRow | undefined;
  /** The reading was found from the bytes when the name said nothing. */
  readonly guessed: boolean;
  readonly magic: Magic | null;
}

/** The file at `path`, from its stat and its head; `bytes` when the page already holds them (a text file's store). */
export async function gatherFile(shell: AppShell, path: string, signals: ContentSignals | null, bytes?: Uint8Array): Promise<ViewedFile> {
  const [stat, head] = await Promise.all([
    shell.stat(path).catch(() => null),
    bytes ? Promise.resolve(bytes.subarray(0, VIEW_HEAD_BYTES)) : shell.readHead(path, VIEW_HEAD_BYTES),
  ]);
  return {
    path,
    size: bytes?.length ?? stat?.size ?? head.length,
    mtimeMs: stat?.mtimeMs ?? null,
    createdMs: stat?.createdMs ?? null,
    head,
    signals,
    row: fileTypeFor(path),
    named: nameTypeOf(path),
    guessed: guessedFromBytes(path),
    magic: magicOf(head),
  };
}

const ROW_WORDS: Readonly<Record<string, string>> = {
  image: 'an image',
  audio: 'audio',
  video: 'video',
  archive: 'an archive',
  'archive-other': 'an archive',
  font: 'a font',
  'font-other': 'a font',
  midi: 'MIDI notes',
  pdf: 'a PDF',
  shortcut: 'a Windows shortcut',
  program: 'a Windows program or library',
  executable: 'a program or a library',
  office: 'an office document',
  'outlook-message': 'an Outlook message',
  database: 'a database',
  spreadsheet: 'a spreadsheet',
  book: 'a book (EPUB)',
};

const FORMAT_NAMES: Readonly<Record<string, string>> = {
  png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', avif: 'AVIF', bmp: 'BMP', ico: 'ICO', svg: 'SVG', tiff: 'TIFF', tga: 'TGA', exr: 'OpenEXR',
  hdr: 'Radiance HDR', qoi: 'QOI', jxl: 'JPEG XL', heic: 'HEIC', raw: 'camera RAW', pbm: 'PBM', pgm: 'PGM', ppm: 'PPM', pam: 'PAM',
  farbfeld: 'farbfeld', dds: 'DDS', psd: 'Photoshop (PSD)', svgz: 'SVGZ',
};

/** A format as the page names it: "JPEG", "WebP". */
export const formatName = (format: string): string => FORMAT_NAMES[format] ?? format.toUpperCase();

const n2 = (n: number): string => n.toLocaleString('en-GB');

/** What the card's kind row says. */
export function kindWords(file: ViewedFile, facts: ImageFacts | null): string {
  if (facts) return `an image, ${formatName(facts.format)}`;
  if (file.row.id === 'binary' || file.row.kind !== 'binary') {
    if (file.magic?.format === 'a GPT disk') return 'a disk image';
    return file.magic ? `${file.magic.format}, which the app has no reading for` : 'binary data the app has no reading for';
  }
  return ROW_WORDS[file.row.id] ?? 'binary data the app has no reading for';
}

/** The text test in the card's words. */
export function encodingWords(file: ViewedFile): string {
  const t = textTest(file.head);
  if (t.n === 0) return 'empty';
  return `not text · ${Math.round(t.odd * 100)} % of the first ${n2(t.n)} bytes are outside printable text`;
}

/**
 * Why the file is shown as it is, one sentence a line: what its first bytes are, what its name says, and why there is no
 * reading or no drawing here. `facts` is an image's, when it has them.
 */
export function whyLines(file: ViewedFile, facts: ImageFacts | null): string[] {
  const lines: string[] = [];
  const { hex, text } = firstBytes(file.head, file.magic && file.magic.len > 8 ? file.magic.len : 8);
  const ext = extensionOf(file.path);
  if (file.magic?.format === 'a GPT disk') lines.push('Its first sector ends 55 AA and the second begins EFI PART: a GPT disk, which the app has no reading for.');
  else if (file.magic && file.magic.len > 0) lines.push(`Its first bytes, ${hex}, are ${file.magic.name}.`);
  else lines.push(`Its first bytes, ${hex} (“${text}”), match no format the app knows.`);
  if (file.guessed) lines.push('The name has no extension, so the bytes decide.');
  else if (ext && file.named?.kind === 'binary') {
    lines.push(file.named.viewer === 'image' || file.named.id === file.row.id ? `The name agrees: .${ext}.` : `The name ends in .${ext}.`);
  } else if (ext && !file.named) lines.push(`The name ends in .${ext}, which names no kind the app reads.`);
  else if (!ext) lines.push('The name has no extension.');
  if (!facts && (!file.magic || file.magic.len === 0) && file.magic?.format !== 'a GPT disk') {
    const t = textTest(file.head);
    if (t.nul > 0) lines.push(`The first ${n2(t.n)} bytes hold ${n2(t.nul)} NUL ${t.nul === 1 ? 'byte' : 'bytes'}, and ${Math.round(t.odd * 100)} % of them are outside printable text, so it is not text.`);
    else lines.push(`${Math.round(t.odd * 100)} % of the first ${n2(t.n)} bytes are outside printable text, so it is not text.`);
  }
  if (facts?.show === 'none' && facts.why) lines.push(facts.why);
  return lines;
}

/** "13 Oct 2026, 21:05". */
export function dateWords(ms: number | null): string {
  if (!ms) return 'unknown';
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The size line: "48.0 KB · 49,152 bytes". */
export const sizeLine = (file: ViewedFile): string => sizeWords(file.size);

/** Kinds of file whose default program would run them: the card does not offer to open one (the shell refuses too). */
const PROGRAMS = new Set(['exe', 'dll', 'sys', 'ocx', 'com', 'bat', 'cmd', 'msi', 'msp', 'mst', 'scr', 'pif', 'cpl', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'lnk', 'url', 'reg', 'jar', 'appref-ms', 'application', 'gadget', 'msc', 'inf', 'sct', 'scf', 'app', 'command', 'sh', 'bash', 'zsh', 'desktop', 'appimage', 'run', 'pkg', 'dmg', 'deb', 'rpm', 'py', 'pyw', 'pl', 'rb']);
export const isProgram = (path: string): boolean => PROGRAMS.has(extensionOf(path));

/** A program by its name, its row or its MZ head, whatever it is called: the card never offers to open one. */
export const isProgramFile = (file: ViewedFile): boolean => isProgram(file.path) || file.row.id === 'program' || file.magic?.format === 'a Windows program';
