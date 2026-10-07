// The reader's place while the visibility observer sets paragraphs above the screen (B-02.5), and
// that the first (viewport) pass leaves it alone. The app-level cases at 1 MB are in
// apps/desktop/test/keep-place.test.mjs; this one stalls the idle chunks so that the observer is the
// only thing setting paragraphs. Playwright WebKit only.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { renderCorpus, startHarness } from './harness.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

let harness;
before(async () => { if (!skip) harness = await startHarness(); });
after(async () => { await harness?.close(); });

// Set text and native wrapping paint the same number of lines in this fixture, so a set paragraph is
// made 7 px taller by the page's CSS: what the app's hyphenation and hanging do by whole lines, here
// by a fixed amount, which is what the observer's pass has to keep out of the reader's way.
const SET_IS_TALLER = 'p.marxy-set { padding-bottom: 7px; }';

test('paragraphs above the screen set by the visibility observer leave the reading block within 1 px', async () => {
  const html = Array.from({ length: 10 }, () => renderCorpus('01-long-technical.md')).join('\n');
  const page = await harness.open(html, { extraCss: SET_IS_TALLER });
  const r = await page.evaluate(async () => {
    const doc = document.getElementById('doc');
    window.scrollTo(0, document.documentElement.scrollHeight * 0.6);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const place = [...doc.children].find((c) => c.getBoundingClientRect().bottom > 100);
    const top = place.getBoundingClientRect().top;
    // Idle chunks never run: only the first pass and the observer set anything.
    window.controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, lastLineMinWidth: 0.33, scheduler: { schedule() {} },
    });
    await window.controller.ready;
    const afterFirstPass = place.getBoundingClientRect().top - top;
    const h1 = document.documentElement.scrollHeight;
    const nativeTops = new Map([...doc.querySelectorAll('p')].map((p) => [p, p.getBoundingClientRect().height]));
    const setBefore = doc.querySelectorAll('.marxy-set').length;
    for (let i = 0; i < 10; i++) await new Promise((res) => requestAnimationFrame(res));
    const wholeAbove = [...doc.querySelectorAll('.marxy-set')].filter((p) => p.getBoundingClientRect().bottom < 0).length;
    let aboveDelta = 0;
    for (const [p, h] of nativeTops) if (p.getBoundingClientRect().bottom < 0) aboveDelta += p.getBoundingClientRect().height - h;
    return {
      aboveDelta,
      afterFirstPass,
      drift: place.getBoundingClientRect().top - top,
      setBefore,
      setAfter: doc.querySelectorAll('.marxy-set').length,
      wholeAbove,
      scrollY: window.scrollY,
      grew: document.documentElement.scrollHeight - h1,
    };
  });
  assert.ok(r.scrollY > 1000, `scrolled to ${r.scrollY}`);
  assert.ok(r.setAfter > r.setBefore && r.wholeAbove > 0, `the observer set ${r.setAfter - r.setBefore} more, ${r.wholeAbove} wholly above the screen`);
  assert.ok(Math.abs(r.afterFirstPass) <= 1, `the first pass alone moved the reading block ${r.afterFirstPass.toFixed(2)} px`);
  assert.ok(Math.abs(r.drift) <= 1, `the reading block moved ${r.drift.toFixed(2)} px as the observer set paragraphs above (the page grew ${r.grew.toFixed(1)} px, paragraphs above the screen ${r.aboveDelta.toFixed(1)} px)`);
  assert.ok(Math.abs(r.aboveDelta) >= 20, `the observer's passes changed the paragraphs above the screen by ${r.aboveDelta.toFixed(1)} px`);
  await page.close();
});

