// The look that stands for the theme config.toml names: every bundled theme is a look too,
// so while the theme paints the page the Studio and the look at hand show that look as the one in use, and a first change
// starts from it rather than from another look.
import { LOOKS } from '@marxy/theme';
import { currentThemeName } from '../theme/user-theme.ts';
import { looksOn } from './store.ts';

/** The theme's own look while the theme paints the page; null while the looks do, or for a theme folder. */
export function themeLookId(): string | null {
  if (looksOn()) return null;
  const name = currentThemeName() ?? 'ink';
  return name === 'folder' ? null : (LOOKS.find((l) => l.theme === name)?.id ?? null);
}
