// The palette's preview column (W-13, mock-v2 04-palette §Previews): what the highlighted row would open or do, drawn
// beside the list. A file shows its kind, its words or lines, a near-copies chip when the library's check (Q-06) already
// found some, and its first forty lines set in their own kind (a log as a log, code highlighted); a heading, its section;
// a command, its group and key; a transform, its result on the selection or on the first 1,400 characters of the document.
//
// Two halves. The first is pure (bytes in, a description out) and runs under Node: what is read is bounded (`readHead`'s
// 256 KB, nothing for a file over the large-file limit), what is shown is cut at forty lines, and nothing here touches the
// disk or the network. The second draws a description into the column: Markdown goes through the same parse and allow-list
// as Read (`renderSafeHtml`), then every image becomes its alt text and every link loses its address, so a preview fetches
// nothing and leaves nowhere; code goes through the code parse and the page's own highlighter. Text reaches the DOM as
// `textContent` or as HTML that has been through the allow-list, never raw.
import { DEFAULT_KIND, type IndexEntry, type Kind } from '@marxy/core';
import { codeLanguageOf, detectKind, isCodeFile, KIND_HEAD_BYTES, parseCode, transformById } from '@marxy/core';
import { measureText } from '@marxy/core/src/index-model/query-eval.ts';
import { renderDocumentSafeHtml, renderSafeHtml } from '@marxy/core/src/render/index.ts';
import { applyInvisibleMarkers } from './invisibles-dom.ts';

/** Lines of a file the column shows. */
export const PREVIEW_LINES = 40;
/** The most of a file one preview reads: `readHead`'s own cap (the shell caps it here too). */
export const PREVIEW_READ_BYTES = 256 * 1024;
/** A file over this is not read for a preview: the large-file limit of Source mode (`LARGE_FILE_BYTES`, pinned by the test). */
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
/** However long its lines are, a preview shows at most this many characters, so one huge line cannot stall the column. */
export const PREVIEW_MAX_CHARS = 8_000;
/** Lines and characters of a section shown. */
export const SECTION_LINES = 60;
export const SECTION_MAX_CHARS = 6_000;
/** The transform preview's input: the most characters of the selection or of the document a transform is run on. */
export const TRANSFORM_INPUT_CHARS = 1_400;
/** The most characters of a transform's result shown. */
export const TRANSFORM_OUTPUT_CHARS = 2_800;

const BINARY_SNIFF_BYTES = 8_192;

/** What a preview says it is about, drawn by `drawPreview`. */
export type PreviewData = FilePreview | CommandPreview | TransformPreview;

/** The text a preview sets: Markdown as the reader sets it, or a file as code (its language, or none for plain monospace). */
export interface PreviewBody {
  readonly text: string;
  readonly as: 'markdown' | 'code';
  /** The Shiki id for `as: 'code'`; absent for a file with no grammar. */
  readonly lang?: string;
  readonly path: string;
  /** More of the file follows what is shown. */
  readonly cut: boolean;
}

/** A file, or one heading's section of one. */
export interface FilePreview {
  readonly type: 'file' | 'section';
  /** The file's title; for a section, the heading's text. */
  readonly title: string;
  /** For a section: the document it is in. */
  readonly document?: string;
  readonly chips: readonly string[];
  /** Front matter set aside, said once above the text. */
  readonly frontMatter?: string;
  readonly body?: PreviewBody;
  /** Said in place of a body, or under it. */
  readonly notice?: string;
}

export interface CommandPreview {
  readonly type: 'command';
  readonly title: string;
  readonly group: string;
  readonly description: string;
  /** The chord's label (`⌘/`), or absent. */
  readonly key?: string;
}

export interface TransformPreview {
  readonly type: 'transform';
  readonly name: string;
  readonly scope: 'selection' | 'document';
  /** Characters the transform was run on. */
  readonly inputChars: number;
  /** The input was longer than the preview's cap and was cut. */
  readonly inputCut: boolean;
  readonly output: string;
  readonly outputCut: boolean;
  /** The transform changes nothing in this text. */
  readonly unchanged: boolean;
  readonly error?: string;
}

const KIND_LABELS: Readonly<Partial<Record<Kind, string>>> = { readme: 'README', docs: 'Docs', html: 'HTML' };

