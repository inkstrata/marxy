// The tray's page and a file's reply page, app pages over the page area. The tray lists what `y`
// collected, in order, each with its source and its exact text and a line of note: reorder, remove, copy all as Markdown,
// write it to a new file, clear. A reply lays a file's margin notes out the same way, each under the lines it is on. On
// either page `j` and `k` move between pieces; on the tray `Alt+↑`/`Alt+↓` reorder, `d` removes and `n` goes to the note.
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../app-types.ts';
import { writeCopy } from '../commands/copy-write.ts';
import { isUntitled } from '../document/untitled.ts';
import { openAppPage, type AppPage } from '../frame/app-page.ts';
import { notify } from '../notices/index.ts';
import { buildAppContext } from '../selection/bind.ts';
import { notesFor, onNotes } from '../notes/store.ts';
import { pieceRef, piecesAsMarkdown, replyPieces, type Piece } from './markdown.ts';
import { clearTray, dropPiece, movePiece, notePiece, onTray, trayPieces } from './tray.ts';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, act: string, run: () => void, primary = false): HTMLButtonElement {
  const b = el('button', 'marxy-btn', label);
  b.type = 'button';
  b.toggleAttribute('data-marxy-primary', primary);
  b.setAttribute('data-marxy-page-act', act);
  b.addEventListener('click', run);
  return b;
}

/**
 * Writes `text` as a new file named `stem-N.md` in `dir`, the first N free; `writeFileNew` never writes over a file. The
 * path written, or null when the shell refused every name.
 */
export async function writeNewFile(handle: AppHandle, dir: string, stem: string, text: string): Promise<string | null> {
  const bytes = new TextEncoder().encode(text);
  for (let n = 1; n <= 200; n++) {
    const path = `${dir.replace(/[\\/]+$/, '')}/${stem}${n === 1 ? '' : `-${n}`}.md`;
    try {
      // The reader asked for this file to be made: the name is theirs, though its folder (an index root) is read-only.
      await handle.shell.markOpened?.(path).catch(() => undefined);
      await handle.shell.writeFileNew(path, bytes);
      return path;
    } catch (e) {
      if ((e as { code?: unknown })?.code === 'exists' || /exists/i.test(String((e as { message?: unknown })?.message ?? e))) continue;
      notify({ kind: 'error', text: `Could not write ${basename(path)}: ${String((e as { message?: unknown })?.message ?? e)} · nothing was written` });
      return null;
    }
  }
  return null;
}

/** The folder new files from the tray go in: the workspace the focused file is in, else its folder. */
async function workspaceOf(handle: AppHandle, pieces: readonly Piece[]): Promise<string | null> {
  const path = pieces[0]?.path ?? handle.currentPath();
  if (!path || !path.includes('/')) return null;
  const root = await handle.index.rootFor(path).catch(() => null);
  return root ?? dirname(path);
}

/** Draws `pieces` as rows into `list`; `editable` adds the tray's reorder, remove and note. */
function rows(list: HTMLElement, pieces: readonly Piece[], editable: boolean, handle: AppHandle, page: AppPage): void {
  list.replaceChildren();
  pieces.forEach((p, i) => {
    const row = el('div', 'marxy-piece');
    row.setAttribute('data-marxy-piece', String(i));
    row.tabIndex = -1;
    const src = el('button', 'marxy-piece-src', pieceRef(p));
    src.type = 'button';
    src.title = 'Go to where this came from';
    src.addEventListener('click', () => {
      page.close();
      void goTo(handle, p);
    });
    const text = el('pre', 'marxy-piece-text', p.text);
    row.append(src, text);
    if (editable) {
      const note = el('input', 'marxy-piece-note');
      note.type = 'text';
      note.placeholder = 'A line of note';
      note.value = p.note;
      note.setAttribute('aria-label', `Note on ${pieceRef(p)}`);
      note.addEventListener('change', () => notePiece(i, note.value));
      note.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          if (e.key === 'Enter') notePiece(i, note.value);
          (list.querySelector<HTMLElement>(`[data-marxy-piece="${i}"]`) ?? list).focus();
        }
      });
      const acts = el('div', 'marxy-piece-acts');
      acts.append(
        button('Up', 'up', () => movePiece(i, -1)),
        button('Down', 'down', () => movePiece(i, 1)),
        button('Remove', 'remove', () => dropPiece(i)),
      );
      row.append(note, acts);
    } else if (p.note) {
      row.append(el('p', 'marxy-piece-said', p.note));
    }
    list.append(row);
  });
}

