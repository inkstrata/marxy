// Notes where you read (proposal `notes_in_place`). Where the pane has room at the right of the column, each note sits in
// the margin beside the line that calls it, laid out again when the pane's width or the page changes.
// Where it has none, a note number opens its note in a box under its line and a second click closes it, instead of sending
// the reader to the end of the page and back. Either is the page's own copy of the note: it holds no bytes of its own, and
// the page set again (a reload, a relayout) drops it.
import type { AppHandle } from '../app-types.ts';
import { onProposals, proposalOn } from './state.ts';

const OPEN = 'marxy-note-here';
const MARGIN = 'marxy-note-margin';
/** Room the margin needs at the column's right for a note to be read there, and the widest a margin note grows. */
const ROOM_PX = 170;
const WIDEST_PX = 280;
/** The Shape strip's width, which stands in for the scrollbar at the pane's right (proposals/minimap.ts). */
const STRIP_PX = 16;
/** A scrollbar's room where the strip is off. */
const SCROLLBAR_PX = 12;
/** Kept clear between a margin note and the strip or scrollbar. */
const EDGE_GAP_PX = 12;
/** Kept clear between a margin note and the note or wide block above it. */
const GAP_PX = 8;

function holder(ref: Element): { readonly after: Element } | { readonly inside: Element } | null {
  const block = ref.closest('p, li, dd, h1, h2, h3, h4, h5, h6');
  if (block) return { after: block };
  const cell = ref.closest('td, th');
  return cell ? { inside: cell } : null;
}

const paneSectionOf = (article: HTMLElement): HTMLElement | null => article.closest<HTMLElement>('section.marxy-pane');

const noteId = (link: Element): string => decodeURIComponent(link.getAttribute('href')!.slice(1));

/** The page's copy of a note: its number and its blocks, the back link and every claim on the file's bytes left out. */
function copyOf(cls: string, id: string, label: string, note: HTMLElement): HTMLElement {
  const box = document.createElement('aside');
  box.className = cls;
  box.dataset.marxyNote = id;
  box.setAttribute('aria-label', `Note ${label}`);
  const num = document.createElement('span');
  num.className = 'marxy-note-here-n';
  num.textContent = label;
  const body = document.createElement('div');
  for (const child of note.children) if (!child.classList.contains('marxy-footnote-back')) body.append(child.cloneNode(true));
  // The copy is the page's, not the file's: its provenance would be a second claim on the note's bytes.
  for (const el of [body, ...body.querySelectorAll('*')]) {
    el.removeAttribute('data-marxy-s');
    el.removeAttribute('data-marxy-e');
    el.removeAttribute('id');
  }
  box.append(num, body);
  return box;
}

/**
 * The room at the right of `article`'s column, in pixels, to the pane's right edge less the Shape strip (or the scrollbar
 * where the strip is off); 0 when the page is not shown. The pane's edge, not the window's: a drawer or the panel docked
 * beside it takes the room.
 */
function roomOf(article: HTMLElement): number {
  const box = article.getBoundingClientRect();
  const pane = article.closest('.marxy-pane')?.getBoundingClientRect();
  if (!pane || box.width === 0) return 0;
  const edge = pane.right - (article.closest('[data-marxy-mmap]') ? STRIP_PX : SCROLLBAR_PX);
  return Math.max(0, edge - box.right - EDGE_GAP_PX);
}

/** Whether the notes of `article` are in its margin now. */
export const notesInMargin = (article: HTMLElement): boolean => article.hasAttribute('data-marxy-notes-margin');

/**
 * Per article, the page its notes were placed for (its first note number) and the boxes now in its margin: a resize lays
 * out only a page that has notes and is still that page, and takes the boxes out without a search of the page.
 */
const laid = new WeakMap<HTMLElement, { readonly first: Element; boxes: HTMLElement[] }>();

/** The note `id` in `article`: by id first, the attribute search only when a pane beside holds the same page's ids. */
function noteIn(article: HTMLElement, id: string): HTMLElement | null {
  const byId = article.ownerDocument.getElementById(id);
  if (byId && article.contains(byId)) return byId;
  return byId ? article.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) : null;
}

/**
 * The markup each margin box was copied from, to tell a box that still copies its note from one whose note was rewritten.
 * Markup, not text: code in a note is coloured after the notes are placed, and that changes no character.
 */
const copies = new WeakMap<HTMLElement, string>();

