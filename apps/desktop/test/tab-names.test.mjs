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

/**
 * What is readable of each tab's name: a cut name is drawn by its two ends (`::before` the head, `::after` the tail), so the head's
 * characters are those that fit in the width the browser gave `::before` less an ellipsis, measured in the name's own face; a
 * whole name is the characters whose boxes lie inside the tab.
 */
const visibleLabels = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-tab')].map((tab) => {
      const name = tab.querySelector('.marxy-tab-name');
      const text = name.querySelector('.marxy-tab-name-text');
      if (text.hasAttribute('data-marxy-tail')) {
        const ctx = document.createElement('canvas').getContext('2d');
        const cs = getComputedStyle(text);
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const head = text.getAttribute('data-marxy-head');
        const box = parseFloat(getComputedStyle(text, '::before').width);
        if (box >= ctx.measureText(head).width - 0.5) return head + text.getAttribute('data-marxy-tail');
        const room = box - ctx.measureText('\u2026').width;
        let shown = '';
        for (const ch of head) {
          if (ctx.measureText(shown + ch).width > room + 0.5) break;
          shown += ch;
        }
        return (shown === head ? shown : `${shown}\u2026`) + text.getAttribute('data-marxy-tail');
      }
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
        const run = n.querySelector('.marxy-tab-name-text');
        const head = run.getAttribute('data-marxy-head');
        const tail = run.getAttribute('data-marxy-tail');
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

test('F-107.1: the name of a cut tab reads as one line, whole, to a copy or a screen reader', async () => {
  await withRow(dated.slice(0, 4), async (page) => {
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('.marxy-tab-name')].map((n) => ({
        full: n.getAttribute('data-marxy-text'),
        inner: n.innerText,
        text: n.textContent,
        cut: n.querySelector('.marxy-tab-name-text').hasAttribute('data-marxy-tail'),
      })),
    );
    assert.ok(r.every((x) => x.cut), 'these names are cut');
    for (const x of r) {
      assert.ok(!/[\r\n]/.test(x.inner), `innerText of ${x.full} holds a line break: ${JSON.stringify(x.inner)}`);
      assert.equal(x.inner, x.full);
      assert.equal(x.text, x.full);
    }
  });
});

test('F-107.1: a cut name\'s ellipsis meets its tail the same on the active (bold) tab as on an inactive one', async () => {
  await withRow(dated.slice(0, 4), async (page) => {
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('.marxy-tab')].map((tab) => {
        const text = tab.querySelector('.marxy-tab-name-text');
        const before = parseFloat(getComputedStyle(text, '::before').width);
        const after = parseFloat(getComputedStyle(text, '::after').width);
        const ctx = document.createElement('canvas').getContext('2d');
        const cs = getComputedStyle(text);
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const head = text.getAttribute('data-marxy-head');
        let fit = '';
        for (const ch of head) {
          if (ctx.measureText(fit + ch).width > before - ctx.measureText('\u2026').width + 0.5) break;
          fit += ch;
        }
        // The room left between the last whole character and the ellipsis's own box edge: the same hole in every tab, under one glyph wide.
        return { active: tab.hasAttribute('data-marxy-tab-active'), lead: before - ctx.measureText(`${fit}\u2026`).width, glyph: ctx.measureText('m').width, join: before + after - text.getBoundingClientRect().width };
      }),
    );
    assert.ok(r.some((x) => x.active) && r.some((x) => !x.active));
    for (const x of r) {
      assert.ok(Math.abs(x.join) < 0.5, `the ends fill the run exactly (off by ${x.join}px, active ${x.active})`);
      assert.ok(x.lead >= -0.5 && x.lead < x.glyph, `the gap before the ellipsis is under a glyph (${x.lead}px, active ${x.active})`);
    }
  });
});

const tabBoxes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-tab')].map((t) => {
      const r = t.getBoundingClientRect();
      const dot = t.querySelector('.marxy-tab-dirty');
      return { path: t.getAttribute('data-marxy-tab'), left: r.left, width: r.width, active: t.hasAttribute('data-marxy-tab-active'), dot: !dot.hidden && getComputedStyle(dot).visibility === 'visible' };
    }),
  );

// A tab is dirty only while a pane holds its document, so the two tabs to compare are the pane in focus (the active tab) and the
// pane beside it (an inactive one). Leaving a dirty document asks first, which is why the test does not click between tabs.
test('F-99.1: a tab is as wide, and its neighbours as far along, dirty as clean, active or not', async () => {
  for (const list of [['/s/Alpha.md', '/s/Bravo Tango.md'], dated.slice(0, 2)]) {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await bootTwoPanes(page, { files: files(list), open: list });
      await page.evaluate(() => window.__marxyHandle.workspace().unfold());
      await page.mouse.move(5, 500);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
      const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
      const focusSlot = async (slot) => {
        await page.keyboard.press(`${mod}+Alt+Arrow${slot === 1 ? 'Right' : 'Left'}`);
        await page.waitForFunction((s) => window.__marxyHandle.panes().focused.slot === s, slot);
        await page.mouse.move(5, 500);
        await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
      };
      const typeInFocused = () =>
        page.evaluate(async () => {
          const h = window.__marxyHandle;
          const snap = h.panes().focused.content.store().snapshot();
          const end = snap.buffer.bytes.length;
          await h.dispatch({ type: 'apply', range: { start: end, end }, replacement: 'x', label: 'type', baseVersion: snap.version });
        });
      // The same tab is active when clean and when dirty, so only the dot differs between the two measures.
      await focusSlot(1);
      const clean = await tabBoxes(page);
      assert.equal(clean.length, 2);
      assert.ok(clean.every((t) => !t.dot), 'no tab is dirty yet');
      await typeInFocused();
      await focusSlot(0);
      await typeInFocused();
      await focusSlot(1);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
      const dirty = await tabBoxes(page);
      assert.ok(dirty.every((t) => t.dot), `every tab shows its dot: ${JSON.stringify(dirty)}`);
      assert.ok(dirty.some((t) => t.active) && dirty.some((t) => !t.active), 'one active tab, one not');
      for (const [i, c] of clean.entries()) {
        assert.ok(Math.abs(dirty[i].width - c.width) < 0.01, `${c.path} is ${c.width}px clean and ${dirty[i].width}px dirty`);
        assert.ok(Math.abs(dirty[i].left - c.left) < 0.01, `${c.path} starts at ${c.left}px clean and ${dirty[i].left}px dirty`);
      }
    } finally {
      await browser.close();
    }
  }
});
