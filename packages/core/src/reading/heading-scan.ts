// A big Markdown file's headings, found by a scan of its lines rather than a parse: ATX headings (`#` to `######`) and
// setext underlines, with fenced code, front matter and HTML blocks passed over, as CommonMark reads them at the top
// level. One pass over the line index a slice at a time, never a tree, so the Outline of a 50 MB file costs the time it
// takes to look at each line's first bytes. It is a scan, not the parse: a heading inside a list item or a block quote is
// not looked for, and a lazy continuation line is taken as the parse would mostly take it. Pure.
import type { Pace } from '../data/table-view.ts';
import type { ReadingLines } from './lines.ts';

/** The most headings kept: past this the Outline says it lists the first ones. */
export const SCANNED_HEADINGS_MAX = 20_000;
/** The most characters of a heading's text kept. */
const TEXT_MAX = 200;
/**
 * The most bytes of one line ever decoded: a heading's text, an HTML block's opening tag and front matter's title are all
 * near a line's start, and a single line can be tens of megabytes.
 */
const LINE_HEAD_BYTES = 4096;
/** The most bytes of front matter read for its title. */
const FRONT_MATTER_BYTES = 64 * 1024;

export interface ScannedHeading {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Its text with inline marks taken off simply (emphasis, code ticks, links to their words, tags). */
  readonly text: string;
  /** The byte its first line begins at, and the byte its last line's text ends at. */
  readonly start: number;
  readonly end: number;
  /** Its first line, counted from 0. */
  readonly line: number;
}

export interface ScannedHeadings {
  readonly items: readonly ScannedHeading[];
  /** More headings than SCANNED_HEADINGS_MAX: the items are the first ones. */
  readonly capped: boolean;
}

const SP = 0x20;
const TAB = 0x09;
const utf8 = new TextDecoder('utf-8');

// The block tags that open an HTML block which ends at a blank line (CommonMark's sixth kind).
const BLOCK_TAGS = new Set(
  (
    'address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt ' +
    'fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link ' +
    'main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead ' +
    'title tr track ul'
  ).split(' '),
);
const RAW_TAGS = /^<(?:script|pre|style|textarea)(?:\s|>|$)/i;
// A whole open or closing tag alone on its line (the seventh kind), which cannot interrupt a paragraph.
const LONE_TAG = /^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)\s*$/;

/** What ends an HTML block that is open: 1 to 5 end at a marker on some line, 6 and 7 at a blank line. */
type HtmlEnd = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const END_MARKS: Readonly<Record<2 | 3 | 4 | 5, string>> = { 2: '-->', 3: '?>', 4: '>', 5: ']]>' };

/** The kind of HTML block the text from `<` opens, or 0. `para`: a paragraph is open, which the seventh cannot interrupt. */
function htmlStart(text: string, para: boolean): HtmlEnd | 0 {
  if (RAW_TAGS.test(text)) return 1;
  if (text.startsWith('<!--')) return 2;
  if (text.startsWith('<?')) return 3;
  if (text.startsWith('<![CDATA[')) return 5;
  if (/^<![A-Za-z]/.test(text)) return 4;
  const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s|\/?>|$)/.exec(text);
  if (tag && BLOCK_TAGS.has(tag[1]!.toLowerCase())) return 6;
  if (!para && LONE_TAG.test(text)) return 7;
  return 0;
}

const RAW_END_NAMES = ['script', 'pre', 'style', 'textarea'];

/** Whether `bytes[from, to)` holds the ASCII `mark`, with letters matched in either case when `fold`. Reads no text. */
function holdsAscii(bytes: Uint8Array, from: number, to: number, mark: string, fold: boolean): boolean {
  const first = mark.charCodeAt(0);
  for (let at = bytes.indexOf(first, from); at >= 0 && at + mark.length <= to; at = bytes.indexOf(first, at + 1)) {
    let k = 1;
    for (; k < mark.length; k++) {
      const b = bytes[at + k]!;
      const m = mark.charCodeAt(k);
      if (b !== m && !(fold && (b | 0x20) === m && m >= 0x61 && m <= 0x7a)) break;
    }
    if (k === mark.length) return true;
  }
  return false;
}

/**
 * Whether an HTML block of kind `kind` (1 to 5) ends in the line `bytes[from, to)`. Its marks are ASCII, so they are looked
 * for in the bytes: a line of any length is never decoded for it.
 */
function htmlEndsIn(kind: HtmlEnd, bytes: Uint8Array, from: number, to: number): boolean {
  if (kind === 1) return RAW_END_NAMES.some((name) => holdsAscii(bytes, from, to, `</${name}>`, true));
  return holdsAscii(bytes, from, to, END_MARKS[kind as 2 | 3 | 4 | 5], false);
}

