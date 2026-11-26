// What can be said of a file from its first bytes, for the file card and the hex view: the size in
// words, a byte as hex, the text test, and the magic the head carries. Pure: no DOM, no I/O.

const n2 = (n: number): string => n.toLocaleString('en-GB');

/** One byte as two upper-case hex digits. */
export const hex2 = (b: number): string => b.toString(16).toUpperCase().padStart(2, '0');

/** "418 bytes", "48.0 KB · 49,152 bytes", "2.0 GB · 2,147,483,648 bytes": binary units, one decimal. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${n2(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]} · ${n2(bytes)} bytes`;
}

/** The first `count` bytes as hex, space-separated, and as text with a middle dot for what does not print. */
export function firstBytes(head: Uint8Array, count = 8): { readonly hex: string; readonly text: string } {
  const some = head.subarray(0, count);
  return {
    hex: [...some].map(hex2).join(' '),
    text: [...some].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·')).join(''),
  };
}

export interface TextTest {
  /** How many bytes were looked at. */
  readonly n: number;
  readonly nul: number;
  /** The share of bytes outside printable text (tab, line ends and UTF-8's high bytes count as text). */
  readonly odd: number;
}

/** The text test the card says in words: NUL bytes, and how much of the head is outside printable text. */
export function textTest(head: Uint8Array): TextTest {
  let nul = 0;
  let odd = 0;
  for (const b of head) {
    if (b === 0) nul++;
    if (b === 0 || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c) || b === 0x7f) odd++;
  }
  return { n: head.length, nul, odd: head.length === 0 ? 0 : odd / head.length };
}

export interface Magic {
  /** What the bytes are, as a phrase: "the PNG signature", "an ftyp box of brand heic". */
  readonly name: string;
  /** How many leading bytes it covers: the hex view underlines them. */
  readonly len: number;
  /** The format it names, as the card's kind says it: "PNG", "HEIC", "a GPT disk". */
  readonly format: string;
}

const ascii = (u: Uint8Array, at: number, n: number): string => {
  let s = '';
  for (let i = at; i < at + n && i < u.length; i++) s += String.fromCharCode(u[i]!);
  return s;
};
const starts = (u: Uint8Array, bytes: readonly number[], at = 0): boolean => bytes.every((b, i) => u[at + i] === b);

