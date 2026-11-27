// Per-interaction main-thread cost against the number of mounted nodes, in the app's own source over the in-memory shell.
// A file is cut to a byte size, opened whole, left to finish (progressive mount + typesetter idle queue) and then used.
// No CDP: every number is in-page performance.now over many repetitions (median, min), so it works in WebKit too.
// usage: node node-budget.mjs --repo <marxy checkout> [--browser webkit|chromium|chrome|msedge] [--kind md-prose]
//        [--sizes 20k,60k,...] [--reps 15] [--has keep|drop|both] [--settle 150] [--json out.json]
//        node node-budget.mjs --repo <checkout> --mode ro [--browser ...]   (ResizeObserver cost, synthetic blocks)
// Windows/WebView2 path: --browser msedge (installed Edge, Chromium) needs no other change.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const REPO = arg('repo');
const BROWSER = arg('browser', 'webkit');
const KIND = arg('kind', 'md-prose');
const SIZES = arg('sizes', '20k,60k,120k,250k,500k,1m').split(',');
const REPS = Number(arg('reps', 15));
const HAS = arg('has', 'keep');
const SETTLE = Number(arg('settle', 150)) * 1000;
const MODE = arg('mode', 'app');
const JSON_OUT = arg('json', null);
const bytesOf = (s) => Math.round(parseFloat(s) * (/m$/i.test(s) ? 1e6 : 1e3));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { takeSlot } = await import(pathToFileURL(join(REPO, 'scripts/lib/machine-lock.mjs')).href);
const lock = await takeSlot('verify', 2, { waitMs: 3600_000, label: 'node-budget probe', log: (m) => console.error(m) });
const req = createRequire(join(REPO, 'apps/desktop/package.json'));
const pw0 = await import(pathToFileURL(createRequire(join(REPO, 'package.json')).resolve('playwright')).href); const pw = pw0.default ?? pw0;
const launcher = BROWSER === 'webkit' ? pw.webkit : pw.chromium;
const browser = await launcher.launch({
  ...(['webkit', 'chromium'].includes(BROWSER) ? {} : { channel: BROWSER }), headless: true,
  ...(BROWSER === 'webkit' ? {} : { ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] }),
});
const version = browser.version();
const log = (m) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { med: +s[Math.floor(s.length / 2)].toFixed(2), min: +s[0].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };

// In-page helpers, installed before the app loads.
const INIT = () => {
  window.__done = () => new Promise((res) => requestAnimationFrame(() => { const t = performance.now(); setTimeout(() => res({ t, end: performance.now() }), 0); }));
  window.__quiet = async (capMs) => {
    const t0 = performance.now();
    let calm = 0;
    while (performance.now() - t0 < capMs) {
      const a = performance.now();
      await new Promise((r) => setTimeout(r, 100));
      const late = performance.now() - a - 100;
      calm = late < 25 ? calm + 1 : 0;
      if (calm >= 6) return { quiet: true, waited: performance.now() - t0 };
    }
    return { quiet: false, waited: performance.now() - t0 };
  };
};