/** `report` as `Report`; a kind's name is a word the reader knows from the strip. */
export function kindLabel(kind: Kind): string {
  return KIND_LABELS[kind] ?? `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
}

/** `1,204 B`, `3.1 KB`, `12 MB`: the size of a file, by powers of 1,024 as the library says it. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString('en-US')} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb).toLocaleString('en-US')} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb).toLocaleString('en-US')} MB`;
}

/**
 * Bytes to read to preview `entry`: none for a file over the large-file limit (the index's size says so, and the file is
 * not touched), else the shell's cap. The size is not trusted below the limit: a file may have grown since it was walked.
 */
export function previewReadBytes(entry: Pick<IndexEntry, 'size'>): number {
  return entry.size > PREVIEW_MAX_BYTES ? 0 : PREVIEW_READ_BYTES;
}

/** A NUL near the start marks a file that is not text. */
export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** The first `maxLines` lines of `text`, at most `maxChars` characters (cut at a code point), and whether more followed. */
export function firstLines(text: string, maxLines: number, maxChars: number): { text: string; cut: boolean } {
  let end = 0;
  let lines = 0;
  while (end < text.length && lines < maxLines) {
    let i = end;
    while (i < text.length && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
    if (i < text.length) i += text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    end = i;
    lines++;
  }
  let cut = end < text.length;
  if (end > maxChars) {
    end = maxChars;
    // Never between the halves of a surrogate pair.
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--;
    cut = true;
  }
  return { text: text.slice(0, end), cut };
}

/** Lines in `text`, a last line with no ending counted. */
export function lineCount(text: string): number {
  if (text === '') return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) n++;
  }
  const last = text.charCodeAt(text.length - 1);
  return last === 10 || last === 13 ? n : n + 1;
}

const FRONT_MATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Markdown with its front matter taken off the top, and what was taken ("Front matter · 2 keys"), or the text as it was. */
export function withoutFrontMatter(text: string): { text: string; note?: string } {
  const match = FRONT_MATTER.exec(text);
  if (match === null) return { text };
  const keys = match[1]!.split(/\r?\n/).filter((line) => /^[A-Za-z0-9_][\w-]*\s*:/.test(line)).length;
  return { text: text.slice(match[0].length), note: `Front matter · ${keys} ${keys === 1 ? 'key' : 'keys'}` };
}

const READ_AS_CODE_NOT_MARKDOWN = new Set(['html', 'htm', 'csv', 'tsv', 'jsonl']);

/** How a file's text is set: as Markdown, or as code in a language (none: plain monospace). A reader's kind outranks the extension. */
export function setAs(path: string, kind: Kind): { as: 'markdown' } | { as: 'code'; lang?: string } {
  if (kind === 'log') return { as: 'code', lang: 'log' };
  if (kind === 'diff') return { as: 'code', lang: 'diff' };
  if (kind === 'terminal') return { as: 'code' };
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (kind === 'html' || READ_AS_CODE_NOT_MARKDOWN.has(ext) || isCodeFile(path)) {
    const lang = kind === 'html' ? 'html' : codeLanguageOf(path);
    return lang === undefined ? { as: 'code' } : { as: 'code', lang };
  }
  return { as: 'markdown' };
}

/**
 * The kind a file is read as. The index's `readerKind` was decided from the path and the reader's rules alone: where it names
 * something other than the default it stands (a rule or the name decided it); where it is the default, or absent, the first
 * bytes may say more (a log's shape, a transcript's speakers).
 */
function kindOf(entry: IndexEntry, head: Uint8Array): Kind {
  if (entry.readerKind !== undefined && (entry.readerKind !== DEFAULT_KIND || head.length === 0)) return entry.readerKind;
  return detectKind({ path: entry.path, head: head.subarray(0, KIND_HEAD_BYTES) }).kind;
}

const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

/**
 * A file's preview from its first bytes. `head` is null for a file that was not read (over the large-file limit): the
 * preview then says what the index knows and "Too large to preview". `nearCopies` is how many copies the library's
 * check found, 0 when it has not run: the chip is shown only for a found one.
 */