/** The format the head's magic names, or null when it names none the app knows. */
export function magicOf(u: Uint8Array): Magic | null {
  if (starts(u, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { name: 'the PNG signature', len: 8, format: 'PNG' };
  if (starts(u, [0xff, 0xd8, 0xff])) return { name: 'a JPEG start of image', len: 3, format: 'JPEG' };
  if (ascii(u, 0, 6) === 'GIF87a' || ascii(u, 0, 6) === 'GIF89a') return { name: `the GIF signature, ${ascii(u, 3, 3)}`, len: 6, format: 'GIF' };
  if (ascii(u, 0, 4) === 'RIFF' && ascii(u, 8, 4) === 'WEBP') return { name: 'RIFF, then WEBP', len: 12, format: 'WebP' };
  if (ascii(u, 0, 4) === 'RIFF' && ascii(u, 8, 4) === 'WAVE') return { name: 'RIFF, then WAVE', len: 12, format: 'WAV audio' };
  if (ascii(u, 4, 4) === 'ftyp') {
    const brand = ascii(u, 8, 4).trim();
    const format = /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand) ? 'HEIC' : brand === 'avif' || brand === 'avis' ? 'AVIF' : /^(qt)$/.test(brand) ? 'QuickTime video' : 'an MP4 container';
    return { name: `an ftyp box of brand ${brand}`, len: 12, format };
  }
  if (starts(u, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return { name: 'a JPEG XL box', len: 12, format: 'JPEG XL' };
  if (starts(u, [0xff, 0x0a])) return { name: 'a JPEG XL codestream', len: 2, format: 'JPEG XL' };
  if (ascii(u, 0, 4) === 'qoif') return { name: 'the QOI signature', len: 4, format: 'QOI' };
  if (starts(u, [0x76, 0x2f, 0x31, 0x01])) return { name: 'the OpenEXR signature', len: 4, format: 'OpenEXR' };
  if (ascii(u, 0, 10) === '#?RADIANCE') return { name: 'a Radiance header', len: 10, format: 'Radiance HDR' };
  if (ascii(u, 0, 6) === '#?RGBE') return { name: 'a Radiance header', len: 6, format: 'Radiance HDR' };
  if (ascii(u, 0, 2) === 'II' && u[2] === 0x2a && u[3] === 0) return { name: 'a little-endian TIFF header', len: 4, format: 'TIFF' };
  if (ascii(u, 0, 2) === 'MM' && u[2] === 0 && u[3] === 0x2a) return { name: 'a big-endian TIFF header', len: 4, format: 'TIFF' };
  if (ascii(u, 0, 2) === 'BM' && u.length > 14) return { name: 'a bitmap header, BM', len: 2, format: 'BMP' };
  if (starts(u, [0x00, 0x00, 0x01, 0x00])) return { name: 'an icon directory', len: 4, format: 'ICO' };
  if (ascii(u, 0, 4) === '8BPS') return { name: 'the Photoshop signature, 8BPS', len: 4, format: 'Photoshop' };
  if (ascii(u, 0, 5) === '%PDF-') return { name: `%PDF-${ascii(u, 5, 3)}`, len: 8, format: 'PDF' };
  if (starts(u, [0x50, 0x4b, 0x03, 0x04])) return { name: 'a zip local header, PK', len: 4, format: 'a zip archive' };
  if (starts(u, [0x1f, 0x8b])) return { name: 'the gzip signature', len: 2, format: 'gzip' };
  if (starts(u, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { name: 'the 7z signature', len: 6, format: 'a 7z archive' };
  if (starts(u, [0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46])) return { name: 'a Shell Link header: size 4C, then its class id', len: 20, format: 'a Windows shortcut' };
  if (starts(u, [0x7f, 0x45, 0x4c, 0x46])) return { name: 'ELF', len: 4, format: 'a program (ELF)' };
  if (ascii(u, 0, 2) === 'MZ') return { name: 'MZ, a DOS header', len: 2, format: 'a Windows program' };
  if (starts(u, [0xcf, 0xfa, 0xed, 0xfe]) || starts(u, [0xfe, 0xed, 0xfa, 0xcf])) return { name: 'a Mach-O header', len: 4, format: 'a macOS program' };
  if (starts(u, [0x00, 0x61, 0x73, 0x6d])) return { name: '\\0asm', len: 4, format: 'WebAssembly' };
  if (ascii(u, 0, 16) === 'SQLite format 3\0') return { name: 'SQLite format 3', len: 16, format: 'an SQLite database' };
  if (ascii(u, 0, 4) === 'OggS') return { name: 'OggS', len: 4, format: 'Ogg' };
  if (ascii(u, 0, 4) === 'fLaC') return { name: 'fLaC', len: 4, format: 'FLAC audio' };
  if (ascii(u, 0, 3) === 'ID3') return { name: 'an ID3 tag', len: 3, format: 'MP3 audio' };
  if (starts(u, [0x1a, 0x45, 0xdf, 0xa3])) return { name: 'an EBML header', len: 4, format: 'Matroska or WebM video' };
  if (ascii(u, 0, 4) === 'wOFF') return { name: 'wOFF', len: 4, format: 'a WOFF font' };
  if (ascii(u, 0, 4) === 'wOF2') return { name: 'wOF2', len: 4, format: 'a WOFF2 font' };
  if (ascii(u, 0, 4) === 'ttcf') return { name: 'ttcf', len: 4, format: 'a font collection' };
  if (starts(u, [0x00, 0x01, 0x00, 0x00, 0x00]) || ascii(u, 0, 4) === 'OTTO') return { name: 'an sfnt header', len: 4, format: 'a font' };
  if (u.length >= 520 && u[510] === 0x55 && u[511] === 0xaa && ascii(u, 512, 8) === 'EFI PART') return { name: 'a protective MBR, then EFI PART', len: 0, format: 'a GPT disk' };
  return null;
}

/** "Its first bytes, 54 4D 4B 31 02 00 00 00 ("TMK1····"), …": the head said in the card's words. */
export function headWords(head: Uint8Array, count = 8): string {
  const { hex, text } = firstBytes(head, count);
  return `${hex} (“${text}”)`;
}

/** A file's extension, lower case without its dot, or '' when its name has none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const at = name.lastIndexOf('.');
  return at <= 0 ? '' : name.slice(at + 1).toLowerCase();
}
