// Read, Split and Source on Mod+1, Mod+2, Mod+3 (W-19; ADR-0058 item 7). Booted on the shipped skeleton
// over the memory shell (test/support/split-same.mjs).
import { strict as assert } from 'node:assert';
import { after } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { paths, test, texts, withPanes } from './support/split-same.mjs';

after(() => closeHarness());

const modes = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.view.mode));
const focused = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.slot);
const place = (page, slot) => page.evaluate((slot) => window.__marxyHandle.panes().panes[slot].view.position().byteOffset, slot);
const settle = (page) => page.waitForTimeout(400);

test('Mod+3 makes a Rendered pane Source and Mod+1 makes it Rendered, each a no-op when already there', async () => {
  await withPanes(['/r/A.md'], async (page, mod) => {
    assert.deepEqual(await modes(page), ['rendered']);
    await page.keyboard.press(`${mod}+1`);
    await settle(page);
    assert.deepEqual(await modes(page), ['rendered'], 'Mod+1 on Rendered does not flip it');
    await page.keyboard.press(`${mod}+3`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.mode === 'source');
    await page.keyboard.press(`${mod}+3`);
    await settle(page);
    assert.deepEqual(await modes(page), ['source'], 'Mod+3 on Source does not flip it');
    await page.keyboard.press(`${mod}+1`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.mode === 'rendered');
    assert.equal(await focused(page), 0);
  });
});

test('the reading position survives Read to Source and back', async () => {
  await withPanes(['/r/A.md'], async (page, mod) => {
    const box = await page.evaluate(() => {
      const r = window.__marxyHandle.panes().panes[0].host.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    await page.mouse.wheel(0, 1500);
    await settle(page);
    const before = await place(page, 0);
    assert.ok(before > 200);
    await page.keyboard.press(`${mod}+3`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.mode === 'source');
    await settle(page);
    await page.keyboard.press(`${mod}+1`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.mode === 'rendered');
    await settle(page);
    const after = await place(page, 0);
    assert.ok(Math.abs(after - before) < 400, `place ${before} became ${after}`);
  });
});

test('Mod+1 works from inside the Source editor; over one document twice it leaves Split (F-44)', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+3`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 1 && window.__marxyHandle.panes().panes[0].view.mode === 'source');
    await page.click('#marxy-source .cm-content');
    await page.keyboard.press(`${mod}+1`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.mode === 'rendered');
    assert.deepEqual(await modes(page), ['rendered']);
  });
});

test('Mod+2 on one pane with a document opens it in the other: Rendered left, Source right, focus stays', async () => {
  await withPanes(['/r/A.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+2`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes[1].view.mode === 'source');
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/A.md']);
    assert.deepEqual(await modes(page), ['rendered', 'source']);
    assert.equal(await focused(page), 0);
  });
});

test('Mod+2 on one pane showing Source puts Read on the left first', async () => {
  await withPanes(['/r/A.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+3`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.mode === 'source');
    await page.keyboard.press(`${mod}+2`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes[1].view.mode === 'source');
    assert.deepEqual(await modes(page), ['rendered', 'source']);
  });
});

test('Mod+2 on two panes over one path leaves Split: one pane in Read (F-44)', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+2`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 1);
    assert.deepEqual(await modes(page), ['rendered']);
    assert.deepEqual(await paths(page), ['/r/A.md']);
  });
});

test('Mod+2 on two panes over two files changes nothing and says why', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+2`);
    await settle(page);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md']);
    assert.deepEqual(await modes(page), ['rendered', 'rendered']);
    const all = [...(await texts(page, 0)), ...(await texts(page, 1))];
    assert.ok(all.some((t) => t?.includes('Split shows one document twice')), `notices: ${JSON.stringify(all)}`);
  });
});
