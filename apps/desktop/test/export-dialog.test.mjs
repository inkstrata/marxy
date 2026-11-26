// File › Export…: the command opens the Export panel on the file in front with a
// web page chosen, each form shows only its options, Save… writes through the system's save dialog to where you choose
// and never over an open file, and looking writes nothing. The dialog this file once tested is retired; the panel is
// not modal, so the page's own chords stay the page's. The memory shell's save dialog answers with what the test queued.
// Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { fileText, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PLAN = '/r/plan.md';
const TEXT = '# The plan\n\nFirst we *read* the file, then we write it out.\n\n## Steps\n\n- One\n- Two\n';
const FILES = { [PLAN]: TEXT, '/r/other.md': '# Other\n\nOpen beside.\n' };

const openExport = async (page) => {
  await page.evaluate(async () => {
    const command = window.__marxyHandle.commands().find((c) => c.id === 'document.export');
    // Export's command reads nothing from its context.
    await command.run({});
  });
  await page.waitForSelector('.marxy-drawer .marxy-l-body[data-marxy-left="export"] [data-marxy-left-row="a:html"]');
};
const choose = (page, id) => page.click(`.marxy-drawer [data-marxy-left-row="a:${id}"] .marxy-l-nm`);
const chosen = (page) => page.evaluate(() => document.querySelector('.marxy-drawer [data-marxy-left-row^="a:"] .marxy-l-rd.marxy-l-on')?.closest('[data-marxy-left-row]').dataset.marxyLeftRow.slice(2));
const primary = (page) => page.textContent('.marxy-drawer .marxy-l-btns .marxy-l-pri');
const look = (page) => page.isVisible('.marxy-drawer [data-marxy-left-row="s:look"]');
const notices = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));
const writes = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic').map((c) => c.args[0]));

test('Export is a panel beside the page: it follows the file in front, and the page keeps its chords', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/other.md'));
    await page.evaluate(() => window.__marxyHandle.open('/r/plan.md'));
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/r/plan.md');
    await openExport(page);
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-subject'), 'plan.md');
    await page.evaluate(() => window.__marxyHandle.open('/r/other.md'));
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'other.md');
    assert.equal(await page.isVisible('.marxy-export[role="dialog"]'), false, 'no dialog over the page');
  });
});

test('Export opens on the file in front with a web page chosen, and each form shows only its options', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await openExport(page);
    const forms = await page.$$eval('.marxy-drawer [data-marxy-left-row^="a:"] .marxy-l-nm', (els) => els.map((e) => e.textContent));
    assert.deepEqual(forms, ['A web page', 'A PDF', 'Markdown, as written', 'Plain text']);
    assert.equal(await chosen(page), 'html');
    assert.equal(await primary(page), 'Save the page…');
    assert.equal(await look(page), true, 'a page has its look');

    await choose(page, 'raw');
    assert.equal(await primary(page), 'Save plan.md…');
    assert.equal(await look(page), false, 'the bytes have no look');

    await choose(page, 'pdf');
    assert.equal(await primary(page), 'Print to a PDF…');
    assert.equal(await page.isVisible('.marxy-drawer [data-marxy-left-row="s:paper"]'), true, 'a PDF has its paper');
    assert.match(await page.textContent('.marxy-drawer .marxy-l-hint'), /system’s print/);

    await choose(page, 'text');
    await page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/out/plan.txt'));
    await page.click('.marxy-drawer .marxy-l-btns .marxy-l-pri');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'writeFileAtomic' && c.args[0] === '/out/plan.txt'));
    const plain = await fileText(page, '/out/plan.txt');
    assert.match(plain, /^The plan\n/);
    assert.match(plain, /First we read the file/);
    assert.doesNotMatch(plain, /[#*]/);
    assert.deepEqual((await writes(page)).filter((p) => !p.startsWith('/data/') && p !== '/out/plan.txt'), [], 'choosing writes nothing');
  });
});

test('Save… writes where the save dialog says, as HTML or as the file\'s own bytes, and never over an open file', async () => {
  await withFrame({ files: FILES, open: [PLAN, '/r/other.md'] }, async (page) => {
    await page.click('[data-marxy-head="0"] .marxy-rs-read');
    await openExport(page);
    // Cancelled in the save dialog: nothing is written.
    await page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog(null));
    await page.click('.marxy-drawer .marxy-l-btns .marxy-l-pri');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'saveDialog'));
    assert.deepEqual(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'saveDialog').at(-1).args[0]), { defaultPath: '/r/plan.html' });
    // Onto a file open in either pane: refused, and said.
    for (const open of [PLAN, '/r/other.md']) {
      await page.evaluate((p) => window.__marxyHandle.shell.queueSaveDialog(p), open);
      await page.click('.marxy-drawer .marxy-l-btns .marxy-l-pri');
      const name = open.slice(open.lastIndexOf('/') + 1);
      await page.waitForFunction((n) => [...document.querySelectorAll('.marxy-notice-text')].some((t) => t.textContent.startsWith(`${n} is open here`)), name);
    }
    assert.equal(await fileText(page, PLAN), TEXT);
    assert.deepEqual((await writes(page)).filter((p) => p.startsWith('/r/')), []);

    await page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/out/plan.html'));
    await page.click('.marxy-drawer .marxy-l-btns .marxy-l-pri');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'writeFileAtomic' && c.args[0] === '/out/plan.html'));
    const html = await fileText(page, '/out/plan.html');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /The plan/);
    assert.ok((await notices(page)).some((t) => t.startsWith('Exported plan.html to /out')));

    await choose(page, 'raw');
    await page.evaluate(() => window.__marxyHandle.shell.queueSaveDialog('/out/plan copy.md'));
    await page.click('.marxy-drawer .marxy-l-btns .marxy-l-pri');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'writeFileAtomic' && c.args[0] === '/out/plan copy.md'));
    assert.equal(await fileText(page, '/out/plan copy.md'), TEXT);
  });
});
