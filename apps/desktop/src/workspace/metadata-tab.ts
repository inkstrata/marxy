// The inspector's Metadata tab (W-17): what the focused file is, on request. Sections, each drawn only when it has something:
// File (path, size, modified, encoding, line endings), Front matter (every top-level key and its value, a scalar edited in place),
// Detection (the kind, the reasons, *Show as*), Marxy (last read, pinned), Hidden and reshaped (the invisible characters, and
// every place Read reshaped the file, each a jump) and Notes (V-04's, each a jump). Pure parts first (`metadataModelOf`,
// `scanHidden`, `reshapedPlaces`, `applyFrontMatterEdit`), then `mountMetadataTab`.
//
// The one thing written here is a front-matter scalar's value. It goes through core's `setFrontMatterValue`, which gives one splice
// over that value's own bytes (quotes kept, the line ending and every other byte untouched), applied as one `store.apply` and so
// one undo step; a value it cannot edit safely (a block, an anchor, an alias, a flow list, several lines, a repeated key) is shown as
// it reads with the reason and *Edit in Source*, which puts the caret on its line. Adding, removing or renaming a key is not here. A
// refused edit leaves the file as it was and says why. Nothing is sent anywhere, and nothing here reads a file but to draw it.
import type { Buffer, Document, Node } from '@marxy/core';
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import { KINDS } from '@marxy/core/src/contracts/kinds.ts';
import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';
import type { Reason } from '@marxy/core/src/kind/detect.ts';
import { parseMarkdown } from '@marxy/core/src/parse/parse.ts';
import { shouldFlagInvisible } from '@marxy/core/src/render/invisibles.ts';
import { frontMatterValues, setFrontMatterValue, type FrontMatterValues } from '@marxy/core/src/operations/front-matter-value.ts';
import type { Note } from '@marxy/core/src/notes/notes.ts';
import { walk } from '@marxy/core/src/transforms/prose.ts';
import type { AppHandle } from '../app.ts';
import { palette } from '../commands/app-handle.ts';
import { writeCopy } from '../commands/copy-write.ts';
import type { DocumentStore } from '../document/store.ts';
import { isUntitled } from '../document/untitled.ts';
import { notify } from '../notices/index.ts';
import { buildAppContext } from '../selection/bind.ts';
import { codePointLabel, codePointName, encodingFact, formatCount, lineEndingFact } from '../source/frame-facts.ts';
import { findNotes, pathCheckerFor } from '../source/notes.ts';
import type { InspectorContext, InspectorTab } from './inspector.ts';
import { kindLabel } from './status-facts.ts';

// ---- the words ---------------------------------------------------------------------------------------------------------

const MB = 1024 * 1024;

