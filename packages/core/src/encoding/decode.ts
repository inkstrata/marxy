// The Rust encoding module (`src-tauri/src/encoding`) in the page, for the browser dev loop's memory shell: the same BOM
// rule, the same first byte that is not UTF-8, the same byte map, decoded with `TextDecoder`. The guess is a stand-in for
// chardetng that agrees with it on the fixtures (Windows-1252 for western European text, the CJK encodings when the
// bytes above 7F pair into CJK characters, Windows-1251 for Cyrillic); chardetng also tells KOI8 from Windows-1251, the
// Central European, Greek, Hebrew, Arabic, Thai, Turkish, Baltic and Vietnamese encodings, and EUC-JP from Shift_JIS, and
// it weighs short text differently, so on such files the two can say different encodings. A save in a multi-byte legacy
// encoding is refused here (the page has no encoder for them); Rust writes it.

import type { ByteMap, Deciding, DecodedText, EncodingFound, EncodingHow, EncodingReading, EncodingReadings, Evidence } from './byte-map.ts';

export const CANDIDATES: readonly (readonly [string, string])[] = [
  ['utf-8', 'UTF-8'],
  ['utf-16le', 'UTF-16 LE'],
  ['utf-16be', 'UTF-16 BE'],
  ['windows-1252', 'Windows-1252'],
  ['iso-8859-1', 'ISO-8859-1'],
  ['iso-8859-15', 'ISO-8859-15'],
  ['macintosh', 'Mac Roman'],
  ['windows-1251', 'Windows-1251'],
  ['koi8-r', 'KOI8-R'],
  ['shift_jis', 'Shift_JIS'],
  ['gb18030', 'GB18030'],
  ['euc-kr', 'EUC-KR'],
  ['big5', 'Big5'],
];

const OTHER_NAMES: Readonly<Record<string, string>> = { 'utf-32le': 'UTF-32 LE', 'utf-32be': 'UTF-32 BE', gbk: 'GBK', 'euc-jp': 'EUC-JP', 'koi8-u': 'KOI8-U', ibm437: 'DOS 437', ibm850: 'DOS 850' };

export const GUESS_BYTES = 1024 * 1024;
export const COUNT_BYTES = 8 * 1024 * 1024;
/** Rust's `MIN_GUESS_BYTES`: fewer bytes above 7F, with no UTF-8 beyond ASCII, are stray bytes in UTF-8. */
export const MIN_GUESS_BYTES = 4;
const SAMPLE_BYTES = 120;

export function nameOf(label: string): string {
  return CANDIDATES.find(([l]) => l === label)?.[1] ?? OTHER_NAMES[label] ?? label;
}

export function bomOf(u: Uint8Array): { label: string; len: number } | null {
  if (u[0] === 0xff && u[1] === 0xfe && u[2] === 0 && u[3] === 0) return { label: 'utf-32le', len: 4 };
  if (u[0] === 0 && u[1] === 0 && u[2] === 0xfe && u[3] === 0xff) return { label: 'utf-32be', len: 4 };
  if (u[0] === 0xef && u[1] === 0xbb && u[2] === 0xbf) return { label: 'utf-8', len: 3 };
  if (u[0] === 0xff && u[1] === 0xfe) return { label: 'utf-16le', len: 2 };
  if (u[0] === 0xfe && u[1] === 0xff) return { label: 'utf-16be', len: 2 };
  return null;
}

/** The offset of the first byte that is not UTF-8 (Rust's `valid_up_to`), or -1 when every byte is. */
export function firstNotUtf8Offset(u: Uint8Array, from = 0): number {
  const n = u.length;
  let i = from;
  while (i < n) {
    const b = u[i]!;
    if (b < 0x80) {
      i++;
      continue;
    }
    let need: number;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      if (b === 0xe0) lo = 0xa0;
      if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      if (b === 0xf0) lo = 0x90;
      if (b === 0xf4) hi = 0x8f;
    } else return i;
    const second = u[i + 1];
    if (second === undefined || second < lo || second > hi) return i;
    for (let k = 2; k <= need; k++) {
      const c = u[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return i;
    }
    i += need + 1;
  }
  return -1;
}

/** A lead byte at `i` with at least its next byte a continuation it allows: a character cut short, not a stray byte. */
function cutShortAt(u: Uint8Array, i: number): boolean {
  const b = u[i]!;
  const second = u[i + 1];
  if (b < 0xe0 || b > 0xf4 || second === undefined) return false;
  const lo = b === 0xe0 ? 0xa0 : b === 0xf0 ? 0x90 : 0x80;
  const hi = b === 0xed ? 0x9f : b === 0xf4 ? 0x8f : 0xbf;
  return second >= lo && second <= hi;
}

