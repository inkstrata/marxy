// The reader's looks as state and as files: which look is in use, the reader's changes to each,
// looks of their own, the rules' switches and rules of their own. Pure transitions, so the app's store, the Studio and the
// tests share them. Two files beside config.toml hold it: `look.toml` (the state) and `looks/<id>.look.toml` (a look of
// the reader's own, in the form `toFile` writes, which a person can read and edit).
import { parse, stringify } from 'smol-toml';
import { FLOOR, PIN_ROLES, allLooks, bakePins, lookById, merged, rulesOf, type FaceRole, type Look, type LookState, type LookTweaks, type Mode, type Pins, type Rule, type Scheme, type Tone, type When } from './look.ts';
import { BUILT_IN_RULES, DEFAULT_LOOK, FACE_IDS, LOOKS, SAMPLE_RULES, type FaceId } from './looks.ts';
import { LANG_PALETTES, PALETTE_ROLES, SYNTAX_ROLES, type PaletteRole } from './lang-palettes.ts';

export const LOOK_STATE_FILE = 'look.toml';
export const LOOKS_DIR = 'looks';
export const LOOK_FILE_SUFFIX = '.look.toml';

export function defaultLookState(): LookState {
  return { id: DEFAULT_LOOK, mode: 'system', lean: false, tweaks: {}, mine: [], rules: {}, userRules: [...SAMPLE_RULES] };
}

// ---- transitions ------------------------------------------------------------------------------------------------------

export const setLook = (s: LookState, id: string): LookState => ({ ...s, id: allLooks(s).some((l) => l.id === id) ? id : s.id });
export const setMode = (s: LookState, mode: Mode): LookState => ({ ...s, mode });
export const setLean = (s: LookState, lean: boolean): LookState => ({ ...s, lean });

/** What a look that does not say a value means by it: setting the value so is no change. */
const UNSAID: Partial<Record<keyof Look, unknown>> = { perLanguage: true, langs: {}, headStyle: 'normal', caps: false, figures: 'lining', faces: {}, sizeFace: 'hyper', headTracking: -0.008 };

/** One value of a look changed (undefined takes the change back); a value equal to the look's own is no change. */
export function tweak<K extends keyof LookTweaks>(s: LookState, key: K, value: LookTweaks[K] | undefined, id: string = s.id): LookState {
  const now: LookTweaks = { ...(s.tweaks[id] ?? {}) };
  const own = lookById(s, id)[key as keyof Look] ?? UNSAID[key as keyof Look];
  if (value === undefined || JSON.stringify(own) === JSON.stringify(value)) delete now[key];
  else now[key] = value;
  const tweaks = { ...s.tweaks };
  if (Object.keys(now).length === 0) delete tweaks[id];
  else tweaks[id] = now;
  return { ...s, tweaks };
}

export function reset(s: LookState, id: string = s.id): LookState {
  const tweaks = { ...s.tweaks };
  delete tweaks[id];
  return { ...s, tweaks };
}

export function toggleRule(s: LookState, id: string, on?: boolean): LookState {
  const rule = rulesOf(s).find((r) => r.id === id);
  if (!rule) return s;
  return { ...s, rules: { ...s.rules, [id]: on ?? !rule.on } };
}

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'look';

/** A rule of the reader's own, switched on; `id` is made from its label when not given. */
export function addRule(s: LookState, rule: Omit<Rule, 'id' | 'on' | 'user'> & { readonly id?: string }): LookState {
  const taken = new Set(rulesOf(s).map((r) => r.id));
  let id = rule.id ?? slug(rule.label).slice(0, 32);
  for (let n = 2; taken.has(id); n += 1) id = `${slug(rule.label).slice(0, 28)}-${n}`;
  return { ...s, userRules: [...s.userRules, { ...rule, id, on: true, user: true }] };
}

export function removeRule(s: LookState, id: string): LookState {
  const rules = { ...s.rules };
  delete rules[id];
  return { ...s, userRules: s.userRules.filter((r) => r.id !== id), rules };
}

/**
 * The look in use with the reader's changes, kept as a look of their own named `name`, and put in use. A palette drawn by
 * hand is written down as the dials had carried it, so the look of their own looks as it did; it names no bundled sheet.
 */
