// Before/after pairs for the reader-typography pass (ADR-0033): five corpus pages at 960 px and
// 1440 px, 2×, dark and light, once at the top and once scrolled to the first code block. "Before"
// is the stylesheet at a git ref (default origin/main), "after" is the working tree. Code is
// highlighted in Node with the core highlighter and each line wrapped as the app's highlight pass
// does, so token colours and the code-block rules show.
// usage: node --experimental-strip-types packages/theme/test/render-typography.mjs [--ref origin/main] [--out dir]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { highlight } from '../../core/src/highlight/index.ts';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { css as afterCss, facesCss, renderCorpus } from './page.mjs';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const ref = arg('--ref', 'origin/main');
const out = new URL(`../../../${arg('--out', 'docs/taste-review/2026-09-reader-typography')}/`, import.meta.url);
mkdirSync(out, { recursive: true });

const PAGES = ['02-readme-real-world.md', '03-ai-plan.md', '15-prose-volume.md', '16-api-reference.md', '18-agent-transcript.md'];
const WIDTHS = [960, 1440];

const show = (path) => execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
const beforeCss = [
  show('packages/theme/src/tokens.css'),
  show('packages/theme/src/base.css'),
  show('packages/theme/default/theme.css').replace(/^@import url\("\.\.\/src\/tokens\.css"\);\s*$/m, ''),
].join('\n');

/** Token lines for every fenced block with a language, keyed by the block's text. */
async function tokensFor(html) {
  const blocks = [...html.matchAll(/<code class="language-([\w+-]+)"[^>]*>([\s\S]*?)<\/code>/g)];
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
  const out = {};
  for (const [, lang, body] of blocks) {
    const text = unescape(body);
    const lines = await highlight(text, lang);
    if (lines) out[text] = lines;
  }
  return out;
}

const browser = await launchWebkit();
for (const file of PAGES) {
  const html = renderCorpus(file);
  const tokens = await tokensFor(html);
  for (const [label, css, lines] of [['before', beforeCss, false], ['after', afterCss, true]]) {
    for (const width of WIDTHS) {
      for (const variant of ['dark', 'light']) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        await page.setContent(
          `<!doctype html><html lang="en" data-marxy-variant="${variant}"><head><meta charset="utf-8">` +
            `<style>${facesCss()}${css}</style></head>` +
            `<body><article class="marxy-article" id="doc">${html}</article></body></html>`,
        );
        await page.evaluate(({ tokens, lines }) => {
          const codes = [...document.querySelectorAll('pre:not(.marxy-math-block) > code')];
          codes.forEach((code) => {
            const toks = tokens[code.textContent] ?? (lines ? code.textContent.split('\n').map((t) => (t ? [{ text: t }] : [])) : null);
            if (!toks) return;
            const frag = document.createDocumentFragment();
            toks.forEach((line, li) => {
              if (li > 0) frag.append('\n');
              if (lines && li === toks.length - 1 && line.length === 0) return;
              const holder = lines ? document.createElement('span') : frag;
              if (lines) holder.className = 'marxy-line';
              for (const t of line) {
                if (!t.scope) { holder.append(t.text); continue; }
                const s = document.createElement('span');
                s.className = `marxy-tok-${t.scope}`;
                s.textContent = t.text;
                holder.append(s);
              }
              if (lines) frag.append(holder);
            });
            code.replaceChildren(frag);
          });
        }, { tokens, lines });
        await page.evaluate(() => document.fonts.ready);
        const slug = file.replace(/\.md$/, '');
        await page.screenshot({ path: new URL(`${label}-${slug}-${variant}-${width}.png`, out).pathname });
        const pre = await page.$('pre');
        if (pre) {
          await page.evaluate(() => document.querySelector('pre').scrollIntoView({ block: 'center' }));
          await page.screenshot({ path: new URL(`${label}-${slug}-${variant}-${width}-code.png`, out).pathname });
        }
        await ctx.close();
      }
    }
    console.log(`${label} ${file}`);
  }
}
await browser.close();
