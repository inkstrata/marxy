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
 * One real wheel tick from the top (its listener is not there yet), then, once the tick's `scroll` has
 * been dispatched, a re-set above; and again a frame later. How far the reading block moved each time,
 * against the growth. The page's clock stands still from the tick on, so the reader's quiet window cannot
 * run out on a slow machine: what is tested is whether the tick counted as input, not how fast the page is.
 * (A pass that runs before the tick's `scroll` cannot be placed reliably from here, across Playwright's
 * round trip; the next test reaches that route in one task, with a scroll set by script.)
 */
async function wheelFromTop() {
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
  const r = await page.evaluate(async () => {
    const frame = () => new Promise((res) => requestAnimationFrame(res));
    while (window.scrollY === 0 || window.__scrollEvents === 0) await frame();
    const once = async () => {
      const el = window.__probe.blockAt();
      const top = el.getBoundingClientRect().top;
      const grew = await window.__probe.growAbove();
      return { grew, moved: el.getBoundingClientRect().top - top };
    };
    const first = await once();
    await frame();
    const second = await once();
    return { first, second, wheels: window.__probe.wheels(), scrollY: window.scrollY };
  });
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

test('the wheel tick that leaves the top is the reader scrolling: re-sets above after its scroll event are not compensated', async () => {
  // The tick's `scroll` is what saw the page leave the top.
  uncompensated(await wheelFromTop());
});

test('a pass that finds the page left the top before its scroll event counts it as input; destroy removes the wheel listener', async () => {
  const html = Array.from({ length: 6 }, () => renderCorpus('01-long-technical.md')).join('\n');
  const page = await harness.open(html);
  await page.evaluate(installProbes);
  await page.evaluate(() => window.__probe.attach());
  const r = await page.evaluate(async () => {
    let scrollEvents = 0;
    window.addEventListener('scroll', () => scrollEvents++, { capture: true, passive: true });
    const frame = () => new Promise((res) => requestAnimationFrame(res));
    const once = async () => {
      const el = window.__probe.blockAt();
      const top = el.getBoundingClientRect().top;
      const grew = await window.__probe.growAbove();
      return { grew, moved: el.getBoundingClientRect().top - top };
    };
    // All in one task: the scroll's own event waits for the next frame, so the pass below is the first
    // to see the page scrolled, as a pass that runs between a wheel tick and its `scroll` would be. The
    // clock stands still from here, so the quiet window cannot run out on a slow machine.
    window.scrollTo(0, document.documentElement.scrollHeight * 0.6);
    const still = performance.now();
    const now = performance.now;
    performance.now = () => still;
    const early = scrollEvents;
    const first = await once();
    const inPass = window.__probe.wheels();
    // After the `scroll` has been dispatched (it finds the wheel already listened for, and stamps
    // nothing), a second re-set is still inside the window the pass opened.
    while (scrollEvents === 0) await frame();
    const second = await once();
    performance.now = now;
    window.__ctl.destroy();
    return { early, first, second, inPass, afterDestroy: window.__probe.wheels(), scrollY: window.scrollY };
  });
  assert.equal(r.early, 0, 'the first re-set ran before the scroll event (one task)');
  assert.ok(r.scrollY > 1000, `scrolled to ${r.scrollY}`);
  assert.equal(r.inPass, 1, 'the pass that found the page scrolled added the wheel listener before its scroll event');
  for (const [name, x] of [['first', r.first], ['second', r.second]]) {
    assert.ok(x.grew >= 20, `the ${name} paragraph above grew ${x.grew.toFixed(1)} px`);
    assert.ok(Math.abs(x.moved - x.grew) <= 1, `${name} re-set: the reading block moved ${x.moved.toFixed(2)} px; leaving the top is input, so the ${x.grew.toFixed(1)} px growth is not compensated`);
  }
  assert.equal(r.afterDestroy, 0, 'destroyed while scrolled deep, no wheel listener remains');
  await page.close();
});

// F-11: the block under the reading line can be the paragraph the reader is inside, starting above the
// screen. When lines of it above the reading line change height, its top does not move, so following
// the block's top compensates nothing and the words under the line slide by lines. Each case notes the
// character under the reading line, changes the paragraph's lines above it, and asks how far that
// character moved on screen, and how many characters now lie between it and the reading line.

/** In the page: the character under the reading line of the second paragraph, and where it is. */
const installReadingLine = () => {
  const doc = document.getElementById('doc');
  const p = doc.querySelectorAll('p')[1];
  const x = () => doc.getBoundingClientRect().left + 100;
  const Y = 40;
  /** The offset in `p`'s text of the character under the reading line. */
  const offsetAtLine = () => {
    const caret = document.caretRangeFromPoint(x(), Y);
    const r = document.createRange();
    r.setStart(p, 0);
    r.setEnd(caret.startContainer, caret.startOffset);
    return r.toString().length;
  };
  /** The top of the line holding the character at `at` of `p`'s text, on screen. */
  const topOf = (at) => {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let sum = 0;
    for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
      if (at < sum + t.length) {
        const r = document.createRange();
        r.setStart(t, at - sum);
        r.setEnd(t, at - sum + 1);
        return r.getClientRects()[0].top;
      }
      sum += t.length;
    }
    return Number.NaN;
  };
  /** Notes the character under the line; `since(shift)` reports on it once `shift` characters were written before it. */
  const note = () => {
    const at = offsetAtLine();
    const top = topOf(at);
    const inP = top - p.getBoundingClientRect().top;
    const sy = window.scrollY;
    return (shift = 0) => {
      const now = topOf(at + shift);
      return {
        straddles: p.getBoundingClientRect().top < 0,
        set: p.classList.contains('marxy-set'),
        moved: now - top,
        grewAbove: now - p.getBoundingClientRect().top - inP,
        chars: offsetAtLine() - (at + shift),
        scrolled: window.scrollY - sy,
        lineHeight: parseFloat(getComputedStyle(p).lineHeight),
      };
    };
  };
  window.__line = { doc, p, note };
};

