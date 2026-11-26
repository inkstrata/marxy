// The Studio's Compare, specimen and Fit in WebKit. The specimen is one long proof, not a grid.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PARA = (n) => `Paragraph ${n} of the plan runs long enough to wrap more than once in a column of the measure a look sets, so that Fit has a passage of the reader's own to set and the canvas has something to scroll through.`;
const PLAN = ['# Plan', '', ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((n) => [PARA(n), '']), '## After', '', PARA(11), ''].join('\n');
const FILES = { '/r/plans/plan.md': PLAN, '/look.toml': 'on = true\nlook = "paper"\nmode = "day"\n' };

const openStudio = (page, arg) => page.evaluate(async (a) => (await import('/src/studio/studio.ts')).openStudioSurface(a), arg);
const stateJson = (page) => page.evaluate(async () => JSON.stringify((await import('/src/look/store.ts')).lookState()));
const setSize = (page, size) =>
  page.evaluate(async (size) => {
    const s = await import('/src/look/store.ts');
    const st = s.lookState();
    s.setLookState({ ...st, tweaks: { ...st.tweaks, paper: { ...(st.tweaks.paper ?? {}), size } } });
  }, size);
const clickTop = (page, text) => page.evaluate((t) => [...document.querySelectorAll('.marxy-studio-top button')].find((b) => b.textContent === t).click(), text);

test('7: Compare shows before and now either side of a seam that moves when dragged; before is the look as opened', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page) => {
    await openStudio(page, 'tone');
    await page.waitForSelector('.marxy-studio-now .marxy-article p');
    await setSize(page, 28);
    await clickTop(page, 'Compare');
    await page.waitForSelector('.marxy-studio-compare-before .marxy-article p');
    await page.waitForFunction(() => {
      const b = document.querySelector('.marxy-studio-compare-before');
      const n = document.querySelector('.marxy-studio-now');
      const nb = n.style.getPropertyValue('--marxy-size-body');
      return b.style.getPropertyValue('--marxy-size-body') && nb && nb !== b.style.getPropertyValue('--marxy-size-body');
    });
    const a = await page.evaluate(() => {
      const b = document.querySelector('.marxy-studio-compare-before');
      const n = document.querySelector('.marxy-studio-now');
      return {
        before: parseFloat(b.style.getPropertyValue('--marxy-size-body')),
        now: parseFloat(n.style.getPropertyValue('--marxy-size-body')),
        look: b.getAttribute('data-marxy-look'),
        labels: [...document.querySelectorAll('.marxy-studio-compare-label')].map((l) => l.textContent),
        clip: b.style.clipPath,
        seam: document.querySelector('.marxy-studio-compare-seam').getBoundingClientRect().left,
        sameParent: b.parentElement === n.parentElement,
      };
    });
    assert.equal(a.look, 'paper');
    assert.ok(a.now > a.before, `now carries the change made after opening (${a.now} against ${a.before})`);
    assert.ok(a.before < 24, 'before is the size the look had when the Studio opened');
    assert.deepEqual(a.labels, ['Before', 'Now']);
    assert.ok(a.sameParent, 'the two leaves are stacked on one paper');
    assert.match(a.clip, /inset\(0(px)? 50%/);

    const r = await page.evaluate(() => {
      const s = document.querySelector('.marxy-studio-compare-seam').getBoundingClientRect();
      const p = document.querySelector('.marxy-studio-paper').getBoundingClientRect();
      return { x: s.left + s.width / 2, y: s.top + s.height / 2, left: p.left, width: p.width };
    });
    await page.mouse.move(r.x, r.y);
    await page.mouse.down();
    await page.mouse.move(r.left + r.width * 0.25, r.y, { steps: 6 });
    await page.mouse.up();
    const moved = await page.evaluate(() => ({
      seam: document.querySelector('.marxy-studio-compare-seam').getBoundingClientRect().left,
      clip: document.querySelector('.marxy-studio-compare-before').style.clipPath,
    }));
    assert.ok(moved.seam < a.seam - r.width * 0.15, `the seam moved left (${a.seam} to ${moved.seam})`);
    assert.notEqual(moved.clip, a.clip, 'the before side is clipped at the seam');

    await page.evaluate(() => {
      document.querySelector('.marxy-studio-now .marxy-studio-scroll').scrollTop = 900;
    });
    await page.waitForFunction(() => document.querySelector('.marxy-studio-compare-before .marxy-studio-scroll').scrollTop > 100);
    const aligned = await page.evaluate(() => {
      const mid = (sel) => {
        const sc = document.querySelector(`${sel} .marxy-studio-scroll`);
        const y = sc.scrollTop + sc.clientHeight / 2;
        return [...sc.querySelector('.marxy-article').children].findIndex((b) => b.offsetTop + b.offsetHeight > y);
      };
      return { now: mid('.marxy-studio-now'), before: mid('.marxy-studio-compare-before') };
    });
    assert.equal(aligned.before, aligned.now, 'both sides show the same block in the middle');

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-studio-compare-before') && document.querySelector('.marxy-studio'));
  });
});

