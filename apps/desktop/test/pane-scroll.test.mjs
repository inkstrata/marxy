// Each pane its own scroller (D-05): with two panes each section scrolls on its own and its view reads
// and holds its place there; with one pane the window scrolls as it always has, and splitting and
// closing keep the reader on the same block. Booted on the shipped skeleton and CSS
// (test/support/two-pane.mjs), over the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

// The `para` of test/live-reload.test.mjs, twelve separate paragraphs (blocks) per document.
const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';
const doc = (word) =>
  `# ${word}\n\n${Array.from({ length: 12 }, (_, i) => para(`${word} ${i + 1}`).repeat(2).trim()).join('\n\n')}\n`;
const files = { '/r/A.md': doc('Alpha'), '/r/B.md': doc('Bravo'), '/r/D.md': doc('Delta') };

async function withPage(fn, viewport = { width: 1470, height: 700 }) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport });
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Until the window and every pane have held their height for ten 100 ms samples (test/settle.mjs, per pane). */
async function settle(page) {
  await page.evaluate(async () => {
    const heights = () =>
      [document.documentElement, ...document.querySelectorAll('section.marxy-pane')].map((el) => el.scrollHeight).join();
    let last = '';
    let still = 0;
    while (still < 10) {
      await new Promise((r) => setTimeout(r, 100));
      const h = heights();
      if (h === last) still++;
      else { still = 0; last = h; }
    }
  });
}

/** Two frames: a scroll's event and the listeners it wakes have run. */
/** Until every pane and the window have held their scroll for five frames (a smooth scroll has ended). */
const scrollsSettled = (page) =>
  page.evaluate(async () => {
    const tops = () => [document.documentElement, ...document.querySelectorAll('section.marxy-pane')].map((el) => el.scrollTop).join();
    let last = '';
    let still = 0;
    while (still < 5) {
      await new Promise((r) => requestAnimationFrame(r));
      const t = tops();
      if (t === last) still++;
      else { still = 0; last = t; }
    }
  });

const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Each pane's scrollTop, its view's place and the window's scroll. */
const state = (page) =>
  page.evaluate(() => {
    const panes = window.__marxyHandle.panes().panes;
    return {
      window: document.documentElement.scrollTop,
      panes: panes.map((pane) => ({
        scrollTop: pane.host.scrollTop,
        byteOffset: pane.view.sourceHarness()?.byteOffset ?? null,
        scrollsHost: pane.view.scroller === pane.host,
      })),
    };
  });

test('two panes: scrolling the right pane leaves the left pane where it was, and each view reads its own', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await settle(page);
    // The left pane scrolled on its own: its view reads its place from its own section, not the window.
    await page.evaluate(() => { window.__marxyHandle.panes().panes[0].host.scrollTop = 600; });
    await frames(page);
    const before = await state(page);
    assert.equal(before.window, 0, 'the window does not scroll while two panes are shown');
    assert.deepEqual(before.panes.map((p) => p.scrollsHost), [true, true]);
    assert.equal(before.panes[0].scrollTop, 600);
    assert.ok(before.panes[0].byteOffset > 0, `the left view reads its own pane (byteOffset ${before.panes[0].byteOffset})`);
    await page.evaluate(() => { window.__marxyHandle.panes().panes[1].host.scrollTop = 400; });
    await frames(page);
    const afterRight = await state(page);
    assert.equal(afterRight.panes[1].scrollTop, 400);
    assert.ok(afterRight.panes[1].byteOffset > 0, 'the right view reads its own pane');
    assert.equal(afterRight.panes[0].scrollTop, before.panes[0].scrollTop, 'the left pane did not move');
    assert.equal(afterRight.panes[0].byteOffset, before.panes[0].byteOffset, "the left pane's place did not move");
  });
});