// B-02.8: a wheel listener anywhere in a WebKit document costs a paint of the whole page after every
// layout, so the typesetter listens for the wheel only while the page is scrolled away from its top.
// Away from the top, a wheel still holds off the compensation of a re-set above; once the reader stops,
// the same re-set is kept in place; back at the top, the listener is gone again.
test('the wheel is listened for only away from the top, and there a wheel still holds off a compensation', async () => {
  const html = Array.from({ length: 6 }, () => renderCorpus('01-long-technical.md')).join('\n');
  const page = await harness.open(html);
  const r = await page.evaluate(async () => {
    const wheels = new Set();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = (type, fn, o) => { if (type === 'wheel') wheels.add(fn); add(type, fn, o); };
    window.removeEventListener = (type, fn, o) => { if (type === 'wheel') wheels.delete(fn); remove(type, fn, o); };
    const frames = (n) => new Promise((res) => {
      const tick = () => (n-- <= 0 ? res() : requestAnimationFrame(tick));
      tick();
    });
    const doc = document.getElementById('doc');
    const controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, lastLineMinWidth: 0.33, scheduler: window.immediateScheduler(),
    });
    await controller.done;
    await frames(2);
    const atTop = wheels.size;
    window.scrollTo(0, document.documentElement.scrollHeight * 0.6);
    await frames(3);
    const deep = wheels.size;
    // A set paragraph a few screens above, made a few lines longer the way a post-pass writes into it.
    const farAbove = (skip) => [...doc.querySelectorAll('p.marxy-set')]
      .filter((p) => p.getBoundingClientRect().bottom < -2 * window.innerHeight)
      .at(-1 - skip);
    const grow = async (p) => {
      const h = p.getBoundingClientRect().height;
      p.appendChild(document.createTextNode(' ' + 'further words that fill more lines of the measure '.repeat(4)));
      // The typesetter's mutation observer runs as a microtask: revert, re-set, compensate.
      await Promise.resolve();
      await Promise.resolve();
      return p.getBoundingClientRect().height - h;
    };
    const blockAt = () => [...doc.children].find((c) => c.getBoundingClientRect().bottom > 100);
    let el = blockAt();
    let top = el.getBoundingClientRect().top;
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    const grewDuring = await grow(farAbove(0));
    const movedDuring = el.getBoundingClientRect().top - top;
    await new Promise((res) => setTimeout(res, 400));
    await frames(2);
    el = blockAt();
    top = el.getBoundingClientRect().top;
    const grewAfter = await grow(farAbove(3));
    const movedAfter = el.getBoundingClientRect().top - top;
    window.scrollTo(0, 0);
    await frames(3);
    const backAtTop = wheels.size;
    controller.destroy();
    return { atTop, deep, backAtTop, grewDuring, movedDuring, grewAfter, movedAfter, scrollY: window.scrollY };
  });
  assert.ok(r.grewDuring >= 20 && r.grewAfter >= 20, `the paragraphs above grew ${r.grewDuring.toFixed(1)} and ${r.grewAfter.toFixed(1)} px`);
  assert.ok(Math.abs(r.movedDuring - r.grewDuring) <= 1, `during the wheel the reading block moved ${r.movedDuring.toFixed(2)} px: it should move with the ${r.grewDuring.toFixed(1)} px growth, uncompensated`);
  assert.ok(Math.abs(r.movedAfter) <= 1, `after the wheel stopped the reading block moved ${r.movedAfter.toFixed(2)} px`);
  assert.equal(r.atTop, 0, 'no wheel listener while the page is at its top');
  assert.equal(r.deep, 1, 'one wheel listener once the page is scrolled');
  assert.equal(r.backAtTop, 0, 'the wheel listener is removed once the page is back at its top');
  await page.close();
});

/** In the page: counts the window's wheel listeners, and helpers the cases below share. */
const installProbes = () => {
  const wheels = new Set();
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  window.addEventListener = (type, fn, o) => { if (type === 'wheel') wheels.add(fn); add(type, fn, o); };
  window.removeEventListener = (type, fn, o) => { if (type === 'wheel') wheels.delete(fn); remove(type, fn, o); };
  const doc = document.getElementById('doc');
  window.__probe = {
    wheels: () => wheels.size,
    attach: async () => {
      window.__ctl = window.typeset.attach(doc, {
        lineBox: window.lineBox, glueStretchEm: 0.6, lastLineMinWidth: 0.33, scheduler: window.immediateScheduler(),
      });
      await window.__ctl.done;
    },
    blockAt: () => [...doc.children].find((c) => c.getBoundingClientRect().bottom > 100),
    /** The last set paragraph wholly above the screen, a few lines longer; resolves after the re-set. */
    growAbove: async () => {
      const p = [...doc.querySelectorAll('p.marxy-set')].filter((q) => q.getBoundingClientRect().bottom < 0).at(-1);
      const h = p.getBoundingClientRect().height;
      p.appendChild(document.createTextNode(' ' + 'further words that fill more lines of the measure '.repeat(4)));
      await Promise.resolve();
      await Promise.resolve();
      return p.getBoundingClientRect().height - h;
    },
  };
};

/**
 * One real wheel tick from the top (its listener is not there yet), then a re-set above, either at once
 * (`afterScrollEvent` false: before the engine has dispatched the tick's `scroll`) or once that `scroll`
 * has been dispatched; and again a frame later. How far the reading block moved each time, against the
 * growth. The page's clock stands still from the tick on, so the reader's quiet window cannot run out
 * on a slow machine: what is tested is whether the tick counted as input, not how fast the page is.
 */
