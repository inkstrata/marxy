// Measures the Outline on a 6 MB rendered Markdown file: drawer element count, a full Outline redraw, and a verb bar
// show/hide restyle. Usage: node measure.mjs <worktree> <edge|webkit> [label]
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [tree, engine = 'edge', label = '', panel = 'outline'] = process.argv.slice(2);
const desktop = join(tree, 'apps/desktop');
const req = createRequire(join(desktop, 'package.json'));
const { chromium, webkit } = req('playwright');
const two = await import(pathToFileURL(join(desktop, 'test/support/two-pane.mjs')).href);

const para = 'Words that run on long enough to fill the measure and make the page tall enough to scroll, and more. '.repeat(9);
const parts = [];
for (let i = 0; i < 6500; i++) {
  const lv = i % 500 === 0 ? 1 : i % 25 === 0 ? 2 : 3;
  parts.push(`${'#'.repeat(lv)} Heading number ${i}\n\n${para}\n`);
}
const text = parts.join('\n');

const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await two.bootTwoPanes(page, { files: { '/w/big.md': text }, open: ['/w/big.md'], full: true });
  await page.evaluate(() => window.__marxyHandle.frame().left.show('outline', undefined, false));
  const switchTo = panel;
  await page.evaluate(() => import('/src/read-as/show-rendered.ts').then((m) => m.showRendered('/w/big.md', true)));
  await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-prow[data-marxy-left-row="h:heading-number-6000"]') || document.querySelectorAll('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="h:"]').length > 0 && document.querySelector('.marxy-drawer .marxy-l-body')?.scrollHeight > 50000, null, { timeout: 300_000 });
  await page.waitForTimeout(2000);
  if (switchTo !== 'outline') { await page.evaluate((id) => window.__marxyHandle.frame().left.show(id, undefined, false), switchTo); await page.waitForTimeout(1500); }
  const res = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const count = {
      drawer: document.querySelectorAll('.marxy-drawer *').length,
      rows: document.querySelectorAll('.marxy-drawer .marxy-l-row').length,
      all: document.querySelectorAll('*').length,
      scrollH: document.querySelector('.marxy-drawer .marxy-l-body').scrollHeight,
    };
    const redraw = [];
    for (let i = 0; i < 6; i++) {
      await frame();
      const t = performance.now();
      window.__marxyHandle.frame().left.draw();
      void document.body.offsetHeight;
      redraw.push(performance.now() - t);
    }
    const bar = document.querySelector('.marxy-verb-bar');
    const verb = [];
    for (let i = 0; i < 6; i++) {
      await frame();
      const t = performance.now();
      document.documentElement.toggleAttribute('data-marxy-verb-room');
      if (bar) bar.hidden = !bar.hidden;
      void document.body.offsetHeight;
      verb.push(performance.now() - t);
    }
    return { count, redraw: redraw.map(Math.round), verb: verb.map(Math.round) };
  });
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  console.log(JSON.stringify({ label, engine, ...res, redrawMedian: med(res.redraw), verbMedian: med(res.verb) }));
} finally {
  await browser.close();
  await two.closeHarness();
}
