// An Office document written as Markdown, so the page is the Markdown page: one parser, one sanitiser, the reading
// typography, footnotes and tables as a Markdown file has them. Every mark in the document's text that Markdown reads is
// escaped (behind a backslash, a bar as `&#124;`), so nothing a document says can become markup: the writer's own markup
// is the only markup. Formatting is written as the inline HTML the allow-list keeps (`<strong>`, `<em>`, `<code>`, `<s>`,
// `<sub>`, `<sup>`), which, unlike `*`, cannot be undone by punctuation beside it. Asides and slide headings are recorded
// by the bytes they span, for the page to set apart once rendered. Pure.
import { inlineText, type Block, type Inline, type OfficeDoc, type Run } from './model.ts';
import { maxOf } from '../util/spread.ts';
import { figure } from '../util/budget.ts';

export interface OfficeMarks {
  /** A comment or speaker notes: the Markdown bytes its blocks were written to. */
  readonly asides: readonly { readonly start: number; readonly end: number; readonly who: string; readonly when: string | null }[];
  /** A slide's heading: the byte it starts at, its number and whether the deck hides it. */
  readonly slides: readonly { readonly at: number; readonly n: number; readonly title: string; readonly hidden: boolean }[];
  /** Each `mark` block: the byte the block after it starts at, or the end; never inside an earlier block. */
  readonly anchors: readonly { readonly id: string; readonly at: number }[];
  /**
   * For a document read with `sources`: each block's (and table row's) Markdown bytes, its last newline left out, and the
   * file's bytes it was read from; ordered by where they start in the Markdown, a block before the blocks inside it.
   */
  readonly spans: readonly SourceSpan[];
}

export interface SourceSpan {
  readonly ms: number;
  readonly me: number;
  readonly s: number;
  readonly e: number;
}

/**
 * The file's bytes behind the Markdown bytes `ms`–`me` an element was rendered from: the bytes of the blocks it holds,
 * else of the smallest block holding it (a run of bold, a table's cell); null when no block is near.
 */
export function sourceRangeOf(spans: readonly SourceSpan[], ms: number, me: number): { s: number; e: number } | null {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid]!.ms < ms) lo = mid + 1;
    else hi = mid;
  }
  let s = Number.POSITIVE_INFINITY;
  let e = Number.NEGATIVE_INFINITY;
  let past = -1;
  for (let j = lo; j < spans.length && spans[j]!.ms < me; j++) {
    const x = spans[j]!;
    // A block inside one already taken adds nothing.
    if (x.ms < past || x.me > me) continue;
    past = x.me;
    s = Math.min(s, x.s);
    e = Math.max(e, x.e);
  }
  if (s !== Number.POSITIVE_INFINITY) return { s, e };
  let k = lo;
  while (k < spans.length && spans[k]!.ms === ms) k++;
  for (let j = k - 1; j >= 0; j--) if (spans[j]!.me >= me) return { s: spans[j]!.s, e: spans[j]!.e };
  const before = spans[Math.min(lo, spans.length) - 1];
  return before ? { s: before.e, e: before.e } : null;
}

export interface OfficeMarkdown extends OfficeMarks {
  readonly markdown: string;
  /** What was left unwritten at the `blocks` cap, as the sentence the page shows above the text; empty when nothing was. */
  readonly cut: readonly string[];
}

/** The scheme an image is written under: the sanitiser drops it, and the page puts the picture or its words there. */
export const IMAGE_SCHEME = 'office-image';

// The ASCII marks Markdown gives a meaning somewhere; `" % ' , / ; ?` have none and are left as typed.
const PUNCT = /[!#$&()*+\-.:<=>@[\\\]^_`{|}~]/g;

/** Text as Markdown that reads as exactly that text. */
export function escapeText(s: string): string {
  return s.replace(/[\r\n\t\v\f]+/g, ' ').replace(PUNCT, (c) => (c === '|' ? '&#124;' : `\\${c}`));
}

const utf8Length = (s: string): number => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
};

const sameLook = (a: Run, b: Run): boolean => !!a.b === !!b.b && !!a.i === !!b.i && !!a.s === !!b.s && !!a.code === !!b.code && !!a.sub === !!b.sub && !!a.sup === !!b.sup;

function runHtml(r: Run): string {
  let s = escapeText(r.text);
  if (s === '') return '';
  if (r.code) s = `<code>${s}</code>`;
  if (r.sub) s = `<sub>${s}</sub>`;
  if (r.sup) s = `<sup>${s}</sup>`;
  if (r.s) s = `<s>${s}</s>`;
  if (r.i) s = `<em>${s}</em>`;
  if (r.b) s = `<strong>${s}</strong>`;
  return s;
}