test('the specimen is one proof, every kind after the last at the canvas width, languages last, all coloured and following a dial', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page) => {
    await openStudio(page, 'sheet');
    await page.waitForSelector('.marxy-studio-galley-langh');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-studio-galley-langh').length === 8);
    // Every block coloured: a page filled before it was in the document lost its colour to the highlighter's drop.
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-studio-galley pre > code')].every((c) => c.dataset.marxyDone === 'highlight'));
    const s = await page.evaluate(() => {
      const secs = [...document.querySelectorAll('.marxy-studio-galley-sec')];
      const last = secs.at(-1);
      const boxes = secs.map((x) => x.querySelector('.marxy-studio-galley-page').getBoundingClientRect());
      return {
        names: secs.map((x) => x.querySelector('.marxy-studio-galley-name').textContent),
        heads: [...last.querySelectorAll('.marxy-studio-galley-langh')].map((h) => h.textContent),
        ks: [...last.querySelectorAll('[data-marxy-lang]')].map((d) => {
          const k = d.querySelector('.marxy-tok-keyword');
          return k ? getComputedStyle(k).color : null;
        }),
        lefts: boxes.map((b) => Math.round(b.left)),
        stacked: boxes.every((b, i) => i === 0 || b.top >= boxes[i - 1].bottom),
        width: Math.round(boxes[1].width),
        scrolls: document.querySelector('.marxy-studio-galley').scrollHeight > document.querySelector('.marxy-studio-galley').clientHeight,
      };
    });
    assert.deepEqual(s.names, ['Prose', 'Code', 'Data', 'Table', 'Log', 'Patch', 'Talk', 'Languages']);
    assert.deepEqual(s.heads, ['Rust', 'Python', 'Go', 'TypeScript', 'JavaScript', 'SQL', 'Shell', 'CSS'], 'its eight languages, in order');
    const ks = s.ks.filter(Boolean);
    assert.ok(ks.length >= 7, `a keyword in at least seven of them: ${JSON.stringify(s.ks)}`);
    assert.equal(new Set(ks).size, ks.length, `each in its own keyword colour: ${JSON.stringify(s.ks)}`);
    assert.equal(new Set(s.lefts).size, 1, `one column, not a grid: ${s.lefts}`);
    assert.ok(s.stacked, 'each page below the last');
    assert.ok(s.width >= 500, `a page at a readable width: ${s.width}`);
    assert.ok(s.scrolls, 'the proof is read by scrolling');

    const sizes = () => page.evaluate(() => [...document.querySelectorAll('.marxy-studio-galley-sec .marxy-studio-leaf')].map((l) => parseFloat(l.style.getPropertyValue('--marxy-size-body'))));
    const was = await sizes();
    assert.equal(was.length, 8);
    await setSize(page, 28);
    await page.waitForFunction((was) => [...document.querySelectorAll('.marxy-studio-galley-sec .marxy-studio-leaf')].every((l, i) => parseFloat(l.style.getPropertyValue('--marxy-size-body')) > was[i]), was);
    const now = await sizes();
    assert.ok(now.every((v, i) => v > was[i]), `every page follows the dial: ${was} to ${now}`);

    // The proof's own index is a place in the proof: scrolled to, the proof kept.
    await page.evaluate(() => [...document.querySelectorAll('.marxy-studio-galley-to')].find((b) => b.textContent === 'Table').click());
    await page.waitForFunction(() => {
      const g = document.querySelector('.marxy-studio-galley');
      const t = document.querySelector('.marxy-studio-galley-sec[data-marxy-kind="table"]');
      return Math.abs(t.getBoundingClientRect().top - g.getBoundingClientRect().top) < 60;
    });
    assert.ok(await page.evaluate(() => document.querySelector('.marxy-studio-galley-sec[data-marxy-kind="table"]').hasAttribute('data-marxy-on')));

    await page.evaluate(() => document.querySelector('.marxy-studio-galley-sec[data-marxy-kind="table"] .marxy-studio-link').click());
    await page.waitForSelector('.marxy-studio-now .marxy-article table');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-studio-galley')), null, 'the proof is gone');
  });
});