let server;
const results = [];
try {
  if (MODE === 'app') {
    const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
    server = await createServer({ root: join(REPO, 'apps/desktop'), configFile: join(REPO, 'apps/desktop/vite.config.ts'), logLevel: 'error', server: { port: 1495, strictPort: false, host: '127.0.0.1', hmr: false, watch: null } });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    const { bigFile } = await import(pathToFileURL(join(REPO, 'scripts/lib/big-files.mjs')).href);
    for (const size of SIZES) for (const has of HAS === 'both' ? ['keep', 'drop'] : [HAS]) {
      const { name, text } = await bigFile(KIND, bytesOf(size));
      const path = `/demo/reading/${name}`;
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const r = { kind: KIND, size, bytes: Buffer.byteLength(text), has, browser: BROWSER, version };
      try {
        const page = await ctx.newPage();
        await page.addInitScript(INIT);
        await page.goto(`${base}/?open=${encodeURIComponent('reading/on-the-measure.md')}`, { timeout: 180_000 });
        await page.waitForFunction(() => !!window.marxy?.handle, null, { timeout: 90_000 });
        await page.evaluate(() => window.marxy.handle.contentComplete());
        await page.evaluate(([p, b64]) => window.marxy.shell.plant(p, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))), [path, Buffer.from(text).toString('base64')]);
        const t0 = Date.now();
        await page.evaluate(async (p) => { await window.marxy.handle.open(p); await window.marxy.handle.contentComplete(); }, path);
        r.openWallS = +((Date.now() - t0) / 1000).toFixed(1);
        if (has === 'drop') {
          r.hasRulesDropped = await page.evaluate(() => {
            let n = 0;
            for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch { continue; } for (let i = rules.length - 1; i >= 0; i--) if (rules[i].cssText.includes(':has(')) { ss.deleteRule(i); n++; } }
            return n;
          });
        }
        const q = await page.evaluate((c) => window.__quiet(c), SETTLE);
        r.typesetQuiet = q.quiet; r.settleS = +(q.waited / 1000).toFixed(1);
        r.nodes = await page.evaluate(() => { const a = [...document.querySelectorAll('.marxy-article')].find((x) => !x.hidden && !x.closest('[hidden]')); return { article: a.getElementsByTagName("*").length, articleAll: (() => { let n = 0; const w = document.createTreeWalker(a, NodeFilter.SHOW_ALL); while (w.nextNode()) n++; return n; })(), doc: (() => { let n = 0; const w = document.createTreeWalker(document, NodeFilter.SHOW_ALL); while (w.nextNode()) n++; return n; })(), blocks: a.children.length }; });
        r.sample = await page.evaluate(() => { const a = [...document.querySelectorAll(".marxy-article")].find((x) => !x.hidden && !x.closest("[hidden]")); const p = a.querySelector(":scope > p"); return { html: p.outerHTML.slice(0, 500), nodesInP: p.getElementsByTagName("*").length, typesetAttrs: [...a.querySelectorAll("[data-ts],[data-typeset],[data-marxy-typeset]")].length }; });
        // Each interaction: reps, median and min of ms from the trigger to the end of the next frame, plus the synchronous part.
        const rep = async (name, trigger, post) => {
          const total = [], sync = [], frame = [];
          for (let i = 0; i < REPS; i++) {
            await page.evaluate(() => window.__quiet(5000));
            const r1 = await trigger(i);
            const done = await page.evaluate(async () => { const d = await window.__done(); return { frameStart: d.t, end: d.end }; });
            total.push(done.end - r1.t0); sync.push(r1.sync ?? NaN); frame.push(done.end - done.frameStart);
            if (post) await post(i);
          }
          return { total: stat(total), sync: sync.every(Number.isNaN) ? null : stat(sync), frame: stat(frame) };
        };
        const inPage = (fn) => (i) => page.evaluate(fn, i);
        const ART = `const art = () => [...document.querySelectorAll('.marxy-article')].find((x) => !x.hidden && !x.closest('[hidden]')); const scr = () => { let e = art(); while (e && e !== document.body) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 5) return e; e = e.parentElement; } return document.scrollingElement; };`;
        const run = (body) => `(i) => { ${ART} ${body} }`;
        await page.evaluate(`window.__stamp = () => { window.__t0 = performance.now(); }; window.addEventListener('keydown', () => { window.__k0 = performance.now(); }, true); window.addEventListener('keydown', () => { window.__k1 = performance.now(); }, false);`);
        r.interactions = {};
        r.interactions.key = await rep('key', async () => { await page.evaluate(() => window.__stamp()); await page.keyboard.press(Math.random() < 0.5 ? 'j' : 'k'); const s = await page.evaluate(() => ({ t0: window.__t0, sync: window.__k1 - window.__k0 })); return s; });
        r.interactions.scroll = await rep('scroll', async () => page.evaluate(eval(run(`const s = scr(); const t0 = performance.now(); s.scrollTop += (i % 2 ? -1 : 1) * 160; return { t0 };`))));
        r.interactions.forcedLayoutOneBlock = await rep('forcedLayoutOneBlock', async () => page.evaluate(eval(run(`const a = art(); const b = a.children[Math.floor(a.children.length / 2)]; const t0 = performance.now(); b.style.paddingTop = (i % 2 ? 0 : 3) + 'px'; void a.offsetHeight; return { t0, sync: performance.now() - t0 };`))), () => page.evaluate(`(() => { ${ART} const a = art(); a.children[Math.floor(a.children.length / 2)].style.paddingTop = ''; })()`));
        r.interactions.forcedLayoutArticleWidth = await rep('forcedLayoutArticleWidth', async () => page.evaluate(eval(run(`const a = art(); const t0 = performance.now(); a.style.paddingRight = (i % 2 ? 0 : 2) + 'px'; void a.offsetHeight; return { t0, sync: performance.now() - t0 };`))), () => page.evaluate(`(() => { ${ART} art().style.paddingRight = ''; })()`));
        r.interactions.appendOneBlock = await rep('appendOneBlock', async () => page.evaluate(eval(run(`const a = art(); const last = a.lastElementChild; const c = last.cloneNode(true); const t0 = performance.now(); a.appendChild(c); const t1 = performance.now(); void c.getBoundingClientRect(); window.__app = (window.__app || []); window.__app.push(c); return { t0, sync: performance.now() - t0, appendOnly: t1 - t0 };`))), () => page.evaluate(`(() => { while (window.__app?.length) window.__app.pop().remove(); })()`));
        r.interactions.widthChange = await rep('widthChange', async () => { const t0 = await page.evaluate(() => performance.now()); await page.setViewportSize({ width: 1440 - 40 * (r.__w = !r.__w ? 1 : 0), height: 900 }); return { t0: t0 }; });
        r.interactions.widthChange.note = 'trigger to end of next frame; includes Playwright round trip, so an upper bound';
      } catch (e) { r.fatal = e.message.split('\n')[0]; }
      await ctx.close();
      results.push(r);
      log(`${KIND} ${size} ${has}: nodes ${r.nodes?.articleAll}/${r.nodes?.article} el open ${r.openWallS}s settle ${r.settleS}s${r.typesetQuiet === false ? ' (NOT quiet)' : ''} key ${r.interactions?.key?.total.med}/${r.interactions?.key?.total.min} scroll ${r.interactions?.scroll?.total.med} layout1 ${r.interactions?.forcedLayoutOneBlock?.sync?.med} layoutW ${r.interactions?.forcedLayoutArticleWidth?.sync?.med} append ${r.interactions?.appendOneBlock?.sync?.med}${r.fatal ? ' FATAL ' + r.fatal : ''}`);
      if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
    }
  } else {
    // ResizeObserver cost over N synthetic top-level blocks (shape of ro-cost.mjs on the geometry-table branch).
    const html = `<!doctype html><meta charset=utf-8><style>body{margin:0;font:16px/24px serif} #a{width:680px;margin:auto} #a>p{margin:0 0 24px}</style><article id=a></article>`;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(INIT);
    await page.goto("about:blank");
    await page.setContent(html);
    for (const n of [2000, 5000, 10000, 20000, 40000]) for (const observed of [false, true]) {
      const r = await page.evaluate(async ({ n, observed, reps }) => {
        const a = document.getElementById('a');
        window.__ro?.disconnect(); a.replaceChildren();
        const words = 'the reader keeps a place on the page while paragraphs are set line by line and the rag is balanced ';
        for (let i = 0; i < n; i++) { const p = document.createElement('p'); p.textContent = words.repeat(2 + (i % 4)); a.append(p); }
        let notified = 0, cb = 0;
        if (observed) { window.__ro = new ResizeObserver((rs) => { const t = performance.now(); notified += rs.length; for (const x of rs) void x.borderBoxSize?.[0]?.blockSize; cb += performance.now() - t; }); window.__ro.observe(a); for (const p of a.children) window.__ro.observe(p, { box: 'border-box' }); }
        const t0 = performance.now(); await window.__done(); await window.__done(); const init = performance.now() - t0; const initNotified = notified; notified = 0; cb = 0;
        const out = { oneBlock: [], layoutOnly: [], deliver: [], cbs: [] };
        for (let i = 0; i < reps; i++) {
          await window.__quiet(3000);
          const b = a.children[Math.floor(n / 2)]; cb = 0; notified = 0;
          const s = performance.now(); b.style.paddingTop = (i % 2 ? 0 : 3) + 'px'; void a.offsetHeight; out.layoutOnly.push(performance.now() - s);
          const d = await window.__done(); out.oneBlock.push(d.end - s); out.cbs.push(cb); out.deliver.push(notified);
        }
        return { init, initNotified, ...out };
      }, { n, observed, reps: REPS });
      const row = { n, observed, browser: BROWSER, version, initMs: +r.init.toFixed(1), initNotified: r.initNotified, layoutOnly: stat(r.layoutOnly), toNextFrameEnd: stat(r.oneBlock), roCallbackMs: stat(r.cbs), notifiedPerChange: stat(r.deliver) };
      results.push(row); log(`ro n=${n} observed=${observed}: layout ${row.layoutOnly.med} frame ${row.toNextFrameEnd.med} cb ${row.roCallbackMs.med} init ${row.initMs}`);
      if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
    }
  }
} finally {
  await browser.close();
  await server?.close();
  lock.release();
}
console.log(JSON.stringify(results, null, 1));
process.exit(0);