const withinOneLine = (r, what) => {
  assert.ok(r.straddles, 'the paragraph under the reading line starts above the screen');
  assert.ok(r.set, 'the paragraph is set');
  assert.ok(Math.abs(r.grewAbove) >= 2 * r.lineHeight, `${what} moved the character inside its paragraph by ${r.grewAbove.toFixed(1)} px, which this case needs to be lines`);
  assert.ok(Math.abs(r.moved) < r.lineHeight, `the character under the reading line moved ${r.moved.toFixed(1)} px on screen (a line is ${r.lineHeight} px; it is now ${r.chars} characters from the reading line); the page scrolled ${r.scrolled.toFixed(1)} px`);
};

const MARKED = 'Every line of this paragraph is filled close to the measure by the breaker, so a marker added later has nowhere to go but past the edge. ';

test('markers written above the reading line inside the paragraph under it leave the words at the reading line within one line', async () => {
  const page = await harness.open(`<p>intro</p><p data-marxy-s="1">${MARKED.repeat(60)}</p><p>after</p>`, { width: 320 });
  await page.evaluate(installReadingLine);
  const r = await page.evaluate(async () => {
    const { doc, p, note } = window.__line;
    window.__ctl = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, scheduler: { schedule() {} },
    });
    await window.__ctl.ready;
    window.scrollTo(0, p.getBoundingClientRect().top + window.scrollY + p.getBoundingClientRect().height * 0.5);
    // Past the reader's quiet window: leaving the top was the reader's input.
    await new Promise((res) => setTimeout(res, 600));
    const since = note();
    // What the invisible-character pass writes, before the breaks of forty lines above the reading line:
    // five characters each (a four-letter label and the byte), all before the noted one.
    const above = [...p.querySelectorAll('.marxy-lb')].filter((lb) => lb.getBoundingClientRect().bottom < -50).slice(-40);
    for (const lb of above) {
      const mark = document.createElement('code');
      mark.className = 'marxy-invisible marxy-invisible-bidi';
      const glyph = document.createElement('code');
      glyph.className = 'marxy-invisible-glyph';
      glyph.textContent = '202E';
      const byte = document.createElement('code');
      byte.className = 'marxy-invisible-byte marxy-invisible-bidi';
      byte.textContent = '‮';
      mark.append(glyph, byte);
      lb.before(mark);
    }
    // The typesetter's change watcher runs as a microtask: revert, re-set, compensate.
    await Promise.resolve();
    await new Promise((res) => setTimeout(res, 300));
    return { n: above.length, ...since(above.length * 5) };
  });
  assert.equal(r.n, 40, 'forty markers above the reading line');
  withinOneLine(r, 'the re-set after the markers');
  await page.close();
});

const WIDE = 'Every line of this long paragraph is filled close to the measure by the breaker so that setting it changes where lines end and therefore which words sit where on the page, with extraordinarily internationalization-prone vocabulary. ';