test('6: at 1180 x 720 the specimen keeps each page at the canvas width and scrolls', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'], viewport: { width: 1180, height: 720 } }, async (page) => {
    await openStudio(page, 'sheet');
    await page.waitForSelector('.marxy-studio-galley-sec');
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => {
      const g = document.querySelector('.marxy-studio-galley');
      return { scrolls: g.scrollHeight > g.clientHeight, page: document.querySelector('.marxy-studio-galley-page').getBoundingClientRect() };
    });
    assert.ok(s.scrolls, 'the proof scrolls');
    assert.ok(s.page.width >= 400 && s.page.height >= 190, `a page keeps a readable size: ${JSON.stringify(s.page)}`);
  });
});

const fitStep = (page) => page.evaluate(() => document.querySelector('.marxy-studio-fit-step')?.textContent ?? null);
const fitDone = (page) => page.evaluate(() => !document.querySelector('.marxy-studio-fit-summary').hidden);

test('8: Fit runs from the first round to the summary by keys alone, changes nothing until kept, and keeps a look when asked', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page) => {
    await openStudio(page, 'tone');
    await page.waitForSelector('.marxy-studio-now .marxy-article p');
    const before = await stateJson(page);
    await openStudio(page, 'fit');
    await page.waitForSelector('.marxy-studio-fit .marxy-studio-fit-side .marxy-article p');
    assert.ok(await page.evaluate(() => document.querySelector('.marxy-studio').hasAttribute('data-marxy-fit')), 'the rest of the Studio stands back');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-studio-fit-q').textContent), 'Which size is easier to read?');
    assert.equal(await fitStep(page), 'Comparison 1 of 3');
    const sides = await page.evaluate(() => [...document.querySelectorAll('.marxy-studio-fit-side .marxy-studio-leaf')].map((l) => l.style.getPropertyValue('--marxy-size-body')));
    assert.notEqual(sides[0], sides[1], 'the two sides differ in size');
    assert.ok(await page.evaluate(() => document.querySelectorAll('.marxy-studio-fit-side')[0].querySelectorAll('.marxy-article > p').length <= 4), 'a passage of a few paragraphs');

    await page.keyboard.press('1');
    assert.equal(await fitStep(page), 'Comparison 2 of 3');
    await page.keyboard.press('Backspace');
    assert.equal(await fitStep(page), 'Comparison 1 of 3', 'Backspace steps back');

    const qs = new Set();
    let presses = 0;
    while (!(await fitDone(page)) && presses < 40) {
      qs.add(await page.evaluate(() => document.querySelector('.marxy-studio-fit-q').textContent));
      await page.keyboard.press(presses % 2 ? '2' : '1');
      presses++;
      if (presses === 10) assert.equal(await stateJson(page), before, 'nothing changes during the test');
    }
    assert.ok(await fitDone(page), 'the summary is reached by keys alone');
    assert.equal(presses, 21, 'three comparisons in each of six rounds, and a knockout of four faces');
    assert.equal(qs.size, 7, 'seven rounds');
    assert.equal(await stateJson(page), before, 'nothing has changed at the summary');
    const sum = await page.evaluate(() => ({
      text: document.querySelector('.marxy-studio-fit-summary').textContent,
      rows: [...document.querySelectorAll('.marxy-studio-fit-values dt')].map((d) => d.textContent),
    }));
    assert.deepEqual(sum.rows, ['Size', 'Leading', 'Measure', 'Weight', 'Contrast', 'Page', 'Face']);
    assert.match(sum.text, /Comfort and reading speed are related but not the same thing/);

    await page.fill('.marxy-studio-fit-input', 'Easy');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.marxy-studio-fit'));
    const kept = JSON.parse(await stateJson(page));
    const mine = kept.mine.find((m) => m.name === 'Easy');
    assert.ok(mine, 'a look of the reader\'s own');
    assert.equal(kept.id, mine.id, 'and it is in use');
    assert.equal(JSON.stringify(kept.tweaks.paper ?? {}), JSON.stringify(JSON.parse(before).tweaks.paper ?? {}), 'the look tested keeps its own changes');
    await page.waitForFunction((id) => document.querySelector('.marxy-studio-now')?.getAttribute('data-marxy-look') === id, mine.id);
    assert.ok(!(await page.evaluate(() => document.querySelector('.marxy-studio').hasAttribute('data-marxy-fit'))));
  });
});

