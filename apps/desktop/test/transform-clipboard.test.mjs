// J-06: `Transform clipboard: <name>` in the palette reads the pasteboard on that command (types first; a concealed item is
// refused and nothing is read), runs the transform on its text and opens W-21's sheet with the clipboard as the input.
// Return writes the result back as one plain-text item; Esc writes nothing. The real app over the memory shell, in WebKit,
// with real keys (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { TRANSFORMS, runTransform } from '../../../packages/core/src/index.ts';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const TEXT = 'public.utf8-plain-text';
const HTML = 'public.html';
const PNG = 'public.png';
const CONCEALED = 'org.nspasteboard.ConcealedType';
const TRANSIENT = 'org.nspasteboard.TransientType';
const A = '/r/doc.md';
const DOC = '# Doc\n\nbody\n';
const LIST = 'pear\napple\nmango\n';

async function withApp(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(page, { files: { [A]: DOC }, open: [A], guard: true });
    await page.evaluate(async (initialPath) => {
      const { mountPaletteFromHandle } = await import('/src/palette/view.ts');
      const handle = window.__marxyHandle;
      const palette = mountPaletteFromHandle(handle, { initialPath });
      handle.setPaletteSession(() => palette.session);
    }, A);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const api = {
      mod,
      pasteboard: (...items) =>
        page.evaluate((items) => {
          const enc = new TextEncoder();
          const shell = window.__marxyHandle.shell;
          shell.setPasteboard(items.map((i) => Object.fromEntries(Object.entries(i).map(([t, s]) => [t, typeof s === 'string' ? enc.encode(s) : Uint8Array.from(s)]))));
          shell.calls.length = 0;
        }, items),
      /** Pasteboard traffic since `pasteboard()`: the calls the shell saw, the data reads, the native writes and the last item's text. */
      traffic: () =>
        page.evaluate(() => {
          const shell = window.__marxyHandle.shell;
          const items = shell.calls.filter((c) => c.method === 'clipboardWriteItem');
          const rep = items.at(-1)?.args[0].find((r) => r.type === 'public.utf8-plain-text');
          return {
            types: shell.calls.filter((c) => c.method === 'clipboardTypes').length,
            reads: shell.calls.filter((c) => c.method === 'clipboardRead').length,
            dataReads: [...shell.pasteboardDataReads],
            writes: items.length,
            reps: items.at(-1) ? items.at(-1).args[0].map((r) => r.type) : [],
            text: rep ? new TextDecoder().decode(rep.bytes) : null,
          };
        }),
      state: () => page.evaluate(() => ({ version: window.__marxyHandle.document().snapshot().version, paths: window.__marxyHandle.panes().panes.map((p) => p.path()) })),
      notices: () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent)),
      run: async (name) => {
        await page.keyboard.press(`${mod}+Shift+KeyP`);
        await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
        await page.locator('#marxy-palette .marxy-palette-query').fill(`>Transform clipboard: ${name}`);
        await page.waitForFunction((name) => document.querySelector('#marxy-palette .marxy-palette-row .marxy-palette-title')?.textContent === `Transform clipboard: ${name}`, name);
        await page.keyboard.press('Enter');
      },
      sheet: () =>
        page.evaluate(() => {
          const d = document.getElementById('marxy-transform');
          if (!d?.open) return null;
          const [before, after] = [...d.querySelectorAll('.marxy-transform-text')].map((p) => p.textContent);
          return {
            title: d.querySelector('.marxy-transform-title').textContent,
            before, after,
            buttons: [...d.querySelectorAll('.marxy-transform-actions button')].map((b) => b.firstChild.textContent),
            focus: document.activeElement?.id,
          };
        }),
      sheetUp: () => page.waitForSelector('#marxy-transform[open]'),
      sheetGone: () => page.waitForFunction(() => !document.getElementById('marxy-transform')?.open),
      noticeWith: (text) => page.waitForFunction((t) => [...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent.includes(t)), text),
      settle: () => page.evaluate(() => new Promise((r) => setTimeout(r, 250))),
    };
    await fn(page, api);
  } finally {
    await browser.close();
  }
}

test('there is a Transform clipboard command per runnable transform, and the pasteboard is not touched until one runs', async () => {
  await withApp(async (page, s) => {
    await s.pasteboard({ [TEXT]: LIST });
    const ids = await page.evaluate(async () => (await import('/src/commands/index.ts')).commands().filter((c) => c.title.startsWith('Transform clipboard: ')).map((c) => c.title));
    assert.deepEqual(ids, TRANSFORMS.map((t) => `Transform clipboard: ${t.name}`));
    // Listing the palette, typing in it, focus changes and a copy elsewhere.
    await page.keyboard.press(`${s.mod}+Shift+KeyP`);
    await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
    await page.locator('#marxy-palette .marxy-palette-query').fill('>Transform clipboard');
    await s.settle();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    const traffic = await s.traffic();
    assert.equal(traffic.types, 0);
    assert.equal(traffic.reads, 0);
    assert.deepEqual(traffic.dataReads, []);
  });
});

