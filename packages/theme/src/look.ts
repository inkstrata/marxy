// The look engine. A look is about twenty numbers, not a stylesheet: day
// and night tone, ink as a target contrast, an accent hue, how much colour in code, and the type. `resolve` turns a look
// and a pane's context into every `--marxy-*` token value that pane is painted with, and every colour is solved to its
// floor against the grounds it sits on (the rows gate-contrast holds), so no setting can make a page illegible. Pure: no
// DOM, so the gate, the tests and the app share it. Colour arithmetic is lang-palettes.ts's, the one OKLCH path.
//
// A theme is a look too: one whose colours are drawn by hand (`pins`, per scheme). A pin is used as drawn while it holds
// its floor on the grounds it sits on, else its lightness walks until it does. The dials move a pinned palette rather than
// dropping it: the tone shifts every pinned ground together, the ink re-solves the text's lightness, the accent turns the
// accent's family, colour in code scales the tokens' chroma, each measured from the look's own dials.
import {
  LANG_PALETTES,
  PALETTE_ROLES,
  contrastRatio,
  fitHex,
  hexToRgb,
  oklchToRgb,
  rgbToHex,
  rgbToOklch,
  solveNearest,
  type Floor,
  type PaletteRole,
  type Rgb,
  type SyntaxRole,
} from './lang-palettes.ts';
import { BUILT_IN_RULES, FACES, LOOKS, type FaceId, type LookGroup } from './looks.ts';

