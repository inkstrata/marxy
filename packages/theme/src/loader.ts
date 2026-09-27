// Applying a theme and a variant, and loading a user theme (docs/design/05-theme.md §Loader).

import { parse } from 'smol-toml';
import { rewriteUrls } from './css-urls.ts';

export type Variant = 'light' | 'dark';
export type VariantPreference = Variant | 'auto';

const THEME_ID = 'marxy-theme';
const SPOKEN_CONTRACT = 1;

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
  let style = doc.getElementById(THEME_ID);
  if (!(style instanceof HTMLStyleElement)) {
    style?.remove();
    style = doc.createElement('style');
    style.id = THEME_ID;
    doc.head.append(style);
  }
  style.textContent = css;
}

/** Sets `html[data-marxy-variant]`; the default theme's light block keys on it, dark is the default (ADR-0024). */
export function applyVariant(variant: Variant, doc: Document = document): void {
  doc.documentElement.setAttribute('data-marxy-variant', variant);
}

// A declaration's value ends at `;`, `}` or a line end: `[^;\n]+` ran on through a closing `}` and
// the clamp then wrote the rule back without it, leaving it open to swallow the rest of the sheet.
const declaration = (prop: string) => new RegExp(`(${escapeRegExp(prop)}\\s*:\\s*)([^;}\\n]+)`, 'g');
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
    if (unit === 'ch') {
      const minCh = parseFloat(min);
      const maxCh = parseFloat(max);
      if (!min.endsWith('ch') || (n >= minCh && n <= maxCh)) return full;
      const clamped = Math.min(maxCh, Math.max(minCh, n));
      warnings.push(`${prop} was ${value}; clamped to ${clamped}ch`);
      return `${prefix}${clamped}ch${important}`;
    }
    if (!min.endsWith('px')) return full;
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

function clampThemeValues(css: string, warnings: string[]): string {
  let out = css;
  // The measure is counted in average characters (ADR-0033); base.css clamps the drawn column to
  // 45–80 of them whatever a theme writes, and a legacy ch value is still held to its old range.
  out = clampCssNumber(out, '--marxy-measure-chars', 45, 80, warnings);
  out = clampCssLength(out, '--marxy-measure', '45ch', '90ch', warnings);
  out = clampCssLength(out, '--marxy-line-box', '20px', '48px', warnings);
  out = clampCssLength(out, '--marxy-size-body', '13px', '28px', warnings);
  return out;
}

/** Loads theme.toml and theme.css from a directory reader, rewriting urls and clamping token values. */
export async function loadTheme(
  themeDir: string,
  read: (rel: string) => Promise<Uint8Array>,
  assetUrl: (absPath: string) => string,
): Promise<{ manifest: ThemeManifest; css: string; warnings: string[] }> {
  const warnings: string[] = [];
  let manifest: ThemeManifest = { name: 'theme', contract: SPOKEN_CONTRACT, variants: ['dark', 'light'] };

  try {
    const tomlBytes = await read('theme.toml');
    const parsed = parse(new TextDecoder().decode(tomlBytes)) as Record<string, unknown>;
    const name = typeof parsed.name === 'string' ? parsed.name : 'theme';
    const author = typeof parsed.author === 'string' ? parsed.author : undefined;
    const contract = typeof parsed.contract === 'number' ? parsed.contract : SPOKEN_CONTRACT;
    if (contract !== SPOKEN_CONTRACT) {
      warnings.push(`Theme '${name}' targets contract ${contract}; marxy speaks ${SPOKEN_CONTRACT}. It may not look as intended.`);
    }
    const variantsRaw = parsed.variants;
    const variants: Variant[] =
      Array.isArray(variantsRaw) && variantsRaw.every((v) => v === 'light' || v === 'dark')
        ? (variantsRaw as Variant[])
        : ['dark', 'light'];
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
  const css = clampThemeValues(rewritten, warnings);
  return { manifest, css, warnings };
}
