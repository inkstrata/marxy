// The typesetter in Playwright WebKit over the rendered corpus (MARXY-23, docs/design/04-typeset.md
// §Tests): body text stays inline HTML, a paragraph that cannot be set is left to the engine, set text
// copies and searches as it did before, the viewport pass fits its budget, and the rag is better than
// the engine's own wrapping.

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { ragMetrics } from '../scripts/rag-model.mjs';
import { readLines, renderCorpus, startHarness } from './harness.mjs';

/**
 * A job without Playwright's WebKit (CI's `fast` job) skips these tests and says why, unless
 * MARXY_BROWSER_TESTS_REQUIRED=1, where a missing browser is a failure as it should be.
 */
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

let harness;
before(async () => { if (!skip) harness = await startHarness(); });
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

test('the kill switch stops in-flight background typesetting', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'), { height: 320 });
  const result = await page.evaluate(async () => {
    const pending = [];
    const gatedScheduler = { schedule(work) { pending.push(work); } };
    window.controller = window.typeset.attach(document.getElementById('doc'), {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: gatedScheduler,
    });
    await window.controller.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const article = document.getElementById('doc');
    const setBeforeKill = document.querySelectorAll('.marxy-set').length;
    article.style.setProperty('--marxy-typeset', 'none');
    while (pending.length > 0) pending.shift()(() => Number.POSITIVE_INFINITY);
    const scrolled = article.scrollHeight > article.clientHeight;
    if (scrolled) article.scrollTop = article.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const setAfter = document.querySelectorAll('.marxy-set').length;
    return { setBeforeKill, setAfter, pendingLeft: pending.length };
  });
  assert.ok(result.setBeforeKill > 0, 'viewport pass should have set some paragraphs');
  assert.equal(result.setAfter, 0, 'the kill switch reverts what was set and sets nothing further');
  await page.close();
});

/** Attaches with hanging and hyphenation, the story's defaults. */
const attachOn = (page) =>
  page.evaluate(async () => {
    window.controller = window.typeset.attach(document.getElementById('doc'), {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: true, lastLineMinWidth: 0.33, hanging: 'left', scheduler: window.immediateScheduler(),
    });
    await window.controller.done;
    return JSON.parse(JSON.stringify(window.controller.stats));
  });

