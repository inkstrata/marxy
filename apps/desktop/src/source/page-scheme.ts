// Whether the page is light, for the parts of Source that a stylesheet cannot carry (CodeMirror's base theme).

/**
 * Whether the page is light: the root's `color-scheme` when it says (a dark-only theme such as Fjord stays dark under
 * the light variant, H-05), else the variant (ADR-0024; dark is the default).
 */
export function isLightVariant(): boolean {
  if (typeof document === 'undefined') return false;
  const scheme = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).colorScheme : '';
  if (scheme === 'light' || scheme === 'dark') return scheme === 'light';
  return document.documentElement.getAttribute('data-marxy-variant') === 'light';
}
