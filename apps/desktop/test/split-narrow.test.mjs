// A split narrowed below two columns gives one back (F-106; X-32 finding 6). A split is refused at open when the
// window cannot hold two columns at the typography floor (`splitRefusal`); a split made wide and then narrowed
// used to keep two ~250 px panes. The same rule now decides the narrowed case: the unfocused pane is given back,
// its document stays a tab, its place is kept, and widening again brings the split back when nothing has changed.
// Booted on the shipped skeleton over the memory shell (test/support/two-pane.mjs), unfolded so the sidebar is open.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const para = (word) => `${word} runs long enough to wrap across several lines of the column, so the page has real paragraphs. `;
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(14)}\n\n## Later\n\n${para('Later').repeat(14)}\n\n- [ ] alpha task\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(14)}\n\n## Deep\n\n${para('Deep').repeat(14)}\n\n- [ ] bravo task\n`,
};

async function withPage(open, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    await bootTwoPanes(page, { files, open });
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    await page.waitForTimeout(200);
    await fn(page);
  } finally {
    await browser.close();
  }
}

const paths = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));
const narrow = async (page, width = 800) => {
  await page.setViewportSize({ width, height: 600 });
};
const count = (page, n) => page.waitForFunction((n) => window.__marxyHandle.panes().panes.length === n, n, { timeout: 8000 });
/** Whether the page's own rule would refuse a split now, and the narrowest article. */
const fit = (page) =>
  page.evaluate(async () => {
    const { canShowTwoColumns } = await import('/src/pane/fit.ts');
    const set = window.__marxyHandle.panes();
    return { fits: canShowTwoColumns(set.panes[0].host.parentElement), widths: set.panes.map((p) => Math.round(p.article.clientWidth)) };
  });
const tabs = (page) => page.evaluate(() => [...document.querySelectorAll('[data-marxy-tab]')].map((t) => t.getAttribute('data-marxy-tab')));
const place = (page, slot) => page.evaluate((s) => window.__marxyHandle.panes().panes[s].view.position().byteOffset, slot);
const scrollPane = async (page, slot, to) => {
  await page.evaluate(async ({ slot, to }) => {
    const pane = window.__marxyHandle.panes().panes[slot];
    await pane.view.jumpToSource?.(to);
  }, { slot, to });
};

test('a split narrowed to 800 px leaves one pane, as a split is refused there at open', async () => {
  await withPage(['/r/A.md', '/r/B.md'], async (page) => {
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md']);
    await narrow(page);
    await count(page, 1);
    const f = await fit(page);
    assert.equal(f.fits, false, 'the window is below the floor: the same rule that refuses a split at open');
    assert.ok(f.widths[0] >= 300, `the one pane has its width: ${f.widths}`);
    assert.deepEqual(await paths(page), ['/r/A.md']);
  });
});

test('the given-back document stays a tab, and widening again restores the split at both places', async () => {
  await withPage(['/r/A.md', '/r/B.md'], async (page) => {
    await scrollPane(page, 1, 2400);
    await page.waitForTimeout(200);
    const leftBefore = await place(page, 0);
    const rightBefore = await place(page, 1);
    assert.ok(rightBefore > 1000, `B is read part way: ${rightBefore}`);
    await narrow(page);
    await count(page, 1);
    assert.ok((await tabs(page)).includes('/r/B.md'), `B keeps its tab: ${await tabs(page)}`);
    assert.ok(Math.abs((await place(page, 0)) - leftBefore) < 600, 'the surviving pane keeps its place');
    await narrow(page, 1920);
    await count(page, 2);
    await page.waitForTimeout(500);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md']);
    assert.ok(Math.abs((await place(page, 1)) - rightBefore) < 600, `B's place came back: ${rightBefore} -> ${await place(page, 1)}`);
    assert.ok(Math.abs((await place(page, 0)) - leftBefore) < 600, 'A is where it was');
  });
});

test('the focused pane is the one that stays, left or right', async () => {
  await withPage(['/r/A.md', '/r/B.md'], async (page) => {
    await page.evaluate(() => { const s = window.__marxyHandle.panes(); s.focus(s.panes[1]); });
    await narrow(page);
    await count(page, 1);
    assert.deepEqual(await paths(page), ['/r/B.md']);
    await narrow(page, 1920);
    await count(page, 2);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md'], 'the order is the one it had');
  });
});