/**
 * `href` as a link destination in angle brackets. Angle brackets, a backslash and white space would end or escape it;
 * a bar would end a table's cell around it; the rest are Markdown's marks, encoded so the address is only an address.
 * `encodeURIComponent` leaves `*`, `_`, `!`, `(` and `)` as they are, so those are written out by hand.
 */
const destination = (href: string): string =>
  `<${href.replace(/[<>\\\s|*_`[\]!()]/g, (c) => (/[*_!()]/.test(c) ? `%${c.charCodeAt(0).toString(16).toUpperCase()}` : encodeURIComponent(c)))}>`;

interface InlineCtx {
  /** In a table cell, a line break is `<br>`; in a heading, a space. */
  readonly br: string;
  readonly alt: (image: number) => string;
  /** A note's label as written: the writer's own, by the order of the notes; null for a mark with no note. */
  readonly note: (label: string) => string | null;
}

function inlines(kids: readonly Inline[], ctx: InlineCtx): string {
  const out: string[] = [];
  let pending: Run | null = null;
  const flush = (): void => {
    if (pending) out.push(runHtml(pending));
    pending = null;
  };
  for (const k of kids) {
    if (k.t === 'run') {
      const held = pending as Run | null;
      if (held && sameLook(held, k)) pending = { ...held, text: held.text + k.text };
      else {
        flush();
        pending = k;
      }
      continue;
    }
    flush();
    if (k.t === 'br') out.push(ctx.br);
    else if (k.t === 'note') {
      const label = ctx.note(k.label);
      if (label) out.push(`[^${label}]`);
    }
    else if (k.t === 'image') out.push(`![${escapeText(ctx.alt(k.image))}](${IMAGE_SCHEME}:${k.image})`);
    else {
      const inner = inlines(k.kids, ctx);
      out.push(k.href === '' || inner.trim() === '' ? inner : `[${inner}](${destination(k.href)})`);
    }
  }
  flush();
  return out.join('');
}

/** A paragraph's lines: a line break ends one, and a line never starts with the spaces that would make it code. */
function paraLines(kids: readonly Inline[], ctx: Omit<InlineCtx, 'br'>): string[] {
  const text = inlines(kids, { ...ctx, br: '\\\n' });
  return text
    .split('\n')
    .map((l) => l.replace(/^[  ]+/, ''))
    .filter((l, i, all) => !(l === '\\' && i === all.length - 1));
}

const hasText = (kids: readonly Inline[]): boolean => kids.some((k) => k.t === 'image' || k.t === 'note' || (k.t === 'link' ? hasText(k.kids) : k.t === 'run' && k.text.trim() !== ''));

/**
 * The document as Markdown. With `blocks` set, only that many of its top-level blocks are written (a Word document of
 * 150,000 paragraphs took seconds to render and drew a page too big to scroll), and `cut` says how many were left out.
 */
export function writeMarkdown(doc: Pick<OfficeDoc, 'blocks' | 'notes' | 'images' | 'sources'>, options: { readonly blocks?: number } = {}): OfficeMarkdown {
  const alt = (i: number): string => doc.images[i]?.alt ?? '';
  // A note's label is the writer's own, so nothing a reader handed over is written into the Markdown as it stands.
  const labels = new Map(doc.notes.map((n, i) => [n.label, `n${i + 1}`]));
  const used = new Set<string>();
  const note = (label: string): string | null => {
    const l = labels.get(label) ?? null;
    if (l) used.add(l);
    return l;
  };
  const parts: string[] = [];
  let bytes = 0;
  const asides: { start: number; end: number; who: string; when: string | null }[] = [];
  const slides: { at: number; n: number; title: string; hidden: boolean }[] = [];
  const anchors: { id: string; at: number }[] = [];
  const spans: SourceSpan[] = [];
  const sources = doc.sources;
  /** Records that what was written since `ms` came from the file's bytes `src`. */
  const spanned = (ms: number, src: readonly [number, number] | undefined): void => {
    if (src && bytes > ms) spans.push({ ms, me: parts[parts.length - 1]!.endsWith('\n') ? bytes - 1 : bytes, s: src[0], e: src[1] });
  };
  // Marks waiting for the next block: it starts after the blank line that separates it, so they take its first byte.
  let marks: string[] = [];
  const push = (s: string): void => {
    parts.push(s);
    bytes += utf8Length(s);
  };
  // Two lists side by side would be read as one: each new list takes the other bullet or delimiter.
  let bullet = '-';
  let delim = '.';

  /** Writes `blocks`, the first line led by `first` and every other by `rest`. */
  const write = (blocks: readonly Block[], first: string, rest: string, tight = false): void => {
    let lead = first;
    let wrote = false;
    for (const b of blocks) {
      if (b.t === 'mark') {
        marks.push(b.id);
        continue;
      }
      const lines = blockLines(b, lead, rest);
      if (lines === null) continue;
      if (wrote && !(tight && b.t === 'list')) push(`${rest.trimEnd()}\n`);
      if (marks.length > 0) {
        for (const id of marks) anchors.push({ id, at: bytes });
        marks = [];
      }
      const ms = bytes;
      lines();
      spanned(ms, sources?.get(b));
      wrote = true;
      lead = rest;
    }
    if (!wrote && first.trim() !== '') push(`${first.trimEnd()}\n`);
  };

  const lines = (list: readonly string[], first: string, rest: string): void => {
    list.forEach((l, i) => push(`${i === 0 ? first : rest}${l}\n`));
  };

  /** How to write `b`, or null when it holds nothing to write. */
  const blockLines = (b: Block, first: string, rest: string): (() => void) | null => {
    switch (b.t) {
      case 'heading': {
        const text = inlines(b.kids, { br: ' ', alt, note }).trim();
        if (text === '' && !b.slide) return null;
        return () => {
          if (b.slide) slides.push({ at: bytes + utf8Length(first), n: b.slide.n, title: inlineText(b.kids).trim(), hidden: b.slide.hidden });
          push(`${first}${'#'.repeat(Math.min(6, Math.max(1, b.level)))} ${text === '' ? escapeText(`Slide ${b.slide!.n}`) : text}\n`);
        };
      }
      case 'para':
        if (!hasText(b.kids)) return null;
        return () => lines(paraLines(b.kids, { alt, note }), first, rest);
      case 'code': {
        const longest = maxOf((b.text.match(/`+/g) ?? []).map((m) => m.length), 0);
        const fence = '`'.repeat(Math.max(3, longest + 1));
        return () => lines([fence, ...b.text.replace(/\r\n?/g, '\n').split('\n'), fence], first, rest);
      }
      case 'quote':
        if (b.blocks.length === 0) return null;
        return () => write(b.blocks, `${first}> `, `${rest}> `);
      case 'rule':
        return () => push(`${first}---\n`);
      case 'list': {
        if (b.items.length === 0) return null;
        const mark = b.ordered ? (delim = delim === '.' ? ')' : '.') : (bullet = bullet === '-' ? '*' : '-');
        return () => {
          b.items.forEach((item, k) => {
            // Markdown reads a list's first number of at most nine figures; the file's could be anything.
            const from = Number.isFinite(b.start) ? Math.min(999_999_000, Math.max(0, Math.trunc(b.start))) : 1;
            const marker = b.ordered ? `${from + k}${mark} ` : `${mark} `;
            write(item, `${k === 0 ? first : rest}${marker}`, `${rest}${' '.repeat(marker.length)}`, true);
          });
        };
      }
      case 'table': {
        const cols = maxOf(b.rows.map((r) => r.length), 0);
        if (cols === 0) return null;
        const cell = (c: Inline[] | undefined): string => (c ? inlines(c, { br: '<br>', alt, note }).replace(/\n/g, ' ').trim() : '');
        const row = (r: readonly Inline[][]): string => `| ${Array.from({ length: cols }, (_, i) => cell(r[i]) || ' ').join(' | ')} |`;
        return () =>
          b.rows.forEach((r, i) => {
            const ms = bytes;
            push(`${i === 0 ? first : rest}${row(r)}\n`);
            spanned(ms, sources?.get(r));
            if (i === 0) push(`${rest}|${' --- |'.repeat(cols)}\n`);
          });
      }
      case 'aside':
        if (b.blocks.length === 0) return null;
        return () => {
          const start = bytes;
          write(b.blocks, first, rest);
          asides.push({ start, end: bytes, who: b.who, when: b.when });
        };
      case 'mark':
        return null;
    }
  };

  const most = options.blocks ?? Number.POSITIVE_INFINITY;
  const over = doc.blocks.length > most;
  // What is left out: blocks with something to show (an empty paragraph or a bookmark mark is not counted).
  const left = over ? doc.blocks.slice(most).filter((b) => b.t !== 'mark' && !(b.t === 'para' && !hasText(b.kids))).length : 0;
  write(over ? doc.blocks.slice(0, most) : doc.blocks, '', '');
  // Marks after the last block name the end.
  for (const id of marks) anchors.push({ id, at: bytes });
  marks = [];
  doc.notes.forEach((n, i) => {
    // A cut page keeps only the notes its kept text marks: a definition nothing points to would be an orphan.
    if (over && !used.has(`n${i + 1}`)) return;
    push('\n');
    write(n.blocks, `[^n${i + 1}]: `, '    ');
  });
  spans.sort((a, b) => a.ms - b.ms || b.me - a.me);
  const cut = left > 0 ? [`Only the first ${figure(most)} paragraphs, headings, tables and lists are shown; ${figure(left)} more are left out.`] : [];
  return { markdown: parts.join(''), cut, asides, slides, anchors, spans };
}
