// What the view does around the typesetter: the block list patched where blocks changed (checked against one built
// whole each time the view patches it, through the app's own paths), the reading position searched in place and
// following the page, and a page that is thrown away left as it was set. Counted, not timed. WebKit, over the shipped
// skeleton and the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 400_000 }, fn);
after(() => closeHarness());

const sentence = (n) => `Sentence ${n} of the reader keeps a place on the page while paragraphs are set line by line and the rag is balanced.`;

/** Prose with a heading, a list, a quote and a piece of code among it, `blocks` top-level blocks long. */
function markdown(blocks) {
  const out = [];
  for (let n = 0; n < blocks; n++) {
    out.push(
      n % 30 === 0 ? `## Part ${n / 30 + 1}`
        : n % 13 === 0 ? `- ${sentence(n)}\n- ${sentence(n + 1)} ${sentence(n + 2)}`
        : n % 19 === 0 ? `> ${sentence(n)} ${sentence(n + 1)}`
        : n % 23 === 0 ? '```js\nconst x = 1;\nconst y = 2;\n```'
        : Array.from({ length: 4 }, (_, i) => sentence(n + i)).join(' '),
    );
  }
  return `${out.join('\n\n')}\n`;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="317"><rect width="300" height="317" fill="#888"/></svg>';
const MATHS = ['$$', String.raw`\sum_{k=1}^{n} k = \frac{n(n+1)}{2}`, '$$'].join('\n');
const CODE = ['```js', 'const x = 1;', 'const y = 2;', '```'].join('\n');

/** Prose with images, maths, code and lists among it: every kind of block that changes height after it is first drawn. */
function mixed() {
  const out = [];
  for (let n = 0; n < 700; n++) {
    out.push(
      n % 30 === 0 ? `## Part ${n}`
        : n % 37 === 0 ? `![pic](./pic${n}.svg)`
        : n % 41 === 0 ? MATHS
        : n % 13 === 0 ? `- ${sentence(n)}\n- ${sentence(n + 1)} ${sentence(n + 2)}`
        : n % 23 === 0 ? CODE
        : n % 29 === 0 ? `Inline maths $E = mc^2$ here. ${sentence(n)} ${sentence(n + 1)}`
        : Array.from({ length: 4 }, (_, i) => sentence(n + i)).join(' '),
    );
  }
  return `${out.join('\n\n')}\n`;
}

async function boot(page, files, first) {
  const base = await harnessBase();
  await routeSkeleton(page, base);
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, first }) => {
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const { startApp } = await import('/src/app.ts');
    const bytes = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]));
    window.__typesetDone = false;
    const shell = createMemoryShell(bytes);
    const mark = shell.mark.bind(shell);
    shell.mark = async (name, t, data) => {
      if (name === 'typeset_done') window.__typesetDone = true;
      return mark(name, t, data);
    };
    const handle = await startApp(shell, { argv: [first] });
    window.__marxyHandle = handle;
    await handle.ready;
  }, { files, first });
}

async function openMarkdown(page, files, first) {
  await boot(page, files, first);
  await page.evaluate(() => window.__marxyHandle.contentComplete());
  await page.waitForFunction(() => window.__typesetDone, null, { timeout: 300_000, polling: 250 });
  await page.evaluate(() => document.fonts.ready);
}

test('every block list the view patches equals one built whole, through colour, images, maths, chunks, a width change, a splice and typesetting passes', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const files = { '/r/long.md': mixed() };
    for (let n = 0; n < 700; n++) if (n % 37 === 0) files[`/r/pic${n}.svg`] = SVG;
    files['/r/ref.md'] = readFileSync(new URL('../../../fixtures/corpus/32-long-reference.md', import.meta.url), 'utf8');
    const base = await harnessBase();
    await routeSkeleton(page, base);
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    // Each list the view patches is compared with one built whole, in the same task, before anything else can change the page.
    await page.evaluate(async () => {
      const { blockListStats } = await import('/src/view/block-list.ts');
      const { buildBlocks } = await import('/src/render/post.ts');
      window.__mismatches = [];
      window.__stats = blockListStats;
      blockListStats.verify = (patched, article, map) => {
        const fresh = buildBlocks(article, map);
        const same = patched.length === fresh.length
          && patched.every((b, i) => b.el === fresh[i].el && b.start === fresh[i].start && Math.abs(b.top - fresh[i].top) < 0.5 && Math.abs(b.height - fresh[i].height) < 0.5);
        if (same) return;
        const at = patched.findIndex((b, i) => !fresh[i] || b.el !== fresh[i].el || Math.abs(b.top - fresh[i].top) >= 0.5 || Math.abs(b.height - fresh[i].height) >= 0.5);
        const b = patched[at];
        const f = fresh[at];
        window.__mismatches.push({ patched: patched.length, fresh: fresh.length, at, tag: b?.el.tagName, freshTag: f?.el.tagName, top: [b?.top, f?.top], height: [b?.height, f?.height], cls: b?.el.className });
      };
    });
    await page.evaluate(async ({ files }) => {
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const bytes = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]));
      const handle = await startApp(createMemoryShell(bytes), { argv: ['/r/long.md'] });
      window.__marxyHandle = handle;
      await handle.ready;
    }, { files });
    const scrollThrough = async () => {
      for (let i = 0; i < 30; i++) {
        await page.evaluate(() => {
          window.__marxyHandle.panes().panes[0].view.scroller.scrollTop += 1400;
        });
        await page.waitForTimeout(60);
      }
    };
    await scrollThrough();
    await page.waitForTimeout(3000);
    await page.setViewportSize({ width: 820, height: 900 });
    await scrollThrough();
    await page.waitForTimeout(2000);
    await page.setViewportSize({ width: 1400, height: 900 });
    await scrollThrough();
    await page.waitForTimeout(2000);
    await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const path = handle.currentPath();
      const text = new TextDecoder().decode(await handle.shell.readFile(path));
      const added = 'A new paragraph an outside editor wrote, long enough to wrap a line or two on the page when it is set.\n\n';
      await handle.shell.writeFileAtomic(path, new TextEncoder().encode(text.replace('## Part 300\n', `${added}## Part 300\n`)));
      handle.shell.emit([{ kind: 'modified', path }]);
      await new Promise((res) => setTimeout(res, 1500));
    });
    await scrollThrough();
    await page.waitForTimeout(2000);
    await page.evaluate(async () => {
      const view = window.__marxyHandle.panes().panes[0].view;
      await view.toggleMode();
      await new Promise((res) => setTimeout(res, 300));
      await view.toggleMode();
    });
    await scrollThrough();
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__marxyHandle.open('/r/ref.md'));
    await scrollThrough();
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => ({ mismatches: window.__mismatches, patched: window.__stats.patched, whole: window.__stats.whole }));
    console.log(`block list updates: ${r.patched} patched, ${r.whole} built whole, ${r.mismatches.length} mismatches`);
    assert.deepEqual(r.mismatches, [], 'a patched list differed from one built whole');
    assert.ok(r.patched >= 10, `the patch path was taken ${r.patched} times (${r.whole} built whole)`);
  } finally {
    await browser.close();
  }
});