async function goTo(handle: AppHandle, p: Piece): Promise<void> {
  await handle.open(p.path);
  if (p.address !== undefined) {
    // A part of a page of the app's own: found by its address once the page is drawn.
    const { partsSeek } = await import('../parts/cursor.ts');
    for (let i = 0; i < 30 && !partsSeek(p.address); i++) await new Promise((r) => requestAnimationFrame(r));
    return;
  }
  const store = handle.document();
  if (!store || store.snapshot().path !== p.path) return;
  const bytes = store.snapshot().buffer.bytes;
  let line = 1;
  let at = 0;
  for (; at < bytes.length && line < p.first; at++) if (bytes[at] === 0x0a) line++;
  await handle.open(p.path, { at });
}

/** j, k between rows; the tray's d, n and Alt+arrows. Focus is kept on a row so the keys stay the page's. */
function pageKeys(column: HTMLElement, listOf: () => HTMLElement, editable: boolean): void {
  column.tabIndex = -1;
  const current = (): number => Number((document.activeElement as HTMLElement | null)?.closest?.('[data-marxy-piece]')?.getAttribute('data-marxy-piece') ?? -1);
  const focusRow = (i: number): void => {
    const all = listOf().querySelectorAll<HTMLElement>('[data-marxy-piece]');
    const row = all[Math.max(0, Math.min(i, all.length - 1))];
    row?.focus();
    row?.scrollIntoView({ block: 'nearest' });
  };
  column.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey) return;
    const list = listOf();
    const i = current();
    let handled = true;
    if (e.key === 'j' && !e.altKey) focusRow(i + 1);
    else if (e.key === 'k' && !e.altKey) focusRow(i - 1);
    else if (editable && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && i >= 0) {
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      if (movePiece(i, dir)) queueMicrotask(() => focusRow(i + dir));
    } else if (editable && e.key === 'd' && !e.altKey && i >= 0) {
      dropPiece(i);
      queueMicrotask(() => focusRow(i));
    } else if (editable && e.key === 'n' && !e.altKey && i >= 0) list.querySelector<HTMLInputElement>(`[data-marxy-piece="${i}"] .marxy-piece-note`)?.focus();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

let offTray: (() => void) | null = null;

export function openTrayPage(handle: AppHandle): AppPage {
  const page = openAppPage('tray', 'Tray', { wide: true });
  const { column } = page;
  const draw = (): void => {
    if (!column.isConnected) {
      offTray?.();
      offTray = null;
      return;
    }
    const pieces = trayPieces();
    const keep = Number((document.activeElement as HTMLElement | null)?.closest?.('[data-marxy-piece]')?.getAttribute('data-marxy-piece') ?? -1);
    column.replaceChildren(el('h1', 'marxy-apppage-title', 'Tray'));
    if (pieces.length === 0) {
      column.append(el('p', 'marxy-apppage-lead', 'Nothing collected yet. Put the cursor on any part of any document and press y. Each piece keeps the file and lines it came from, so what you gather can be checked. The tray lasts until Marxy closes.'));
      return;
    }
    column.append(el('p', 'marxy-apppage-lead', `${plural(pieces.length, 'piece', 'pieces')}, in the order you took them, each with its source. j and k move between them, Alt+↑ and Alt+↓ reorder, d removes, n writes a line of note. Kept until Marxy closes.`));
    const bar = el('div', 'marxy-page-bar');
    bar.append(
      button('Copy all as Markdown', 'copy', () => void writeCopy(buildAppContext(handle), { text: piecesAsMarkdown(trayPieces()) }, `Copied ${plural(trayPieces().length, 'piece', 'pieces')} as Markdown, each with its source`), true),
      button('Write to a new file', 'file', () => void writeTray(handle, page)),
      button('Clear', 'clear', () => clearTray()),
    );
    const list = el('div', 'marxy-pieces');
    column.append(bar, list);
    rows(list, pieces, true, handle, page);
    if (keep >= 0) (list.querySelector<HTMLElement>(`[data-marxy-piece="${Math.min(keep, pieces.length - 1)}"]`))?.focus();
  };
  offTray?.();
  offTray = onTray(draw);
  draw();
  pageKeys(column, () => column.querySelector<HTMLElement>('.marxy-pieces') ?? column, true);
  column.focus();
  return page;
}

