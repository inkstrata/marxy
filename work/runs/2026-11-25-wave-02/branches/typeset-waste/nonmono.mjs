// Scratch: pages whose candidate tops are not monotonic in document order. For each, at several scroll
// positions, attach with the background held and report on-screen candidates left unset when `ready` resolves.
// Usage: node nonmono.mjs <label>   (run from anywhere; uses the worktree's harness and src/index.ts)
import { startHarness } from 'file:///C:/Dev/reader/worktrees/typeset-waste/packages/typeset/test/harness.mjs';

const label = process.argv[2] ?? '?';
const P = (i, extra = '') => `<p data-marxy-s="${i}"${extra}>Paragraph ${i} is long enough to wrap over several lines, with words in it that the line breaker has real choices about, and a few more so it does wrap here.</p>`;
const run = (from, n, extra = '') => Array.from({ length: n }, (_, k) => P(from + k, extra)).join('');

const cases = {
  table: run(0, 40) + `<table><tbody><tr><td>${run(100, 6)}</td><td>${run(200, 1)}</td></tr></tbody></table>` + run(300, 40),
  figure: run(0, 40) + `<figure style="float:left;width:45%;margin:0 1em 0 0"><div style="height:300px;background:#888"></div><figcaption data-marxy-s="150">A caption long enough to wrap over several lines under the picture, with words the breaker has choices about, and more.</figcaption></figure>` + run(100, 8) + run(300, 40),
  columns: run(0, 40) + `<div style="columns:2">${run(100, 14)}</div>` + run(300, 40),
  foldBelow: run(0, 10) + run(100, 200, ' class="marxy-fold-out"') + run(300, 30),
  focus: run(0, 150, ' class="marxy-focus-out"') + run(200, 20) + run(300, 150, ' class="marxy-focus-out"'),
};

const h = await startHarness();
const out = {};
for (const [name, html] of Object.entries(cases)) {
  const page = await h.open(html, { height: 600 });
  out[name] = await page.evaluate(async (name) => {
    const doc = document.getElementById('doc');
    const anchor = name === 'table' ? doc.querySelector('table') : name === 'figure' ? doc.querySelector('figure') : name === 'columns' ? doc.querySelector('div') : null;
    const positions = [];
    if (anchor) {
      const base = anchor.getBoundingClientRect().top + window.scrollY;
      for (let dy = -700; dy <= 500; dy += 25) positions.push(base + dy);
    } else positions.push(0);
    const res = { positions: positions.length, missedAt: 0, missed: 0, onScreen: 0, extraOff: 0 };
    for (const y of positions) {
      window.scrollTo(0, Math.max(0, y));
      const c = window.typeset.attach(doc, { lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: () => {} } });
      await c.ready;
      let miss = 0;
      for (const p of doc.querySelectorAll('p[data-marxy-s], figcaption')) {
        const r = p.getBoundingClientRect();
        const on = r.height > 0 && r.bottom > 0 && r.top < innerHeight;
        if (on) res.onScreen++;
        if (on && !p.classList.contains("marxy-set")) { miss++; if (p.localName === "figcaption") res.cap = (res.cap ?? 0) + 1; }
        if (!on && r.height > 0 && p.classList.contains('marxy-set')) res.extraOff++;
      }
      if (miss) res.missedAt++;
      res.missed += miss;
      c.destroy();
    }
    return res;
  }, name);
  await page.close();
}
await h.close();
console.log(label, JSON.stringify(out, null, 1));
