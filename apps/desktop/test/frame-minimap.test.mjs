// The bar down a pane's right edge stays on that edge when the frame moves the pane: a drawer opening or shutting shifts
// a pane without resizing it, which a strip fixed to the window did not hear. In Read the bar is the spine
// (frame/spine.ts); Shape as the scrollbar (proposal `minimap`) draws only in Source, so the two never stand side by side.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const long = (title) => `# ${title}\n\n${Array.from({ length: 80 }, (_, i) => `## Part ${i}\n\nA paragraph of words for part ${i}.\n`).join('\n')}`;
const FILES = { '/r/A.md': long('A'), '/r/B.md': long('B') };

/** For each pane with a spine: how far the spine's left edge is from 18 px inside the pane's right edge. */
const offsets = (page) =>
  page.evaluate(() => {
    const spines = [...document.querySelectorAll('.marxy-spine')].filter((s) => !s.hidden);
    const panes = window.__marxyHandle.panes().panes;
    return panes.map((p) => {
      const right = p.host.getBoundingClientRect().right;
      const spine = p.host.querySelector(':scope > .marxy-spine:not([hidden])') ?? spines[0];
      return spine ? Math.round(right - 18 - spine.getBoundingClientRect().left) : null;
    });
  });

const shownSpines = (page, n) => page.waitForFunction((n) => [...document.querySelectorAll('.marxy-spine')].filter((s) => !s.hidden).length === n, n);
const strips = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-mmap')].filter((s) => !s.hidden).length);

const rail = (page, name) => page.click(`.marxy-rail button[aria-label="${name}"], .marxy-rail button[title="${name}"]`);

// At 1024 px a single pane keeps its width and only moves; at 1440 px it is resized as well.
for (const [open, width] of [[['/r/A.md'], 1024], [['/r/A.md'], 1440], [['/r/A.md', '/r/B.md'], 1440]]) {
  test(`the spine follows its pane when the drawer opens, shuts and changes panel, with no minimap beside it (${open.length} pane${open.length > 1 ? 's' : ''}, ${width} px)`, async () => {
    await withFrame({ files: FILES, open, viewport: { width, height: 800 } }, async (page, { mod }) => {
      await shownSpines(page, open.length);
      // Past the minimap's own settling (120 ms), which drew a strip in Read before.
      await page.waitForTimeout(400);
      assert.equal(await strips(page), 0, 'no minimap in Read');
      const zero = open.map(() => 0);
      assert.deepEqual(await offsets(page), zero, 'at launch');
      for (const [what, act] of [
        ['the drawer shut to the rail', () => rail(page, 'Places')],
        ['the drawer opened again', () => rail(page, 'Places')],
        ['Metadata shown', () => page.keyboard.press(`${mod}+Alt+KeyB`)],
        ['Metadata set to the rail', () => page.keyboard.press(`${mod}+Alt+KeyB`)],
      ]) {
        await act();
        // Past the frame's eased move (0.28 s) and the spine's redraw.
        await page.waitForTimeout(600);
        assert.deepEqual(await offsets(page), zero, what);
      }
    });
  });
}

test('the spine follows its pane while the divider is dragged, with no lag behind the pointer', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md', '/r/B.md'], viewport: { width: 1440, height: 800 } }, async (page) => {
    // The drawer docked leaves the panes too little to drag the divider 100 px; the rail alone is the room the test was written in.
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="places"]');
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-drawer') === 'closed');
    await shownSpines(page, 2);
    const box = await page.locator('.marxy-divider').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + 300;
    const edge = () => page.evaluate(() => window.__marxyHandle.panes().panes[0].host.getBoundingClientRect().right);
    const before = await edge();
    await page.mouse.move(x, y);
    await page.mouse.down();
    const seen = [];
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(x - i * 30, y);
      // Two frames for the resize to be heard, counted in frames, not milliseconds, so a loaded machine is held to the same
      // promise: the spine is where its pane is by the frame after the move.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      seen.push(await offsets(page));
    }
    const moved = await edge();
    await page.mouse.up();
    assert.ok(moved < before - 100, `the divider moved the pane (right edge ${before} to ${moved})`);
    for (const [i, row] of seen.entries()) assert.deepEqual(row, [0, 0], `mid-drag, move ${i + 1}`);
  });
});

test('a burst of scroll events asks for one animation frame from the minimap in Source, not one per event', async () => {
  await withFrame({ files: FILES, open: ['/r/A.md'], viewport: { width: 1440, height: 800 } }, async (page) => {
    await page.evaluate(() => window.__marxyHandle.toggleMode());
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-mmap')].filter((s) => !s.hidden).length === 1);
    // Past the strip's own settling after the mode change, so only the burst is counted.
    await page.waitForTimeout(500);
    const frames = await page.evaluate(async () => {
      let n = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => {
        if (new Error().stack?.includes('minimap')) n += 1;
        return raf(cb);
      };
      const scroller = document.querySelector('[data-marxy-mmap]');
      for (let i = 0; i < 50; i++) scroller.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 100));
      window.requestAnimationFrame = raf;
      return n;
    });
    assert.equal(frames, 1);
  });
});

test('a page that fits the window does not scroll: the tab row is not added to the window\'s height', async () => {
  await withFrame({ files: { '/r/short.md': '# Short\n\nOne line.\n' }, open: ['/r/short.md'], viewport: { width: 1200, height: 700 } }, async (page) => {
    await page.waitForSelector('.marxy-article h1');
    await page.waitForTimeout(300);
    const { tall, tabs } = await page.evaluate(() => ({
      tall: document.documentElement.scrollHeight - window.innerHeight,
      tabs: document.querySelector('.marxy-tabbar')?.getBoundingClientRect().height ?? 0,
    }));
    assert.ok(tabs > 0, 'the tab row is shown');
    assert.equal(tall, 0, 'the root overflows the window by nothing');
  });
});