/** "312 bytes", "4.1 KB", "1.8 MB". */
function sizeWords(n: number): string {
  if (n < 1024) return `${n} ${n === 1 ? 'byte' : 'bytes'}`;
  if (n < MB) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

/** "3.1 KB · 3,116 bytes": the size as a reader says it, and the exact count. */
export function sizeFact(bytes: number): string {
  return bytes < 1024 ? sizeWords(bytes) : `${sizeWords(bytes)} · ${formatCount(bytes)} bytes`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number): string => String(n).padStart(2, '0');

/** "13 Oct 2026, 14:32" in the local time zone; the same in every locale, so a margin reads the same everywhere. */
export function modifiedWords(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// ---- the model ---------------------------------------------------------------------------------------------------------

/** One labelled fact; `copy` is what Copy puts on the clipboard. */
export interface Fact {
  readonly label: string;
  readonly value: string;
  readonly copy: string;
}

export interface HiddenItem {
  readonly cp: number;
  /** "U+200B". */
  readonly label: string;
  /** "ZERO WIDTH SPACE", else a plain word for the class. */
  readonly name: string;
  readonly line: number;
  readonly column: number;
  /** Where it is, in bytes, for a jump. */
  readonly byte: number;
}

export interface ReshapedItem {
  readonly words: string;
  readonly byte: number;
}

/** Past this many characters the file is read, not scanned for hidden characters. */
export const HIDDEN_MAX_CHARS = 4 * 1024 * 1024;
/** The most hidden characters and reshaped places listed; the rest are counted. */
export const LIST_CAP = 40;

const NAMES: Readonly<Record<number, string>> = {
  0x200b: 'ZERO WIDTH SPACE',
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER',
  0x2060: 'WORD JOINER',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE',
  0x00a0: 'NO-BREAK SPACE',
  0x202a: 'LEFT-TO-RIGHT EMBEDDING',
  0x202b: 'RIGHT-TO-LEFT EMBEDDING',
  0x202c: 'POP DIRECTIONAL FORMATTING',
  0x202d: 'LEFT-TO-RIGHT OVERRIDE',
  0x202e: 'RIGHT-TO-LEFT OVERRIDE',
  0x2066: 'LEFT-TO-RIGHT ISOLATE',
  0x2067: 'RIGHT-TO-LEFT ISOLATE',
  0x2068: 'FIRST STRONG ISOLATE',
  0x2069: 'POP DIRECTIONAL ISOLATE',
};

/** Characters worth a look at all: everything `shouldFlagInvisible` could say yes to. */
const CANDIDATE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f ​-‍‪-‮⁠-⁩﻿\u{E0000}-\u{E007F}]/gu;
const isTagCp = (cp: number): boolean => cp >= 0xe0000 && cp <= 0xe007f;

/** Ranges (bytes) of the document's code blocks, sorted: a character inside one is in code. */
function codeRanges(ast: Document | null): { start: number; end: number }[] {
  if (ast === null) return [];
  const out: { start: number; end: number }[] = [];
  walk(ast, (node: Node) => {
    if (node.type === 'codeBlock') out.push({ start: node.src.start, end: node.src.end });
  });
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The invisible and bidirectional characters of the file, by the rules Read marks them by (`shouldFlagInvisible`), in order,
 * at most `cap` of them, and how many there are in all (counted to 100,000). In a file Marxy does not read as Markdown (`asCode`)
 * every character is taken as code, where a no-break space is flagged too; a Markdown file not parsed yet has no code blocks to
 * tell apart and is taken as prose. A byte-order mark is the file's own and not listed.
 */
export function scanHidden(buffer: Buffer, ast: Document | null, asCode: boolean, cap = LIST_CAP): { items: HiddenItem[]; total: number } {
  const text = buffer.text;
  const items: HiddenItem[] = [];
  if (text.length > HIDDEN_MAX_CHARS) return { items, total: 0 };
  const code = codeRanges(ast);
  const inCodeAt = (byte: number): boolean => {
    if (asCode) return true;
    let lo = 0;
    let hi = code.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (code[mid]!.start > byte) hi = mid - 1;
      else if (code[mid]!.end <= byte) lo = mid + 1;
      else return true;
    }
    return false;
  };
  let total = 0;
  let line = 1;
  let lineFrom = 0;
  let scanned = 0;
  CANDIDATE.lastIndex = 0;
  for (let m = CANDIDATE.exec(text); m !== null && total < 100_000; m = CANDIDATE.exec(text)) {
    const at = m.index;
    if (at === 0 && buffer.bom) continue;
    const cp = text.codePointAt(at)!;
    // A run of tag characters is one marker in Read (`tag ×n`), unless it spells an emoji subdivision flag.
    let tagRun: { count: number; decoded: string } | null = null;
    if (isTagCp(cp)) {
      let end = at;
      let count = 0;
      let decoded = '';
      let last = 0;
      while (end < text.length && isTagCp(text.codePointAt(end)!)) {
        last = text.codePointAt(end)!;
        if (last - 0xe0000 >= 0x20 && last - 0xe0000 <= 0x7e) decoded += String.fromCharCode(last - 0xe0000);
        end += 2;
        count++;
      }
      CANDIDATE.lastIndex = end;
      const before = at >= 2 ? text.codePointAt(at - 2) : undefined;
      if (before === 0x1f3f4 && last === 0xe007f && count >= 2) continue;
      tagRun = { count, decoded };
    }
    // The line the character is on, counted forward from the last one looked at (CRLF is one break).
    for (let i = scanned; i < at; i++) {
      const c = text.charCodeAt(i);
      if (c === 0x0a || (c === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) {
        line++;
        lineFrom = i + 1;
      }
    }
    scanned = at;
    const byte = buffer.offsets.at(at);
    // The neighbours a rule may look at (an emoji sequence's joiner, a Persian half-space): a window of code points around it.
    const window: number[] = [];
    let from = at;
    for (let k = 0; k < 6 && from > 0; k++) from -= from > 1 && text.charCodeAt(from - 1) >= 0xdc00 && text.charCodeAt(from - 1) <= 0xdfff ? 2 : 1;
    let index = -1;
    for (let u = Math.max(0, from); u < Math.min(text.length, at + 12); ) {
      const c = text.codePointAt(u)!;
      if (u === at) index = window.length;
      window.push(c);
      u += c > 0xffff ? 2 : 1;
    }
    if (tagRun === null && !shouldFlagInvisible(cp, { inCode: inCodeAt(byte), sourceStart: byte }, window, index)) continue;
    total++;
    if (items.length < cap) {
      items.push({
        cp,
        label: codePointLabel(cp),
        name: tagRun !== null ? `TAG CHARACTERS ×${tagRun.count}${tagRun.decoded === '' ? '' : ` spelling "${tagRun.decoded}"`}` : (NAMES[cp] ?? codePointName(cp) ?? 'CONTROL CHARACTER'),
        line,
        column: at - lineFrom + 1,
        byte,
      });
    }
  }
  return { items, total };
}

/** The line number a byte is on, counted from a table of line starts. */
function lineStartsOf(bytes: Uint8Array): number[] {
  const starts = [0];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) starts.push(i + 1);
    else if (bytes[i] === 0x0d && bytes[i + 1] !== 0x0a) starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: readonly number[], byte: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= byte) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Every place Read reshapes the file: front matter shown as a quiet head, an HTML comment set aside (the sanitiser drops it), and a
 * footnote's definition moved to the end of the page. The commitment (AGENTS.md, 4) is that each is listed with Source one jump away.
 */
export function reshapedPlaces(buffer: Buffer, ast: Document | null, cap = LIST_CAP): { items: ReshapedItem[]; total: number } {
  const items: ReshapedItem[] = [];
  let total = 0;
  if (ast === null) return { items, total };
  const starts = lineStartsOf(buffer.bytes);
  const add = (words: string, byte: number): void => {
    total++;
    if (items.length < cap) items.push({ words, byte });
  };
  walk(ast, (node: Node) => {
    if (node.type === 'frontmatter') {
      add(`Front matter shown as a head, lines ${lineAt(starts, node.src.start)} to ${lineAt(starts, Math.max(node.src.start, node.src.end - 1))}`, node.src.start);
    } else if (node.type === 'htmlBlock' || node.type === 'html') {
      const value = (node as { value: string }).value;
      const n = [...value.matchAll(/<!--[\s\S]*?-->/g)].length;
      if (n > 0) add(`${n === 1 ? 'An HTML comment' : `${n} HTML comments`} set aside, line ${lineAt(starts, node.src.start)}`, node.src.start);
    } else if (node.type === 'footnoteDefinition') {
      add(`Footnote ${(node as { label: string }).label} moved to the end, line ${lineAt(starts, node.src.start)}`, node.src.start);
    }
  });
  return { items, total };
}

/** The front matter of a store, read without making the parse a lazy store has not made: the AST when there is one, else the head's. */
export function frontMatterOf(store: DocumentStore): { readonly document: Document; readonly bytes: Uint8Array; readonly values: FrontMatterValues } | null {
  const snap = store.snapshot();
  const path = snap.path;
  if (!isUntitled(path) && fileTypeOf(path)?.kind !== 'markdown') return null;
  const bytes = snap.buffer.bytes;
  // A Source-only store has no AST yet and is not asked for one: the front matter is at the top, so its head is parsed on its own.
  const document = store.parsed() ? snap.ast : parseMarkdown(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)), { file: path });
  const values = frontMatterValues(document, bytes);
  return values === null ? null : { document, bytes, values };
}

