// Applying a theme and a variant, and loading a user theme (docs/design/05-theme.md §Loader).

import { parse } from 'smol-toml';
import { rewriteUrls } from './css-urls.ts';

export type Variant = 'light' | 'dark';
export type VariantPreference = Variant | 'auto';

const THEME_ID = 'marxy-theme';
const SPOKEN_CONTRACT = 2;

const sheetById = new WeakMap<Document, Map<string, CSSStyleSheet>>();

/** Applies runtime CSS through constructable stylesheets so a release style nonce cannot block it. */
export function adoptRuntimeSheet(doc: Document, id: string, css: string): void {
  let perDoc = sheetById.get(doc);
  if (perDoc === undefined) {
    perDoc = new Map();
    sheetById.set(doc, perDoc);
  }
  let sheet = perDoc.get(id);
  if (sheet === undefined && 'adoptedStyleSheets' in doc) {
    sheet = new CSSStyleSheet();
    perDoc.set(id, sheet);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  }
  if (sheet !== undefined) sheet.replaceSync(css);
  let marker = doc.getElementById(id);
  if (marker === null) {
    marker = doc.createElement('template');
    marker.id = id;
    if (typeof doc.head.append === 'function') doc.head.append(marker);
    else doc.head.appendChild(marker);
  }
  marker.textContent = css;
}

export interface ThemeManifest {
  readonly name: string;
  readonly author?: string;
  readonly contract: number;
  readonly variants: readonly Variant[];
}

/** Maps `config.variant` to the palette block the default theme applies (docs/design/05-theme.md §Loader). */
export function resolveVariantPreference(preference: VariantPreference, prefersDark: boolean): Variant {
  if (preference === 'auto') return prefersDark ? 'dark' : 'light';
  return preference;
}

/** Replaces the user theme's stylesheet, injected after the built-in ones so it wins ties. */
export function applyTheme(css: string, doc: Document = document): void {
  adoptRuntimeSheet(doc, THEME_ID, css);
}

/** Sets `html[data-marxy-variant]`; the default theme's light block keys on it, dark is the default (ADR-0024). */
export function applyVariant(variant: Variant, doc: Document = document): void {
  doc.documentElement.setAttribute('data-marxy-variant', variant);
}

// A declaration's value ends at `;`, `}` or a line end: `[^;\n]+` ran on through a closing `}` and
// the clamp then wrote the rule back without it, leaving it open to swallow the rest of the sheet.
const declaration = (prop: string) => new RegExp(`(${escapeRegExp(prop)}(?:\\s|/\\*[\\s\\S]*?\\*/)*:\\s*)([^;}\\n]+)`, 'g');
const IMPORTANT = /\s*!\s*important\s*$/i;
// rem and em are resolved against the 16px root a theme cannot change.
const PX_PER = { px: 1, rem: 16, em: 16 } as const;

function clampCssLength(
  css: string,
  prop: string,
  min: string,
  max: string,
  warnings: string[],
): string {
  return css.replace(declaration(prop), (full, prefix: string, raw: string) => {
    const important = IMPORTANT.exec(raw)?.[0] ?? '';
    const value = raw.slice(0, raw.length - important.length).trim();
    const plain = /^(-?\d+(?:\.\d+)?)(ch|px|rem|em)$/i.exec(value);
    if (!plain) {
      // calc(), var() and the rest cannot be range-checked here, and guessing from their first
      // number (calc(2px * 400) read as 2px) is worse than leaving the default theme's value.
      warnings.push(`${prop} was ${value}; not a plain length, so the default is kept`);
      return '';
    }
    const n = Number(plain[1]);
    const unit = plain[2]!.toLowerCase();
    const boundsAreCh = min.endsWith('ch');
    if ((unit === 'ch') !== boundsAreCh) {
      // `ch` is font-metric-dependent, so a value in `ch` can't be range-checked against a px
      // bound (or a px-family value against a `ch` bound) without measuring — same as calc()/var().
      warnings.push(`${prop} was ${value}; ${boundsAreCh ? 'ch' : 'px'} units required, so the default is kept`);
      return '';
    }
    if (unit === 'ch') {
      const minCh = parseFloat(min);
      const maxCh = parseFloat(max);
      if (n >= minCh && n <= maxCh) return full;
      const clamped = Math.min(maxCh, Math.max(minCh, n));
      warnings.push(`${prop} was ${value}; clamped to ${clamped}ch`);
      return `${prefix}${clamped}ch${important}`;
    }
    const px = n * PX_PER[unit as keyof typeof PX_PER];
    const minPx = parseFloat(min);
    const maxPx = parseFloat(max);
    if (px >= minPx && px <= maxPx) return full;
    const clamped = Math.min(maxPx, Math.max(minPx, px));
    warnings.push(`${prop} was ${value}; clamped to ${clamped}px`);
    return `${prefix}${clamped}px${important}`;
  });
}

