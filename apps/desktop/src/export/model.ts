// What the Export panel offers and builds, as data: the forms each "what" can take, the names
// things are saved under, the bundle's entries and its manifest. Pure: bytes and text in, entries and words out.
import { lineStarts } from '../line/refs.ts';
import { sha256Hex, uniquePaths, type ZipEntry } from './zip.ts';
import { pushAll } from '@marxy/core/src/util/spread.ts';

export type ExportWhat = 'file' | 'selection' | 'ticked' | 'tray';
export type ExportAs = 'html' | 'pdf' | 'raw' | 'text' | 'jsonl' | 'html1' | 'md1' | 'zip' | 'trmd' | 'brief';

export interface ExportForm {
  readonly id: ExportAs;
  readonly label: string;
  readonly pv: string;
  /** The primary button's words when they are not "Save <name>…". */
  readonly act?: string;
}

/** What the file in front is, as far as its forms go. */
export interface FileKind {
  /** It has a reading the page draws as text (not a viewer's picture, nor bytes alone). */
  readonly text: boolean;
  readonly markdown: boolean;
  /** A delimited table: JSON Lines is offered. */
  readonly table: boolean;
}

export function formsFor(what: ExportWhat, kind: FileKind | null): ExportForm[] {
  if (what === 'ticked')
    return [
      { id: 'html1', label: 'One web page', pv: 'joined, in order', act: 'Save the page…' },
      { id: 'md1', label: 'One Markdown file', pv: 'joined, as written' },
      { id: 'zip', label: 'A bundle', pv: 'a zip of files as stored' },
    ];
  if (what === 'tray')
    return [
      { id: 'trmd', label: 'Markdown', pv: 'each piece with its source' },
      { id: 'brief', label: 'A brief for an agent', pv: 'quoted, with file and lines' },
    ];
  if (!kind) return [];
  const out: ExportForm[] = [];
  if (kind.text) {
    out.push({ id: 'html', label: 'A web page', pv: 'one file', act: 'Save the page…' });
    out.push({ id: 'pdf', label: 'A PDF', pv: 'through the system’s print', act: 'Print to a PDF…' });
  }
  out.push({ id: 'raw', label: kind.markdown ? 'Markdown, as written' : 'The file, as written', pv: 'byte for byte' });
  if (kind.text) out.push({ id: 'text', label: 'Plain text', pv: 'as it reads' });
  if (what === 'file' && kind.table) out.push({ id: 'jsonl', label: 'JSON Lines', pv: 'one record a line' });
  return out;
}

const DEFAULT_AS: Readonly<Record<ExportWhat, ExportAs>> = { file: 'html', selection: 'raw', ticked: 'zip', tray: 'trmd' };

/** The form shown chosen: the reader's last choice for this "what" when it is offered, else the default, else the first. */
export function chosenAs(what: ExportWhat, forms: readonly ExportForm[], want: ExportAs | undefined): ExportAs | null {
  if (want && forms.some((f) => f.id === want)) return want;
  const d = DEFAULT_AS[what];
  return forms.some((f) => f.id === d) ? d : (forms[0]?.id ?? null);
}

/** What Export is about when the reader has not chosen: the tray on its page, two or more ticked files, the file, then anything. */
export function defaultWhat(can: Readonly<Record<ExportWhat, boolean>>, onTray: boolean, ticked: number): ExportWhat | null {
  if (onTray && can.tray) return 'tray';
  if (ticked >= 2) return 'ticked';
  if (can.file) return 'file';
  if (can.ticked) return 'ticked';
  if (can.tray) return 'tray';
  return null;
}

/** Forms whose result is text, so it can be copied instead of saved. */
export function isTextual(as: ExportAs, kind: FileKind | null): boolean {
  if (as === 'raw') return kind?.text === true;
  return as === 'text' || as === 'jsonl' || as === 'md1' || as === 'trmd' || as === 'brief';
}

export const stemOf = (name: string): string => name.replace(/\.[^.]+$/, '') || name;
export const extOf = (name: string): string => /\.([^./]+)$/.exec(name)?.[1] ?? 'txt';

/** "the Release Plan" → "release-plan". */
export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'export'
  );
}

