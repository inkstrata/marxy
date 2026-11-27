// The hex view: every byte of a file, sixteen to a row, with text where bytes are printable. Drawn a window of rows at
// a time over a scroll space that maps by proportion past a few million pixels (core viewer/hex.ts), and read a range at a
// time through the shell, never whole, so a 2 GB file shows its first screen at once and its last byte one key away. A
// byte picked is named in the panel (a passing card); arrows move it. Nothing here can change a byte.
import { hex2 } from '@marxy/core/src/viewer/bytes.ts';
import { HEX_ROW_PX, firstRowAt, hexGeometry, offsetDigits, offsetLabel, parseOffset, rowsInView, scrollTopFor, type HexGeometry } from '@marxy/core/src/viewer/hex.ts';
import { el } from '../frame/dom.ts';
import { icon } from '../frame/icons.ts';
import { notify } from '../notices/index.ts';
import { sizeLine, type ViewedFile } from './file.ts';
import { viewerChanged } from './signal.ts';
import type { HexPlace, PartTree, PartUnit } from './types.ts';
import { maxOf, minOf } from '@marxy/core/src/util/spread.ts';

/** What the view reads at a time: a screen is a few hundred bytes, so one read covers many screens. */
const CHUNK = 64 * 1024;
/** Chunks kept: 2 MB of the file at most, the least recently drawn let go first. */
const KEEP = 32;
/** Bytes a row, widest first: the view takes the first whose columns fit the pane. */
const PERS = [16, 8, 4] as const;
/** The bytes column in ch, as frame.css sets it: 2.4ch cells, 0.2ch apart, and 0.8ch more between two halves of sixteen. */
const bytesCh = (per: number): number => per * 2.4 + (per - 1) * 0.2 + (per > 8 ? 1 : 0);
const bytesColumns = (per: number): string => (per > 8 ? `repeat(${per / 2}, 2.4ch) 0.8ch repeat(${per / 2}, 2.4ch)` : `repeat(${per}, 2.4ch)`);

export interface HexView {
  readonly el: HTMLElement;
  /** The byte picked, or null. */
  selected(): number | null;
  /** Up to four bytes from the one picked, as far as they are read. */
  bytesAt(offset: number, n: number): Uint8Array | null;
  /** Draws the rows in view again (after the pane is resized or shown). */
  draw(): void;
  /** Picks `offset` and scrolls it into view. */
  goTo(offset: number): void;
  /** Where the reader is: the byte picked and the byte at the top of the screen. */
  place(): HexPlace;
  /** Puts the reader back at `place` (clamped to the file as it is now) once the view is on screen and laid out. */
  restore(place: HexPlace): void;
  key(e: KeyboardEvent): boolean;
  /** Its rows as the cursor's parts: each row of bytes, addressed by its offset; only read. */
  parts(): PartTree;
  destroy(): void;
}

