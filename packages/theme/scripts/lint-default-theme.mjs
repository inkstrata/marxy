// Design-constraint lint for the default theme and the base stylesheet (constraint 4: hierarchy
// from size and weight only; constraint 2: every vertical distance derives from the line box).
import { readFileSync } from 'node:fs';
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const theme = strip(read('default/theme.css') + read('src/tokens.css'));
const base = strip(read('src/base.css'));
const bad = [];
for (const [name, css] of [['theme', theme], ['base', base]]) {
  // A rule whose selector names a heading: the selector is everything since the last `}` or `;`.
  for (const [, selector, body] of css.matchAll(/(?:^|[};])\s*([^{};]*\bh[1-6]\b[^{};]*)\{([^}]*)\}/g)) {
    if (/(?<![-\w])color\s*:(?!\s*inherit\b)/.test(body)) bad.push(`${name}: ${selector.trim()} — headings must not set colour`);
    if (/(?<![-\w])border(?:-[a-z-]+)?\s*:(?!\s*0\s*(?:;|$))/.test(body)) bad.push(`${name}: ${selector.trim()} — headings must not use borders as decoration`);
  }
}
if (/margin(-top|-bottom)?\s*:\s*\d+px/.test(theme)) bad.push('themes may not set pixel margins; use --marxy-line-box');
// Every margin and padding in base.css is an expression of tokens, never a bare length in px.
for (const match of base.matchAll(/(?:^|[;{\s])((?:margin|padding)(?:-[a-z-]+)?)\s*:\s*([^;}]+)/g)) {
  if (/(?<![\w.-])\d*\.?\d+px\b/.test(match[2].replace(/var\([^)]*\)/g, ''))) bad.push(`base: ${match[1]}: ${match[2].trim()} — a bare px length; derive it from --marxy-line-box`);
}
if (!/--marxy-line-box/.test(theme)) bad.push('token contract missing');
if (bad.length) { console.error('theme lint failed:\n - ' + bad.join('\n - ')); process.exit(1); }
console.log('theme lint ok');