test('the first pass at attach sets the paragraph the reading line runs through and leaves its words within one line', async () => {
  const page = await harness.open(`<p>intro</p><p data-marxy-s="1">${WIDE.repeat(60)}</p><p>after</p>`, { width: 480 });
  await page.evaluate(installReadingLine);
  const r = await page.evaluate(async () => {
    const { doc, p, note } = window.__line;
    window.scrollTo(0, p.getBoundingClientRect().top + window.scrollY + p.getBoundingClientRect().height * 0.5);
    await new Promise((res) => setTimeout(res, 400));
    const since = note();
    // Idle chunks never run: the first pass is the only thing that sets it.
    window.__ctl = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, lastLineMinWidth: 0.33, scheduler: { schedule() {} },
    });
    await window.__ctl.ready;
    return since();
  });
  withinOneLine(r, 'setting the paragraph');
  await page.close();
});

// A large block under the reading line: the noted character is read again from its own text node, with
// no walk over the block's text, when the pass left the node whole; and a character that paints no box
// after the pass leaves the block's top to follow, not nothing.
const LISTING = Array.from({ length: 3000 }, (_, i) =>
  `<span>${String(i).padStart(4, '0')} the listing runs on and on so that every line is wider than half of the measure of the page</span>`).join('\n');

/** Six corpus documents, then a long listing, then one more; scrolled to the middle of the listing and attached. */
async function deepInListing() {
  const before = Array.from({ length: 6 }, () => renderCorpus('01-long-technical.md')).join('\n');
  const page = await harness.open(`${before}<pre id="listing">${LISTING}</pre>${renderCorpus('01-long-technical.md')}`);
  await page.evaluate(installProbes);
  await page.evaluate(() => window.__probe.attach());
  await page.evaluate(async () => {
    const pre = document.getElementById('listing');
    const r = pre.getBoundingClientRect();
    window.scrollTo(0, r.top + window.scrollY + r.height / 2);
    // Past the reader's quiet window: leaving the top was the reader's input.
    await new Promise((res) => setTimeout(res, 600));
  });
  return page;
}

test('deep in a large block, the character under the reading line is read again without walking the block', async () => {
  const page = await deepInListing();
  const r = await page.evaluate(async () => {
    const pre = document.getElementById('listing');
    const doc = document.getElementById('doc');
    const box = doc.getBoundingClientRect();
    const line = document.caretRangeFromPoint(box.left + box.width / 2, 40).startContainer.parentElement;
    const top = line.getBoundingClientRect().top;
    let walks = 0;
    const create = document.createTreeWalker.bind(document);
    document.createTreeWalker = (root, ...rest) => {
      if (root === pre || root.contains?.(pre)) walks++;
      return create(root, ...rest);
    };
    const grew = await window.__probe.growAbove();
    document.createTreeWalker = create;
    return { straddles: pre.getBoundingClientRect().top < 0, grew, moved: line.getBoundingClientRect().top - top, walks };
  });
  assert.ok(r.straddles, 'the listing starts above the screen');
  assert.ok(r.grew >= 20, `the paragraph above grew ${r.grew.toFixed(1)} px`);
  assert.ok(Math.abs(r.moved) <= 1, `the line under the reading line moved ${r.moved.toFixed(2)} px`);
  assert.equal(r.walks, 0, 'no walk over the listing\'s text to find the character again');
  await page.close();
});

test('a character under the reading line that paints no box after the pass leaves the block\'s top to follow', async () => {
  const page = await deepInListing();
  const r = await page.evaluate(async () => {
    const pre = document.getElementById('listing');
    const top = pre.getBoundingClientRect().top;
    // During the pass (a revert normalises the paragraph above), the lines at the reading line are hidden.
    let hid = 0;
    const normalize = Element.prototype.normalize;
    Element.prototype.normalize = function () {
      if (hid === 0) {
        for (const s of pre.children) {
          const b = s.getBoundingClientRect();
          if (b.bottom > -5 && b.top < 100) {
            s.style.display = 'none';
            hid++;
          }
        }
      }
      return normalize.call(this);
    };
    const grew = await window.__probe.growAbove();
    Element.prototype.normalize = normalize;
    return { grew, hid, moved: pre.getBoundingClientRect().top - top };
  });
  assert.ok(r.hid > 0, 'the lines at the reading line were hidden during the pass');
  assert.ok(r.grew >= 20, `the paragraph above grew ${r.grew.toFixed(1)} px`);
  assert.ok(Math.abs(r.moved) <= 1, `the listing's top moved ${r.moved.toFixed(2)} px: the ${r.grew.toFixed(1)} px growth above should be compensated by the block's top`);
  await page.close();
});