async function wheelFromTop(afterScrollEvent) {
  const html = Array.from({ length: 6 }, () => renderCorpus('01-long-technical.md')).join('\n');
  const page = await harness.open(html);
  await page.evaluate(installProbes);
  await page.evaluate(() => window.__probe.attach());
  const atTop = await page.evaluate(() => window.__probe.wheels());
  await page.evaluate(() => {
    const still = performance.now();
    window.__scrollEvents = 0;
    window.addEventListener('scroll', () => window.__scrollEvents++, { capture: true, passive: true });
    performance.now = () => still;
  });
  await page.mouse.move(480, 450);
  await page.mouse.wheel(0, 1200);
  const r = await page.evaluate(async (afterScrollEvent) => {
    const frame = () => new Promise((res) => requestAnimationFrame(res));
    while (window.scrollY === 0) await frame();
    const early = window.__scrollEvents;
    while (afterScrollEvent && window.__scrollEvents === 0) await frame();
    const once = async () => {
      const el = window.__probe.blockAt();
      const top = el.getBoundingClientRect().top;
      const grew = await window.__probe.growAbove();
      return { grew, moved: el.getBoundingClientRect().top - top };
    };
    const first = await once();
    await frame();
    const second = await once();
    return { first, second, early, wheels: window.__probe.wheels(), scrollY: window.scrollY };
  }, afterScrollEvent);
  await page.close();
  return { atTop, ...r };
}

const uncompensated = (r) => {
  assert.equal(r.atTop, 0, 'no wheel listener at the top');
  for (const [name, x] of [['first', r.first], ['second', r.second]]) {
    assert.ok(x.grew >= 20, `the ${name} paragraph above grew ${x.grew.toFixed(1)} px`);
    assert.ok(Math.abs(x.moved - x.grew) <= 1, `${name} re-set: the reading block moved ${x.moved.toFixed(2)} px; it should move with the ${x.grew.toFixed(1)} px growth, uncompensated`);
  }
  assert.equal(r.wheels, 1, 'the wheel is listened for once the page has left the top');
};

test('the wheel tick that leaves the top is the reader scrolling: re-sets above before its scroll event are not compensated', async () => {
  // In the first frame after the tick a pass sees the page scrolled before the engine dispatches the `scroll`.
  const r = await wheelFromTop(false);
  assert.equal(r.early, 0, 'the first re-set ran before the tick\'s scroll event, as this case needs');
  uncompensated(r);
});

test('the wheel tick that leaves the top is the reader scrolling: re-sets above after its scroll event are not compensated', async () => {
  // Once the `scroll` has been dispatched, it is what saw the page leave the top.
  uncompensated(await wheelFromTop(true));
});

test('a pass that finds the page left the top before its scroll event listens for the wheel and holds off; destroy removes the listener', async () => {
  const html = Array.from({ length: 6 }, () => renderCorpus('01-long-technical.md')).join('\n');
  const page = await harness.open(html);
  await page.evaluate(installProbes);
  await page.evaluate(() => window.__probe.attach());
  const r = await page.evaluate(async () => {
    // The scroll's own event waits for the next frame: the pass below is the first to see the page scrolled,
    // as a pass that runs between a wheel tick and its `scroll` would be.
    window.scrollTo(0, document.documentElement.scrollHeight * 0.6);
    const el = window.__probe.blockAt();
    const top = el.getBoundingClientRect().top;
    const grew = await window.__probe.growAbove();
    const inPass = window.__probe.wheels();
    const moved = el.getBoundingClientRect().top - top;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    window.__ctl.destroy();
    return { grew, moved, inPass, afterDestroy: window.__probe.wheels(), scrollY: window.scrollY };
  });
  assert.ok(r.scrollY > 1000 && r.grew >= 20, `scrolled to ${r.scrollY}, grew ${r.grew.toFixed(1)} px`);
  assert.equal(r.inPass, 1, 'the pass that found the page scrolled added the wheel listener before its scroll event');
  assert.ok(Math.abs(r.moved - r.grew) <= 1, `the reading block moved ${r.moved.toFixed(2)} px: leaving the top is input, so the ${r.grew.toFixed(1)} px growth is not compensated`);
  assert.equal(r.afterDestroy, 0, 'destroyed while scrolled deep, no wheel listener remains');
  await page.close();
});
