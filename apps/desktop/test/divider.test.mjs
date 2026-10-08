// The hairline divider (D-04; ADR-0057): drawn only between two panes, no layout width, dragged,
// double-clicked or keyed to a ratio held at the 45-character floor, with its focus fade and its palette
// commands. Booted on the shipped skeleton and CSS (test/support/two-pane.mjs), over the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has real paragraphs to break. `;
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(4)}\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(4)}\n`,
};
const VIEW = { width: 1800, height: 900 };

async function withPage(fn, opts = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: VIEW, ...opts });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const widths = (page) =>
  page.evaluate(() => ({
    main: document.getElementById('marxy-main').getBoundingClientRect().width,
    panes: [...document.querySelectorAll('#marxy-main > section.marxy-pane')].map((h) => h.getBoundingClientRect().width),
    hit: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--marxy-divider-hit')),
  }));
const dividerBox = (page) => page.locator('.marxy-divider').boundingBox();
/** The floor in pixels, from the page's own typography: 45 average characters plus two gutters. */
const floorPx = (page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const gutter = parseFloat(getComputedStyle(document.querySelector('.marxy-article')).paddingLeft);
    return 45 * parseFloat(root.getPropertyValue('--marxy-avg-char')) * parseFloat(root.getPropertyValue('--marxy-size-body')) + 2 * gutter;
  });
const commandIds = (page) =>
  page.evaluate(() => {
    const h = window.__marxyHandle;
    return h.commands().filter((c) => c.id.startsWith('view.') && /split/.test(c.id)).map((c) => [c.id, c.when({})]);
  });
const run = (page, id) => page.evaluate((id) => window.__marxyHandle.commands().find((c) => c.id === id).run({}), id);
const left = (page) => page.evaluate(() => document.querySelector('#marxy-main > section[data-marxy-pane="0"]').getBoundingClientRect().width);

test('two panes: one divider inside #marxy-main, with no layout width, a role and a label', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    const info = await page.evaluate(() => {
      const els = document.querySelectorAll('.marxy-divider');
      const el = els[0];
      return {
        count: els.length,
        inMain: el.parentElement.id === 'marxy-main',
        width: el.getBoundingClientRect().width,
        role: el.getAttribute('role'),
        label: el.getAttribute('aria-label'),
        orientation: el.getAttribute('aria-orientation'),
        line: getComputedStyle(el, '::before').width,
        text: el.textContent,
      };
    });
    const w = await widths(page);
    assert.equal(info.count, 1);
    assert.equal(info.inMain, true);
    assert.ok(info.width <= w.hit + 0.01, `divider width ${info.width} exceeds the hit area ${w.hit}`);
    assert.ok(Math.abs(w.panes[0] + w.panes[1] - w.main) < 0.5, `panes ${w.panes} do not sum to ${w.main}`);
    assert.equal(info.role, 'separator');
    assert.equal(info.orientation, 'vertical');
    assert.ok(info.label && info.label.length > 0);
    assert.equal(info.line, '1px');
    assert.equal(info.text, '');
  });
});

test('one pane: no divider in the DOM, before a split and after closing the second pane', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    assert.equal(await page.locator('.marxy-divider').count(), 0);
    await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      await panes.openIn('other', '/r/B.md');
    });
    assert.equal(await page.locator('.marxy-divider').count(), 1);
    await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      await panes.close(panes.panes[1]);
    });
    assert.equal(await page.locator('.marxy-divider').count(), 0);
  });
});

test('dragging the divider to 30 % sets the left pane to 30 %; to 5 % it stops at the column floor', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    const box = await dividerBox(page);
    const y = box.y + 100;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(VIEW.width * 0.3, y, { steps: 6 });
    await page.mouse.up();
    assert.ok(Math.abs((await left(page)) - VIEW.width * 0.3) <= 1, `left pane is ${await left(page)}`);
    const moved = await dividerBox(page);
    await page.mouse.move(moved.x + moved.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(VIEW.width * 0.05, y, { steps: 6 });
    await page.mouse.up();
    const floor = await floorPx(page);
    const got = await left(page);
    assert.ok(Math.abs(got - floor) <= 1, `left pane is ${got}, the floor is ${floor}`);
    assert.ok(got > VIEW.width * 0.05 + 100);
  });
});

test('double-clicking the divider returns the panes to equal widths', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await page.evaluate(() => window.__marxyHandle.panes().setRatio(0.35));
    assert.ok(Math.abs((await left(page)) - VIEW.width * 0.35) <= 1);
    const box = await dividerBox(page);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + 100);
    const w = await widths(page);
    assert.ok(Math.abs(w.panes[0] - w.panes[1]) <= 1, String(w.panes));
  });
});

test('the palette commands: offered only with two panes; even, widen and narrow move the divider', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    assert.deepEqual(await commandIds(page), [
      ['view.reset-split', false],
      ['view.split-wider', false],
      ['view.split-narrower', false],
    ]);
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    assert.ok((await commandIds(page)).every(([, when]) => when === true));
    // Focus is on the right pane after opening beside: set it on the left to read "toward the focused side".
    await page.evaluate(() => { const p = window.__marxyHandle.panes(); p.focus(p.panes[0]); });
    await run(page, 'view.split-wider');
    assert.ok(Math.abs((await left(page)) - VIEW.width * 0.55) <= 1);
    await run(page, 'view.split-narrower');
    await run(page, 'view.split-narrower');
    assert.ok(Math.abs((await left(page)) - VIEW.width * 0.45) <= 1);
    await page.evaluate(() => { const p = window.__marxyHandle.panes(); p.focus(p.panes[1]); });
    await run(page, 'view.split-wider');
    assert.ok(Math.abs((await left(page)) - VIEW.width * 0.40) <= 1);
    await run(page, 'view.reset-split');
    assert.ok(Math.abs((await left(page)) - VIEW.width * 0.5) <= 1);
    // Never past the floor, however often it is asked.
    for (let i = 0; i < 40; i++) await run(page, 'view.split-wider');
    const w = await widths(page);
    assert.ok(w.panes[0] >= (await floorPx(page)) - 1 && w.panes[1] >= (await floorPx(page)) - 1, String(w.panes));
  });
});

test('the divider is a keyboard widget: arrows move it, Home and End go to the ends of the reachable range, and it says where it is', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    const divider = page.locator('.marxy-divider');
    // Tab reaches it at the boundary: after the first pane's content and before the second's.
    const order = await page.evaluate(() => [...document.querySelectorAll('#marxy-main > *')].map((e) => e.className.split(' ')[0]));
    assert.deepEqual(order, ['marxy-pane', 'marxy-divider', 'marxy-pane']);
    await divider.focus();
    await page.keyboard.press('ArrowLeft');
    assert.ok(Math.abs((await left(page)) - VIEW.width * 0.45) <= 1);
    assert.equal(await divider.getAttribute('aria-valuenow'), '45');
    // Keyboard focus is shown: the browser agrees it is focus-visible, and it draws an outline.
    const focus = await page.evaluate(() => {
      const el = document.querySelector('.marxy-divider');
      const s = getComputedStyle(el);
      const probe = document.createElement('i');
      probe.style.color = 'var(--marxy-color-divider-focus)';
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return { visible: el.matches(':focus-visible'), style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, accent };
    });
    assert.equal(focus.visible, true);
    // The theme's own ring, not the browser's default one (which is `auto`).
    assert.equal(focus.style, 'solid');
    assert.equal(focus.width, '2px');
    assert.equal(focus.color, focus.accent);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.ok(Math.abs((await left(page)) - VIEW.width * 0.55) <= 1);
    const min = Number(await divider.getAttribute('aria-valuemin'));
    const max = Number(await divider.getAttribute('aria-valuemax'));
    const floor = await floorPx(page);
    assert.ok(min > 0 && max < 100 && min < 50 && max > 50, `${min}..${max}`);
    assert.ok(Math.abs(min - Math.ceil((floor / VIEW.width) * 100)) <= 1, `valuemin ${min}, the floor is ${floor}px`);
    assert.equal(min + max, 100);
    await page.keyboard.press('Home');
    // (The gutter is read from the page as it is when the key is pressed and varies with column width, so allow a percent or two.)
    assert.ok(Math.abs((await left(page)) - (VIEW.width * min) / 100) <= VIEW.width * 0.01, `left ${await left(page)}, valuemin ${min}`);
    assert.equal(await divider.getAttribute('aria-valuenow'), String(Math.round(((await left(page)) / VIEW.width) * 100)));
    await page.keyboard.press('End');
    const w = await widths(page);
    const maxNow = Number(await divider.getAttribute('aria-valuemax'));
    assert.ok(Math.abs(w.panes[1] - (VIEW.width * (100 - maxNow)) / 100) <= VIEW.width * 0.02, `right pane ${w.panes[1]}, valuemax ${maxNow}`);
  });
});

test('hover, drag and keyboard focus draw the line at 3:1 or better against the page, in light and dark', async () => {
  // WCAG 1.4.11 asks 3:1 of a component's states. At rest the line is the rule colour on purpose (ADR-0057).
  const lineVsPage = (page) =>
    page.evaluate(() => {
      const channels = (css) => {
        const m = css.match(/rgba?\(([^)]+)\)/);
        return m[1].split(/[ ,/]+/).slice(0, 3).map(Number);
      };
      const lum = ([r, g, b]) => {
        const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const line = channels(getComputedStyle(document.querySelector('.marxy-divider'), '::before').backgroundColor);
      const bg = channels(getComputedStyle(document.documentElement).backgroundColor);
      const [hi, lo] = [lum(line), lum(bg)].sort((a, b) => b - a);
      return { ratio: (hi + 0.05) / (lo + 0.05), line };
    });
  for (const variant of ['dark', 'light']) {
    await withPage(async (page) => {
      await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
      await page.evaluate((v) => document.documentElement.setAttribute('data-marxy-variant', v), variant);
      await page.waitForTimeout(300);
      const rest = await lineVsPage(page);
      assert.ok(rest.ratio < 3, `${variant}: at rest the line is ${rest.ratio}:1, expected the quiet rule colour`);
      const box = await dividerBox(page);
      const x = box.x + box.width / 2;
      const y = box.y + 100;
      await page.mouse.move(x, y);
      const hover = await lineVsPage(page);
      assert.ok(hover.ratio >= 3, `${variant}: hovered line is ${hover.ratio}:1`);
      await page.mouse.down();
      await page.mouse.move(VIEW.width * 0.4, y, { steps: 4 });
      const drag = await lineVsPage(page);
      assert.ok(drag.ratio >= 3, `${variant}: line mid-drag is ${drag.ratio}:1`);
      await page.mouse.up();
      await page.mouse.move(5, 5);
      await page.locator('.marxy-divider').focus();
      await page.keyboard.press('ArrowRight');
      const focus = await lineVsPage(page);
      assert.ok(focus.ratio >= 3, `${variant}: keyboard-focused line is ${focus.ratio}:1`);
    });
  }
});

test('focus moving fades the focused side in over 150 ms, and not under reduced motion', async () => {
  const fade = (page) =>
    page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.marxy-divider'), '::before');
      return { name: s.animationName, duration: s.animationDuration, left: s.left };
    });
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await page.evaluate(() => { const p = window.__marxyHandle.panes(); p.focus(p.panes[1]); });
    const right = await fade(page);
    assert.equal(right.name, 'marxy-divider-fade-1');
    assert.equal(right.duration, '0.15s');
    await page.evaluate(() => { const p = window.__marxyHandle.panes(); p.focus(p.panes[0]); });
    const leftSide = await fade(page);
    assert.equal(leftSide.name, 'marxy-divider-fade-0');
    assert.notEqual(leftSide.left, right.left);
    // After the fade the line is the divider colour, which is the rule colour by default.
    await page.waitForTimeout(300);
    const colours = await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.color = 'var(--marxy-color-divider)';
      document.body.append(probe);
      const divider = getComputedStyle(probe).color;
      probe.style.color = 'var(--marxy-color-rule)';
      const rule = getComputedStyle(probe).color;
      probe.remove();
      return { divider, rule, line: getComputedStyle(document.querySelector('.marxy-divider'), '::before').backgroundColor };
    });
    assert.equal(colours.line, colours.divider);
    assert.equal(colours.divider, colours.rule);
  });
  await withPage(
    async (page) => {
      await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
      assert.equal((await fade(page)).name, 'none');
    },
    { reducedMotion: 'reduce' },
  );
});

test('under forced colours the line is CanvasText, with no fade', async () => {
  await withPage(
    async (page) => {
      await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
      assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true);
      const got = await page.evaluate(() => {
        const probe = document.createElement('i');
        probe.style.color = 'CanvasText';
        document.body.append(probe);
        const canvasText = getComputedStyle(probe).color;
        probe.remove();
        const s = getComputedStyle(document.querySelector('.marxy-divider'), '::before');
        return { line: s.backgroundColor, canvasText, animation: s.animationName };
      });
      assert.equal(got.line, got.canvasText);
      assert.equal(got.animation, 'none');
    },
    { forcedColors: 'active' },
  );
});
