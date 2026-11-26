// An app page (frame/app-page.ts: the hue test, a folder's page) and the keys over it, and What a character is when the
// shell names a character late (proposals/inspector.ts). Playwright WebKit over the memory shell.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const files = { '/docs/a.md': '# A page\n\nSome words — and a dash.\n' };

test('Escape in the palette over an app page closes the palette, and the page stays until Escape is pressed on it', async () => {
  await withFrame({ files, open: ['/docs/a.md'] }, async (p, { mod }) => {
    await p.evaluate(async () => (await import('/src/frame/hue-test.ts')).openHueTest());
    await p.waitForSelector('.marxy-apppage');
    await p.keyboard.press(`${mod}+Shift+P`);
    await p.waitForFunction(() => document.activeElement?.classList.contains('marxy-palette-query'));
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.activeElement?.classList.contains('marxy-palette-query'));
    assert.ok(await p.evaluate(() => !!document.querySelector('.marxy-apppage')), 'the hue test is still open');
    await p.focus('.marxy-apppage [data-marxy-primary]');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('.marxy-apppage'));
  });
});

test('a character name the shell gives late puts no tip up once Alt is let go', async () => {
  await withFrame({ files, open: ['/docs/a.md'] }, async (p) => {
    await p.waitForFunction(() => document.querySelector('.marxy-article p'));
    await p.evaluate(() => {
      window.__marxyHandle.shell.charName = () => new Promise((resolve) => setTimeout(() => resolve('late name'), 300));
    });
    const at = await p.evaluate(() => {
      const text = document.querySelector('.marxy-article p').firstChild;
      const r = document.createRange();
      r.setStart(text, 1);
      r.setEnd(text, 2);
      const box = r.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await p.mouse.move(at.x, at.y);
    await p.keyboard.down('Alt');
    await p.keyboard.up('Alt');
    await p.waitForTimeout(700);
    assert.equal(await p.evaluate(() => document.querySelectorAll('.marxy-charinfo').length), 0);
    // Held, the late name is shown.
    await p.keyboard.down('Alt');
    await p.waitForFunction(() => document.querySelector('.marxy-charinfo')?.textContent.includes('late name'));
    await p.keyboard.up('Alt');
  });
});
