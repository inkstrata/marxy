// A large plain .txt read as prose never holds the page for long (WebKit). Core sets plain prose, verse and a
// file as written as one reading; past RUN_BLOCKS its blocks go in runs, and the page mounts the runs a few at a time below
// the first screens, as it mounts a Markdown page's blocks. What held the real window for minutes at 20 MB was the reading
// going into the article whole: one root holding every paragraph, laid out and typeset at once, and one long run of sibling
// paragraphs that the engine restyled whole for every paragraph the typesetter set. The bound is source-open-stall's.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, harnessBase, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

/** The longest the main thread may be held at once after first text, in milliseconds (source-open-stall.test.mjs). */
const HELD_MS = 500;

/** Plain prose, the shape of the hunt's generator (scratch/L/gen.mjs): sentences, a blank line every six. */
function plainProse(bytes) {
  const words = 'the reader keeps a place in a long text and the page holds it while the window moves around it quietly'.split(' ');
  const out = [];
  let n = 0;
  for (let i = 0; n < bytes; i++) {
    const w = [];
    for (let k = 0; k < 18; k++) w.push(words[(i * 7 + k * 3) % words.length]);
    const piece = `${w.join(' ')}. ${i % 6 === 5 ? '\n\n' : ''}`;
    out.push(piece);
    n += piece.length;
  }
  return out.join('');
}

test('a 2 MB plain .txt is mounted in runs and never holds the page for long once its first text is up', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const base = await harnessBase();
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const files = { '/n/small.md': b64('# Small\n\nShort.\n'), '/n/big.txt': b64(plainProse(2 * 1024 * 1024)) };
    const seen = await page.evaluate(async (files) => {
      const bytes = {};
      for (const [path, b] of Object.entries(files)) bytes[path] = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const h = await startApp(createMemoryShell(bytes), { argv: ['/n/small.md'] });
      await h.ready;
      const doc = document.getElementById('doc');
      const t0 = performance.now();
      const out = { text: null, runsAtText: 0, longest: 0, at: 0, runs: 0, reading: null, complete: null };
      let beat = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        const held = now - beat - 10;
        if (out.text !== null && held > out.longest) {
          out.longest = held;
          out.at = beat - t0;
        }
        beat = now;
      }, 10);
      const look = () => {
        if (out.text !== null) return;
        const root = doc.querySelector('[data-marxy-reading]');
        if (root?.querySelector('p')) {
          out.text = performance.now() - t0;
          out.runsAtText = root.querySelectorAll(':scope > .marxy-reading-run').length;
        }
      };
      const mo = new MutationObserver(look);
      mo.observe(doc, { subtree: true, childList: true });
      await h.open('/n/big.txt');
      look();
      await h.contentComplete();
      out.complete = performance.now() - t0;
      // Past the mount: the typesetter's background passes and the grid passes they ask for.
      await new Promise((r) => setTimeout(r, 8_000));
      clearInterval(timer);
      mo.disconnect();
      const root = doc.querySelector('[data-marxy-reading]');
      out.reading = root?.getAttribute('data-marxy-reading') ?? null;
      out.runs = root?.querySelectorAll(':scope > .marxy-reading-run').length ?? 0;
      out.paragraphs = root?.querySelectorAll('p[data-marxy-s]').length ?? 0;
      return out;
    }, files);
    console.log(`2 MB .txt: first text ${Math.round(seen.text)} ms with ${seen.runsAtText} of ${seen.runs} runs, complete at ${Math.round(seen.complete)} ms, held at most ${Math.round(seen.longest)} ms at a time after first text (at ${Math.round(seen.at)} ms)`);
    assert.equal(seen.reading, 'prose');
    assert.ok(seen.text !== null, 'the page shows its first text');
    assert.ok(seen.longest < HELD_MS, `the page was held ${Math.round(seen.longest)} ms at ${Math.round(seen.at)} ms, after first text at ${Math.round(seen.text)} ms`);
    assert.ok(seen.runs > 50, `${seen.runs} runs`);
    assert.ok(seen.runsAtText < seen.runs, `first text with ${seen.runsAtText} of ${seen.runs} runs in`);
    assert.ok(seen.paragraphs > 3000, `${seen.paragraphs} paragraphs, every one in once complete`);
  } finally {
    await browser.close();
  }
});