/**
 * Whether `u` reads as damaged UTF-8 (Rust's `looks_like_utf8`): a character above ASCII that is well-formed UTF-8, or one
 * cut short, around the bytes that are not.
 */
export function looksLikeUtf8(u: Uint8Array): boolean {
  let from = 0;
  for (;;) {
    const bad = firstNotUtf8Offset(u, from);
    const end = bad < 0 ? u.length : bad;
    for (let i = from; i < end; i++) if (u[i]! >= 0x80) return true;
    if (bad < 0) return false;
    if (cutShortAt(u, bad)) return true;
    from = bad + 1;
  }
}

export function firstNotUtf8(u: Uint8Array): Deciding | null {
  const at = firstNotUtf8Offset(u);
  if (at < 0) return null;
  let line = 1;
  let start = 0;
  for (let i = 0; i < at; i++) {
    if (u[i] === 0x0a) {
      line++;
      start = i + 1;
    }
  }
  return { offset: at, line, column: at - start + 1, byte: u[at]! };
}

const decoderFor = (label: string, fatal = false): TextDecoder => new TextDecoder(label, { fatal, ignoreBOM: true });
const encoder = new TextEncoder();

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/g;
const CYRILLIC = /[Ѐ-ӿ]/g;

/** chardetng's stand-in: the label for bytes with no BOM that are not UTF-8. */
export function guessLegacy(u: Uint8Array): string {
  const fed = u.subarray(0, GUESS_BYTES);
  let high = 0;
  for (const b of fed) if (b >= 0x80) high++;
  for (const [label, said] of [['shift_jis', 'shift_jis'], ['euc-kr', 'euc-kr'], ['gb18030', 'gbk'], ['big5', 'big5']] as const) {
    let text: string;
    try {
      text = decoderFor(label, true).decode(fed);
    } catch {
      continue;
    }
    if ((text.match(CJK)?.length ?? 0) * 2 >= high * 0.6) return said;
  }
  const cyr = decoderFor('windows-1251').decode(fed).match(CYRILLIC)?.length ?? 0;
  if (high >= 8 && cyr >= high * 0.7) return 'windows-1251';
  return 'windows-1252';
}

/** Windows code page numbers, as RTF and Outlook name them, to the labels `TextDecoder` reads. */
const CODE_PAGES: Readonly<Record<number, string>> = {
  437: 'ibm437', 850: 'ibm850', 866: 'ibm866', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5',
  1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253', 1254: 'windows-1254',
  1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258',
  10000: 'macintosh', 10007: 'x-mac-cyrillic', 20866: 'koi8-r', 21866: 'koi8-u', 20932: 'euc-jp', 51932: 'euc-jp',
  28591: 'iso-8859-1', 28592: 'iso-8859-2', 28593: 'iso-8859-3', 28594: 'iso-8859-4', 28595: 'iso-8859-5', 28596: 'iso-8859-6',
  28597: 'iso-8859-7', 28598: 'iso-8859-8', 28603: 'iso-8859-13', 28605: 'iso-8859-15', 50220: 'iso-2022-jp', 54936: 'gb18030', 65001: 'utf-8',
};

/**
 * The DOS code pages `TextDecoder` does not know, which RTF's `\pc` and `\pca` name: their upper halves, byte 80 first.
 * The lower half is ASCII.
 */
const OEM_PAGES: Readonly<Record<string, string>> = {
  ibm437: '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u03c6\u03b5\u2229\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0',
  ibm850: '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00f8\u00a3\u00d8\u00d7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u00ae\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u00c1\u00c2\u00c0\u00a9\u2563\u2551\u2557\u255d\u00a2\u00a5\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u00e3\u00c3\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u00a4\u00f0\u00d0\u00ca\u00cb\u00c8\u0131\u00cd\u00ce\u00cf\u2518\u250c\u2588\u2584\u00a6\u00cc\u2580\u00d3\u00df\u00d4\u00d2\u00f5\u00d5\u00b5\u00fe\u00de\u00da\u00db\u00d9\u00fd\u00dd\u00af\u00b4\u00ad\u00b1\u2017\u00be\u00b6\u00a7\u00f7\u00b8\u00b0\u00a8\u00b7\u00b9\u00b3\u00b2\u25a0\u00a0',
};

/** The label for code page `cp`, or null when it is one the page has no decoder for (Johab, EBCDIC). */
export function labelOfCodePage(cp: number): string | null {
  return CODE_PAGES[cp] ?? null;
}