export function saveAs(s: LookState, name: string, tweaks?: LookTweaks): { readonly state: LookState; readonly look: Look } {
  // It keeps its appearance (the shelf it stands on); it names no bundled sheet and no partner page.
  const { theme: _sheet, partner: _partner, ...rest } = merged(s, s.id, tweaks);
  const pins = bakePins(rest as Look, lookById(s, s.id));
  const base: Look = pins ? { ...(rest as Look), pins } : (rest as Look);
  // A name whose slug is taken (another script's letters, a case apart) gets a number, never the other look's place.
  const taken = new Set(allLooks(s).map((l) => l.id));
  let id = `mine-${slug(name)}`;
  for (let n = 2; taken.has(id); n += 1) id = `mine-${slug(name)}-${n}`;
  const look: Look = { ...base, id, name: name.trim() || 'Mine', blurb: `Yours, from ${lookById(s, s.id).name}.`, mine: true };
  const others = { ...s.tweaks };
  if (!tweaks) delete others[s.id];
  delete others[id];
  return { state: { ...s, mine: [...s.mine.filter((m) => m.id !== id), look], tweaks: others, id }, look };
}

export function removeMine(s: LookState, id: string): LookState {
  if (!s.mine.some((m) => m.id === id)) return s;
  const tweaks = { ...s.tweaks };
  delete tweaks[id];
  return { ...s, mine: s.mine.filter((m) => m.id !== id), tweaks, id: s.id === id ? DEFAULT_LOOK : s.id };
}

// ---- a look as a file -------------------------------------------------------------------------------------------------

const ROLE_WORD: Readonly<Record<PaletteRole, string>> = { keyword: 'keyword', type: 'type', string: 'string', number: 'number', decorator: 'attribute' };
const round = (n: number, d = 3): number => Number(n.toFixed(d));
const toneToml = (t: Tone): string => `{ l = ${round(t.l)}, c = ${round(t.c)}, h = ${Math.round(t.h)} }`;
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(1, n - s.length));

const q = (v: string): string => JSON.stringify(v);
const keyOf = (k: string): string => (/^[A-Za-z0-9_-]+$/.test(k) ? k : q(k));
const WEIGHT_KEY = { weight: 'weight', headWeight: 'heading_weight', strongWeight: 'strong_weight' } as const;
/** A scheme's pins as the lines of `[palette.<scheme>]` and its `.code` table. */
function paletteLines(scheme: Scheme, p: Pins): string[] {
  const out = ['', `[palette.${scheme}]`];
  for (const role of PIN_ROLES) {
    const v = (p as Record<string, unknown>)[role];
    if (typeof v === 'string') out.push(`${role} = ${q(v)}`);
  }
  for (const k of ['glass', 'shadow'] as const) if (p[k]) out.push(`${k} = ${q(p[k]!)}`);
  for (const k of ['weight', 'headWeight', 'strongWeight'] as const) if (p[k] !== undefined) out.push(`${WEIGHT_KEY[k]} = ${p[k]}`);
  if (p.tok && Object.keys(p.tok).length) {
    out.push('', `[palette.${scheme}.code]`);
    for (const [role, v] of Object.entries(p.tok)) if (typeof v === 'string') out.push(`${role} = ${q(v)}`);
  }
  if (p.extra && Object.keys(p.extra).length) {
    out.push('', `[palette.${scheme}.extra]`);
    for (const [k, v] of Object.entries(p.extra)) out.push(`${keyOf(k)} = ${q(v)}`);
  }
  return out;
}

/**
 * A look as its file. A derived look lists no colours: they are worked out from the tone and the ink target. A theme drawn
 * by hand lists its palette, each colour still held to its floor when it is read.
 */
