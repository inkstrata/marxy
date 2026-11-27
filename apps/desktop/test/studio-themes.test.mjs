// The Studio as a theme creator in WebKit: the shelf is a list of themes, each row drawn in
// its own look; a row shown on the pointer or the arrow keys is previewed without being set, and a row chosen puts it in
// use; Colours sets any colour by hand, held to its floor and said so; Back to the theme gives the page back.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PLAN = ['# Plan', '', 'A plan of the reader’s own, long enough to wrap in the column of the measure a look sets.', '', '```js', 'const answer = 42; // a comment', '```', ''].join('\n');
const FILES = { '/r/plans/plan.md': PLAN };
/** WCAG 2.2 contrast of two #rrggbb colours. */
function contrast(a, b) {
  const lum = (h) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const openStudio = (page, arg) => page.evaluate(async (a) => (await import('/src/studio/studio.ts')).openStudioSurface(a), arg);
const store = (page) => page.evaluate(async () => {
  const s = await import('/src/look/store.ts');
  return { on: s.looksOn(), id: s.lookState().id, pins: s.lookState().tweaks[s.lookState().id]?.pins ?? null };
});

test('the shelf: dark themes and light, each row its name and what it is, drawn in its own appearance; shown is not chosen', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page) => {
    await openStudio(page, 'tone');
    await page.waitForSelector('.marxy-studio-themerow[data-marxy-look="ember"]');
    const s = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.marxy-studio-themerow')];
      const ink = document.querySelector('.marxy-studio-themerow[data-marxy-look="ink"]');
      const book = document.querySelector('.marxy-studio-themerow[data-marxy-look="book"]');
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return {
        groups: [...document.querySelectorAll('.marxy-studio-group-h')].map((h) => h.textContent),
        ids: rows.map((r) => r.dataset.marxyLook),
        names: rows.slice(0, 5).map((r) => r.querySelector('.marxy-studio-row-name').textContent),
        parts: ink.children.length,
        line: ink.querySelector('.marxy-studio-row-line').textContent,
        chosen: rows.filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => r.dataset.marxyLook),
        inkBg: getComputedStyle(ink).backgroundColor,
        pageBg: getComputedStyle(document.querySelector('.marxy-studio-now')).backgroundColor,
        bookLight: lum(getComputedStyle(book).backgroundColor) > 180,
        inkDark: lum(getComputedStyle(ink).backgroundColor) < 60,
        canvas: document.querySelector('.marxy-studio-now').getAttribute('data-marxy-look'),
        width: Math.round(document.querySelector('.marxy-studio-shelf').getBoundingClientRect().width),
      };
    });
    assert.deepEqual(s.groups, ['Dark', 'Light']);
    assert.deepEqual(s.names, ['Ink', 'Night', 'Midnight', 'Black', 'Ember'], 'Ink and Night first, then a cool dark, a true black and a dark with red');
    for (const id of ['polar', 'fjord', 'warm', 'solarized', 'gruvbox', 'rose-pine', 'catppuccin', 'high-contrast', 'paper', 'book', 'newsprint', 'mint', 'dim']) assert.ok(s.ids.includes(id), id);
    assert.equal(s.parts, 2, 'a row is its name and what it is, nothing more');
    assert.match(s.line, /Paper by day/);
    assert.deepEqual(s.chosen, ['ink'], 'the theme in force is Ink, by default');
    assert.equal(s.canvas, 'ink', 'the canvas shows the page as it is');
    assert.equal(s.inkBg, s.pageBg, 'Ink’s row is drawn on Ink’s own page');
    assert.ok(s.inkDark && s.bookLight, 'each row in the appearance it is known by');
    assert.ok(s.width <= 240, `a narrow shelf: ${s.width}`);

    // The arrow keys show a theme on the canvas; nothing is chosen until Enter.
    await page.focus('.marxy-studio-themerow[data-marxy-look="ink"]');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').getAttribute('data-marxy-look') === 'night-paper');
    assert.deepEqual(await store(page), { on: false, id: 'ink', pins: null });
    await page.keyboard.press('Enter');
    await page.waitForFunction(async () => (await import('/src/look/store.ts')).looksOn());
    assert.equal((await store(page)).id, 'night-paper', 'Enter chose the row shown');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-marxy-look') === 'night-paper');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-studio-themerow[aria-selected="true"]').dataset.marxyLook), 'night-paper');

    // A light theme chosen is seen light, whatever the hour: the page turns to day.
    await page.evaluate(() => document.querySelector('.marxy-studio-themerow[data-marxy-look="book"]').click());
    await page.waitForFunction(() => document.documentElement.getAttribute('data-marxy-variant') === 'light');
    assert.equal(await page.evaluate(async () => (await import('/src/look/store.ts')).lookState().mode), 'day');
    // The foot holds one thing: a new theme from the one on the canvas.
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.marxy-studio-shelf-foot button')].map((b) => b.textContent)), ['Save as a new theme…']);
  });
});

