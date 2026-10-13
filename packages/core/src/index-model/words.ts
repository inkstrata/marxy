// The one word counter (F-86). The status bar, the library's `words:` filter (`measureText`) and the Outline's words per
// section all count through `createWordCounter`, so they cannot disagree.
//
// What a word is. A run of text between spaces that holds a letter or a number is one word. A run that holds a character of
// a script written without spaces (Chinese, Japanese, Thai) is cut by the system's word breaker (`Intl.Segmenter`,
// granularity "word": ICU's dictionary breaker, in Node and in WebKit) and counted by the segments it calls word-like, so
// "我们今天去公园" is four words, not one. Where `Intl.Segmenter` is missing, such a run counts one word per character of
// those scripts, which over-counts and never hides text.
//
// What a Markdown file does not count (`markdown: true`, for a `.md` file): front matter (a `---` or `+++` block at the top
// that closes), fenced code (``` or ~~~, to its closing fence or the end), indented code (four spaces or a tab, after a blank
// line, outside a list) and HTML comments (`<!-- … -->`, over lines too). It reads lines, not the parse, so it needs no AST
// and gives the same number over a whole file and over the sections that tile it. Link targets, URLs and markup characters
// are counted as they stand (`[the doc](a.md)` is two words), and a fence inside a block quote is counted.
//
// Streaming: `feed` takes the text in any pieces and the count is the same however it was cut. `done` ends it (call it once, at the end); `count` reads the same number
// part-way without ending it.
// No DOM, no Node built-ins.
import { fileTypeOf } from './file-types.ts';

export interface WordCounter {
  feed(chunk: string): void;
  /** The count, with the run and the line being read counted. Ends the counter: call once, after the last `feed`. */
  done(): number;
  /** The same number, read without ending the counter: more can be fed after. Costs the line being read, not the text so far. */
  count(): number;
}

export interface WordSegmenter {
  segment(text: string): Iterable<{ readonly segment: string; readonly isWordLike?: boolean }>;
}

export interface WordCountOptions {
  /** Skip front matter, code and HTML comments (a Markdown file). */
  readonly markdown?: boolean;
  /** The word breaker for scripts written without spaces; `null` forces the one-per-character fallback. For tests. */
  readonly segmenter?: WordSegmenter | null;
}

/** Whether a file is counted as Markdown: by its name, as the file-type table says. */
export function countsAsMarkdown(path: string): boolean {
  return fileTypeOf(path)?.kind === 'markdown';
}

const isSpace = (c: number): boolean =>
  c <= 0x20 ? c === 0x20 || (c >= 0x09 && c <= 0x0d)
  : c < 0x80 ? false
  : c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;

const TOKEN = /[\p{L}\p{N}]/u;

/** Thai, Lao, Myanmar, Khmer; kana; the CJK ideographs and their extensions (a pair is judged by its high half, U+20000 on). */
const unspaced = (c: number): boolean =>
  (c >= 0x0e01 && c <= 0x0edf) || (c >= 0x1000 && c <= 0x109f) || (c >= 0x1780 && c <= 0x17ff)
  || (c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff)
  || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff66 && c <= 0xff9f) || (c >= 0xd840 && c <= 0xd87f);

let system: { readonly breaker: WordSegmenter | null } | null = null;
function systemBreaker(): WordSegmenter | null {
  if (system === null) {
    let breaker: WordSegmenter | null = null;
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') breaker = new Intl.Segmenter(undefined, { granularity: 'word' });
    } catch {
      breaker = null;
    }
    system = { breaker };
  }
  return system.breaker;
}

/** The words of one run that holds a character of an unspaced script. */
function wordsOfRun(run: string, breaker: WordSegmenter | null): number {
  let n = 0;
  if (breaker !== null) {
    for (const part of breaker.segment(run)) if (part.isWordLike === true) n++;
    return n;
  }
  // No breaker: each character of an unspaced script is a word, and any other stretch of letters and numbers is one.
  let inOther = false;
  for (const ch of run) {
    const c = ch.codePointAt(0)!;
    if (!TOKEN.test(ch)) inOther = false;
    else if (unspaced(c <= 0xffff ? c : 0xd840)) {
      n++;
      inOther = false;
    } else {
      if (!inOther) n++;
      inOther = true;
    }
  }
  return n;
}