export function createHexView(file: ViewedFile, read: (offset: number, length: number) => Promise<Uint8Array>): HexView {
  const size = file.size;
  const root = el('div', 'marxy-hex');
  const bar = el('div', 'marxy-hexbar');
  const what = el('span', 'marxy-hexbar-what', `${sizeLine(file)}${file.magic && file.magic.len > 0 ? ` · the first ${file.magic.len} bytes are ${file.magic.name}` : ''}`);
  const go = el('label', 'marxy-hexbar-go');
  go.append(el('span', 'marxy-hexbar-go-label', 'Go to'));
  const input = el('input', 'marxy-hexbar-input');
  input.type = 'text';
  input.spellcheck = false;
  input.placeholder = '0x1F00 or 8000';
  input.setAttribute('aria-label', 'Go to a byte offset, in hex or decimal');
  go.append(input);
  const end = el('button', 'marxy-icon-button marxy-hexbar-end');
  end.type = 'button';
  end.title = 'To the last byte (Ctrl+End)';
  end.setAttribute('aria-label', 'To the last byte');
  end.append(icon('toend'));
  bar.append(what, el('span', 'marxy-grow'), go, end);
  const head = el('div', 'marxy-hexhead');
  head.setAttribute('aria-hidden', 'true');
  const headBytes = el('span', 'marxy-hex-b');
  const headText = el('span', 'marxy-hex-a', 'As text');
  head.append(el('span', 'marxy-hex-o', 'Offset'), headBytes, headText);
  // Sixteen digits in the rows' face: the width of a ch, which the columns are counted in.
  const probe = el('span', 'marxy-hex-probe', '0'.repeat(16));
  probe.setAttribute('aria-hidden', 'true');
  const scroll = el('div', 'marxy-hexscroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'grid');
  scroll.setAttribute('aria-label', `The bytes of ${file.path.slice(file.path.lastIndexOf('/') + 1)}`);
  const space = el('div', 'marxy-hexspace');
  const rowsEl = el('div', 'marxy-hexrows');
  space.append(rowsEl);
  scroll.append(space);
  root.append(bar, head, scroll, probe);

  const digits = offsetDigits(size);
  root.style.setProperty('--marxy-hex-digits', String(digits));
  const magicLen = file.magic?.len ?? 0;
  const chunks = new Map<number, Uint8Array>();
  const pending = new Map<number, Promise<void>>();
  /** Chunks the shell answered short: the file is shorter than it was said to be, so asking again changes nothing. */
  const short = new Set<number>();
  let per = 16;
  let g: HexGeometry = hexGeometry(size, per);
  let fitWidth = -1;
  let fitHeight = 0;
  let first = 0;
  let sel: number | null = null;
  let placeTo: HexPlace | null = null;
  /** The cursor's rows, by their first byte: the head, and the run's first and last. */
  let marked: { head: number; from: number; to: number } | null = null;
  let gone = false;
  let frame = 0;

  // The head is the first chunk's start: the first screen draws with no read at all.
  if (file.head.length > 0) chunks.set(0, file.head);

  const chunkOf = (offset: number): number => Math.floor(offset / CHUNK);
  function byteAt(offset: number): number | null {
    const c = chunks.get(chunkOf(offset));
    const i = offset - chunkOf(offset) * CHUNK;
    return c && i < c.length ? c[i]! : null;
  }
  function want(index: number): void {
    const have = chunks.get(index);
    const full = Math.min(CHUNK, size - index * CHUNK);
    if ((have && have.length >= full) || short.has(index) || pending.has(index)) return;
    const p = read(index * CHUNK, full)
      .then((bytes) => {
        if (gone) return;
        chunks.delete(index);
        chunks.set(index, bytes);
        if (bytes.length < full) short.add(index);
        while (chunks.size > KEEP) {
          const old = chunks.keys().next().value!;
          chunks.delete(old);
          short.delete(old);
        }
        schedule();
        if (sel !== null && chunkOf(sel) === index) viewerChanged();
      })
      .catch((e: unknown) => {
        if (!gone) console.warn(`marxy: bytes ${index * CHUNK} on of ${file.path} could not be read: ${String(e)}`);
      })
      .finally(() => pending.delete(index));
    pending.set(index, p);
  }

  /** The most bytes a row whose offset, bytes and text fit `width` with the head's padding and gaps (which narrow with the pane). */
  function perFor(width: number): number {
    const ch = probe.getBoundingClientRect().width / 16;
    if (width <= 0 || ch <= 0) return per;
    const cs = getComputedStyle(head);
    const room = width - (Number.parseFloat(cs.paddingLeft) || 0) - (Number.parseFloat(cs.paddingRight) || 0) - 2 * (Number.parseFloat(cs.columnGap) || 0);
    return PERS.find((n) => (digits + bytesCh(n) + n) * ch <= room) ?? PERS[PERS.length - 1];
  }

  function layout(): void {
    const width = scroll.clientWidth;
    const next = width === fitWidth && g.rows > 0 ? per : perFor(width);
    if (width !== fitWidth) root.style.setProperty('--marxy-hex-gutter', `${Math.max(0, scroll.offsetWidth - width)}px`);
    fitWidth = width;
    const height = scroll.clientHeight;
    const heightChanged = fitHeight > 0 && height > 0 && height !== fitHeight && g.rows > 0;
    if (height > 0) fitHeight = height;
    if (next === per && heightChanged && g.proportional) {
      // The proportional map divides by the viewport, so a new height moves the top row unless it is pinned.
      scroll.scrollTop = scrollTopFor(g, first + Math.floor(rowsInView(height) / 3), height);
    }
    if (next !== per || g.rows === 0) {
      const top = g.rows > 0 ? first * per : null;
      per = next;
      g = hexGeometry(size, per);
      root.style.setProperty('--marxy-hex-per', String(per));
      root.style.setProperty('--marxy-hex-bytes', bytesColumns(per));
      root.toggleAttribute('data-marxy-narrow', per < 16);
      headBytes.replaceChildren(...Array.from({ length: per }, (_, k) => el('i', '', hex2(k))));
      headText.textContent = per < 8 ? 'Text' : 'As text';
      space.style.height = `${g.space}px`;
      // A new row width keeps the byte that was at the top of the screen there.
      if (top !== null && top > 0) {
        const view = scroll.clientHeight || 600;
        scroll.scrollTop = scrollTopFor(g, Math.floor(top / per) + Math.floor(rowsInView(view) / 3), view);
      }
    }
    space.style.height = `${g.space}px`;
  }

  function draw(): void {
    frame = 0;
    if (gone) return;
    // Scrolling an element that is not laid out yet is lost: a place waits for the first draw on screen.
    if (placeTo && scroll.clientHeight > 0) settle(placeTo);
    layout();
    const view = scroll.clientHeight || 600;
    first = firstRowAt(g, scroll.scrollTop, view);
    const count = Math.min(g.rows - first, rowsInView(view) + 2);
    const from = first * per;
    const to = Math.min(size, (first + count) * per);
    for (let c = chunkOf(from); c <= chunkOf(Math.max(from, to - 1)); c++) want(c);
    const rows: HTMLElement[] = [];
    for (let r = 0; r < count; r++) {
      const at = (first + r) * per;
      const row = el('div', 'marxy-hexrow');
      row.style.top = `${r * HEX_ROW_PX}px`;
      const bytes = el('span', 'marxy-hex-b');
      const text = el('span', 'marxy-hex-a');
      for (let k = 0; k < per; k++) {
        const i = at + k;
        if (i >= size) {
          bytes.append(el('i', 'marxy-hex-none'));
          continue;
        }
        const b = byteAt(i);
        const cell = el('i', '', b === null ? '··' : hex2(b));
        const ch = el('i', '', b === null ? ' ' : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·');
        cell.dataset.marxyByte = String(i);
        ch.dataset.marxyByte = String(i);
        if (b === 0) cell.classList.add('marxy-hex-zero');
        if (b !== null && (b < 0x20 || b >= 0x7f)) ch.classList.add('marxy-hex-np');
        if (i < magicLen) {
          cell.classList.add('marxy-hex-magic');
          ch.classList.add('marxy-hex-magic');
        }
        if (i === sel) {
          cell.setAttribute('data-marxy-on', '');
          ch.setAttribute('data-marxy-on', '');
        }
        bytes.append(cell);
        text.append(ch);
      }
      row.append(el('span', 'marxy-hex-o', offsetLabel(at, digits)), bytes, text);
      row.dataset.marxyRow = String(at);
      if (marked && at >= marked.from && at <= marked.to) row.classList.add('marxy-selected');
      if (marked && at === marked.head) row.classList.add('marxy-cursor');
      rows.push(row);
    }
    rowsEl.style.transform = `translateY(${scroll.scrollTop}px)`;
    rowsEl.replaceChildren(...rows);
  }

  function settle(p: HexPlace): void {
    placeTo = null;
    const last = Math.max(0, size - 1);
    sel = p.selected === null ? null : Math.max(0, Math.min(last, p.selected));
    layout();
    const view = scroll.clientHeight || 600;
    const row = p.top !== null ? Math.floor(Math.min(last, p.top) / per) + Math.floor(rowsInView(view) / 3) : sel !== null ? Math.floor(sel / per) : 0;
    scroll.scrollTop = scrollTopFor(g, row, view);
    viewerChanged();
  }

  function schedule(): void {
    if (frame === 0) frame = requestAnimationFrame(draw);
  }

  function goTo(offset: number): void {
    sel = Math.max(0, Math.min(size - 1, offset));
    layout();
    scroll.scrollTop = scrollTopFor(g, Math.floor(sel / per), scroll.clientHeight || 600);
    draw();
    viewerChanged();
  }

  function move(by: number): void {
    if (sel === null) return;
    const next = Math.max(0, Math.min(size - 1, sel + by));
    sel = next;
    const row = Math.floor(next / per);
    const inView = rowsInView(scroll.clientHeight || 600);
    if (row < first || row >= first + inView) {
      layout();
      scroll.scrollTop = scrollTopFor(g, row, scroll.clientHeight || 600);
    }
    draw();
    viewerChanged();
  }

  function key(e: KeyboardEvent): boolean {
    if (e.target === input) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'End') {
      goTo(size - 1);
      return true;
    }
    if (mod && e.key === 'Home') {
      goTo(0);
      return true;
    }
    if (sel === null || mod || e.altKey) return false;
    const by = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: per, ArrowUp: -per, PageDown: per * rowsInView(scroll.clientHeight || 600), PageUp: -per * rowsInView(scroll.clientHeight || 600) } as Record<string, number>)[e.key];
    if (by === undefined) return false;
    move(by);
    return true;
  }

  scroll.addEventListener('scroll', schedule, { passive: true });
  scroll.addEventListener('click', (e) => {
    const cell = (e.target as Element).closest<HTMLElement>('[data-marxy-byte]');
    if (!cell) return;
    sel = Number(cell.dataset.marxyByte);
    draw();
    viewerChanged();
  });
  scroll.addEventListener('keydown', (e) => {
    if (key(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const off = parseOffset(input.value, size);
    if (off === null) {
      notify({ kind: 'info', text: `No byte at ${input.value.trim() || 'that offset'}: the file has ${size.toLocaleString('en-GB')} bytes.` }, { pane: root.closest<HTMLElement>('section.marxy-pane') ?? undefined });
      return;
    }
    goTo(off);
    scroll.focus();
  });
  end.addEventListener('click', () => {
    goTo(size - 1);
    scroll.focus();
  });
  // The probe changes size with the type size (Look) or a late font, which can change what fits at the same width.
  const resize = new ResizeObserver(() => {
    fitWidth = -1;
    schedule();
  });
  resize.observe(scroll);
  resize.observe(probe);

  /** The row holding `offset`, as a part. */
  function rowUnit(index: number): PartUnit {
    const at = index * per;
    const n = Math.min(per, size - at);
    return {
      id: `@${at}`,
      label: 'row',
      address: `@0x${offsetLabel(at, 4)}`,
      at,
      el() {
        const inView = rowsInView(scroll.clientHeight || 600);
        if (index < first || index >= first + inView - 1) {
          layout();
          scroll.scrollTop = scrollTopFor(g, index, scroll.clientHeight || 600);
        }
        draw();
        return rowsEl.querySelector<HTMLElement>(`.marxy-hexrow[data-marxy-row="${at}"]`);
      },
      async stored() {
        const got = await read(at, n);
        return [...got].map(hex2).join(' ');
      },
    };
  }
  const rowCount = (): number => Math.max(1, Math.ceil(size / per));
  const unitAt = (offset: number): PartUnit | null => (size === 0 || offset < 0 || offset >= size ? null : rowUnit(Math.floor(offset / per)));
  const tree: PartTree = {
    top: () => Array.from({ length: Math.min(rowCount(), rowsInView(scroll.clientHeight || 600)) }, (_, i) => rowUnit(first + i)).filter((u) => (u.at ?? 0) < size),
    find: (id) => unitAt(Number(id.slice(1))),
    start: () => unitAt((first + Math.floor(rowsInView(scroll.clientHeight || 600) / 3)) * per) ?? unitAt(0),
    parent: () => null,
    readOnly: true,
    sibling: (u, dir) => unitAt((u.at ?? 0) + dir * per),
    drawn: (u) => rowsEl.querySelector<HTMLElement>(`.marxy-hexrow[data-marxy-row="${u.at ?? 0}"]`),
    edge: (edge) => unitAt(edge === 'first' ? 0 : (rowCount() - 1) * per),
    mark(head, run) {
      const ats = run.map((u) => u.at ?? 0);
      marked = head ? { head: head.at ?? 0, from: minOf(ats), to: maxOf(ats) } : null;
      // A byte picked in the cursor's row stays picked: the row holds it.
      const at = head?.at ?? 0;
      if (head && (sel === null || sel < at || sel >= at + per)) sel = at;
      draw();
      viewerChanged();
    },
  };

  return {
    el: root,
    parts: () => tree,
    selected: () => sel,
    bytesAt(offset, n) {
      const out: number[] = [];
      for (let i = 0; i < n && offset + i < size; i++) {
        const b = byteAt(offset + i);
        if (b === null) break;
        out.push(b);
      }
      return out.length > 0 ? Uint8Array.from(out) : null;
    },
    draw,
    goTo,
    place: () => placeTo ?? { selected: sel, top: first * per },
    restore(p) {
      placeTo = p;
      // Picked at once, so the panel names the byte before the view is drawn.
      if (p.selected !== null) sel = Math.max(0, Math.min(Math.max(0, size - 1), p.selected));
      schedule();
    },
    key,
    destroy() {
      gone = true;
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      chunks.clear();
      root.remove();
    },
  };
}