test('an opening quote hangs left of the content edge by at least 40% of its advance', async () => {
  const html = '<p data-marxy-s="0">“When the ice finally let go of the harbour wall the whole town seemed to exhale, and the first boats nosed out toward a horizon that had been a rumour all winter, carrying the same stores they had carried every spring and the same arguments about weather.”</p>';
  const page = await harness.open(html);
  await attachOn(page);
  const result = await page.evaluate(() => {
    const p = document.querySelector('p.marxy-set');
    const hang = p?.querySelector('.marxy-hang');
    if (p === null || hang === null) return { hung: false };
    const cs = getComputedStyle(p);
    const left = p.getBoundingClientRect().left + parseFloat(cs.paddingLeft);
    const rect = hang.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(hang);
    let advance = 0;
    for (const r of range.getClientRects()) advance = Math.max(advance, r.width);
    return { hung: true, delta: left - rect.left, advance, text: hang.textContent };
  });
  assert.equal(result.hung, true, 'expected a hang span on a quoted paragraph');
  assert.match(result.text, /[“"]/);
  assert.ok(result.delta >= 0.4 * result.advance, `hung ${result.delta.toFixed(2)} px of ${result.advance.toFixed(2)} px advance`);
  await page.close();
});

test('every hung glyph is pulled by its own advance: one ratio per character, a whole advance for an opening quote (B-25)', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'), { extraCss: '.marxy-article { max-width: 30ch !important; }' });
  await attachOn(page);
  const glyphs = await page.evaluate(() => {
    const range = document.createRange();
    return [...document.querySelectorAll('.marxy-hang')].map((hang) => {
      range.selectNodeContents(hang);
      let advance = 0;
      for (const r of range.getClientRects()) advance = Math.max(advance, r.width);
      return { text: hang.textContent, advance, margin: parseFloat(hang.style.marginInlineStart) || 0 };
    });
  });
  assert.ok(glyphs.length > 20, `hung glyphs: ${glyphs.length}`);
  const ratio = new Map();
  for (const g of glyphs) {
    assert.ok(g.advance > 0, `${g.text} has an advance`);
    const r = -g.margin / g.advance;
    if (/^[“"‘]$/.test(g.text)) assert.ok(Math.abs(r - 1) < 1e-6, `${g.text} hangs by its whole advance, not ${r}`);
    if (!ratio.has(g.text)) ratio.set(g.text, r);
    assert.ok(Math.abs(r - ratio.get(g.text)) < 1e-6, `${g.text}: hung by ${r} of its advance here and ${ratio.get(g.text)} elsewhere`);
  }
  assert.ok(ratio.size > 3, `${ratio.size} different characters hung`);
  await page.close();
});

test('a hyphenated break shows a hyphen, keeps find and selection clean, and never splits code', async () => {
  const html = '<p data-marxy-s="0" lang="en-us">Hyphenation internationalization responsibility demonstration of a deliberately overlong paragraph so the breaker must take a hyphenation point rather than leave a hole.</p><p data-marxy-s="1" lang="en-us">A filename like <code>internationalization-config</code> stays whole beside ordinary words that fill the rest of this line enough to typeset.</p>';
  const page = await harness.open(html, { extraCss: '.marxy-article { max-width: 28ch !important; }' });
  await attachOn(page);
  const result = await page.evaluate(() => {
    const hyphens = [...document.querySelectorAll('.marxy-lb.marxy-hyphen')];
    const first = hyphens[0];
    let selected = '';
    if (first !== undefined) {
      const before = first.previousSibling;
      const after = first.nextSibling;
      if (before?.nodeType === Node.TEXT_NODE && after?.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        range.setStart(before, Math.max(0, before.length - 4));
        range.setEnd(after, Math.min(after.length, 4));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        selected = getSelection().toString();
        getSelection().removeAllRanges();
      }
    }
    const codeHyphens = [...document.querySelectorAll('code .marxy-hyphen, code .marxy-lb')].length;
    return {
      hyphenCount: hyphens.length,
      hyphenPainted: first !== undefined && [...first.getClientRects()].some((r) => r.width > 0),
      selected,
      found: window.find('internationalization', false, false, true)
        || window.find('Hyphenation', false, false, true)
        || window.find('responsibility', false, false, true),
      codeHyphens,
      hasSoft: selected.includes('\u00ad'),
    };
  });
  assert.ok(result.hyphenCount > 0, 'expected at least one hyphenated break on a narrow measure');
  assert.equal(result.hyphenPainted, true, 'the hyphen at the line end must be visible');
  assert.equal(result.hasSoft, false, `selection contained a soft hyphen: ${JSON.stringify(result.selected)}`);
  assert.equal(result.found, true, 'find must match the word across the hyphen');
  assert.equal(result.codeHyphens, 0, 'a code span must never hyphenate or break inside');
  await page.close();
});

test('FontSizes tracks computed font size so glue stretch and hyphen width stay current', async () => {
  const html = '<p data-marxy-s="0">A paragraph with enough words to measure spaces and a hyphen-internationalization point.</p>';
  const page = await harness.open(html, { width: 400 });
  const sizes = await page.evaluate(async () => {
    const [{ FontSizes, measureTokens }, { collectTokens }, { insertHyphens, loadHyphenators }] = await Promise.all([
      import('/src/measure.ts'),
      import('/src/runs.ts'),
      import('/src/hyphenate.ts'),
    ]);
    const p = document.querySelector('p');
    p.style.fontSize = '18px';
    void p.offsetHeight;
    const fonts = new FontSizes();
    const hyphenators = await loadHyphenators();
    let tokens = collectTokens(p);
    tokens = insertHyphens(tokens, hyphenators['en-us']);
    const at18 = measureTokens(tokens, fonts);
    const font18 = fonts.of(p);
    const glue18 = at18.find((m) => m.kind === 'space')?.fontSize;
    const hyphen18 = fonts.hyphen(font18, p);
    p.style.fontSize = '36px';
    void p.offsetHeight;
    const font36 = fonts.of(p);
    const at36 = measureTokens(tokens, fonts);
    const glue36 = at36.find((m) => m.kind === 'space')?.fontSize;
    const hyphen36 = fonts.hyphen(font36, p);
    return { glue18, glue36, hyphen18, hyphen36, size18: font18.size, size36: font36.size };
  });
  assert.equal(sizes.size18, 18);
  assert.equal(sizes.size36, 36);
  assert.equal(sizes.glue18, 18);
  assert.equal(sizes.glue36, 36);
  assert.ok(sizes.hyphen36 > sizes.hyphen18 * 1.5, `hyphen width should scale: ${sizes.hyphen18} → ${sizes.hyphen36}`);
  await page.close();
});

test('relayout after a font-size change matches typesetting at the new size', async () => {
  const html = '<p data-marxy-s="0" lang="en-us">Hyphenation internationalization responsibility demonstration of words that fill a narrow measure.</p>';
  const narrow = { width: 300 };
  const breaks = (page) => page.evaluate(() => [...document.querySelectorAll('p .marxy-lb')].map((n) => n.previousSibling?.textContent?.slice(-8) ?? ''));
  const setSize = (page, px) => page.evaluate((size) => { document.querySelector('p').style.fontSize = `${size}px`; }, px);
  const pageDirect = await harness.open(html, narrow);
  await setSize(pageDirect, 28);
  await attach(pageDirect);
  const direct = await breaks(pageDirect);
  await pageDirect.close();
  const pageResize = await harness.open(html, narrow);
  await setSize(pageResize, 14);
  await attach(pageResize);
  await setSize(pageResize, 28);
  await pageResize.evaluate(async () => { window.controller.relayout('resize'); await window.controller.done; });
  const resized = await breaks(pageResize);
  assert.deepEqual(resized, direct, 'resize relayout must re-measure at the new font size');
  await pageResize.close();
});

test('relayout reverts hang spans so no state accumulates', async () => {
  const html = '<p data-marxy-s="0">“A quoted paragraph long enough that the typesetter will break it and hang the opening quote on the first line and again after a relayout, without leaving a nested hang span behind.”</p>';
  const page = await harness.open(html);
  await attachOn(page);
  const first = await page.evaluate(() => document.querySelectorAll('.marxy-hang').length);
  await page.evaluate(async () => { window.controller.relayout('reload'); await window.controller.done; });
  const second = await page.evaluate(() => document.querySelectorAll('.marxy-hang').length);
  assert.ok(first > 0);
  assert.equal(second, first);
  await page.evaluate(() => window.controller.destroy());
  assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-hang, .marxy-hyphen, .marxy-lb').length), 0);
  await page.close();
});

test('a dash that opens a word offers no break; one inside a word still does', async () => {
  const page = await harness.open('<p data-marxy-s="1" id="p1">run with --flag or -5 degrees, "—quoted" and x -y ok well-known a–b</p>');
  const kinds = await page.evaluate(async () => {
    const { collectTokens } = await import('/src/runs.ts');
    return collectTokens(document.getElementById('p1')).map((t) => (t.kind === 'piece' ? `P:${t.text}` : t.kind));
  });
  const joined = kinds.join('|');
  assert.ok(!/P:-\|dash|P:--\|dash|P:"—\|dash|P:—\|dash/.test(joined), joined);
  assert.equal(kinds.filter((k) => k === 'dash').length, 2, joined); // well-known, a–b
  await page.close();
});

test('flipping the kill switch mid-run reverts the paragraphs already set', async () => {
  const para = (i) => `<p data-marxy-s="${i}">${'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(3)}</p>`;
  const page = await harness.open(Array.from({ length: 60 }, (_, i) => para(i + 1)).join(''), { height: 400 });
  const r = await page.evaluate(async () => {
    const jobs = [];
    const doc = document.getElementById('doc');
    const c = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: (w) => jobs.push(w) },
    });
    await c.ready;
    jobs.shift()(() => 1e9);
    const before = doc.querySelectorAll('.marxy-set').length;
    doc.style.setProperty('--marxy-typeset', 'none');
    let guard = 0;
    while (jobs.length && guard++ < 100) jobs.shift()(() => 1e9);
    return { before, after: doc.querySelectorAll('.marxy-set').length, lb: doc.querySelectorAll('.marxy-lb').length };
  });
  assert.ok(r.before > 0, JSON.stringify(r));
  assert.deepEqual([r.after, r.lb], [0, 0], JSON.stringify(r));
  await page.close();
});

test('a hyphenation chunk that fails to load does not stall boot, and the next run retries', async () => {
  const page = await harness.open('<p data-marxy-s="0">' + 'The translator in the novel starts small: a softening of the tone. '.repeat(8) + '</p>');
  const res = await page.evaluate(async () => {
    let calls = 0;
    const real = await (await import('/src/hyphenate.ts')).loadHyphenators();
    const c = window.typeset.attach(document.getElementById('doc'), {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: true, lastLineMinWidth: 0.33, hanging: 'none', scheduler: window.immediateScheduler(),
      loadHyphenators: () => (++calls === 1 ? Promise.reject(new Error('chunk failed')) : Promise.resolve(real)),
    });
    const settled = await Promise.race([Promise.all([c.ready, c.done]).then(() => 'settled'), new Promise((r) => setTimeout(() => r('HUNG'), 3000))]);
    const first = { settled, calls, typeset: c.stats.typeset };
    c.relayout('reload');
    await c.done;
    return { first, calls, hyph: document.querySelectorAll('.marxy-hyphen').length >= 0 };
  });
  assert.equal(res.first.settled, 'settled');
  assert.ok(res.first.typeset > 0, 'set without hyphens');
  assert.equal(res.calls, 2, 'a later run calls the loader again');
  await page.close();
});

test('no set paragraph paints past the measure once the hang is applied, at any width', async () => {
  const files = ['01-long-technical.md', '02-readme-real-world.md', '03-ai-plan.md', '15-prose-volume.md', '17-changelog.md', '16-api-reference.md', '14-marxy-plan.md', '09-gfm-everything.md'];
  const bad = [];
  for (const f of files) {
    for (const width of [340, 420, 520, 640, 760]) {
      const page = await harness.open(renderCorpus(f), { width });
      await attachOn(page);
      const over = await page.evaluate(() => {
        const out = [];
        for (const p of document.querySelectorAll('.marxy-set')) {
          const cs = getComputedStyle(p);
          const right = p.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
          const range = new Range();
          const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          let most = 0;
          for (let t = w.nextNode(); t; t = w.nextNode()) {
            if (t.parentElement.closest('.marxy-lb, .marxy-hyphen')) continue;
            for (let i = 0; i < t.data.length; i++) {
              if (/\s/.test(t.data[i])) continue;
              range.setStart(t, i); range.setEnd(t, i + 1);
              for (const r of range.getClientRects()) most = Math.max(most, r.right - right);
            }
          }
          if (most > 0.5) out.push(most.toFixed(1) + ' ' + p.textContent.slice(0, 30));
        }
        return out;
      });
      for (const o of over) bad.push(`${f}@${width}: ${o}`);
      await page.close();
    }
  }
  assert.deepEqual(bad, []);
});

test('an invisible-character marker adds nothing to its line: the paragraph stays on the baseline grid', async () => {
  const mark = (label, cls = '') => `<code class="marxy-invisible ${cls}"><code class="marxy-invisible-glyph" aria-hidden="true">${label}</code><code class="marxy-invisible-byte" aria-hidden="true">​</code></code>`;
  const html = `<p data-marxy-s="0">Plain words to fill the line here.</p><p data-marxy-s="1">Zero${mark('200B')}width and ${mark('202E', 'marxy-invisible-bidi')} a bidi mark ${mark('tag ×3', 'marxy-invisible-tag')} here.</p>`;
  const page = await harness.open(html);
  const r = await page.evaluate(() => {
    const [plain, marked] = document.querySelectorAll('#doc p');
    const glyphs = [...marked.querySelectorAll('.marxy-invisible-glyph')].map((g) => g.getBoundingClientRect().height);
    return { plain: plain.getBoundingClientRect().height, marked: marked.getBoundingClientRect().height, lineBox: window.lineBox, glyphs };
  });
  assert.equal(r.marked, r.plain, 'markers do not grow the line');
  assert.equal(r.marked % r.lineBox, 0, 'on the grid');
  for (const h of r.glyphs) assert.ok(h < r.lineBox, `a marker (${h}px) is shorter than the line`);
  await page.close();
});

test('a marker written into a set paragraph after setting is set again, before paint, and never overruns (B-02.3)', async () => {
  // As the app runs it: the paragraph is set first, and the invisible-character pass comes later at idle.
  const words = 'Every line of this paragraph is filled close to the measure by the breaker, so a marker added later has nowhere to go but past the edge. ';
  const page = await harness.open(`<p data-marxy-s="0">${words.repeat(4).trim()}</p>`, { width: 320 });
  await attach(page);
  const r = await page.evaluate(async () => {
    const p = document.querySelector('#doc p');
    const set = window.controller.stats.typeset;
    // Every break ends a line; put a marker before the one whose line ends nearest the measure.
    const right = p.getBoundingClientRect().right;
    const lbs = [...p.querySelectorAll('.marxy-lb')];
    const fullest = lbs.reduce((a, b) => (b.getBoundingClientRect().left > a.getBoundingClientRect().left ? b : a));
    const mark = document.createElement('code');
    mark.className = 'marxy-invisible marxy-invisible-bidi';
    const glyph = document.createElement('code');
    glyph.className = 'marxy-invisible-glyph';
    glyph.textContent = '202E';
    const byte = document.createElement('code');
    byte.className = 'marxy-invisible-byte marxy-invisible-bidi';
    byte.textContent = '\u202e';
    mark.append(glyph, byte);
    fullest.before(mark);
    // The change watcher runs as a microtask: by the next frame (before paint) the paragraph is reset.
    await Promise.resolve();
    const range = document.createRange();
    range.selectNodeContents(p);
    const most = Math.max(...[...range.getClientRects()].filter((x) => x.width > 0).map((x) => x.right));
    return { most, right, set, after: window.controller.stats.typeset, stillSet: p.classList.contains('marxy-set'), hasMark: p.contains(mark) };
  });
  assert.ok(r.set > 0, 'the paragraph was set');
  assert.equal(r.hasMark, true, 'the marker is kept');
  assert.equal(r.stillSet, true, 'the paragraph is set again, not left to the engine');
  assert.equal(r.after, r.set, 'set again, not counted twice');
  assert.ok(r.most <= r.right + 0.5, `a line paints to ${r.most}px past the measure's ${r.right}px`);
  // The typesetter's own writes are not taken for a change: a relayout settles to the same page.
  const first = await page.evaluate(() => document.getElementById('doc').innerHTML);
  await page.evaluate(async () => { window.controller.relayout('reload'); await window.controller.done; await Promise.resolve(); });
  assert.equal(await page.evaluate(() => document.getElementById('doc').innerHTML), first);
  await page.close();
});

/** Paragraphs with three links each, like a link-heavy README (the reviewer's 1.1 MB probe, smaller). */
const linkParagraphs = (n) => Array.from({ length: n }, (_, i) =>
  `<p data-marxy-s="${i}">Paragraph ${i} has a <a href="https://example.com/a/${i}">first link</a> and another <a href="https://docs.example.org/guide/${i}">second link</a> plus a third <a href="https://github.com/org/repo/issues/${i}">third</a> in running prose that wraps over several lines so the typesetter has real work to do here.</p>`).join('');

/** In-page: a marker element as the app's invisible-character pass writes it. */
const markerSource = `(label) => {
  const mark = document.createElement('code');
  mark.className = 'marxy-invisible';
  const glyph = document.createElement('code');
  glyph.className = 'marxy-invisible-glyph';
  glyph.textContent = label;
  const byte = document.createElement('code');
  byte.className = 'marxy-invisible-byte';
  byte.textContent = '\\u00a0';
  mark.append(glyph, byte);
  return mark;
}`;

// The contract is how many paragraphs the change watcher sets again in the task, not how long it
// takes: times are printed only (a timing bound is a flake on a shared runner). Unbounded, the first
// case set all 400 again (≈ 390 ms) and the second all 300 (≈ 250 ms); bounded, 0 (~5 ms) and the
// ten or so near the viewport (~75 ms).

/** In-page: tags every line break now in the article, so a re-set paragraph shows new, untagged ones. */
const tagBreaksSource = `(doc) => { for (const lb of doc.querySelectorAll('.marxy-lb')) lb.__before = true; }`;
/** In-page: paragraphs set again (new breaks) or reverted (no longer set) since the tags went on. */
const resetSinceSource = `(doc) => {
  const ps = [...doc.querySelectorAll('[data-marxy-s]')];
  return {
    reset: ps.filter((p) => [...p.querySelectorAll('.marxy-lb')].some((lb) => !lb.__before)).length,
    reverted: ps.filter((p) => !p.classList.contains('marxy-set') && p.querySelector('.marxy-lb') === null && p.__wasSet).length,
  };
}`;

test('hidden labels written into many set paragraphs cost reads only and leave every line as it was (B-02.3)', async () => {
  const page = await harness.open(linkParagraphs(400), { width: 640 });
  await attach(page);
  const r = await page.evaluate(async ({ tagBreaksSource, resetSinceSource }) => {
    const doc = document.getElementById('doc');
    const before = doc.innerHTML;
    const set = window.controller.stats.typeset;
    for (const p of doc.querySelectorAll('.marxy-set')) p.__wasSet = true;
    (0, eval)(tagBreaksSource)(doc);
    // As the app's link-destination pass writes them: `display: none` until hover (base.css).
    for (const a of doc.querySelectorAll('a[href]')) {
      const el = document.createElement('code');
      el.className = 'marxy-link-dest';
      el.textContent = new URL(a.href).host;
      a.append(el);
    }
    const t0 = performance.now();
    await Promise.resolve();
    const ms = performance.now() - t0;
    const inTask = (0, eval)(resetSinceSource)(doc);
    for (const el of doc.querySelectorAll('.marxy-link-dest')) el.remove();
    return { ms, inTask, same: doc.innerHTML === before, set, after: window.controller.stats.typeset };
  }, { tagBreaksSource, resetSinceSource });
  console.log(`# hidden labels: ${r.ms.toFixed(1)} ms, ${JSON.stringify(r.inTask)}`);
  assert.ok(r.set > 300, `the paragraphs were set: ${r.set}`);
  assert.deepEqual(r.inTask, { reset: 0, reverted: 0 }, 'no paragraph is set again or reverted for 1200 hidden labels');
  assert.equal(r.same, true, 'every break is where it was');
  assert.equal(r.after, r.set);
  await page.close();
});

test('markers written into many set paragraphs re-set only those near the viewport in the task; the rest wait for idle (B-02.3)', async () => {
  const page = await harness.open(linkParagraphs(300), { width: 320 });
  const r = await page.evaluate(async ({ markerSource, tagBreaksSource, resetSinceSource }) => {
    const marker = (0, eval)(markerSource);
    const doc = document.getElementById('doc');
    // A scheduler the test drains by hand, so the idle chunks are seen to be separate from the change.
    const pending = [];
    const scheduler = { schedule: (work) => pending.push(work) };
    const drain = () => { while (pending.length) pending.shift()(() => Number.POSITIVE_INFINITY); };
    window.controller = window.typeset.attach(doc, { lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler });
    await window.controller.ready;
    drain();
    await window.controller.done;
    const set = doc.querySelectorAll('.marxy-set').length;
    // A wide marker in the middle of every paragraph's fullest line.
    for (const p of doc.querySelectorAll('p.marxy-set')) {
      const lbs = [...p.querySelectorAll('.marxy-lb')];
      const fullest = lbs.reduce((a, b) => (b.getBoundingClientRect().left > a.getBoundingClientRect().left ? b : a));
      fullest.before(marker('U+00A0 NBSP'));
    }
    for (const p of doc.querySelectorAll('.marxy-set')) p.__wasSet = true;
    (0, eval)(tagBreaksSource)(doc);
    const t0 = performance.now();
    await Promise.resolve();
    const ms = performance.now() - t0;
    const overfull = () => [...doc.querySelectorAll('p')].filter((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const right = p.getBoundingClientRect().right;
      return [...range.getClientRects()].some((x) => x.width > 0 && x.right > right + 0.5);
    }).length;
    const inTask = { ...(0, eval)(resetSinceSource)(doc), set: doc.querySelectorAll('.marxy-set').length, overfull: overfull(), queued: pending.length };
    drain();
    await window.controller.done;
    return { ms, set, inTask, after: { set: doc.querySelectorAll('.marxy-set').length, overfull: overfull() } };
  }, { markerSource, tagBreaksSource, resetSinceSource });
  console.log(`# markers: ${JSON.stringify(r)}`);
  assert.ok(r.set > 250, `the paragraphs were set: ${r.set}`);
  // Three screens of 320 px paragraphs is about ten; a quarter of the document is far more than any viewport.
  assert.ok(r.inTask.reset > 0 && r.inTask.reset < r.set / 4, `only paragraphs near the viewport are set again in the task: ${JSON.stringify(r.inTask)}`);
  assert.equal(r.inTask.reset + r.inTask.reverted, r.set, `every other changed paragraph is reverted to native wrapping: ${JSON.stringify(r.inTask)}`);
  assert.equal(r.inTask.set, r.inTask.reset, 'nothing else is still set in the task');
  assert.equal(r.inTask.overfull, 0, 'nothing is overfull meanwhile: the rest wrap natively');
  assert.ok(r.inTask.queued > 0, 'the rest are queued to the idle chunks');
  assert.equal(r.after.overfull, 0);
  assert.ok(r.after.set > 250, `idle sets them again: ${JSON.stringify(r.after)}`);
  await page.close();
});

/**
 * Moves every top-level node of the article from index `k` on into an inert holder, then puts the
 * head on the grid; `window.__appendTail()` appends the tail back and returns its first element.
 */
const splitAt = (page, k) =>
  page.evaluate((k) => {
    const doc = document.getElementById('doc');
    const holder = document.implementation.createHTMLDocument('').body;
    const tail = [...doc.childNodes].slice([...doc.childNodes].indexOf(doc.children[k]));
    for (const n of tail) holder.appendChild(n);
    window.typeset.snapToGrid(doc, window.lineBox);
    window.__appendTail = () => {
      const first = holder.firstElementChild;
      while (holder.firstChild) doc.appendChild(holder.firstChild);
      return first;
    };
  }, k);

/** Every element's inline padding, top and bottom, in document order. */
const paddings = (page) =>
  page.evaluate(() =>
    [document.getElementById('doc'), ...document.querySelectorAll('#doc *')].map((el) => [
      parseFloat(el.style.paddingTop) || 0,
      parseFloat(el.style.paddingBottom) || 0,
    ]),
  );

test('a grid pass `from` the first appended block pads exactly what a whole pass pads (A-02)', async () => {
  const html = renderCorpus('01-long-technical.md');
  const page = await harness.open(html);
  // Split points: after a code block (an island predecessor), after a table, and after a paragraph.
  // Split points: before and after a code block and a table (islands as `from` and as its
  // predecessor), and after a paragraph.
  const points = await page.evaluate(() => {
    const kids = [...document.getElementById('doc').children];
    const at = (tag) => kids.findIndex((el, i) => i > 3 && el.tagName === tag && kids[i + 1]);
    return [at('PRE'), at('PRE') + 1, at('TABLE'), at('TABLE') + 1, at('P') + 1].filter((k) => k > 3);
  });
  assert.ok(points.length >= 3, `split points ${points}`);
  await page.close();
  // And a block no rule pads, 13 px tall, as the last before the append: only a push of the
  // predecessor by `from` puts what follows back on the grid.
  const para = '<p data-marxy-s="0" data-marxy-e="1">A paragraph of a few words.</p>';
  const odd = `${para}${para}<div style="height: 13px"></div>${para}${para}`;
  const cases = [...points.map((k) => ({ html, k })), { html: odd, k: 3 }];
  for (const { html, k } of cases) {
    const p = await harness.open(html);
    await splitAt(p, k);
    await p.evaluate(() => window.typeset.snapToGrid(document.getElementById('doc'), window.lineBox, { from: window.__appendTail() }));
    const partial = await paddings(p);
    await p.evaluate(() => window.typeset.snapToGrid(document.getElementById('doc'), window.lineBox));
    const whole = await paddings(p);
    assert.equal(partial.length, whole.length);
    const differ = partial.flatMap(([t, b], i) => (Math.abs(t - whole[i][0]) > 0.5 || Math.abs(b - whole[i][1]) > 0.5 ? [`#${i}: ${t}/${b} vs ${whole[i]}`] : []));
    assert.deepEqual(differ, [], `split at child ${k}`);
    await p.close();
  }
});

test('adopt queues appended paragraphs, and `done` is a new promise that resolves once they are set (A-02)', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'));
  await splitAt(page, 20);
  const r = await page.evaluate(async () => {
    const doc = document.getElementById('doc');
    const queued = [];
    const scheduler = { schedule: (work) => queued.push(work) };
    const flush = () => { while (queued.length) queued.shift()(() => Number.POSITIVE_INFINITY); };
    const controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler,
    });
    flush();
    const first = controller.done;
    await first;
    const before = controller.stats.paragraphs;
    const head = doc.childElementCount;
    window.__appendTail();
    const tail = [...doc.children].slice(head);
    controller.adopt(tail);
    const second = controller.done;
    let settled = false;
    void second.then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 0));
    const pendingBeforeFlush = !settled;
    const setBeforeFlush = tail.filter((el) => el.classList.contains('marxy-set')).length;
    flush();
    await second;
    return {
      fresh: second !== first,
      pendingBeforeFlush,
      setBeforeFlush,
      setAfter: tail.filter((el) => el.classList.contains('marxy-set')).length,
      considered: controller.stats.paragraphs,
      // A fresh pass over the whole article considers the same paragraphs, no more.
      whole: await (async () => {
        controller.relayout('reload');
        flush();
        await controller.done;
        return controller.stats.paragraphs;
      })(),
      before,
    };
  });
  assert.ok(r.fresh, 'done is a new promise once work arrives after it resolved');
  assert.ok(r.pendingBeforeFlush, 'the new done waits for the adopted paragraphs');
  assert.equal(r.setBeforeFlush, 0);
  assert.ok(r.setAfter > 10, `adopted paragraphs set: ${r.setAfter}`);
  assert.ok(r.considered > r.before, `adopted paragraphs considered: ${r.before} → ${r.considered}`);
  assert.equal(r.considered, r.whole, 'every adopted paragraph was considered before done resolved');
  await page.close();
});

