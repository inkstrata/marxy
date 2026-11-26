// What the rendered page writes and how long it holds the main thread once it is open: DOM mutations in the article
// while idle and during a wheel scroll, and the longest gaps between animation frames, on a generated Markdown page of
// about 1 MB, in headless WebKit over the memory shell. With --done it waits for every paragraph to be set and measures
// again: a set page should then write nothing at rest or on a scroll. Prints a table, or JSON with --json.
// usage: node scripts/measure-typeset-idle.mjs [--mb 1] [--settle 8000] [--done] [--json]
import { launchWebkit } from './playwright-webkit.mjs';
import { closeHarness, harnessBase, routeSkeleton } from '../apps/desktop/test/support/two-pane.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : Number(process.argv[i + 1]);
};
const MB = arg('mb', 1);
const SETTLE_MS = arg('settle', 8000);
const json = process.argv.includes('--json');
const untilDone = process.argv.includes('--done');

/** Prose with the furniture an ordinary page has: headings, lists, quotes, code, a table, every so often. */
function makeMarkdown(mb) {
  const words = 'the reader keeps a place on the page while paragraphs are set line by line, hyphenation balances the rag and hanging punctuation lets “quotes” sit outside the measure; a baseline grid holds every block in step across columns of ordinary prose'.split(' ');
  let seed = 7;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const sentence = () => {
    const w = Array.from({ length: 8 + rnd(18) }, () => words[rnd(words.length)]).join(' ');
    return `${w[0].toUpperCase()}${w.slice(1)}.`;
  };
  const para = () => Array.from({ length: 3 + rnd(5) }, sentence).join(' ');
  const out = [];
  let bytes = 0;
  for (let n = 0; bytes < mb * 1024 * 1024; n++) {
    let block;
    if (n % 40 === 0) block = `## Section ${n / 40 + 1}`;
    else if (n % 17 === 0) block = `- ${sentence()}\n- ${sentence()} ${sentence()}\n- ${sentence()}`;
    else if (n % 23 === 0) block = `> ${para()}`;
    else if (n % 31 === 0) block = `\`\`\`js\nconst x = ${n};\nfunction f(a) { return a * x; }\n\`\`\``;
    else if (n % 53 === 0) block = '| a | b | c |\n| --- | --- | --- |\n| 1 | two | three |\n| 4 | five | six |';
    else block = para();
    out.push(block);
    bytes += block.length + 2;
  }
  return `${out.join('\n\n')}\n`;
}

const WATCH = `
  window.__watch = () => {
    const doc = document.querySelector('#doc');
    const state = { mutations: 0, kinds: {}, gaps: [], last: 0, stop: false };
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        state.mutations += r.type === 'childList' ? r.addedNodes.length + r.removedNodes.length : 1;
        const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        const cls = typeof t?.className === 'string' && t.className ? '.' + t.className.split(' ')[0] : '';
        const key = r.type + (r.attributeName ? '[' + r.attributeName + ']' : '') + ' ' + (t?.tagName ?? '?').toLowerCase() + cls;
        state.kinds[key] = (state.kinds[key] ?? 0) + 1;
      }
    });
    observer.observe(doc, { subtree: true, childList: true, characterData: true, attributes: true });
    const frame = (t) => {
      if (state.stop) return;
      state.gaps.push(t - state.last);
      state.last = t;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame((t) => { state.last = t; requestAnimationFrame(frame); });
    window.__watching = () => {
      state.stop = true;
      observer.disconnect();
      const gaps = state.gaps.sort((a, b) => b - a);
      const kinds = Object.entries(state.kinds).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return { mutations: state.mutations, frames: gaps.length, worst: Math.round(gaps[0] ?? 0), over50: gaps.filter((g) => g > 50).length, top: gaps.slice(0, 5).map(Math.round), kinds };
    };
  };
`;

/** Idle for 2 s, a wheel scroll of 40 ticks of 300 px, then idle for 2 s again. */
async function phases(page) {
  await page.evaluate(WATCH);
  await page.evaluate(() => window.__watch());
  await page.waitForTimeout(2000);
  const idle = await page.evaluate(() => window.__watching());
  const set = await page.evaluate(() => document.querySelectorAll('#doc .marxy-set').length);
  await page.mouse.move(640, 450);
  await page.evaluate(() => window.__watch());
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(1000);
  const scroll = await page.evaluate(() => window.__watching());
  await page.evaluate(() => window.__watch());
  await page.waitForTimeout(2000);
  const idleAfter = await page.evaluate(() => window.__watching());
  return { set, idle, scroll, idleAfter };
}

async function measure() {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const base = await harnessBase();
    await routeSkeleton(page, base);
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const info = await page.evaluate(async (text) => {
      const path = '/r/big.md';
      const bytes = new TextEncoder().encode(text);
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const shell = createMemoryShell({ [path]: bytes });
      const mark = shell.mark.bind(shell);
      window.__typesetDone = null;
      shell.mark = async (name, t, data) => {
        if (name === 'typeset_done') window.__typesetDone = performance.now();
        return mark(name, t, data);
      };
      window.__t0 = performance.now();
      const handle = await startApp(shell, { argv: [path] });
      await handle.ready;
      await handle.contentComplete();
      return { mountMs: Math.round(performance.now() - window.__t0), bytes: bytes.length, blocks: document.querySelector('#doc').childElementCount };
    }, makeMarkdown(MB));
    await page.waitForTimeout(SETTLE_MS);
    const settling = await phases(page);
    if (!untilDone) return { ...info, settling };
    await page.waitForFunction(() => window.__typesetDone !== null, null, { timeout: 900_000, polling: 1000 });
    const doneMs = await page.evaluate(() => Math.round(window.__typesetDone - window.__t0));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);
    return { ...info, settling, doneMs, set: await phases(page) };
  } finally {
    await browser.close();
    await closeHarness();
  }
}

function print(label, r) {
  console.log(`${label}: ${r.set} paragraphs set`);
  for (const [name, m] of [['idle 2 s', r.idle], ['wheel scroll', r.scroll], ['idle 2 s after', r.idleAfter]]) {
    console.log(`  ${name.padEnd(15)} mutations ${String(m.mutations).padStart(6)}  frames ${String(m.frames).padStart(4)}  worst ${m.worst} ms  >50 ms ${m.over50}  longest ${m.top.join(', ')}`);
    for (const [k, v] of m.kinds) console.log(`  ${''.padEnd(15)} ${String(v).padStart(6)}  ${k}`);
  }
}

const r = await measure();
if (json) console.log(JSON.stringify(r, null, 2));
else {
  console.log(`${(r.bytes / 1024).toFixed(0)} KB, ${r.blocks} blocks, mounted in ${r.mountMs} ms`);
  print(`${SETTLE_MS} ms after the mount`, r.settling);
  if (r.set) print(`every paragraph set, ${r.doneMs} ms after the open began`, r.set);
}