test('8: Esc in the middle of Fit leaves everything as it was', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page) => {
    await openStudio(page, 'tone');
    await page.waitForSelector('.marxy-studio-now .marxy-article p');
    const before = await stateJson(page);
    await openStudio(page, 'fit');
    await page.waitForSelector('.marxy-studio-fit');
    for (const k of ['1', '2', 'Space', '1', '2']) await page.keyboard.press(k);
    assert.notEqual(await page.evaluate(() => document.querySelector('.marxy-studio-fit-q').textContent), 'Which size is easier to read?', 'Space ended the first round');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-studio-fit'));
    assert.ok(await page.evaluate(() => document.querySelector('.marxy-studio-now') && !document.querySelector('.marxy-studio').hasAttribute('data-marxy-fit')), 'the canvas is back and the Studio still open');
    assert.equal(await stateJson(page), before);
  });
});

const ESSAY = ['# On margins', '', PARA(1), '', PARA(2), ''].join('\n');
const dialTo = (page, label, v) =>
  page.evaluate(
    ({ label, v }) => {
      const i = document.querySelector(`.marxy-studio-dockbody input[aria-label="${label}"]`);
      i.value = String(v);
      i.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { label, v },
  );

test('Save as a new theme keeps the look the canvas shows: a file in reading/ is in Book by the sample rule, and its change goes with it', async () => {
  await withFrame({ files: { ...FILES, '/r/reading/on-margins.md': ESSAY }, open: ['/r/reading/on-margins.md'] }, async (page) => {
    await openStudio(page, 'type');
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now')?.getAttribute('data-marxy-look') === 'book');
    await dialTo(page, 'Size', 25);
    await page.waitForFunction(async () => (await import('/src/look/store.ts')).lookState().tweaks.book?.size === 25);
    await page.evaluate(() => [...document.querySelectorAll('.marxy-studio-shelf-foot button')].find((b) => b.textContent === 'Save as a new theme…').click());
    await page.fill('.marxy-studio-shelf-foot input', 'My book');
    await page.keyboard.press('Enter');
    await page.waitForFunction(async () => (await import('/src/look/store.ts')).lookState().mine.length === 1);
    const s = JSON.parse(await stateJson(page));
    assert.equal(s.mine[0].face, 'palatino', 'Book, the look shown, not Paper, the look in use');
    assert.equal(s.mine[0].size, 25, 'with the change made to it');
    assert.equal(s.tweaks.book, undefined);
  });
});

test('with the theme painting the page (Ink, dark), the Studio starts dark, the first dial keeps the window dark, and Compare\'s before is Ink', async () => {
  await withFrame({ files: { '/r/plans/plan.md': PLAN }, open: ['/r/plans/plan.md'] }, async (page) => {
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-marxy-variant')), 'dark');
    const ink = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-bg').trim());
    await openStudio(page, 'type');
    await page.waitForSelector('.marxy-studio-now .marxy-article p');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-studio-now').getAttribute('data-marxy-scheme')), 'night');
    await dialTo(page, 'Size', 24);
    await page.waitForFunction(async () => (await import('/src/look/store.ts')).looksOn());
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-marxy-look'));
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-marxy-variant')), 'dark', 'the window stays dark');
    await clickTop(page, 'Compare');
    await page.waitForSelector('.marxy-studio-compare-before .marxy-article p');
    const before = await page.evaluate(() => getComputedStyle(document.querySelector('.marxy-studio-compare-before')).getPropertyValue('--marxy-color-bg').trim());
    assert.equal(before, ink, 'before is the theme as it was on screen');
  });
});

test('with the theme painting the page, Compare\'s before is the theme: Book\'s justification and indent on the dialog do not reach it', async () => {
  await withFrame({ files: { '/r/reading/on-margins.md': ESSAY }, open: ['/r/reading/on-margins.md'] }, async (page) => {
    await openStudio(page, 'type');
    // The canvas shows the page as it is, the theme's own look, and says the rule that will pick Book once a look paints it.
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now')?.getAttribute('data-marxy-look') === 'ink');
    assert.ok(await page.evaluate(() => /^Once a look paints the page, this file takes Book/.test(document.querySelector('.marxy-studio-why-then')?.textContent ?? '')));
    await dialTo(page, 'Size', 24);
    await page.waitForFunction(async () => (await import('/src/look/store.ts')).looksOn());
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now')?.getAttribute('data-marxy-look') === 'book');
    await clickTop(page, 'Compare');
    await page.waitForSelector('.marxy-studio-compare-before .marxy-article p + p');
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => {
      const ps = (sel) => [...document.querySelectorAll(`${sel} .marxy-article > p`)];
      const [b1, b2] = ps('.marxy-studio-compare-before');
      const [n1] = ps('.marxy-studio-now');
      return { before: getComputedStyle(b1).textAlign, beforeGap: parseFloat(getComputedStyle(b2).marginTop), now: getComputedStyle(n1).textAlign };
    });
    assert.equal(s.now, 'justify', 'now is Book, justified');
    assert.notEqual(s.before, 'justify', 'before is the theme, ragged');
    assert.ok(s.beforeGap >= 0, `before keeps the theme's space between paragraphs (${s.beforeGap})`);
  });
});