/** Splits after child `k`, puts the head on the grid, and appends the tail in chunks of `size` children. */
const chunked = (page, k, size) =>
  page.evaluate(({ k, size }) => {
    const doc = document.getElementById('doc');
    const holder = document.implementation.createHTMLDocument('').body;
    const nodes = [...doc.childNodes];
    for (const n of nodes.slice(nodes.indexOf(doc.children[k]))) holder.appendChild(n);
    window.typeset.snapToGrid(doc, window.lineBox);
    window.__nextChunk = () => {
      let first = null;
      for (let i = 0; i < size && holder.firstElementChild; i++) {
        const el = holder.firstElementChild;
        while (holder.firstChild !== el) doc.appendChild(holder.firstChild);
        doc.appendChild(el);
        first ??= el;
      }
      return first;
    };
  }, { k, size });

test('a chunk pass does not restart from a padded `pre` above it: the theme padding is not taken for drift (A-02)', async () => {
  const para = (i) => `<p data-marxy-s="${i}" data-marxy-e="${i + 1}">Paragraph ${i}, a line of plain words.</p>`;
  const html = [para(0), para(1), '<pre data-marxy-s="2" data-marxy-e="3"><code>one\ntwo</code></pre>', ...Array.from({ length: 12 }, (_, i) => para(i + 3))].join('');
  // A theme padding and a code line that is not a whole unit, so the pass must add padding of its own.
  const page = await harness.open(html, { extraCss: '#doc pre { padding: 12px; line-height: 17px; }' });
  await chunked(page, 5, 4);
  const r = await page.evaluate(() => {
    const doc = document.getElementById('doc');
    const pre = doc.querySelector('pre');
    const read = Element.prototype.getBoundingClientRect;
    const passes = [];
    for (let i = 0; i < 2; i++) {
      const from = window.__nextChunk();
      let reads = 0;
      Element.prototype.getBoundingClientRect = function () {
        if (this === pre) reads++;
        return read.call(this);
      };
      try {
        window.typeset.snapToGrid(doc, window.lineBox, { from });
      } finally {
        Element.prototype.getBoundingClientRect = read;
      }
      passes.push(reads);
    }
    return { passes, inline: pre.style.paddingBottom, theme: getComputedStyle(doc.querySelector('p')).paddingBottom, preTheme: parseFloat(getComputedStyle(pre).paddingTop) };
  });
  assert.ok(r.inline !== '' && r.preTheme > 0, `the pre is padded by the pass and by the theme: ${JSON.stringify(r)}`);
  // One read each: the drift check. A pass that restarted from the pre would read it again in step 1 and every round.
  assert.deepEqual(r.passes, [1, 1]);
  await page.close();
});