export interface MetadataModel {
  readonly file: readonly Fact[];
  readonly frontMatter: FrontMatterValues | null;
  readonly kind: { readonly kind: Kind; readonly label: string; readonly reasons: readonly Reason[] } | null;
  readonly marxy: readonly Fact[];
  readonly hidden: { readonly items: readonly HiddenItem[]; readonly total: number };
  readonly reshaped: { readonly items: readonly ReshapedItem[]; readonly total: number };
}

export interface ModelInput {
  readonly store: DocumentStore;
  readonly path: string;
  readonly mtimeMs: number | null;
  readonly detected: { readonly kind: Kind; readonly reasons: readonly Reason[] } | null;
  readonly readAtMs: number | null;
  readonly pinned: boolean;
}

/** Everything the tab draws, from a snapshot and the few facts that are not in it. Reads a lazy store without parsing it. */
export function metadataModelOf(input: ModelInput): MetadataModel {
  const { store, path } = input;
  const snap = store.snapshot();
  const buffer = snap.buffer;
  const file: Fact[] = [];
  file.push({ label: 'Path', value: isUntitled(path) ? 'Not saved yet' : path, copy: path });
  file.push({ label: 'Size', value: sizeFact(buffer.bytes.length), copy: String(buffer.bytes.length) });
  if (input.mtimeMs !== null) file.push({ label: 'Modified', value: modifiedWords(input.mtimeMs), copy: new Date(input.mtimeMs).toISOString() });
  const encoding = encodingFact(buffer);
  file.push({ label: 'Encoding', value: encoding.label, copy: encoding.label });
  const endings = lineEndingFact(buffer.eol, 1);
  if (endings !== null) file.push({ label: 'Line endings', value: endings.label, copy: endings.label });
  const marxy: Fact[] = [];
  if (input.readAtMs !== null) marxy.push({ label: 'Last read', value: modifiedWords(input.readAtMs), copy: new Date(input.readAtMs).toISOString() });
  if (input.pinned) marxy.push({ label: 'Pinned', value: 'Yes', copy: 'Yes' });
  const ast = store.parsed() ? snap.ast : null;
  return {
    file,
    frontMatter: frontMatterOf(store)?.values ?? null,
    kind: input.detected === null ? null : { kind: input.detected.kind, label: kindLabel(input.detected.kind, path), reasons: input.detected.reasons },
    marxy,
    hidden: scanHidden(buffer, ast, !isUntitled(path) && fileTypeOf(path)?.kind !== 'markdown'),
    reshaped: reshapedPlaces(buffer, ast),
  };
}

