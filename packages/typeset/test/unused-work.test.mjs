// What the typesetter does that nobody uses, counted and not timed: the layout reads at attach, the revert on a
// teardown that discards the page, a pass announced when nothing moved, and the kill switch's reads.
// Playwright WebKit only.

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

const SET_IS_TALLER = 'p.marxy-set { padding-bottom: 7px; }';

const proseParagraphs = (n) =>
  Array.from({ length: n }, (_, i) =>
    `<p data-marxy-s="${i}">Paragraph ${i} is long enough to wrap over several lines, with words in it that the line breaker has real choices about, and a few more so it does.</p>`).join('');

// A paragraph a little over one line wraps to two lines either way: setting it moves nothing.
const twoLines = (n) =>
  Array.from({ length: n }, (_, i) =>
    `<p data-marxy-s="${i}">Paragraph ${i} runs a little past one line of this page, so the engine wraps it in two, and so does the breaker, with a rag of its own and no change in height.</p>`).join('');

/** In-page: counts the layout reads of every kind made while `work` runs. */
const countReads = async (work) => {
  let reads = 0;
  const rect = Element.prototype.getBoundingClientRect;
  const rects = Element.prototype.getClientRects;
  const rangeRects = Range.prototype.getClientRects;
  Element.prototype.getBoundingClientRect = function () { reads++; return rect.call(this); };
  Element.prototype.getClientRects = function () { reads++; return rects.call(this); };
  Range.prototype.getClientRects = function () { reads++; return rangeRects.call(this); };
  try { await work(); } finally {
    Element.prototype.getBoundingClientRect = rect;
    Element.prototype.getClientRects = rects;
    Range.prototype.getClientRects = rangeRects;
  }
  return reads;
};

test('attaching to a long article makes about as many layout reads as to a short one: the viewport is found by bisection', async () => {
  const reads = {};
  for (const n of [200, 2000]) {
    const page = await harness.open(proseParagraphs(n), { height: 600 });
    reads[n] = await page.evaluate(async ({ countReads }) => {
      const count = new Function(`return (${countReads})`)();
      return count(async () => {
        window.controller = window.typeset.attach(document.getElementById('doc'), {
          lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: () => {} },
        });
        await window.controller.ready;
      });
    }, { countReads: countReads.toString() });
    await page.close();
  }
  assert.ok(reads[200] > 0, 'the first pass reads layout');
  // Two bisections cost a few reads more for ten times the paragraphs; measuring each paragraph was 1,800 more.
  assert.ok(reads[2000] - reads[200] <= 16, `reads before the first slice: ${JSON.stringify(reads)}`);
});

test('the first pass sets the whole screen where paragraphs do not stack: a folded section below it, a table row across it', async () => {
  const pages = {
    folded: { html: proseParagraphs(10) + proseParagraphs(200).replaceAll('<p ', '<p class="marxy-fold-out" ') + proseParagraphs(30), at: null },
    table: { html: `${proseParagraphs(40)}<table><tbody><tr><td>${proseParagraphs(6)}</td><td>${proseParagraphs(1)}</td></tr></tbody></table>${proseParagraphs(40)}`, at: 'table' },
  };
  for (const [name, { html, at }] of Object.entries(pages)) {
    const page = await harness.open(html, { height: 600 });
    const missed = await page.evaluate(async (at) => {
      const doc = document.getElementById('doc');
      const base = at === null ? 0 : doc.querySelector(at).getBoundingClientRect().top + window.scrollY;
      const missed = [];
      for (let dy = at === null ? 0 : -700; dy <= (at === null ? 0 : 500); dy += 25) {
        window.scrollTo(0, Math.max(0, base + dy));
        const c = window.typeset.attach(doc, { lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: () => {} } });
        await c.ready;
        for (const p of doc.querySelectorAll('p')) {
          const r = p.getBoundingClientRect();
          if (r.height > 0 && r.bottom > 0 && r.top < innerHeight && !p.classList.contains('marxy-set')) missed.push(`${dy}: ${p.textContent.slice(0, 12)}`);
        }
        c.destroy();
      }
      return missed;
    }, at);
    assert.deepEqual(missed, [], `${name}: on screen and not set when ready`);
    await page.close();
  }
});

test('the first pass sets a paragraph in a box placed out of the flow over the screen, as a note in the margin is', async () => {
  const page = await harness.open(`${proseParagraphs(120)}<div class="aside" style="position:absolute;right:0;width:200px">${proseParagraphs(1)}</div>`, { height: 600 });
  const r = await page.evaluate(async () => {
    const doc = document.getElementById('doc');
    doc.style.position = 'relative';
    const aside = doc.querySelector('.aside');
    const out = [];
    for (const y of [0, 3000, 6000]) {
      window.scrollTo(0, y);
      aside.style.top = `${window.scrollY - (doc.getBoundingClientRect().top + window.scrollY) + 100}px`;
      const c = window.typeset.attach(doc, { lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: () => {} } });
      await c.ready;
      const box = aside.getBoundingClientRect();
      out.push({ y, onScreen: box.top < innerHeight && box.bottom > 0, set: aside.firstElementChild.classList.contains('marxy-set') });
      c.destroy();
    }
    return out;
  });
  for (const at of r) assert.deepEqual(at, { y: at.y, onScreen: true, set: true }, JSON.stringify(r));
  await page.close();
});

