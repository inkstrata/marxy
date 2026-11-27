// Hanging punctuation reads the layout once per glyph and style, not once per hung line: setting a long article must
// not lay it out again after every batch's breaks just to learn the advance of a quote it has measured before.

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

test('a hung glyph seen before in the same style is not measured again', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'), { extraCss: '.marxy-article { max-width: 30ch !important; }' });
  const result = await page.evaluate(async () => {
    // Every read of a hang span's own box, as the typesetter measures one: a Range over the span's contents.
    let reads = 0;
    const own = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () {
      if (this.startContainer instanceof Element && this.startContainer.classList.contains('marxy-hang')) reads++;
      return own.call(this);
    };
    const controller = window.typeset.attach(document.getElementById('doc'), {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: true, lastLineMinWidth: 0.33, hanging: 'left', scheduler: window.immediateScheduler(),
    });
    await controller.done;
    Range.prototype.getClientRects = own;
    const spans = [...document.querySelectorAll('.marxy-hang')];
    // What the advance can depend on: the glyph, the face it is set in, and where its paragraph's lines start.
    const kinds = new Set(spans.map((span) => {
      const cs = getComputedStyle(span.parentElement);
      const p = span.closest('.marxy-set');
      return `${span.textContent}|${cs.font}|${cs.fontStyle}|${cs.fontWeight}|${p.getBoundingClientRect().left + parseFloat(getComputedStyle(p).paddingLeft)}`;
    }));
    return { reads, spans: spans.length, kinds: kinds.size, unmeasured: spans.filter((s) => s.style.marginInlineStart === '').length };
  });
  assert.ok(result.spans > 100, `hung lines: ${result.spans}`);
  assert.ok(result.reads <= result.kinds, `${result.reads} advance reads for ${result.kinds} kinds of hung glyph on ${result.spans} lines`);
  assert.equal(result.unmeasured, 0, 'every hung glyph is pulled into the margin');
  await page.close();
});

test('a face that finishes loading makes the next batch measure its hung glyphs again', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'), { extraCss: '.marxy-article { max-width: 30ch !important; }' });
  const reads = await page.evaluate(async () => {
    let reads = 0;
    const own = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () {
      if (this.startContainer instanceof Element && this.startContainer.classList.contains('marxy-hang')) reads++;
      return own.call(this);
    };
    const controller = window.typeset.attach(document.getElementById('doc'), {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: true, lastLineMinWidth: 0.33, hanging: 'left', scheduler: window.immediateScheduler(),
    });
    await controller.done;
    const first = reads;
    // Set again with nothing loaded: every advance is known.
    reads = 0;
    controller.relayout('resize');
    await controller.done;
    const again = reads;
    // A face finished loading (the page's own fonts are loaded already; the event is what the typesetter hears).
    document.fonts.dispatchEvent(new Event('loadingdone'));
    reads = 0;
    controller.relayout('resize');
    await controller.done;
    Range.prototype.getClientRects = own;
    return { first, again, afterLoad: reads };
  });
  assert.ok(reads.first > 0, `the first set measures: ${JSON.stringify(reads)}`);
  assert.equal(reads.again, 0, `nothing new to measure: ${JSON.stringify(reads)}`);
  assert.ok(reads.afterLoad > 0, `after a face loads the advances are read again: ${JSON.stringify(reads)}`);
  await page.close();
});

test('two line starts in one text node, set in place, hang one glyph, not an empty span', async () => {
  const page = await harness.open('<p id="p">“One two<span class="marxy-lb"></span> <span class="marxy-lb"></span>“Three four</p>');
  const result = await page.evaluate(async () => {
    const { applyHang } = await import('/src/hang.ts');
    const p = document.getElementById('p');
    applyHang([p], () => true);
    return [...p.querySelectorAll('.marxy-hang')].map((s) => s.textContent);
  });
  assert.deepEqual(result, ['“', '“']);
  await page.close();
});