/** `bytes` in the legacy encoding `label`, a byte with no character there as U+FFFD. */
export function decodeLegacy(bytes: Uint8Array, label: string): string {
  const oem = OEM_PAGES[label];
  if (oem === undefined) return decoderFor(label).decode(bytes);
  let out = '';
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : oem[b - 0x80]!;
  return out;
}

function isSingleByte(label: string): boolean {
  return !['utf-8', 'utf-16le', 'utf-16be', 'utf-32le', 'utf-32be', 'shift_jis', 'euc-kr', 'gb18030', 'gbk', 'big5', 'euc-jp', 'iso-2022-jp'].includes(label);
}

function evidenceOf(u: Uint8Array, label: string): Evidence {
  let high = 0;
  let c1 = 0;
  const order: number[] = [];
  const met = new Set<number>();
  for (const b of u) {
    if (b < 0x80) continue;
    high++;
    if (b < 0xa0) c1++;
    if (!met.has(b)) {
      met.add(b);
      order.push(b);
    }
  }
  const single = isSingleByte(label);
  let allLetters = single;
  const shown: [number, string][] = [];
  if (single) {
    const d = decoderFor(label);
    for (const b of order) {
      const ch = label === 'iso-8859-1' ? String.fromCharCode(b) : d.decode(new Uint8Array([b]));
      if (ch === '�' || /\p{Cc}/u.test(ch)) allLetters = false;
      if (shown.length < 12) shown.push([b, ch]);
    }
  }
  return { high, distinct: met.size, c1, allLetters, shown };
}

export function sniff(u: Uint8Array): { label: string; how: EncodingHow; bom: number; deciding?: Deciding; evidence?: Evidence } {
  const bom = bomOf(u);
  if (bom) return { label: bom.label, how: 'bom', bom: bom.len };
  const deciding = firstNotUtf8(u);
  // UTF-8 with a damaged byte, not another encoding: read as written (Rust's `looks_like_utf8`).
  // So are a few stray bytes in ASCII text (`MIN_GUESS_BYTES`).
  if (!deciding || looksLikeUtf8(u) || u.reduce((n, b) => n + (b >= 0x80 ? 1 : 0), 0) < MIN_GUESS_BYTES) return { label: 'utf-8', how: 'utf8', bom: 0 };
  const label = guessLegacy(u);
  return { label, how: 'guess', bom: 0, deciding, evidence: evidenceOf(u.subarray(0, GUESS_BYTES), label) };
}

const OWN = new Set(['utf-8', 'utf-16le', 'utf-16be', 'utf-32le', 'utf-32be', 'iso-8859-1']);

function canonical(label: string): string | null {
  const lower = label.trim().toLowerCase();
  if (OWN.has(lower)) return lower;
  // TextDecoder reads the label ISO-8859-1 as Windows-1252 (WHATWG); `OWN` reads it as itself, as Rust does.
  try {
    return new TextDecoder(lower).encoding;
  } catch {
    return null;
  }
}

function utf32(body: Uint8Array, le: boolean): { text: string; unreadable: number } {
  let text = '';
  let unreadable = 0;
  for (let i = 0; i < body.length; i += 4) {
    if (i + 4 > body.length) {
      unreadable += body.length - i;
      text += '�';
      break;
    }
    const v = le ? (body[i]! | (body[i + 1]! << 8) | (body[i + 2]! << 16) | (body[i + 3]! << 24)) >>> 0 : ((body[i]! << 24) | (body[i + 1]! << 16) | (body[i + 2]! << 8) | body[i + 3]!) >>> 0;
    if (v > 0x10ffff || (v >= 0xd800 && v <= 0xdfff)) {
      unreadable += 4;
      text += '�';
    } else text += String.fromCodePoint(v);
  }
  return { text, unreadable };
}

const replacements = (text: string): number => text.match(/�/g)?.length ?? 0;

/** Bytes of `body` that `label` cannot read: replacement characters, each a byte (two in UTF-16), as near as the page can tell. */
export function countUnreadable(body: Uint8Array, label: string): number {
  const part = body.subarray(0, COUNT_BYTES);
  if (label === 'iso-8859-1') return 0;
  if (label === 'utf-32le' || label === 'utf-32be') return utf32(part, label === 'utf-32le').unreadable;
  if (label === 'utf-8') {
    let bad = 0;
    for (let at = firstNotUtf8Offset(part); at >= 0; at = firstNotUtf8Offset(part, at + 1)) bad++;
    return bad;
  }
  try {
    const n = replacements(decoderFor(label).decode(part));
    return label.startsWith('utf-16') ? n * 2 : n;
  } catch {
    return part.length;
  }
}

