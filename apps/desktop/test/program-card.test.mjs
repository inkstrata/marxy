// A Windows program's file card: what the file claims (product, version, company, description, target, build time,
// signature), each marked as its own claim, read by range; the open button stays off and nothing is started, loaded,
// verified or fetched. A damaged program gives its reason; a text file under a program's name is no program. The
// shortcut card shares the same slot.
// The samples are built by fixtures/programs/make-programs.mjs. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, showCardPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const programs = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'programs');
const NAMES = ['tidemark-setup.exe', 'tidemark64.exe', 'tidemark-arm64.exe', 'plain.dll', 'cyclic.exe', 'truncated.exe'];
const FILES = {
  '/r/README.md': '# Here\n',
  ...Object.fromEntries(NAMES.map((n) => [`/r/bin/${n}`, readFileSync(join(programs, n))])),
  '/r/bin/tidemark': readFileSync(join(programs, 'tidemark-setup.exe')),
  '/r/bin/notes.exe': 'Someone renamed these notes to an .exe.\nThey are still text.\n',
  '/r/bin/Registry Editor.lnk': readFileSync(join(programs, '..', 'demo', 'shortcuts', 'Registry Editor.lnk')),
  '/r/bin/noise.ocx': Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 37 + 11) & 0xff)),
};

const open = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.waitForFunction((name) => document.querySelector('.marxy-fcard-name')?.textContent === name, path.slice(path.lastIndexOf('/') + 1));
};
const rows = (page) =>
  page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.marxy-fcard .marxy-fact')].map((e) => [e.children[0].textContent, e.children[1].innerText])));

test('a signed installer says what it claims and that its signature is present, not verified; nothing starts it', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    const origin = new URL(page.url()).origin;
    await open(page, '/r/bin/tidemark-setup.exe');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'A Windows program');
    const r = await rows(page);
    assert.equal(r.product, 'Tidemark\nthe file’s own claim');
    assert.equal(r.version, '2.4.1\nthe file’s own claim');
    assert.equal(r.company, 'Tidemark Harbour Works\nthe file’s own claim');
    assert.equal(r.description, 'Tide table setup\nthe file’s own claim');
    assert.match(r['built for'], /^x86, 32-bit · a window program\nthe file’s own claim, from its header$/);
    assert.match(r.built, /^14 Mar 2026, \d\d:\d\d\nthe file’s own claim/);
    assert.match(r.signature, /^Signature present, not verified\n/);
    assert.equal(r.kind, 'a Windows program or library');
    // The button that would start it stays off; the card says the app never starts, loads or verifies it.
    assert.equal(await page.isDisabled('.marxy-fcard-acts button:has-text("Open in default app")'), true);
    assert.match(await page.innerText('.marxy-fcard-note'), /never starts, loads or verifies it/);
    await showCardPanel(page, 'reading');
    assert.match(await cardText(page, 'reading'), /Shown as a Windows program · a file card and the bytes/);
    const calls = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.args[0] === '/r/bin/tidemark-setup.exe').map((c) => c.method));
    assert.ok(calls.includes('readRange'), 'read by range');
    assert.ok(!calls.includes('readFile'), 'never read whole');
    assert.ok(!calls.some((m) => /open|reveal|exec|spawn|run/i.test(m)), calls.join());
    assert.deepEqual(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')), [], 'the page makes no request');
  });
});

test('an unsigned library says no signature; 32-bit, 64-bit and ARM64 each name their target', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/bin/plain.dll');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'A Windows library');
    let r = await rows(page);
    assert.match(r.signature, /^No signature\n/);
    assert.equal(r.version, 'none: it carries no version resource');
    assert.equal(await page.isDisabled('.marxy-fcard-acts button:has-text("Open in default app")'), true);
    await open(page, '/r/bin/tidemark64.exe');
    r = await rows(page);
    assert.match(r['built for'], /^x64, 64-bit · a console program\n/);
    await open(page, '/r/bin/tidemark-arm64.exe');
    r = await rows(page);
    assert.match(r['built for'], /^ARM64, 64-bit · a window program\n/);
    assert.equal(r.built, undefined, 'a zero stamp is no build time');
  });
});

test('a cyclic resource tree and a truncated file give a damaged reason and keep the header facts', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/bin/cyclic.exe');
    let r = await rows(page);
    assert.equal(r.damaged, 'Its resource tree loops back on itself.');
    assert.match(r['built for'], /^x64, 64-bit/);
    await open(page, '/r/bin/truncated.exe');
    r = await rows(page);
    assert.match(r.damaged, /the file is cut short\.$/);
  });
});

test('a renamed text file called .exe is no program, and bytes that are not one fall to the plain file card', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/bin/notes.exe'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/bin/notes.exe');
    await page.waitForFunction(() => document.body.innerText.includes('They are still text.'));
    assert.equal(await page.$('.marxy-fcard-kicker:has-text("A Windows")'), null);
    await open(page, '/r/bin/noise.ocx');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'No reading for this file');
    const r = await rows(page);
    assert.equal(r.product, undefined);
    assert.equal(r.signature, undefined);
    assert.equal(await page.isDisabled('.marxy-fcard-acts button:has-text("Open in default app")'), true);
  });
});

test('the shortcut card shares the slot: what it points at, above its own facts', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/bin/Registry Editor.lnk');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'A Windows shortcut');
    assert.match((await rows(page))['points at'], /regedit\.exe/i);
    assert.match(await page.innerText('.marxy-fcard-note'), /never follows it/);
  });
});

test('a program with no extension is found by its MZ head and the open button stays off', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/bin/tidemark');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'A Windows program');
    assert.equal((await rows(page)).product, 'Tidemark\nthe file’s own claim');
    assert.equal(await page.isDisabled('.marxy-fcard-acts button:has-text("Open in default app")'), true);
    await page.click('.marxy-fcard-acts button:has-text("Open in default app")', { force: true });
    const calls = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.args[0] === '/r/bin/tidemark').map((c) => c.method));
    assert.ok(!calls.some((m) => /open|exec|spawn|run/i.test(m)), calls.join());
  });
});
