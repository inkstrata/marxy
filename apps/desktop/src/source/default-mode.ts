// Per-file-type default view mode on open (docs/design/09-app-shell.md §Source mode).

const RENDERED_EXT = new Set(['.md', '.markdown', '.mdx', '.txt']);

/** Lowercase extension including the dot, or '' when there is none. */
export function extensionOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

/** Default mode when a file is opened (before the reader toggles). */
export function defaultModeForPath(path: string): 'rendered' | 'source' {
  const ext = extensionOf(path);
  return RENDERED_EXT.has(ext) ? 'rendered' : 'source';
}

/**
 * When a `theme.css` sits beside a `theme.toml`, open in Source and offer to apply the theme.
 * The caller supplies whether `theme.toml` exists in the same directory.
 */
export function themeCssOpenNotice(path: string, siblingHasThemeToml: boolean): string | null {
  if (!siblingHasThemeToml) return null;
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  if (base !== 'theme.css') return null;
  return 'This file styles a marxy theme. Switch to Rendered after editing, or use “apply this theme” from the notice.';
}
