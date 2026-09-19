// The default theme as one stylesheet: tokens, then base, then the default theme's own rules, in the
// order the cascade needs. The app's build inlines this into index.html (docs/design/00-architecture.md
// §Waterfall) and every browser test uses the same text, so a test never styles a page differently.
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** tokens.css + base.css + default/theme.css, with the theme's `@import` of the tokens removed. */
export function defaultThemeCss() {
  const theme = read('default/theme.css').replace(/^@import url\("\.\.\/src\/tokens\.css"\);\s*$/m, '');
  return [read('src/tokens.css'), read('src/base.css'), theme].join('\n');
}

/** The files `defaultThemeCss` reads, for a dev server to watch. */
export const THEME_FILES = ['src/tokens.css', 'src/base.css', 'default/theme.css'].map((rel) => new URL(`../${rel}`, import.meta.url));