export interface Tone {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

export type Scheme = 'day' | 'night';
export type Mode = 'system' | 'clock' | 'day' | 'night';
export type Subject = 'prose' | 'mono' | 'data';
/** The prose kinds that take a face of their own when a look names faces by role (the default theme's kind profiles). */
export type FaceRole = 'article' | 'sans' | 'readme';

/**
 * Colours a theme draws by hand for one scheme, as `#rrggbb`, `rgba()` (laid over the page) or `@role` (another pinned
 * role, or a code role inside `tok`). Grounds are used as drawn; every colour drawn on them is held to its floor.
 */
export interface Pins {
  readonly bg?: string;
  readonly surface?: string;
  readonly codeBg?: string;
  readonly glass?: string;
  readonly text?: string;
  readonly strong?: string;
  readonly second?: string;
  readonly faint?: string;
  readonly accent?: string;
  readonly accentStrong?: string;
  readonly accentFg?: string;
  readonly link?: string;
  readonly wash?: string;
  readonly rule?: string;
  readonly ruleStrong?: string;
  readonly quoteRule?: string;
  readonly edge?: string;
  readonly selection?: string;
  readonly find?: string;
  readonly findCurrent?: string;
  readonly findEdge?: string;
  readonly ok?: string;
  readonly warn?: string;
  readonly err?: string;
  readonly info?: string;
  readonly okWash?: string;
  readonly warnWash?: string;
  readonly errWash?: string;
  readonly diffAdd?: string;
  readonly diffDel?: string;
  readonly diffAddWord?: string;
  readonly diffDelWord?: string;
  readonly codeText?: string;
  readonly shadow?: string;
  /** Code roles: a hex, or `@role` for another code role (`@codeText`, `@link` and `@marker` too). */
  readonly tok?: Readonly<Partial<Record<SyntaxRole, string>>>;
  /** Type weights for this scheme, where the theme sets them by hand. */
  readonly weight?: number;
  readonly headWeight?: number;
  readonly strongWeight?: number;
  /** Tokens set as written, beyond the colour roles (a frame mix, a face for the chrome): carried to the theme's sheet. */
  readonly extra?: Readonly<Record<string, string>>;
}

export interface Look {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly day: Tone;
  readonly night: Tone;
  /** Contrast of text on the page, by day and by night; never under 7. */
  readonly ink: number;
  readonly inkNight: number;
  /** Hue of links and marks, degrees. */
  readonly accent: number;
  /** Colour in code: 0 is ink only, 1 vivid. */
  readonly code: number;
  /** Each language in its own palette; false puts every language on the shared hues. */
  readonly perLanguage?: boolean;
  /** Hues of the reader's own for a language's roles. */
  readonly langs?: Readonly<Record<string, Readonly<Partial<Record<PaletteRole, number>>>>>;
  readonly face: FaceId;
  readonly size: number;
  readonly lead: number;
  /** Average characters a line, measured from the face, not `ch`. */
  readonly measure: number;
  readonly weight: number;
  readonly headWeight: number;
  readonly scale: number;
  readonly headFace?: FaceId;
  readonly headStyle?: 'normal' | 'italic';
  readonly caps?: boolean;
  readonly para: 'space' | 'indent';
  readonly align: 'left' | 'justify';
  readonly figures?: 'lining' | 'old';
  /** The ink's own hue and chroma, where it is not the ground's (Console's phosphor). */
  readonly tint?: { readonly h: number; readonly c: number };
  /** A look of the reader's own. */
  readonly mine?: boolean;
  /** The shelf it stands on in the Studio. */
  readonly group?: LookGroup;
  /** Whose colours these are, when they are someone else's, and under what licence. */
  readonly credit?: string;
  /** Drawn for one scheme only: the other shows it too (Fjord is dark whatever the hour). */
  readonly only?: Scheme;
  /** Colours drawn by hand, per scheme; each held to its floor, and moved by the dials (see the head of this file). */
  readonly pins?: Readonly<Partial<Record<Scheme, Pins>>>;
  /** A face for a kind of prose other than the look's own: articles, reports and transcripts, READMEs and docs. */
  readonly faces?: Readonly<Partial<Record<FaceRole, FaceId>>>;
  /** The face the size is measured against: a face set in its place keeps the apparent size. The clearest sans when unsaid. */
  readonly sizeFace?: FaceId;
  /** Letter-spacing of headings, em (negative draws them tighter). */
  readonly headTracking?: number;
  /** The bundled theme folder config.toml can name for the same colours (packages/theme/<theme>/theme.css). */
  readonly theme?: string;
  /** The name of its page for the other scheme, where it has one of its own (Night's is Paper): Settings says both. */
  readonly partner?: string;
}

export type LookTweaks = { -readonly [K in Exclude<keyof Look, 'id' | 'name' | 'blurb' | 'mine' | 'group' | 'credit' | 'theme' | 'only' | 'partner'>]?: Look[K] };

/** The scheme a look is shown and chosen in on the shelf: its own appearance, or the one it is drawn for. */
export const shownScheme = (look: Look): Scheme => look.only ?? (look.group === 'light' ? 'day' : 'night');

export interface When {
  /** A folder: `reading/` matches any path with a `reading` folder in it; an absolute path matches that folder and everything under it. */
  readonly path?: string;
  readonly kinds?: readonly string[];
  readonly scheme?: Scheme;
  readonly maxWidth?: number;
  readonly minWidth?: number;
}

export interface Rule {
  readonly id: string;
  readonly on: boolean;
  readonly label: string;
  readonly hint?: string;
  /** The reader's own rule (it can be removed). */
  readonly user?: boolean;
  readonly when?: When;
  readonly set?: { readonly look?: string } & LookTweaks;
}

export interface LookState {
  /** The look in use. */
  readonly id: string;
  readonly mode: Mode;
  readonly lean: boolean;
  /** The reader's changes to each look, by id. */
  readonly tweaks: Readonly<Record<string, LookTweaks>>;
  /** Looks of the reader's own. */
  readonly mine: readonly Look[];
  /** Each rule's switch, by id, where it differs from the rule's own. */
  readonly rules: Readonly<Record<string, boolean>>;
  /** Rules of the reader's own, after the built-in ones. */
  readonly userRules: readonly Rule[];
}

export interface LookContext {
  /** The kind the pane's document was read as (core's KINDS). */
  readonly kind?: string | null;
  readonly path?: string | null;
  /** The pane's width in px: the narrow and wide rules read it. */
  readonly width?: number;
  /** The scheme to paint in, when the caller has decided it; else the state's mode with `systemDark` and `hour`. */
  readonly scheme?: Scheme;
  readonly systemDark?: boolean;
  readonly hour?: number;
  /** Increase contrast: secondary and faint text become the ink, rules the edge (base.css's "more" rule, held by the look). */
  readonly more?: boolean;
  /** Faces measured on this machine: average advance and x-height in em; the table below stands in for any not given. */
  readonly metrics?: Readonly<Record<string, { readonly avg: number; readonly xh: number }>>;
}

export interface Over {
  readonly id?: string;
  readonly tweaks?: LookTweaks;
  readonly scheme?: Scheme;
  readonly noRules?: boolean;
}

export interface Why {
  readonly text: string;
  /** The rule that caused it, whose switch can be shown beside it. */
  readonly rule?: string;
  readonly head?: boolean;
}

export interface Facts {
  readonly size: number;
  readonly line: number;
  /** The column in px, or 0 where the kind sets no measure. */
  readonly measure: number;
  readonly chars: number | null;
  readonly weight: number;
  readonly face: string;
  readonly contrast: number;
  readonly faint: number;
  readonly target: number;
  /** The ink could not reach the look's target on this tone (it still holds 7 : 1). */
  readonly held: boolean;
}

export interface Resolved {
  readonly tokens: Readonly<Record<string, string>>;
  readonly why: readonly Why[];
  readonly look: Look;
  readonly scheme: Scheme;
  readonly subject: Subject;
  readonly tight: boolean;
  readonly facts: Facts;
  /** The page's colours by name, for a drawing that wants them (the shelf, the tone pad). */
  readonly colours: Readonly<Record<string, string>>;
  /** Pinned colours that had to move to hold their floor, with where they were drawn and where they are. */
  readonly moved: readonly PinMove[];
}

export interface PinMove {
  /** The token it paints. */
  readonly token: string;
  readonly drawn: string;
  readonly now: string;
}

export const FLOOR = 7;
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

// ---- tone -----------------------------------------------------------------------------------------------------------

const rgbOf = (t: Tone): Rgb => hexToRgb(fitHex(t.l, t.c, t.h))!;
export const toneHex = (t: Tone): string => fitHex(t.l, t.c, t.h);
export const ratio = (a: Rgb, b: Rgb): number => contrastRatio(a, b);
/** The most contrast any ink can have on this tone: black's or white's. */
export const maxContrast = (t: Tone): number => Math.max(ratio(rgbOf(t), WHITE), ratio(rgbOf(t), BLACK));
export const legible = (t: Tone): boolean => maxContrast(t) >= FLOOR;

/** Pushes a tone out of the band of greys where neither black nor white ink holds 7 : 1, by the least lightness. */
export function nearestLegible(t: Tone): Tone {
  if (legible(t)) return t;
  for (let d = 0.005; d < 0.6; d += 0.005) {
    const up = { ...t, l: t.l + d };
    const dn = { ...t, l: t.l - d };
    if (up.l <= 1 && legible(up)) return up;
    if (dn.l >= 0 && legible(dn)) return dn;
  }
  return t;
}

const cmax = (l: number): number => (l > 0.5 ? 0.052 : 0.034);
/** The tone pad: x is warmth (cool to warm), y lightness (white at the top). */
export function toneFromPad(x: number, y: number): Tone {
  const w = clamp(x, 0, 1) * 2 - 1;
  const l = 1 - clamp(y, 0, 1);
  return { l, c: Math.abs(w) * cmax(l), h: w < 0 ? 250 : 82 };
}
export function padFromTone(t: Tone): { readonly x: number; readonly y: number } {
  const cool = t.h > 150 && t.h < 330;
  const w = clamp(t.c / cmax(t.l), 0, 1) * (cool ? -1 : 1);
  return { x: (w + 1) / 2, y: 1 - t.l };
}

const toTone = (rgb: Rgb): Tone => {
  const [l, c, h] = rgbToOklch(rgb);
  return { l, c, h };
};
const shift = (t: Tone, d: number): Tone => ({ ...t, l: clamp(t.l + d, 0, 1) });
/** `a` and `b` mixed `t` of the way in OKLab. */
function mixLab(a: Rgb, b: Rgb, t: number): Rgb {
  const [la, ca, ha] = rgbToOklch(a);
  const [lb, cb, hb] = rgbToOklch(b);
  const A = [la, ca * Math.cos((ha * Math.PI) / 180), ca * Math.sin((ha * Math.PI) / 180)];
  const B = [lb, cb * Math.cos((hb * Math.PI) / 180), cb * Math.sin((hb * Math.PI) / 180)];
  const m = A.map((v, i) => v + (B[i]! - v) * t);
  return hexToRgb(fitHex(m[0]!, Math.hypot(m[1]!, m[2]!), ((Math.atan2(m[2]!, m[1]!) * 180) / Math.PI + 360) % 360))!;
}
/** `top` at `alpha` over `under`, in sRGB as the page composites it (gate-contrast's `line@code-bg`). */
const overRgb = (top: Rgb, alpha: number, under: Rgb): Rgb => hexToRgb(rgbToHex([0, 1, 2].map((i) => top[i]! * alpha + under[i]! * (1 - alpha)) as unknown as Rgb))!;
const hex = (c: Rgb): string => rgbToHex(c);

// ---- palette ----------------------------------------------------------------------------------------------------------

/** The shared hues of code, by role (HUES), moved a quarter of the way with the accent. */
const SHARED: Readonly<Record<string, number>> = { k: 275, s: 68, n: 38, f: 218, t: 172, a: 322, b: 18, v: 250 };

interface Palette {
  readonly tokens: Record<string, string>;
  readonly colours: Record<string, string>;
  readonly target: number;
  readonly got: number;
  readonly faintGot: number;
  readonly dark: boolean;
  /** Tokens a pin set as drawn (rgba and all), for a theme's sheet to write as the theme drew them. */
  readonly drawn: Record<string, string>;
  readonly moved: PinMove[];
  /** Weights the scheme's pins set by hand. */
  readonly weights: { readonly body?: number; readonly heading?: number; readonly strong?: number };
}

const solved = new Map<string, Palette>();

/**
 * Every colour of the page for `look` in `scheme`, each solved against the grounds it is drawn on. `own` is the look as it
 * ships (its dials as its pins were drawn); without it the look is its own measure, and pins stand as drawn.
 */
export function palette(look: Look, scheme: Scheme, opts: { readonly more?: boolean; readonly own?: Look } = {}): Palette {
  const own = opts.own ?? look;
  // A drag repaints every miniature each frame; most of them have not changed.
  const dials = (l: Look): unknown[] => [l.day, l.night, l.ink, l.inkNight, l.accent, l.code];
  const key = JSON.stringify([...dials(look), look.perLanguage, look.langs, look.tint, look.only, look.pins ?? null, look.pins ? dials(own) : 0, scheme, opts.more === true]);
  const hit = solved.get(key);
  if (hit) return hit;
  const made = solvePalette(look, scheme, opts.more === true, own);
  if (solved.size > 160) solved.delete(solved.keys().next().value!);
  solved.set(key, made);
  return made;
}

type Lab = readonly [number, number, number];
const labOf = (c: Rgb): Lab => {
  const [l, ch, h] = rgbToOklch(c);
  return [l, ch * Math.cos((h * Math.PI) / 180), ch * Math.sin((h * Math.PI) / 180)];
};
const toneLab = (t: Tone): Lab => [t.l, t.c * Math.cos((t.h * Math.PI) / 180), t.c * Math.sin((t.h * Math.PI) / 180)];
const fromLab = (v: Lab): Rgb => hexToRgb(fitHex(v[0], Math.hypot(v[1], v[2]), ((Math.atan2(v[2], v[1]) * 180) / Math.PI + 360) % 360))!;
const RGBA = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i;

/** A pin's colour, an `rgba()` laid over `under` as the page lays it; null for a reference or anything unreadable. */
function pinRgb(v: string | undefined, under: Rgb): Rgb | null {
  if (!v || v.startsWith('@')) return null;
  const m = RGBA.exec(v.trim());
  if (m) return overRgb([Number(m[1]), Number(m[2]), Number(m[3])], Number(m[4]), under);
  return hexToRgb(v);
}

function solvePalette(look: Look, scheme: Scheme, more: boolean, own: Look): Palette {
  const s: Scheme = look.only ?? scheme;
  const P = look.pins?.[s];
  const drawn: Record<string, string> = {};
  const moved: PinMove[] = [];
  const tone = nearestLegible(s === 'night' ? look.night : look.day);
  // The dials' distance from the look's own: how far the pins are carried.
  const ownTone = s === 'night' ? own.night : own.day;
  const dGround: Lab = P ? (toneLab(tone).map((v, i) => v - toneLab(ownTone)[i]!) as unknown as Lab) : [0, 0, 0];
  const still = Math.abs(dGround[0]) + Math.abs(dGround[1]) + Math.abs(dGround[2]) < 1e-9;
  const target = Math.max(FLOOR, s === 'night' ? look.inkNight || look.ink : look.ink);
  const ownTarget = Math.max(FLOOR, s === 'night' ? own.inkNight || own.ink : own.ink);
  const inkMoved = Math.abs(target - ownTarget) >= 0.05;
  const turn = (((look.accent - own.accent) % 360) + 540) % 360 - 180;
  const chromaBy = own.code > 0 ? clamp(look.code / own.code, 0, 2.5) : 1;

  /** A pinned ground carried by the tone: moved in OKLab as far as the tone was. */
  const ground = (v: string | undefined, under: Rgb): Rgb | null => {
    const c = pinRgb(v, under);
    if (!c) return null;
    return still ? c : fromLab(labOf(c).map((x, i) => x + dGround[i]!) as unknown as Lab);
  };
  const turned = (c: Rgb): Rgb => {
    if (turn === 0) return c;
    const [l, ch, h] = rgbToOklch(c);
    return hexToRgb(fitHex(l, ch, (h + turn + 360) % 360))!;
  };

  // The page is the pin while the tone is the theme's own; moved, it is the tone itself, which is kept out of the dead band.
  const bg = (P?.bg && still && pinRgb(P.bg, BLACK)) || rgbOf(tone);
  if (P?.bg && still) drawn['--marxy-color-bg'] = P.bg;
  const bgT = toTone(bg);
  const dark = ratio(bg, WHITE) > ratio(bg, BLACK);
  const ih = look.tint ? look.tint.h : tone.h;
  const ic = look.tint ? look.tint.c : Math.min(tone.c * 0.7 + 0.004, 0.03);
  const d = dark ? 1 : -1;
  const end = dark ? WHITE : BLACK;
  const at = (h: number, c: number, floors: readonly Floor[]): Rgb => hexToRgb(solveNearest(h, c, floors, dark).hex)!;
  /** `c` while it holds every floor, else its lightness walked away from the grounds until it does. */
  const guard = (c: Rgb, floors: readonly Floor[]): Rgb => {
    const passes = (x: Rgb): boolean => floors.every(([g, f]) => ratio(x, g) >= f);
    if (passes(c)) return c;
    const [L, C, h] = rgbToOklch(c);
    for (let k = 1; k <= 400; k += 1) {
      const l = L + d * k * 0.0025;
      if (l > 1 || l < 0) break;
      const x = hexToRgb(fitHex(l, C, h))!;
      if (passes(x)) return x;
    }
    return end;
  };
  /** A pinned colour as drawn while it holds every floor, else walked until it does (`guard`), and said so. */
  const hold = (token: string, pin: string, c: Rgb, floors: readonly Floor[]): Rgb => {
    const out = guard(c, floors);
    // Recorded as drawn only when nothing moved it: not the dials, not its floor.
    const asDrawn = pinRgb(pin, bg);
    if (hex(out) !== hex(c)) moved.push({ token, drawn: hex(c), now: hex(out) });
    else if (asDrawn && hex(asDrawn) === hex(c)) drawn[token] = pin;
    return out;
  };

  // The surface steps toward the ink only as far as leaves the ink 7 : 1 on it (more contrast asks that of it).
  let surface = rgbOf(shift(bgT, d * (dark ? 0.036 : 0.026)));
  for (let k = dark ? 0.036 : 0.026; ratio(end, surface) < 7.05 && k > 0.001; k *= 0.6) surface = rgbOf(shift(bgT, d * k));
  if (ratio(end, surface) < 7.05) surface = bg;
  const pinnedGround = (token: string, v: string | undefined, fallback: Rgb, under: Rgb = bg): Rgb => {
    const c = ground(v, under);
    if (!c) return fallback;
    // A ground the tone carried into the band where no ink holds 7 : 1 on it gives way to the one worked out from the page.
    if (!still && ratio(end, c) < 7.05) return fallback;
    if (still && v && !v.startsWith('@')) drawn[token] = v;
    return c;
  };
  surface = pinnedGround('--marxy-color-surface', P?.surface, surface);
  const codeBg = pinnedGround('--marxy-color-code-bg', P?.codeBg, surface);
  const hair = pinnedGround('--marxy-color-rule', P?.rule, rgbOf(shift(bgT, d * 0.072)));
  const hair2 = pinnedGround('--marxy-color-rule-strong', P?.ruleStrong, rgbOf(shift(bgT, d * 0.13)));
  const quote = pinnedGround('--marxy-color-quote-rule', P?.quoteRule, hair2);

  // The marks' own hues first, then the washes mixed from them: the grounds every text colour is solved against.
  const accentPin = pinRgb(P?.accent, bg);
  const accent0 = accentPin ? turned(accentPin) : at(look.accent, 0.15, [[bg, 5.4], [surface, 4.8]]);
  const amber = hexToRgb(fitHex(dark ? 0.62 : 0.88, 0.14, 92))!;
  const ok0 = pinRgb(P?.ok, bg) ?? at(155, 0.12, [[surface, 4.8], [bg, 4.8]]);
  const warn0 = pinRgb(P?.warn, bg) ?? at(72, 0.13, [[surface, 4.8], [bg, 4.8]]);
  const err0 = pinRgb(P?.err, bg) ?? at(28, 0.17, [[surface, 4.8], [bg, 4.8]]);
  // A wash is mixed only so far toward its colour as leaves the ink room to hold its floor on it: a ground near the dead
  // band has little room, and the wash gives way rather than the text. A pinned wash gives way the same way.
  const inkRef = pinRgb(P?.text, bg) ?? end;
  const washOf = (col: Rgb, t: number): Rgb => {
    let w = mixLab(bg, col, t);
    for (let k = t; ratio(end, w) < 5.6 && k > 0.01; k *= 0.7) w = mixLab(bg, col, k);
    return w;
  };
  const pinnedWash = (token: string, v: string | undefined, fallback: () => Rgb, opts: { readonly turn?: boolean; readonly under?: Rgb } = {}): Rgb => {
    const raw = ground(v, opts.under ?? bg);
    if (!raw) return fallback();
    const c = opts.turn ? turned(raw) : raw;
    const ref = ratio(inkRef, bg) >= 4.5 ? inkRef : end;
    let w = c;
    for (let k = 0.85; ratio(ref, w) < 4.8 && k > 0.05; k *= 0.85) w = mixLab(bg, c, k);
    if (still && hex(w) === hex(c) && hex(c) === hex(raw) && v && !v.startsWith('@')) drawn[token] = v;
    return w;
  };
  // On a dark ground a wash lifts the lightness the quiet text has to clear, so night mixes less of each: bright washes
  // left secondary and faint text no room below 10 : 1, and the ladder flat.
  const wash = pinnedWash('--marxy-color-accent-wash', P?.wash, () => washOf(accent0, 0.11), { turn: true });
  const sel = pinnedWash('--marxy-color-selection', P?.selection, () => washOf(accent0, dark ? 0.17 : 0.27), { turn: true });
  const find = pinnedWash('--marxy-color-find', P?.find, () => washOf(amber, dark ? 0.17 : 0.6));
  const findCur = pinnedWash('--marxy-color-find-current', P?.findCurrent, () => washOf(amber, dark ? 0.25 : 1));
  const okW = pinnedWash('--marxy-color-status-ok-wash', P?.okWash, () => washOf(ok0, dark ? 0.1 : 0.12));
  const warnW = pinnedWash('--marxy-color-status-warn-wash', P?.warnWash, () => washOf(warn0, dark ? 0.1 : 0.12));
  const errW = pinnedWash('--marxy-color-status-err-wash', P?.errWash, () => washOf(err0, dark ? 0.1 : 0.12));
  const addW = pinnedWash('--marxy-color-diff-add', P?.diffAdd, () => washOf(ok0, dark ? 0.13 : 0.17), { under: codeBg });
  const delW = pinnedWash('--marxy-color-diff-del', P?.diffDel, () => washOf(err0, dark ? 0.12 : 0.15), { under: codeBg });
  const addWord = pinnedWash('--marxy-color-diff-add-word', P?.diffAddWord, () => washOf(ok0, dark ? 0.22 : 0.3), { under: codeBg });
  const delWord = pinnedWash('--marxy-color-diff-del-word', P?.diffDelWord, () => washOf(err0, dark ? 0.2 : 0.28), { under: codeBg });
  const line = overRgb(sel, 0.6, codeBg);
  const diffs = [addW, delW, addWord, delWord];
  const apart = (g: Rgb): Rgb[] => (hex(g) === hex(surface) ? [] : [g]);
  const textGrounds = [surface, ...apart(codeBg), sel, find, findCur, wash, okW, warnW, errW, ...diffs];
  const codeGrounds = [codeBg, bg, sel, line, ...diffs];
  const all = (grounds: readonly Rgb[], floor: number): Floor[] => grounds.map((g) => [g, floor]);

  // Text: a pin holds the gate's floors as drawn; with the ink dial moved, its lightness is solved to the new target, and
  // the quieter roles keep the proportion the theme drew them at.
  const bgPin = pinRgb(P?.bg, BLACK) ?? bg;
  const textRole = (token: string, pin: string | undefined, floors: (onBg: number) => Floor[], derived: () => Rgb, drawnFloor: number): Rgb => {
    const c = pinRgb(pin, bg);
    if (!c) return derived();
    if (!inkMoved) return hold(token, pin!, c, floors(drawnFloor));
    const [, C, h] = rgbToOklch(c);
    const want = clamp(ratio(c, bgPin) * (target / ownTarget), drawnFloor, 21);
    return at(h, C, floors(want));
  };
  // More contrast puts the quiet roles at the ink, which then holds 7 : 1 wherever they rest: the page, a surface, code.
  const textFloors = (onBg: number): Floor[] => [[bg, onBg], ...all(textGrounds, 4.5), ...(more ? all([surface, ...apart(codeBg)], 7) : [])];
  const ink = textRole('--marxy-color-text', P?.text, textFloors, () => at(ih, ic, textFloors(target)), FLOOR);
  const strong = textRole('--marxy-color-text-strong', P?.strong, (b) => [[bg, b], ...all(textGrounds, 4.5)], () => at(ih, ic, [[bg, Math.max(FLOOR, Math.min(21, target * 1.45))], ...all(textGrounds, 4.5)]), FLOOR);
  const restOf = [surface, ...apart(codeBg), wash, sel, find, findCur];
  const quiet = (token: string, pin: string | undefined, share: number, least: number): Rgb =>
    more ? ink : textRole(token, pin, (b) => [[bg, b], ...all(restOf, 4.5)], () => at(ih, ic, [[bg, Math.max(least, target * share)], ...all(restOf, 4.5)]), 4.5);
  const second = quiet('--marxy-color-text-secondary', P?.second, 0.58, 5.6);
  const faint = quiet('--marxy-color-text-faint', P?.faint, 0.42, 4.6);
  const accentFloors: Floor[] = [[bg, 4.5], ...all([surface, wash], 4.5)];
  const accent = accentPin ? hold('--marxy-color-accent', P!.accent!, turned(accentPin), accentFloors) : at(look.accent, 0.15, [[bg, 5.4], ...all([surface, wash], 4.6)]);
  const strongPin = pinRgb(P?.accentStrong, bg);
  const accentStrong = strongPin ? hold('--marxy-color-accent-strong', P!.accentStrong!, turned(strongPin), accentFloors) : at(look.accent, 0.15, [[bg, 7.5], ...all([surface, wash], 4.6)]);
  // Text on an accent fill: the pin while it holds on both accents; else the page, black or white, whichever holds best
  // (an accent the dials turned light wants dark text on it, whatever the theme drew).
  const fgPin = pinRgb(P?.accentFg, bg);
  const onAccents = (x: Rgb): number => Math.min(ratio(x, accent), ratio(x, accentStrong));
  const derivedFg = ratio(bg, accent) >= 4.5 && ratio(bg, accentStrong) >= 4.5 ? bg : dark ? BLACK : WHITE;
  let accentFg = derivedFg;
  if (fgPin && onAccents(fgPin) >= 4.5) {
    accentFg = fgPin;
    if (still && turn === 0) drawn['--marxy-color-accent-fg'] = P!.accentFg!;
  } else if (fgPin) {
    accentFg = [bg, BLACK, WHITE].reduce((a, b) => (onAccents(b) > onAccents(a) ? b : a));
    moved.push({ token: '--marxy-color-accent-fg', drawn: hex(fgPin), now: hex(accentFg) });
  }
  const status = (token: string, pin: string | undefined, c0: Rgb, h: number, c: number, w: Rgb): Rgb =>
    pinRgb(pin, bg) ? hold(token, pin!, c0, all([bg, surface, w], 4.5)) : at(h, c, all([bg, surface, w], 4.8));
  const ok = status('--marxy-color-status-ok', P?.ok, ok0, 155, 0.12, okW);
  const warn = status('--marxy-color-status-warn', P?.warn, warn0, 72, 0.13, warnW);
  const err = status('--marxy-color-status-err', P?.err, err0, 28, 0.17, errW);
  const edgePin = pinRgb(P?.edge, bg);
  const edge = edgePin ? hold('--marxy-color-edge', P!.edge!, edgePin, all([bg, surface, codeBg], 3)) : at(ih, ic * 0.6, all([bg, surface], 3.1));
  const findEdgePin = pinRgb(P?.findEdge, bg);
  const findEdge = findEdgePin ? hold('--marxy-color-find-edge', P!.findEdge!, findEdgePin, all([bg, surface, codeBg], 3)) : at(80, 0.14, all([bg, surface], 3.2));
  const linkPin = pinRgb(P?.link, bg);
  const link = linkPin ? hold('--marxy-color-link', P!.link!, turned(linkPin), accentFloors) : accent;
  const infoPin = pinRgb(P?.info, bg);
  const info = infoPin ? hold('--marxy-color-status-info', P!.info!, infoPin, all([bg, surface], 4.5)) : accent;

  // Code.
  const cc = clamp(look.code, 0, 1) * 0.15;
  const codeOn = cc >= 0.012;
  const tok = (k: string, fallback: Rgb, floor = 4.9): Rgb =>
    codeOn ? at((SHARED[k]! + (look.accent - 258) * 0.25 + 360) % 360, k === 'v' ? cc * 0.35 : cc, all(codeGrounds, k === 'v' ? 6.5 : floor)) : fallback;
  const neutral = (floor: number): Rgb => at(ih, ic, all(codeGrounds, floor));
  const codeTextPin = pinRgb(P?.codeText, codeBg);
  const codeInk = codeTextPin
    ? inkMoved
      ? at(rgbToOklch(codeTextPin)[2], rgbToOklch(codeTextPin)[1], [[codeBg, Math.max(FLOOR, target * 0.9)], ...all(codeGrounds, 4.5)])
      : hold('--marxy-color-code-text', P!.codeText!, codeTextPin, all(codeGrounds, 4.5))
    : at(ih, ic, [[surface, Math.max(FLOOR, target * 0.9)], ...all(codeGrounds, 4.5)]);
  const codeStrong = neutral(Math.min(12, Math.max(FLOOR, target)));
  const codeSecond = neutral(5.2);
  const comment = at(ih, ic, all(codeGrounds, 4.7));
  const t = {
    keyword: tok('k', codeStrong),
    string: tok('s', codeSecond),
    number: tok('n', codeInk),
    constant: tok('b', codeInk),
    function: tok('f', codeStrong),
    type: tok('t', codeInk),
    attribute: tok('a', codeSecond),
    variable: tok('v', codeInk),
  };
  const linkTok = at(look.accent, 0.15, all(codeGrounds, 4.6));

  const c: Record<string, Rgb> = {
    '--marxy-color-bg': bg,
    '--marxy-color-text': ink,
    '--marxy-color-text-strong': strong,
    '--marxy-color-text-secondary': second,
    '--marxy-color-text-faint': faint,
    '--marxy-color-accent': accent,
    '--marxy-color-link': link,
    '--marxy-color-accent-strong': accentStrong,
    '--marxy-color-accent-fg': accentFg,
    '--marxy-color-accent-wash': wash,
    '--marxy-color-rule': more ? edge : hair,
    '--marxy-color-rule-strong': more ? edge : hair2,
    '--marxy-color-edge': edge,
    '--marxy-color-divider': more ? edge : hair,
    '--marxy-color-divider-focus': accent,
    '--marxy-color-quote-rule': more ? edge : quote,
    '--marxy-color-surface': surface,
    '--marxy-color-surface-glass': surface,
    '--marxy-color-notice': surface,
    '--marxy-color-code-bg': codeBg,
    '--marxy-color-code-text': codeInk,
    '--marxy-color-selection': sel,
    '--marxy-color-find': find,
    '--marxy-color-find-current': findCur,
    '--marxy-color-find-edge': findEdge,
    '--marxy-color-status-ok': ok,
    '--marxy-color-status-warn': warn,
    '--marxy-color-status-err': err,
    '--marxy-color-status-info': info,
    '--marxy-color-status-ok-wash': okW,
    '--marxy-color-status-warn-wash': warnW,
    '--marxy-color-status-err-wash': errW,
    '--marxy-color-diff-add': addW,
    '--marxy-color-diff-del': delW,
    '--marxy-color-diff-add-word': addWord,
    '--marxy-color-diff-del-word': delWord,
  };
  const toks: Record<string, Rgb> = {
    '--marxy-tok-keyword': t.keyword,
    '--marxy-tok-string': t.string,
    '--marxy-tok-comment': comment,
    '--marxy-tok-number': t.number,
    '--marxy-tok-constant': t.constant,
    '--marxy-tok-function': t.function,
    '--marxy-tok-type': t.type,
    '--marxy-tok-variable': t.variable,
    '--marxy-tok-operator': codeSecond,
    '--marxy-tok-punctuation': codeSecond,
    '--marxy-tok-tag': t.function,
    '--marxy-tok-attribute': t.attribute,
    '--marxy-tok-builtin': t.type,
    '--marxy-tok-property': t.variable,
    '--marxy-tok-decorator': t.attribute,
    '--marxy-tok-self': t.keyword,
    '--marxy-tok-escape': t.string,
    '--marxy-tok-marker': codeSecond,
    '--marxy-tok-heading': codeStrong,
    '--marxy-tok-link': linkTok,
    '--marxy-tok-mark': codeSecond,
  };
  if (P?.tok) {
    // Pinned code roles: chroma scaled by the dial, each held on every ground code sits on. References are followed after,
    // so `@codeText`, `@link`, `@marker` and one role naming another all land on what the other became.
    const named: Record<string, Rgb> = { codeText: codeInk, link: c['--marxy-color-link']!, text: ink, second, faint, accent };
    const codeFloor = 4.5;
    for (const [role, v] of Object.entries(P.tok)) {
      const pin = pinRgb(v, codeBg);
      if (!pin) continue;
      let col = pin;
      if (!codeOn) col = codeInk;
      else if (chromaBy !== 1) {
        const [l, ch, h] = rgbToOklch(pin);
        col = hexToRgb(fitHex(l, ch * chromaBy, h))!;
      }
      toks[`--marxy-tok-${role}`] = hold(`--marxy-tok-${role}`, v!, col, all(codeGrounds, codeFloor));
    }
    for (let pass = 0; pass < 3; pass += 1) {
      for (const [role, v] of Object.entries(P.tok)) {
        if (!v?.startsWith('@')) continue;
        const name = v.slice(1);
        // A colour role (the link, the text) was held on the page's grounds, not on code's: held here too.
        const to = named[name] ? guard(named[name], all(codeGrounds, codeFloor)) : toks[`--marxy-tok-${name}`];
        if (to) toks[`--marxy-tok-${role}`] = to;
      }
    }
  }
  const tokens: Record<string, string> = {};
  const colours: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) tokens[k] = colours[k.slice(14)] = hex(v);
  for (const [k, v] of Object.entries(toks)) tokens[k] = hex(v);