// ---- the edit ----------------------------------------------------------------------------------------------------------

export type EditResult = { readonly applied: true; readonly unchanged: boolean } | { readonly applied: false; readonly why: string };

/**
 * Sets the front-matter value of `key` to `value` as one `apply` of `store` (one undo step); nothing is written to a file. Refused,
 * with the document untouched and the reason in words, when the key's value cannot be edited safely, when the new value cannot be
 * one line, and when the document changed while this was worked out.
 */
export async function applyFrontMatterEdit(store: DocumentStore, key: string, value: string): Promise<EditResult> {
  const found = frontMatterOf(store);
  if (found === null) return { applied: false, why: 'This file has no front matter' };
  const snap = store.snapshot();
  const edit = setFrontMatterValue(found.document, found.bytes, key, value);
  if (!edit.ok) return { applied: false, why: edit.reason };
  if (edit.unchanged) return { applied: true, unchanged: true };
  try {
    const applied = await store.apply({ range: edit.range, replacement: edit.replacement, label: `front matter: ${key}`, baseVersion: snap.version });
    return applied ? { applied: true, unchanged: false } : { applied: false, why: 'The document changed while this was being worked out; nothing was changed' };
  } catch (error) {
    return { applied: false, why: error instanceof Error ? error.message : String(error) };
  }
}

/** Sets a value for the open document the way every route does: Source text typed and not folded goes in first, a refusal is said. */
export async function runFrontMatterEdit(handle: AppHandle, store: DocumentStore, key: string, value: string): Promise<EditResult> {
  if (handle.document() === store) await handle.foldSource();
  const result = await applyFrontMatterEdit(store, key, value);
  if (!result.applied) notify({ kind: 'refused', text: `${result.why}. The document is unchanged.` });
  return result;
}

/** The byte a note is at in the document, from its line and column in the editor's LF text (a path note has no byte of its own). */
export function noteByte(buffer: Buffer, note: Note): number {
  const text = buffer.text;
  let line = 1;
  let at = 0;
  while (line < note.line) {
    const m = /\r\n|\r|\n/g;
    m.lastIndex = at;
    const hit = m.exec(text);
    if (hit === null) break;
    at = hit.index + hit[0].length;
    line++;
  }
  return buffer.offsets.at(Math.min(text.length, at + note.column - 1));
}

