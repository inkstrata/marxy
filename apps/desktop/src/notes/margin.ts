// Margin notes on the page: `n` writes a note on the cursor's part. It is drawn in the margin beside
// the part when the pane has room at the column's right (as footnotes in the margin are), else under the part.
// A click edits it in place; Ctrl+Enter keeps, Escape leaves without keeping, and a note emptied is taken off. The boxes are
// the page's, not the file's: find passes over them and nothing of them is written into the file.
import type { AppHandle } from '../app-types.ts';
import type { Pane } from '../pane/index.ts';
import { lineSpan } from '../selection/cursor.ts';
import { putNote, sameSpot, type Note } from './anchor.ts';
import { flushNotes, notesFor, onNotes, setNotes } from './store.ts';

const BOX = 'marxy-mnote';
/** Room the margin needs at the column's right for a note to sit there, and the widest a margin note grows. */
const ROOM_PX = 194;
const WIDEST_PX = 260;
/** The Shape strip or scrollbar at the pane's right, and a gap before it. */
const EDGE_PX = 28;
/** The gap between the column and a margin note (base.css: `left: calc(100% + 24px)`). */
const INSET_PX = 24;
const GAP_PX = 8;

interface Editing {
  readonly path: string;
  note: Note;
  /** A note already kept, opened to change it, not a new one. */
  readonly held: boolean;
  draft: string;
}

let editing: Editing | null = null;
let redrawAll: () => void = () => {};

type AnyPane = Pane<ReturnType<AppHandle['panes']>['panes'][number]['content']>;

/** Byte offsets where each line of `bytes` starts. */
function lineStarts(bytes: Uint8Array): number[] {
  const out = [0];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) out.push(i + 1);
    else if (bytes[i] === 0x0d && bytes[i + 1] !== 0x0a) out.push(i + 1);
  }
  return out;
}

/** The element on the page that stands for the part a note is on: a carrier starting on its first line, best one ending on its last. */
function carrierFor(article: HTMLElement, bytes: Uint8Array, starts: readonly number[], note: Note): HTMLElement | null {
  const from = starts[note.l0];
  if (from === undefined) return null;
  const to = starts[note.l0 + 1] ?? bytes.length + 1;
  let first: HTMLElement | null = null;
  for (const el of article.querySelectorAll<HTMLElement>('[data-marxy-s]')) {
    if (el.closest(`.${BOX}`)) continue;
    const s = Number(el.getAttribute('data-marxy-s'));
    const e = Number(el.getAttribute('data-marxy-e'));
    if (!(s >= from && s < to)) continue;
    if (lineSpan(bytes, s, e).last === note.l1) return el;
    first ??= el;
  }
  return first;
}

/** Room at the right of `article`'s column, to its pane's edge. */
function roomOf(article: HTMLElement): number {
  const box = article.getBoundingClientRect();
  const pane = article.closest('.marxy-pane')?.getBoundingClientRect();
  if (!pane || box.width === 0) return 0;
  return Math.max(0, pane.right - EDGE_PX - box.right);
}

/** A note's box: its text, or the field while it is being written. Also drawn beside a viewer's parts (notes/part-notes.ts). */
export function noteBox(path: string, note: Note, margin: boolean): HTMLElement {
  const box = document.createElement('aside');
  box.className = BOX;
  box.setAttribute('data-marxy-mnote', note.address ?? String(note.l0));
  box.setAttribute('data-marxy-mnote-at', margin ? 'margin' : 'under');
  box.setAttribute('aria-label', 'Your note');
  if (editing && editing.path === path && sameSpot(editing.note, note)) {
    const field = document.createElement('textarea');
    field.className = 'marxy-mnote-field';
    field.rows = 2;
    field.placeholder = 'A note on this part, kept beside the file, never in it. Ctrl+Enter keeps it, Escape leaves it.';
    field.value = editing.draft;
    const state = editing;
    field.addEventListener('input', () => {
      state.draft = field.value;
    });
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finish(true);
      }
    });
    field.addEventListener('blur', () => {
      // A redraw takes the field away mid-edit; only a blur the reader made ends the edit.
      setTimeout(() => {
        if (editing === state && field.isConnected && document.activeElement !== field) finish(true);
      }, 0);
    });
    box.append(field);
    queueMicrotask(() => {
      if (!field.isConnected) return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    });
  } else {
    box.textContent = note.text;
    box.title = 'Your note: click to change it, empty it to take it off';
    box.addEventListener('click', () => beginNote(path, note));
  }
  return box;
}

/**
 * The kept note an open edit is on, where it stands now: an edit or a reload under the field may have moved it to another
 * line, and keeping the edit at the old one would write it twice. Found as the same note, else the nearest of its text.
 */
function standing(state: Editing): Note {
  const list = notesFor(state.path);
  if (!state.held || state.note.address !== undefined || list.includes(state.note)) return state.note;
  let best: Note | null = null;
  for (const n of list) if (n.address === undefined && n.text === state.note.text && (!best || Math.abs(n.l0 - state.note.l0) < Math.abs(best.l0 - state.note.l0))) best = n;
  return best ?? state.note;
}