function clampCssNumber(css: string, prop: string, min: number, max: number, warnings: string[]): string {
  return css.replace(declaration(prop), (full, prefix: string, raw: string) => {
    const important = IMPORTANT.exec(raw)?.[0] ?? '';
    const value = raw.slice(0, raw.length - important.length).trim();
    const n = Number(value);
    if (!Number.isFinite(n) || value === '') {
      warnings.push(`${prop} was ${value}; not a number, so the default is kept`);
      return '';
    }
    if (n >= min && n <= max) return full;
    const clamped = Math.min(max, Math.max(min, n));
    warnings.push(`${prop} was ${value}; clamped to ${clamped}`);
    return `${prefix}${clamped}${important}`;
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ADR-0059 item 7: what a theme may set where. Names are the contract's; values are never checked here
// beyond the clamps below.

/** Names a theme sets on `:root` and the variant only: a summoned surface, the chrome and the dividers are one object whatever the kind. */
const GLOBAL_ONLY = [
  '--marxy-color-surface',
  '--marxy-color-surface-glass',
  '--marxy-shadow-surface',
  '--marxy-face-chrome',
  '--marxy-size-chrome',
  '--marxy-color-divider',
  '--marxy-color-divider-focus',
  '--marxy-divider-hit',
  '--marxy-progress-rule',
  '--marxy-typeset',
] as const;

/** Names Marxy computes or owns: a theme setting one anywhere is dropped (item 7 "Never set by a theme", item 8). */
const NEVER_THEME = [
  '--marxy-weight-offset',
  '--marxy-lang',
  '--marxy-root-size-body',
  '--marxy-root-size-code',
  '--marxy-root-size-caption',
  '--marxy-root-line-box',
  '--marxy-root-line-box-code',
  '--marxy-root-lh-h1',
  '--marxy-root-lh-h2',
] as const;

interface KindSize {
  /** The system-owned root copy the ratio multiplies (declared in tokens.css). */
  readonly root: string;
  /** The ratio range: the `:root` clamp over the default value where there is one (13–28 px of 20, 20–48 px of 30), else 0.5–2. */
  readonly min: number;
  readonly max: number;
  /** A line box is rounded to an even whole pixel once multiplied (ADR-0030). */
  readonly even?: boolean;
}

/** Tokens a kind scope may set only as a multiple of the reader's value (item 7, "The reader's size wins"). */
const KIND_SIZES: Readonly<Record<string, KindSize>> = {
  '--marxy-size-body': { root: '--marxy-root-size-body', min: 13 / 20, max: 28 / 20 },
  '--marxy-size-code': { root: '--marxy-root-size-code', min: 0.5, max: 2 },
  '--marxy-size-caption': { root: '--marxy-root-size-caption', min: 0.5, max: 2 },
  '--marxy-line-box': { root: '--marxy-root-line-box', min: 20 / 30, max: 48 / 30, even: true },
  '--marxy-line-box-code': { root: '--marxy-root-line-box-code', min: 0.5, max: 2, even: true },
  '--marxy-lh-h1': { root: '--marxy-root-lh-h1', min: 0.5, max: 2 },
  '--marxy-lh-h2': { root: '--marxy-root-lh-h2', min: 0.5, max: 2 },
};

const SLOTS = ['--marxy-font-text', '--marxy-font-heading', '--marxy-font-mono'] as const;

/** The contract-2 colour roles a complete theme sets in every variant (ADR-0059 item 3). */
export const V2_COLOUR_ROLES = [
  '--marxy-color-surface',
  '--marxy-color-surface-glass',
  '--marxy-color-text-strong',
  '--marxy-color-text-faint',
  '--marxy-color-rule-strong',
  '--marxy-color-edge',
  '--marxy-color-accent-strong',
  '--marxy-color-accent-fg',
  '--marxy-color-accent-wash',
  '--marxy-color-status-ok',
  '--marxy-color-status-warn',
  '--marxy-color-status-err',
  '--marxy-color-status-info',
  '--marxy-color-status-ok-wash',
  '--marxy-color-status-warn-wash',
  '--marxy-color-status-err-wash',
  '--marxy-tok-marker',
  '--marxy-tok-heading',
  '--marxy-tok-link',
] as const;

interface Rule {
  readonly selector: string;
  /** Offsets of the body, between the braces. */
  readonly from: number;
  readonly to: number;
}

/** Every `selector { body }` in `css`, at any depth, skipping comments and strings. At-rules appear with their `@` selector. */
function findRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const stack: { selector: string; from: number }[] = [];
  let segment = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!;
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e < 0 ? css.length : e + 1;
    } else if (c === '"' || c === "'") {
      for (i++; i < css.length && css[i] !== c; i++) if (css[i] === '\\') i++;
    } else if (c === '(' && /url$/i.test(css.slice(Math.max(0, i - 3), i)) && !/^\s*["']/.test(css.slice(i + 1, i + 3))) {
      const e = css.indexOf(')', i);
      i = e < 0 ? css.length : e;
    } else if (c === '{') {
      stack.push({ selector: css.slice(segment, i).replace(/\/\*[\s\S]*?\*\//g, '').trim(), from: i + 1 });
      segment = i + 1;
    } else if (c === '}') {
      const open = stack.pop();
      if (open) rules.push({ selector: open.selector, from: open.from, to: i });
      segment = i + 1;
    } else if (c === ';') {
      segment = i + 1;
    }
  }
  return rules;
}

function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]!;
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(selector.slice(last, i).trim());
      last = i + 1;
    }
  }
  parts.push(selector.slice(last).trim());
  return parts;
}