function decodeBody(body: Uint8Array, label: string, bom: number): { text: Uint8Array; map: ByteMap } {
  if (label === 'utf-8') return { text: body.slice(), map: { kind: 'identity' } };
  if (label === 'iso-8859-1') {
    let s = '';
    for (const b of body) s += String.fromCharCode(b);
    return { text: encoder.encode(s), map: { kind: 'units', unit: 1, count: 'scalar' } };
  }
  if (label === 'utf-32le' || label === 'utf-32be') return { text: encoder.encode(utf32(body, label === 'utf-32le').text), map: { kind: 'units', unit: 4, count: 'scalar' } };
  if (label === 'utf-16le' || label === 'utf-16be') return { text: encoder.encode(decoderFor(label).decode(body)), map: { kind: 'units', unit: 2, count: 'utf16' } };
  if (isSingleByte(label)) return { text: encoder.encode(decoderFor(label).decode(body)), map: { kind: 'units', unit: 1, count: 'scalar' } };
  // Multi-byte: a byte at a time, so each character's bytes in the file are known (Rust's `decode_mapped`).
  const d = decoderFor(label);
  const parts: Uint8Array[] = [];
  const pairs: number[] = [];
  let u = 0;
  let delta = -bom;
  for (let i = 0; i < body.length; i++) {
    const s = d.decode(body.subarray(i, i + 1), { stream: i + 1 < body.length });
    if (s === '') continue;
    const bytes = encoder.encode(s);
    parts.push(bytes);
    u += bytes.length;
    const f = i + 1 + bom;
    if (u - f !== delta) {
      delta = u - f;
      pairs.push(u, f);
    }
  }
  const text = new Uint8Array(u);
  let at = 0;
  for (const p of parts) {
    text.set(p, at);
    at += p.length;
  }
  return { text, map: { kind: 'table', pairs: Uint32Array.from(pairs) } };
}

/** `text` as `label`'s bytes, without a BOM; throws a plain sentence when a character has none there. */
export function encodeBody(text: string, label: string): Uint8Array {
  if (label === 'utf-8') return encoder.encode(text);
  if (label === 'utf-16le' || label === 'utf-16be') {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (label === 'utf-16le') {
        out[i * 2] = c & 0xff;
        out[i * 2 + 1] = c >> 8;
      } else {
        out[i * 2] = c >> 8;
        out[i * 2 + 1] = c & 0xff;
      }
    }
    return out;
  }
  if (label === 'utf-32le' || label === 'utf-32be') {
    const cps = [...text].map((c) => c.codePointAt(0)!);
    const out = new Uint8Array(cps.length * 4);
    const view = new DataView(out.buffer);
    cps.forEach((v, i) => view.setUint32(i * 4, v, label === 'utf-32le'));
    return out;
  }
  if (!isSingleByte(label)) throw new Error(`${nameOf(label)} cannot be written in the browser dev loop; the app writes it`);
  const table = new Map<string, number>();
  if (label === 'iso-8859-1') for (let b = 0; b < 256; b++) table.set(String.fromCharCode(b), b);
  else {
    const d = decoderFor(label);
    for (let b = 0; b < 256; b++) {
      const ch = d.decode(new Uint8Array([b]));
      if (ch !== '�' && !table.has(ch)) table.set(ch, b);
    }
  }
  const out: number[] = [];
  let line = 1;
  for (const ch of text) {
    const b = table.get(ch);
    if (b === undefined) throw new Error(`“${ch}” (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}) on line ${line} has no bytes in ${nameOf(label)}, so the file cannot be saved in its own encoding`);
    if (ch === '\n') line++;
    out.push(b);
  }
  return Uint8Array.from(out);
}

const BOMS: Readonly<Record<string, readonly number[]>> = {
  'utf-8': [0xef, 0xbb, 0xbf],
  'utf-16le': [0xff, 0xfe],
  'utf-16be': [0xfe, 0xff],
  'utf-32le': [0xff, 0xfe, 0, 0],
  'utf-32be': [0, 0, 0xfe, 0xff],
};

/** The bytes a save writes: the BOM the file had, then the text in its encoding. */
export function encodeText(text: string, label: string, bom: boolean): Uint8Array {
  const body = encodeBody(text, label);
  const mark = bom ? (BOMS[label] ?? []) : [];
  const out = new Uint8Array(mark.length + body.length);
  out.set(mark, 0);
  out.set(body, mark.length);
  return out;
}

/** `encodeText` for text held as UTF-8 bytes, as a shell is handed it. */
export function encodeTextBytes(text: Uint8Array, label: string, bom: boolean): Uint8Array {
  return encodeText(new TextDecoder('utf-8').decode(text), label, bom);
}

