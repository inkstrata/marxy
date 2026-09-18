// Design-constraint lint for the default theme (constraint 4: hierarchy from size and weight only).
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../default/theme.css', import.meta.url), 'utf8') + readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');
const bad = [];
if (/h[1-6][^{]*\{[^}]*color\s*:/s.test(css)) bad.push('headings must not set colour');
if (/h[1-6][^{]*\{[^}]*border/s.test(css)) bad.push('headings must not use borders as decoration');
if (/margin(-top|-bottom)?\s*:\s*\d+px/.test(css)) bad.push('themes may not set pixel margins; use --marxy-line-box');
if (!/--marxy-line-box/.test(css)) bad.push('token contract missing');
if (bad.length) { console.error('theme lint failed:\n - ' + bad.join('\n - ')); process.exit(1); }
console.log('theme lint ok');