export function toFile(s: LookState, id: string = s.id, tweaks?: LookTweaks): string {
  const k = merged(s, id, tweaks);
  const names = Object.values(LANG_PALETTES).map((p) => p.name).join(', ');
  const lines = [
    `# ${k.id}${LOOK_FILE_SUFFIX}`,
    ...(k.pins
      ? ['# A look is this file. Its colours are drawn by hand under [palette]; each is held to', `# its floor (${FLOOR} : 1 for text) when it is read, and the dials move them from here.`]
      : ['# A look is this file. Colours are not listed: they are worked out from the tone', `# and the ink target, and never fall below ${FLOOR} : 1 for text.`]),
    '',
    `name = ${JSON.stringify(k.name)}`,
    `blurb = ${JSON.stringify(k.blurb)}`,
    ...(k.credit ? [`credit = ${q(k.credit)}`] : []),
    ...(k.group ? [`${pad(`appearance = ${q(k.group)}`, 22)}# the shelf it stands on: dark or light`] : []),
    ...(k.only ? [`${pad(`only = ${q(k.only)}`, 22)}# drawn for this scheme alone`] : []),
    '',
    '[tone]',
    `day = ${toneToml(k.day)}`,
    `night = ${toneToml(k.night)}`,
    `${pad(`ink = ${k.ink}`, 22)}# contrast of text on the page, day`,
    `ink_night = ${k.inkNight || k.ink}`,
    `${pad(`accent = ${Math.round(k.accent)}`, 22)}# hue, degrees`,
    `${pad(`code_colour = ${k.code}`, 22)}# how much: 0 is ink only, 1 is vivid`,
    `${pad(`per_language = ${k.perLanguage !== false}`, 22)}# which: ${names} in their own hues; others share one set`,
    ...(k.tint ? [`tint = { h = ${Math.round(k.tint.h)}, c = ${round(k.tint.c)} }`] : []),
    ...Object.entries(k.langs ?? {}).flatMap(([lang, hues]) => [
      '',
      `${pad(`[code.${lang}]`, 22)}# hues of your own, in degrees`,
      ...Object.entries(hues).map(([role, hue]) => `${ROLE_WORD[role as PaletteRole] ?? role} = ${Math.round(hue as number)}`),
    ]),
    '',
    '[type]',
    `face = ${JSON.stringify(k.face)}`,
    `size = ${k.size}`,
    `leading = ${k.lead}`,
    `${pad(`measure = ${k.measure}`, 22)}# characters, measured, not ch`,
    `weight = ${k.weight}`,
    `heading_weight = ${k.headWeight}`,
    `scale = ${k.scale}`,
    ...(k.headFace ? [`heading_face = ${JSON.stringify(k.headFace)}`] : []),
    ...(k.sizeFace ? [`${pad(`size_face = ${q(k.sizeFace)}`, 22)}# the face the size is measured against`] : []),
    ...(k.headTracking !== undefined ? [`heading_tracking = ${k.headTracking}`] : []),
    `heading_style = ${JSON.stringify(k.headStyle ?? 'normal')}`,
    `heading_caps = ${k.caps === true}`,
    `paragraphs = ${JSON.stringify(k.para)}`,
    `align = ${JSON.stringify(k.align)}`,
    `figures = ${JSON.stringify(k.figures ?? 'lining')}`,
    ...(k.faces && Object.keys(k.faces).length
      ? ['', `${pad('[faces]', 22)}# a face of its own for articles, reports (sans) and READMEs`, ...Object.entries(k.faces).map(([role, face]) => `${role} = ${q(face as string)}`)]
      : []),
    ...(k.pins ? (['night', 'day'] as const).flatMap((sc) => (k.pins![sc] ? paletteLines(sc, k.pins![sc]!) : [])) : []),
    '',
    '[adapts]',
  ];
  for (const r of rulesOf(s)) lines.push(`${pad(`${/^[A-Za-z0-9_-]+$/.test(r.id) ? r.id : JSON.stringify(r.id)} = ${r.on}`, 22)}# ${r.label}`);
  return `${lines.join('\n')}\n`;
}

type Table = Record<string, unknown>;
const isTable = (v: unknown): v is Table => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined);
function tone(v: unknown): Tone | undefined {
  if (!isTable(v)) return undefined;
  const l = num(v.l, 0, 1);
  const c = num(v.c, 0, 0.4);
  const h = num(v.h, 0, 360);
  return l === undefined || c === undefined || h === undefined ? undefined : { l, c, h };
}