/** Runs that need the breaker are broken together once this much text has gathered. */
const BATCH = 2 * 1024;
const FENCE = /^(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^(`{3,}|~{3,})[ \t]*$/;
const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** A line is classified whole up to this long; a longer one is read a piece at a time, in the mode its first piece set. */
const LINE_PIECE = 64 * 1024;

type Mode = 'prose' | 'front' | 'fence' | 'comment';

export function createWordCounter(options: WordCountOptions = {}): WordCounter {
  const markdown = options.markdown === true;
  const breaker = options.segmenter === undefined ? systemBreaker() : options.segmenter;

  // ---- words in text, however it is cut
  let words = 0;
  let inRun = false;
  let hit = false;
  let needsBreaker = false;
  /** The run so far, from the pieces before this one. */
  let runText = '';
  /** Runs that need the breaker, joined by spaces and broken together: one call per few KB, not one per run. */
  let batch = '';
  /** A high surrogate that ended the last piece: its pair is the first unit of the next. */
  let carry = '';

  const flushBatch = (): void => {
    if (batch !== '') words += wordsOfRun(batch, breaker);
    batch = '';
  };
  const finishRun = (tail: string): void => {
    batch += runText + tail + ' ';
    if (batch.length >= BATCH) flushBatch();
  };

  const text = (chunk: string): void => {
    const piece = carry === '' ? chunk : carry + chunk;
    carry = '';
    let n = piece.length;
    if (n > 0) {
      const last = piece.charCodeAt(n - 1);
      if (last >= 0xd800 && last <= 0xdbff) {
        carry = piece.charAt(n - 1);
        n--;
      }
    }
    let start = 0;
    for (let i = 0; i < n; i++) {
      const c = piece.charCodeAt(i);
      if (isSpace(c)) {
        if (inRun) {
          if (needsBreaker) finishRun(piece.slice(start, i));
          else if (hit) words++;
          inRun = false;
        }
        continue;
      }
      if (!inRun) {
        inRun = true;
        hit = false;
        needsBreaker = false;
        runText = '';
        start = i;
      }
      if (needsBreaker) continue;
      if (c < 0x80) {
        if (!hit) hit = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
      } else if (unspaced(c)) needsBreaker = true;
      else if (c >= 0xd800 && c <= 0xdbff) {
        // n excludes a final high half, so its pair is in the piece.
        if (!hit) hit = TOKEN.test(piece.slice(i, i + 2));
        i++;
      } else if (!hit) hit = TOKEN.test(piece.charAt(i));
    }
    if (inRun) runText += piece.slice(start, n);
    start = 0;
  };
  const endRun = (): void => {
    if (!inRun) return;
    if (needsBreaker) finishRun('');
    else if (hit) words++;
    inRun = false;
  };

  // ---- Markdown: lines, and the modes they put the counter in
  let mode: Mode = 'prose';
  let first = true;
  let continued = false;
  let skipping = false;
  let frontMark = '';
  let wordsBeforeFront = 0;
  let fenceChar = '';
  let fenceLen = 0;
  let prevBlank = true;
  let inCode = false;
  let inList = false;
  let pending = '';

  const save = () => ({
    words, inRun, hit, needsBreaker, runText, batch, carry, mode, first, continued, skipping, frontMark, wordsBeforeFront,
    fenceChar, fenceLen, prevBlank, inCode, inList, pending,
  });
  const restore = (s: ReturnType<typeof save>): void => {
    ({ words, inRun, hit, needsBreaker, runText, batch, carry, mode, first, continued, skipping, frontMark, wordsBeforeFront } = s);
    ({ fenceChar, fenceLen, prevBlank, inCode, inList, pending } = s);
  };
  /** `finish` ends the text where it stands, which changes the counter; `count` reads the same number and leaves it as it was. */
  let finish = (): number => {  // the plain text's; Markdown replaces it below
    endRun();
    flushBatch();
    return words;
  };
  const count = (): number => {
    const saved = save();
    const n = finish();
    restore(saved);
    return n;
  };

  if (!markdown) return { feed: text, done: finish, count };

  /** Text outside code, with HTML comments left out; a comment may run over lines. */
  const prose = (line: string): void => {
    let from = 0;
    for (;;) {
      if (mode === 'comment') {
        const close = line.indexOf('-->', from);
        if (close === -1) return;
        from = close + 3;
        mode = 'prose';
      } else {
        const open = line.indexOf('<!--', from);
        if (open === -1) {
          text(from === 0 ? line : line.slice(from));
          return;
        }
        if (open > from) text(line.slice(from, open));
        from = open + 4;
        mode = 'comment';
      }
    }
  };

  const classify = (raw: string, endsLine: boolean): void => {
    if (continued) {
      if (mode === 'front') text(raw);
      else if (!skipping) prose(raw);
      continued = !endsLine;
      if (endsLine && !skipping) text('\n');
      return;
    }
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const body = first && line.charCodeAt(0) === 0xfeff ? line.slice(1) : line;
    let i = 0;
    let width = 0;
    while (i < body.length) {
      const ch = body.charCodeAt(i);
      if (ch === 0x20) width++;
      else if (ch === 0x09) width += 4 - (width % 4);
      else break;
      i++;
    }
    const blank = i === body.length || body.trim() === '';
    const head = blank ? '' : body.charAt(i);
    skipping = false;
    if (mode === 'front') {
      const t = body.trimEnd();
      if (t === frontMark || (frontMark === '---' && t === '...')) {
        // The block closed, so it was front matter: what was counted since it opened is taken back.
        words = wordsBeforeFront;
        batch = '';
        inRun = false;
        mode = 'prose';
        prevBlank = true;
        skipping = true;
      } else text(body + '\n');
    } else if (mode === 'fence') {
      const m = width <= 3 && head !== '' ? CLOSING_FENCE.exec(body.slice(i)) : null;
      if (m !== null && m[1]!.charAt(0) === fenceChar && m[1]!.length >= fenceLen) mode = 'prose';
      skipping = true;
    } else if (mode === 'comment') {
      prose(body);
      prevBlank = blank;
    } else if (first && (body.trimEnd() === '---' || body.trimEnd() === '+++')) {
      mode = 'front';
      frontMark = body.trimEnd();
      endRun();
      flushBatch();
      wordsBeforeFront = words;
      skipping = true;
    } else {
      const fence = head === '`' || head === '~' ? FENCE.exec(body.slice(i)) : null;
      if (fence !== null && (width <= 3 || inList) && !(fence[1]!.charAt(0) === '`' && fence[2]!.includes('`'))) {
        mode = 'fence';
        fenceChar = fence[1]!.charAt(0);
        fenceLen = fence[1]!.length;
        prevBlank = false;
        inCode = false;
        skipping = true;
      } else if (!blank && width >= 4 && !inList && (prevBlank || inCode)) {
        // Indented code. A blank line inside it does not end it (the blank branch below leaves `inCode` alone).
        inCode = true;
        prevBlank = false;
        skipping = true;
      } else {
        if (blank) prevBlank = true;
        else {
          if (width < 4) {
            if (LIST_ITEM.test(body.slice(i))) inList = true;
            else if (width === 0) inList = false;
          }
          prevBlank = false;
          inCode = false;
        }
        prose(body);
      }
    }
    first = false;
    if (endsLine) {
      if (!skipping && mode !== 'front') text('\n');
    } else continued = true;
  };

  finish = (): number => {
    if (pending !== '') classify(pending, true);
    pending = '';
    endRun();
    flushBatch();
    return words;
  };

  return {
    feed(chunk) {
      const buf = pending === '' ? chunk : pending + chunk;
      let at = 0;
      for (;;) {
        const nl = buf.indexOf('\n', at);
        if (nl === -1) break;
        let from = at;
        while (nl - from > LINE_PIECE) {
          classify(buf.slice(from, from + LINE_PIECE), false);
          from += LINE_PIECE;
        }
        classify(buf.slice(from, nl), true);
        at = nl + 1;
      }
      pending = at === 0 ? buf : buf.slice(at);
      while (pending.length >= LINE_PIECE * 2) {
        classify(pending.slice(0, LINE_PIECE), false);
        pending = pending.slice(LINE_PIECE);
      }
    },
    done: () => finish(),
    count,
  };
}

/** The words of a whole text. */
export function countWords(text: string, options: WordCountOptions = {}): number {
  const counter = createWordCounter(options);
  counter.feed(text);
  return counter.done();
}
