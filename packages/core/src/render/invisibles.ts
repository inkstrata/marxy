// Display-only markers for invisible and bidirectional characters (handbook ch.7, MARXY-236).

import { escapeAttribute, escapeText } from '../sanitize/escape.ts';

export interface InvisibleContext {
  /** True inside `code`, a fence, or `kbd`. */
  readonly inCode: boolean;
  /** Byte offset in the document where this run starts (for BOM-at-0). */
  readonly sourceStart: number;
}

/** One run of unmarked text, a single flagged point, or a collapsed tag sequence. */
export type InvisibleSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'marker'; readonly cp: number; readonly bidi: boolean }
  | { readonly kind: 'tag-run'; readonly count: number; readonly payload: string; readonly decoded: string };

const BIDI_CONTROLS = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

function isTag(cp: number): boolean {
  return cp >= 0xe0000 && cp <= 0xe007f;
}

function isVariationSelector(cp: number): boolean {
  return cp >= 0xfe00 && cp <= 0xfe0f;
}

function isC0C1Control(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return false;
  return (cp >= 0x00 && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f);
}

const EMOJI_BASE = /\p{Extended_Pictographic}/u;
const ARABIC = /\p{Script=Arabic}/u;

function isEmojiZwJSequence(cps: readonly number[], i: number): boolean {
  if (cps[i] !== 0x200d) return false;
  const prev = i > 0 ? cps[i - 1] : undefined;
  const next = i + 1 < cps.length ? cps[i + 1] : undefined;
  if (prev === undefined || next === undefined) return false;
  return EMOJI_BASE.test(String.fromCodePoint(prev)) && EMOJI_BASE.test(String.fromCodePoint(next));
}

function isPersianZwnj(cps: readonly number[], i: number): boolean {
  if (cps[i] !== 0x200c) return false;
  const prev = i > 0 ? String.fromCodePoint(cps[i - 1]!) : '';
  const next = i + 1 < cps.length ? String.fromCodePoint(cps[i + 1]!) : '';
  return ARABIC.test(prev) && ARABIC.test(next);
}

function isSubdivisionFlagSequence(cps: readonly number[], start: number, end: number): boolean {
  if (cps[start] !== 0x1f3f4) return false;
  if (end - start < 2) return false;
  if (!isTag(cps[end - 1]!)) return false;
  for (let i = start + 1; i < end - 1; i++) if (!isTag(cps[i]!)) return false;
  return true;
}

function decodeTagPayload(payload: string): string {
  return [...payload]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      const plain = cp - 0xe0000;
      return plain >= 0x20 && plain <= 0x7e ? String.fromCodePoint(plain) : '';
    })
    .join('');
}

/** Whether a code point is flagged by the handbook rule table. */
export function shouldFlagInvisible(cp: number, ctx: InvisibleContext, cps: readonly number[], index: number): boolean {
  if (cp === 0x200e || cp === 0x200f || cp === 0x061c) return false;
  if (cp === 0x00a0 && !ctx.inCode) return false;
  if (cp === 0x00ad) return false;
  if (isVariationSelector(cp)) return false;
  if (cp === 0x200d && isEmojiZwJSequence(cps, index)) return false;
  if (cp === 0x200c && isPersianZwnj(cps, index)) return false;
  if (cp === 0xfeff && ctx.sourceStart + index === 0) return false;

  if (isTag(cp)) return true;
  if (BIDI_CONTROLS.has(cp)) return true;
  if (cp === 0x200b || cp === 0x2060) return true;
  if (cp === 0xfeff) return true;
  if (cp === 0x200d) return true;
  if (cp === 0x00a0 && ctx.inCode) return true;
  if (isC0C1Control(cp)) return true;
  return false;
}

/** Hex label drawn in the 1ch hairline box. */
export function invisibleHexLabel(cp: number): string {
  return cp.toString(16).toUpperCase().padStart(4, '0');
}

/** Rule-table segmentation so HTML tests and the app DOM post-pass share one walk. */
export function invisibleSegments(text: string, ctx: InvisibleContext): InvisibleSegment[] {
  const cps = [...text].map((ch) => ch.codePointAt(0)!);
  const parts: InvisibleSegment[] = [];
  let i = 0;
  while (i < cps.length) {
    if (isTag(cps[i]!)) {
      let j = i;
      while (j < cps.length && isTag(cps[j]!)) j++;
      if (isSubdivisionFlagSequence(cps, i, j)) {
        parts.push({ kind: 'text', value: String.fromCodePoint(...cps.slice(i, j)) });
      } else {
        const payload = String.fromCodePoint(...cps.slice(i, j));
        parts.push({ kind: 'tag-run', count: j - i, payload, decoded: decodeTagPayload(payload) });
      }
      i = j;
      continue;
    }
    if (!shouldFlagInvisible(cps[i]!, ctx, cps, i)) {
      let j = i;
      while (j < cps.length && !shouldFlagInvisible(cps[j]!, ctx, cps, j) && !isTag(cps[j]!)) j++;
      parts.push({ kind: 'text', value: String.fromCodePoint(...cps.slice(i, j)) });
      i = j;
      continue;
    }
    parts.push({ kind: 'marker', cp: cps[i]!, bidi: BIDI_CONTROLS.has(cps[i]!) });
    i++;
  }
  return parts;
}

function markerFor(cp: number, bidi: boolean): string {
  const hex = invisibleHexLabel(cp);
  const ch = escapeText(String.fromCodePoint(cp));
  const bidiClass = bidi ? ' marxy-invisible-bidi' : '';
  return (
    `<code class="marxy-invisible">` +
    `<code class="marxy-invisible-glyph" aria-hidden="true">${hex}</code>` +
    `<code class="marxy-invisible-byte${bidiClass}" aria-hidden="true">${ch}</code>` +
    `</code>`
  );
}

function tagRunMarker(count: number, payload: string, decoded: string): string {
  const title = escapeAttribute(decoded.length > 0 ? decoded : 'tag characters');
  const label = escapeText(`tag ×${count}`);
  return (
    `<code class="marxy-invisible marxy-invisible-tag" title="${title}">` +
    `<code class="marxy-invisible-glyph" aria-hidden="true">${label}</code>` +
    `<code class="marxy-invisible-byte" aria-hidden="true">${escapeText(payload)}</code>` +
    `</code>`
  );
}

/** Wrap flagged code points in marker elements; other text is HTML-escaped. */
export function markInvisibles(text: string, ctx: InvisibleContext): string {
  return invisibleSegments(text, ctx)
    .map((seg) => {
      if (seg.kind === 'text') return escapeText(seg.value);
      if (seg.kind === 'tag-run') return tagRunMarker(seg.count, seg.payload, seg.decoded);
      return markerFor(seg.cp, seg.bidi);
    })
    .join('');
}