// ---- the tab -----------------------------------------------------------------------------------------------------------

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The longest a value is drawn on one row before the rest is folded behind its first lines. */
const VALUE_LINES = 6;

function mountMetadataTab(host: HTMLElement, ctx: InspectorContext): () => void {
  const handle: AppHandle = ctx.handle;
  const body = el('div', 'marxy-metadata');
  host.append(body);

  let drawnKey = '';
  let token = 0;
  let unsubscribeStore: (() => void) | null = null;
  let watched: DocumentStore | null = null;
  /** The key whose edit button gets focus once the list is drawn again: the one just edited. */
  let refocus: string | null = null;
  /** The value being typed, so a redraw that is not an edit of it (a reload) does not take it away. */
  let editing: { readonly key: string } | null = null;

  const section = (id: string, title: string): { root: HTMLElement; list: HTMLElement } => {
    const root = el('section', 'marxy-metadata-section');
    root.setAttribute('data-marxy-metadata-section', id);
    const heading = el('h3', 'marxy-metadata-heading', title);
    heading.id = `marxy-metadata-${id}-${token}`;
    const list = el('dl', 'marxy-metadata-list');
    list.setAttribute('aria-labelledby', heading.id);
    root.append(heading, list);
    return { root, list };
  };

  const copyButton = (label: string, text: string): HTMLButtonElement => {
    const b = el('button', 'marxy-metadata-copy', 'Copy');
    b.type = 'button';
    b.tabIndex = -1;
    b.setAttribute('aria-label', `Copy ${label}`);
    b.addEventListener('mousedown', (event) => event.preventDefault());
    b.addEventListener('click', () => void writeCopy(buildAppContext(handle), { text }, `Copied ${label}`));
    return b;
  };

  const factRow = (list: HTMLElement, fact: Fact): void => {
    const row = el('div', 'marxy-metadata-row');
    const dd = el('dd', 'marxy-metadata-value');
    dd.append(el('span', 'marxy-metadata-text', fact.value), copyButton(fact.label.toLowerCase(), fact.copy));
    row.append(el('dt', 'marxy-metadata-key', fact.label), dd);
    list.append(row);
  };

  const jumpRow = (list: HTMLElement, path: string, mark: string, label: string, words: string, byte: number): void => {
    const row = el('div', 'marxy-metadata-row');
    const button = el('button', 'marxy-metadata-jump');
    button.type = 'button';
    button.tabIndex = -1;
    button.setAttribute('data-marxy-metadata-jump', mark);
    button.append(el('span', 'marxy-metadata-jump-label', label), el('span', 'marxy-metadata-jump-words', words));
    button.setAttribute('aria-label', `${label}: ${words}`);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => void handle.open(path, { at: byte }));
    row.append(button);
    list.append(row);
  };

  const frontMatterRows = (list: HTMLElement, values: FrontMatterValues, store: DocumentStore): void => {
    for (const v of values.values) {
      const row = el('div', 'marxy-metadata-row');
      row.setAttribute('data-marxy-metadata-key', v.key);
      const dd = el('dd', 'marxy-metadata-value');
      const lines = v.value.split('\n');
      const shown = lines.length > VALUE_LINES ? `${lines.slice(0, VALUE_LINES).join('\n')}\n…` : v.value;
      if (v.refusal === null) {
        const edit = el('button', 'marxy-metadata-edit', v.value === '' ? '(empty)' : shown);
        edit.type = 'button';
        edit.tabIndex = -1;
        edit.title = 'Change this value';
        edit.setAttribute('aria-label', `${v.key}: ${v.value === '' ? 'empty' : v.value}. Edit value`);
        edit.addEventListener('mousedown', (event) => event.preventDefault());
        edit.addEventListener('click', () => beginEdit(dd, edit, store, v.key, v.value));
        dd.append(edit);
      } else {
        const text = el('span', 'marxy-metadata-text', shown === '' ? '(empty)' : shown);
        if (lines.length > 1) text.classList.add('marxy-metadata-multiline');
        const why = el('span', 'marxy-metadata-why', `${v.refusal}.`);
        const source = el('button', 'marxy-metadata-source', 'Edit in Source');
        source.type = 'button';
        source.tabIndex = -1;
        source.addEventListener('mousedown', (event) => event.preventDefault());
        source.addEventListener('click', () => void handle.jumpToSource(v.lineStart));
        dd.append(text, why, source);
      }
      dd.append(copyButton(v.key, v.value));
      row.append(el('dt', 'marxy-metadata-key', v.key), dd);
      list.append(row);
    }
  };

  /** The value as an input in place of its button: Enter commits, Esc leaves it as it was, leaving the field commits. */
  const beginEdit = (dd: HTMLElement, button: HTMLElement, store: DocumentStore, key: string, current: string): void => {
    const input = el('input', 'marxy-metadata-input');
    input.type = 'text';
    input.value = current;
    input.spellcheck = false;
    input.setAttribute('aria-label', `${key}, value`);
    editing = { key };
    let done = false;
    const end = (commit: boolean): void => {
      if (done) return;
      done = true;
      editing = null;
      refocus = key;
      if (!commit || input.value === current) {
        draw(true);
        return;
      }
      void runFrontMatterEdit(handle, store, key, input.value).then((result) => {
        // An edit that took makes the store tell the tab, which draws the new value; a refused one puts the old back.
        if (!result.applied || result.unchanged) draw(true);
      });
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        end(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        end(false);
      }
    });
    input.addEventListener('blur', () => end(true));
    button.replaceWith(input);
    dd.querySelector('.marxy-metadata-copy')?.remove();
    input.focus();
    input.select();
  };

  const draw = (force = false): void => {
    if (!ctx.visible()) return;
    const pane = handle.panes().focused;
    const store = pane.content.store();
    const path = pane.path();
    if (watched !== store) {
      unsubscribeStore?.();
      watched = store;
      unsubscribeStore = store ? store.subscribe(() => draw()) : null;
    }
    if (!store || path === null) {
      drawnKey = '';
      token++;
      body.replaceChildren(el('p', 'marxy-metadata-empty', 'No document is open.'));
      return;
    }
    const snap = store.snapshot();
    const parsed = store.parsed();
    const key = `${path}\0${snap.version}\0${parsed}`;
    // A value being typed is not taken away by a redraw that is not an edit of it.
    if (!force && key === drawnKey) return;
    if (!force && editing !== null && drawnKey.startsWith(`${path}\0`)) return;
    drawnKey = key;
    const mine = ++token;
    const session = palette()?.session;
    const model = metadataModelOf({
      store,
      path,
      mtimeMs: null,
      detected: pane.content.detected(),
      readAtMs: session?.readAt[path] ?? null,
      pinned: session?.pinned.includes(path) ?? false,
    });
    const sections: HTMLElement[] = [];

    // File.
    const file = section('file', 'File');
    for (const fact of model.file) factRow(file.list, fact);
    sections.push(file.root);
    if (!isUntitled(path)) {
      void handle.shell.stat(path).then((stat) => {
        if (token !== mine || stat === null) return;
        const row = el('div', 'marxy-metadata-row');
        const dd = el('dd', 'marxy-metadata-value');
        dd.append(el('span', 'marxy-metadata-text', modifiedWords(stat.mtimeMs)), copyButton('modified', new Date(stat.mtimeMs).toISOString()));
        row.append(el('dt', 'marxy-metadata-key', 'Modified'), dd);
        // After Size, as the card orders them.
        const sizeRow = [...file.list.children].find((r) => r.querySelector('.marxy-metadata-key')?.textContent === 'Size');
        if (sizeRow) sizeRow.after(row);
        else file.list.append(row);
      }, () => {});
    }

    // Front matter.
    if (model.frontMatter !== null) {
      const fm = section('front-matter', 'Front matter');
      if (model.frontMatter.unreadable !== null) {
        fm.root.append(el('p', 'marxy-metadata-note', `Read-only here: ${model.frontMatter.unreadable}.`));
      }
      if (model.frontMatter.values.length === 0) fm.root.append(el('p', 'marxy-metadata-note', 'Empty.'));
      frontMatterRows(fm.list, model.frontMatter, store);
      sections.push(fm.root);
    }

    // Detection.
    if (model.kind !== null) {
      const det = section('detection', 'Detection');
      const row = el('div', 'marxy-metadata-row');
      const dd = el('dd', 'marxy-metadata-value');
      dd.append(el('span', 'marxy-metadata-text', model.kind.label));
      row.append(el('dt', 'marxy-metadata-key', 'Kind'), dd);
      det.list.append(row);
      const showAs = el('div', 'marxy-metadata-row');
      const select = el('select', 'marxy-metadata-select');
      select.tabIndex = -1;
      select.setAttribute('aria-label', 'Show this file as');
      const chosen = model.kind.reasons.find((r) => r.tier === 1 && r.decisive) !== undefined;
      select.append(new Option('As detected', 'detected', !chosen, !chosen));
      for (const kind of KINDS) select.append(new Option(kind.charAt(0).toUpperCase() + kind.slice(1), kind, chosen && kind === model.kind.kind, chosen && kind === model.kind.kind));
      select.addEventListener('change', () => {
        const id = select.value === 'detected' ? 'kind.show-as.detected' : `kind.show-as.${select.value}`;
        const command = (handle.commands() as readonly { id: string; run(ctx: unknown): unknown }[]).find((c) => c.id === id);
        if (command) void command.run(buildAppContext(handle));
      });
      const sdd = el('dd', 'marxy-metadata-value');
      sdd.append(select);
      showAs.append(el('dt', 'marxy-metadata-key', 'Show as'), sdd);
      det.list.append(showAs);
      const reasons = el('ul', 'marxy-metadata-reasons');
      const ordered = [...model.kind.reasons.filter((r) => r.decisive), ...model.kind.reasons.filter((r) => !r.decisive)];
      for (const r of ordered) reasons.append(el('li', 'marxy-metadata-reason', `${r.decisive ? 'Because ' : ''}${r.signal} · ${r.at}`));
      det.root.append(reasons);
      sections.push(det.root);
    }

    // Marxy.
    if (model.marxy.length > 0) {
      const mx = section('marxy', 'Marxy');
      for (const fact of model.marxy) factRow(mx.list, fact);
      sections.push(mx.root);
    }

    // Hidden and reshaped.
    if (model.hidden.total > 0 || model.reshaped.total > 0) {
      const hid = section('hidden', 'Hidden and reshaped');
      for (const item of model.hidden.items) {
        jumpRow(hid.list, path, 'hidden', item.label, `${item.name} · line ${formatCount(item.line)}, column ${formatCount(item.column)}`, item.byte);
      }
      if (model.hidden.total > model.hidden.items.length) hid.root.append(el('p', 'marxy-metadata-note', `${formatCount(model.hidden.total - model.hidden.items.length)} more hidden characters not listed.`));
      for (const item of model.reshaped.items) jumpRow(hid.list, path, 'reshaped', 'Reshaped', item.words, item.byte);
      if (model.reshaped.total > model.reshaped.items.length) hid.root.append(el('p', 'marxy-metadata-note', `${formatCount(model.reshaped.total - model.reshaped.items.length)} more places not listed.`));
      sections.push(hid.root);
    }

    body.replaceChildren(...sections);
    if (refocus !== null) {
      const again = body.querySelector<HTMLElement>(`[data-marxy-metadata-key="${CSS.escape(refocus)}"] .marxy-metadata-edit`);
      refocus = null;
      again?.focus();
    }

    // Notes (V-04): found after first text, in slices; the section appears when there are some.
    const text = snap.buffer.text.replace(/\r\n?/g, '\n');
    void findNotes(text, { path, current: () => token === mine, checkPath: pathCheckerFor(path) }).then((notes) => {
      if (notes === null || token !== mine || notes.length === 0) return;
      const sec = section('notes', 'Notes');
      for (const note of notes) jumpRow(sec.list, path, 'note', note.kind === 'fence' ? 'Fence' : note.kind === 'heading' ? 'Heading' : 'Path', note.words, noteByte(snap.buffer, note));
      body.append(sec.root);
    }, () => {});
  };

  const offSignal = ctx.signal.onChange(() => draw());
  const offShown = ctx.onShown(() => draw());
  // Rendered's first parse (V-11.1) is not a store transition: the mode attribute is the cue to look again.
  const modeWatch = new MutationObserver(() => draw());
  modeWatch.observe(document.body, { attributes: true, attributeFilter: ['data-marxy-mode'] });
  draw();
  return () => {
    token++;
    offSignal();
    offShown();
    modeWatch.disconnect();
    unsubscribeStore?.();
    body.remove();
  };
}

export const METADATA_TAB: InspectorTab = { id: 'metadata', title: 'Metadata', mount: mountMetadataTab };