export function filePreview(entry: IndexEntry, head: Uint8Array | null, nearCopies = 0): FilePreview {
  const size = sizeLabel(entry.size);
  if (head === null) {
    const kind = kindOf(entry, new Uint8Array(0));
    return { type: 'file', title: entry.title, chips: [kindLabel(kind), size], notice: 'Too large to preview' };
  }
  if (head.length === 0) return { type: 'file', title: entry.title, chips: [kindLabel(kindOf(entry, head)), size], notice: 'Empty file' };
  const kind = kindOf(entry, head);
  if (looksBinary(head)) {
    return { type: 'file', title: entry.title, chips: [kindLabel(kind), size], notice: 'Not text, so there is nothing to show' };
  }
  const read = decode(head);
  const how = setAs(entry.path, kind);
  const partial = head.length < entry.size;
  const chips: string[] = [kindLabel(kind)];
  if (how.as === 'markdown') {
    const words = measureText(read, { markdown: true }).words;
    chips.push(`${words.toLocaleString('en-US')}${partial ? '+' : ''} ${words === 1 && !partial ? 'word' : 'words'}`);
  } else {
    const lines = lineCount(read);
    chips.push(`${lines.toLocaleString('en-US')}${partial ? '+' : ''} ${lines === 1 && !partial ? 'line' : 'lines'}`);
  }
  chips.push(size);
  if (nearCopies > 0) chips.push(`${nearCopies} near ${nearCopies === 1 ? 'copy' : 'copies'}`);
  let text = read;
  let frontMatter: string | undefined;
  if (how.as === 'markdown') {
    const stripped = withoutFrontMatter(read);
    text = stripped.text;
    frontMatter = stripped.note;
  }
  const shown = firstLines(text, PREVIEW_LINES, PREVIEW_MAX_CHARS);
  if (shown.text.trim() === '') return { type: 'file', title: entry.title, chips, frontMatter, notice: 'Nothing but blank lines' };
  const body: PreviewBody = {
    text: shown.text,
    as: how.as,
    ...(how.as === 'code' && how.lang !== undefined ? { lang: how.lang } : {}),
    path: entry.path,
    cut: shown.cut || partial,
  };
  return { type: 'file', title: entry.title, chips, frontMatter, body };
}

/** Where heading `index`'s section is in its file: from its `#` to the next heading of its level or above, or the end of the file. */
export function sectionRange(headings: IndexEntry['headings'], index: number, fileSize: number): { start: number; end: number } | null {
  const heading = headings[index];
  if (heading === undefined) return null;
  let end = fileSize;
  for (let i = index + 1; i < headings.length; i++) {
    const next = headings[i]!;
    if (next.byteOffset > heading.byteOffset && next.level <= heading.level) {
      end = next.byteOffset;
      break;
    }
  }
  return { start: heading.byteOffset, end };
}

/** A heading's section: its text, as the document sets it. `head` is the file's first bytes (null: not read). */
export function sectionPreview(entry: IndexEntry, index: number, head: Uint8Array | null): FilePreview {
  const heading = entry.headings[index];
  const base = { type: 'section' as const, title: heading?.text ?? entry.title, document: entry.title };
  const range = sectionRange(entry.headings, index, entry.size);
  if (heading === undefined || range === null) return { ...base, chips: [], notice: 'This heading is no longer in the file' };
  if (head === null) return { ...base, chips: [], notice: 'Too large to preview' };
  if (head.length === 0) return { ...base, chips: [], notice: 'Empty file' };
  if (looksBinary(head)) return { ...base, chips: [], notice: 'Not text, so there is nothing to show' };
  if (range.start >= head.length) return { ...base, chips: [], notice: 'This section is past the first 256 KB, which a preview reads. Enter opens it' };
  const slice = head.subarray(range.start, Math.min(range.end, head.length));
  const text = decode(slice);
  const shown = firstLines(text, SECTION_LINES, SECTION_MAX_CHARS);
  const words = measureText(text, { markdown: true }).words;
  const partial = range.end > head.length;
  const chips = [`Level ${heading.level}`, `${words.toLocaleString('en-US')}${partial ? '+' : ''} ${words === 1 && !partial ? 'word' : 'words'}`];
  return {
    ...base,
    chips,
    body: { text: shown.text, as: 'markdown', path: entry.path, cut: shown.cut || partial },
  };
}

/** A line saying what a command does, by what its id says it is. The registry carries no prose, so this is by family. */
export function describeCommand(id: string, group: string): string {
  if (id.startsWith('palette.drill.')) return 'Enter lists the choices.';
  if (id.startsWith('transform.run.')) return 'Enter shows the result on the selection, or on the whole document, before anything changes.';
  if (id.startsWith('op.') && group === 'Transform') return 'Enter changes the selection, or the block it is in. Undo puts it back.';
  if (id.startsWith('op.')) return 'Enter runs it on the selection, or the block it is in.';
  return 'Enter runs it.';
}