const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** A bundle is named for the set that holds exactly these files, else for their one folder, else "export". */
export function bundleBase(paths: readonly string[], sets: readonly { readonly name: string; readonly tabs: readonly string[] }[]): string {
  const set = sets.find((s) => paths.length > 0 && paths.every((p) => s.tabs.includes(p)));
  if (set) return slug(set.name);
  const dirs = new Set(paths.map(dirOf));
  if (dirs.size === 1) return baseOf([...dirs][0]!) || 'export';
  return paths.length === 1 ? stemOf(baseOf(paths[0]!)) : 'export';
}

/** The name a form is saved under: `base` is the file's stem, the lines, the bundle's base or "tray". */
export function exportName(as: ExportAs, what: ExportWhat, base: string, fileName: string): string {
  switch (as) {
    case 'html':
    case 'pdf':
    case 'html1':
      return `${base}.html`;
    case 'raw':
      return what === 'selection' ? `${base}.${extOf(fileName)}` : fileName;
    case 'text':
      return `${base}.txt`;
    case 'jsonl':
      return `${base}.jsonl`;
    case 'md1':
      return `${base}.md`;
    case 'zip':
      return `${base}.zip`;
    case 'trmd':
      return 'tray.md';
    case 'brief':
      return 'tray-brief.md';
  }
}

/** `path` under `root` (both absolute, `/`-separated), or its name alone when it is not under it. Always a relative zip entry name. */
export function relativeTo(root: string | null, path: string): string {
  const r = root?.replace(/\/+$/, '') ?? '';
  const rel = root === '' ? path : r !== '' && path.startsWith(`${r}/`) ? path.slice(r.length + 1) : baseOf(path);
  // No drive, UNC or `/` root and no `..`: an entry must unpack inside the folder it is unpacked into.
  const safe = rel.replace(/^[A-Za-z]:/, '').split('/').filter((p) => p !== '' && p !== '.' && p !== '..').join('/');
  return safe !== '' ? safe : baseOf(path);
}

/** The bytes of lines `first` to `last` (1-based, inclusive) of `bytes`, each with its own ending. */
export function linesBytes(bytes: Uint8Array, first: number, last: number): Uint8Array {
  // The cursor's own count of lines (LF, CRLF or a lone CR), so a part named by `lineSpan` is the part saved.
  const starts = lineStarts(bytes);
  const from = first <= 1 ? 0 : first - 1 < starts.length ? starts[first - 1]! : bytes.length;
  const to = last < starts.length ? starts[Math.max(last, 0)]! : bytes.length;
  return bytes.subarray(from, Math.max(from, to));
}

/** One Markdown file of several: each under its path in code, as written, in order. */
export function joinedMarkdown(files: readonly { readonly path: string; readonly text: string }[]): string {
  return files.map((f) => `\`${f.path}\`\n\n${f.text}${f.text.endsWith('\n') ? '' : '\n'}`).join('\n');
}

/** A table as JSON Lines: the first row names the keys, each row after it is one record. */
export function jsonLines(rows: readonly (readonly string[])[]): string {
  const [head, ...body] = rows;
  if (!head) return '';
  return body.map((r) => JSON.stringify(Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])))).join('\n') + (body.length ? '\n' : '');
}

export interface NoteLike {
  readonly l0: number;
  readonly text: string;
  /** A note on a part that is not lines (a cell, a page, a glyph): where it is, after the path. */
  readonly address?: string;
}

/** A file's notes as Markdown: each under its line number, the line it is on quoted, or under its address. */
export function notesMarkdown(path: string, lines: readonly string[], notes: readonly NoteLike[]): string {
  return `# Notes on ${path}\n\n` + notes.map((n) => (n.address !== undefined ? `## \`${path}${n.address}\`\n\n${n.text}\n` : `## Line ${n.l0 + 1}\n\n> ${(lines[n.l0] ?? '').trim()}\n\n${n.text}\n`)).join('\n');
}

/** What the tray writes for an agent: the pieces as Markdown under a line saying what they are. */
export function briefOf(markdown: string, pieces: number): string {
  return `# A brief\n\n${pieces === 1 ? 'One part' : `${pieces} parts`}, each quoted exactly from its file, with the file and its lines after it. Read the files themselves before changing them.\n\n${markdown}`;
}

export interface BundleOptions {
  manifest: boolean;
  notes: boolean;
  patches: boolean;
  pointed: boolean;
  pages: boolean;
}

