// The Source frame (V-05; the X-21 rulings Q13 and Q14, on ADR-0067's metrics): the editor in an enclosure with thin bars on its edges. A top bar says
// what the file is (its path, its encoding, line endings and indentation as they are, its size in bytes and lines), a
// column ruler sits on the text's character grid, the right edge carries marks at the height of things that sit at exact
// bytes (invisible and bidi characters, find matches), and a bottom bar says where the caret is (line, column, byte
// offset, the character after it). Every value is read from the bytes or from the editor's text and says only that:
// nothing is a score, a summary or a judgement, and nothing is drawn on the reader's text. There is no toolbar, outline
// or minimap here. The bars are not focus stops and hold no keyboard trap; the caret readout is plain text, not a live
// region, so a screen reader reads it when asked and does not announce every key press.
//
// The frame is built in the same task as the editor, before the first paint, so first text never waits for it
// (commitment 5); the bars fill from what the buffer already holds, and the two things that scan the whole text (the
// marks) run after it, in slices.

import { type Buffer, encodeSourceText, strayByteOf, utf16ToByte } from '@marxy/core';
import { shouldFlagInvisible } from '@marxy/core/src/render/index.ts';
import { getSearchQuery, searchPanelOpen, setSearchQuery } from '@codemirror/search';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { isUntitled } from '../document/untitled.ts';
import { cmDocText } from './buffer-commit.ts';
import { cmPosToUtf16 } from './cm-position.ts';
import {
  type IndentFact,
  bytesLabel,
  characterReadout,
  codePointLabel,
  codePointName,
  detectIndent,
  encodingFact,
  formatCount,
  indentFact,
  lineEndingFact,
  linesLabel,
  pathSegments,
  strayReadout,
} from './frame-facts.ts';
import { createRuler, type Ruler } from './ruler.ts';

/** How much of the text the indentation is read from: the first quarter megabyte is what a file's style is. */
const INDENT_SAMPLE = 256 * 1024;
/** Longest selection counted live; past it the bar names the position only. */
const SELECTION_COUNT_CAP = 2_000_000;
/** The most find matches walked for the strip, and the most invisible characters. */
const FIND_CAP = 20_000;
const INVISIBLE_CAP = 2_000;
/** Marks closer than a thousandth of the strip share a place. */
const STRIP_STEPS = 1000;
/** Lines scanned between two yields to the page. */
const SLICE_LINES = 4000;

/** A candidate for an invisible or bidi mark; `shouldFlagInvisible` is the rule that decides. */
const CANDIDATE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f ​-‍⁠‪-‮⁦-⁩﻿]|[\u{e0000}-\u{e007f}]/u;

export interface SourceFrame {
  /** The element the editor is built in. */
  readonly body: HTMLElement;
  /** What the editor needs to feed the bars. */
  readonly extension: Extension;
  /** Called once the editor exists: reads it into the bars. */
  attach(view: EditorView): void;
  /** The editor now holds this buffer (another file, or a reload): the facts of the bytes are read again. */
  bind(buffer: Buffer): void;
  destroy(): void;
}