test('previews hand over from row to row: crossing the gap between two rows never shows the theme in use', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page) => {
    await openStudio(page, 'tone');
    await page.waitForSelector('.marxy-studio-themerow[data-marxy-look="black"]');
    await page.evaluate(() => {
      const canvas = document.querySelector('.marxy-studio-now');
      window.__seen = [];
      new MutationObserver(() => {
        const id = canvas.getAttribute('data-marxy-look');
        if (window.__seen.at(-1) !== id) window.__seen.push(id);
      }).observe(canvas, { attributes: true, attributeFilter: ['data-marxy-look'] });
    });
    const boxes = await page.evaluate(() =>
      ['night-paper', 'midnight', 'black'].map((id) => {
        const b = document.querySelector(`.marxy-studio-themerow[data-marxy-look="${id}"]`).getBoundingClientRect();
        return { x: b.left + b.width / 2, top: b.top, bottom: b.bottom };
      }),
    );
    await page.mouse.move(boxes[0].x, boxes[0].top + 8);
    for (let i = 0; i < boxes.length; i += 1) {
      await page.mouse.move(boxes[i].x, boxes[i].bottom - 3, { steps: 3 });
      if (boxes[i + 1]) await page.mouse.move(boxes[i].x, boxes[i + 1].top + 5, { steps: 3 });
    }
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.__seen), ['night-paper', 'midnight', 'black'], 'one theme straight to the next');
    // Leaving the list lets the preview go: the canvas shows the theme in use again.
    await page.mouse.move(700, 400);
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').getAttribute('data-marxy-look') === 'ink');
  });
});

test('Colours: a colour set by hand is pinned and painted; one under its floor is held to it, and the note says so', async () => {
  await withFrame({ files: { ...FILES, '/look.toml': 'on = true\nlook = "ink"\nmode = "night"\n' }, open: ['/r/plans/plan.md'] }, async (page) => {
    await openStudio(page, 'colours');
    await page.waitForSelector('.marxy-studio-colour-hex');
    const setHex = (label, v) =>
      page.evaluate(
        ({ label, v }) => {
          const i = document.querySelector(`.marxy-studio-colour-hex[aria-label="${label}: a hex colour"]`);
          i.value = v;
          i.dispatchEvent(new Event('change', { bubbles: true }));
        },
        { label, v },
      );
    await setHex('Links', '#e0a060');
    await page.waitForFunction(() => document.querySelector('.marxy-studio-now').style.getPropertyValue('--marxy-color-accent') === '#e0a060');
    await page.waitForFunction(async () => (await import('/src/look/store.ts')).lookState().tweaks.ink?.pins?.night?.accent === '#e0a060');

    // A text colour far under 7 : 1 on Ink's night page is walked up to it, keeping its hue, and said to be held.
    await setHex('Text', '#3a3833');
    await page.waitForFunction(() => document.querySelector('.marxy-studio-colour-note[data-marxy-held]'));
    const r = await page.evaluate(() => {
      const n = document.querySelector('.marxy-studio-now');
      return { text: n.style.getPropertyValue('--marxy-color-text'), bg: n.style.getPropertyValue('--marxy-color-bg'), note: document.querySelector('.marxy-studio-colour-note[data-marxy-held]').textContent };
    });
    r.ratio = contrast(r.text, r.bg);
    assert.ok(r.ratio >= 7, `the text holds 7 : 1 (${r.ratio})`);
    assert.match(r.note, /^held: #3a3833 fell under 7 : 1$/);

    // All colours as drawn takes the reader's colours back.
    await page.evaluate(() => [...document.querySelectorAll('.marxy-studio-colours-head .marxy-studio-link')].find((b) => b.textContent === 'all colours as drawn').click());
    await page.waitForFunction(async () => !(await import('/src/look/store.ts')).lookState().tweaks.ink?.pins);
  });
});