test('a chunk pass lays out at most six times: the drift check, the islands and four rounds (A-02)', async () => {
  // Every kind of work a chunk pass does: islands above it to check, islands in it to pad, and blocks
  // no rule pads (13 px) that only a push puts back on the grid.
  const para = (i) => `<p data-marxy-s="${i}" data-marxy-e="${i + 1}">Paragraph ${i}, a line of plain words.</p>`;
  const pre = (i) => `<pre data-marxy-s="${i}" data-marxy-e="${i + 1}"><code>one\ntwo</code></pre>`;
  const odd = '<div style="height: 13px"></div>';
  const html = Array.from({ length: 12 }, (_, i) => [para(i * 3), pre(i * 3 + 1), odd].join('')).join('');
  const page = await harness.open(html, { extraCss: '#doc pre { padding: 12px; line-height: 17px; }' });
  await chunked(page, 18, 1000);
  const r = await page.evaluate(() => {
    const doc = document.getElementById('doc');
    const from = window.__nextChunk();
    const read = Element.prototype.getBoundingClientRect;
    const write = CSSStyleDeclaration.prototype.setProperty;
    const remove = CSSStyleDeclaration.prototype.removeProperty;
    // A read is a layout when it is the pass's first or follows a write.
    let dirty = true;
    let layouts = 0;
    let writes = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (dirty) layouts++;
      dirty = false;
      return read.call(this);
    };
    CSSStyleDeclaration.prototype.setProperty = function (...a) { dirty = true; writes++; return write.apply(this, a); };
    CSSStyleDeclaration.prototype.removeProperty = function (...a) { dirty = true; writes++; return remove.apply(this, a); };
    try {
      window.typeset.snapToGrid(doc, window.lineBox, { from });
    } finally {
      Element.prototype.getBoundingClientRect = read;
      CSSStyleDeclaration.prototype.setProperty = write;
      CSSStyleDeclaration.prototype.removeProperty = remove;
    }
    return { layouts, writes };
  });
  assert.ok(r.writes > 10, `the pass had work to do: ${JSON.stringify(r)}`);
  assert.ok(r.layouts >= 4 && r.layouts <= 6, `${r.layouts} layouts in one chunk pass`);
  await page.close();
});

