// Applying a theme and a variant (docs/design/05-theme.md §Loader). Reading a theme directory from
// disk, rewriting its URLs and clamping its values is MARXY-47; this is the half the default theme
// needs now, and the same two calls a user theme will go through.

export type Variant = 'light' | 'dark';

const THEME_ID = 'marxy-theme';

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