test('on a page scrolled to the middle the screen is set first, and the queue runs outward from it by place in the document', async () => {
  const page = await harness.open(proseParagraphs(300), { height: 600 });
  const r = await page.evaluate(async () => {
    const doc = document.getElementById('doc');
    window.scrollTo(0, doc.children[150].getBoundingClientRect().top + window.scrollY - 100);
    const queued = [];
    window.controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: (work) => queued.push(work) },
    });
    await window.controller.ready;
    const kids = [...doc.children];
    const setNow = () => kids.map((p, k) => (p.classList.contains('marxy-set') ? k : -1)).filter((k) => k >= 0);
    const onScreen = setNow();
    const seen = new Set(onScreen);
    const chunks = [];
    for (let i = 0; i < 20 && queued.length; i++) {
      queued.shift()(() => 0.001);
      const fresh = setNow().filter((k) => !seen.has(k));
      for (const k of fresh) seen.add(k);
      chunks.push(fresh);
    }
    return { onScreen, chunks };
  });
  assert.ok(r.onScreen.length > 3, `the screen is set at once: ${r.onScreen}`);
  assert.ok(r.onScreen.every((k) => k > 100 && k < 200), `and it is the screen that was scrolled to: ${r.onScreen}`);
  const low = Math.min(...r.onScreen);
  const high = Math.max(...r.onScreen);
  const away = (k) => (k > high ? k - high : low - k);
  const chunks = r.chunks.filter((c) => c.length > 0).map((c) => c.map(away));
  assert.ok(chunks.length >= 3, `the background set some: ${JSON.stringify(r.chunks)}`);
  // Within a chunk the paragraphs are in document order; between chunks, nearest first (a pair at one distance may straddle two).
  for (let i = 1; i < chunks.length; i++) assert.ok(Math.max(...chunks[i - 1]) <= Math.min(...chunks[i]) + 1, `outward: ${JSON.stringify(chunks)}`);
  const all = r.chunks.flat();
  assert.ok(all.some((k) => k < low) && all.some((k) => k > high), 'above and below');
  await page.close();
});

test('destroy with discard writes nothing and leaves the set page as it is, and nothing queued runs after it', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'), { height: 400 });
  const original = await page.evaluate(() => document.getElementById('doc').innerHTML);
  const r = await page.evaluate(async () => {
    const doc = document.getElementById('doc');
    const queued = [];
    const controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: (work) => queued.push(work) },
    });
    await controller.ready;
    const set = doc.innerHTML;
    const setCount = doc.querySelectorAll('.marxy-set').length;
    const watch = new MutationObserver(() => {});
    watch.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });
    controller.destroy({ discard: true });
    while (queued.length) queued.shift()(() => Number.POSITIVE_INFINITY);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return { records: watch.takeRecords().length, same: doc.innerHTML === set, setCount };
  });
  assert.ok(r.setCount > 0, 'something was set');
  assert.equal(r.records, 0, 'no mutation');
  assert.ok(r.same, 'the set page is as it was');
  assert.notEqual(await page.evaluate(() => document.getElementById('doc').innerHTML), original, 'and it is still set');
  await page.close();
});

test('destroy without an option restores the article exactly', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'), { height: 400 });
  const r = await page.evaluate(async () => {
    const doc = document.getElementById('doc');
    const before = doc.innerHTML;
    const controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: window.immediateScheduler(),
    });
    await controller.done;
    const set = doc.querySelectorAll('.marxy-set').length;
    controller.destroy({});
    return { set, same: doc.innerHTML === before };
  });
  assert.ok(r.set > 0);
  assert.ok(r.same);
  await page.close();
});

/** Attaches with the idle chunks held, waits for the visibility observer to set the margin, and reports what `onPass` heard. */
const visiblePasses = (page) =>
  page.evaluate(async () => {
    const doc = document.getElementById('doc');
    const native = new Map([...doc.children].map((p) => [p, p.getBoundingClientRect().height]));
    const calls = [];
    window.controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: () => {} },
      onPass: (kind, set) => calls.push({ kind, set: set === undefined ? null : [...set].map((p) => p.classList.contains('marxy-set')) }),
    });
    await window.controller.ready;
    const atFirst = doc.querySelectorAll('.marxy-set').length;
    for (let i = 0; i < 60 && doc.querySelectorAll('.marxy-set').length === atFirst; i++) await new Promise((res) => requestAnimationFrame(res));
    for (let i = 0; i < 6; i++) await new Promise((res) => requestAnimationFrame(res));
    const set = [...doc.querySelectorAll('.marxy-set')];
    return {
      calls,
      viewportSet: atFirst,
      observerSet: set.length - atFirst,
      moved: set.filter((p) => Math.abs(p.getBoundingClientRect().height - native.get(p)) >= 0.5).length,
    };
  });