  // A palette has the chroma it was drawn with at the look's own one half; the dial scales it, the gamut bounds it, and
  // the lightness is solved on these grounds. Off, or at ink only, every language takes the shared colours.
  const ownLang = look.perLanguage !== false && codeOn;
  const shared: Readonly<Record<PaletteRole, Rgb>> = {
    keyword: hexToRgb(tokens['--marxy-tok-keyword']!)!,
    type: hexToRgb(tokens['--marxy-tok-type']!)!,
    string: hexToRgb(tokens['--marxy-tok-string']!)!,
    number: hexToRgb(tokens['--marxy-tok-number']!)!,
    decorator: hexToRgb(tokens['--marxy-tok-attribute']!)!,
  };
  for (const [id, p] of Object.entries(LANG_PALETTES)) {
    const mine = look.langs?.[id] ?? {};
    for (const role of PALETTE_ROLES) {
      const [hue, ch] = p.hues[role];
      // Increase contrast holds a language's own colours to 7 : 1, as lang-colour.ts does with the looks off.
      const col = ownLang ? at(mine[role] ?? hue, clamp(ch * look.code * 2, 0, 0.22), all(codeGrounds, more ? 7 : 4.9)) : shared[role];
      tokens[`--marxy-pl-${id}-${role}`] = hex(col);
    }
  }
  tokens['--marxy-shadow-surface'] =
    P?.shadow && still ? P.shadow : dark ? `0 0 0 1px ${hex(hair2)}, 0 18px 50px rgba(0, 0, 0, 0.55)` : `0 0 0 1px ${hex(hair2)}, 0 18px 46px rgba(40, 34, 24, 0.18)`;
  if (P?.glass && still) drawn['--marxy-color-surface-glass'] = P.glass;
  const weights = { body: P?.weight, heading: P?.headWeight, strong: P?.strongWeight };
  return { tokens, colours, target, got: ratio(bg, ink), faintGot: ratio(bg, faint), dark, drawn, moved, weights };
}

