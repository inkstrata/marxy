// The grid holds at every text size once the typesetter has set the page (B-22). At most body sizes
// (27 of 15 to 50 px, 16 and 28 among them, never the default 20), WebKit placed a hung grapheme's
// inline-block (hang.ts) 1/64 px off its line's own box, so every line holding one grew by 1/64 px.
// The grid pass treats a block within half a pixel of the grid as on it, so the drift climbed to
// nearly half a pixel between resets, and inside a list, where the pass does not reach, each item
// carried it past the aesthetics gate's 0.5 px tolerance (fixtures/corpus/32-long-reference.md at
// 960 px). The fix is the line box, not the pass: `.marxy-hang` has no line height of its own
// (base.css), so set text is a whole number of lines tall.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { renderSafeHtml } from '../../core/src/render/pipeline.ts';
import { startHarness } from './harness.mjs';

/**
 * A job without Playwright's WebKit (CI's `fast` job) skips these tests and says why, unless
 * MARXY_BROWSER_TESTS_REQUIRED=1, where a missing browser is a failure as it should be.
 */
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

/**
 * How far a block's top may sit from the grid. Layout positions are 1/64 px apart, so this is a few
 * of those: far tighter than the gate's 0.5 px, because 0.5 px is where the drift was already visible
 * and the pass had stopped correcting it.
 */
const TOLERANCE = 0.1;

/**
 * The tokens a body size overrides, as apps/desktop/src/theme/reader-config.ts `sizeProperties` writes
 * them on the root: the line box twice the rounded three-quarter, the code face nine-tenths to the half pixel.
 */
function sizeProperties(size) {
  const lineBox = `${2 * Math.round(0.75 * size)}px`;
  return { '--marxy-size-body': `${size}px`, '--marxy-line-box': lineBox, '--marxy-size-code': `${Math.round(size * 1.8) / 2}px`, '--marxy-line-box-code': lineBox };
}

/**
 * The long reference's opening sections (long set paragraphs, many with a hung first letter) and its
 * changelog (lists whose items each hold one): the region where the drift was found.
 */
const source = readFileSync(new URL('../../../fixtures/corpus/32-long-reference.md', import.meta.url), 'utf8').split('\n');
const changelog = source.findIndex((line) => line.startsWith('## 21. Changelog'));
const render = (lines) => renderSafeHtml(new TextEncoder().encode(lines.join('\n')), { file: '32-long-reference.md' }).html;
const html = render([...source.slice(0, 400), ...source.slice(changelog, changelog + 264)]);
/** A shorter cut for the sweep: enough hung lines that one grown line in each shows. */
const short = render([...source.slice(0, 120), ...source.slice(changelog, changelog + 60)]);

let harness;
before(async () => { if (!skip) harness = await startHarness(); });
after(async () => { await harness?.close(); });

/**
 * Sets the page at each size in turn as the app does (hanging and all), puts it on the grid, and reads
 * every block. One page serves every size: the typesetter is destroyed, which restores the article,
 * before the next size is applied, so each size is set from the same markup.
 */
async function measure(sizes, doc = html) {
  const page = await harness.open(doc);
  try {
    const out = [];
    for (const size of sizes) out.push(await page.evaluate(measureAt, sizeProperties(size)));
    return out;
  } finally {
    await page.close();
  }
}

/** In the page: one size, set and snapped and read. */
async function measureAt(properties) {
  const doc = document.getElementById('doc');
  window.controller?.destroy();
  for (const [name, value] of Object.entries(properties)) document.documentElement.style.setProperty(name, value);
  const lineBox = parseFloat(getComputedStyle(doc).lineHeight);
  window.controller = window.typeset.attach(doc, {
    lineBox, glueStretchEm: 0.6, hyphenate: true, lastLineMinWidth: 0.33, hanging: 'left', scheduler: window.immediateScheduler(),
  });
  await window.controller.done;
  window.typeset.snapToGrid(doc, lineBox);
  const unit = lineBox / 2;
  const origin = doc.getBoundingClientRect().top;
  const off = (length) => {
    const r = ((length % unit) + unit) % unit;
    return Math.min(r, unit - r);
  };
  let worst = { off: 0, at: '' };
  let blocks = 0;
  for (const el of doc.querySelectorAll('[data-marxy-s]')) {
    if (!['block', 'table', 'list-item', 'flow-root'].includes(getComputedStyle(el).display)) continue;
    blocks++;
    const top = el.getBoundingClientRect().top - origin;
    if (off(top) > worst.off) worst = { off: off(top), at: `<${el.tagName.toLowerCase()}> top ${top}` };
  }
  // The source of drift, read directly: a set paragraph is a whole number of lines tall.
  let grown = 0;
  for (const p of doc.querySelectorAll('p.marxy-set')) {
    if (getComputedStyle(p).display === 'block' && off(p.getBoundingClientRect().height) > 0) grown++;
  }
  return { size: parseFloat(getComputedStyle(doc).fontSize), unit, blocks, hangs: doc.querySelectorAll('.marxy-hang').length, worst, grown };
}

for (const size of [16, 20, 28]) {
  test(`at body size ${size}, every block, list items included, starts within ${TOLERANCE} px of the grid`, async () => {
    const [r] = await measure([size]);
    assert.ok(r.hangs > 100 && r.blocks > 300, `the fixture should set many hung lines and blocks: ${JSON.stringify(r)}`);
    assert.ok(r.worst.off <= TOLERANCE, `${r.worst.at} is ${r.worst.off.toFixed(4)} px off a ${r.unit} px unit`);
    assert.equal(r.grown, 0, `set paragraphs taller than a whole number of lines at ${size} px`);
  });
}

test(`at every body size from 15 to 50 px, every block starts within ${TOLERANCE} px of the grid`, async () => {
  const failures = [];
  const sizes = Array.from({ length: 36 }, (_, i) => 15 + i);
  for (const r of await measure(sizes, short)) {
    if (r.grown > 0 || r.worst.off > TOLERANCE) failures.push(`${r.size} px: ${r.grown} grown paragraphs, worst ${r.worst.at} ${r.worst.off.toFixed(4)} px off`);
  }
  assert.deepEqual(failures, []);
});