test('inside a set paragraph the pass leaves alone, the character is read again from its node: one walk, to note it', async () => {
  const before = Array.from({ length: 6 }, () => renderCorpus('01-long-technical.md')).join('\n');
  const page = await harness.open(`${before}<p data-marxy-s="1" id="long">${MARKED.repeat(60)}</p>${renderCorpus('01-long-technical.md')}`);
  await page.evaluate(installProbes);
  await page.evaluate(async () => {
    // Every paragraph set at once, then the idle chunks stall: the re-set below is the only pass.
    const immediate = window.immediateScheduler();
    window.__ctl = window.typeset.attach(document.getElementById('doc'), {
      lineBox: window.lineBox, glueStretchEm: 0.6, lastLineMinWidth: 0.33,
      scheduler: { schedule: (fn) => { if (!window.__stall) immediate.schedule(fn); } },
    });
    await window.__ctl.done;
    window.__stall = true;
  });
  const r = await page.evaluate(async () => {
    const p = document.getElementById('long');
    const rect = p.getBoundingClientRect();
    window.scrollTo(0, rect.top + window.scrollY + rect.height / 2);
    await new Promise((res) => setTimeout(res, 600));
    const doc = document.getElementById('doc');
    const box = doc.getBoundingClientRect();
    const caret = document.caretRangeFromPoint(box.left + box.width / 2, 40);
    const range = document.createRange();
    range.setStart(caret.startContainer, caret.startOffset);
    range.setEnd(caret.startContainer, caret.startOffset + 1);
    const top = range.getClientRects()[0].top;
    let walks = 0;
    const create = document.createTreeWalker.bind(document);
    document.createTreeWalker = (root, ...rest) => {
      if (root === p) walks++;
      return create(root, ...rest);
    };
    const grew = await window.__probe.growAbove();
    document.createTreeWalker = create;
    return { set: p.classList.contains('marxy-set'), straddles: p.getBoundingClientRect().top < 0, grew, moved: range.getClientRects()[0].top - top, walks };
  });
  assert.ok(r.set && r.straddles, 'a set paragraph starting above the screen is under the reading line');
  assert.ok(r.grew >= 20, `the paragraph above grew ${r.grew.toFixed(1)} px`);
  assert.ok(Math.abs(r.moved) <= 1, `the character under the reading line moved ${r.moved.toFixed(2)} px`);
  assert.equal(r.walks, 1, `${r.walks} walks: one over the paragraph, to note the character's offset; none to find it again`);
  await page.close();
});

// B-26: an article inside an element of its own that scrolls (a pane, D-05), below a band the reading
// line must not be measured from. With `scroller` the typesetter holds the place on that element and
// reads the reading line from its top; the window, which does not scroll, is left alone.
test('in an element that scrolls on its own, below a band, a re-set above its reading line leaves the reading block within 1 px', async () => {
  const html = Array.from({ length: 6 }, () => renderCorpus('01-long-technical.md')).join('\n');
  const page = await harness.open(html);
  const r = await page.evaluate(async () => {
    const frames = (n) => new Promise((res) => {
      const tick = () => (n-- <= 0 ? res() : requestAnimationFrame(tick));
      tick();
    });
    const doc = document.getElementById('doc');
    const band = document.createElement('div');
    band.style.cssText = 'height: 120px;';
    const pane = document.createElement('section');
    pane.style.cssText = 'height: calc(100vh - 120px); overflow-y: auto;';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    doc.before(band, pane);
    pane.append(doc);
    const controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, lastLineMinWidth: 0.33, scheduler: window.immediateScheduler(),
      scroller: () => pane,
    });
    await controller.done;
    pane.scrollTop = pane.scrollHeight * 0.6;
    // Past the quiet window that leaving the top counts as the reader's input.
    await new Promise((res) => setTimeout(res, 400));
    await frames(2);
    const top = pane.getBoundingClientRect().top;
    const el = [...doc.children].find((c) => c.getBoundingClientRect().bottom > top + 100);
    const before = el.getBoundingClientRect().top;
    const far = [...doc.querySelectorAll('p.marxy-set')].filter((p) => p.getBoundingClientRect().bottom < top - window.innerHeight).at(-1);
    const h = far.getBoundingClientRect().height;
    far.appendChild(document.createTextNode(' ' + 'further words that fill more lines of the measure '.repeat(4)));
    // The typesetter's mutation observer runs as a microtask: revert, re-set, compensate.
    await Promise.resolve();
    await Promise.resolve();
    const grew = far.getBoundingClientRect().height - h;
    const drift = el.getBoundingClientRect().top - before;
    controller.destroy();
    return { grew, drift, scrollTop: pane.scrollTop, windowY: window.scrollY };
  });
  assert.ok(r.scrollTop > 1000, `the pane scrolled to ${r.scrollTop}`);
  assert.ok(r.grew >= 20, `the paragraph above grew ${r.grew.toFixed(1)} px`);
  assert.ok(Math.abs(r.drift) <= 1, `the reading block moved ${r.drift.toFixed(2)} px after a ${r.grew.toFixed(1)} px growth above`);
  assert.equal(r.windowY, 0, 'the window did not scroll');
  await page.close();
});