test('unsaved edits survive: a dirty surviving pane stays dirty, a dirty given-back pane is asked about first', async () => {
  await withPage(['/r/A.md', '/r/B.md'], async (page) => {
    const tick = (slot) => page.evaluate((s) => {
      window.__marxyHandle.panes().panes[s].article.querySelector('input[type=checkbox]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, slot);
    await tick(1);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.store()?.snapshot().dirty === true);
    await narrow(page);
    await page.waitForTimeout(800);
    // The given-back pane has an edit that is nowhere else: it is asked about, in its pane, and not closed.
    assert.equal((await paths(page)).length, 2, 'nothing is closed over an unsaved edit');
    const text = await page.evaluate(() => document.getElementById('marxy-notices-2')?.textContent ?? '');
    assert.match(text, /not saved/);
    await page.locator('#marxy-notices-2 .marxy-notice button', { hasText: 'Save and close' }).click();
    await count(page, 1);
    const disk = await page.evaluate(async () => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/r/B.md')));
    assert.match(disk, /\[x\] bravo task/, 'the edit was saved');
  });
});

test('a same-document split (the Split control) narrows to one pane in Read, the document kept', async () => {
  await withPage(['/r/A.md'], async (page) => {
    await page.locator('[role=radiogroup] [role=radio]', { hasText: 'Split' }).click();
    await count(page, 2);
    await narrow(page);
    await count(page, 1);
    assert.deepEqual(await paths(page), ['/r/A.md']);
    assert.equal((await fit(page)).fits, false);
  });
});

test('a dirty surviving pane keeps its edit, and the saved layout still names both columns while one is given back', async () => {
  await withPage(['/r/A.md', '/r/B.md'], async (page) => {
    await page.evaluate(() => {
      window.__marxyHandle.panes().panes[0].article.querySelector('input[type=checkbox]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.store()?.snapshot().dirty === true);
    await page.waitForTimeout(700);
    const layout = () => page.evaluate(async () => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/data/layout.json')));
    const before = JSON.parse(await layout());
    assert.equal(before.columns.length, 2);
    await narrow(page);
    await count(page, 1);
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.store().snapshot().dirty), true, 'the edit is kept');
    assert.equal(JSON.parse(await layout()).columns.length, 2, 'layout.json is left as it was');
    await narrow(page, 1920);
    await count(page, 2);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.store().snapshot().dirty), true);
  });
});

test('opening a document while narrowed ends the promise: widening does not bring the old split back', async () => {
  await withPage(['/r/A.md', '/r/B.md'], async (page) => {
    await narrow(page);
    await count(page, 1);
    await page.evaluate(() => window.__marxyHandle.panes().openIn('focused', '/r/B.md'));
    await narrow(page, 1920);
    await page.waitForTimeout(600);
    assert.deepEqual(await paths(page), ['/r/B.md']);
  });
});

test('a scratch document is never the pane given back: the file goes, the scratch stays, and widening shows no error pane', async () => {
  await withPage(['/r/A.md'], async (page) => {
    await page.evaluate(async () => {
      const set = window.__marxyHandle.panes();
      await set.openIn('other', '/r/B.md');
      await set.openScratch(new TextEncoder().encode('scratch words'));
    });
    await count(page, 2);
    await narrow(page);
    await count(page, 1);
    const kept = (await paths(page))[0];
    assert.match(kept, /ntitled/, `the scratch stays: ${kept}`);
    assert.ok((await tabs(page)).includes('/r/A.md'), 'A keeps its tab');
    await narrow(page, 1920);
    await count(page, 2);
    await page.waitForTimeout(500);
    const shown = await page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => [p.path(), p.article.textContent.slice(0, 80)]));
    assert.ok(shown.every(([path, text]) => path !== null && !/Error/.test(text)), JSON.stringify(shown));
  });
});

test('Find open in the pane asked about is closed first, so Save and close is reachable', async () => {
  await withPage(['/r/A.md', '/r/B.md'], async (page) => {
    await page.evaluate(() => {
      window.__marxyHandle.panes().panes[1].article.querySelector('input[type=checkbox]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.store()?.snapshot().dirty === true);
    await page.evaluate(() => { const s = window.__marxyHandle.panes(); s.focus(s.panes[1]); });
    await page.keyboard.press('ControlOrMeta+f');
    await page.waitForSelector('#marxy-main .marxy-find');
    await page.evaluate(() => { const s = window.__marxyHandle.panes(); s.focus(s.panes[0]); });
    // Find belongs to the right pane (the one that will be asked about); the left one is focused and stays.
    await narrow(page);
    await page.waitForSelector('#marxy-notices-2 .marxy-notice button');
    assert.equal(await page.locator('.marxy-find').count(), 0, 'the find panel is gone');
    await page.locator('#marxy-notices-2 .marxy-notice button', { hasText: 'Save and close' }).click({ timeout: 3000 });
    await count(page, 1);
  });
});

test('closing the given-back document\'s tab while narrowed ends the restore', async () => {
  await withPage(['/r/A.md', '/r/B.md'], async (page) => {
    await narrow(page);
    await count(page, 1);
    await page.locator('[data-marxy-tab="/r/B.md"] .marxy-tab-close').click();
    await page.waitForTimeout(300);
    await narrow(page, 1920);
    await page.waitForTimeout(700);
    assert.deepEqual(await paths(page), ['/r/A.md']);
  });
});

test('a restore keeps the surviving pane as the reader left it, in mode and place', async () => {
  await withPage(['/r/A.md', '/r/B.md'], async (page) => {
    await narrow(page);
    await count(page, 1);
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.setMode('source'));
    await scrollPane(page, 0, 2400);
    await page.waitForTimeout(300);
    const at = await place(page, 0);
    await narrow(page, 1920);
    await count(page, 2);
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.mode), 'source');
    assert.ok(Math.abs((await place(page, 0)) - at) < 600, `place ${at} -> ${await place(page, 0)}`);
  });
});
