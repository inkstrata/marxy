// The reading-page lookup on a Markdown page: a page with no reading is scanned once per drawing, not once per key, and a
// reading that arrives or leaves afterwards (a node added, an attribute set, a fence opened) is still found.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const LONG = readFileSync(new URL('../../../fixtures/corpus/32-long-reference.md', import.meta.url), 'utf8');
const FILES = { '/r/long.md': LONG };

/** Counts the whole-article scans for a reading page from here on; `read()` returns the count and starts it again. */
const countScans = (page) =>
  page.evaluate(() => {
    const orig = Element.prototype.querySelectorAll;
    const c = (window.__scans = { n: 0 });
    Element.prototype.querySelectorAll = function (sel) {
      if (typeof sel === 'string' && sel.includes('[data-marxy-reading]')) c.n++;
      return orig.call(this, sel);
    };
  });
const scans = (page) => page.evaluate(() => window.__scans.n);

const lookup = (page) =>
  page.evaluate(async () => {
    const { readingPage } = await import('/src/parts/reading-parts.ts');
    return readingPage(document.querySelector('[data-marxy-pane="0"] .marxy-article'));
  });

test('keys on a long Markdown page scan it for a reading page once, not once per key', async () => {
  await withFrame({ files: FILES, open: ['/r/long.md'] }, async (page) => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('j');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor'));
    // The page is set a few paragraphs a frame; the count starts once 30 frames have passed with nothing added to it.
    await page.evaluate(
      () =>
        new Promise((done) => {
          const a = document.querySelector('[data-marxy-pane="0"] .marxy-article');
          let quiet = 0;
          const obs = new MutationObserver(() => (quiet = 0));
          obs.observe(a, { childList: true, subtree: true });
          const tick = () => {
            if (++quiet >= 30) {
              obs.disconnect();
              done();
            } else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    await countScans(page);
    const heads = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('j');
      heads.push(await page.evaluate(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor')?.getAttribute('data-marxy-s')));
    }
    assert.equal(new Set(heads).size, 6, 'each j moved the cursor');
    assert.ok((await scans(page)) <= 1, `six keys made ${await scans(page)} scans`);
  });
});

test('a reading root that arrives after the first look is found, and one that leaves is forgotten', async () => {
  await withFrame({ files: FILES, open: ['/r/long.md'] }, async (page) => {
    assert.equal(await lookup(page), false, 'a Markdown page has no reading');
    const steps = await page.evaluate(async () => {
      const { readingPage, readingRoot } = await import('/src/parts/reading-parts.ts');
      const a = document.querySelector('[data-marxy-pane="0"] .marxy-article');
      const out = {};
      // Added in the same task as the look before it: no observer callback has run yet.
      const d = document.createElement('div');
      d.setAttribute('data-marxy-reading', 'table');
      a.append(d);
      out.added = readingRoot(a) === d;
      d.remove();
      out.removed = readingPage(a);
      // An attribute set on an element already there.
      const p = a.querySelector('p');
      p.setAttribute('data-marxy-derived', 'x');
      out.attribute = readingRoot(a) === p;
      p.removeAttribute('data-marxy-derived');
      out.attributeGone = readingPage(a);
      // A run: a `pre` that gains its classes after it is in.
      const pre = document.createElement('pre');
      a.append(pre);
      out.bare = readingPage(a);
      pre.className = 'language-log marxy-run';
      out.run = readingRoot(a) === pre;
      // A fence: a reading inside a fenced part is not the page's, and is when the fence goes.
      pre.className = 'language-diff marxy-run';
      const fence = document.createElement('div');
      fence.append(pre);
      a.append(fence);
      out.inFence = (() => {
        fence.className = 'marxy-part';
        return readingPage(a);
      })();
      fence.className = '';
      out.outOfFence = readingPage(a);
      // The article emptied and drawn again with a reading.
      a.replaceChildren();
      out.emptied = readingPage(a);
      const t = document.createElement('div');
      t.setAttribute('data-marxy-reading', 'tree');
      a.replaceChildren(t);
      out.redrawn = readingRoot(a) === t;
      return out;
    });
    assert.deepEqual(steps, { added: true, removed: false, attribute: true, attributeGone: false, bare: false, run: true, inFence: false, outOfFence: true, emptied: false, redrawn: true });
  });
});

test('typing in Source leaves the facts bar alone when its facts did not change', async () => {
  await withFrame({ files: { '/r/short.md': '# Title\n\nSome text here.\n' }, open: ['/r/short.md'] }, async (page) => {
    await page.evaluate(() => window.__marxyHandle.panes().focused.view.setMode('source'));
    await page.waitForSelector('.marxy-source-facts .marxy-source-fact');
    await page.locator('.cm-content').click();
    await page.keyboard.press('End');
    await page.keyboard.type('ab');
    await page.evaluate(
      () =>
        new Promise((done) => {
          window.__writes = 0;
          const facts = document.querySelector('.marxy-source-facts');
          window.__obs = new MutationObserver((rs) => (window.__writes += rs.length));
          window.__obs.observe(facts, { attributes: true, subtree: true, attributeFilter: ['hidden', 'title'] });
          requestAnimationFrame(() => requestAnimationFrame(done));
        }),
    );
    await page.keyboard.type('cd');
    // The facts are read after each key; two frames let them land.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
    const writes = await page.evaluate(() => (window.__obs.takeRecords().length + window.__writes));
    assert.equal(writes, 0, 'no hidden or title attribute was written');
  });
});
