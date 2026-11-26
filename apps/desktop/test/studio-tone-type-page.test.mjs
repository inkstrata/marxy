// The Studio's Tone, Type and Page tabs in WebKit. Dragging
// the tone puck changes the page and the room, and the puck cannot rest in the dead band; each tab's dials change
// the canvas and the look as the store merges it; and that a double-click returns a dial to the look's own value.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { legible, merged, toneFromPad } from '../../../packages/theme/src/look.ts';
import { FACE_IDS } from '../../../packages/theme/src/looks.ts';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const ESSAY = ['# On margins', '', 'A paragraph of an essay, long enough to wrap at least once in a column of the measure the look sets, and then some more words so it does, 1984 and 3,750.', '', 'And another one after it.', ''].join('\n');
const FILES = { '/r/notes/on-margins.md': ESSAY, '/look.toml': 'on = true\nlook = "paper"\nmode = "day"\n' };

const open = async (page, tab) => {
  await page.evaluate(async (tab) => (await import('/src/studio/studio.ts')).openStudioSurface(tab), tab);
  await page.evaluate(async () => {
    window.__tppStore = await import('/src/look/store.ts');
  });
  await page.waitForSelector('.marxy-studio .marxy-studio-now');
  await page.waitForTimeout(250);
};
/** A token as the canvas is painted with it, and as the room (the dialog) is. */
const canvasTok = (page, k) => page.evaluate((k) => document.querySelector('.marxy-studio-now').style.getPropertyValue(k), k);
const roomTok = (page, k) => page.evaluate((k) => document.querySelector('.marxy-studio').style.getPropertyValue(k), k);
const store = (page) => page.evaluate(async () => (await import('/src/look/store.ts')).lookState());
/** Waits for the store to hold `pred` of Paper's changes (a dial commits a few times a second). */
const committed = (page, src) =>
  page.waitForFunction((src) => {
    const t = window.__tppStore.lookState().tweaks.paper ?? {};
    return new Function('t', `return ${src}`)(t);
  }, src);