async function writeTray(handle: AppHandle, page: AppPage): Promise<void> {
  const pieces = trayPieces();
  const dir = await workspaceOf(handle, pieces);
  if (!dir) {
    notify({ kind: 'refused', text: 'No folder to write in · nothing was written · open a file first' });
    return;
  }
  const path = await writeNewFile(handle, dir, 'gathered', `# Gathered\n\n${piecesAsMarkdown(pieces)}`);
  if (!path) return;
  page.close();
  await handle.open(path);
  notify({ kind: 'done', text: `Wrote ${basename(path)} with ${plural(pieces.length, 'piece', 'pieces')}` });
}

/** A file's notes as a reply: each under a quote of the lines it is on, with path:lines. */
export function openReplyPage(handle: AppHandle, path: string, text: () => string): AppPage {
  const name = basename(path);
  const page = openAppPage(`reply:${path}`, `Reply to ${name}`, { wide: true });
  const { column } = page;
  const draw = (): void => {
    const pieces = replyPieces(path, text(), notesFor(path));
    column.replaceChildren(el('h1', 'marxy-apppage-title', `Reply to ${name}`));
    if (pieces.length === 0) {
      column.append(el('p', 'marxy-apppage-lead', `No notes on ${name} yet. Press n on any part of it; a reply is your notes, each beside the lines it answers.`));
      return;
    }
    column.append(el('p', 'marxy-apppage-lead', `Your ${plural(pieces.length, 'note', 'notes')}, each under the opening of the part it answers and where that is. Paste it back to whoever, or whatever, wrote the file.`));
    const bar = el('div', 'marxy-page-bar');
    bar.append(
      button('Copy as Markdown', 'copy', () => void writeCopy(buildAppContext(handle), { text: piecesAsMarkdown(pieces) }, 'Copied the reply as Markdown'), true),
      button('Write to a file', 'file', () => void writeReply(handle, page, path, pieces)),
    );
    const list = el('div', 'marxy-pieces');
    column.append(bar, list);
    rows(list, pieces, false, handle, page);
  };
  const off = onNotes((p) => {
    if (!column.isConnected) off();
    else if (p === path) draw();
  });
  draw();
  pageKeys(column, () => column, false);
  column.focus();
  return page;
}

async function writeReply(handle: AppHandle, page: AppPage, path: string, pieces: readonly Piece[]): Promise<void> {
  if (isUntitled(path)) {
    notify({ kind: 'refused', text: 'This document is not saved yet, so it has no folder · nothing was written · Save it first, or copy the reply' });
    return;
  }
  const stem = basename(path).replace(/\.[^.]+$/, '');
  const written = await writeNewFile(handle, dirname(path), `${stem}.reply`, `# Reply to ${basename(path)}\n\n${piecesAsMarkdown(pieces)}`);
  if (!written) return;
  page.close();
  await handle.open(written);
  notify({ kind: 'done', text: `Wrote ${basename(written)}` });
}