test('a chunk pass orders nothing by document position, so it does not pay for the blocks above it (B-25)', async () => {
  // Islands the passes padded and measured above the chunk: before B-25 each was ordered against the
  // chunk with compareDocumentPosition, which WebKit answers by walking the siblings between them.
  const para = (i) => `<p data-marxy-s="${i}" data-marxy-e="${i + 1}">Paragraph ${i}, a line of plain words.</p>`;
  const pre = (i) => `<pre data-marxy-s="${i}" data-marxy-e="${i + 1}"><code>one\ntwo</code></pre>`;
  const html = Array.from({ length: 40 }, (_, i) => para(i * 2) + pre(i * 2 + 1)).join('');
  const page = await harness.open(html, { extraCss: '#doc pre { padding: 12px; line-height: 17px; }' });
  await chunked(page, 20, 10);
  const r = await page.evaluate(() => {
    const doc = document.getElementById('doc');
    const order = Node.prototype.compareDocumentPosition;
    const counts = [];
    for (let i = 0; i < 5; i++) {
      const from = window.__nextChunk();
      let n = 0;
      Node.prototype.compareDocumentPosition = function (other) {
        n++;
        return order.call(this, other);
      };
      try {
        window.typeset.snapToGrid(doc, window.lineBox, { from });
      } finally {
        Node.prototype.compareDocumentPosition = order;
      }
      counts.push(n);
    }
    return { counts, padded: doc.querySelectorAll('pre[style*="padding-bottom"]').length };
  });
  assert.ok(r.padded > 20, `the passes padded the islands above each chunk: ${JSON.stringify(r)}`);
  assert.deepEqual(r.counts, [0, 0, 0, 0, 0]);
  await page.close();
});

