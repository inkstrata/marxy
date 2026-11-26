// The hex view's arithmetic: a window of rows drawn at a time over a scroll space that, past a few million
// pixels, maps by proportion, so one scrollbar covers a 2 GB file and its last byte is one scroll away. Pure.

/** A row's height in CSS pixels. */
export const HEX_ROW_PX = 22;
/** The tallest scroll space the view makes; past it a scroll position maps to a row by proportion. */
export const HEX_MAX_SPACE_PX = 4_000_000;

export interface HexGeometry {
  readonly rows: number;
  /** The height every row would take. */
  readonly full: number;
  /** The scroll space's height: `full`, or the cap. */
  readonly space: number;
  /** Whether a scroll position maps to a row by proportion. */
  readonly proportional: boolean;
}

export function hexGeometry(size: number, perRow: number, rowPx = HEX_ROW_PX, maxSpace = HEX_MAX_SPACE_PX): HexGeometry {
  const rows = Math.ceil(size / perRow);
  const full = rows * rowPx;
  return { rows, full, space: Math.min(full, maxSpace), proportional: full > maxSpace };
}

/** The rows a viewport `viewportPx` tall shows whole. */
export const rowsInView = (viewportPx: number, rowPx = HEX_ROW_PX): number => Math.max(1, Math.floor(viewportPx / rowPx));

/** The first row on screen at `scrollTop`. */
export function firstRowAt(g: HexGeometry, scrollTop: number, viewportPx: number, rowPx = HEX_ROW_PX): number {
  const inView = rowsInView(viewportPx, rowPx);
  const last = Math.max(0, g.rows - inView);
  if (!g.proportional) return Math.max(0, Math.min(Math.floor(scrollTop / rowPx), last));
  const maxTop = Math.max(1, g.space - viewportPx);
  return Math.max(0, Math.min(last, Math.round((scrollTop / maxTop) * last)));
}

/** The scroll position that puts `row` near the top third of the viewport (or on the last screen, at the end). */
export function scrollTopFor(g: HexGeometry, row: number, viewportPx: number, rowPx = HEX_ROW_PX): number {
  const inView = rowsInView(viewportPx, rowPx);
  const last = Math.max(0, g.rows - inView);
  const target = Math.max(0, Math.min(last, row - Math.floor(inView / 3)));
  if (!g.proportional) return target * rowPx;
  const maxTop = Math.max(0, g.space - viewportPx);
  return last === 0 ? 0 : (target / last) * maxTop;
}

/** Hex digits an offset column needs: eight, or ten past 4 GB. */
export const offsetDigits = (size: number): number => (size > 0xffffffff ? 10 : 8);

export const offsetLabel = (offset: number, digits: number): string => offset.toString(16).toUpperCase().padStart(digits, '0');

/**
 * An offset typed into Go to: `0x1F00` or anything with a hex letter is hex, else decimal (`8000`, `8,000`). Null when it
 * names no byte of a file `size` long.
 */
export function parseOffset(text: string, size: number): number | null {
  const s = text.trim();
  if (s === '') return null;
  const hex = /^0x/i.test(s) || /[a-f]/i.test(s);
  const digits = hex ? s.replace(/^0x/i, '') : s.replace(/[,_\s]/g, '');
  if (!(hex ? /^[0-9a-f]+$/i : /^\d+$/).test(digits)) return null;
  const off = Number.parseInt(digits, hex ? 16 : 10);
  return Number.isFinite(off) && off >= 0 && off < size ? off : null;
}

/** What a byte reads as in text: the character, NUL, a line end, or not printable. */
export function byteAsText(b: number): string {
  if (b >= 0x20 && b < 0x7f) return `“${String.fromCharCode(b)}”`;
  if (b === 0) return 'NUL';
  if (b === 0x0a) return 'LF, a line feed';
  if (b === 0x0d) return 'CR, a carriage return';
  if (b === 0x09) return 'a tab';
  return 'not printable';
}

export interface ByteValues {
  readonly value: number;
  /** The byte and the next one, little-endian and big-endian; null at the last byte. */
  readonly le16: number | null;
  readonly be16: number | null;
  /** Four bytes from here, little-endian; null within three of the end. */
  readonly le32: number | null;
}

/** The byte at the start of `bytes` (up to four from the offset picked) and what it reads as in two and four. */
export function byteValues(bytes: Uint8Array): ByteValues {
  const at = (k: number): number | null => (k < bytes.length ? bytes[k]! : null);
  const b = at(0) ?? 0;
  const b1 = at(1);
  const b2 = at(2);
  const b3 = at(3);
  return {
    value: b,
    le16: b1 === null ? null : b | (b1 << 8),
    be16: b1 === null ? null : (b << 8) | b1,
    le32: b1 === null || b2 === null || b3 === null ? null : (b | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0,
  };
}