test('a block that grew with no report (a details opened, a block edited in place) keeps the list from being patched past it', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const parts = Array.from({ length: 400 }, (_, n) => (n === 300 ? '![pic](./pic.svg)' : n % 30 === 0 ? `## Part ${n}` : `${sentence(n)} ${sentence(n + 1)}`));
    await openMarkdown(page, { '/r/long.md': `${parts.join('\n\n')}\n`, '/r/pic.svg': SVG }, '/r/long.md');
    const r = await page.evaluate(async () => {
      const { blockListStats } = await import('/src/view/block-list.ts');
      const { buildBlocks } = await import('/src/render/post.ts');
      const view = window.__marxyHandle.panes().panes[0].view;
      const article = document.getElementById('doc');
      const before = { patched: blockListStats.patched, whole: blockListStats.whole };
      // Far above the image, nothing told: then the image is sized, which the view hears of and answers.
      article.children[50].style.paddingBottom = '96px';
      article.querySelector('img').style.height = '500px';
      await new Promise((res) => setTimeout(res, 1500));
      const list = view.document().blocks;
      const fresh = buildBlocks(article, view.document().nodeMap);
      const stale = fresh.filter((f, i) => !list[i] || list[i].el !== f.el || Math.abs(list[i].top - f.top) >= 0.5 || Math.abs(list[i].height - f.height) >= 0.5).length;
      return { stale, updates: blockListStats.patched + blockListStats.whole - before.patched - before.whole };
    });
    assert.ok(r.updates >= 1, 'the image sizing reached the block list');
    assert.equal(r.stale, 0, `${r.stale} entries differ from a list built whole`);
  } finally {
    await browser.close();
  }
});

test('the reading position is searched where the list stands, not in a copy of it, and follows the page moving under it', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openMarkdown(page, { '/r/long.md': markdown(300) }, '/r/long.md');
    const r = await page.evaluate(async () => {
      const view = window.__marxyHandle.panes().panes[0].view;
      const article = document.getElementById('doc');
      const frame = () => new Promise((res) => requestAnimationFrame(res));
      document.documentElement.scrollTop = 4000;
      await frame();
      await frame();
      let copies = 0;
      const map = Array.prototype.map;
      Array.prototype.map = function (...args) {
        if (this.length > 100) copies++;
        return map.apply(this, args);
      };
      const first = view.position();
      Array.prototype.map = map;
      // The page moves under the reader in the same task: the next answer is for the page as it stands.
      const spacer = document.createElement('div');
      spacer.style.height = '600px';
      article.before(spacer);
      const moved = view.position();
      spacer.remove();
      return { copies, first: first.byteOffset, moved: moved.byteOffset };
    });
    assert.equal(r.copies, 0, `the position copied the block list ${r.copies} times`);
    assert.ok(r.moved < r.first, `after 600 px came in above the page the position is earlier (${r.first} to ${r.moved})`);
  } finally {
    await browser.close();
  }
});

test('opening another document leaves the paragraphs it replaces as they were set: no write inside them first', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openMarkdown(page, { '/r/long.md': markdown(300), '/r/other.md': '# Other\n\nA short page.\n' }, '/r/long.md');
    const r = await page.evaluate(async () => {
      const article = document.getElementById('doc');
      const set = article.querySelectorAll('.marxy-set').length;
      const records = [];
      const observer = new MutationObserver((list) => records.push(...list));
      observer.observe(article, { subtree: true, childList: true, characterData: true, attributes: true });
      await window.__marxyHandle.open('/r/other.md');
      await new Promise((res) => setTimeout(res, 300));
      records.push(...observer.takeRecords());
      observer.disconnect();
      return { set, inside: records.filter((rec) => rec.target !== article).length, title: article.querySelector('h1')?.textContent ?? null };
    });
    assert.ok(r.set > 100, `${r.set} paragraphs set before the open`);
    assert.equal(r.title, 'Other');
    // Putting every paragraph back would be a write inside each of them: hundreds of records.
    assert.ok(r.inside <= 20, `${r.inside} writes inside the old page while it was replaced`);
  } finally {
    await browser.close();
  }
});
