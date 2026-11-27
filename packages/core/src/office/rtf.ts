// An RTF file read into the office model, by hand: one pass over its bytes, a stack of groups, the character and paragraph
// properties each group sets. What it keeps is the text and what marks its structure: paragraphs, headings (by outline
// level, a heading style, or a size larger than the body's), bold, italic, struck, sub- and superscript, lists from
// their list text, tables from their cells and rows, line breaks. A field shows the result it last showed and a
// HYPERLINK's address is written after it as text; pictures and embedded objects are named, their bytes never decoded,
// and nothing a field names is fetched or run. Characters written by number (`\'hh`) are read in the code page the file
// declares (`\ansicpg`, or a font's `\fcharset`), never guessed; `\u` takes its `\ucN` fallback with it. Every block
// records the bytes of the file it came from, so the page maps back to them. Groups past the depth cap and text past the
// output cap are not read, and the page says so. Pure.
import { decodeLegacy, labelOfCodePage, nameOf } from '../encoding/decode.ts';
import { budget, figure } from '../util/budget.ts';
import { emptyProps, run, type Block, type Inline, type OfficeDoc, type OfficeImage, type OfficeProps, type Run } from './model.ts';
import { OFFICE_LIMITS, OfficeError } from './xml.ts';
import { pushAll } from '../util/spread.ts';

export const RTF_LIMITS = {
  /** Groups nested deeper than this are skipped whole. */
  depth: OFFICE_LIMITS.depth,
  /** Characters of text read; past it the rest of the file is not read. */
  chars: OFFICE_LIMITS.chars,
  /** Pictures and objects named. */
  objects: 10_000,
} as const;

// A font's declared character set, as the code page its `\'hh` bytes are in. 0 and 1 are the document's own.
const CHARSET_PAGES: Readonly<Record<number, number>> = {
  77: 10000, 128: 932, 129: 949, 130: 1361, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250, 255: 437,
};

const SYMBOLS: Readonly<Record<string, string>> = {
  emdash: '—', endash: '–', emspace: ' ', enspace: ' ', qmspace: ' ', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”',
  zwj: '‍', zwnj: '‌', zwbo: '​', ltrmark: '‎', rtlmark: '‏', tab: '\t',
};

// Destinations that hold nothing the page shows, as the account words for those worth naming.
const SKIPPED: Readonly<Record<string, string | null>> = {
  colortbl: null, header: 'headers and footers', headerl: 'headers and footers', headerr: 'headers and footers', headerf: 'headers and footers',
  footer: 'headers and footers', footerl: 'headers and footers', footerr: 'headers and footers', footerf: 'headers and footers',
  footnote: 'footnotes', annotation: 'comments', atnid: null, atnauthor: null, atrfstart: null, atrfend: null,
  shp: 'shapes and floating pictures', shpgrp: 'shapes and floating pictures', do: 'shapes and floating pictures', nonshppict: null,
  xe: null, tc: null, tcn: null, txe: null, rxe: null, private: null, filetbl: null, revtbl: null, listtable: null, listoverridetable: null,
  rsidtbl: null, xmlnstbl: null, themedata: null, colorschememapping: null, datastore: null, latentstyles: null, pgdsctbl: null,
  mmathPr: null, pntxtb: null, pntxta: null, ftnsep: null, ftnsepc: null, ftncn: null, aftnsep: null, aftnsepc: null, aftncn: null,
  printim: null, buptim: null, keywords: null, userprops: null, docvar: null, bkmkstart: null, bkmkend: null, wgrffmtfilter: null,
  blipuid: null, picprop: null, nesttableprops: null, fldtype: null, objdata: null, result: null, panose: null, falt: null, fontemb: null,
};

const INFO_FIELDS = new Set(['title', 'subject', 'author', 'operator', 'company', 'doccomm']);

type Dest = 'body' | 'skip' | 'fonttbl' | 'stylesheet' | 'info' | 'infofield' | 'time' | 'generator' | 'pict' | 'object' | 'objclass' | 'fldinst' | 'listtext' | 'pn';

interface Chars {
  b: boolean;
  i: boolean;
  s: boolean;
  sub: boolean;
  sup: boolean;
  hidden: boolean;
  font: number;
  /** Half-points, as `\fs` says. */
  size: number;
}

interface Para {
  intbl: boolean;
  style: number;
  outline: number | null;
  ls: number;
  ilvl: number;
  pn: { readonly ordered: boolean; readonly start: number } | null;
}

interface Field {
  inst: string;
  /** The text its result showed, a field nested in it included. */
  shown: string;
  readonly outer: Field | null;
}

interface Frame {
  dest: Dest;
  c: Chars;
  p: Para;
  uc: number;
  field: Field | null;
  /** Run once the group closes, with the group it was inside. */
  close: ((outer: Frame) => void) | null;
  /** The info field or time a group fills. */
  name: string;
}

interface Rec {
  readonly end: 'par' | 'cell' | 'row';
  readonly kids: Inline[];
  readonly s: number;
  readonly e: number;
  readonly intbl: boolean;
  readonly list: { readonly ordered: boolean; readonly start: number; readonly level: number } | null;
  readonly outline: number | null;
  readonly style: number;
  readonly minSize: number;
  readonly chars: number;
}

