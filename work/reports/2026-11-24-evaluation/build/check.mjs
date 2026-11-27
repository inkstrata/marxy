import { chromium } from 'file:///C:/Dev/reader/app/node_modules/playwright/index.mjs';
const dir = 'C:/Dev/reader/work/evaluation-2026-11-24';
const b = await chromium.launch({ channel: 'msedge', headless: true });
for (const [w, n] of [[1280, 'wide'], [420, 'narrow']]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.goto(`file:///${dir}/marxy-evaluation-bloat-performance.html`);
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const t = document.body.innerText;
    const cs = getComputedStyle(document.body);
    const p0 = document.querySelector('main p');
    return {
      tables: document.querySelectorAll('table').length,
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
      raw: { stars: t.includes('**'), tick: t.includes('`'), pipe: /^\s*\|/m.test(t) },
      bg: cs.backgroundColor, color: getComputedStyle(p0).color,
      measureChars: Math.round(p0.getBoundingClientRect().width / (parseFloat(getComputedStyle(p0).fontSize) * 0.5)),
      pw: p0.getBoundingClientRect().width, fs: getComputedStyle(p0).fontSize,
      tocLinks: [...document.querySelectorAll('nav.toc a')].map(a => { const t = document.getElementById(a.getAttribute('href').slice(1)); return !!t && t.textContent === a.textContent; }),
      wideTables: [...document.querySelectorAll('.tablewrap')].filter(w => w.scrollWidth > w.clientWidth).length,
    };
  });
  console.log(n, JSON.stringify(r));
  if (n === 'wide') {
    await p.click('nav.toc a:nth-child(1)', { }).catch(() => {});
    await p.click('nav.toc li:nth-child(3) a');
    console.log('hash', await p.evaluate(() => location.hash));
  }
  await p.screenshot({ path: `${dir}/build/shot-${n}.png`, fullPage: true });
}
await b.close();