const sameCopy = (box: HTMLElement, article: HTMLElement, id: string, label: string, note: HTMLElement): boolean =>
  box.parentElement === article && box.dataset.marxyNote === id && box.firstElementChild?.textContent === label && copies.get(box) === note.innerHTML;

function takeOut(article: HTMLElement): void {
  const state = laid.get(article);
  if (state) for (const box of state.boxes.splice(0)) box.remove();
}

const marginListeners = new Set<() => void>();

/** Told when an article's notes go into the margin or come out of it: the Notes card says which. */
export function onNotesMargin(cb: () => void): () => void {
  marginListeners.add(cb);
  return () => marginListeners.delete(cb);
}

function mark(article: HTMLElement, inMargin: boolean): void {
  if (notesInMargin(article) === inMargin) return;
  article.toggleAttribute('data-marxy-notes-margin', inMargin);
  for (const cb of [...marginListeners]) cb();
}

/**
 * A change replaced in place keeps a note opened under its line, but may have drawn its note again: the box copies the
 * note as it is now.
 */
function refreshOpen(article: HTMLElement): void {
  for (const box of article.querySelectorAll<HTMLElement>(`.${OPEN}`)) {
    const id = box.dataset.marxyNote ?? '';
    const note = noteIn(article, id);
    if (!note) continue;
    const fresh = copyOf(OPEN, id, box.firstElementChild?.textContent ?? '', note);
    if (fresh.lastElementChild!.innerHTML !== box.lastElementChild?.innerHTML) box.replaceWith(fresh);
  }
}

/**
 * Sets each note of `article` beside the line that calls it when the margin has room, else takes them out of the margin:
 * once the page is set, and when the proposal is turned on or off.
 */
export function placeMarginNotes(article: HTMLElement): void {
  refreshOpen(article);
  takeOut(article);
  const first = proposalOn('notes_in_place') ? article.querySelector('sup.marxy-footnote-ref') : null;
  if (!first) {
    laid.delete(article);
    mark(article, false);
    return;
  }
  laid.set(article, { first, boxes: [] });
  layOut(article);
}

/** Again after `article` resized: nothing for a page without notes, or for a page set again since (idle work places it). */
function relayOut(article: HTMLElement): void {
  const state = laid.get(article);
  if (!state) return;
  if (!article.contains(state.first)) {
    takeOut(article);
    laid.delete(article);
    mark(article, false);
    return;
  }
  layOut(article);
}

/**
 * A note that would overlap the one above it is put just below it, so the notes keep their order and none hides another.
 * Every box is in before the layout is read, and read before any is moved: one layout for the page, not one a note.
 */
function layOut(article: HTMLElement): void {
  const state = laid.get(article)!;
  const room = roomOf(article);
  mark(article, room >= ROOM_PX);
  if (room < ROOM_PX) {
    takeOut(article);
    return;
  }
  const width = Math.min(room - 12, WIDEST_PX);
  const wanted: { readonly link: HTMLAnchorElement; readonly id: string; readonly note: HTMLElement; readonly label: string }[] = [];
  let opened = false;
  for (const link of article.querySelectorAll<HTMLAnchorElement>('sup.marxy-footnote-ref a[href^="#"]')) {
    if (link.parentElement!.hasAttribute('data-marxy-note-open')) opened = true;
    const id = noteId(link);
    const note = noteIn(article, id);
    if (note) wanted.push({ link, id, note, label: link.textContent ?? '' });
  }
  // A note opened under its line is in the margin now, and its number no longer says it is open.
  if (opened) {
    for (const open of article.querySelectorAll(`.${OPEN}`)) open.remove();
    for (const ref of article.querySelectorAll('[data-marxy-note-open]')) ref.removeAttribute('data-marxy-note-open');
  }
  // The boxes already there stay when they still copy the same notes: a page that is still being set calls this every
  // frame, and taking them out and putting them back made the browser lay the whole page out twice each time.
  const kept = state.boxes.length === wanted.length && wanted.every((w, i) => sameCopy(state.boxes[i]!, article, w.id, w.label, w.note));
  if (!kept) {
    takeOut(article);
    state.boxes = wanted.map((w) => copyOf(MARGIN, w.id, w.label, w.note));
    for (const [i, box] of state.boxes.entries()) copies.set(box, wanted[i]!.note.innerHTML);
    if (state.boxes.length > 0) article.append(...state.boxes);
  }
  if (state.boxes.length === 0) return;
  for (const box of state.boxes) if (box.style.width !== `${width}px`) box.style.width = `${width}px`;
  const placed = wanted.map((w, i) => ({ box: state.boxes[i]!, link: w.link }));
  const column = article.getBoundingClientRect();
  const top = column.top;
  const read = placed.map(({ box, link }) => ({ box, line: link.getBoundingClientRect().top - top, height: box.getBoundingClientRect().height }));
  // Code, tables and diagrams run into the same margin (base.css, `--marxy-room`): a note goes below any it would cover.
  const wide: { readonly top: number; readonly bottom: number }[] = [];
  for (const block of article.querySelectorAll('pre, table, .marxy-reading-scroll')) {
    if (block.closest(`.${MARGIN}`)) continue;
    const r = block.getBoundingClientRect();
    if (r.right > column.right + 0.5 && r.height > 0) wide.push({ top: r.top - top, bottom: r.bottom - top });
  }
  let below = -Infinity;
  for (const { box, line, height } of read) {
    let at = Math.max(line, below + GAP_PX);
    for (let moved = true; moved; ) {
      moved = false;
      for (const w of wide) {
        if (at < w.bottom + GAP_PX && at + height + GAP_PX > w.top) {
          at = w.bottom + GAP_PX;
          moved = true;
        }
      }
    }
    const top = `${Math.round(at)}px`;
    if (box.style.top !== top) box.style.top = top;
    below = at + height;
  }
}

