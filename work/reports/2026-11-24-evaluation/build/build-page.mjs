// node --experimental-strip-types build-page.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const app = 'C:/Dev/reader/app';
const { defaultThemeCss } = await import(pathToFileURL(`${app}/packages/theme/scripts/inline.mjs`).href);
const { renderSafeHtml } = await import(pathToFileURL(`${app}/packages/core/src/render/index.ts`).href);

const dir = 'C:/Dev/reader/work/evaluation-2026-11-24';
// node --experimental-strip-types build-page.mjs [<basename without extension> [<title>]]
const base = process.argv[2] ?? 'marxy-evaluation-bloat-performance';
const src = readFileSync(`${dir}/${base}.md`, 'utf8');
const title = process.argv[3] ?? 'Marxy evaluation: bloat, overengineering, performance';
let { html } = renderSafeHtml(src);

const used = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
html = html.replace(/<(h[1-3])((?![^>]* id=)[^>]*)>([\s\S]*?)<\/\1>/g, (all, tag, attrs, inner) => {
  let id = 'section-' + inner.replace(/<[^>]+>/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  while (used.has(id)) id += '-x';
  used.add(id);
  return `<${tag} id="${id}"${attrs}>${inner}</${tag}>`;
});

const h2s = [...html.matchAll(/<h2 id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => ({ id: m[1], text: m[2] }));
const toc = `<nav class="toc" aria-label="Contents"><ul>${h2s.map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join('')}</ul></nav>`;
// after the h1 and the dateline paragraph
html = html.replace(/(<h1[\s\S]*?<\/h1>\s*<p[\s\S]*?<\/p>)/, `$1\n${toc}`);

const css = `${defaultThemeCss()}
body { background: var(--marxy-bg, #111); }
main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 16px 5rem; font-family: system-ui, sans-serif; line-height: 1.55; overflow-wrap: break-word; }
main p, main ul, main ol, main table { margin: 0 0 1em; }
main h2 { margin: 2.2em 0 0.6em; } main h3 { margin: 1.6em 0 0.5em; }
main li { margin-bottom: 0.35em; }
main code { font-size: 0.88em; }
main .tablewrap { overflow-x: auto; margin: 0 0 1em; }
main .tablewrap table { margin: 0; border-collapse: collapse; width: 100%; font-size: 0.9em; }
main th, main td { text-align: left; vertical-align: top; padding: 0.4em 0.6em; border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
main .tablewrap table { min-width: 36rem; }
main nav.toc ul { list-style: none; padding: 0; }
main nav.toc li { margin-bottom: 0.2em; }
`;

html = html.replace(/<table[\s\S]*?<\/table>/g, (t) => `<div class="tablewrap">${t}</div>`);

const out = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${css}</style></head><body><main class="marxy-page">${html}</main></body></html>
`;
writeFileSync(`${dir}/${base}.html`, out, 'utf8');
console.log('written', out.length, 'h2:', h2s.length);