/**
 * What detect.rs says of a head's text: `utf-8`, `utf-8-bom`, a UTF-16 or UTF-32 BOM's, or `8-bit` (not UTF-8);
 * null when it is not text. `cut` says the head stops mid-file, so a character cut at its end is still UTF-8.
 */
export function headEncoding(head: Uint8Array, cut: boolean): string | null {
  const bom = bomOf(head);
  if (bom) return bom.label === 'utf-8' ? 'utf-8-bom' : bom.label;
  if (head.includes(0)) return null;
  const at = firstNotUtf8Offset(head);
  return at < 0 || (cut && at >= head.length - 3) ? 'utf-8' : '8-bit';
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** `bytes` read as text with the reader's `chosen` label, else as `sniff` finds them: Rust's `decode`. */
export function decodeBytes(bytes: Uint8Array, chosen?: string | null): DecodedText {
  const found = sniff(bytes);
  const wanted = chosen && chosen !== found.label ? chosen : null;
  const label = wanted === null ? found.label : canonical(wanted);
  if (label === null) throw new Error(`${wanted} is not an encoding Marxy reads`);
  const own = bomOf(bytes);
  const bom = label === 'utf-8' ? 0 : wanted === null ? found.bom : own && own.label === label ? own.len : 0;
  const body = bytes.subarray(bom);
  const { text, map } = decodeBody(body, label, bom);
  let writable = map.kind === 'identity';
  if (!writable) {
    try {
      writable = sameBytes(encodeBody(new TextDecoder('utf-8').decode(text), label), body);
    } catch {
      writable = false;
    }
  }
  const result: EncodingFound = {
    label,
    name: nameOf(label),
    how: wanted === null ? found.how : 'chosen',
    bom,
    fileBytes: bytes.length,
    ...(wanted === null ? {} : { detected: found.label, detectedHow: found.how }),
    ...(found.deciding ? { deciding: found.deciding } : {}),
    ...(found.evidence ? { evidence: found.evidence } : {}),
    unreadable: countUnreadable(body, label),
    writable,
  };
  return { found: result, text, map };
}

/** Where the encodings differ: Rust's `sample_range`. */
function sampleRange(u: Uint8Array): [number, number] {
  const bom = bomOf(u);
  if (bom && bom.label !== 'utf-8') {
    const unit = bom.label.startsWith('utf-32') ? 4 : 2;
    const le = bom.label.endsWith('le');
    let first = 0;
    for (let k = 0, i = bom.len; i + unit <= u.length; k++, i += unit) {
      const lo = le ? u[i]! : u[i + unit - 1]!;
      const hi = le ? u.subarray(i + 1, i + unit) : u.subarray(i, i + unit - 1);
      if (lo >= 0x80 || hi.some((b) => b !== 0)) {
        first = k;
        break;
      }
    }
    const start = bom.len + Math.max(0, first - 5) * unit;
    return [start, Math.min(start + 64 * unit, u.length)];
  }
  let first = u.findIndex((b) => b >= 0x80);
  if (first < 0) first = 0;
  const lineStart = u.lastIndexOf(0x0a, first - 1) + 1;
  const start = Math.max(first - 5, lineStart, 0);
  const nl = u.indexOf(0x0a, start);
  const end = Math.min(nl < 0 ? u.length : nl, start + SAMPLE_BYTES);
  return [start, end];
}

/** Each candidate's reading of the same few bytes, and how many bytes of the file it cannot read: Rust's `readings`. */
export function readingsOf(bytes: Uint8Array): EncodingReadings {
  const [start, end] = sampleRange(bytes);
  const sample = bytes.subarray(start, end);
  const found = sniff(bytes).label;
  const labels = CANDIDATES.map(([l]) => l);
  if (!labels.includes(found)) labels.push(found);
  const own = bomOf(bytes);
  const rows: EncodingReading[] = labels.map((label) => {
    let text: string;
    try {
      text = label === 'utf-8' ? new TextDecoder('utf-8').decode(sample) : new TextDecoder('utf-8').decode(decodeBody(sample, label, 0).text);
    } catch {
      text = '';
    }
    const controls = text.match(/[\u0080-\u009f]/g)?.length ?? 0;
    return { label, name: nameOf(label), sample: text.replace(/[\r\n]+$/, ''), unreadable: countUnreadable(bytes.subarray(own && own.label === label ? own.len : 0), label), controls };
  });
  return { rows, counted: Math.min(bytes.length, COUNT_BYTES), sampleAt: start };
}
