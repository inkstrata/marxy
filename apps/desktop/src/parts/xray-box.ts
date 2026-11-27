// A part's stored form drawn for `x`, in the depths' x-ray box (depths/dress.ts draws its look):
// bytes sixteen to a row at their offsets, for a part that owns a run of the file's bytes (a chunk, a box, a table, an
// entry's header); or the nearest stored form as lines, said where it comes from ("from xl/worksheets/sheet1.xml").
import { hex2 } from '@marxy/core/src/viewer/bytes.ts';

function box(head: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'marxy-xray';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', head);
  const h = document.createElement('div');
  h.className = 'marxy-xray-head';
  h.setAttribute('data-marxy-xray-head', head);
  el.append(h);
  return el;
}

function line(no: string, text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'marxy-xray-line';
  row.setAttribute('data-marxy-line', no);
  const t = document.createElement('span');
  t.className = 'marxy-xray-text';
  t.textContent = text;
  row.append(t);
  return row;
}

/** Rows drawn at most: a long run says how many more there are. */
const ROWS = 64;

/** `bytes` as stored at file offset `from`: offset, the bytes in hex, then as text. */
export function bytesBox(head: string, bytes: Uint8Array, from: number): HTMLElement {
  const el = box(head);
  const digits = Math.max(4, (from + bytes.length).toString(16).length);
  const rows = Math.ceil(bytes.length / 16);
  for (let r = 0; r < Math.min(rows, ROWS); r++) {
    const s = bytes.subarray(r * 16, r * 16 + 16);
    const hex = [...s].map(hex2).join(' ').padEnd(47, ' ');
    const text = [...s].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·')).join('');
    el.append(line((from + r * 16).toString(16).toUpperCase().padStart(digits, '0'), `${hex}  ${text}`));
  }
  if (rows > ROWS) el.append(line('', `… ${(bytes.length - ROWS * 16).toLocaleString('en-GB')} more bytes: Source (\\) has every one`));
  return el;
}

/** The nearest stored form as numbered lines, its head saying where it comes from. */
export function textBox(head: string, lines: readonly string[]): HTMLElement {
  const el = box(head);
  lines.slice(0, ROWS * 4).forEach((text, i) => el.append(line(String(i + 1), text)));
  if (lines.length > ROWS * 4) el.append(line('', `… ${(lines.length - ROWS * 4).toLocaleString('en-GB')} more lines`));
  return el;
}