test('a background batch that leaves every height as it was asks for no grid pass (B-25)', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'), { height: 400 });
  const r = await page.evaluate(async () => {
    const doc = document.getElementById('doc');
    const paragraphs = [...doc.querySelectorAll('p[data-marxy-s], li[data-marxy-s]')];
    const native = new Map(paragraphs.map((p) => [p, p.getBoundingClientRect().height]));
    const queued = [];
    let background = 0;
    window.controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: true, lastLineMinWidth: 0.33, hanging: 'left',
      scheduler: { schedule: (work) => queued.push(work) },
      onPass: (kind) => { if (kind === 'background') background++; },
    });
    await window.controller.ready;
    const steps = [];
    let set = new Set(paragraphs.filter((p) => p.classList.contains('marxy-set')));
    while (queued.length) {
      const calls = background;
      queued.shift()(() => Number.POSITIVE_INFINITY);
      const now = paragraphs.filter((p) => p.classList.contains('marxy-set') && !set.has(p));
      set = new Set([...set, ...now]);
      const moved = now.some((p) => Math.abs(p.getBoundingClientRect().height - native.get(p)) >= 0.5);
      steps.push({ set: now.length, moved, called: background > calls });
    }
    return steps;
  });
  const setting = r.filter((s) => s.set > 0);
  assert.ok(setting.length > 5, `background batches set paragraphs: ${JSON.stringify(r)}`);
  assert.ok(setting.some((s) => !s.moved), 'some batch left every height as it was');
  assert.ok(setting.some((s) => s.moved), 'some batch moved a height');
  for (const s of setting) assert.equal(s.called, s.moved, `a batch asks for the grid pass exactly when it moved something: ${JSON.stringify(s)}`);
  await page.close();
});