test('Fit\'s Page round keeps the look\'s own hue: Console with no difference chosen stays green', async () => {
  await withFrame({ files: { ...FILES, '/look.toml': 'on = true\nlook = "console"\nmode = "day"\n' }, open: ['/r/plans/plan.md'] }, async (page) => {
    await openStudio(page, 'tone');
    await page.waitForSelector('.marxy-studio-now .marxy-article p');
    await openStudio(page, 'fit');
    await page.waitForSelector('.marxy-studio-fit .marxy-studio-fit-side .marxy-article p');
    for (let i = 0; i < 7 && !(await fitDone(page)); i++) await page.keyboard.press('Space');
    assert.ok(await fitDone(page));
    await page.fill('.marxy-studio-fit-input', 'Green');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.marxy-studio-fit'));
    const mine = JSON.parse(await stateJson(page)).mine.find((m) => m.name === 'Green');
    assert.ok(Math.abs(mine.day.h - 155) <= 1, `the page keeps Console's green (hue ${mine.day.h})`);
  });
});

test('during Fit the rest of the Studio is out of reach of the keyboard too, and a stage built again under it ends it', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page) => {
    await openStudio(page, 'tone');
    await page.waitForSelector('.marxy-studio-now .marxy-article p');
    await openStudio(page, 'fit');
    await page.waitForSelector('.marxy-studio-fit');
    const inert = () => page.evaluate(() => ['.marxy-studio-top', '.marxy-studio-shelf', '.marxy-studio-why', '.marxy-studio-dock'].map((s) => document.querySelector(s).inert));
    assert.deepEqual(await inert(), [true, true, true, true]);
    await openStudio(page, 'sheet');
    await page.waitForSelector('.marxy-studio-galley-sec');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-studio-fit')), null);
    assert.ok(!(await page.evaluate(() => document.querySelector('.marxy-studio').hasAttribute('data-marxy-fit'))), 'Fit has let go of the keys');
    assert.deepEqual(await inert(), [false, false, false, false]);
  });
});