test('the mouse wheel over a pane scrolls only that pane, and its view follows', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await settle(page);
    await page.mouse.move(1100, 350);
    await page.mouse.wheel(0, 500);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].host.scrollTop > 0);
    await scrollsSettled(page);
    const right = await state(page);
    assert.equal(right.panes[0].scrollTop, 0, 'the left pane did not scroll');
    assert.equal(right.window, 0);
    assert.equal(right.panes[0].byteOffset, 0);
    assert.ok(right.panes[1].byteOffset > 0);
    // And over the left pane: the left one, and its view reads it.
    await page.mouse.move(350, 350);
    await page.mouse.wheel(0, 500);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].host.scrollTop > 0);
    await scrollsSettled(page);
    const left = await state(page);
    assert.equal(left.panes[1].scrollTop, right.panes[1].scrollTop, 'the right pane did not scroll');
    assert.ok(left.panes[0].byteOffset > 0, `the left view reads its own pane (byteOffset ${left.panes[0].byteOffset})`);
  });
});

test('Space in the focused pane scrolls that pane only', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await settle(page);
    await page.evaluate(() => {
      const panes = window.__marxyHandle.panes();
      panes.focus(panes.panes[1]);
    });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].host.scrollTop > 0);
    await scrollsSettled(page);
    const right = await state(page);
    assert.equal(right.panes[0].scrollTop, 0, 'the left pane did not scroll');
    assert.equal(right.window, 0);
    await page.evaluate(() => {
      const panes = window.__marxyHandle.panes();
      panes.focus(panes.panes[0]);
    });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].host.scrollTop > 0);
    await scrollsSettled(page);
    const left = await state(page);
    assert.equal(left.panes[1].scrollTop, right.panes[1].scrollTop, 'the right pane did not scroll');
    assert.ok(left.panes[0].byteOffset > 0, 'the left view reads its own pane');
  });
});

/** Scrolls the one-pane window so the 6th paragraph is on the reading line; resolves its start byte. */
async function scrollToSixth(page) {
  return page.evaluate(() => {
    const p = document.querySelectorAll('#doc > p')[5];
    const scroller = document.documentElement;
    scroller.scrollTop = p.getBoundingClientRect().top + scroller.scrollTop - scroller.clientHeight * 0.4 + 10;
    return Number(p.getAttribute('data-marxy-s'));
  });
}

test('split and close keep the one document on the same block, through the window and the pane', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    await settle(page);
    const sixth = await scrollToSixth(page);
    await frames(page);
    const one = await page.evaluate(() => window.__marxyHandle.sourceHarness().byteOffset);
    assert.equal(one, sixth, 'the 6th paragraph is under the reading line');
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    await settle(page);
    const split = await state(page);
    assert.equal(split.window, 0);
    assert.ok(split.panes[0].scrollTop > 0, 'the first pane scrolls its own section');
    assert.equal(split.panes[0].byteOffset, sixth, 'the first pane is on the same block after the split');
    await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      await panes.close(panes.panes[1]);
    });
    await settle(page);
    const back = await page.evaluate(() => ({
      byteOffset: window.__marxyHandle.sourceHarness().byteOffset,
      window: document.documentElement.scrollTop,
      scrollsWindow: window.__marxyHandle.panes().panes[0].view.scroller === document.documentElement,
    }));
    assert.equal(back.scrollsWindow, true, 'one pane again: the window scrolls');
    assert.ok(back.window > 0);
    assert.equal(back.byteOffset, sixth, 'the same block after the close');
  });
});

test('closing the left pane keeps the right document at its place, fraction and all', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await settle(page);
    // Halfway through the right pane's 6th paragraph.
    const right = await page.evaluate(() => {
      const pane = window.__marxyHandle.panes().panes[1];
      const p = pane.article.querySelectorAll(':scope > p')[5];
      const host = pane.host;
      const top = p.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
      host.scrollTop = top + p.getBoundingClientRect().height * 0.5 - host.clientHeight * 0.4;
      return { start: Number(p.getAttribute('data-marxy-s')) };
    });
    await frames(page);
    const was = await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.position());
    assert.equal(was.byteOffset, right.start);
    assert.ok(was.fraction > 0.3 && was.fraction < 0.7, `fraction ${was.fraction}`);
    await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      await panes.close(panes.panes[0]);
    });
    await settle(page);
    const now = await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.position());
    assert.equal(now.path, '/r/B.md');
    assert.equal(now.byteOffset, was.byteOffset);
    assert.ok(Math.abs(now.fraction - was.fraction) < 0.15, `fraction ${now.fraction}, was ${was.fraction}`);
  });
});