const plainChars = (font: number): Chars => ({ b: false, i: false, s: false, sub: false, sup: false, hidden: false, font, size: 24 });
const plainPara = (): Para => ({ intbl: false, style: 0, outline: null, ls: 0, ilvl: 0, pn: null });

const isLetter = (c: number): boolean => (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const hexOf = (c: number): number => (isDigit(c) ? c - 0x30 : c >= 0x61 && c <= 0x66 ? c - 0x57 : c >= 0x41 && c <= 0x46 ? c - 0x37 : -1);
/** The length of the well-formed UTF-8 character starting at `i`, or 0 when none does. */
function utf8At(b: Uint8Array, i: number): number {
  const c = b[i]!;
  const len = c >= 0xc2 && c <= 0xdf ? 2 : c >= 0xe0 && c <= 0xef ? 3 : c >= 0xf0 && c <= 0xf4 ? 4 : 0;
  if (len === 0 || i + len > b.length) return 0;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(i, i + len));
    return len;
  } catch {
    return 0;
  }
}

/**
 * A run of a store's text: its well-formed UTF-8 characters as they are, the bytes between them in the code page. When a
 * byte above 7F in the run was written by number, the run is the code page's throughout.
 */
function decodeStoreRun(b: Uint8Array, rawOnly: boolean, label: string | null): string {
  const legacy = (x: Uint8Array): string => (label ? decodeLegacy(x, label) : Array.from(x, (y) => (y < 0x80 ? String.fromCharCode(y) : '�')).join(''));
  if (!rawOnly) return legacy(b);
  let out = '';
  let from = 0;
  let i = 0;
  while (i < b.length) {
    const len = b[i]! >= 0x80 ? utf8At(b, i) : 0;
    if (len === 0) {
      i++;
      continue;
    }
    if (i > from) out += legacy(b.subarray(from, i));
    out += new TextDecoder('utf-8').decode(b.subarray(i, i + len));
    i += len;
    from = i;
  }
  return from < b.length ? out + legacy(b.subarray(from)) : out;
}

/** Control characters a run of text never shows (a tab and a line feed are kept: the writer makes them spaces). */
const stripControls = (s: string): string => s.replace(/[\0-\x08\x0b-\x1f\x7f]/g, '');
const sizeWords = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);

const PICTURE_FORMATS: Readonly<Record<string, string>> = {
  pngblip: 'PNG', jpegblip: 'JPEG', emfblip: 'EMF', wmetafile: 'WMF', pmmetafile: 'OS/2 metafile', macpict: 'PICT', dibitmap: 'bitmap', wbitmap: 'bitmap',
};

/** Whether `b` opens a two-byte character in a double-byte code page. */
function isLead(cp: number, b: number): boolean {
  if (cp === 932) return (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);
  if (cp === 936 || cp === 949 || cp === 950) return b >= 0x81 && b <= 0xfe;
  return false;
}

export const startsAsRtf = (bytes: Uint8Array): boolean => {
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
  return bytes[i] === 0x7b && bytes[i + 1] === 0x5c && bytes[i + 2] === 0x72 && bytes[i + 3] === 0x74 && bytes[i + 4] === 0x66;
};

/** A HYPERLINK field's address, quoted or not; null for another field, or for a link to a place in the document (`\l`). */
export function hyperlinkOf(inst: string): string | null {
  const m = /^\s*HYPERLINK\b([\s\S]*)$/i.exec(inst);
  if (!m) return null;
  let rest = m[1]!;
  let href: string | null = null;
  while (rest.trim() !== '') {
    rest = rest.trimStart();
    // `\l`, `\o` and `\t` take a word after them; `\m` and `\n` stand alone.
    const sw = /^\\([lot])\s*(?:"[^"]*"|[^\s"\\]+)?|^\\([a-z])/i.exec(rest);
    if (sw) {
      if (sw[1]?.toLowerCase() === 'l') return null;
      rest = rest.slice(sw[0].length);
      continue;
    }
    const q = /^"([^"]*)"?|^(\S+)/.exec(rest)!;
    href ??= (q[1] ?? q[2] ?? '').trim();
    rest = rest.slice(q[0].length);
  }
  return href || null;
}

export interface RtfOptions {
  /**
   * The bytes are a store's text, not the file's own: raw bytes above 7F that are well-formed UTF-8 are that text (a
   * file saved as UTF-8 whatever it declares, or a legacy one as Source edited it), and only other runs are the code page's.
   */
  readonly storeText?: boolean;
}