export function installNotesInPlace(handle: AppHandle): () => void {
  const onClick = (e: MouseEvent): void => {
    if (!proposalOn('notes_in_place') || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('sup.marxy-footnote-ref a[href^="#"]') : null;
    if (!link) return;
    const pane = handle.panes().panes.find((p) => p.view.host.article.contains(link));
    if (!pane) return;
    const article = pane.view.host.article;
    const id = noteId(link);
    // In the margin the note is already beside its line: a click on its number marks it for a moment.
    const beside = article.querySelector<HTMLElement>(`:scope > .${MARGIN}[data-marxy-note="${CSS.escape(id)}"]`);
    if (beside) {
      e.preventDefault();
      e.stopPropagation();
      beside.setAttribute('data-marxy-flash', '');
      setTimeout(() => beside.removeAttribute('data-marxy-flash'), 1200);
      return;
    }
    const note = article.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    const where = holder(link);
    if (!note || !where) return;
    e.preventDefault();
    e.stopPropagation();
    const ref = link.closest('sup')!;
    const open = article.querySelector<HTMLElement>(`.${OPEN}[data-marxy-note="${CSS.escape(id)}"]`);
    pane.view.holdPlace(() => {
      if (open) {
        open.remove();
        ref.removeAttribute('data-marxy-note-open');
        return;
      }
      const box = copyOf(OPEN, id, link.textContent ?? '', note);
      if ('after' in where) where.after.after(box);
      else where.inside.append(box);
      ref.setAttribute('data-marxy-note-open', '');
    });
  };
  // The margin's room changes with the pane's width (a split, the drawer, the window) and the lines move as the page is
  // set: each article is laid out again a frame after it resizes.
  const queued = new Set<HTMLElement>();
  const sections = new WeakMap<Element, HTMLElement>();
  let frame = 0;
  const resized = new ResizeObserver((entries) => {
    for (const entry of entries) queued.add(sections.get(entry.target) ?? (entry.target as HTMLElement));
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      for (const article of queued) if (article.isConnected) relayOut(article);
      queued.clear();
    });
  });
  const articles = (): HTMLElement[] => handle.panes().panes.map((pane) => pane.view.host.article);
  // A drawer or the panel docking narrows the pane and moves the column without resizing it: the pane is watched too.
  const observeAll = (): void => {
    for (const pane of handle.panes().panes) {
      resized.observe(pane.view.host.article);
      const section = paneSectionOf(pane.view.host.article);
      if (section) {
        sections.set(section, pane.view.host.article);
        resized.observe(section);
      }
    }
  };
  observeAll();
  let gone = false;
  handle.panes().onSplit(() => {
    // onSplit has no way to stop listening: after uninstall a split must not start the observer again.
    if (!gone) observeAll();
    return () => {};
  });
  const offProposals = onProposals((now, before) => {
    if (now.notes_in_place !== before.notes_in_place) for (const article of articles()) placeMarginNotes(article);
  });
  document.addEventListener('click', onClick, { capture: true });
  return () => {
    gone = true;
    document.removeEventListener('click', onClick, { capture: true });
    resized.disconnect();
    cancelAnimationFrame(frame);
    offProposals();
  };
}