// B-26.2: the listeners are on the window, so in a pane they also hear the other pane. Input outside
// the scroller must not hold off this scroller's place; input inside it still does; the page's own
// scroller takes every event, as before (the tests above).
test('in a pane, a wheel, key or scroll outside it leaves its reading block within 1 px; the same inside it holds the compensation off', async () => {
  const html = Array.from({ length: 6 }, () => renderCorpus('01-long-technical.md')).join('\n');
  const page = await harness.open(html);
  const r = await page.evaluate(async () => {
    const frames = (n) => new Promise((res) => {
      const tick = () => (n-- <= 0 ? res() : requestAnimationFrame(tick));
      tick();
    });
    const doc = document.getElementById('doc');
    const band = document.createElement('div');
    band.style.cssText = 'height: 120px;';
    const pane = document.createElement('section');
    pane.style.cssText = 'height: calc(100vh - 120px); overflow-y: auto;';
    const other = document.createElement('section');
    other.style.cssText = 'height: 40px; overflow-y: auto;';
    const filler = document.createElement('div');
    filler.style.height = '400px';
    other.append(filler);
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    doc.before(band, other, pane);
    pane.append(doc);
    const controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, lastLineMinWidth: 0.33, scheduler: window.immediateScheduler(),
      scroller: () => pane,
    });
    await controller.done;
    pane.scrollTop = pane.scrollHeight * 0.6;
    await new Promise((res) => setTimeout(res, 400));
    await frames(2);
    const grow = async (fire) => {
      await new Promise((res) => setTimeout(res, 400));
      const top = pane.getBoundingClientRect().top;
      const el = [...doc.children].find((c) => c.getBoundingClientRect().bottom > top + 100);
      const before = el.getBoundingClientRect().top;
      const far = [...doc.querySelectorAll('p.marxy-set')].filter((p) => p.getBoundingClientRect().bottom < top - window.innerHeight).at(-1);
      fire();
      far.appendChild(document.createTextNode(' ' + 'further words that fill more lines of the measure '.repeat(4)));
      await Promise.resolve();
      await Promise.resolve();
      return el.getBoundingClientRect().top - before;
    };
    const out = {};
    out.wheelOutside = await grow(() => other.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })));
    out.keyOutside = await grow(() => other.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })));
    out.scrollOutside = await grow(() => { other.scrollTop = 20; other.dispatchEvent(new Event('scroll')); });
    out.wheelInside = await grow(() => pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })));
    controller.destroy();
    return out;
  });
  assert.ok(Math.abs(r.wheelOutside) <= 1, `a wheel outside moved the reading block ${r.wheelOutside.toFixed(2)} px`);
  assert.ok(Math.abs(r.keyOutside) <= 1, `a key outside moved the reading block ${r.keyOutside.toFixed(2)} px`);
  assert.ok(Math.abs(r.scrollOutside) <= 1, `a scroll outside moved the reading block ${r.scrollOutside.toFixed(2)} px`);
  assert.ok(Math.abs(r.wheelInside) > 1, `a wheel inside still holds the compensation off (moved ${r.wheelInside.toFixed(2)} px)`);
  await page.close();
});