/** Ends the edit: kept (Ctrl+Enter, a blur) or left as it was (Escape). */
function finish(keep: boolean): void {
  const state = editing;
  if (!state) return;
  editing = null;
  state.note = standing(state);
  if (keep) {
    setNotes(state.path, putNote(notesFor(state.path), { ...state.note, text: state.draft.trim() }));
  }
  redrawAll();
  // Back to the page, where the keys are.
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest(`.${BOX}`)) active.blur();
}

/** Opens the note on `note`'s line for writing: the one there, or a new empty one. */
export function beginNote(path: string, note: Note): void {
  if (editing) finish(true);
  const held = notesFor(path).find((n) => sameSpot(n, note));
  editing = { path, note: held ?? note, held: held !== undefined, draft: held?.text ?? '' };
  redrawAll();
}

export const noteEditing = (): boolean => editing !== null;

/** Keeps the note still open in its field, then writes notes.json now: the window is going. */
export async function flushNotesAtExit(): Promise<void> {
  finish(true);
  await flushNotes();
}

/** The note being written on `path`, if one is. */
export const editingOn = (path: string): Note | null => (editing?.path === path ? editing.note : null);

const redrawHooks = new Set<() => void>();
/** `cb` draws its notes again whenever the margin's are (an edit begun, kept or left). Returns the off switch. */
export function onNotesRedraw(cb: () => void): () => void {
  redrawHooks.add(cb);
  return () => redrawHooks.delete(cb);
}

function draw(pane: AnyPane): void {
  const article = pane.article;
  for (const old of article.querySelectorAll(`:scope .${BOX}`)) old.remove();
  article.removeAttribute('data-marxy-mnotes-margin');
  const store = pane.content.store();
  if (!store || pane.view.mode !== 'rendered' || article.hidden) return;
  const snap = store.snapshot();
  // A note by address stands beside a viewer's part, never on the text's lines.
  let list = notesFor(snap.path).filter((n) => n.address === undefined);
  if (editing?.path === snap.path && editing.note.address === undefined && !list.some((n) => sameSpot(n, editing!.note))) list = [...list, editing.note].sort((a, b) => a.l0 - b.l0);
  if (list.length === 0) return;
  const bytes = snap.buffer.bytes;
  const starts = lineStarts(bytes);
  const room = roomOf(article);
  const margin = room >= ROOM_PX;
  const placed: { box: HTMLElement; at: HTMLElement }[] = [];
  for (const note of list) {
    const at = carrierFor(article, bytes, starts, note);
    if (!at) continue;
    const box = noteBox(snap.path, note, margin);
    if (margin) {
      box.style.width = `${Math.min(room - INSET_PX, WIDEST_PX)}px`;
      article.append(box);
    } else {
      let top: Element = at;
      while (top.parentElement && top.parentElement !== article) top = top.parentElement;
      top.after(box);
    }
    placed.push({ box, at });
  }
  if (!margin || placed.length === 0) return;
  article.setAttribute('data-marxy-mnotes-margin', '');
  const origin = article.getBoundingClientRect().top;
  // Read every place before moving any box: one layout for the page, not one a note.
  const read = placed.map(({ box, at }) => ({ box, line: at.getBoundingClientRect().top - origin, height: box.getBoundingClientRect().height }));
  let below = -Infinity;
  for (const { box, line, height } of read) {
    const top = Math.max(line, below + GAP_PX);
    box.style.top = `${Math.round(top)}px`;
    below = top + height;
  }
}

export function installMarginNotes(handle: AppHandle): () => void {
  const watched = new Map<HTMLElement, MutationObserver>();
  const queued = new Set<AnyPane>();
  let frame = 0;
  const schedule = (pane: AnyPane): void => {
    queued.add(pane);
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      const now = handle.panes().panes;
      for (const p of queued) if (now.includes(p)) draw(p);
      queued.clear();
    });
  };
  const ours = (nodes: NodeList): boolean => [...nodes].every((n) => n instanceof Element && n.classList.contains(BOX));
  const resized = new ResizeObserver(() => {
    for (const p of handle.panes().panes) schedule(p);
  });
  const watch = (): void => {
    const now = handle.panes().panes;
    for (const [article, mo] of watched) {
      if (now.some((p) => p.article === article)) continue;
      mo.disconnect();
      resized.unobserve(article);
      watched.delete(article);
    }
    for (const pane of now) {
      if (watched.has(pane.article)) continue;
      // The page set again, or more of a long page mounted: the notes go back beside their parts.
      const mo = new MutationObserver((records) => {
        if (records.some((r) => !(ours(r.addedNodes) && ours(r.removedNodes)))) schedule(pane);
      });
      mo.observe(pane.article, { childList: true });
      resized.observe(pane.host);
      watched.set(pane.article, mo);
    }
  };
  redrawAll = () => {
    for (const p of handle.panes().panes) draw(p);
    for (const cb of [...redrawHooks]) cb();
  };
  const offPanes = handle.panes().onChange(() => {
    watch();
    for (const p of handle.panes().panes) schedule(p);
  });
  const offNotes = onNotes((path) => {
    // The field goes with its note when the note moves under it.
    if (editing?.path === path) editing.note = standing(editing);
    for (const p of handle.panes().panes) if (p.content.store()?.snapshot().path === path) schedule(p);
  });
  watch();
  return () => {
    offPanes();
    offNotes();
    resized.disconnect();
    for (const mo of watched.values()) mo.disconnect();
    watched.clear();
    cancelAnimationFrame(frame);
  };
}
