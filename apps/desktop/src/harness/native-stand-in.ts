// The browser build has no native readers. For the demo's fonts, media, Outlook messages and Word 97-2003 files its memory shell answers
// with what the desktop's readers said of those very bytes (native-facts.ts, which `cargo test stand_in` keeps in step),
// found by the file's size and FNV-1a; for any other file it has no facts, and the pages say what they say without them.
import type { FontFacts, GlyphFacts } from '@marxy/core/src/viewer/font.ts';
import type { Envelope, MediaFacts } from '@marxy/core/src/viewer/media.ts';
import type { OutlookFacts, OutlookMail } from '@marxy/core/src/mail/outlook.ts';
import type { LegacyOffice } from '@marxy/core/src/office/legacy.ts';
import { NATIVE_FACTS } from './native-facts.ts';

interface Said {
  readonly font?: FontFacts;
  /** Per face, each mapped character as [code, glyph, advance, contours, points]. */
  readonly glyphs?: readonly (readonly (readonly (number | null)[])[])[];
  readonly media?: MediaFacts;
  readonly envelope?: Envelope | null;
  /** An Outlook message: what the shell says of it, and the message it reads as (text, as it is). */
  readonly mail?: { readonly facts: OutlookFacts; readonly mime: string };
  /** A Word 97-2003 document or deck: the document the shell reads it as. */
  readonly office?: LegacyOffice;
}

/** `size:fnv1a`, as stand_in.rs keys the table. */
export function nativeKey(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length}:${h.toString(16).padStart(8, '0')}`;
}

const keys = new WeakMap<Uint8Array, string>();
const said = (bytes: Uint8Array): Said | null => {
  let k = keys.get(bytes);
  if (k === undefined) keys.set(bytes, (k = nativeKey(bytes)));
  return (NATIVE_FACTS[k] as Said | undefined) ?? null;
};

export const standInFontFacts = (bytes: Uint8Array): FontFacts | null => said(bytes)?.font ?? null;

export function standInGlyph(bytes: Uint8Array, face: number, code: number): GlyphFacts | null {
  const row = said(bytes)?.glyphs?.[face]?.find((g) => g[0] === code);
  if (!row) return null;
  const [, glyph, advance, contours, points] = row;
  return { glyph: glyph ?? 0, name: null, advance: advance ?? null, contours: contours ?? null, components: null, points: points ?? null, bbox: null };
}

export const standInMediaFacts = (bytes: Uint8Array): MediaFacts | null => said(bytes)?.media ?? null;

export const standInEnvelope = (bytes: Uint8Array): Envelope | null => said(bytes)?.envelope ?? null;

export function standInMail(bytes: Uint8Array): OutlookMail | null {
  const mail = said(bytes)?.mail;
  return mail ? { facts: mail.facts, mime: new TextEncoder().encode(mail.mime) } : null;
}

export const standInOffice = (bytes: Uint8Array): LegacyOffice | null => said(bytes)?.office ?? null;