/** Each pinned role and the token it paints, for a palette written down as resolved (`bakePins`). */
const PIN_TOKEN: Readonly<Record<string, string>> = {
  bg: '--marxy-color-bg', surface: '--marxy-color-surface', codeBg: '--marxy-color-code-bg', text: '--marxy-color-text',
  strong: '--marxy-color-text-strong', second: '--marxy-color-text-secondary', faint: '--marxy-color-text-faint',
  accent: '--marxy-color-accent', accentStrong: '--marxy-color-accent-strong', accentFg: '--marxy-color-accent-fg',
  link: '--marxy-color-link', wash: '--marxy-color-accent-wash', rule: '--marxy-color-rule', ruleStrong: '--marxy-color-rule-strong',
  quoteRule: '--marxy-color-quote-rule', edge: '--marxy-color-edge', selection: '--marxy-color-selection', find: '--marxy-color-find',
  findCurrent: '--marxy-color-find-current', findEdge: '--marxy-color-find-edge', ok: '--marxy-color-status-ok',
  warn: '--marxy-color-status-warn', err: '--marxy-color-status-err', info: '--marxy-color-status-info',
  okWash: '--marxy-color-status-ok-wash', warnWash: '--marxy-color-status-warn-wash', errWash: '--marxy-color-status-err-wash',
  diffAdd: '--marxy-color-diff-add', diffDel: '--marxy-color-diff-del', diffAddWord: '--marxy-color-diff-add-word',
  diffDelWord: '--marxy-color-diff-del-word', codeText: '--marxy-color-code-text',
};
export const PIN_ROLES = Object.keys(PIN_TOKEN);

