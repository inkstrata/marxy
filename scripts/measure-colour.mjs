// Colouring a large code file, measured in a real engine: the file opened in Read (or Source) over the memory shell, the time to
// the first coloured token in view and the longest the main thread is held after the open. Not a gate: the numbers are
// printed. `node scripts/measure-colour.mjs [--engine msedge|webkit] [--mb 5] [--mode rendered|source] [--anyway]`
// (`--anyway` colours a file past the plain-text tier as you scroll, the Reading card's choice).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, webkit } from 'playwright';
import { bootTwoPanes, closeHarness } from '../apps/desktop/test/support/two-pane.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const engine = arg('engine', 'msedge');
const mb = Number(arg('mb', '5'));
const mode = arg('mode', 'rendered');
const anyway = process.argv.includes('--anyway');
const scroll = process.argv.includes('--scroll');

// Real JavaScript, repeated to size: KaTeX's unminified build (a large, ordinary library).
// KaTeX is the desktop package's dependency, so it is resolved from there.
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const seed = readFileSync(require.resolve('katex/dist/katex.js'), 'utf8');
let big = '';
while (big.length < mb * 1_000_000) big += `${seed}\n`;
big = big.slice(0, big.lastIndexOf('\n', mb * 1_000_000) + 1);

const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await bootTwoPanes(page, { files: { '/r/a.md': '# a\n', '/r/big.js': big }, open: ['/r/a.md'] });
  const profile = process.argv.includes('--profile') && engine !== 'webkit' ? await page.context().newCDPSession(page) : null;
  if (profile) {
    await profile.send('Profiler.enable');
    await profile.send('Profiler.setSamplingInterval', { interval: 200 });
    await profile.send('Profiler.start');
  }
  const seen = await page.evaluate(
    async ({ mode, anyway, scroll }) => {
      const handle = window.__marxyHandle;
      if (anyway) {
        const { setColourAnyway } = await import('/src/render/colour-tier.ts');
        setColourAnyway('/r/big.js', true);
      }
      const out = { text: null, colour: null, longest: 0, at: 0, afterText: 0, scrolled: null };
      const inView = (sel) => {
        const h = window.innerHeight;
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (r.bottom > 0 && r.top < h && r.width > 0 && el.closest('[hidden]') === null) return true;
        }
        return false;
      };
      const textSel = '.cm-line, pre.marxy-run code';
      const tokSel = '.cm-line [class*="marxy-tok-"], pre.marxy-run code [class*="marxy-tok-"]';
      let t0 = performance.now();
      let beat = t0;
      const timer = setInterval(() => {
        const now = performance.now();
        const held = now - beat - 10;
        if (held > out.longest) {
          out.longest = held;
          out.at = beat - t0;
        }
        if (out.text !== null && held > out.afterText) out.afterText = held;
        beat = now;
      }, 10);
      let frames = true;
      const look = () => {
        if (!frames) return;
        const now = performance.now() - t0;
        if (out.text === null && inView(textSel)) out.text = now;
        if (out.colour === null && inView(tokSel)) out.colour = now;
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
      t0 = performance.now();
      beat = t0;
      await handle.open('/r/big.js');
      const pane = handle.panes().panes[0];
      if (pane.view.mode !== mode) await pane.view.setMode(mode);
      await new Promise((r) => setTimeout(r, 8_000));
      if (scroll) {
        // Jump to the middle and time the colour there.
        const scroller = [...document.querySelectorAll('.cm-scroller')].find((e) => e.closest('[hidden]') === null);
        const before = performance.now();
        const panes = document.querySelectorAll('.marxy-pane-body, main');
        const target = scroller ?? [...document.querySelectorAll('*')].find((e) => e.scrollHeight > 100_000 && getComputedStyle(e).overflowY !== 'visible') ?? document.scrollingElement;
        target.scrollTop = target.scrollHeight / 2;
        out.scroller = target.tagName + (target.className ? `.${String(target.className).split(' ')[0]}` : '');
        void panes;
        const mid = () => {
          const h = window.innerHeight;
          const els = document.querySelectorAll(tokSel);
          for (const el of els) {
            const r = el.getBoundingClientRect();
            if (r.bottom > 0 && r.top < h && r.width > 0) return true;
          }
          return false;
        };
        await new Promise((resolve) => {
          const tick = () => {
            if (mid() || performance.now() - before > 5_000) {
              out.scrolled = mid() ? performance.now() - before : null;
              resolve();
            } else requestAnimationFrame(tick);
          };
          // A frame after the jump, so a token from before it is not counted.
          requestAnimationFrame(() => requestAnimationFrame(tick));
        });
        await new Promise((r) => setTimeout(r, 2_000));
      }
      frames = false;
      clearInterval(timer);
      out.dom = {
        mode: document.body.dataset.marxyMode,
        runs: document.querySelectorAll('pre.marxy-run').length,
        lines: document.querySelectorAll('pre.marxy-run .marxy-line').length,
        toks: document.querySelectorAll('pre.marxy-run [class*="marxy-tok-"]').length,
        cm: document.querySelectorAll('.cm-editor').length,
        cmToks: document.querySelectorAll('.cm-line [class*="marxy-tok-"]').length,
        path: handle.panes().panes.map((p) => `${p.path()}:${p.view.mode}`).join(','),
      };
      const head = document.querySelector('[data-marxy-pane] .marxy-guess:not([hidden])');
      out.head = head ? head.textContent : null;
      return out;
    },
    { mode, anyway, scroll },
  );
  if (profile) {
    const { profile: prof } = await profile.send('Profiler.stop');
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    const self = new Map();
    const dt = prof.timeDeltas;
    prof.samples.forEach((id, i) => {
      const n = byId.get(id);
      const f = n.callFrame;
      const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
    });
    if (process.argv.includes('--self')) for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${Math.round(v)} ms  ${k}`);
    // Each run of busy samples over 100 ms: its length, and where its time went (the frames just under the root).
    const parentOf = new Map();
    for (const n of prof.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
    const rootChain = (id) => {
      const chain = [];
      for (let at = id; parentOf.get(at) !== undefined; at = parentOf.get(at)) {
        const f = byId.get(at).callFrame;
        chain.unshift(`${f.functionName || '(anon)'}@${f.url.split('/').pop().split('?')[0]}:${f.lineNumber}`);
      }
      return chain.slice(0, 4).join(' > ');
    };
    let run = null;
    const runs = [];
    prof.samples.forEach((id, i) => {
      const name = byId.get(id).callFrame.functionName;
      const step = (dt[i] ?? 0) / 1000;
      if (name !== '(idle)') {
        run ??= { ms: 0, by: new Map() };
        run.ms += step;
        const key = rootChain(id);
        run.by.set(key, (run.by.get(key) ?? 0) + step);
      } else if (run) {
        runs.push(run);
        run = null;
      }
    });
    if (run) runs.push(run);
    for (const r of runs.filter((x) => x.ms > 100)) {
      console.log(`busy ${Math.round(r.ms)} ms:`);
      for (const [k, v] of [...r.by].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`   ${Math.round(v)} ms ${k}`);
    }
    const who = arg('callers', null);
    if (who) {
      const parent = new Map();
      for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
      const seenChains = new Set();
      for (const n of prof.nodes) {
        if (n.callFrame.functionName !== who) continue;
        const chain = [];
        for (let at = parent.get(n.id); at !== undefined && chain.length < 14; at = parent.get(at)) {
          const f = byId.get(at).callFrame;
          chain.push(`${f.functionName || '(anon)'}@${f.url.split('/').slice(-1)[0].split('?')[0]}:${f.lineNumber}`);
        }
        const line = chain.join(' < ');
        if (!seenChains.has(line)) console.log(`${who} < ${line}`);
        seenChains.add(line);
      }
    }
  }
  const ms = (v) => (v === null ? 'never' : `${Math.round(v)} ms`);
  console.log(
    `${engine} ${(big.length / 1e6).toFixed(2)} MB JavaScript in ${mode}${anyway ? ' (coloured anyway)' : ''}: first text in view ${ms(seen.text)}, first colour in view ${ms(seen.colour)} (${seen.colour === null || seen.text === null ? '-' : Math.round(seen.colour - seen.text)} ms after the text), longest hold after the text ${Math.round(seen.afterText)} ms, longest hold ${Math.round(seen.longest)} ms (at ${Math.round(seen.at)} ms)${seen.scrolled !== null || scroll ? `, colour after a jump to the middle ${ms(seen.scrolled)} (${seen.scroller})` : ''}; head: ${seen.head ?? '(quiet)'}`,
  );
  if (process.argv.includes('--debug')) console.log(JSON.stringify(seen.dom));
} finally {
  await browser.close();
  await closeHarness();
}
