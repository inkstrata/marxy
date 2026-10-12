// K-05b's before-and-after pictures: a readme, an article and a report page, Night and Paper, 1280 x 800,
// headless WebKit over the app's own harness page on the memory shell (the recipe of the 2026-10 walk).
//
//   node docs/taste-review/2026-10-k05b/capture.mjs <before|after> [--measure]
//
// Run `before` on origin/main's tree and `after` on the branch; each writes <tag>-<variant>-<page>.png here
// and prints the pane's data-marxy-kind and the computed face, size, line box and column. --measure also
// prints each face's average advance in em, the number --marxy-avg-char must carry (ADR-0033).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { boot, corpus, serve, repo } from '../2026-10-walk/capture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tag = process.argv[2];
if (tag !== 'before' && tag !== 'after') throw new Error('usage: capture.mjs <before|after> [--measure]');
const pages = {
  readme: ['/w/README.md', corpus('02-readme-real-world.md')],
  article: ['/w/essay.md', corpus('01-long-technical.md')],
  report: ['/w/plan.md', corpus('03-ai-plan.md')],
};
const files = Object.fromEntries(Object.values(pages));
const srv = await serve(repo);
const browser = await launchWebkit();
try {
  for (const variant of ['dark', 'light']) {
    for (const [key, [path]] of Object.entries(pages)) {
      const page = await boot(browser, srv, { files, open: [path], variant });
      const info = await page.evaluate(() => {
        const pane = document.querySelector('section.marxy-pane');
        const art = document.querySelector('.marxy-article');
        const cs = getComputedStyle(art);
        return { kind: pane?.getAttribute('data-marxy-kind'), family: cs.fontFamily.split(',')[0], size: cs.fontSize, line: cs.lineHeight, width: art.getBoundingClientRect().width };
      });
      console.log(`${tag} ${variant} ${key}: ${JSON.stringify(info)}`);
      await page.screenshot({ path: join(here, `${tag}-${variant}-${key}.png`) });
      if (process.argv.includes('--measure') && variant === 'dark') {
        const m = await page.evaluate(async () => {
          const { measureAverageAdvance } = await import('/src/theme/measure-face.ts');
          const out = {};
          for (const [name, family, px, weight] of [
            ['literata20', '"Literata"', 20, 370], ['sourceserif20', '"Source Serif 4"', 20, 370], ['inter16', '"Inter"', 16, 370],
            ['atkinson17', '"Atkinson Hyperlegible Next"', 17, 370], ['sourceserif20w400', '"Source Serif 4"', 20, 400],
            ['inter16w400', '"Inter"', 16, 400], ['atkinson17w400', '"Atkinson Hyperlegible Next"', 17, 400],
          ]) out[name] = await measureAverageAdvance({ family, sizePx: px, weight });
          return out;
        });
        console.log('avg advance (em):', JSON.stringify(m));
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  await srv.close();
}
