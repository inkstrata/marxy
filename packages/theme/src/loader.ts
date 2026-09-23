// Applying a theme and a variant (docs/design/05-theme.md §Loader). User theme loading is MARXY-47.

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

function clampCssLength(
  css: string,
  prop: string,
  min: string,
  max: string,
  warnings: string[],
): string {
  const re = new RegExp(`(${escapeRegExp(prop)}\\s*:\\s*)([^;\\n]+)`, 'g');
  return css.replace(re, (_full, prefix: string, value: string) => {
    const ch = parseCh(value);
    const px = parsePx(value);
    if (ch !== null) {
      const minCh = parseCh(min)!;
      const maxCh = parseCh(max)!;
      if (ch < minCh || ch > maxCh) {
        const clamped = Math.min(maxCh, Math.max(minCh, ch));
        warnings.push(`${prop} was ${value.trim()}; clamped to ${clamped}ch`);
        return `${prefix}${clamped}ch`;
      }
    } else if (px !== null) {
      const minPx = parsePx(min)!;
      const maxPx = parsePx(max)!;
      if (px < minPx || px > maxPx) {
        const clamped = Math.min(maxPx, Math.max(minPx, px));
        warnings.push(`${prop} was ${value.trim()}; clamped to ${clamped}px`);
        return `${prefix}${clamped}px`;
      }
    }
    return `${prefix}${value}`;
  });
}

function clampCssNumber(css: string, prop: string, min: number, max: number, warnings: string[]): string {
  const re = new RegExp(`(${escapeRegExp(prop)}\\s*:\\s*)([^;\\n]+)`, 'g');
  return css.replace(re, (_full, prefix: string, value: string) => {
    const n = Number(value.trim());
    if (!Number.isFinite(n) || (n >= min && n <= max)) return `${prefix}${value}`;
    const clamped = Math.min(max, Math.max(min, n));
    warnings.push(`${prop} was ${value.trim()}; clamped to ${clamped}`);
    return `${prefix}${clamped}`;
  });
}

function parseCh(value: string): number | null {
  const m = /(-?\d+(?:\.\d+)?)\s*ch\b/i.exec(value.trim());
  return m ? Number(m[1]) : null;
}

function parsePx(value: string): number | null {
  const m = /(-?\d+(?:\.\d+)?)\s*px\b/i.exec(value.trim());
  return m ? Number(m[1]) : null;
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
