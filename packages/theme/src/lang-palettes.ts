// Colour by language. Each language with a palette of its own ships its hues;
// the lightness is solved per theme in OKLCH, so the hue is the language's and the contrast the theme's: every colour
// reaches the floor (4.5 : 1, or 7 : 1 with more contrast or in the high-contrast theme) against every ground a code
// token sits on, the same grounds gate-contrast holds the shared roles to. A role a palette does not name (comments,
// plain names, function names) keeps the shared role. The reader's own colours (`[syntax.rust] keyword = "#..."`) win
// over the palette, a theme's own `[data-marxy-lang]` scope wins over the palette too, and the shared role is the
// fallback under all of them. The accent (`--marxy-lang`) is the language's Linguist colour with its
// lightness walked to 3 : 1 against the chrome's grounds; it marks a language's name, never its tokens.

/** The 21 syntax roles, as core's `MarxyRole` (restated: theme imports nothing from another package; a test holds them equal). */
export const SYNTAX_ROLES = [
  'comment', 'string', 'escape', 'number', 'constant', 'keyword', 'operator', 'function', 'builtin', 'type', 'property',
  'decorator', 'self', 'tag', 'attribute', 'variable', 'punctuation', 'heading', 'marker', 'link', 'mark',
] as const;
export type SyntaxRole = (typeof SYNTAX_ROLES)[number];

/** The roles a language's palette gives a hue, in this order (keywords, types, strings, numbers and literals, attributes and macros). */
export const PALETTE_ROLES = ['keyword', 'type', 'string', 'number', 'decorator'] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

/** Roles that follow a palette role inside a language's scope, so a reader's colour for the one carries to the other. */
export const FOLLOWERS: Readonly<Record<string, PaletteRole>> = { self: 'keyword', builtin: 'type', escape: 'string', constant: 'number' };

export interface LangPalette {
  readonly name: string;
  /** OKLCH hue (degrees) and chroma for each role; lightness is solved per theme. */
  readonly hues: Readonly<Record<PaletteRole, readonly [hue: number, chroma: number]>>;
  readonly note: string;
}

/** Pass 20's four (`reader-pages.js`, LANGS): Rust in its orange, Python in its blue and yellow, Go in its cyan, TypeScript in its blue. */
export const LANG_PALETTES: Readonly<Record<string, LangPalette>> = {
  rust: { name: 'Rust', note: 'its orange: keywords, types and macros in the family', hues: { keyword: [42, 0.15], type: [70, 0.11], string: [100, 0.07], number: [55, 0.12], decorator: [28, 0.1] } },
  python: { name: 'Python', note: 'its blue and yellow: words in blue, strings and decorators in yellow', hues: { keyword: [258, 0.13], type: [240, 0.08], string: [92, 0.12], number: [92, 0.12], decorator: [92, 0.13] } },
  go: { name: 'Go', note: 'its cyan: keywords in it, types in teal', hues: { keyword: [222, 0.12], type: [190, 0.09], string: [240, 0.05], number: [205, 0.09], decorator: [222, 0.08] } },
  typescript: { name: 'TypeScript', note: 'its blue: keywords in it, types in violet', hues: { keyword: [257, 0.15], type: [285, 0.11], string: [200, 0.06], number: [257, 0.09], decorator: [257, 0.08] } },
  // JavaScript and CSS in the hue people know them by; SQL and the shell in a family no other language here uses.
  javascript: { name: 'JavaScript', note: 'its yellow: keywords in it, darkened to olive on a light page; strings in a quiet green', hues: { keyword: [98, 0.13], type: [72, 0.1], string: [140, 0.07], number: [60, 0.11], decorator: [98, 0.09] } },
  sql: { name: 'SQL', note: 'a plum of its own: keywords in it, types toward violet, strings in a quiet amber', hues: { keyword: [338, 0.12], type: [312, 0.09], string: [62, 0.08], number: [338, 0.08], decorator: [352, 0.08] } },
  shellscript: { name: 'Shell', note: 'a terminal green: keywords in it, strings in a quiet gold', hues: { keyword: [146, 0.14], type: [126, 0.09], string: [84, 0.09], number: [146, 0.09], decorator: [168, 0.08] } },
  css: { name: 'CSS', note: 'its purple: at-rules and keywords in it, numbers and units alongside', hues: { keyword: [302, 0.13], type: [322, 0.1], string: [150, 0.07], number: [302, 0.09], decorator: [276, 0.09] } },
};