const GLOBAL_SCOPE = /^(?::root|html)(?:\[data-marxy-variant\s*=\s*["']?(light|dark)["']?\])?$/i;
const KIND_ATTR = /\[data-marxy-kind(?:\s*=\s*["']?([^"'\]\s]+)["']?)?\s*\]/i;

/** The kind a selector scopes to (`*` for any), or null when it is not a kind scope. */
function kindScopeOf(selector: string): string | null {
  for (const part of splitSelectorList(selector)) {
    const m = KIND_ATTR.exec(part);
    if (m) return m[1] ?? '*';
  }
  return null;
}

/** The variant a global scope (`:root`, `html`, with an optional variant) sets, or null when the selector is not one. `''` is every variant. */
function globalScopeVariant(selector: string): string | null {
  let variant: string | null = null;
  for (const part of splitSelectorList(selector)) {
    const m = GLOBAL_SCOPE.exec(part);
    if (!m) return null;
    variant = (m[1] ?? '').toLowerCase();
  }
  return variant;
}

const sets = (body: string, prop: string): boolean => declaration(prop).test(body);

function dropDeclaration(css: string, prop: string, warnings: string[], why: string): string {
  return css.replace(declaration(prop), (_full, _prefix: string, raw: string) => {
    warnings.push(`${prop} was ${raw.trim()}; ${why}, so it is dropped`);
    return '';
  });
}

/** A kind scope's body under ADR-0059 item 7: global-only and system-owned names dropped, sizes compiled from a ratio, the measure clamped. */
function clampKindBody(body: string, kind: string, warnings: string[]): string {
  const where = kind === '*' ? 'a kind scope' : `kind '${kind}'`;
  let out = body;
  for (const prop of GLOBAL_ONLY) out = dropDeclaration(out, prop, warnings, `it is global-only and cannot be set in ${where}`);
  for (const prop of ['--marxy-measure', ...NEVER_THEME]) {
    out = dropDeclaration(out, prop, warnings, `Marxy computes it and a theme cannot set it in ${where}`);
  }
  out = clampCssNumber(out, '--marxy-measure-chars', 45, 80, warnings);
  for (const [prop, size] of Object.entries(KIND_SIZES)) {
    out = out.replace(declaration(prop), (_full, prefix: string, raw: string) => {
      const important = IMPORTANT.exec(raw)?.[0] ?? '';
      const value = raw.slice(0, raw.length - important.length).trim();
      const ratio = /^(\d*\.?\d+)(em)?$/i.exec(value);
      if (!ratio) {
        warnings.push(
          `${prop} was ${value} in ${where}; a size there must be a multiple of the reader's size (a ratio such as 0.85, or the same in em), so it is dropped`,
        );
        return '';
      }
      const n = Number(ratio[1]);
      const clamped = Math.min(size.max, Math.max(size.min, n));
      if (clamped !== n) warnings.push(`${prop} was ${value} in ${where}; clamped to ${Number(clamped.toFixed(4))}`);
      const product = `calc(${Number(clamped.toFixed(4))} * var(${size.root}))`;
      return `${prefix}${size.even ? `round(${product}, 2px)` : product}${important}`;
    });
  }
  return out;
}

function clampThemeValues(css: string, warnings: string[]): string {
  // Kind scopes are clamped on their own terms; mask their bodies so the `:root` clamps below do not
  // read the compiled calc() as a value they cannot check.
  const masked: string[] = [];
  let out = css;
  let reach = css.length;
  const kinds = findRules(css)
    .filter((r) => !r.selector.startsWith('@') && kindScopeOf(r.selector) !== null)
    .sort((a, b) => b.from - a.from);
  for (const rule of kinds) {
    if (rule.to > reach) continue; // inside a scope already masked
    reach = rule.from;
    const body = clampKindBody(css.slice(rule.from, rule.to), kindScopeOf(rule.selector)!, warnings);
    out = `${out.slice(0, rule.from)}/*__marxy_kind_${masked.length}__*/${out.slice(rule.to)}`;
    masked.push(body);
  }

  // The measure is counted in average characters (ADR-0033); base.css clamps the drawn column to
  // 45–80 of them whatever a theme writes, and a legacy ch value is still held to its old range.
  out = clampCssNumber(out, '--marxy-measure-chars', 45, 80, warnings);
  out = clampCssLength(out, '--marxy-measure', '45ch', '90ch', warnings);
  out = clampCssLength(out, '--marxy-line-box', '20px', '48px', warnings);
  out = clampCssLength(out, '--marxy-size-body', '13px', '28px', warnings);
  // The theme's chrome size is a default the reader's setting overrides; it holds the same 11–26 px (ADR-0059 item 6).
  out = clampCssLength(out, '--marxy-size-chrome', '11px', '26px', warnings);
  for (const prop of NEVER_THEME) out = dropDeclaration(out, prop, warnings, 'Marxy owns it and a theme cannot set it');
  return out.replace(/\/\*__marxy_kind_(\d+)__\*\//g, (_m, i: string) => masked[Number(i)]!);
}

/** A slot pointed at a face role on `:root` with the role unset there refers back to itself: a theme error (item 7). */
function slotCycles(css: string): string[] {
  const globals = findRules(css).filter((r) => !r.selector.startsWith('@') && globalScopeVariant(r.selector) !== null);
  const bodies = globals.map((r) => css.slice(r.from, r.to));
  const found: string[] = [];
  for (const slot of SLOTS) {
    for (const body of bodies) {
      const m = new RegExp(`${escapeRegExp(slot)}\\s*:\\s*var\\(\\s*(--marxy-face-[a-z0-9-]+)\\s*\\)`).exec(body);
      if (m && !bodies.some((b) => sets(b, m[1]!))) found.push(`${slot}: var(${m[1]}) on :root while ${m[1]} is not set there`);
    }
  }
  return found;
}

/** The v2 colour roles a theme leaves unset in `variant`: dark on `:root`, light under the light variant, `:root` serving both. */
function unsetRoles(css: string, variant: Variant): string[] {
  const bodies = findRules(css)
    .filter((r) => !r.selector.startsWith('@'))
    .filter((r) => {
      const v = globalScopeVariant(r.selector);
      return v === '' || v === variant;
    })
    .map((r) => css.slice(r.from, r.to));
  return V2_COLOUR_ROLES.filter((role) => !bodies.some((b) => sets(b, role)));
}

/** Loads theme.toml and theme.css from a directory reader, rewriting urls and clamping token values. */
export async function loadTheme(
  themeDir: string,
  read: (rel: string) => Promise<Uint8Array>,
  assetUrl: (absPath: string) => string,
): Promise<{ manifest: ThemeManifest; css: string; warnings: string[] }> {
  const warnings: string[] = [];
  let declaredContract: number | null = null;
  let manifest: ThemeManifest = { name: 'theme', contract: SPOKEN_CONTRACT, variants: ['dark', 'light'] };

  try {
    const tomlBytes = await read('theme.toml');
    const parsed = parse(new TextDecoder().decode(tomlBytes)) as Record<string, unknown>;
    const name = typeof parsed.name === 'string' ? parsed.name : 'theme';
    const author = typeof parsed.author === 'string' ? parsed.author : undefined;
    const contract = typeof parsed.contract === 'number' ? parsed.contract : SPOKEN_CONTRACT;
    if (contract === 1) {
      warnings.push(`Theme '${name}' targets contract 1; its contract-2 roles use their fallbacks.`);
    } else if (contract !== SPOKEN_CONTRACT) {
      warnings.push(`Theme '${name}' targets contract ${contract}; marxy speaks ${SPOKEN_CONTRACT}. It may not look as intended.`);
    }
    declaredContract = typeof parsed.contract === 'number' ? parsed.contract : null;
    const variantsRaw = parsed.variants;
    let variants: Variant[] = ['dark', 'light'];
    if (Array.isArray(variantsRaw)) {
      if (variantsRaw.length === 0) {
        warnings.push(`Theme '${name}' declares no variants in theme.toml; using defaults`);
      } else if (variantsRaw.every((v) => v === 'light' || v === 'dark')) {
        variants = variantsRaw as Variant[];
      }
    }
    manifest = { name, author, contract, variants };
  } catch {
    warnings.push('theme.toml could not be read; using defaults');
  }

  let cssText: string;
  try {
    const cssBytes = await read('theme.css');
    cssText = new TextDecoder().decode(cssBytes);
  } catch {
    throw new Error('theme.css not found');
  }

  const { css: rewritten, warnings: urlWarnings } = rewriteUrls(cssText, {
    base: themeDir,
    assetUrl,
  });
  warnings.push(...urlWarnings);
  if (declaredContract === SPOKEN_CONTRACT) {
    for (const variant of manifest.variants) {
      const unset = unsetRoles(rewritten, variant);
      if (unset.length > 0) {
        warnings.push(`Theme '${manifest.name}' leaves ${unset.length} contract-2 colour role${unset.length === 1 ? '' : 's'} unset in the ${variant} variant (${unset.join(', ')}); the fallbacks are used.`);
      }
    }
  }
  const cycles = slotCycles(rewritten);
  if (cycles.length > 0) throw new Error(`Theme '${manifest.name}' has a font slot that refers back to itself (${cycles.join('; ')}); set the face role on :root too.`);
  const css = clampThemeValues(rewritten, warnings);
  return { manifest, css, warnings };
}