test('while paragraphs are still being adopted, the background batches wait on a scheduler that can wait (B-25)', async () => {
  const page = await harness.open(renderCorpus('15-prose-volume.md'));
  await splitAt(page, 20);
  const r = await page.evaluate(async () => {
    const doc = document.getElementById('doc');
    const queued = [];
    const waits = [];
    const scheduler = { schedule: (work) => queued.push(work), after: (ms, work) => waits.push({ ms, work }) };
    const flush = () => { while (queued.length) queued.shift()(() => Number.POSITIVE_INFINITY); };
    const controller = window.typeset.attach(doc, {
      lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler,
    });
    flush();
    await controller.done;
    const waitedBeforeAdopt = waits.length;
    const head = doc.childElementCount;
    window.__appendTail();
    const tail = [...doc.children].slice(head);
    controller.adopt(tail);
    flush();
    const waited = waits.map(({ ms }) => ms);
    const setWhileAdopting = tail.filter((el) => el.classList.contains('marxy-set')).length;
    await new Promise((r) => setTimeout(r, 80));
    for (const { work } of waits.splice(0)) work(() => Number.POSITIVE_INFINITY);
    flush();
    await controller.done;
    return { waitedBeforeAdopt, waited, setWhileAdopting, setAfter: tail.filter((el) => el.classList.contains('marxy-set')).length, waitsAfter: waits.length };
  });
  assert.equal(r.waitedBeforeAdopt, 0, 'nothing waits before anything is adopted');
  assert.equal(r.waited.length, 1, `the batch after an adoption waits once: ${JSON.stringify(r)}`);
  assert.ok(r.waited[0] > 0 && r.waited[0] <= 50, `for what is left of the quiet time: ${r.waited[0]}`);
  assert.equal(r.setWhileAdopting, 0);
  assert.equal(r.waitsAfter, 0, 'once adoption is quiet the batches run');
  assert.ok(r.setAfter > 10, `the adopted paragraphs are set once it is quiet: ${r.setAfter}`);
  await page.close();
});

test('setting a whole document makes one Range, not one per paragraph or line (B-25)', async () => {
  // WebKit visits every Range a script made, until the collector frees it, on every DOM mutation.
  const page = await harness.open(renderCorpus('15-prose-volume.md'));
  const r = await page.evaluate(async () => {
    let made = 0;
    const create = Document.prototype.createRange;
    Document.prototype.createRange = function () {
      made++;
      return create.call(this);
    };
    const Native = window.Range;
    window.Range = new Proxy(Native, { construct(target, args) { made++; return Reflect.construct(target, args); } });
    try {
      const controller = window.typeset.attach(document.getElementById('doc'), {
        lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: true, lastLineMinWidth: 0.33, hanging: 'left', scheduler: window.immediateScheduler(),
      });
      await controller.done;
      return { made, set: controller.stats.typeset };
    } finally {
      Document.prototype.createRange = create;
      window.Range = Native;
    }
  });
  assert.ok(r.set > 50, `the prose is set: ${JSON.stringify(r)}`);
  assert.ok(r.made <= 1, `${r.made} Ranges made`);
  await page.close();
});