/** Reads `bytes` as RTF. Throws `OfficeError` with the sentence the page says when they are not RTF. */
export function readRtf(bytes: Uint8Array, options: RtfOptions = {}): OfficeDoc {
  if (!startsAsRtf(bytes)) throw new OfficeError('Its bytes do not start with {\\rtf, as every RTF file does.');
  const n = bytes.length;
  let docPage = 1252;
  // Whether the file names its code page (`\ansicpg`, `\mac`, `\pc`, `\pca`); `\ansi` alone is 1252 by default.
  let pageDeclared = false;
  let deff = 0;
  const fonts = new Map<number, { page: number | null; code: boolean; name: string }>();
  const styles = new Map<number, { name: string; outline: number | null }>();
  let curFont: { id: number; page: number | null; code: boolean; name: string; done: boolean } | null = null;
  let curStyle: { id: number | null; name: string; outline: number | null; done: boolean } | null = null;
  const info: Record<string, string> = {};
  const times: Record<string, string> = {};
  let timeParts: Record<string, number> = {};
  let generator = '';
  let pages: number | null = null;
  const images: OfficeImage[] = [];
  const objects = budget(RTF_LIMITS.objects);
  const leftOut = new Set<string>();
  const cut: string[] = [];
  const depth = budget(RTF_LIMITS.depth);
  const chars = budget(RTF_LIMITS.chars);

  const stack: Frame[] = [];
  let top: Frame = { dest: 'skip', c: plainChars(0), p: plainPara(), uc: 1, field: null, close: null, name: '' };
  let started = false;

  // The paragraph being read.
  let kids: Inline[] = [];
  let paraStart = -1;
  let minSize = Number.POSITIVE_INFINITY;
  let paraChars = 0;
  let listMark: string | null = null;
  const sizeChars = new Map<number, number>();
  const recs: Rec[] = [];

  // Bytes waiting to be decoded together: a double-byte character is two of them.
  let pending: number[] = [];
  let pendingPage = 0;
  let needTrail = false;
  let tokStart = 0;
  let skipLeft = 0;
  let star = false;

  const pageOfFont = (): number => {
    const f = fonts.get(top.c.font);
    return f?.page ?? docPage;
  };

  const take = (at: number): void => {
    if (paraStart < 0) paraStart = at;
  };

  /** `shown`: whether it is text a field's result showed (an address the reader writes after a link is not). */
  const appendRun = (text: string, at: number, shown = true): void => {
    const c = top.c;
    if (c.hidden || text === '') return;
    if (!chars.take(text.length)) return;
    take(at);
    if (shown) for (let f = top.field; f; f = f.outer) if (f.shown.length < 4096) f.shown += text;
    const visible = text.replace(/\s+/g, '').length;
    if (visible > 0) {
      minSize = Math.min(minSize, c.size);
      paraChars += visible;
      sizeChars.set(c.size, (sizeChars.get(c.size) ?? 0) + visible);
    }
    const code = fonts.get(c.font)?.code ?? false;
    const look: Omit<Run, 't' | 'text'> = { ...(c.b && { b: true }), ...(c.i && { i: true }), ...(c.s && { s: true }), ...(c.sub && { sub: true }), ...(c.sup && { sup: true }), ...(code && { code: true }) };
    const last = kids[kids.length - 1];
    if (last?.t === 'run' && !!last.b === !!look.b && !!last.i === !!look.i && !!last.s === !!look.s && !!last.sub === !!look.sub && !!last.sup === !!look.sup && !!last.code === !!look.code) {
      kids[kids.length - 1] = { ...last, text: last.text + text };
    } else kids.push(run(text, look));
  };

  /** Text into whatever the current group collects. */
  const emit = (text: string, at: number): void => {
    switch (top.dest) {
      case 'body':
        appendRun(text, at);
        return;
      case 'fonttbl':
        if (curFont && !curFont.done) {
          const semi = text.indexOf(';');
          curFont.name += semi < 0 ? text : text.slice(0, semi);
          if (semi >= 0) commitFont();
        }
        return;
      case 'stylesheet':
        if (curStyle && !curStyle.done) {
          const semi = text.indexOf(';');
          curStyle.name += semi < 0 ? text : text.slice(0, semi);
          if (semi >= 0) commitStyle();
        }
        return;
      case 'infofield':
        if (info[top.name] === undefined || info[top.name]!.length < 4096) info[top.name] = (info[top.name] ?? '') + text;
        return;
      case 'generator':
        if (generator.length < 512) generator += text;
        return;
      case 'objclass':
        if (objClass.length < 256) objClass += text;
        return;
      case 'fldinst':
        if (top.field && top.field.inst.length < 4096) top.field.inst += text;
        return;
      case 'listtext':
        if ((listMark ?? '').length < 64) listMark = (listMark ?? '') + text;
        return;
      default:
        return;
    }
  };
  let objClass = '';

  const flush = (): void => {
    if (pending.length === 0) return;
    const b = Uint8Array.from(pending);
    pending = [];
    needTrail = false;
    let text: string | null = null;
    // UTF-8 only when the file says so, or says nothing and a run written raw reads as nothing else.
    const undeclared = !pageDeclared && (fonts.get(top.c.font)?.page ?? null) === null;
    if (options.storeText === true && pendingPage !== 65001 && b.some((x) => x >= 0x80)) {
      emit(stripControls(decodeStoreRun(b, pendingRawOnly, labelOfCodePage(pendingPage))), flushAt);
      return;
    }
    if (pendingPage === 65001 || (pendingRawOnly && undeclared && b.some((x) => x >= 0x80))) {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(b);
      } catch {
        text = null;
      }
    }
    if (text === null) {
      const label = labelOfCodePage(pendingPage);
      text = label ? decodeLegacy(b, label) : Array.from(b, (x) => (x < 0x80 ? String.fromCharCode(x) : '�')).join('');
    }
    emit(stripControls(text), flushAt);
  };
  let flushAt = 0;
  // Whether every byte above 7F waiting was written raw rather than by number.
  let pendingRawOnly = true;

  /** A byte of text, raw or written by number: either way in the code page of its font, or else of the document. */
  const addByte = (b: number, byNumber: boolean, at: number): void => {
    const page = pageOfFont();
    // A double-byte character's trail stays with its lead, however it is written.
    if (pending.length > 0 && pendingPage !== page && !needTrail) flush();
    if (pending.length === 0) {
      pendingPage = page;
      pendingRawOnly = true;
      flushAt = at;
    }
    if (byNumber && b >= 0x80) pendingRawOnly = false;
    pending.push(b);
    if (needTrail) needTrail = false;
    else if (isLead(pendingPage, b)) needTrail = true;
  };

  const commitFont = (): void => {
    if (!curFont || curFont.done) return;
    curFont.done = true;
    const name = curFont.name.trim();
    fonts.set(curFont.id, { page: curFont.page, code: curFont.code || /courier|consolas|mono|menlo|lucida console|fixedsys/i.test(name), name });
  };
  const commitStyle = (): void => {
    if (!curStyle || curStyle.done) return;
    curStyle.done = true;
    if (curStyle.id !== null) styles.set(curStyle.id, { name: curStyle.name.trim(), outline: curStyle.outline });
  };

  const finishPara = (end: Rec['end'], e: number): void => {
    flush();
    const p = top.p;
    const mark = listMark?.replace(/[\t ]+$/, '').trim() ?? null;
    let list: Rec['list'] = null;
    if (p.ls > 0 || p.pn || (mark !== null && mark !== '')) {
      const num = mark ? /^\(?(\d{1,9})[.)]/.exec(mark) : null;
      const ordered = p.pn?.ordered ?? (mark !== null && /^\(?(\d{1,9}|[a-zA-Z]{1,4})[.)]/.test(mark));
      list = { ordered, start: num ? Number(num[1]) : (p.pn?.start ?? 1), level: Math.min(8, p.ilvl) };
    }
    if (kids.length > 0 || end !== 'par') {
      recs.push({ end, kids, s: paraStart < 0 ? tokStart : paraStart, e, intbl: p.intbl || end !== 'par', list, outline: p.outline, style: p.style, minSize, chars: paraChars });
    }
    kids = [];
    paraStart = -1;
    minSize = Number.POSITIVE_INFINITY;
    paraChars = 0;
    listMark = null;
  };

  const addImage = (img: OfficeImage, at: number): void => {
    if (!objects.take()) return;
    take(at);
    images.push(img);
    kids.push({ t: 'image', image: images.length - 1 });
  };

  /** Starts a destination group named by `word`; true when `word` was one. */
  const destination = (word: string, param: number | null, at: number): boolean => {
    const outer = top.dest;
    switch (word) {
      case 'rtf':
        if (!started) {
          started = true;
          top.dest = 'body';
        }
        return true;
      case 'fonttbl':
        top.dest = 'fonttbl';
        return true;
      case 'stylesheet':
        top.dest = 'stylesheet';
        top.name = 'sheet';
        return true;
      case 'shppict':
        // Holds the picture itself; its `nonshppict` twin, for older readers, is skipped.
        return true;
      case 'info':
        top.dest = 'info';
        return true;
      case 'creatim':
      case 'revtim':
        if (outer !== 'info') return false;
        top.dest = 'time';
        top.name = word;
        timeParts = {};
        top.close = () => {
          const t = timeParts;
          if (t.yr) {
            const two = (x: number | undefined): string => String(x ?? 0).padStart(2, '0');
            times[word] = `${t.yr}-${two(t.mo || 1)}-${two(t.dy || 1)}T${two(t.hr)}:${two(t.min)}:00`;
          }
        };
        return true;
      case 'generator':
        top.dest = 'generator';
        return true;
      case 'pict': {
        if (outer !== 'body') {
          top.dest = 'skip';
          return true;
        }
        top.dest = 'pict';
        const pict = { format: '', bytes: 0, start: groupStart };
        currentPict = pict;
        top.close = () => {
          addImage({ entry: null, alt: [pict.format || 'a picture', sizeWords(Math.ceil(pict.bytes))].join(', '), what: 'held picture' }, pict.start);
          currentPict = null;
        };
        return true;
      }
      case 'object': {
        if (outer !== 'body') {
          top.dest = 'skip';
          return true;
        }
        top.dest = 'object';
        objClass = '';
        const start = groupStart;
        top.close = () => addImage({ entry: null, alt: objClass.trim(), what: 'object' }, start);
        return true;
      }
      case 'objclass':
        top.dest = outer === 'object' ? 'objclass' : 'skip';
        return true;
      case 'field':
        if (outer !== 'body') return true;
        {
          const field: Field = { inst: '', shown: '', outer: top.field };
          top.field = field;
          const start = groupStart;
          top.close = () => {
            // Shown as text after the words it was on: an address the page never follows or fetches.
            const href = hyperlinkOf(field.inst);
            if (href !== null && href !== field.shown.trim()) appendRun(` (${href})`, start, false);
          };
        }
        return true;
      case 'fldinst':
        top.dest = top.field ? 'fldinst' : 'skip';
        return true;
      case 'fldrslt':
        return true;
      case 'listtext':
      case 'pntext':
        top.dest = outer === 'body' ? 'listtext' : 'skip';
        if (outer === 'body') listMark = '';
        return true;
      case 'pn':
        if (outer !== 'body') {
          top.dest = 'skip';
          return true;
        }
        top.dest = 'pn';
        pnState = { ordered: null, start: 1 };
        {
          const state = pnState;
          top.close = (o) => {
            if (state.ordered !== null) o.p = { ...o.p, pn: { ordered: state.ordered, start: state.start } };
          };
        }
        return true;
      default:
        break;
    }
    if (INFO_FIELDS.has(word) && outer === 'info') {
      top.dest = 'infofield';
      top.name = word;
      return true;
    }
    if (Object.hasOwn(SKIPPED, word)) {
      const said = SKIPPED[word];
      if (said && outer !== 'skip') leftOut.add(said);
      top.dest = 'skip';
      return true;
    }
    void param;
    void at;
    return false;
  };
  // Set and cleared by the picture group's own handlers, which the narrowing below cannot see.
  let currentPict = null as { format: string; bytes: number; start: number } | null;
  let pnState: { ordered: boolean | null; start: number } = { ordered: null, start: 1 };
  let groupStart = 0;
  let groupFresh = false;

  const toggle = (param: number | null): boolean => param === null || param !== 0;

  const controlWord = (word: string, param: number | null, at: number, end: number): void => {
    const fresh = groupFresh;
    groupFresh = false;
    flush();
    // Raw bytes follow, in a skipped group too: braces among them are data.
    if (word === 'bin') {
      const len = Math.max(0, Math.min(param ?? 0, n - end));
      if (currentPict && top.dest === 'pict') currentPict.bytes += len;
      binSkip = len;
      return;
    }
    if (skipLeft > 0) {
      skipLeft--;
      return;
    }
    const wasStar = star;
    star = false;
    if (word === 'rtf') {
      destination(word, param, at);
      return;
    }
    if (top.dest === 'skip') return;
    if (fresh || wasStar) {
      if (destination(word, param, at)) return;
      if (wasStar) {
        top.dest = 'skip';
        return;
      }
    } else if (word === 'field' || word === 'fldinst' || word === 'fldrslt' || word === 'pict' || word === 'object' || word === 'listtext' || word === 'pntext' || Object.hasOwn(SKIPPED, word)) {
      if (destination(word, param, at)) return;
    }
    const c = top.c;
    switch (word) {
      // The document.
      case 'ansicpg':
        if (param !== null && param > 0) {
          docPage = param;
          pageDeclared = true;
        }
        return;
      case 'ansi':
        return;
      case 'mac':
        docPage = 10000;
        pageDeclared = true;
        return;
      case 'pc':
        docPage = 437;
        pageDeclared = true;
        return;
      case 'pca':
        docPage = 850;
        pageDeclared = true;
        return;
      case 'deff':
        if (param !== null) deff = param;
        top.c = { ...c, font: deff };
        return;
      case 'uc':
        top.uc = Math.max(0, Math.min(16, param ?? 1));
        return;
      case 'u': {
        if (param === null) return;
        const code = param < 0 ? param + 65536 : param;
        if (top.dest === 'body' || top.dest === 'listtext' || top.dest === 'fldinst' || top.dest === 'infofield' || top.dest === 'objclass' || top.dest === 'generator') {
          flush();
          emit(stripControls(String.fromCharCode(code & 0xffff)), at);
        }
        skipLeft = top.uc;
        return;
      }
    }
    switch (top.dest) {
      case 'fonttbl':
        if (word === 'f' && param !== null) {
          commitFont();
          curFont = { id: param, page: null, code: false, name: '', done: false };
        } else if (curFont && !curFont.done) {
          if (word === 'fcharset' && param !== null) curFont.page = param === 0 || param === 1 || param === 2 ? null : (CHARSET_PAGES[param] ?? null);
          else if (word === 'cpg' && param !== null) curFont.page = param;
          else if (word === 'fmodern') curFont.code = true;
        }
        return;
      case 'stylesheet':
        if (curStyle && !curStyle.done) {
          if (word === 's' && param !== null) curStyle.id = param;
          else if (word === 'cs' || word === 'ds' || word === 'ts' || word === 'tsrowd') curStyle.id = null;
          else if (word === 'outlinelevel' && param !== null) curStyle.outline = param;
        }
        return;
      case 'time':
        if (param !== null && (word === 'yr' || word === 'mo' || word === 'dy' || word === 'hr' || word === 'min')) timeParts[word] = param;
        return;
      case 'info':
        if (word === 'nofpages' && param !== null) pages = param;
        return;
      case 'pict':
        if (currentPict && Object.hasOwn(PICTURE_FORMATS, word)) currentPict.format = PICTURE_FORMATS[word]!;
        return;
      case 'pn':
        if (word === 'pnlvlblt') pnState.ordered = false;
        else if (word === 'pnlvlbody' || word === 'pndec' || word === 'pnucltr' || word === 'pnlcltr' || word === 'pnucrm' || word === 'pnlcrm') pnState.ordered ??= true;
        else if (word === 'pnstart' && param !== null) pnState.start = param;
        else if (word === 'pnlvlcont') pnState.ordered = null;
        return;
      default:
        break;
    }
    // Character properties, in every group that holds text.
    switch (word) {
      case 'plain':
        top.c = plainChars(deff);
        return;
      case 'b':
        top.c = { ...c, b: toggle(param) };
        return;
      case 'i':
        top.c = { ...c, i: toggle(param) };
        return;
      case 'strike':
      case 'striked':
        top.c = { ...c, s: toggle(param) };
        return;
      case 'sub':
        top.c = { ...c, sub: toggle(param), sup: false };
        return;
      case 'super':
        top.c = { ...c, sup: toggle(param), sub: false };
        return;
      case 'nosupersub':
        top.c = { ...c, sub: false, sup: false };
        return;
      case 'v':
      case 'deleted':
        top.c = { ...c, hidden: toggle(param) };
        return;
      case 'f':
        if (param !== null) top.c = { ...c, font: param };
        return;
      case 'fs':
        if (param !== null && param > 0) top.c = { ...c, size: param };
        return;
    }
    // Paragraph properties.
    switch (word) {
      case 'pard':
        top.p = plainPara();
        return;
      case 'intbl':
        top.p = { ...top.p, intbl: true };
        return;
      case 'itap':
        top.p = { ...top.p, intbl: (param ?? 1) > 0 };
        return;
      case 's':
        if (param !== null) top.p = { ...top.p, style: param };
        return;
      case 'outlinelevel':
        if (param !== null) top.p = { ...top.p, outline: param };
        return;
      case 'ls':
        if (param !== null) top.p = { ...top.p, ls: param };
        return;
      case 'ilvl':
        if (param !== null) top.p = { ...top.p, ilvl: Math.max(0, param) };
        return;
    }
    if (top.dest !== 'body') {
      if (top.dest === 'listtext' && word === 'tab') emit('\t', at);
      return;
    }
    // Text and structure in the body.
    switch (word) {
      case 'par':
      case 'sect':
      case 'page':
        finishPara('par', end);
        return;
      case 'cell':
        finishPara('cell', end);
        return;
      case 'row':
        finishPara('row', end);
        return;
      case 'nestcell':
      case 'nestrow':
      case 'line':
        take(at);
        kids.push({ t: 'br' });
        return;
      default: {
        if (Object.hasOwn(SYMBOLS, word)) emit(SYMBOLS[word]!, at);
      }
    }
  };
  let binSkip = 0;

  /** Past the raw bytes of a `\binN` whose backslash is at `at`, or -1 when no `\bin` is there. */
  const binAt = (at: number): number => {
    if (bytes[at + 1] !== 0x62 || bytes[at + 2] !== 0x69 || bytes[at + 3] !== 0x6e) return -1;
    let k = at + 4;
    const from = k;
    while (k < n && k - from < 10 && isDigit(bytes[k]!)) k++;
    if (k === from || isLetter(bytes[k] ?? 0)) return -1;
    const len = Number(String.fromCharCode(...bytes.subarray(from, k)));
    if (bytes[k] === 0x20) k++;
    return Math.min(n, k + len);
  };

  /** Skips the group whose `{` is at `i - 1`, to just past its `}`; braces in it are counted, escapes stepped over. */
  const skipGroup = (from: number): number => {
    let depth = 1;
    let i = from;
    while (i < n && depth > 0) {
      const c = bytes[i]!;
      if (c === 0x5c) {
        const bin = binAt(i);
        i = bin < 0 ? i + 2 : bin;
      } else {
        if (c === 0x7b) depth++;
        else if (c === 0x7d) depth--;
        i++;
      }
    }
    return Math.min(i, n);
  };

  let i = 0;
  while (i < n && !chars.hit) {
    const c = bytes[i]!;
    if (binSkip > 0) {
      i += binSkip;
      binSkip = 0;
      continue;
    }
    if (c === 0x7b) {
      flush();
      skipLeft = 0;
      if (!depth.take()) {
        i = skipGroup(i + 1);
        continue;
      }
      stack.push(top);
      top = { ...top, close: null };
      groupStart = i;
      groupFresh = true;
      // A style is a group directly inside the style sheet; a style that is not committed by its `;` or its close is dropped.
      if (top.dest === 'stylesheet' && top.name === 'sheet') {
        top.name = 'style';
        curStyle = { id: 0, name: '', outline: null, done: false };
      }
      if (top.dest === 'pict' || top.dest === 'object') top.dest = top.dest === 'object' ? 'object' : 'skip';
      i++;
      continue;
    }
    if (c === 0x7d) {
      flush();
      skipLeft = 0;
      star = false;
      groupFresh = false;
      const done = top;
      const outer = stack.pop();
      if (!outer) {
        i++;
        continue;
      }
      depth.give();
      if (done.dest === 'fonttbl' && outer.dest === 'fonttbl') commitFont();
      if (done.dest === 'stylesheet' && done.name === 'style' && outer.name === 'sheet') commitStyle();
      top = outer;
      done.close?.(outer);
      i++;
      // The document's group closed: what follows is not the document.
      if (stack.length === 0 && started) break;
      continue;
    }
    if (c === 0x5c) {
      tokStart = i;
      const d = bytes[i + 1];
      if (d === undefined) break;
      if (isLetter(d)) {
        let j = i + 1;
        while (j < n && isLetter(bytes[j]!)) j++;
        // RTF words are at most 32 letters: a longer one is all read, and names nothing.
        const word = j - i - 1 <= 32 ? String.fromCharCode(...bytes.subarray(i + 1, j)) : '';
        let param: number | null = null;
        let k = j;
        const neg = bytes[k] === 0x2d && isDigit(bytes[k + 1] ?? 0);
        if (neg) k++;
        const digitsFrom = k;
        while (k < n && k - digitsFrom < 10 && isDigit(bytes[k]!)) k++;
        if (k > digitsFrom) param = (neg ? -1 : 1) * Number(String.fromCharCode(...bytes.subarray(digitsFrom, k)));
        else if (neg) k--;
        const end = k;
        if (bytes[k] === 0x20) k++;
        i = k;
        controlWord(word, param, tokStart, end);
        continue;
      }
      // A control symbol.
      groupFresh = false;
      if (d === 0x27) {
        const h = hexOf(bytes[i + 2] ?? 0);
        const l = hexOf(bytes[i + 3] ?? 0);
        i += 4;
        if (skipLeft > 0) {
          skipLeft--;
          continue;
        }
        if (h >= 0 && l >= 0) {
          if (top.dest === 'pict' && currentPict) currentPict.bytes += 0.5;
          else addByte(h * 16 + l, true, tokStart);
        }
        continue;
      }
      i += 2;
      if (d === 0x2a) {
        flush();
        star = true;
        continue;
      }
      if (skipLeft > 0) {
        skipLeft--;
        continue;
      }
      if (d === 0x5c || d === 0x7b || d === 0x7d) addByte(d, false, tokStart);
      else if (d === 0x7e) {
        flush();
        emit(' ', tokStart);
      } else if (d === 0x2d) {
        flush();
        emit('­', tokStart);
      } else if (d === 0x5f) {
        flush();
        emit('‑', tokStart);
      } else if (d === 0x0a || d === 0x0d) controlWord('par', null, tokStart, i);
      continue;
    }
    if (c === 0x0a || c === 0x0d) {
      i++;
      continue;
    }
    groupFresh = false;
    // Picture data and skipped groups are only stepped over.
    if (top.dest === 'pict' || top.dest === 'skip' || top.dest === 'object' || top.dest === 'info' || top.dest === 'time' || top.dest === 'pn') {
      let j = i;
      let hex = 0;
      while (j < n) {
        const b = bytes[j]!;
        if (b === 0x5c || b === 0x7b || b === 0x7d) break;
        if (hexOf(b) >= 0) hex++;
        j++;
      }
      if (top.dest === 'pict' && currentPict) currentPict.bytes += hex / 2;
      i = j;
      skipLeft = 0;
      continue;
    }
    if (skipLeft > 0) {
      skipLeft--;
      i++;
      continue;
    }
    tokStart = i;
    addByte(c, false, i);
    i++;
  }
  flush();
  if (kids.length > 0) finishPara('par', Math.min(i, n));

  if (depth.hit) cut.push(`Groups nested more than ${depth.limit} deep are not read: ${figure(depth.refused)} of them, and all they hold, are left out.`);
  if (chars.hit) cut.push(`Only the first ${(chars.limit / 1024 / 1024).toFixed(0)} MB of text is read; the rest of the file is not shown.`);
  if (objects.hit) cut.push(`Only the first ${figure(objects.limit)} pictures and objects are named; ${figure(objects.refused)} more are left out.`);

  const label = labelOfCodePage(docPage);
  const said = [
    label
      ? `Characters written by number are read in code page ${docPage} (${nameOf(label).replace(/^windows-/, 'Windows-')}), as the file says${fonts.size && [...fonts.values()].some((f) => f.page !== null) ? ', or in the code page its font declares' : ''}.`
      : `The file’s code page, ${docPage}, is not one Marxy reads: characters written by number in it show as �.`,
  ];

  const blocks = assemble(recs, styles, sizeChars);
  const props: OfficeProps = {
    ...emptyProps(),
    title: info.title?.trim() || null,
    subject: info.subject?.trim() || null,
    creator: info.author?.trim() || null,
    lastModifiedBy: info.operator?.trim() || null,
    created: times.creatim ?? null,
    modified: times.revtim ?? null,
    application: generator.replace(/;\s*$/, '').trim() || null,
    pages,
  };
  return {
    format: 'rtf',
    blocks: blocks.blocks,
    notes: [],
    images,
    props,
    counts: { comments: 0, footnotes: 0, endnotes: 0, slides: 0, hiddenSlides: 0, speakerNotes: 0 },
    leftOut,
    sources: blocks.sources,
    cut,
    said,
  };
}