/**
 * `look`'s pins as its dials have carried them from `own`'s, each written as the colour it resolves to; references and
 * hand-set weights moved by the weight dials. Unmoved, the pins as drawn. What "save as mine" keeps.
 */
export function bakePins(look: Look, own: Look): Look['pins'] {
  if (!look.pins) return undefined;
  const same = JSON.stringify([look.day, look.night, look.ink, look.inkNight, look.accent, look.code, look.weight, look.headWeight]) ===
    JSON.stringify([own.day, own.night, own.ink, own.inkNight, own.accent, own.code, own.weight, own.headWeight]);
  if (same) return look.pins;
  const out: Partial<Record<Scheme, Pins>> = {};
  for (const scheme of Object.keys(look.pins) as Scheme[]) {
    const P = look.pins[scheme]!;
    const t = palette(look, scheme, { own }).tokens;
    const next: Record<string, unknown> = { ...P };
    for (const [role, v] of Object.entries(P)) {
      const token = PIN_TOKEN[role];
      if (token && typeof v === 'string' && !v.startsWith('@')) next[role] = t[token];
    }
    if (P.tok) next.tok = Object.fromEntries(Object.entries(P.tok).map(([role, v]) => [role, v?.startsWith('@') ? v : t[`--marxy-tok-${role}`]]));
    const dW = look.weight - own.weight;
    if (P.weight !== undefined) next.weight = P.weight + dW;
    if (P.strongWeight !== undefined) next.strongWeight = P.strongWeight + dW;
    if (P.headWeight !== undefined) next.headWeight = P.headWeight + (look.headWeight - own.headWeight);
    out[scheme] = next as Pins;
  }
  return out;
}