/** Registry ids that take another language's palette. */
export const PALETTE_ALIASES: Readonly<Record<string, string>> = { tsx: 'typescript', jsx: 'javascript', scss: 'css' };

/** The palette a language id is coloured in, or null for the shared roles. */
export function paletteOf(lang: string): string | null {
  const id = PALETTE_ALIASES[lang] ?? lang;
  return id in LANG_PALETTES ? id : null;
}

/** Linguist's colours (github-linguist languages.yml), by the registry's language id. */
export const LINGUIST: Readonly<Record<string, string>> = {
  rust: '#dea584', python: '#3572a5', go: '#00add8', typescript: '#3178c6', tsx: '#3178c6', javascript: '#f1e05a', jsx: '#f1e05a',
  c: '#555555', cpp: '#f34b7d', csharp: '#178600', java: '#b07219', kotlin: '#a97bff', swift: '#f05138', ruby: '#701516', php: '#4f5d95',
  lua: '#000080', r: '#198ce7', elixir: '#6e4a7e', haskell: '#5e5086', vue: '#41b883', svelte: '#ff3e00', scss: '#c6538c', css: '#563d7c',
  html: '#e34c26', graphql: '#e10098', make: '#427819', zig: '#ec915c', powershell: '#012456', hcl: '#844fba', terraform: '#844fba',
  shellscript: '#89e051', json: '#292929', yaml: '#cb171e', toml: '#9c4221', markdown: '#083fa1', sql: '#e38c00', dart: '#00b4ab',
  scala: '#c22d40', perl: '#0298c3', clojure: '#db5855', ocaml: '#ef7a08', julia: '#a270ba', nix: '#7e7eff', docker: '#384d54',
  xml: '#0060ac', erlang: '#b83998', fsharp: '#b845fc', groovy: '#4298b8', objc: '#438eff', 'objective-c': '#438eff', nim: '#ffc200',
  crystal: '#000100', d: '#ba595e', fortran: '#4d41b1', elm: '#60b5cc', solidity: '#aa6746', astro: '#ff5a03', latex: '#3d6117', vb: '#945db7',
};

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

// ---- colour arithmetic ------------------------------------------------------------------------------------------------

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: Rgb): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

/** WCAG 2.2 contrast of two opaque colours, unrounded. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `top` over the opaque `under`. */
export function over(top: Rgba, under: Rgb): Rgb {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)) as unknown as Rgb;
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb;
}

export function rgbToHex(c: Rgb): string {
  return `#${c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')}`;
}

/** OKLCH to sRGB (0 to 255) and whether it is inside the gamut. */
export function oklchToRgb(L: number, C: number, h: number): { readonly rgb: Rgb; readonly inGamut: boolean } {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const inGamut = linear.every((x) => x >= -0.0005 && x <= 1.0005);
  const rgb = linear.map((x) => {
    const v = Math.min(1, Math.max(0, x));
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  });
  return { rgb: rgb as unknown as Rgb, inGamut };
}