test("a pending open's anchor in the left pane survives a wheel over the right pane", async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await settle(page);
    // The 9th paragraph's first byte (the text is ASCII).
    const ninth = files['/r/D.md'].indexOf('Delta 9 runs');
    assert.ok(ninth > 0);
    // An open in the left pane landing on the 9th paragraph: the anchor holds it until the reader scrolls this pane.
    await page.evaluate((at) => window.__marxyHandle.panes().openIn(0, '/r/D.md', { at }), ninth);
    await settle(page);
    assert.equal((await state(page)).panes[0].byteOffset, ninth);
    await page.mouse.move(1100, 350);
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].host.scrollTop > 0);
    // The left pane is moved by script (not the reader), then a grid pass runs: the anchor puts it back.
    const held = await page.evaluate(async () => {
      const left = window.__marxyHandle.panes().panes[0];
      left.host.scrollTop = 0;
      await left.view.typeset();
      return left.view.sourceHarness().byteOffset;
    });
    assert.equal(held, ninth, 'the anchor still holds the 9th paragraph');
  });
});

test('a paragraph below the fold in the right pane is typeset once scrolled into view', async () => {
  await withPage(async (page) => {
    const long = `# Long\n\n${Array.from({ length: 60 }, (_, i) => para(`Long ${i + 1}`).repeat(2).trim()).join('\n\n')}\n`;
    await bootTwoPanes(page, { files: { ...files, '/r/L.md': long }, open: ['/r/A.md', '/r/L.md'] });
    // Scrolled to its end at once, before the background passes reach it. The pane is an overflow
    // scroller inside the window: the typesetter's observer (implicit root) still sees what it shows.
    const seen = await page.evaluate(async () => {
      const pane = window.__marxyHandle.panes().panes[1];
      const last = [...pane.article.querySelectorAll(':scope > p')].at(-1);
      if (last.querySelector('.marxy-lb') !== null) return { early: true };
      pane.host.scrollTop = pane.host.scrollHeight;
      const shown = () => {
        const r = last.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), set: last.querySelector('.marxy-lb') !== null, scrollTop: pane.host.scrollTop };
      };
      const t0 = performance.now();
      while (performance.now() - t0 < 10_000) {
        const now = shown();
        if (now.set) return { ...now, waitedMs: Math.round(performance.now() - t0) };
        await new Promise((r) => requestAnimationFrame(r));
      }
      return shown();
    });
    assert.equal(seen.early, undefined, 'the last paragraph was already set before it was scrolled to');
    assert.equal(seen.set, true, JSON.stringify(seen));
    assert.equal(await page.evaluate(() => document.documentElement.scrollTop), 0, 'the pane scrolled, not the window');
  });
});

test('one pane: the window scrolls and the view is on it, as before', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    await settle(page);
    const one = await page.evaluate(() => {
      const pane = window.__marxyHandle.panes().panes[0];
      return { scrollsWindow: pane.view.scroller === document.documentElement, overflow: getComputedStyle(pane.host).overflowY };
    });
    assert.deepEqual(one, { scrollsWindow: true, overflow: 'visible' });
    const sixth = await scrollToSixth(page);
    await frames(page);
    assert.equal(await page.evaluate(() => window.__marxyHandle.sourceHarness().byteOffset), sixth);
  });
});

test("two panes: the first pane's scroll writes its place, and the second pane's writes nothing yet (D-12)", async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await settle(page);
    await page.evaluate(() => {
      const [left, right] = window.__marxyHandle.panes().panes;
      left.host.scrollTop = 600;
      right.host.scrollTop = 400;
    });
    // Past the debounce (POSITIONS_DEBOUNCE_MS, 500 ms).
    await page.waitForTimeout(1200);
    const seen = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      let text = null;
      try {
        text = new TextDecoder().decode(await handle.shell.readFile('/data/positions.json'));
      } catch {}
      return { text, left: handle.panes().panes[0].view.position().byteOffset };
    });
    assert.ok(seen.left > 0);
    const stored = JSON.parse(seen.text ?? '{}');
    const entries = JSON.stringify(stored);
    assert.match(entries, /\/r\/A\.md/, `positions.json: ${entries.slice(0, 300)}`);
    assert.match(entries, new RegExp(`"byteOffset":\\s*${seen.left}\\b`), `positions.json: ${entries.slice(0, 300)}`);
    assert.doesNotMatch(entries, /\/r\/B\.md/, 'the second pane does not write until D-12');
  });
});