// ---- rules ------------------------------------------------------------------------------------------------------------

export const MONO_KINDS: readonly string[] = ['code', 'log', 'terminal', 'diff'];
export const DATA_KINDS: readonly string[] = ['data'];
/** Working documents: plans, handoffs, notes; lists, tables and code need the room. */
export const WORKING_KINDS: readonly string[] = ['report', 'docs', 'notes', 'changelog'];

export const subjectOf = (kind: string | null | undefined): Subject =>
  kind != null && MONO_KINDS.includes(kind) ? 'mono' : kind != null && DATA_KINDS.includes(kind) ? 'data' : 'prose';

/** Every rule, built-in then the reader's, each with its switch as the state has it. */
export function rulesOf(state: LookState): Rule[] {
  return [...BUILT_IN_RULES, ...state.userRules].map((r) => (r.id in state.rules ? { ...r, on: state.rules[r.id]! } : r));
}
const ruleOn = (state: LookState, id: string): boolean => rulesOf(state).find((r) => r.id === id)?.on === true;

function pathMatches(want: string, path: string): boolean {
  const p = path.replace(/\\/g, '/');
  const w = want.replace(/\\/g, '/');
  if (/^([a-z]:)?\//i.test(w)) {
    const root = w.replace(/\/+$/, '').toLowerCase();
    const lp = p.toLowerCase();
    // A folder boundary, so `notes` never takes in a sibling `notes-old`.
    return lp === root || lp.startsWith(root + '/');
  }
  const folder = w.replace(/^\.?\/+/, '').replace(/\/+$/, '');
  return folder !== '' && `/${p}/`.toLowerCase().includes(`/${folder.toLowerCase()}/`);
}

