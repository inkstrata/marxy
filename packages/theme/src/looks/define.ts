// What the looks that ship share: the classic type set as one value, and `pinned`, which reads a hand-drawn theme's dials
// off its palette (tone from its ground, ink from its text's contrast, accent from its accent's hue), so the Studio shows
// where the theme stands and a dial moves the palette from there.
import { contrastRatio, hexToRgb, rgbToOklch } from '../lang-palettes.ts';
import type { Look, Pins, Tone } from '../look.ts';

/**
 * The default theme's type: Literata for books and notes, Source Serif 4 for articles, Atkinson
 * Hyperlegible Next for reports, changelogs and transcripts, Inter for READMEs and docs; 20 on 30, 66 characters.
 */
export const CLASSIC = {
  face: 'literata',
  faces: { article: 'source', sans: 'hyper', readme: 'inter' },
  sizeFace: 'literata',
  size: 20,
  lead: 1.5,
  measure: 66,
  weight: 400,
  headWeight: 580,
  scale: 1.25,
  para: 'space',
  align: 'left',
} as const satisfies Partial<Look>;

const toneOf = (hex: string): Tone => {
  const [l, c, h] = rgbToOklch(hexToRgb(hex)!);
  return { l: Number(l.toFixed(3)), c: Number(c.toFixed(3)), h: Math.round(h) };
};
const literal = (v: string | undefined): v is string => v !== undefined && v.startsWith('#');
const inkOf = (p: Pins): number | undefined =>
  literal(p.text) && literal(p.bg) ? Math.floor(contrastRatio(hexToRgb(p.text)!, hexToRgb(p.bg)!) * 10) / 10 : undefined;
const hueOf = (v: string | undefined): number | undefined => (literal(v) ? Math.round(rgbToOklch(hexToRgb(v)!)[2]) : undefined);

export type PinnedDef = Omit<Look, 'day' | 'night' | 'ink' | 'inkNight' | 'accent'> & Partial<Pick<Look, 'day' | 'night' | 'ink' | 'inkNight' | 'accent'>>;

/** A look whose colours are drawn by hand: its dials are read off the palette unless the definition says them. */
export function pinned(def: PinnedDef): Look {
  const d = def.pins?.day ?? def.pins?.night;
  const n = def.pins?.night ?? def.pins?.day;
  if (!literal(d?.bg) || !literal(n?.bg)) throw new Error(`look ${def.id}: a pinned look names its ground as #rrggbb`);
  return {
    ...def,
    day: def.day ?? toneOf(d.bg!),
    night: def.night ?? toneOf(n.bg!),
    ink: def.ink ?? inkOf(d!) ?? 12,
    inkNight: def.inkNight ?? inkOf(n!) ?? 11,
    accent: def.accent ?? hueOf(d!.accent) ?? hueOf(n!.accent) ?? 258,
  };
}

/** The code roles most themes leave in the code's own ink, and the ones that follow another role. */
export const CODE_REFS = {
  variable: '@codeText',
  punctuation: '@codeText',
  property: '@codeText',
  link: '@link',
  mark: '@marker',
} as const;