export interface SourceFrameOptions {
  /** Whether Source wraps this file's lines: a column ruler means nothing when a row is not a line. */
  readonly wraps: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

interface Mark {
  readonly from: number;
  readonly to: number;
  readonly kind: 'invisible' | 'find';
  readonly title: string;
}

export function createSourceFrame(parent: HTMLElement, initial: Buffer, opts: SourceFrameOptions): SourceFrame {
  let buffer = initial;
  let view: EditorView | null = null;
  let ruler: Ruler | null = null;
  let destroyed = false;

  // ---- the elements
  const root = el('div', 'marxy-source-frame');
  const top = el('div', 'marxy-source-top');
  top.setAttribute('role', 'group');
  top.setAttribute('aria-label', 'This file');
  const pathEl = el('span', 'marxy-source-path');
  const facts = el('span', 'marxy-source-facts');
  top.append(pathEl, facts);
  const body = el('div', 'marxy-source-body');
  const strip = el('div', 'marxy-source-marks');
  // The strip is pointer sugar over what Find and the bottom bar already say in words.
  strip.setAttribute('aria-hidden', 'true');
  body.append(strip);
  const bottom = el('div', 'marxy-source-bottom');
  bottom.setAttribute('role', 'group');
  bottom.setAttribute('aria-label', 'Caret position');
  const readoutEl = el('span', 'marxy-source-readout');
  const selectionEl = el('span', 'marxy-source-selected');
  const characterEl = el('span', 'marxy-source-character');
  bottom.append(readoutEl, selectionEl, characterEl);

  const fact = (name: string): HTMLElement => {
    const node = el('span', 'marxy-source-fact');
    node.dataset.fact = name;
    facts.append(node);
    return node;
  };
  const encodingEl = fact('encoding');
  const endingsEl = fact('endings');
  const indentEl = fact('indent');
  const sizeEl = fact('size');
  const linesEl = fact('lines');

  root.append(top);
  // The ruler needs the editor to read: `attach` makes it and puts it between the top bar and the body.
  root.append(body, bottom);
  parent.append(root);

  const setText = (node: HTMLElement, text: string, title?: string): void => {
    if (node.textContent !== text) node.textContent = text;
    if (title !== undefined) node.title = title;
    node.hidden = text === '';
  };

  // ---- the facts of the bytes
  let bytes = buffer.bytes.length;
  /** Whether the editor's text has changed since the buffer was bound: until it has, a position is read from the buffer. */
  let dirty = false;
  let indent: IndentFact = { kind: 'none', width: 0 };

  const renderPath = (): void => {
    const segments = pathSegments(buffer.path);
    const frag = document.createDocumentFragment();
    segments.forEach((name, i) => {
      if (i > 0) {
        const sep = el('span', 'marxy-source-sep');
        sep.textContent = '›';
        sep.setAttribute('aria-hidden', 'true');
        frag.append(sep);
      }
      const seg = el('span', i === segments.length - 1 ? 'marxy-source-seg marxy-source-seg-file' : 'marxy-source-seg');
      seg.textContent = name;
      frag.append(seg);
    });
    pathEl.replaceChildren(frag);
    pathEl.title = isUntitled(buffer.path) ? 'Not saved yet' : buffer.path;
  };

  const renderBufferFacts = (): void => {
    const encoding = encodingFact(buffer);
    setText(encodingEl, encoding.label, encoding.title);
  };

  const renderLiveFacts = (): void => {
    const doc = view?.state.doc;
    // A file that ends in a line break has the line count of the lines it ends; the empty row after it is not a line.
    const rows = doc?.lines ?? 1;
    const lines = doc !== undefined && rows > 1 && doc.line(rows).length === 0 ? rows - 1 : rows;
    const endings = lineEndingFact(buffer.eol, rows);
    setText(endingsEl, endings?.label ?? '', endings?.title);
    const tab = view?.state.tabSize ?? 4;
    const shown = indentFact(indent, tab);
    setText(indentEl, shown?.label ?? '', shown?.title);
    setText(sizeEl, bytesLabel(bytes), 'The size of the file in bytes, as it would be written now');
    setText(linesEl, linesLabel(lines), 'Lines in the file; a last empty row after a final line break is not counted');
  };

  const readIndent = (state: EditorState | null): void => {
    const text = state === null ? cmDocText(buffer).slice(0, INDENT_SAMPLE) : state.sliceDoc(0, Math.min(state.doc.length, INDENT_SAMPLE));
    indent = detectIndent(text);
  };

  let indentTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleIndent = (): void => {
    if (indentTimer !== null) clearTimeout(indentTimer);
    indentTimer = setTimeout(() => {
      indentTimer = null;
      if (destroyed || view === null) return;
      readIndent(view.state);
      renderLiveFacts();
    }, 400);
  };

  // ---- the caret
  /** The byte offset of a position: from the buffer while the text is the buffer's, else counted from the text. */
  const byteOffsetAt = (state: EditorState, pos: number): number => {
    if (!dirty) return utf16ToByte(buffer, cmPosToUtf16(buffer, state, pos));
    return encodeSourceText(state.sliceDoc(0, pos)).length + (buffer.bom ? 3 : 0);
  };

  const readCaret = (): void => {
    if (view === null) return;
    const { state } = view;
    const { main } = state.selection;
    const line = state.doc.lineAt(main.head);
    const before = state.sliceDoc(line.from, main.head);
    let column = 1;
    for (let i = 0; i < before.length; i++) {
      const c = before.charCodeAt(i);
      // A pair is one character; its low half is not counted again.
      if (!(c >= 0xdc00 && c <= 0xdfff && i > 0 && before.charCodeAt(i - 1) >= 0xd800 && before.charCodeAt(i - 1) <= 0xdbff)) column++;
    }
    const offset = byteOffsetAt(state, main.head);
    readoutEl.textContent = `Ln ${formatCount(line.number)}, Col ${formatCount(column)} · byte ${formatCount(offset)}`;
    readoutEl.title = 'Line, then column counted in characters (a tab is one), then the byte offset from the start of the file';

    const count = state.selection.ranges.length;
    if (main.empty && count === 1) setText(selectionEl, '');
    else {
      const parts: string[] = [];
      if (!main.empty) {
        if (main.to - main.from <= SELECTION_COUNT_CAP) {
          const chosen = state.sliceDoc(main.from, main.to);
          let chars = 0;
          for (let i = 0; i < chosen.length; i++) {
            const c = chosen.charCodeAt(i);
            if (!(c >= 0xdc00 && c <= 0xdfff && i > 0 && chosen.charCodeAt(i - 1) >= 0xd800 && chosen.charCodeAt(i - 1) <= 0xdbff)) chars++;
          }
          const size = encodeSourceText(chosen).length;
          parts.push(`${formatCount(chars)} ${chars === 1 ? 'character' : 'characters'}, ${bytesLabel(size)} selected`);
        }
      }
      if (count > 1) parts.push(`${count} carets`);
      setText(selectionEl, parts.join(' · '));
    }

    // The character after the caret, or what ends the line.
    const doc = state.doc;
    let label: string;
    if (main.head >= doc.length) label = 'End of file';
    else if (main.head === line.to) {
      const sep = state.lineBreak;
      label = sep === '\r\n' ? 'U+000D U+000A CRLF' : sep === '\r' ? characterReadout(0x0d) : characterReadout(0x0a);
    } else {
      const next = state.sliceDoc(main.head, Math.min(main.head + 2, line.to));
      const unit = next.charCodeAt(0);
      const stray = strayByteOf(unit);
      if (stray >= 0 && !(next.length === 2 && unit >= 0xd800 && unit <= 0xdbff)) label = strayReadout(stray);
      else label = characterReadout(next.codePointAt(0)!);
    }
    setText(characterEl, label);
  };

  // ---- the marks at the right edge
  let marks: Mark[] = [];
  let invisibleMarks: Mark[] = [];
  let findMarks: Mark[] = [];
  let scanToken = 0;
  let stripSignature = '';

  const lineColumn = (state: EditorState, pos: number): string => {
    const line = state.doc.lineAt(pos);
    return `${line.number}:${pos - line.from + 1}`;
  };

  const layoutMarks = (): void => {
    if (view === null || destroyed) return;
    const v = view;
    v.requestMeasure({
      key: layoutMarks,
      read: () => {
        const height = v.contentHeight;
        if (!(height > 0)) return null;
        const top = v.documentPadding.top;
        return marks.map((mark) => {
          const block = v.lineBlockAt(Math.min(mark.from, v.state.doc.length));
          const centre = (top + block.top + block.height / 2) / height;
          return Math.min(1, Math.max(0, centre));
        });
      },
      write: (fractions) => {
        if (fractions === null || destroyed) return;
        const placed = new Map<number, { mark: Mark; step: number }>();
        marks.forEach((mark, i) => {
          const step = Math.round(fractions[i]! * STRIP_STEPS);
          const key = step * 2 + (mark.kind === 'find' ? 1 : 0);
          // Two marks of one kind at one place are one mark; the first names it.
          if (!placed.has(key)) placed.set(key, { mark, step });
        });
        // The marks move only when a height is measured differently, which is seldom: an unchanged strip is left alone.
        const signature = [...placed.entries()].map(([key, { mark }]) => `${key}:${mark.from}`).join(',');
        if (signature === stripSignature) return;
        stripSignature = signature;
        const frag = document.createDocumentFragment();
        for (const { mark, step } of placed.values()) {
          const node = el('i', mark.kind === 'find' ? 'marxy-source-mark marxy-source-mark-find' : 'marxy-source-mark marxy-source-mark-invisible');
          node.style.top = `${(step / STRIP_STEPS) * 100}%`;
          node.title = mark.title;
          node.addEventListener('click', () => jumpTo(mark));
          frag.append(node);
        }
        strip.replaceChildren(frag);
      },
    });
  };

  const jumpTo = (mark: Mark): void => {
    if (view === null) return;
    view.dispatch({
      // The caret ends at the start, so the bottom bar names the character the mark is for.
      selection: { anchor: mark.to, head: mark.from },
      effects: EditorView.scrollIntoView(mark.from, { y: 'center' }),
      userEvent: 'select',
    });
    view.focus();
  };

  const publishMarks = (): void => {
    marks = [...invisibleMarks, ...findMarks];
    layoutMarks();
  };

  /** Invisible and bidi characters, found a slice of lines at a time so a large file never holds the page. */
  const scanInvisibles = (state: EditorState): void => {
    const token = ++scanToken;
    const found: Mark[] = [];
    // A code file has no prose to leave a no-break space in; a wrapped file is prose.
    const inCode = !opts.wraps;
    const lines = state.doc.iterLines();
    let pos = 0;
    const step = (): void => {
      if (destroyed || token !== scanToken) return;
      for (let n = 0; n < SLICE_LINES; n++) {
        const next = lines.next();
        if (next.done) {
          invisibleMarks = found;
          publishMarks();
          return;
        }
        const text = next.value;
        if (text !== '' && CANDIDATE.test(text)) {
          const cps: number[] = [];
          const at: number[] = [];
          for (let u = 0; u < text.length; ) {
            const cp = text.codePointAt(u)!;
            cps.push(cp);
            at.push(u);
            u += cp > 0xffff ? 2 : 1;
          }
          for (let i = 0; i < cps.length && found.length < INVISIBLE_CAP; i++) {
            if (!shouldFlagInvisible(cps[i]!, { inCode, sourceStart: 0 }, cps, i)) continue;
            const from = pos + at[i]!;
            found.push({
              from,
              to: from + (cps[i]! > 0xffff ? 2 : 1),
              kind: 'invisible',
              title: `${codePointLabel(cps[i]!)}${codePointName(cps[i]!) === null ? '' : ` ${codePointName(cps[i]!)}`} at ${lineColumn(state, from)}`,
            });
          }
        }
        // A line break is one position in the editor's text, whatever it is in the file.
        pos += text.length + 1;
        if (found.length >= INVISIBLE_CAP) {
          invisibleMarks = found;
          publishMarks();
          return;
        }
      }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  };

  /** Find matches, while the find panel is open: where the query matches, at the height of each. */
  const scanFind = (state: EditorState): void => {
    if (!searchPanelOpen(state)) {
      if (findMarks.length > 0) {
        findMarks = [];
        publishMarks();
      }
      return;
    }
    const query = getSearchQuery(state);
    const found: Mark[] = [];
    if (query.valid) {
      const cursor = query.getCursor(state);
      for (let next = cursor.next(); !next.done && found.length < FIND_CAP; next = cursor.next()) {
        const { from, to } = next.value;
        if (to > from) found.push({ from, to, kind: 'find', title: `Find match at ${lineColumn(state, from)}` });
      }
    }
    findMarks = found;
    publishMarks();
  };

  let marksTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleFind = (): void => {
    if (marksTimer !== null) clearTimeout(marksTimer);
    marksTimer = setTimeout(() => {
      marksTimer = null;
      if (!destroyed && view !== null) scanFind(view.state);
    }, 120);
  };
  let invisibleTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleInvisibles = (): void => {
    if (invisibleTimer !== null) clearTimeout(invisibleTimer);
    invisibleTimer = setTimeout(() => {
      invisibleTimer = null;
      if (!destroyed && view !== null) scanInvisibles(view.state);
    }, 300);
  };

  // ---- one redraw a frame
  let frameId = 0;
  let pending = { facts: false, caret: false };
  const flush = (): void => {
    frameId = 0;
    if (destroyed) return;
    if (pending.facts) renderLiveFacts();
    if (pending.caret) readCaret();
    pending = { facts: false, caret: false };
  };
  const schedule = (what: Partial<typeof pending>): void => {
    pending = { facts: pending.facts || what.facts === true, caret: pending.caret || what.caret === true };
    if (frameId === 0) frameId = requestAnimationFrame(flush);
  };

  const onUpdate = (u: ViewUpdate): void => {
    if (destroyed) return;
    if (u.docChanged) {
      dirty = true;
      let delta = 0;
      u.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        delta += encodeSourceText(inserted.sliceString(0, undefined, u.state.lineBreak)).length;
        delta -= encodeSourceText(u.startState.sliceDoc(fromA, toA)).length;
      });
      bytes += delta;
      scheduleIndent();
      scheduleInvisibles();
    }
    schedule({ facts: u.docChanged || u.startState.tabSize !== u.state.tabSize, caret: u.docChanged || u.selectionSet });
    if (u.selectionSet || u.docChanged || u.viewportChanged || u.geometryChanged) ruler?.update();
    if (u.geometryChanged || u.docChanged) layoutMarks();
    const queryChanged = u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)));
    if (u.docChanged || queryChanged || searchPanelOpen(u.state) !== searchPanelOpen(u.startState)) scheduleFind();
  };

  renderPath();
  renderBufferFacts();
  readIndent(null);
  renderLiveFacts();

  return {
    body,
    extension: EditorView.updateListener.of(onUpdate),
    attach(editor) {
      view = editor;
      if (!opts.wraps) {
        ruler = createRuler(editor);
        root.insertBefore(ruler.element, body);
      }
      readIndent(editor.state);
      renderLiveFacts();
      readCaret();
      ruler?.update();
      scanInvisibles(editor.state);
    },
    bind(next) {
      if (destroyed) return;
      const same = next.bytes === buffer.bytes && next.path === buffer.path;
      buffer = next;
      dirty = false;
      if (same) {
        schedule({ caret: true });
        return;
      }
      bytes = next.bytes.length;
      renderPath();
      renderBufferFacts();
      if (view !== null) {
        readIndent(view.state);
        scanInvisibles(view.state);
      }
      renderLiveFacts();
      schedule({ caret: true });
    },
    destroy() {
      destroyed = true;
      scanToken++;
      if (frameId !== 0) cancelAnimationFrame(frameId);
      for (const timer of [indentTimer, marksTimer, invisibleTimer]) if (timer !== null) clearTimeout(timer);
      ruler?.destroy();
      root.remove();
    },
  };
}