export function ruleMatches(when: When | undefined, ctx: { readonly path: string; readonly kind: string | null; readonly scheme: Scheme; readonly width: number }): boolean {
  if (!when) return false;
  if (when.path && !pathMatches(when.path, ctx.path)) return false;
  if (when.kinds && !(ctx.kind !== null && when.kinds.includes(ctx.kind))) return false;
  if (when.scheme && when.scheme !== ctx.scheme) return false;
  if (when.maxWidth && !(ctx.width <= when.maxWidth)) return false;
  if (when.minWidth && !(ctx.width >= when.minWidth)) return false;
  return true;
}

// ---- looks -----------------------------------------------------------------------------------------------------------

export function allLooks(state: LookState): Look[] {
  return [...LOOKS, ...state.mine.filter((m) => !LOOKS.some((l) => l.id === m.id))];
}
export function lookById(state: LookState, id: string): Look {
  return allLooks(state).find((l) => l.id === id) ?? LOOKS[0]!;
}
/** A look with the reader's changes to it (or `tweaks` in their place). */
export function merged(state: LookState, id: string, tweaks?: LookTweaks): Look {
  return { ...lookById(state, id), ...(tweaks ?? state.tweaks[id] ?? {}) };
}
export const isTweaked = (state: LookState, id: string = state.id): boolean => Object.keys(state.tweaks[id] ?? {}).length > 0;

/** Day or night: the mode, the system's scheme or the clock; with the dark rule off, only a chosen night is night. */
export function schemeOf(state: LookState, ctx: Pick<LookContext, 'systemDark' | 'hour'> = {}): Scheme {
  if (state.mode === 'day' || state.mode === 'night') return state.mode;
  if (!ruleOn(state, 'dark')) return 'day';
  if (state.mode === 'clock') {
    const h = ctx.hour ?? 12;
    return h >= 19 || h < 7 ? 'night' : 'day';
  }
  return ctx.systemDark ? 'night' : 'day';
}

// ---- type -------------------------------------------------------------------------------------------------------------

const metricOf = (ctx: LookContext, face: FaceId): { readonly avg: number; readonly xh: number } => ctx.metrics?.[face] ?? FACES[face].metrics;
/** The face role each prose kind takes when a look names faces by role: the default theme's kind profiles. */
const KIND_FACE_ROLE: Readonly<Record<string, FaceRole>> = { article: 'article', readme: 'readme', docs: 'readme', report: 'sans', changelog: 'sans', transcript: 'sans' };
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
const px = (n: number): string => `${Number(n.toFixed(2))}px`;