// B-26: the typesetter holds the reader's place on the view's own scroller. A paragraph above a pane's
// reading line that gains lines (text written into it, which the typesetter sets again, the way a
// post-pass or a late re-set does) must leave the block under that pane's reading line where it was.
// Before B-26 the typesetter read the window's scroller, at 0 while two panes are shown, so it held
// nothing and the pane's reading block moved down by the growth.
test('two panes: a paragraph above a pane\'s reading line that the typesetter sets again with more lines leaves its reading block in place', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await settle(page);
    for (const [slot, other] of [[1, 0], [0, 1]]) {
      await page.evaluate((slot) => {
        const host = window.__marxyHandle.panes().panes[slot].host;
        const article = host.querySelector('article');
        const paras = [...article.querySelectorAll(':scope > p')];
        // The 7th paragraph a little below the pane's top: everything above it is off the pane.
        host.scrollTop = paras[6].getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 40;
      }, slot);
      // Past the typesetter's quiet window after a scroll (INPUT_QUIET_MS, 200 ms).
      await page.waitForTimeout(500);
      await scrollsSettled(page);
      const before = await page.evaluate(({ slot, other }) => {
        const panes = window.__marxyHandle.panes().panes;
        const host = panes[slot].host;
        const article = host.querySelector('article');
        const top = host.getBoundingClientRect().top;
        const el = [...article.children].find((c) => c.getBoundingClientRect().bottom > top + 100);
        const above = [...article.querySelectorAll(':scope > p.marxy-set')].filter((p) => p.getBoundingClientRect().bottom < top);
        const far = above[1];
        window.__b26 = { el, top: el.getBoundingClientRect().top, far, height: far.getBoundingClientRect().height };
        return { scrollTop: host.scrollTop, otherTop: panes[other].host.scrollTop, above: above.length, set: far.classList.contains('marxy-set') };
      }, { slot, other });
      assert.ok(before.scrollTop > 300, `pane ${slot} scrolled to ${before.scrollTop}`);
      assert.ok(before.above >= 2 && before.set, `pane ${slot}: ${before.above} set paragraphs wholly above its top`);
      // A line and more of text, written into a set paragraph above the reading line.
      await page.evaluate(() => {
        window.__b26.far.appendChild(document.createTextNode(' ' + 'further words that fill more lines of the measure '.repeat(4)));
      });
      await settle(page);
      const r = await page.evaluate(({ slot, other }) => {
        const panes = window.__marxyHandle.panes().panes;
        const { el, top, far, height } = window.__b26;
        return {
          grew: far.getBoundingClientRect().height - height,
          drift: el.getBoundingClientRect().top - top,
          window: document.documentElement.scrollTop,
          otherTop: panes[other].host.scrollTop,
          set: far.classList.contains('marxy-set'),
        };
      }, { slot, other });
      assert.ok(r.grew >= 20 && r.set, `pane ${slot}: the paragraph above was set again ${r.grew.toFixed(1)} px taller`);
      assert.ok(Math.abs(r.drift) <= 1, `pane ${slot}: its reading block moved ${r.drift.toFixed(2)} px after a ${r.grew.toFixed(1)} px growth above`);
      assert.equal(r.window, 0, 'the window does not scroll');
      assert.equal(r.otherTop, before.otherTop, `pane ${other} did not move`);
    }
  });
});