test('Sort lines on the clipboard: the sheet shows Before and After, Return writes one plain-text item that is After, and the document is untouched', async () => {
  await withApp(async (page, s) => {
    await s.pasteboard({ [TEXT]: LIST, [HTML]: '<p>kept?</p>' });
    const before = await s.state();
    await s.run('Sort lines');
    await s.sheetUp();
    const want = runTransform('sort', LIST);
    assert.notEqual(want, LIST);
    const sheet = await s.sheet();
    assert.equal(sheet.title, 'Transform the clipboard');
    assert.equal(sheet.before, LIST);
    assert.equal(sheet.after, want);
    assert.deepEqual(sheet.buttons, ['Open as new document', 'Add another step', 'Write back'], 'Apply is not offered');
    assert.equal(sheet.focus, 'marxy-transform-copy');
    let traffic = await s.traffic();
    assert.deepEqual([traffic.types, traffic.reads, traffic.writes], [1, 1, 0], 'one pair of reads (text only), nothing written yet');
    assert.deepEqual(traffic.dataReads, [TEXT]);
    await page.keyboard.press(`${s.mod}+Enter`);
    await s.settle();
    assert.ok((await s.sheet()) !== null, 'Mod+Return (Apply) does nothing on the clipboard');
    await page.keyboard.press('Enter');
    await s.sheetGone();
    traffic = await s.traffic();
    assert.equal(traffic.writes, 1, 'one item');
    assert.deepEqual(traffic.reps, [TEXT], 'plain text only');
    assert.equal(traffic.text, want);
    assert.deepEqual([traffic.types, traffic.reads], [1, 1], 'writing back reads nothing more');
    await s.noticeWith('Clipboard transformed: Sort lines');
    assert.deepEqual(await s.state(), before, 'the store version and the scratch count are unchanged');
  });
});

test('Esc writes nothing and the clipboard is as it was', async () => {
  await withApp(async (page, s) => {
    await s.pasteboard({ [TEXT]: LIST });
    await s.run('Sort lines');
    await s.sheetUp();
    await page.keyboard.press('Escape');
    await s.sheetGone();
    const traffic = await s.traffic();
    assert.equal(traffic.writes, 0);
    assert.equal(await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.shell.lastPasteboardWrite?.['public.utf8-plain-text'] ?? new Uint8Array())), '');
  });
});

test('an item with HTML and no text is transformed as the Markdown the paste would make', async () => {
  await withApp(async (page, s) => {
    await s.pasteboard({ [HTML]: '<h1>Notes</h1><ul><li>b</li><li>a</li></ul>' });
    const md = await page.evaluate(async () => (await import('/src/paste/read-clipboard.ts')).convertClipboard({ html: '<h1>Notes</h1><ul><li>b</li><li>a</li></ul>' }).markdown);
    assert.ok(md !== '');
    await s.run('Sort lines');
    await s.sheetUp();
    assert.equal((await s.sheet()).before, md);
    assert.deepEqual((await s.traffic()).dataReads, [HTML]);
  });
});

test('a concealed item: a notice, no data read, no sheet; a transient item is read as any other', async () => {
  await withApp(async (page, s) => {
    await s.pasteboard({ [TEXT]: 'secret', [CONCEALED]: '' });
    await s.run('Sort lines');
    await s.noticeWith('concealed');
    await s.settle();
    const traffic = await s.traffic();
    assert.deepEqual(traffic.dataReads, [], 'pasteboardDataReads is empty');
    assert.equal(traffic.reads, 0);
    assert.equal(await s.sheet(), null);
    await s.pasteboard({ [TEXT]: LIST, [TRANSIENT]: '' });
    await s.run('Sort lines');
    await s.sheetUp();
    assert.equal((await s.sheet()).before, LIST);
  });
});

test('an empty clipboard says so; an image-only clipboard is refused by name; neither opens a sheet or writes', async () => {
  await withApp(async (page, s) => {
    const before = await s.state();
    await s.pasteboard({});
    await s.run('Sort lines');
    await s.noticeWith('Nothing on the clipboard to transform');
    await s.pasteboard({ [PNG]: [137, 80, 78, 71] });
    await s.run('Sort lines');
    await s.noticeWith('holds an image');
    assert.equal(await s.sheet(), null);
    const traffic = await s.traffic();
    assert.equal(traffic.writes, 0);
    assert.deepEqual(traffic.dataReads, [], 'the image was never read');
    assert.deepEqual(await s.state(), before);
  });
});

test('text that is not valid UTF-8 is refused with its message, not read lossily', async () => {
  await withApp(async (page, s) => {
    await s.pasteboard({ [TEXT]: [0x61, 0xff, 0x62] });
    await s.run('Sort lines');
    await s.noticeWith('not valid UTF-8');
    assert.equal(await s.sheet(), null);
    assert.equal((await s.traffic()).writes, 0);
  });
});

test('Add another step and Open as new document work on the clipboard; opening writes nothing to the clipboard', async () => {
  await withApp(async (page, s) => {
    await s.pasteboard({ [TEXT]: 'b\na\nb\n' });
    await s.run('Sort lines');
    await s.sheetUp();
    await page.locator('#marxy-transform-more').click();
    await page.locator('#marxy-transform-filter').fill('Remove duplicate');
    await page.keyboard.press('Enter');
    const want = runTransform('dedupe', runTransform('sort', 'b\na\nb\n'));
    const sheet = await s.sheet();
    assert.equal(sheet.after, want);
    await page.locator('#marxy-transform-open').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.some((p) => p.path() === 'untitled'));
    assert.equal((await s.traffic()).writes, 0);
  });
});
