// How much a ResizeObserver over N top-level blocks costs, and whether un-hiding delivers its notifications.
// usage: node ro-cost.mjs   (Edge through Chromium's metrics, and WebKit by frame time)
import { createRequire } from 'node:module';
const { chromium, webkit } = createRequire('C:/Dev/reader/worktrees/geometry-table/package.json')('playwright');

const html = `<!doctype html><meta charset=utf-8><style>body{margin:0;font:16px/24px serif} #a{width:680px;margin:auto} #a>p{margin:0 0 24px}</style><article id=a></article>`;

async function metrics(cdp) {
  if (!cdp) return null;
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

async function run(browser, label) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let cdp = null;
  if (label === 'edge') {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
  }
  await page.setContent(html);
  for (const n of [1245, 10000]) {
    for (const observed of [false, true]) {
      const setup = await page.evaluate(async ({ n, observed }) => {
        const a = document.getElementById('a');
        window.__ro?.disconnect();
        a.replaceChildren();
        a.hidden = false;
        document.documentElement.scrollTop = 0;
        const words = 'the reader keeps a place on the page while paragraphs are set line by line and the rag is balanced ';
        for (let i = 0; i < n; i++) {
          const p = document.createElement('p');
          p.textContent = words.repeat(2 + (i % 4));
          a.append(p);
        }
        window.__frame = () => new Promise((res) => requestAnimationFrame(res));
        window.__n = { notified: 0, cb: 0 };
        window.__ro = null;
        if (observed) {
          window.__ro = new ResizeObserver((records) => {
            const t = performance.now();
            window.__n.notified += records.length;
            for (const r of records) void r.borderBoxSize?.[0]?.blockSize;
            window.__n.cb += performance.now() - t;
          });
          window.__ro.observe(a);
          for (const p of a.children) window.__ro.observe(p, { box: 'border-box' });
        }
        for (let i = 0; i < 4; i++) await window.__frame();
        const initial = { ...window.__n };
        window.__n = { notified: 0, cb: 0 };
        return initial;
      }, { n, observed });
      const phase = async (name, body) => {
        const m0 = await metrics(cdp);
        const r = await page.evaluate(body, n);
        const m1 = await metrics(cdp);
        const d = m0 ? { task: +((m1.TaskDuration - m0.TaskDuration) * 1000 / 60).toFixed(2), layout: +((m1.LayoutDuration - m0.LayoutDuration) * 1000 / 60).toFixed(2) } : {};
        return { name, perFrame: +(r.wall / 60).toFixed(2), ...d, notified: r.notified, cb: +r.cb.toFixed(2) };
      };
      const changing = await phase('one block changes each frame', async (n) => {
        const a = document.getElementById('a');
        window.__n = { notified: 0, cb: 0 };
        const t0 = performance.now();
        for (let f = 0; f < 60; f++) {
          a.children[(f * 37) % n].style.paddingBottom = `${(f % 3) * 4 + 4}px`;
          await window.__frame();
        }
        return { wall: performance.now() - t0, ...window.__n };
      });
      const scrolling = await phase('scroll only', async () => {
        window.__n = { notified: 0, cb: 0 };
        const t0 = performance.now();
        for (let f = 0; f < 60; f++) {
          document.documentElement.scrollTop += 200;
          await window.__frame();
        }
        return { wall: performance.now() - t0, ...window.__n };
      });
      const unhide = await page.evaluate(async () => {
        const a = document.getElementById('a');
        a.hidden = true;
        await window.__frame();
        await window.__frame();
        window.__n = { notified: 0, cb: 0 };
        a.hidden = false;
        await window.__frame();
        await window.__frame();
        return { ...window.__n };
      });
      console.log(label, JSON.stringify({ n, observed, initial: setup, changing, scrolling, unhide }));
    }
  }
  await page.close();
}

const edge = await chromium.launch({ channel: 'msedge' });
await run(edge, 'edge');
await edge.close();
const wk = await webkit.launch();
await run(wk, 'webkit');
await wk.close();