/** A link reference definition's first line (`[label]: destination`), which a paragraph made only of them is not. */
const DEFINITION = /^ {0,3}\[(?:[^\]\\]|\\.)+\]:/;

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** A heading's raw text as a row says it: inline marks taken off simply, never parsed. */
export function plainHeadingText(raw: string): string {
  // An escaped mark is set aside first, so the marks taken off below never take it, and put back as itself at the end.
  let t = raw
    .replace(/\\([!-/:-@[-`{-~])/g, (_m, c: string) => String.fromCharCode(0xe000 + c.charCodeAt(0)))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<((?:https?|mailto|ftp):[^>\s]*)>/gi, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/`+/g, '')
    .replace(/(\*\*|__|~~|\*)/g, '')
    // An underscore is a mark only at a word's edge: snake_case keeps its own.
    .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1')
    .replace(/[-]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xe000))
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[name.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > TEXT_MAX) {
    // Never half a surrogate pair at the cut.
    let cut = TEXT_MAX - 1;
    const unit = t.charCodeAt(cut - 1);
    if (unit >= 0xd800 && unit <= 0xdbff) cut--;
    t = `${t.slice(0, cut)}…`;
  }
  return t;
}

/** An ATX heading's content: between the marks and an optional closing run of `#` that a space sets apart. */
function atxContent(text: string): string {
  let t = text.replace(/[ \t]+$/, '');
  const close = /(?:^|[ \t])#+$/.exec(t);
  if (close) t = t.slice(0, close.index);
  return t.trim();
}

/**
 * The headings of a Markdown file read as lines, a slice at a time; kept on `lines` (`headings`) once found. Null when
 * `pace` stops it. Linear in the lines, and only a heading's lines (and a setext heading's first few) are decoded.
 */
export async function scanHeadings(lines: ReadingLines, pace: Pace): Promise<ScannedHeadings | null> {
  if (lines.headings) return lines.headings;
  const { bytes, starts, ends, count } = lines;
  const budget = pace.budgetMs ?? 8;
  const now = pace.now ?? (() => performance.now());
  // At most the head of a line is ever decoded (LINE_HEAD_BYTES); a cut in the middle of a character decodes as U+FFFD.
  const text = (from: number, to: number, most = LINE_HEAD_BYTES): string => utf8.decode(bytes.subarray(from, Math.min(to, from + most)));

  const items: ScannedHeading[] = [];
  let capped = false;
  const push = (h: ScannedHeading): void => {
    if (items.length < SCANNED_HEADINGS_MAX) items.push(h);
    else capped = true;
  };

  // Front matter: a first line of `---` (YAML) or `+++` (TOML), closed by the same. Looked for once; when it never closes
  // the scan starts again with none, so the file is passed over at most twice.
  let front: 0x2d | 0x2b | 0 = 0;
  let frontTitle: string | null = null;
  const fenceOnly = (i: number, c: number): boolean => {
    let p = starts[i]!;
    const e = ends[i]!;
    if (bytes[p] !== c || bytes[p + 1] !== c || bytes[p + 2] !== c) return false;
    p += 3;
    while (p < e && (bytes[p] === SP || bytes[p] === TAB)) p++;
    return p === e;
  };
  if (count > 1 && (fenceOnly(0, 0x2d) || fenceOnly(0, 0x2b))) front = bytes[starts[0]!] as 0x2d | 0x2b;
  let frontAt = front ? 1 : 0;

  let fence: { readonly char: number; readonly len: number } | null = null;
  let html: HtmlEnd | null = null;
  /** The first line of the paragraph open now, or -1. */
  let para = -1;
  /** A list item or block quote holds the lines since the last blank one: none of them starts a paragraph here. */
  let contained = false;
  /** Every line of the open paragraph is a link reference definition: no setext underline makes it a heading. */
  let definitions = false;
  let i = 0;
  if (front) i = 1;

  while (i < count) {
    if (pace.aborted?.()) return null;
    const t0 = now();
    let block = 0;
    for (; i < count; i++) {
      if (++block === 1024) {
        block = 0;
        if (now() - t0 >= budget) break;
      }
      const s = starts[i]!;
      const e = ends[i]!;
      if (front) {
        if (fenceOnly(i, front)) {
          if (frontTitle === null) {
            const matter = text(starts[frontAt]!, starts[i]!, FRONT_MATTER_BYTES);
            const raw = (/^title:[ \t]*(\S.*)$/m.exec(matter) ?? /^title\s*=\s*(\S.*)$/m.exec(matter))?.[1];
            if (raw && !/^[|>][+-]?\d*\s*$/.test(raw)) {
              const q = raw.trim();
              frontTitle = (q[0] === '"' || q[0] === "'") && q.length >= 2 && q.endsWith(q[0]) ? q.slice(1, -1) : q;
            }
          }
          frontAt = i;
          front = 0;
        }
        continue;
      }
      // Where the line's first mark is, and how far in: a tab goes to the next stop of four.
      let p = s;
      let col = 0;
      while (p < e && (bytes[p] === SP || bytes[p] === TAB)) {
        col = bytes[p] === TAB ? col + 4 - (col % 4) : col + 1;
        p++;
      }
      const blank = p === e;
      if (fence) {
        // A closing fence: the same mark at least as long, at most three in, and nothing after it but space.
        if (col < 4 && bytes[p] === fence.char) {
          let q = p;
          while (q < e && bytes[q] === fence.char) q++;
          let r = q;
          while (r < e && (bytes[r] === SP || bytes[r] === TAB)) r++;
          if (q - p >= fence.len && r === e) fence = null;
        }
        continue;
      }
      if (html !== null) {
        if (html >= 6) {
          if (blank) html = null;
        } else if (htmlEndsIn(html, bytes, s, e)) html = null;
        if (html === null || blank) para = -1;
        continue;
      }
      if (blank) {
        para = -1;
        contained = false;
        continue;
      }
      // Indented code, or a paragraph's line that happens to be indented: never a heading.
      if (col >= 4) continue;
      const c = bytes[p]!;
      if (c === 0x60 || c === 0x7e) {
        let q = p;
        while (q < e && bytes[q] === c) q++;
        // A backtick fence's info string holds no backtick; otherwise it is inline code in a paragraph.
        if (q - p >= 3 && (c === 0x7e || bytes.subarray(q, e).indexOf(0x60) < 0)) {
          fence = { char: c, len: q - p };
          para = -1;
          contained = false;
          continue;
        }
      }
      if (c === 0x23) {
        let q = p;
        while (q < e && bytes[q] === 0x23 && q - p < 7) q++;
        const n = q - p;
        if (n <= 6 && (q === e || bytes[q] === SP || bytes[q] === TAB)) {
          push({ level: n as ScannedHeading['level'], text: plainHeadingText(atxContent(text(q, e))), start: s, end: e, line: i });
          para = -1;
          contained = false;
          continue;
        }
      }
      if (para >= 0 && !contained && !definitions && (c === 0x3d || c === 0x2d)) {
        let q = p;
        while (q < e && bytes[q] === c) q++;
        let r = q;
        while (r < e && (bytes[r] === SP || bytes[r] === TAB)) r++;
        if (r === e) {
          // The paragraph's lines are its text; only the first few are read, as a row shows no more.
          let raw = '';
          for (let k = para; k < i && raw.length < TEXT_MAX * 2; k++) raw += `${text(starts[k]!, ends[k]!)} `;
          push({ level: c === 0x3d ? 1 : 2, text: plainHeadingText(raw), start: starts[para]!, end: e, line: para });
          para = -1;
          continue;
        }
      }
      // A thematic break ends the paragraph: three or more of one of `*`, `-`, `_`, spaces between allowed.
      if (c === 0x2a || c === 0x2d || c === 0x5f) {
        let n = 0;
        let q = p;
        while (q < e && (bytes[q] === c || bytes[q] === SP || bytes[q] === TAB)) if (bytes[q++] === c) n++;
        if (q === e && n >= 3) {
          para = -1;
          contained = false;
          continue;
        }
      }
      if (c === 0x3c) {
        const kind = htmlStart(text(p, e), para >= 0);
        if (kind !== 0) {
          para = -1;
          html = kind <= 5 && htmlEndsIn(kind, bytes, p + 1, e) ? null : kind;
          continue;
        }
      }
      // A block quote or a list item: what follows until a blank line is inside it, where no heading is looked for.
      if (c === 0x3e || ((c === 0x2d || c === 0x2b || c === 0x2a) && (p + 1 === e || bytes[p + 1] === SP || bytes[p + 1] === TAB))) {
        contained = true;
        para = -1;
        continue;
      }
      if (c >= 0x30 && c <= 0x39) {
        let q = p;
        while (q < e && q - p < 10 && bytes[q]! >= 0x30 && bytes[q]! <= 0x39) q++;
        const after = bytes[q];
        if (q - p <= 9 && (after === 0x2e || after === 0x29) && (q + 1 === e || bytes[q + 1] === SP || bytes[q + 1] === TAB)) {
          // An ordered list interrupts a paragraph only when it starts at 1.
          if (para < 0 || (q - p === 1 && c === 0x31)) {
            contained = true;
            para = -1;
            continue;
          }
        }
      }
      if (para < 0 && !contained) {
        para = i;
        definitions = c === 0x5b && DEFINITION.test(text(s, e));
      } else if (para >= 0 && definitions) definitions = c === 0x5b && DEFINITION.test(text(s, e));
    }
    pace.onSlice?.(i / Math.max(1, count));
    if (i < count) {
      await pace.yieldNow();
      continue;
    }
    if (front) {
      // Front matter that never closes is none: the first line is read again as the file's own.
      front = 0;
      frontAt = 0;
      i = 0;
    }
  }
  if (frontTitle !== null && !items.some((h) => h.level === 1)) {
    // The title takes the first place; the list stays within its most.
    if (items.length >= SCANNED_HEADINGS_MAX) {
      items.pop();
      capped = true;
    }
    items.unshift({ level: 1, text: plainHeadingText(frontTitle), start: starts[0]!, end: ends[frontAt]!, line: 0 });
  }
  lines.headings = { items, capped };
  return lines.headings;
}