/** A command's preview: its title, its group and its key, and a line on what it does. */
export function commandPreview(cmd: { readonly id: string; readonly title: string }, group: string, key: string | undefined): CommandPreview {
  return { type: 'command', title: cmd.title, group, description: describeCommand(cmd.id, group), ...(key === undefined ? {} : { key }) };
}

/** `text` cut to `max` characters at a code point, and whether it was cut. */
function cutChars(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return { text: text.slice(0, end), cut: true };
}

/**
 * A transform's result on the selection, or on the document's first characters, for the column. The input is cut at
 * `TRANSFORM_INPUT_CHARS` whatever it is, so a long document never stalls the palette; Enter runs on all of it.
 */
export function transformPreview(id: string, input: { readonly text: string; readonly scope: 'selection' | 'document' }): TransformPreview | null {
  const transform = transformById(id);
  if (transform === undefined) return null;
  const used = cutChars(input.text, TRANSFORM_INPUT_CHARS);
  const base = { type: 'transform' as const, name: transform.name, scope: input.scope, inputChars: used.text.length, inputCut: used.cut };
  try {
    const out = transform.fn(used.text);
    const shown = cutChars(out, TRANSFORM_OUTPUT_CHARS);
    return { ...base, output: shown.text, outputCut: shown.cut, unchanged: out === used.text };
  } catch (error) {
    return { ...base, output: '', outputCut: false, unchanged: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------- drawing ----------

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Makes parsed Markdown inert: an image becomes its alt text (a preview fetches nothing, a remote image already lost its
 * address in the allow-list, a local one never gets one), and a link loses its address (a click in the column goes nowhere).
 */
export function neutralise(root: HTMLElement): void {
  for (const img of [...root.querySelectorAll('img, picture, source, video, audio, iframe, object, embed')]) {
    const alt = img instanceof HTMLImageElement ? img.alt : '';
    const note = root.ownerDocument.createElement('span');
    note.className = 'marxy-palette-prev-image';
    note.textContent = alt === '' ? 'image' : alt;
    img.replaceWith(note);
  }
  for (const a of root.querySelectorAll('a')) {
    a.removeAttribute('href');
    a.removeAttribute('target');
  }
}

async function highlightBlocks(host: HTMLElement): Promise<void> {
  const { applyHighlightToCode } = await import('./highlight.ts');
  for (const code of host.querySelectorAll<HTMLElement>('pre:not(.marxy-math-block) > code')) {
    if (!host.isConnected) return;
    await applyHighlightToCode(code);
  }
}

function drawBody(doc: Document, host: HTMLElement, body: PreviewBody): void {
  const text = el(doc, 'div', body.as === 'markdown' ? 'marxy-palette-prev-text marxy-palette-prev-prose' : 'marxy-palette-prev-text marxy-palette-prev-code');
  if (body.as === 'markdown') {
    // Parsed and allow-listed as Read does it; the file's own folder is not given, so no image path is resolved.
    // The reading face, as the document sets it: on the element, since the palette's sheet carries no face but the chrome's.
    text.style.fontFamily = 'var(--marxy-font-text)';
    text.innerHTML = renderSafeHtml(body.text, { file: body.path }).html;
    neutralise(text);
    applyInvisibleMarkers(text);
  } else {
    const bytes = new TextEncoder().encode(body.text);
    text.innerHTML = renderDocumentSafeHtml(parseCode(bytes, { file: body.path, ...(body.lang === undefined ? {} : { lang: body.lang }) })).html;
    applyInvisibleMarkers(text);
    void highlightBlocks(text).catch(() => {});
  }
  host.append(text);
  if (body.cut) host.append(el(doc, 'p', 'marxy-palette-prev-more', '…'));
}

/** Replaces the column's content with `data`. */
export function drawPreview(host: HTMLElement, data: PreviewData | null): void {
  const doc = host.ownerDocument;
  host.replaceChildren();
  if (data === null) return;
  if (data.type === 'command') {
    host.append(el(doc, 'h3', 'marxy-palette-prev-title', data.title), el(doc, 'p', 'marxy-palette-prev-group', data.group), el(doc, 'p', 'marxy-palette-prev-note', data.description));
    if (data.key !== undefined) {
      const row = el(doc, 'p', 'marxy-palette-prev-note', 'Key ');
      row.append(el(doc, 'kbd', 'marxy-palette-keycap', data.key));
      host.append(row);
    }
    return;
  }
  if (data.type === 'transform') {
    const where = data.scope === 'selection' ? 'on the selection' : 'on the document';
    host.append(el(doc, 'h3', 'marxy-palette-prev-title', data.name));
    const cut = data.inputCut ? `the first ${TRANSFORM_INPUT_CHARS.toLocaleString('en-US')} characters of it` : `${data.inputChars.toLocaleString('en-US')} characters`;
    host.append(el(doc, 'p', 'marxy-palette-prev-group', `Result ${where}: ${cut}`));
    if (data.error !== undefined) {
      host.append(el(doc, 'p', 'marxy-palette-prev-note', `Could not run on this text: ${data.error}`));
      return;
    }
    if (data.unchanged) host.append(el(doc, 'p', 'marxy-palette-prev-note', 'Nothing in this text changes.'));
    host.append(el(doc, 'pre', 'marxy-palette-prev-result', data.output));
    if (data.outputCut) host.append(el(doc, 'p', 'marxy-palette-prev-more', '…'));
    host.append(el(doc, 'p', 'marxy-palette-prev-note', 'Enter opens the result, with Copy and Apply, on all of the text.'));
    return;
  }
  if (data.chips.length > 0) {
    const chips = el(doc, 'div', 'marxy-palette-prev-chips');
    data.chips.forEach((chip, i) => chips.append(el(doc, 'span', i === 0 ? 'marxy-palette-prev-chip marxy-palette-prev-chip-lead' : 'marxy-palette-prev-chip', chip)));
    host.append(chips);
  }
  if (data.type === 'section' && data.document !== undefined) host.append(el(doc, 'p', 'marxy-palette-prev-group', `In ${data.document}`));
  if (data.frontMatter !== undefined) host.append(el(doc, 'p', 'marxy-palette-prev-note', data.frontMatter));
  if (data.body !== undefined) drawBody(doc, host, data.body);
  if (data.notice !== undefined) host.append(el(doc, 'p', 'marxy-palette-prev-note', data.notice));
}

// ---------- following the highlighted row ----------

/** How long the highlight rests on a row before its preview is made: never on the keystroke or the arrow, so typing and holding a key cost nothing. */
export const PREVIEW_PAUSE_MS = 200;

export interface PreviewFollower {
  /**
   * The highlighted row is now `key` (null: no row has a preview). A row that is already shown, or already waited on, changes
   * nothing. Otherwise any earlier wait is dropped and, after the pause, `load` is asked for the preview and shown if
   * the highlight is still on `key`. A null key clears the column at once.
   */
  follow(key: string | null, load: () => Promise<PreviewData | null>): void;
  /** Drops the wait and the column's content (the palette closed): the next `follow` shows again even for the same key. */
  reset(): void;
}

export interface FollowerOptions {
  readonly pauseMs?: number;
  /** Draws `data` (null: empty the column). */
  readonly show: (data: PreviewData | null) => void;
  /** True from the first move of the highlight until its preview is drawn: the column dims what it still shows. */
  readonly pending?: (on: boolean) => void;
}

export function createPreviewFollower(opts: FollowerOptions): PreviewFollower {
  const pauseMs = opts.pauseMs ?? PREVIEW_PAUSE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown: string | null = null;
  let waiting: string | null = null;
  let generation = 0;
  const stop = () => {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    waiting = null;
  };
  return {
    follow(key, load) {
      if (key !== null && ((key === shown && waiting === null) || key === waiting)) return;
      if (key === null && shown === null && waiting === null) return;
      stop();
      if (key === null) {
        shown = null;
        opts.show(null);
        opts.pending?.(false);
        return;
      }
      if (key === shown) {
        // Back on the row already drawn: nothing to wait for.
        opts.pending?.(false);
        return;
      }
      waiting = key;
      opts.pending?.(true);
      const mine = generation;
      timer = setTimeout(() => {
        timer = undefined;
        void load().then(
          (data) => {
            if (mine !== generation) return;
            waiting = null;
            shown = key;
            opts.show(data);
            opts.pending?.(false);
          },
          () => {
            if (mine !== generation) return;
            waiting = null;
            shown = null;
            opts.show(null);
            opts.pending?.(false);
          },
        );
      }, pauseMs);
    },
    reset() {
      stop();
      shown = null;
      opts.show(null);
      opts.pending?.(false);
    },
  };
}
