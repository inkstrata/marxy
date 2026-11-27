// Colour by language on the page: the palettes solved against the grounds of the look in force, the
// reader's `[syntax.<lang>]` colours over them, and each language's accent, as one runtime sheet. Solved again whenever
// the look changes (the variant, more contrast, a theme sheet applied or replaced), so a palette is always measured on
// the grounds it is read on. Colour is by CSS on the `data-marxy-lang` scopes the page already carries; the runs the
// highlighter hands the page are not touched.
import { accentGrounds, oklchToRgb, syntaxCss, tokenGrounds, type Rgb, type Rgba, type SyntaxConfig } from '@marxy/theme';
import { currentThemeName } from './user-theme.ts';

const DEFAULT: SyntaxConfig = { byLanguage: true, accent: true, langs: {} };

let syntax: SyntaxConfig = DEFAULT;
let watching: Document | null = null;
let probe: HTMLElement | null = null;
let queued = false;
let sheet: CSSStyleSheet | null = null;
let sheetText = '';
let solvedFor = '';
let lookVars = false;

/** The colour-by-language stylesheet now on the page, for a test to read. */
export function langSheetText(): string {
  return sheetText;
}

/** The `[syntax]` config now in force. */
export function currentSyntax(): SyntaxConfig {
  return syntax;
}

/** A computed colour as RGBA: `rgb()`, `rgba()`, `color(srgb ...)` and `oklch()`, the forms WebKit and WebView2 compute to. */
export function parseComputed(value: string): Rgba | undefined {
  const v = value.trim();
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), alpha(m[4])];
  m = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, alpha(m[4])];
  m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const L = m[1]!.endsWith('%') ? parseFloat(m[1]!) / 100 : Number(m[1]);
    return [...oklchToRgb(L, Number(m[2]), Number(m[3])).rgb, alpha(m[4])] as Rgba;
  }
  return undefined;
}

const alpha = (a: string | undefined): number => (a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : Number(a));

/** A custom property's colour as the page resolves it, read off a hidden probe; a transparent one counts as unset. */
function colourOf(doc: Document): (property: string) => Rgba | undefined {
  if (probe === null || !probe.isConnected) {
    probe = doc.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.display = 'none';
    doc.documentElement.append(probe);
  }
  const p = probe;
  return (property) => {
    p.style.backgroundColor = `var(${property}, transparent)`;
    const c = parseComputed(getComputedStyle(p).backgroundColor);
    return c === undefined || c[3] === 0 ? undefined : c;
  };
}

/** The grounds code sits on in the look in force, and the floor its colours are held to there. */
export function groundsNow(doc: Document = document): { readonly tokens: Rgb[]; readonly accent: Rgb[]; readonly floor: number } {
  const colour = colourOf(doc);
  const high = doc.documentElement.getAttribute('data-marxy-contrast') === 'more' || currentThemeName() === 'high-contrast';
  return { tokens: tokenGrounds(colour), accent: accentGrounds(colour), floor: high ? 7 : 4.5 };
}

/** The colour a role is drawn in for a language on the page now (its palette, the reader's, a theme's scope or the shared role). */
export function drawnColour(lang: string, role: string, doc: Document = document): Rgb | undefined {
  const span = doc.createElement('span');
  span.dataset.marxyLang = lang;
  span.className = `marxy-tok-${role}`;
  span.style.display = 'none';
  doc.documentElement.append(span);
  const c = parseComputed(getComputedStyle(span).color);
  span.remove();
  return c === undefined ? undefined : [c[0], c[1], c[2]];
}

/** Solves the palettes and accents for the look in force and puts them on the page. */
export function paintLangColour(doc: Document = document): void {
  queued = false;
  const now = groundsNow(doc);
  // The head changes for much besides a theme (each editor's styles): solve again only when the grounds or the config did.
  const key = JSON.stringify([now, syntax, lookVars]);
  if (key === solvedFor && sheet !== null) return;
  solvedFor = key;
  const css = syntaxCss({
    tokenGrounds: now.tokens,
    accentGrounds: now.accent,
    floor: now.floor,
    byLanguage: syntax.byLanguage,
    accent: syntax.accent,
    overrides: syntax.langs,
    lookVars,
  });
  if (css === sheetText && sheet !== null) return;
  sheetText = css;
  // A sheet of its own, with no marker in the head: the head's changes are what tell a theme was applied (here and in
  // the launch's own first-paint check), and this sheet is not a theme.
  if (sheet === null) {
    sheet = new CSSStyleSheet();
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(css);
}

function queue(doc: Document): void {
  if (queued) return;
  queued = true;
  // Once for a burst of changes, and before anything reads or paints the new look.
  queueMicrotask(() => paintLangColour(doc));
}

function watch(doc: Document): void {
  if (watching === doc) return;
  watching = doc;
  const observer = new MutationObserver(() => queue(doc));
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-marxy-variant', 'data-marxy-contrast'] });
  // A theme sheet applied or replaced: `adoptRuntimeSheet` keeps a marker of each in the head, and the default theme is a style there.
  observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
}

/** A look paints the panes (look/paint.ts): each palette colour is the pane's own, with the one solved here beneath it. */
export function setLookVars(on: boolean, doc: Document = document): void {
  if (lookVars === on) return;
  lookVars = on;
  paintLangColour(doc);
}

/** Takes config.toml's `[syntax]` and colours the page by it, now and whenever the look changes. */
export function applySyntaxConfig(cfg: SyntaxConfig, doc: Document = document): void {
  syntax = cfg;
  watch(doc);
  paintLangColour(doc);
}