// B-26, the card's case: a pane scrolled to its end, whose paragraphs above are then set again taller,
// keeps its last paragraph where it was, in view. Before B-26 nothing compensated inside a pane, so the
// growth pushed the last paragraph down and partly out of the pane.
test('two panes: a pane scrolled to its end keeps its last paragraph in view when paragraphs above it are set again taller', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await settle(page);
    for (const [slot, other] of [[1, 0], [0, 1]]) {
      await page.evaluate((slot) => {
        const host = window.__marxyHandle.panes().panes[slot].host;
        host.scrollTop = host.scrollHeight;
      }, slot);
      await page.waitForTimeout(500);
      await scrollsSettled(page);
      const before = await page.evaluate(({ slot, other }) => {
        const panes = window.__marxyHandle.panes().panes;
        const host = panes[slot].host;
        const box = host.getBoundingClientRect();
        const article = host.querySelector('article');
        const last = article.lastElementChild;
        const above = [...article.querySelectorAll(':scope > p.marxy-set')].filter((p) => p.getBoundingClientRect().bottom < box.top);
        window.__b26 = { last, bottom: last.getBoundingClientRect().bottom, grow: above.slice(-2) };
        return {
          atEnd: host.scrollHeight - host.clientHeight - host.scrollTop,
          lastInView: last.getBoundingClientRect().bottom <= box.bottom && last.getBoundingClientRect().top >= box.top,
          above: above.length,
          otherTop: panes[other].host.scrollTop,
        };
      }, { slot, other });
      assert.ok(before.atEnd <= 1, `pane ${slot} is at its end (${before.atEnd} px short)`);
      assert.ok(before.lastInView, `pane ${slot}: its last paragraph is in view before`);
      assert.ok(before.above >= 2, `pane ${slot}: ${before.above} set paragraphs wholly above its top`);
      await page.evaluate(() => {
        for (const p of window.__b26.grow) {
          p.appendChild(document.createTextNode(' ' + 'further words that fill more lines of the measure '.repeat(4)));
        }
      });
      await settle(page);
      const r = await page.evaluate(({ slot, other }) => {
        const panes = window.__marxyHandle.panes().panes;
        const box = panes[slot].host.getBoundingClientRect();
        const { last, bottom } = window.__b26;
        const rect = last.getBoundingClientRect();
        return {
          drift: rect.bottom - bottom,
          lastInView: rect.bottom <= box.bottom + 1 && rect.top >= box.top,
          window: document.documentElement.scrollTop,
          otherTop: panes[other].host.scrollTop,
        };
      }, { slot, other });
      assert.ok(Math.abs(r.drift) <= 1, `pane ${slot}: its last paragraph moved ${r.drift.toFixed(2)} px`);
      assert.ok(r.lastInView, `pane ${slot}: its last paragraph is in view after the set`);
      assert.equal(r.window, 0, 'the window does not scroll');
      assert.equal(r.otherTop, before.otherTop, `pane ${other} did not move`);
    }
  });
});

test("two panes: wheeling one pane while the other is set again leaves the other's reading block in place (B-26.2)", async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await settle(page);
    for (const [slot, other] of [[1, 0], [0, 1]]) {
      await page.evaluate((slot) => {
        const host = window.__marxyHandle.panes().panes[slot].host;
        host.scrollTop = host.scrollHeight * 0.6;
      }, slot);
      await page.waitForTimeout(500);
      await scrollsSettled(page);
      const prep = await page.evaluate((slot) => {
        const host = window.__marxyHandle.panes().panes[slot].host;
        const box = host.getBoundingClientRect();
        const article = host.querySelector('article');
        const above = [...article.querySelectorAll(':scope > p.marxy-set')].filter((p) => p.getBoundingClientRect().bottom < box.top - 200);
        const block = [...article.children].find((c) => c.getBoundingClientRect().bottom > box.top + 100);
        window.__b262 = { block, top: block.getBoundingClientRect().top, grow: above.at(-1) };
        return above.length;
      }, slot);
      assert.ok(prep >= 1, `pane ${slot}: a set paragraph above its top`);
      const box = await page.evaluate((other) => {
        const r = window.__marxyHandle.panes().panes[other].host.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, other);
      await page.mouse.move(box.x, box.y);
      await page.mouse.wheel(0, 40);
      await page.evaluate(() => {
        window.__b262.grow.appendChild(document.createTextNode(' ' + 'further words that fill more lines of the measure '.repeat(4)));
      });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const drift = await page.evaluate(() => window.__b262.block.getBoundingClientRect().top - window.__b262.top);
      assert.ok(Math.abs(drift) <= 1, `pane ${slot}: its reading block moved ${drift.toFixed(2)} px after a wheel over pane ${other}`);
      await settle(page);
    }
  });
});
