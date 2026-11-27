// Find and select-all copy on a long page still mounting: both answer for the whole document, not the part of it
// appended so far. Find counts every match in the file from the first key and mounts through a match before it shows
// it; select all then Copy puts the whole document's text on the clipboard, the same text a copy of the finished page
// gives. Booted on the shipped skeleton over the memory shell (test/support/two-pane.mjs), WebKit.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

/** Paragraphs enough for about 2.5 MB; every 50th holds "zephyr" once, and so does the very last. */
function longDocument() {
  const parts = ['# A long page\n'];
  let zephyrs = 0;
  let size = 0;
  for (let i = 0; size < 2_500_000; i++) {
    const word = i % 50 === 7 ? ' A zephyr crossed it.' : '';
    if (word) zephyrs += 1;
    const para = `Paragraph ${i} runs on about the lamps and the river and the long road home, so that the column fills and wraps across several lines.${word}`;
    parts.push(i % 200 === 0 ? `## Part ${i / 200}\n\n${para}` : para);
    size += para.length + 2;
  }
  parts.push('The last paragraph of all: a zephyr at the very end.');
  return { text: parts.join('\n\n') + '\n', zephyrs: zephyrs + 1 };
}

const { text: LONG, zephyrs: ZEPHYRS } = longDocument();
const files = { '/r/long.md': LONG };

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(page, { files, open: ['/r/long.md'] });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, mod);
  } finally {
    await browser.close();
  }
}

/** Whether the article's document still has blocks to append (the page is still mounting). */
const stillMounting = (page) =>
  page.evaluate(async () => {
    const { pendingBlocks } = await import('/src/render/progressive.ts');
    return pendingBlocks(document.getElementById('doc')) !== null;
  });

test('find on a page still mounting counts every match in the file, and the last match is mounted and shown', async () => {
  await withPage(async (page, mod) => {
    assert.ok(await stillMounting(page), 'the page is still mounting when find opens');
    const drawn = await page.evaluate(() => (document.getElementById('doc').textContent.match(/zephyr/g) ?? []).length);
    assert.ok(drawn < ZEPHYRS, `only ${drawn} of ${ZEPHYRS} are drawn yet`);
    await page.keyboard.press(`${mod}+KeyF`);
    await page.keyboard.type('zephyr');
    await page.waitForFunction(
      () => document.querySelector('.marxy-find input')?.value === 'zephyr' && /^\d+ of \d+$/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''),
      null,
      { timeout: 30_000 },
    );
    const count = await page.textContent('.marxy-find-count');
    const mountingAtCount = await stillMounting(page);
    assert.equal(count.split(' of ')[1], String(ZEPHYRS), `the count is the file's: ${count}`);
    assert.ok(mountingAtCount, 'the page was still mounting when the count was read');

    // Shift+Enter from the first match is the last, in the last paragraph: mounted through and shown on screen.
    if (count.startsWith('1 of')) {
      await page.keyboard.press('Shift+Enter');
      await page.waitForFunction((n) => document.querySelector('.marxy-find-count')?.textContent === `${n} of ${n}`, ZEPHYRS, { timeout: 30_000 });
    }
    const last = await page.evaluate(() => {
      const range = [...(CSS.highlights.get('marxy-find-current') ?? [])][0];
      const box = range?.getClientRects()[0];
      return range ? { text: range.toString(), inPage: document.getElementById('doc').contains(range.startContainer), top: box?.top ?? -1, block: range.startContainer.parentElement?.closest('p')?.textContent ?? '', height: innerHeight } : null;
    });
    assert.equal(last?.text, 'zephyr');
    assert.ok(last.inPage, 'the current match is in the page');
    assert.match(last.block, /^The last paragraph of all/);
    assert.ok(last.top >= 0 && last.top < last.height, `the last match is on screen: top ${last.top}`);
  });
});

test('select all then Copy on a page still mounting copies the whole document, as a copy of the finished page does', async () => {
  await withPage(async (page, mod) => {
    const writes = () => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length);
    const copyAll = async () => {
      const n = (await writes()) + 1;
      await page.locator('#doc p').first().click();
      await page.keyboard.press(`${mod}+KeyA`);
      await page.keyboard.press(`${mod}+KeyC`);
      return page.waitForFunction((n) => {
        const writes = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem');
        if (writes.length < n) return null;
        const plain = writes[n - 1].args[0].find((r) => /plain/.test(r.type));
        return new TextDecoder().decode(plain.bytes);
      }, n, { timeout: 30_000 }).then((h) => h.jsonValue());
    };
    assert.ok(await stillMounting(page), 'the page is still mounting at the copy');
    const drawnChars = await page.evaluate(() => document.getElementById('doc').textContent.length);
    const early = await copyAll();
    assert.ok(early.length > drawnChars, `the copy (${early.length} characters) holds more than was drawn (${drawnChars})`);
    assert.ok(/a\szephyr\sat\sthe\svery\send\.$/.test(early.trimEnd()), `the copy ends with the document: ${JSON.stringify(early.slice(-120))} (${early.length})`);

    // The rest appended now, at once (waiting for the idle slices to finish a page this long takes minutes under load).
    await page.evaluate((end) => window.__marxyHandle.mountThrough(end), Buffer.byteLength(LONG));
    assert.equal(await stillMounting(page), false);
    const whole = await copyAll();
    assert.equal(early.length, whole.length, 'the same length as a copy of the finished page');
    assert.ok(early === whole, 'the same text as a copy of the finished page');
  });
});
