// The typesetter in Playwright WebKit over the rendered corpus (MARXY-23, docs/design/04-typeset.md
// §Tests): body text stays inline HTML, a paragraph that cannot be set is left to the engine, set text
// copies and searches as it did before, the viewport pass fits its budget, and the rag is better than
// the engine's own wrapping.

import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { ragMetrics } from '../scripts/rag-model.mjs';
import { readLines, renderCorpus, startHarness } from './harness.mjs';

let harness;
before(async () => { harness = await startHarness(); });
after(async () => { await harness?.close(); });

/** Attaches with the app's options and runs every chunk now; returns the stats. */
const attach = (page) =>
  page.evaluate(async () => {
    window.controller = window.typeset.attach(document.getElementById('doc'), {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: window.immediateScheduler(),
    });
    await window.controller.done;
    return JSON.parse(JSON.stringify(window.controller.stats));
  });

test('attach then destroy leaves the article exactly as it was', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'));
  const before = await page.evaluate(() => document.getElementById('doc').innerHTML);
  const stats = await attach(page);
  assert.ok(stats.typeset > 50, `expected the prose to be set; ${JSON.stringify(stats)}`);
  assert.notEqual(await page.evaluate(() => document.getElementById('doc').innerHTML), before, 'something was set');
  await page.evaluate(() => window.controller.destroy());
  assert.equal(await page.evaluate(() => document.getElementById('doc').innerHTML), before);
  await page.close();
});

test('a relayout sets the same breaks again: no state accumulates', async () => {
  const page = await harness.open(renderCorpus('01-long-technical.md'));
  await attach(page);
  const first = await page.evaluate(() => document.getElementById('doc').innerHTML);
  await page.evaluate(async () => { window.controller.relayout('reload'); await window.controller.done; });
  assert.equal(await page.evaluate(() => document.getElementById('doc').innerHTML), first);
  await page.close();
});

test('a paragraph the measure cannot hold is left to the engine, with no break left in it', async () => {
  const page = await harness.open(renderCorpus('01-long-technical.md'), { extraCss: '.marxy-article { max-width: 10ch !important; }' });
  const stats = await attach(page);
  const leftovers = await page.evaluate(() => [...document.querySelectorAll('p, li')].filter((p) => !p.classList.contains('marxy-set') && p.querySelector('.marxy-lb')).length);
  assert.ok(stats.fallbacks > 0, JSON.stringify(stats));
  assert.equal(leftovers, 0);
  const overflowing = await page.evaluate(() => [...document.querySelectorAll('.marxy-set')].filter((p) => {
    const r = document.createRange(); r.selectNodeContents(p);
    const right = p.getBoundingClientRect().right;
    return [...r.getClientRects()].some((x) => x.width > 0 && x.right > right + 0.5);
  }).length);
  assert.equal(overflowing, 0, 'no set paragraph paints past its edge');
  await page.close();
});

test('selection, copy and find see the text, not the line breaks', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'));
  const textBefore = await page.evaluate(() => [...document.querySelectorAll('p')].map((p) => p.textContent));
  await attach(page);
  const result = await page.evaluate(() => {
    const p = document.querySelector('p.marxy-set');
    const mark = p.querySelector('.marxy-lb');
    // Select from the word before the first break to the word after it.
    const range = document.createRange();
    const beforeText = mark.previousSibling;
    const afterText = mark.nextSibling;
    range.setStart(beforeText, Math.max(0, beforeText.length - 6));
    range.setEnd(afterText, Math.min(afterText.length, 5));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const selected = getSelection().toString();
    getSelection().removeAllRanges();
    return { selected, texts: [...document.querySelectorAll('p')].map((p) => p.textContent), found: window.find(selected.trim()) };
  });
  assert.deepEqual(result.texts, textBefore, 'textContent is unchanged: find and copy see the same characters');
  assert.ok(!result.selected.includes('\n'), `no newline in ${JSON.stringify(result.selected)}`);
  assert.ok(!result.selected.includes('­'), 'no soft hyphen');
  assert.match(result.selected, /\S \S/, 'the words either side of the break are one space apart');
  assert.equal(result.found, true, 'window.find matches across the break');
  await page.close();
});

test('the viewport is set within its budget', async () => {
  // 100 ms on the reference machine (ADR-0022 product tier); a CI runner gets the envelope.
  const budget = process.env.CI ? 300 : 100;
  for (const file of ['01-long-technical.md', '15-prose-volume.md']) {
    const page = await harness.open(renderCorpus(file));
    const stats = await attach(page);
    assert.ok(stats.viewportMs < budget, `${file}: ${stats.viewportMs.toFixed(1)} ms`);
    await page.close();
  }
});

test('the rag is better than the engine’s own wrapping, for the same number of lines', async () => {
  const opts = { shortLineFraction: 0.1, badnessStretchEm: 2 };
  const pooled = { native: [], set: [] };
  let measure = 0;
  for (const file of ['01-long-technical.md', '14-marxy-plan.md', '15-prose-volume.md']) {
    const page = await harness.open(renderCorpus(file));
    const native = await readLines(page);
    await attach(page);
    const set = await readLines(page);
    await page.close();
    measure = native[0].measure;
    pooled.native.push(...native.map((p) => p.widths));
    pooled.set.push(...set.map((p) => p.widths));
  }
  const n = ragMetrics(pooled.native, measure, opts);
  const s = ragMetrics(pooled.set, measure, opts);
  const lines = (pool) => pool.reduce((sum, w) => sum + w.length, 0);
  assert.ok(s.cv < n.cv, `CV ${s.cv.toFixed(4)} not below native ${n.cv.toFixed(4)}`);
  assert.ok(s.shortLines < n.shortLines, `short lines ${s.shortLines} not below native ${n.shortLines}`);
  assert.ok(Math.abs(lines(pooled.set) - lines(pooled.native)) <= 2, `lines ${lines(pooled.native)} → ${lines(pooled.set)}`);
});

test('the kill switch leaves everything to the engine', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'), { extraCss: '.marxy-article { --marxy-typeset: none; }' });
  await attach(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-set, .marxy-lb').length), 0);
  await page.close();
});