/** sRGB (0 to 255) to OKLCH [L, C, h]. */
export function rgbToOklch(c: Rgb): readonly [number, number, number] {
  const [r, g, b] = c.map(lin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

const lowest = (c: Rgb, grounds: readonly Rgb[]): number => Math.min(...grounds.map((g) => contrastRatio(c, g)));
/** Whether text on `ground` is light text: the ground is nearer black than white. */
const darkGround = (ground: Rgb): boolean => contrastRatio(ground, [0, 0, 0]) < contrastRatio(ground, [255, 255, 255]);

export interface Solved {
  readonly hex: string;
  /** The lowest contrast against the grounds it was solved for, unrounded. */
  readonly ratio: number;
}

/**
 * Walks lightness from `L` away from the grounds, the chroma lowered to stay in gamut, until the colour reaches `floor`
 * against every ground; black or white when no colour of the hue does.
 */
function walk(L: number, C: number, h: number, grounds: readonly Rgb[], floor: number): Solved {
  const dark = darkGround(grounds[0]!);
  for (let k = 0; k < 120; k += 1) {
    let c = C;
    let x = oklchToRgb(L, c, h);
    while (!x.inGamut && c > 0) {
      c = Math.max(0, c - 0.005);
      x = oklchToRgb(L, c, h);
    }
    const hex = rgbToHex(x.rgb);
    const r = lowest(hexToRgb(hex)!, grounds);
    if (r >= floor) return { hex, ratio: r };
    L += dark ? 0.01 : -0.01;
    if (L > 1 || L < 0) break;
  }
  const end: Rgb = dark ? [255, 255, 255] : [0, 0, 0];
  return { hex: rgbToHex(end), ratio: lowest(end, grounds) };
}

/** A palette colour: the language's hue and chroma, lightness solved from the start (0.7 on dark grounds, 0.55 on light). */
export function solveText(hue: number, chroma: number, grounds: readonly Rgb[], floor: number): Solved {
  return walk(darkGround(grounds[0]!) ? 0.7 : 0.55, chroma, hue, grounds, floor);
}

/** An accent: the Linguist colour as it is when it already reaches `floor`, else its lightness walked until it does. */
export function solveAccent(hex: string, grounds: readonly Rgb[], floor = 3): Solved {
  const rgb = hexToRgb(hex) ?? [128, 128, 128];
  const r = lowest(rgb, grounds);
  if (r >= floor) return { hex: rgbToHex(rgb), ratio: r };
  const [L, C, h] = rgbToOklch(rgb);
  return walk(L, C, h, grounds, floor);
}

/** The hue at `L` with as much of `C` as the sRGB gamut holds, as the hex it is drawn in. */
export function fitHex(L: number, C: number, h: number): string {
  const l = Math.min(1, Math.max(0, L));
  let c = Math.max(0, C);
  if (!oklchToRgb(l, c, h).inGamut) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 14; i += 1) {
      const mid = (lo + hi) / 2;
      if (oklchToRgb(l, mid, h).inGamut) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  return rgbToHex(oklchToRgb(l, c, h).rgb);
}

/** One requirement on a colour: its contrast against `ground` holds `floor`. */
export type Floor = readonly [ground: Rgb, floor: number];

/**
 * The colour of the hue nearest the grounds in lightness that still holds every floor (the look engine's solve, lab pass
 * 25): lightness is bisected between the first ground's and the far end (white on a dark ground, black on a light one),
 * measured on the hex it is drawn in, so a rounded colour never lands under its floor. When no lightness of the hue holds
 * them all, the far end does as well as anything can.
 */
export function solveNearest(hue: number, chroma: number, floors: readonly Floor[], dark: boolean): Solved {
  const lowestOver = (hex: string): number => {
    const c = hexToRgb(hex)!;
    return Math.min(...floors.map(([g, f]) => contrastRatio(c, g) / f));
  };
  const L0 = rgbToOklch(floors[0]![0])[0];
  let lo = dark ? L0 : 0;
  let hi = dark ? 1 : L0;
  let best = fitHex(dark ? 1 : 0, chroma, hue);
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    const hex = fitHex(mid, chroma, hue);
    if (lowestOver(hex) >= 1) {
      best = hex;
      if (dark) hi = mid;
      else lo = mid;
    } else if (dark) lo = mid;
    else hi = mid;
  }
  if (lowestOver(best) < 1) {
    const end = dark ? '#ffffff' : '#000000';
    if (lowestOver(end) > lowestOver(best)) best = end;
  }
  const c = hexToRgb(best)!;
  return { hex: best, ratio: Math.min(...floors.map(([g]) => contrastRatio(c, g))) };
}

/** A language's palette on these grounds: a hex for each palette role. */
export function solvePalette(lang: string, grounds: readonly Rgb[], floor: number): Record<PaletteRole, Solved> | null {
  const id = paletteOf(lang);
  if (id === null) return null;
  const p = LANG_PALETTES[id]!;
  return Object.fromEntries(PALETTE_ROLES.map((role) => [role, solveText(p.hues[role][0], p.hues[role][1], grounds, floor)])) as Record<PaletteRole, Solved>;
}

// ---- grounds ----------------------------------------------------------------------------------------------------------

/** Resolves a colour custom property (`--marxy-color-bg`, `--marxy-frame-chrome`) to RGBA, or undefined when it is not set. */
export type ColourOf = (property: string) => Rgba | undefined;

const DIFFS = ['--marxy-color-diff-add', '--marxy-color-diff-del', '--marxy-color-diff-add-word', '--marxy-color-diff-del-word'];

/**
 * Every ground a code token sits on, opaque: the page and the code block, the selection and Source's active line over the
 * code block, and the diff tints over it (gate-contrast's `tok-*` row).
 */
export function tokenGrounds(colour: ColourOf): Rgb[] {
  const bg = colour('--marxy-color-bg');
  if (!bg) return [];
  const page = over(bg, [255, 255, 255]);
  const code = colour('--marxy-color-code-bg');
  const codeGround = code ? over(code, page) : page;
  const out: Rgb[] = [codeGround, page];
  const sel = colour('--marxy-color-selection');
  if (sel) out.push(over(sel, codeGround), over([sel[0], sel[1], sel[2], sel[3] * 0.6], codeGround));
  for (const d of DIFFS) {
    const c = colour(d);
    if (c) out.push(over(c, codeGround));
  }
  return out;
}

/** The grounds a language's name sits on: the page, a summoned surface, the code block, and the frame's chrome. */
export function accentGrounds(colour: ColourOf): Rgb[] {
  const bg = colour('--marxy-color-bg');
  if (!bg) return [];
  const page = over(bg, [255, 255, 255]);
  const out: Rgb[] = [page];
  for (const p of ['--marxy-color-surface', '--marxy-color-code-bg', '--marxy-frame-chrome', '--marxy-frame-chrome-2']) {
    const c = colour(p);
    if (c) out.push(over(c, page));
  }
  return out;
}

// ---- the stylesheet ---------------------------------------------------------------------------------------------------

/** The reader's colours for one language: role to hex. */
export type LangOverrides = Readonly<Record<string, Readonly<Partial<Record<SyntaxRole, string>>>>>;

export interface SyntaxCssInput {
  readonly tokenGrounds: readonly Rgb[];
  readonly accentGrounds: readonly Rgb[];
  /** 4.5, or 7 with more contrast or in the high-contrast theme. */
  readonly floor: number;
  /** Colour by language: the palettes and the reader's colours. Off, every language is in the shared roles. */
  readonly byLanguage: boolean;
  /** The language's accent on its name. */
  readonly accent: boolean;
  readonly overrides: LangOverrides;
  /**
   * A look is painting the panes: each palette colour is the pane's `--marxy-pl-<lang>-<role>` (solved by the look on that
   * pane's own grounds, scaled by its colour in code), with the colour solved here as the fallback.
   */
  readonly lookVars?: boolean;
}

const LANG_ID = /^[a-z0-9#+._-]{1,32}$/;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const attr = (lang: string): string => `[data-marxy-lang="${lang}"]`;

/**
 * The stylesheet colour by language comes to. A palette is under `:where()`, so a theme's own `[data-marxy-lang]` scope
 * outranks it; the reader's colours carry `:root` and the attribute twice, so they outrank a theme's scope; a role a
 * palette leaves alone inherits the shared role.
 */
export function syntaxCss(input: SyntaxCssInput): string {
  const out: string[] = [];
  if (input.byLanguage && input.tokenGrounds.length > 0) {
    for (const lang of [...Object.keys(LANG_PALETTES), ...Object.keys(PALETTE_ALIASES)]) {
      const solved = solvePalette(lang, input.tokenGrounds, input.floor)!;
      const id = paletteOf(lang)!;
      const decls = PALETTE_ROLES.map((r) => `--marxy-tok-${r}: ${input.lookVars ? `var(--marxy-pl-${id}-${r}, ${solved[r].hex})` : solved[r].hex};`);
      for (const [follower, role] of Object.entries(FOLLOWERS)) decls.push(`--marxy-tok-${follower}: var(--marxy-tok-${role});`);
      out.push(`:where(${attr(lang)}) { ${decls.join(' ')} }`);
    }
    for (const [lang, roles] of Object.entries(input.overrides)) {
      if (!LANG_ID.test(lang)) continue;
      const decls = Object.entries(roles)
        .filter(([role, hex]) => (SYNTAX_ROLES as readonly string[]).includes(role) && typeof hex === 'string' && HEX.test(hex))
        .map(([role, hex]) => `--marxy-tok-${role}: ${hex};`);
      if (decls.length > 0) out.push(`:root ${attr(lang)}${attr(lang)} { ${decls.join(' ')} }`);
    }
  }
  if (input.accent && input.accentGrounds.length > 0) {
    const floor = input.floor > 4.5 ? 4.5 : 3;
    for (const [lang, hex] of Object.entries(LINGUIST)) out.push(`:where(${attr(lang)}) { --marxy-lang: ${solveAccent(hex, input.accentGrounds, floor).hex}; }`);
    // Only with the accent on: unset, `--marxy-lang` would take these names' colour away rather than leave it.
    out.push('.marxy-fence-lang[data-marxy-lang], .marxy-fence-lang[data-marxy-lang] * { color: var(--marxy-lang); }');
    out.push('.marxy-guess[data-marxy-mine][data-marxy-lang] { color: var(--marxy-lang); }');
  }
  return out.join('\n');
}