const tokChanged = (page, k, from) => page.waitForFunction(({ k, from }) => document.querySelector('.marxy-studio-now').style.getPropertyValue(k) !== from, { k, from });
/** Moves a dial as a hand would: the value, then its input event. */
const dialTo = (page, label, v) =>
  page.evaluate(
    ({ label, v }) => {
      const i = document.querySelector(`.marxy-studio-dockbody input[aria-label="${label}"]`);
      i.value = String(v);
      i.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { label, v },
  );
const dblDial = (page, label) => page.evaluate((label) => document.querySelector(`.marxy-studio-dockbody input[aria-label="${label}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), label);
const at = async (page, sel, x, y) => {
  const b = await page.locator(sel).boundingBox();
  return [b.x + b.width * x, b.y + b.height * y];
};

test('dragging the tone puck repaints the canvas and the room, commits, and cannot rest in the dead band', async () => {
  await withFrame({ files: FILES, open: ['/r/notes/on-margins.md'] }, async (page) => {
    await open(page, 'tone');
    const bg0 = await canvasTok(page, '--marxy-color-bg');
    const room0 = await roomTok(page, '--marxy-color-bg');
    assert.equal(bg0, room0);
    assert.match(await page.locator('.marxy-studio-tone-words').innerText(), /^Paper: 98% light, a little warm$/);

    const [x0, y0] = await at(page, '.marxy-studio-tone-pad', 0.75, 0.25);
    const [x1, y1] = await at(page, '.marxy-studio-tone-pad', 0.95, 0.16);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 4 });
    await page.mouse.up();
    await tokChanged(page, '--marxy-color-bg', bg0);
    // The drag's last paint can reach the canvas a frame before the room: wait for them to agree, then read both in one go.
    const both = () => {
      const k = '--marxy-color-bg';
      return [document.querySelector('.marxy-studio-now').style.getPropertyValue(k), document.querySelector('.marxy-studio').style.getPropertyValue(k)];
    };
    await page.waitForFunction(`(${both})().every((v, _, a) => v === a[0])`, null, { timeout: 5000 }).catch(() => {});
    const [bg1, room1] = await page.evaluate(both);
    assert.equal(room1, bg1, 'the room follows the page');
    await committed(page, 't.day !== undefined && t.day.l < 0.9');
    const s1 = await store(page);
    assert.ok(Math.abs(s1.tweaks.paper.day.l - 0.84) < 0.01, JSON.stringify(s1.tweaks.paper.day));
    assert.ok(s1.tweaks.paper.day.h === 82 && s1.tweaks.paper.day.c > 0.04, 'warm, as far right as the pad goes');
    assert.equal(merged(s1, 'paper').day.l, s1.tweaks.paper.day.l);

    // A point in the band: the puck lands outside it.
    let yBand = 0;
    for (let y = 0.3; y < 0.8; y += 0.005) if (!legible(toneFromPad(0.5, y))) yBand = y;
    assert.ok(yBand > 0, 'the pad has a dead band at its centre');
    assert.equal(legible(toneFromPad(0.5, yBand)), false);
    const [bx, by] = await at(page, '.marxy-studio-tone-pad', 0.5, yBand);
    await page.mouse.click(bx, by);
    await committed(page, 't.day !== undefined && t.day.l < 0.8');
    const s2 = await store(page);
    assert.ok(legible(s2.tweaks.paper.day), `the stored tone is legible: ${JSON.stringify(s2.tweaks.paper.day)}`);
    assert.notEqual(s2.tweaks.paper.day.l, Number(toneFromPad(0.5, yBand).l.toFixed(3)), 'pushed out of the band');
    const puck = await page.evaluate(() => {
      const p = document.querySelector('.marxy-studio-tone-puck');
      return Number.parseFloat(p.style.top) / 100;
    });
    assert.ok(legible(toneFromPad(0.5, puck)), 'the puck is drawn outside the band');
    assert.equal((await page.locator('.marxy-studio-tone-band').textContent()).replace(/\s/g, ' '), 'no ink reaches 7 : 1 here');

    // Double-click: the look's own day tone.
    const [cx, cy] = await at(page, '.marxy-studio-tone-pad', 0.3, 0.2);
    await page.mouse.dblclick(cx, cy);
    await committed(page, 't.day === undefined');
    await page.waitForFunction((bg) => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-color-bg') === bg, bg0);
    assert.equal(await roomTok(page, '--marxy-color-bg'), room0);
  });
});

test('at night: the puck sets the night tone; named tones set the tone; the band is drawn on the pad', async () => {
  await withFrame({ files: FILES, open: ['/r/notes/on-margins.md'] }, async (page) => {
    await open(page, 'tone');
    await page.locator('.marxy-studio-tone-chip', { hasText: 'Sepia' }).click();
    await committed(page, 't.day !== undefined && Math.abs(t.day.l - 0.905) < 0.002');
    assert.equal(await page.locator('.marxy-studio-tone-chip[aria-pressed="true"]').innerText(), 'Sepia');
    assert.match(await page.locator('.marxy-studio-tone-words').innerText(), /^Sepia: 91% light/);
    await page.locator('.marxy-studio-tone-dot[title="Mist"]').click();
    await committed(page, 't.day !== undefined && t.day.h === 250');

    await page.locator('.marxy-studio-top [role="radio"]', { hasText: 'Night' }).click();
    await page.waitForFunction(() => document.querySelector('.marxy-studio-tone-col .marxy-studio-h').textContent === 'Page tone at night');
    const bg0 = await canvasTok(page, '--marxy-color-bg');
    const [x, y] = await at(page, '.marxy-studio-tone-pad', 0.1, 0.92);
    await page.mouse.click(x, y);
    await tokChanged(page, '--marxy-color-bg', bg0);
    await committed(page, 't.night !== undefined && t.night.h === 250');
    const s = await store(page);
    assert.ok(legible(s.tweaks.paper.night));
    assert.equal(s.tweaks.paper.day.h, 250, 'the day tone is untouched');

    // The band is hatched: across it the strokes jump from dark to light; across paper white the field runs smooth.
    const jumps = await page.evaluate(() => {
      const cv = document.querySelector('.marxy-studio-tone-field');
      const g = cv.getContext('2d');
      const row = (fy) => {
        const d = g.getImageData(0, Math.round(cv.height * fy), cv.width, 1).data;
        let n = 0;
        for (let i = 4; i < d.length; i += 4) if (Math.abs(d[i] + d[i + 1] + d[i + 2] - d[i - 4] - d[i - 3] - d[i - 2]) > 60) n++;
        return n;
      };
      const band = Number.parseFloat(document.querySelector('.marxy-studio-tone-band').style.top) / 100;
      return { band: row(band), top: row(0.05) };
    });
    assert.ok(jumps.band >= 10 && jumps.top <= 2, JSON.stringify(jumps));
  });
});

test('Tone: ink and accent change the canvas and the merged look; double-click resets', async () => {
  await withFrame({ files: FILES, open: ['/r/notes/on-margins.md'] }, async (page) => {
    await open(page, 'tone');
    const text0 = await canvasTok(page, '--marxy-color-text');
    await dialTo(page, 'Ink', 8);
    await tokChanged(page, '--marxy-color-text', text0);
    assert.equal(await page.locator('.marxy-studio-tone-dials .marxy-studio-dial-v').first().innerText(), '8.0 : 1');
    await committed(page, 't.ink === 8');
    assert.equal(merged(await store(page), 'paper').ink, 8);
    await dblDial(page, 'Ink');
    await committed(page, 't.ink === undefined');
    await page.waitForFunction((v) => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-color-text') === v, text0);

    const acc0 = await canvasTok(page, '--marxy-color-accent');
    const [x, y] = await at(page, '.marxy-studio-tone-hue', 0.1, 0.5);
    await page.mouse.click(x, y);
    await tokChanged(page, '--marxy-color-accent', acc0);
    await committed(page, 't.accent !== undefined && Math.abs(t.accent - 36) <= 2');
    assert.ok(Math.abs(merged(await store(page), 'paper').accent - 36) <= 2);
    assert.match(await page.locator('.marxy-studio-tone-accent .marxy-studio-dial-v').innerText(), /^red, 3\d°$/);
    await page.locator('.marxy-studio-tone-hue').dblclick();
    await committed(page, 't.accent === undefined');
    await page.waitForFunction(() => document.querySelector('.marxy-studio-tone-accent .marxy-studio-dial-v').textContent === 'blue, 258°');
  });
});

test('Type: face, size, leading, weights, step, heading face, style and capitals reach the canvas and the store', async () => {
  await withFrame({ files: FILES, open: ['/r/notes/on-margins.md'] }, async (page) => {
    await open(page, 'type');
    const faceNames = await page.locator('.marxy-studio-type-facename').evaluateAll((els) => els.map((e) => [e.textContent, e.style.fontFamily]));
    assert.equal(faceNames.length, FACE_IDS.length);
    assert.ok(faceNames.every(([, f]) => f.length > 0), 'each face is set in itself');
    await page.locator('.marxy-studio-type-face', { hasText: 'Georgia' }).click();
    await page.waitForFunction(() => /^Georgia/.test(document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-font-text')));
    await committed(page, "t.face === 'georgia'");

    const cases = [
      ['Size', 26, '--marxy-size-body', 'size'],
      ['Leading', 1.8, '--marxy-line-box', 'lead'],
      ['Weight', 500, '--marxy-weight-body', 'weight'],
    ];
    for (const [label, v, tok, key] of cases) {
      const before = await canvasTok(page, tok);
      await dialTo(page, label, v);
      await tokChanged(page, tok, before);
      await committed(page, `t.${key} === ${v}`);
      assert.equal(merged(await store(page), 'paper')[key], v);
    }
    await dialTo(page, 'Heading weight', 760);
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-weight-heading') === '760');
    await dialTo(page, 'Step between heading levels', 1.35);
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-scale-ratio') === '1.35');
    await page.locator('.marxy-studio-type-select').selectOption('hyper');
    await page.waitForFunction(() => /Atkinson/.test(document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-font-heading')));
    await page.locator('[aria-label="Heading style"] [role="radio"]', { hasText: 'Italic' }).click();
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-heading-style') === 'italic');
    await page.locator('.marxy-studio-dockbody [aria-label="Headings in capitals"]').click();
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-heading-case') === 'uppercase');
    await committed(page, "t.headWeight === 760 && t.scale === 1.35 && t.headFace === 'hyper' && t.headStyle === 'italic' && t.caps === true");
    const m = merged(await store(page), 'paper');
    assert.deepEqual([m.headWeight, m.scale, m.headFace, m.headStyle, m.caps], [760, 1.35, 'hyper', 'italic', true]);

    // Back to the text's face; a double-click returns the size.
    await page.locator('.marxy-studio-type-select').selectOption('');
    await committed(page, 't.headFace === undefined');
    await dblDial(page, 'Size');
    await committed(page, 't.size === undefined');
    await page.waitForFunction(() => document.querySelector('.marxy-studio-dockbody input[aria-label="Size"]').value === '20');

    // The dials follow the look when it changes elsewhere (the shelf, undo, another tab).
    await page.evaluate(async () => {
      const s = await import('/src/look/store.ts');
      const st = s.lookState();
      s.setLookState({ ...st, tweaks: { ...st.tweaks, paper: { ...st.tweaks.paper, size: 30, caps: false } } });
    });
    await page.waitForFunction(() => document.querySelector('.marxy-studio-dockbody input[aria-label="Size"]').value === '30');
    assert.equal(await page.locator('.marxy-studio-dockbody [aria-label="Headings in capitals"]').getAttribute('aria-checked'), 'false');
  });
});

test('Page: measure (45 to 80, its rule shown while held), paragraphs, alignment and figures', async () => {
  await withFrame({ files: FILES, open: ['/r/notes/on-margins.md'] }, async (page) => {
    await open(page, 'page');
    const range = page.locator('.marxy-studio-dockbody input[aria-label="Measure"]');
    assert.deepEqual([await range.getAttribute('min'), await range.getAttribute('max')], ['45', '80']);
    await range.dispatchEvent('pointerdown');
    await dialTo(page, 'Measure', 50);
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-measure-chars') === '50');
    await page.waitForFunction(() => {
      const r = document.querySelector('.marxy-studio-measure');
      return r && !r.hidden && r.hasAttribute('data-marxy-held') && r.textContent.includes('50 characters');
    });
    await range.dispatchEvent('pointerup');
    await page.waitForFunction(() => !document.querySelector('.marxy-studio-measure').hasAttribute('data-marxy-held'));
    await committed(page, 't.measure === 50');
    assert.equal(merged(await store(page), 'paper').measure, 50);

    const seg = (label, text) => page.locator(`.marxy-studio-dockbody [aria-label="${label}"] [role="radio"]`, { hasText: text }).click();
    await seg('Paragraphs', 'Indented');
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-paragraph-indent') === '1.4em');
    await seg('Alignment', 'Justified');
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-justify') === '1');
    await seg('Figures', 'Old style');
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-figures') === 'oldstyle-nums');
    await committed(page, "t.para === 'indent' && t.align === 'justify' && t.figures === 'old'");
    const m = merged(await store(page), 'paper');
    assert.deepEqual([m.para, m.align, m.figures], ['indent', 'justify', 'old']);
    assert.match(await page.locator('.marxy-studio-dockbody').innerText(), /only at 45 characters or more/);
    assert.match(await page.locator('.marxy-studio-dockbody').innerText(), /articles only/);

    await dblDial(page, 'Measure');
    await committed(page, 't.measure === undefined');
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-measure-chars') === '66');
    assert.equal(await range.inputValue(), '66');
  });
});

test('the Ink dial reaches 21 : 1: Large print opens at its own contrast, not cut to 18', async () => {
  await withFrame({ files: { ...FILES, '/look.toml': 'on = true\nlook = "large"\nmode = "day"\n' }, open: ['/r/notes/on-margins.md'] }, async (page) => {
    await open(page, 'tone');
    const ink = await page.evaluate(() => {
      const i = document.querySelector('.marxy-studio-dockbody input[aria-label="Ink"]');
      return { max: i.max, value: i.value };
    });
    assert.deepEqual(ink, { max: '21', value: '21' });
  });
});

test('a measure drag the system cancels lets go of the measure, as a release does', async () => {
  await withFrame({ files: FILES, open: ['/r/notes/on-margins.md'] }, async (page) => {
    await open(page, 'type');
    await page.waitForSelector('.marxy-studio-measure-handle');
    await page.evaluate(() => {
      const h = document.querySelector('.marxy-studio-measure-handle');
      const r = h.getBoundingClientRect();
      const at = (type, dx) => h.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: r.left + dx, clientY: r.top + 2 }));
      at('pointerdown', 0);
      at('pointermove', -60);
    });
    await page.waitForFunction(() => document.querySelector('.marxy-studio-measure').hasAttribute('data-marxy-held'));
    await page.evaluate(() => document.querySelector('.marxy-studio-measure-handle').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7 })));
    await page.waitForFunction(() => !document.querySelector('.marxy-studio-measure').hasAttribute('data-marxy-held'), null, { timeout: 2000 });
    const held = await canvasTok(page, '--marxy-measure-chars');
    await page.evaluate(() => {
      const h = document.querySelector('.marxy-studio-measure-handle');
      h.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: h.getBoundingClientRect().left + 80, clientY: 0 }));
    });
    await page.waitForTimeout(200);
    assert.equal(await canvasTok(page, '--marxy-measure-chars'), held, 'a move after the cancel no longer drags');
  });
});

test('an image in a Studio page is not asked for', async () => {
  await withFrame({ files: FILES, open: ['/r/notes/on-margins.md'] }, async (page) => {
    await page.evaluate(() => performance.setResourceTimingBufferSize(10_000));
    const got = await page.evaluate(async () => {
      const { fillStudioPage } = await import('/src/render/studio-pages.ts');
      const article = document.createElement('article');
      document.body.append(article);
      await fillStudioPage(article, 'A chart: ![a chart](./studio-only-chart.png)\n');
      await new Promise((r) => setTimeout(r, 300));
      return {
        imgs: [...article.querySelectorAll('img')].filter((i) => i.getAttribute('src')).length,
        asked: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /studio-only-chart/.test(n)),
      };
    });
    assert.deepEqual(got, { imgs: 0, asked: [] });
  });
});