export interface BundleFile {
  /** Its path in the zip. */
  readonly zip: string;
  readonly name: string;
  /** What is on disk: the bundle never holds unsaved bytes. */
  readonly disk: Uint8Array;
  readonly dirty: boolean;
  /** The unsaved changes as a unified patch against `disk`; null when there are none. */
  readonly patch: string | null;
  /** Its notes as Markdown, null when it has none. */
  readonly notes: string | null;
  readonly noteCount: number;
}

const enc = new TextEncoder();

export const MANIFEST = 'manifest.md';

/** The bundle's entries: the files as on disk, then what the options add, every path unique. */
export function bundleEntries(files: readonly BundleFile[], o: BundleOptions, extra: { readonly pointed: readonly ZipEntry[]; readonly pages: readonly ZipEntry[] }): ZipEntry[] {
  const out: ZipEntry[] = files.map((f) => ({ path: f.zip, bytes: f.disk }));
  if (o.notes) for (const f of files) if (f.notes !== null) out.push({ path: `notes/${f.name}.notes.md`, bytes: enc.encode(f.notes) });
  if (o.patches) for (const f of files) if (f.dirty && f.patch) out.push({ path: `patches/${f.name}.patch`, bytes: enc.encode(f.patch) });
  if (o.pointed) pushAll(out, extra.pointed);
  if (o.pages) pushAll(out, extra.pages);
  // The manifest is packed after these as `manifest.md`: a file of that name gives way, as a second one would.
  return o.manifest ? uniquePaths([{ path: MANIFEST, bytes: new Uint8Array(0) }, ...out]).slice(1) : uniquePaths(out);
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** What a bundle leaves out, as sentences: unsaved changes, files pointed to, notes. */
export function leftOut(files: readonly BundleFile[], o: BundleOptions, pointed: number): string[] {
  const out: string[] = [];
  const dirty = files.filter((f) => f.dirty).length;
  const notes = o.notes ? 0 : files.reduce((n, f) => n + f.noteCount, 0);
  const these = files.length === 2 ? 'these two' : 'these';
  if (dirty) out.push(`${plural(dirty, 'file', 'files')} ${dirty === 1 ? 'has' : 'have'} unsaved changes; the bundle holds ${dirty === 1 ? 'it as it is' : 'them as they are'} on disk.${o.patches ? ' The changes are in patches/, as patches.' : ''}`);
  if (!o.pointed && pointed) out.push(`${plural(pointed, 'file', 'files')} ${these} point to ${pointed === 1 ? 'is' : 'are'} not included.`);
  if (notes) out.push(`${plural(notes, 'note', 'notes')} on them ${notes === 1 ? 'is' : 'are'} not included.`);
  return out;
}

/** The manifest: each entry's path, size and SHA-256, then what is left out. A peek says nothing is built. */
export async function manifestOf(name: string, entries: readonly ZipEntry[], words: readonly string[], withSelf: boolean, peek: boolean): Promise<string> {
  const rows: string[] = [];
  for (const e of entries) rows.push(`| ${e.path.replace(/\|/g, '\\|')} | ${e.bytes.length} | ${await sha256Hex(e.bytes)} |`);
  const out = [...words];
  if (!withSelf && peek) out.push('This manifest itself: it is not ticked, so it is shown here and not packed.');
  return (
    `# ${name}\n\n` +
    (peek ? 'A peek: nothing is built or written until you choose Build.\n\n' : '') +
    'What the bundle holds. Every file is copied byte for byte, as it is on disk; the checksum lets whoever receives it confirm that.\n\n' +
    '| Path | Bytes | SHA-256 |\n| --- | ---: | --- |\n' +
    rows.join('\n') +
    (withSelf ? '\n| manifest.md | | this file |' : '') +
    '\n\n## Left out\n\n' +
    (out.length ? out.join('\n\n') : 'Nothing.') +
    '\n'
  );
}

/** Relative paths a Markdown text points to (links and bare `dir/file.ext` paths), not resolved. */
export function pointedPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)) if (!/^[a-z][a-z0-9+.-]*:/i.test(m[1]!)) out.add(m[1]!);
  for (const m of text.matchAll(/(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})(?::\d+(?:-\d+)?)?/gm)) out.add(m[1]!);
  return [...out];
}

/** Each copy's name in "export all": its file's path, then the time it was kept, then the file's extension. */
export function copyZipPath(path: string, time: number): string {
  const rel = path.replace(/^[A-Za-z]:/, '').replace(/^\/+/, '');
  return `${rel}/${new Date(time).toISOString().slice(0, 19).replace(/:/g, '-')}.${extOf(baseOf(path))}`;
}
