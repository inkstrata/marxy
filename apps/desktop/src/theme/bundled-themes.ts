// The bundled themes by name (H-05). Each is one stylesheet in packages/theme/<dir>/theme.css, imported `?inline` through
// its own dynamic import, so a launch carries only the one `config.toml` names and nothing is fetched. Night and Paper,
// the default theme, are in index.html already and are not listed here.
/// <reference types="vite/client" />

export const BUNDLED_THEME_NAMES = ['ink', 'warm', 'fjord', 'high-contrast'] as const;
export type BundledThemeName = (typeof BUNDLED_THEME_NAMES)[number];

const LOADERS: Record<BundledThemeName, () => Promise<{ default: string }>> = {
  ink: () => import('../../../../packages/theme/ink/theme.css?inline'),
  warm: () => import('../../../../packages/theme/warm/theme.css?inline'),
  fjord: () => import('../../../../packages/theme/fjord/theme.css?inline'),
  'high-contrast': () => import('../../../../packages/theme/high-contrast/theme.css?inline'),
};

/** The bundled theme a `theme` setting names: a bare name, no `/`, that matches a bundled directory. Else null. */
export function bundledThemeName(raw: string | null | undefined): BundledThemeName | null {
  if (raw === null || raw === undefined) return null;
  const name = raw.trim();
  return (BUNDLED_THEME_NAMES as readonly string[]).includes(name) ? (name as BundledThemeName) : null;
}

/** The stylesheet of a bundled theme. */
export async function bundledThemeCss(name: BundledThemeName): Promise<string> {
  return (await LOADERS[name]()).default;
}