// B-26.1: a scroller put at its end before its paragraphs are set. Inside a size container (the app's
// pane, `container-type: inline-size`, D-01), WebKit lays a paragraph whose text node was split out,
// for a moment inside one layout, as short as what that node kept; a scroller within that much of its
// end clamped its offset to it and kept the clamp, some hundreds of px a batch, inside the quiet window
// after the reader's scroll where nothing compensates. The batch runs in the same task as the scroll
// here, so it is inside that window for certain. The hold is a style write on the article, taken only
// near the end: at the top and mid-document it writes nothing.
for (const where of ['pane', 'window']) {
  test(`${where === 'pane' ? 'a pane' : 'the window'} put at its end, then a batch of paragraphs far above set at once: the last block stays where it was`, async () => {
  const html = Array.from({ length: 4 }, () => renderCorpus('15-prose-volume.md')).join('\n');
  {
    const page = await harness.open(html);
    const r = await page.evaluate(async (where) => {
      const doc = document.getElementById('doc');
      // The app's pane: a size container, which scrolls itself with two panes and leaves the window to with one.
      const pane = document.createElement('section');
      pane.style.containerType = 'inline-size';
      doc.before(pane);
      pane.append(doc);
      let root = document.documentElement;
      if (where === 'pane') {
        pane.style.height = '100vh';
        pane.style.overflowY = 'auto';
        document.body.style.margin = '0';
        document.body.style.overflow = 'hidden';
        root = pane;
      }
      let step = null;
      const writes = [];
      new MutationObserver((records) => { for (const m of records) writes.push(m.attributeName); })
        .observe(doc, { attributes: true, attributeFilter: ['style'] });
      const controller = window.typeset.attach(doc, {
        lineBox: window.lineBox, glueStretchEm: 0.6, lastLineMinWidth: 0.33,
        scheduler: { schedule(fn) { step = fn; } },
        ...(where === 'pane' ? { scroller: () => root } : {}),
      });
      await controller.ready;
      const run = (n) => {
        for (let i = 0; i < n && step !== null; i++) {
          const s = step;
          step = null;
          s(() => 50);
        }
      };
      // At the top: batches below the screen, no hold.
      run(2);
      await Promise.resolve();
      const atTop = writes.length;
      // Straight from the top to the end, as an open that lands there or the reader's first scroll does
      // (it counts as the reader's input), and the next batches (paragraphs near the top, far above) set
      // in the same task, inside the quiet window that follows.
      root.scrollTop = root.scrollHeight;
      const box = () => (root === document.documentElement ? { top: 0, bottom: innerHeight } : root.getBoundingClientRect());
      const last = doc.lastElementChild;
      const bottom = last.getBoundingClientRect().bottom;
      const short = () => root.scrollHeight - root.clientHeight - root.scrollTop;
      const startShort = short();
      const set0 = doc.querySelectorAll('.marxy-set').length;
      run(4);
      const set = doc.querySelectorAll('.marxy-set').length - set0;
      const r = last.getBoundingClientRect();
      const endShort = short();
      await Promise.resolve();
      const atEnd = writes.length - atTop;
      const minHeight = doc.style.minHeight;
      // Mid-document, past the quiet window: no hold.
      root.scrollTop = root.scrollHeight * 0.5;
      await new Promise((res) => setTimeout(res, 400));
      run(2);
      await Promise.resolve();
      const out = {
        atTop, atEnd, midway: writes.length - atTop - atEnd, minHeight,
        set, startShort, endShort, drift: r.bottom - bottom, inView: r.bottom <= box().bottom + 1 && r.bottom > box().top,
        windowY: where === 'pane' ? window.scrollY : 0,
      };
      controller.destroy();
      return out;
    }, where);
    console.log(where, JSON.stringify(r));
    assert.ok(r.set >= 8, `${where}: ${r.set} paragraphs set at the end`);
    assert.ok(r.startShort <= 1, `${where}: at its end (${r.startShort} px short)`);
    assert.ok(Math.abs(r.drift) <= 1, `${where}: the last block moved ${r.drift.toFixed(2)} px as paragraphs far above were set (${r.endShort.toFixed(1)} px short of the end after)`);
    assert.ok(r.inView, `${where}: the last block is in view`);
    assert.equal(r.atTop, 0, `${where}: no write to the article's style at the top`);
    assert.equal(r.midway, 0, `${where}: no write to the article's style mid-document`);
    assert.ok(r.atEnd >= 2, `${where}: the hold was taken and given back at the end (${r.atEnd} style writes)`);
    assert.equal(r.minHeight, '', `${where}: the article's min-height is its own again`);
    assert.equal(r.windowY, 0, `${where}: the window did not scroll`);
    await page.close();
  }
  });
}