/** The paragraphs read, as blocks: tables from their cells and rows, lists nested by level, headings found. */
function assemble(recs: readonly Rec[], styles: ReadonlyMap<number, { name: string; outline: number | null }>, sizeChars: ReadonlyMap<number, number>): { blocks: Block[]; sources: Map<object, readonly [number, number]> } {
  const sources = new Map<object, readonly [number, number]>();
  const blocks: Block[] = [];
  let body = 24;
  let most = -1;
  for (const [size, count] of sizeChars) if (count > most) [body, most] = [size, count];
  const headingLevel = (r: Rec): number | null => {
    const style = styles.get(r.style);
    const outline = r.outline ?? style?.outline ?? null;
    if (outline !== null && outline >= 0 && outline < 9) return outline + 1;
    const named = style ? /^heading\s*([1-9])$/i.exec(style.name) : null;
    if (named) return Number(named[1]);
    if (style && /^title$/i.test(style.name)) return 1;
    return null;
  };
  const bySize = (r: Rec): boolean => !r.intbl && !r.list && r.chars > 0 && r.chars <= 200 && r.minSize !== Number.POSITIVE_INFINITY && r.minSize >= body * 1.15;
  const sizes = [...new Set(recs.filter(bySize).map((r) => r.minSize))].sort((a, b) => b - a);

  let table: { rows: Inline[][][]; s: number; e: number } | null = null;
  let row: Inline[][] = [];
  let rowStart = -1;
  let cell: Inline[] = [];
  let cellOpen = false;
  let lists: { list: { t: 'list'; ordered: boolean; start: number; items: Block[][] }; level: number; s: number; e: number }[] = [];

  const closeLists = (): void => {
    for (const l of lists) sources.set(l.list, [l.s, l.e]);
    lists = [];
  };
  const closeTable = (): void => {
    if (cellOpen || row.length > 0) endRow(table ? table.e : rowStart);
    if (table && table.rows.length > 0) {
      const t: Block = { t: 'table', rows: table.rows };
      sources.set(t, [table.s, table.e]);
      blocks.push(t);
    }
    table = null;
  };
  const endRow = (e: number): void => {
    if (cellOpen) {
      row.push(cell);
      cell = [];
      cellOpen = false;
    }
    if (row.length > 0) {
      table ??= { rows: [], s: rowStart, e };
      table.rows.push(row);
      table.e = e;
      sources.set(row, [rowStart, e]);
    }
    row = [];
    rowStart = -1;
  };

  for (const r of recs) {
    if (r.intbl) {
      closeLists();
      if (rowStart < 0) rowStart = r.s;
      table ??= { rows: [], s: r.s, e: r.e };
      if (r.end === 'row') {
        if (r.kids.length > 0) {
          if (cellOpen && cell.length > 0) cell.push({ t: 'br' });
          pushAll(cell, r.kids);
          cellOpen = true;
        }
        endRow(r.e);
        continue;
      }
      if (cellOpen && cell.length > 0 && r.kids.length > 0) cell.push({ t: 'br' });
      pushAll(cell, r.kids);
      cellOpen = true;
      if (r.end === 'cell') {
        row.push(cell);
        cell = [];
        cellOpen = false;
      }
      continue;
    }
    if (table || row.length > 0 || cellOpen) closeTable();
    const para: Block = { t: 'para', kids: r.kids };
    if (r.list) {
      const { level, ordered, start } = r.list;
      const popList = (): void => {
        const l = lists.pop()!;
        sources.set(l.list, [l.s, l.e]);
      };
      while (lists.length > 0 && lists[lists.length - 1]!.level > level) popList();
      let at = lists[lists.length - 1];
      // A bulleted list after a numbered one at the same level is a list of its own.
      if (at && at.level === level && at.list.ordered !== ordered) {
        popList();
        at = lists[lists.length - 1];
      }
      if (!at || at.level < level) {
        const list = { t: 'list' as const, ordered, start, items: [] as Block[][] };
        if (at) {
          const items = at.list.items;
          if (items.length > 0) items[items.length - 1]!.push(list);
          else items.push([list]);
        } else blocks.push(list);
        lists.push({ list, level, s: r.s, e: r.e });
        at = lists[lists.length - 1]!;
      }
      at.list.items.push([para]);
      for (const l of lists) l.e = r.e;
      sources.set(para, [r.s, r.e]);
      continue;
    }
    closeLists();
    const level = headingLevel(r) ?? (bySize(r) ? Math.min(6, sizes.indexOf(r.minSize) + 1) : null);
    const block: Block = level !== null ? { t: 'heading', level, kids: r.kids } : para;
    sources.set(block, [r.s, r.e]);
    blocks.push(block);
  }
  if (table || row.length > 0 || cellOpen) closeTable();
  closeLists();
  return { blocks, sources };
}
