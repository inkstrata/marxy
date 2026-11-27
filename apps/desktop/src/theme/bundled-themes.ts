// The bundled themes by name. Each is one stylesheet in packages/theme/<dir>/theme.css, imported `?inline` through
// its own dynamic import, so a launch carries only the one `config.toml` names and nothing is fetched. Night and Paper's
// own sheet is the base every theme is laid over, in index.html already, so choosing it adds nothing. With no theme named
// the app wears Ink, whose sheet index.html also inlines for the first paint.
/// <reference types="vite/client" />

// In the Studio's shelf order (packages/theme/src/looks/index.ts); each sheet but Night and Paper's is written from its look.
export const BUNDLED_THEME_NAMES = ['ink', 'night-paper', 'midnight', 'black', 'ember', 'fjord', 'polar', 'warm', 'solarized', 'gruvbox', 'rose-pine', 'catppuccin', 'high-contrast'] as const;
export type BundledThemeName = (typeof BUNDLED_THEME_NAMES)[number];

/** The theme worn when config.toml names none (or names it as ""). */
export const DEFAULT_THEME: BundledThemeName = 'ink';

const LOADERS: Record<BundledThemeName, () => Promise<{ default: string }>> = {
  ink: () => import('../../../../packages/theme/ink/theme.css?inline'),
  polar: () => import('../../../../packages/theme/polar/theme.css?inline'),
  'night-paper': () => Promise.resolve({ default: '' }),
  midnight: () => import('../../../../packages/theme/midnight/theme.css?inline'),
  black: () => import('../../../../packages/theme/black/theme.css?inline'),
  ember: () => import('../../../../packages/theme/ember/theme.css?inline'),
  warm: () => import('../../../../packages/theme/warm/theme.css?inline'),
  fjord: () => import('../../../../packages/theme/fjord/theme.css?inline'),
  solarized: () => import('../../../../packages/theme/solarized/theme.css?inline'),
  gruvbox: () => import('../../../../packages/theme/gruvbox/theme.css?inline'),
  'rose-pine': () => import('../../../../packages/theme/rose-pine/theme.css?inline'),
  catppuccin: () => import('../../../../packages/theme/catppuccin/theme.css?inline'),
  'high-contrast': () => import('../../../../packages/theme/high-contrast/theme.css?inline'),
};

/** The bundled theme a `theme` setting names: a bare name, no `/`, that matches a bundled directory. Else null. */
export function bundledThemeName(raw: string | null | undefined): BundledThemeName | null {
  if (raw === null || raw === undefined) return null;
  const name = raw.trim();
  return (BUNDLED_THEME_NAMES as readonly string[]).includes(name) ? (name as BundledThemeName) : null;
}

/** The bundled theme a `theme` setting means: unset or empty is the default, a bundled name itself; null is a theme folder. */
export function themeMeant(raw: string | null | undefined): BundledThemeName | null {
  if (raw === null || raw === undefined || raw.trim() === '') return DEFAULT_THEME;
  return bundledThemeName(raw);
}

/** The stylesheet of a bundled theme. */
export async function bundledThemeCss(name: BundledThemeName): Promise<string> {
  return (await LOADERS[name]()).default;
}