test('the top bar fits the window: Fit and Done are on screen at 960 px and at the narrowest window, and no part lies over another', async () => {
  for (const viewport of [{ width: 960, height: 760 }, { width: 564, height: 480 }]) {
    await withFrame({ files: FILES, open: ['/r/plans/plan.md'], viewport }, async (page) => {
      await openStudio(page, 'tone');
      await page.waitForSelector('.marxy-studio-now .marxy-article p');
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const box = (e) => {
          const b = e.getBoundingClientRect();
          return { l: b.left, r: b.right, t: b.top, b: b.bottom };
        };
        const top = document.querySelector('.marxy-studio-top');
        const buttons = Object.fromEntries(
          [...top.querySelectorAll('button')]
            .filter((b) => b.textContent === 'Fit…' || b.textContent === 'Done')
            .map((b) => {
              const x = box(b);
              const hit = document.elementFromPoint((x.l + x.r) / 2, (x.t + x.b) / 2);
              return [b.textContent, { ...x, hit: hit === b || b.contains(hit) }];
            }),
        );
        const parts = [...top.children].filter((c) => c.getBoundingClientRect().width > 0 && !c.classList.contains('marxy-studio-sp')).map(box);
        const columns = ['.marxy-studio-shelf', '.marxy-studio-stagewrap', '.marxy-studio-why'].map((s) => document.querySelector(s)).filter((e) => e && e.getBoundingClientRect().width > 0).map(box);
        const paper = document.querySelector('.marxy-studio-stage .marxy-studio-paper');
        return { w: innerWidth, h: innerHeight, sw: top.scrollWidth, cw: top.clientWidth, buttons, parts, columns, paper: paper && box(paper), stage: box(document.querySelector('.marxy-studio-stage')) };
      });
      const meet = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
      assert.ok(r.sw <= r.cw, `the bar does not overflow at ${r.w}: ${r.sw} > ${r.cw}`);
      for (const name of ['Fit…', 'Done']) {
        const b = r.buttons[name];
        assert.ok(b && b.l >= 0 && b.r <= r.w && b.b <= r.h, `${name} on screen at ${r.w}: ${JSON.stringify(b)}`);
        assert.ok(b.hit, `${name} is the thing a press there hits at ${r.w}`);
      }
      for (let i = 0; i < r.parts.length; i++) for (let j = i + 1; j < r.parts.length; j++) assert.ok(!meet(r.parts[i], r.parts[j]), `top bar parts ${i} and ${j} overlap at ${r.w}`);
      for (let i = 0; i < r.columns.length; i++) for (let j = i + 1; j < r.columns.length; j++) assert.ok(!meet(r.columns[i], r.columns[j]), `columns ${i} and ${j} overlap at ${r.w}`);
      if (r.paper) assert.ok(r.paper.l >= r.stage.l - 0.5 && r.paper.r <= r.stage.r + 0.5, `the canvas stays in the stage at ${r.w}: ${JSON.stringify([r.paper, r.stage])}`);
    });
  }
});