/** Every token a pane is painted with for its context, why it looks so, and what it measures. */
export function resolve(state: LookState, ctx: LookContext = {}, over: Over = {}): Resolved {
  const kind = ctx.kind ?? null;
  const path = ctx.path ?? '';
  const width = ctx.width ?? 900;
  const why: Why[] = [];
  const scheme: Scheme = over.scheme ?? ctx.scheme ?? schemeOf(state, ctx);
  let id = over.id ?? state.id;
  let byRule: Rule | null = null;
  const sets: Rule[] = [];
  if (!over.id && !over.noRules) {
    for (const r of rulesOf(state)) {
      if (!r.on || !r.set || !ruleMatches(r.when, { path, kind, scheme, width })) continue;
      if (r.set.look) {
        if (allLooks(state).some((l) => l.id === r.set!.look)) {
          id = r.set.look;
          byRule = r;
        }
      } else sets.push(r);
    }
  }
  let look = merged(state, id, over.tweaks);
  // The look as it ships (or as the reader saved it): the dials' home, which a pinned palette is carried from.
  const own = lookById(state, id);
  const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
  why.push({
    text: byRule ? `${look.name}, because: ${lower(byRule.label)}` : `${look.name}${isTweaked(state, id) && !over.tweaks ? ', with your changes' : ''}`,
    rule: byRule?.id,
    head: true,
  });
  for (const r of sets) {
    const { look: _ignored, ...rest } = r.set!;
    look = { ...look, ...rest };
    why.push({ text: r.label, rule: r.id });
  }
  // A look drawn for one scheme keeps it at any hour.
  const shown: Scheme = look.only ?? scheme;
  const pal = palette(look, shown, { more: ctx.more, own });
  if (look.only && look.only !== scheme) why.push({ text: `Drawn for ${look.only === 'night' ? 'night' : 'day'} only: it keeps its ${look.only === 'night' ? 'dark' : 'light'} page by ${scheme}` });
  else if (scheme === 'night') {
    const said = state.mode === 'system' ? ' (the system is dark)' : state.mode === 'clock' ? ' (after 19:00)' : '';
    why.push({ text: pal.weights.body !== undefined ? `Night tone${said}; the theme's own night weights` : `Night tone${said}; weight eased by 20`, rule: 'dark' });
  }

  const subject = subjectOf(kind);
  let face: FaceId = look.face;
  let size = look.size;
  let lead = look.lead;
  let chars = look.measure;
  let weight = look.weight;
  const adapt = ruleOn(state, 'kinds');
  if (subject === 'mono' && adapt) {
    face = 'mono';
    size *= 0.82;
    lead = 1.55;
    why.push({ text: `Fixed-width face, smaller, no measure (it is ${kind === 'diff' ? 'a patch' : kind === 'terminal' ? 'a session' : `a ${kind}`})`, rule: 'kinds' });
  } else if (subject === 'data' && adapt) {
    face = 'hyper';
    size *= 0.84;
    lead = 1.5;
    why.push({ text: 'Interface face, smaller, tabular figures (it is data)', rule: 'kinds' });
  } else if (subject === 'prose' && kind !== null && WORKING_KINDS.includes(kind) && ruleOn(state, 'working')) {
    chars = Math.round(chars * 1.1);
    why.push({ text: `Measure widened to ${chars} characters (a working document)`, rule: 'working' });
  }
  const role = subject === 'prose' && kind !== null ? KIND_FACE_ROLE[kind] : undefined;
  if (role && look.faces?.[role]) face = look.faces[role]!;
  const m = metricOf(ctx, face);
  const ref = metricOf(ctx, look.sizeFace ?? 'hyper');
  // Matched x-heights: a face set in place of the look's own keeps the apparent size. A kind's own face (an article's
  // serif, a README's sans) is set at the same size, as the default theme's profiles set it.
  if (subject === 'prose' && look.face !== 'mono') size *= clamp(ref.xh / metricOf(ctx, look.face).xh, 0.9, 1.14);
  if (state.lean && ruleOn(state, 'lean') && !over.noRules) {
    size *= 1.3;
    chars = Math.min(chars, 52);
    why.push({ text: 'Leaning back: type a third larger, lines no longer than 52 characters', rule: 'lean' });
  }
  let tight = false;
  if (width < 620 && ruleOn(state, 'narrow')) {
    tight = true;
    // Never below 15, and never raised to it: a type already under 15 is left as it is.
    size = Math.min(size, Math.max(15, size - 1.5));
    why.push({ text: `Tightened for a ${Math.round(width)} px pane`, rule: 'narrow' });
  }
  if (width > 1500 && ruleOn(state, 'wide')) {
    size *= 1.1;
    why.push({ text: 'Type a tenth larger on a wide pane', rule: 'wide' });
  }
  // A theme that sets its scheme's weights by hand keeps them, moved by the weight dial as far as it was moved.
  const dWeight = look.weight - own.weight;
  if (pal.weights.body !== undefined) weight = pal.weights.body + dWeight;
  else if (shown === 'night' && FACES[face].variable) weight -= 20;
  const headWeight = pal.weights.heading !== undefined ? pal.weights.heading + (look.headWeight - own.headWeight) : look.headWeight;
  const strongWeight = pal.weights.strong !== undefined ? pal.weights.strong + dWeight : Math.min(900, weight + 230);
  size = Math.round(size * 4) / 4;
  // The page's grid unit is half a line box, a whole pixel: the line box is an even pixel.
  const lineBox = even(size * lead);
  const measurePx = subject === 'prose' ? Math.round(chars * m.avg * size) : 0;
  const monoSize = Math.round((subject === 'mono' ? size : size * 0.86) * 2) / 2;
  const monoBox = subject === 'mono' ? even(monoSize * 1.55) : lineBox;
  const headFace = look.headFace ? FACES[look.headFace].stack : FACES[face].stack;
  const old = look.figures === 'old' && subject === 'prose' && !(kind !== null && WORKING_KINDS.includes(kind));
  const tokens: Record<string, string> = {
    ...pal.tokens,
    '--marxy-font-text': FACES[face].stack,
    '--marxy-font-heading': headFace,
    '--marxy-font-mono': FACES.mono.stack,
    '--marxy-face-book': FACES[subject === 'prose' ? look.face : face].stack,
    '--marxy-face-article': FACES[subject === 'prose' ? (look.faces?.article ?? look.face) : face].stack,
    '--marxy-face-sans': FACES[subject === 'prose' ? (look.faces?.sans ?? look.face) : face].stack,
    '--marxy-face-readme': FACES[subject === 'prose' ? (look.faces?.readme ?? look.face) : face].stack,
    '--marxy-face-mono': FACES.mono.stack,
    '--marxy-size-body': px(size),
    '--marxy-line-box': px(lineBox),
    '--marxy-size-code': px(monoSize),
    '--marxy-line-box-code': px(monoBox),
    '--marxy-size-caption': px(Math.round(size * 0.75)),
    '--marxy-lh-h1': px(even(lineBox * 1.5)),
    '--marxy-lh-h2': px(lineBox),
    '--marxy-scale-ratio': String(look.scale),
    '--marxy-measure-chars': String(chars),
    '--marxy-measure-user': String(chars),
    '--marxy-avg-char': String(m.avg),
    '--marxy-weight-body': String(weight),
    '--marxy-weight-strong': String(strongWeight),
    '--marxy-weight-heading': String(headWeight),
    '--marxy-tracking-heading': look.caps ? '0.06em' : `${look.headTracking ?? -0.008}em`,
    '--marxy-justify': look.align === 'justify' && chars >= 45 && !tight && subject === 'prose' ? '1' : '0',
    '--marxy-heading-style': look.headStyle ?? 'normal',
    '--marxy-heading-case': look.caps ? 'uppercase' : 'none',
    '--marxy-figures': old ? 'oldstyle-nums' : 'lining-nums',
    '--marxy-paragraph-indent': look.para === 'indent' && subject === 'prose' ? '1.4em' : '0px',
  };
  return {
    tokens,
    why,
    look,
    scheme: shown,
    subject,
    tight,
    colours: pal.colours,
    moved: pal.moved,
    facts: {
      size,
      line: lineBox,
      measure: measurePx,
      chars: subject === 'prose' ? chars : null,
      weight,
      face: FACES[face].name,
      contrast: pal.got,
      faint: pal.faintGot,
      target: pal.target,
      held: pal.got + 0.05 < pal.target,
    },
  };
}

/** The window's chrome: the look in use as prose, no rule of path or kind, at the window's width. */
export function resolveWindow(state: LookState, ctx: LookContext = {}): Resolved {
  return resolve(state, { ...ctx, kind: null, path: null }, { noRules: true });
}

/** The contrast of two hex colours, for a reader-facing measure. */
export function hexRatio(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return x && y ? ratio(x, y) : 0;
}

/** The colour a tone is drawn in, as a hex; exported for the tone pad's field. */
export const toneRgb = (t: Tone): Rgb => oklchToRgb(t.l, t.c, t.h).rgb;