// A plain reading never reads the Markdown parse of its file: it is set from the bytes, so its first text does not
// wait for that parse (about 30 s at 2 MB here before, the whole of the time to first text). The parse is made behind the
// page, in slices, once the page is complete, for what does read it (the selection, Source, the outline).
test('a 2 MB plain .txt shows its first text before any Markdown parse, and is parsed behind the page after', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const base = await harnessBase();
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const files = { '/n/small.md': b64('# Small\n\nShort.\n'), '/n/big.txt': b64(plainProse(2 * 1024 * 1024)) };
    const seen = await page.evaluate(async (files) => {
      const bytes = {};
      for (const [path, b] of Object.entries(files)) bytes[path] = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const h = await startApp(createMemoryShell(bytes), { argv: ['/n/small.md'] });
      await h.ready;
      const doc = document.getElementById('doc');
      const t0 = performance.now();
      const out = { text: null, parsedAtText: null, parsedAt: null, blocks: 0, reading: null };
      const look = () => {
        if (out.text !== null || !doc.querySelector('[data-marxy-reading] p')) return;
        out.text = performance.now() - t0;
        out.parsedAtText = h.document().parsed();
      };
      const mo = new MutationObserver(look);
      mo.observe(doc, { subtree: true, childList: true });
      await h.open('/n/big.txt');
      look();
      mo.disconnect();
      await h.contentComplete();
      while (!h.document().parsed() && performance.now() - t0 < 120_000) await new Promise((r) => setTimeout(r, 100));
      if (h.document().parsed()) out.parsedAt = performance.now() - t0;
      out.blocks = h.document().snapshot().ast.children.length;
      out.reading = doc.querySelector('[data-marxy-reading]')?.getAttribute('data-marxy-reading') ?? null;
      return out;
    }, files);
    console.log(`2 MB .txt: first text ${Math.round(seen.text)} ms (parsed then: ${seen.parsedAtText}), parsed behind the page at ${Math.round(seen.parsedAt)} ms, ${seen.blocks} blocks`);
    assert.equal(seen.reading, 'prose');
    assert.equal(seen.parsedAtText, false, 'the first text came before any Markdown parse');
    assert.ok(seen.text < 10_000, `first text at ${Math.round(seen.text)} ms`);
    assert.ok(seen.parsedAt !== null, 'the parse was made behind the page');
    assert.ok(seen.blocks > 1000, `${seen.blocks} blocks in the parse`);
  } finally {
    await browser.close();
  }
});

// A text with no blank line is one Markdown paragraph, which the slices cannot cut: its parse was one task of seconds (4.7 s
// at 4.9 MB) made behind the page. It is not made behind the page now; the store makes it when something asks for it.
test('a plain .txt of 2 MB with no blank line is shown, held no longer than the page needs, and not parsed behind it', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const base = await harnessBase();
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const files = { '/n/small.md': b64('# Small\n\nShort.\n'), '/n/solid.txt': b64(plainProse(2 * 1024 * 1024).replace(/\n\n/g, '\n')) };
    const seen = await page.evaluate(async (files) => {
      const bytes = {};
      for (const [path, b] of Object.entries(files)) bytes[path] = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const h = await startApp(createMemoryShell(bytes), { argv: ['/n/small.md'] });
      await h.ready;
      const out = { longest: 0, parsedBehind: null, blocks: 0 };
      let beat = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        out.longest = Math.max(out.longest, now - beat - 10);
        beat = now;
      }, 10);
      await h.open('/n/solid.txt');
      await h.contentComplete();
      beat = performance.now();
      await new Promise((r) => setTimeout(r, 6000));
      out.parsedBehind = h.document().parsed();
      clearInterval(timer);
      out.blocks = h.document().snapshot().ast.children.length;
      return out;
    }, files);
    console.log(`2 MB .txt with no blank line: longest hold ${Math.round(seen.longest)} ms from the open to 6 s after it is complete, parsed behind the page: ${seen.parsedBehind}`);
    assert.equal(seen.parsedBehind, false, 'no parse of one uncuttable paragraph behind the page');
    assert.ok(seen.longest < HELD_MS * 2, `held for ${Math.round(seen.longest)} ms`);
    assert.equal(seen.blocks, 1, 'asked for, the parse is the file’s: one paragraph');
  } finally {
    await browser.close();
  }
});