test('a visible pass that leaves every height as it was does not announce itself', async () => {
  const page = await harness.open(twoLines(200), { height: 400, width: 1100 });
  const r = await visiblePasses(page);
  assert.ok(r.observerSet > 0, `the observer set the margin: ${r.observerSet}`);
  assert.equal(r.moved, 0, 'no paragraph changed height');
  assert.deepEqual(r.calls.filter((c) => c.kind === 'visible'), [], 'no visible pass was announced');
  await page.close();
});

test('a visible pass that changes heights announces itself with the paragraphs it set', async () => {
  const page = await harness.open(twoLines(200), { height: 400, width: 1100, extraCss: SET_IS_TALLER });
  const r = await visiblePasses(page);
  assert.ok(r.observerSet > 0, `the observer set the margin: ${r.observerSet}`);
  const visible = r.calls.filter((c) => c.kind === 'visible');
  assert.ok(visible.length > 0, 'a visible pass was announced');
  for (const c of visible) assert.ok(c.set !== null && c.set.length > 0 && c.set.every(Boolean), `with the paragraphs it set: ${JSON.stringify(c)}`);
  assert.equal(visible.reduce((n, c) => n + c.set.length, 0), r.observerSet, 'all of them');
  const viewport = r.calls.find((c) => c.kind === 'viewport');
  assert.equal(viewport?.set?.length, r.viewportSet, 'the viewport pass names what it set');
  await page.close();
});

test('the kill switch is read once for a batch that writes markers, and once to adopt paragraphs', async () => {
  const words = 'Every line of this paragraph is filled close to the measure by the breaker, so a marker added later has nowhere to go but past the edge. ';
  const filler = Array.from({ length: 80 }, (_, i) => `<p data-marxy-s="${i + 1}">${words.repeat(2).trim()}</p>`).join('');
  const page = await harness.open(`<p data-marxy-s="0">${words.repeat(4).trim()}</p>${filler}`, { width: 320, height: 300 });
  const r = await page.evaluate(async ({ words }) => {
    const doc = document.getElementById('doc');
    const queued = [];
    window.controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: (work) => queued.push(work) },
    });
    await window.controller.ready;
    const first = doc.firstElementChild;
    let reads = 0;
    const real = window.getComputedStyle;
    window.getComputedStyle = (el, ...rest) => {
      if (el === doc) reads++;
      return real.call(window, el, ...rest);
    };
    try {
      // A marker on the fullest line of a set paragraph, and a chunk that runs before the change watcher does.
      const lbs = [...first.querySelectorAll('.marxy-lb')];
      const fullest = lbs.reduce((a, b) => (b.getBoundingClientRect().left > a.getBoundingClientRect().left ? b : a));
      const mark = document.createElement('code');
      mark.className = 'marxy-invisible marxy-invisible-bidi';
      const glyph = document.createElement('code');
      glyph.className = 'marxy-invisible-glyph';
      glyph.textContent = '202E';
      const byte = document.createElement('code');
      byte.className = 'marxy-invisible-byte marxy-invisible-bidi';
      byte.textContent = 'â€®';
      mark.append(glyph, byte);
      fullest.before(mark);
      const tagged = new Set(first.querySelectorAll('.marxy-lb'));
      reads = 0;
      queued.shift()(() => Number.POSITIVE_INFINITY);
      const forBatch = reads;
      const wasReset = [...first.querySelectorAll('.marxy-lb')].some((lb) => !tagged.has(lb));
      const extra = document.createElement('p');
      extra.setAttribute('data-marxy-s', '999');
      extra.textContent = words.repeat(2);
      doc.append(extra);
      reads = 0;
      window.controller.adopt([extra]);
      return { forBatch, forAdopt: reads, wasReset };
    } finally {
      window.getComputedStyle = real;
    }
  }, { words });
  assert.ok(r.wasReset, 'the batch set the marked paragraph again: the case this counts');
  assert.equal(r.forBatch, 1, 'one read of the kill switch for the whole batch');
  assert.equal(r.forAdopt, 1, 'adopt reads it once');
  await page.close();
});

test('with the kill switch turned on after the page was set, adopting a paragraph leaves the page set', async () => {
  const page = await harness.open(proseParagraphs(60), { height: 600 });
  const r = await page.evaluate(async () => {
    const doc = document.getElementById('doc');
    const queued = [];
    const c = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: (work) => queued.push(work) },
    });
    await c.ready;
    while (queued.length) queued.shift()(() => Number.POSITIVE_INFINITY);
    await c.done;
    const before = doc.querySelectorAll('.marxy-set').length;
    doc.style.setProperty('--marxy-typeset', 'none');
    const extra = document.createElement('p');
    extra.setAttribute('data-marxy-s', '999');
    extra.textContent = 'A paragraph added after the switch went off.';
    doc.append(extra);
    c.adopt([extra]);
    const queuedByAdopt = queued.length;
    while (queued.length) queued.shift()(() => Number.POSITIVE_INFINITY);
    return { before, queuedByAdopt, after: doc.querySelectorAll('.marxy-set').length };
  });
  assert.equal(r.before, 60);
  assert.equal(r.queuedByAdopt, 0, 'nothing queued');
  assert.equal(r.after, 60, 'the page is still set');
  await page.close();
});
