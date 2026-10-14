// F-107: tabs whose names share a prefix stay distinguishable. Twelve tabs whose names share their first 20+ characters, in the
// unfolded window (the real app, shipped CSS, WebKit). What the reader can read of each name must differ from every other tab's,
// and a name that fits is drawn whole, at the box it always had.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const dated = Array.from({ length: 12 }, (_, i) => `/q/2026-10-01-quarterly-planning-review-draft-${i + 1}.md`);
const files = (list) => Object.fromEntries(list.map((p, i) => [p, `# T${i}\n\nbody\n`]));

async function withRow(list, fn, width = 1400) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await bootTwoPanes(page, { files: files(list), open: [list[0]] });
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    for (const p of list.slice(1)) {
      await page.evaluate((p) => window.__marxyHandle.open(p), p);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 40)));
    }
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
    await page.mouse.move(5, 500);
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** What is readable of each tab's name: the characters whose boxes lie inside every clipping ancestor up to the tab. */
const visibleLabels = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-tab')].map((tab) => {
      const name = tab.querySelector('.marxy-tab-name');
      const clip = tab.querySelector('.marxy-tab-open').getBoundingClientRect();
      const walker = document.createTreeWalker(name, NodeFilter.SHOW_TEXT);
      let out = '';
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const own = n.parentElement.getBoundingClientRect();
        const r = document.createRange();
        for (let i = 0; i < n.length; i++) {
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          const b = r.getBoundingClientRect();
          if (b.width > 0 && b.right <= Math.min(own.right, clip.right) + 0.5 && b.left >= own.left - 0.5) out += n.data[i];
        }
      }
      return out;
    }),
  );

test('twelve tabs sharing a long prefix: no two tabs show the same label', async () => {
  await withRow(dated, async (page) => {
    const labels = await visibleLabels(page);
    assert.equal(new Set(labels).size, labels.length, `labels repeat: ${JSON.stringify(labels)}`);
    for (const [i, l] of labels.entries()) assert.ok(l.endsWith(`draft-${i + 1}.md`), `tab ${i + 1} shows ${JSON.stringify(l)}, not its ending`);
  });
});

test('the same holds at 1000 px and for dated names that differ only in the day', async () => {
  const days = Array.from({ length: 12 }, (_, i) => `/d/2026-10-${String(i + 1).padStart(2, '0')}.md`);
  await withRow(days, async (page) => {
    const labels = await visibleLabels(page);
    assert.equal(new Set(labels).size, labels.length, `labels repeat: ${JSON.stringify(labels)}`);
  }, 1000);
  await withRow(dated, async (page) => {
    const labels = await visibleLabels(page);
    assert.equal(new Set(labels).size, labels.length, `labels repeat: ${JSON.stringify(labels)}`);
  }, 1000);
});

test('a name that fits is drawn whole, in the box an unsplit name would have (0 px)', async () => {
  const few = ['/s/Alpha.md', '/s/Bravo Tango.md', '/s/2026-10-01.md'];
  await withRow(few, async (page) => {
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('.marxy-tab-name')].map((name) => {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit';
        probe.textContent = name.textContent;
        name.parentElement.append(probe);
        const w = probe.getBoundingClientRect().width;
        probe.remove();
        return { text: name.textContent, box: name.getBoundingClientRect().width, plain: w, clipped: name.scrollWidth > name.clientWidth };
      }),
    );
    for (const x of r) {
      assert.equal(x.clipped, false, `${x.text} is cut`);
      assert.ok(x.box >= x.plain - 0.01 && x.box - x.plain < 8, `${x.text}: box ${x.box}px against the plain name ${x.plain}px`);
    }
    assert.deepEqual(await visibleLabels(page), ['Alpha.md', 'Bravo Tango.md', '2026-10-01.md']);
  });
});

test('graphemes are never torn, and a right-to-left name stays one run in reading order', async () => {
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
  const list = [`/e/family-${family}${family}${family}-notes.md`, '/e/שלום-עולם-מסמך-ארוך-מאוד-לבדיקה.md', '/e/Café-menu-of-the-day-final.md'];
  await withRow(list, async (page) => {
    const r = await page.evaluate(() => {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const count = (t) => [...seg.segment(t)].length;
      return [...document.querySelectorAll('.marxy-tab-name')].map((n) => {
        const head = n.querySelector('.marxy-tab-name-head')?.textContent ?? null;
        const tail = n.querySelector('.marxy-tab-name-tail')?.textContent ?? null;
        return { full: n.getAttribute('data-marxy-text'), text: n.querySelector('.marxy-tab-name-text').textContent, head, tail, parts: head === null ? 1 : count(head) + count(tail), whole: count(n.getAttribute('data-marxy-text')) };
      });
    });
    const [emoji, hebrew, accent] = r;
    for (const x of r) assert.equal(x.text, x.full, 'the name is whole in the text');
    assert.notEqual(emoji.tail, null);
    assert.equal(emoji.parts, emoji.whole, 'no grapheme is split between head and tail');
    assert.ok(!emoji.tail.startsWith('‍') && !emoji.head.endsWith('‍'), 'no ZWJ sequence is torn');
    assert.equal(accent.parts, accent.whole);
    assert.ok(!accent.tail.startsWith('́'), 'a combining mark stays with its letter');
    assert.equal(hebrew.head, null, 'a right-to-left name is one run (end ellipsis), so its words keep their order');
  });
});
