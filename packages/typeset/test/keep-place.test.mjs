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