const COLOUR = /^(#[0-9a-f]{6}|#[0-9a-f]{3}|rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\)|@[A-Za-z]+)$/i;
const PIN_NAMES = new Set<string>([...PIN_ROLES, 'glass']);
const SAFE_CSS = (x: unknown): x is string => typeof x === 'string' && x.length < 200 && !/[;{}<>]|url\(|@import/i.test(x);
/** One scheme's palette from its table: colours by known role, code roles by name, weights in range; the rest left out. */
function pinsFrom(v: unknown): Pins | undefined {
  if (!isTable(v)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (PIN_NAMES.has(k) && typeof x === 'string' && COLOUR.test(x.trim())) out[k] = x.trim();
    else if (k === 'shadow' && SAFE_CSS(x)) out[k] = x;
  }
  const w = num(v.weight, 200, 800);
  const hw = num(v.heading_weight, 300, 900);
  const sw = num(v.strong_weight, 300, 900);
  if (w !== undefined) out.weight = w;
  if (hw !== undefined) out.headWeight = hw;
  if (sw !== undefined) out.strongWeight = sw;
  if (isTable(v.code)) {
    const tok: Record<string, string> = {};
    for (const [role, x] of Object.entries(v.code)) if ((SYNTAX_ROLES as readonly string[]).includes(role) && typeof x === 'string' && COLOUR.test(x.trim())) tok[role] = x.trim();
    if (Object.keys(tok).length) out.tok = tok;
  }
  if (isTable(v.extra)) {
    const extra: Record<string, string> = {};
    for (const [k, x] of Object.entries(v.extra)) if (/^--marxy-[a-z0-9-]+$/.test(k) && SAFE_CSS(x)) extra[k] = x;
    if (Object.keys(extra).length) out.extra = extra;
  }
  // A palette names its ground: without one there is nothing to hold the rest against.
  return typeof out.bg === 'string' && (out.bg as string).startsWith('#') ? (out as Pins) : undefined;
}

/** The values of a look file, each checked and held to its dial's range; what is missing or wrong is left out. */
export function tweaksFromToml(t: Table): LookTweaks {
  const out: LookTweaks = {};
  const tn = isTable(t.tone) ? t.tone : {};
  const ty = isTable(t.type) ? t.type : {};
  const set = <K extends keyof LookTweaks>(k: K, v: LookTweaks[K] | undefined): void => {
    if (v !== undefined) out[k] = v;
  };
  set('day', tone(tn.day));
  set('night', tone(tn.night));
  set('ink', num(tn.ink, FLOOR, 21));
  set('inkNight', num(tn.ink_night, FLOOR, 21));
  set('accent', num(tn.accent, 0, 360));
  set('code', num(tn.code_colour, 0, 1));
  if (typeof tn.per_language === 'boolean') out.perLanguage = tn.per_language;
  if (isTable(tn.tint)) {
    const h = num(tn.tint.h, 0, 360);
    const c = num(tn.tint.c, 0, 0.2);
    if (h !== undefined && c !== undefined) out.tint = { h, c };
  }
  const code = isTable(t.code) ? t.code : {};
  const langs: Record<string, Partial<Record<PaletteRole, number>>> = {};
  for (const [lang, hues] of Object.entries(code)) {
    if (!(lang in LANG_PALETTES) || !isTable(hues)) continue;
    for (const role of PALETTE_ROLES) {
      const hue = num(hues[ROLE_WORD[role]], 0, 360);
      if (hue !== undefined) (langs[lang] ??= {})[role] = hue;
    }
  }
  if (Object.keys(langs).length > 0) out.langs = langs;
  set('face', oneOf<FaceId>(ty.face, FACE_IDS));
  set('size', num(ty.size, 12, 40));
  set('lead', num(ty.leading, 1.1, 2.2));
  set('measure', num(ty.measure, 30, 110));
  set('weight', num(ty.weight, 200, 800));
  set('headWeight', num(ty.heading_weight, 300, 900));
  set('scale', num(ty.scale, 1, 1.6));
  set('headFace', oneOf<FaceId>(ty.heading_face, FACE_IDS));
  set('headStyle', oneOf(ty.heading_style, ['normal', 'italic'] as const));
  if (typeof ty.heading_caps === 'boolean') out.caps = ty.heading_caps;
  set('para', oneOf(ty.paragraphs, ['space', 'indent'] as const));
  set('align', oneOf(ty.align, ['left', 'justify'] as const));
  set('figures', oneOf(ty.figures, ['lining', 'old'] as const));
  set('sizeFace', oneOf<FaceId>(ty.size_face, FACE_IDS));
  set('headTracking', num(ty.heading_tracking, -0.1, 0.2));
  if (isTable(t.faces)) {
    const faces: Partial<Record<FaceRole, FaceId>> = {};
    for (const role of ['article', 'sans', 'readme'] as const) {
      const face = oneOf<FaceId>(t.faces[role], FACE_IDS);
      if (face) faces[role] = face;
    }
    out.faces = faces;
  }
  if (isTable(t.palette)) {
    const pins: Partial<Record<Scheme, Pins>> = {};
    for (const sc of ['night', 'day'] as const) {
      const p = pinsFrom(t.palette[sc]);
      if (p) pins[sc] = p;
    }
    if (pins.night || pins.day) out.pins = pins;
  }
  return out;
}

/**
 * A look of the reader's own read from its file; values it leaves out are Paper's. Null when the file is not TOML, or says
 * `removed = true` (the Studio's remove: the shell deletes nothing, so the file stays and says it is set aside).
 */
export function fromFile(id: string, text: string): Look | null {
  let t: Table;
  try {
    t = parse(text) as Table;
  } catch {
    return null;
  }
  if (t.removed === true) return null;
  // Values a file leaves out are Paper's, as they were before Ink was the default: a file written then reads the same.
  const { group: _shelf, theme: _sheet, credit: _credit, ...base } = LOOKS.find((l) => l.id === 'paper') ?? LOOKS[0]!;
  const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim() : id;
  const blurb = typeof t.blurb === 'string' ? t.blurb : 'Yours.';
  const credit = typeof t.credit === 'string' && t.credit.trim() ? { credit: t.credit.trim() } : {};
  const only = oneOf(t.only, ['day', 'night'] as const);
  const look: Look = { ...base, ...tweaksFromToml(t), ...credit, ...(only ? { only } : {}), id, name, blurb, mine: true };
  // A file from before appearances were written: dark when it draws a night palette or its day page is dark.
  const group = oneOf(t.appearance, ['dark', 'light'] as const) ?? (look.only === 'night' || look.pins?.night || look.day.l < 0.5 ? 'dark' : 'light');
  return { ...look, group };
}

// ---- the state as a file ----------------------------------------------------------------------------------------------

const MODES: readonly Mode[] = ['system', 'clock', 'day', 'night'];

function whenOf(v: unknown): When | undefined {
  if (!isTable(v)) return undefined;
  const w: { -readonly [K in keyof When]: When[K] } = {};
  if (typeof v.path === 'string' && v.path.trim()) w.path = v.path.trim();
  if (Array.isArray(v.kinds)) w.kinds = v.kinds.filter((k): k is string => typeof k === 'string');
  const scheme = oneOf(v.scheme, ['day', 'night'] as const);
  if (scheme) w.scheme = scheme;
  const max = num(v.max_width, 100, 10000);
  const min = num(v.min_width, 100, 10000);
  if (max !== undefined) w.maxWidth = max;
  if (min !== undefined) w.minWidth = min;
  return Object.keys(w).length > 0 ? w : undefined;
}

function tweaksToToml(k: LookTweaks): Table {
  const t: Table = {};
  const tn: Table = {};
  const ty: Table = {};
  if (k.day) tn.day = { l: round(k.day.l), c: round(k.day.c), h: Math.round(k.day.h) };
  if (k.night) tn.night = { l: round(k.night.l), c: round(k.night.c), h: Math.round(k.night.h) };
  if (k.ink !== undefined) tn.ink = k.ink;
  if (k.inkNight !== undefined) tn.ink_night = k.inkNight;
  if (k.accent !== undefined) tn.accent = Math.round(k.accent);
  if (k.code !== undefined) tn.code_colour = k.code;
  if (k.perLanguage !== undefined) tn.per_language = k.perLanguage;
  if (k.tint) tn.tint = { h: Math.round(k.tint.h), c: round(k.tint.c) };
  if (k.face) ty.face = k.face;
  if (k.size !== undefined) ty.size = k.size;
  if (k.lead !== undefined) ty.leading = k.lead;
  if (k.measure !== undefined) ty.measure = k.measure;
  if (k.weight !== undefined) ty.weight = k.weight;
  if (k.headWeight !== undefined) ty.heading_weight = k.headWeight;
  if (k.scale !== undefined) ty.scale = k.scale;
  if (k.headFace) ty.heading_face = k.headFace;
  if (k.headStyle) ty.heading_style = k.headStyle;
  if (k.caps !== undefined) ty.heading_caps = k.caps;
  if (k.para) ty.paragraphs = k.para;
  if (k.align) ty.align = k.align;
  if (k.figures) ty.figures = k.figures;
  if (k.sizeFace) ty.size_face = k.sizeFace;
  if (k.headTracking !== undefined) ty.heading_tracking = k.headTracking;
  if (Object.keys(tn).length) t.tone = tn;
  if (Object.keys(ty).length) t.type = ty;
  if (k.faces) t.faces = { ...k.faces };
  if (k.pins) {
    const pal: Table = {};
    for (const sc of ['night', 'day'] as const) {
      const p = k.pins[sc];
      if (!p) continue;
      const { tok, extra, weight, headWeight, strongWeight, ...colours } = p;
      const row: Table = { ...colours };
      if (weight !== undefined) row.weight = weight;
      if (headWeight !== undefined) row.heading_weight = headWeight;
      if (strongWeight !== undefined) row.strong_weight = strongWeight;
      if (tok) row.code = { ...tok };
      if (extra) row.extra = { ...extra };
      pal[sc] = row;
    }
    t.palette = pal;
  }
  if (k.langs) t.code = Object.fromEntries(Object.entries(k.langs).map(([lang, hues]) => [lang, Object.fromEntries(Object.entries(hues).map(([r, h]) => [ROLE_WORD[r as PaletteRole], Math.round(h as number)]))]));
  return t;
}

/** A look file set aside: what the Studio writes over a look of the reader's own that is removed. */
export const removedLookFile = (id: string): string =>
  `# ${id}${LOOK_FILE_SUFFIX}: removed in the Studio. Delete this file, or take the line below out to have the look back.\nremoved = true\n`;

type Keyed = { readonly id: string };

/**
 * What `next` changed from `base`, laid over `loaded`: a change made before look.toml was read, kept over what it says.
 * Transitions keep the parts they leave alone, so a part is changed when it is not the same object.
 */
export function layOver(loaded: LookState, base: LookState, next: LookState): LookState {
  const out: Record<string, unknown> = { ...loaded };
  for (const k of Object.keys(next) as (keyof LookState)[]) {
    const b = base[k] as unknown;
    const n = next[k] as unknown;
    if (n === b) continue;
    if (Array.isArray(n) && Array.isArray(b)) {
      const gone = new Set((b as Keyed[]).filter((x) => !n.includes(x)).map((x) => x.id));
      const added = (n as Keyed[]).filter((x) => !b.includes(x));
      const ids = new Set(added.map((x) => x.id));
      out[k] = [...(loaded[k] as unknown as Keyed[]).filter((x) => !gone.has(x.id) && !ids.has(x.id)), ...added];
    } else if (n && b && typeof n === 'object' && typeof b === 'object') {
      const o: Record<string, unknown> = { ...(loaded[k] as unknown as Record<string, unknown>) };
      for (const key of Object.keys(b)) if (!(key in n)) delete o[key];
      for (const [key, v] of Object.entries(n)) if ((b as Record<string, unknown>)[key] !== v) o[key] = v;
      out[k] = o;
    } else out[k] = n;
  }
  return out as unknown as LookState;
}

/** Why look.toml cannot be read as TOML, or null when it can. */
export function lookFileError(text: string): string | null {
  try {
    parse(text);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.split('\n')[0]! : String(e);
  }
}

/** Whether look.toml says the looks paint the page (`on = false`, or no file, leaves the theme config.toml names). */
export function lookFileOn(text: string): boolean {
  try {
    const t = parse(text) as Table;
    return t.on !== false;
  } catch {
    return false;
  }
}

/**
 * look.toml: whether looks paint the page, the look in use, how night is decided, lean back, each rule's switch, the
 * reader's rules and changes.
 */
export function stateToToml(s: LookState, on = true): string {
  const doc: Table = { on, look: s.id, mode: s.mode, lean: s.lean };
  if (Object.keys(s.rules).length) doc.rules = { ...s.rules };
  const tweaks = Object.fromEntries(Object.entries(s.tweaks).filter(([, t]) => Object.keys(t).length > 0).map(([id, t]) => [id, tweaksToToml(t)]));
  if (Object.keys(tweaks).length) doc.tweaks = tweaks;
  // Written even when empty: no `rule` at all is a new state, which starts with the sample rules.
  {
    doc.rule = s.userRules.map((r) => {
      const out: Table = { id: r.id, label: r.label, on: r.on };
      if (r.when) {
        const w: Table = {};
        if (r.when.path) w.path = r.when.path;
        if (r.when.kinds) w.kinds = [...r.when.kinds];
        if (r.when.scheme) w.scheme = r.when.scheme;
        if (r.when.maxWidth) w.max_width = r.when.maxWidth;
        if (r.when.minWidth) w.min_width = r.when.minWidth;
        out.when = w;
      }
      if (r.set) {
        const { look, ...rest } = r.set;
        const set: Table = { ...(look ? { look } : {}) };
        const t = tweaksToToml(rest);
        if (isTable(t.type)) Object.assign(set, t.type);
        if (isTable(t.tone)) Object.assign(set, t.tone);
        out.set = set;
      }
      return out;
    });
  }
  return `# Marxy's look: written by the app as you change it; the colours are worked out, so they are not here.\n${stringify(doc)}\n`;
}

/** The state look.toml holds over `mine` (the looks read from looks/); what it does not say is the default's. */
export function stateFromToml(text: string, mine: readonly Look[] = []): LookState {
  const d = defaultLookState();
  let t: Table;
  try {
    t = parse(text) as Table;
  } catch {
    return { ...d, mine };
  }
  const known = [...LOOKS, ...mine];
  const id = typeof t.look === 'string' && known.some((l) => l.id === t.look) ? t.look : d.id;
  const rules: Record<string, boolean> = {};
  if (isTable(t.rules)) for (const [k, v] of Object.entries(t.rules)) if (typeof v === 'boolean') rules[k] = v;
  const tweaks: Record<string, LookTweaks> = {};
  if (isTable(t.tweaks)) {
    for (const [k, v] of Object.entries(t.tweaks)) {
      if (!isTable(v) || !known.some((l) => l.id === k)) continue;
      const tw = tweaksFromToml(v);
      if (Object.keys(tw).length) tweaks[k] = tw;
    }
  }
  let userRules: Rule[] = d.userRules.slice();
  if (Array.isArray(t.rule)) {
    userRules = [];
    for (const r of t.rule) {
      if (!isTable(r) || typeof r.id !== 'string' || typeof r.label !== 'string') continue;
      if (BUILT_IN_RULES.some((b) => b.id === r.id) || userRules.some((u) => u.id === r.id)) continue;
      let set: Rule['set'];
      if (isTable(r.set)) {
        const look = typeof r.set.look === 'string' ? r.set.look : undefined;
        const tw = tweaksFromToml({ type: r.set, tone: r.set });
        set = { ...(look ? { look } : {}), ...tw };
      }
      userRules.push({ id: r.id, label: r.label, on: r.on !== false, user: true, when: whenOf(r.when), set });
    }
  } else if (t.rule !== undefined) userRules = [];
  return { id, mode: oneOf(t.mode, MODES) ?? d.mode, lean: t.lean === true, tweaks, mine: [...mine], rules, userRules };
}

/** The file name a look of the reader's own is kept under in looks/. */
export const lookFileName = (id: string): string => `${id}${LOOK_FILE_SUFFIX}`;
