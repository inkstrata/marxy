// A data tree too big to draw whole: soundings.json
// draws its first 5,000 values and stops between items with how many more there are and the line where Source has them;
// Go on in Source lands on that line; Draw from here redraws the tree from that item with a crumb back to the top, held
// by the tab and never written; the Keys card draws from any key; the head says the tier in grey and the Reading card
// lists the four; a JSON past 2 MB opens this way, not as written. Playwright WebKit, the whole frame.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { howText, panelRows, panelSecs, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const SOUNDINGS = readFileSync(new URL('../../../fixtures/demo/data/soundings.json', import.meta.url));
const soundingsText = SOUNDINGS.toString('utf8');
/** soundings.json past 2 MB: a long note before `notes`, the rest as it was. */
const BIG = Buffer.from(soundingsText.replace('"notes"', `"pad": "${'x'.repeat(700_000)}",\n  "notes"`));
const FILES = { '/r/README.md': '# Here\n', '/r/soundings.json': SOUNDINGS, '/r/big.json': BIG };

const lineOf = (bytes, at) => {
  let line = 1;
  for (let i = 0; i < at; i++) if (bytes[i] === 0x0a) line++;
  return line;
};
const ready = (page) => page.waitForSelector('.marxy-article [data-marxy-reading="tree"] .marxy-tree-stop');
const stopWords = (page) => page.$$eval('.marxy-article .marxy-tree-stop p', (ps) => ps.map((p) => p.textContent));
const crumb = (page) => page.evaluate(() => document.querySelector('.marxy-article .marxy-tree-crumb')?.textContent ?? null);
const indices = (page) => page.$$eval('.marxy-article .marxy-tree-index', (els) => els.map((e) => Number(e.textContent)));
const headSays = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('[data-marxy-head="0"] .marxy-guess');
    return g && !g.hidden ? { text: g.textContent, tier: g.hasAttribute('data-marxy-tier') } : null;
  });
const keysRows = async (page) => (await panelRows(page, 'outline')).map((r) => `${r.name} ${r.as}`.trim());

test('soundings.json draws its first 5,000 values: the stop lines, the keys not reached, the head, the Reading and Keys cards', async () => {
  await withFrame({ files: FILES, open: ['/r/soundings.json'] }, async (page) => {
    await ready(page);
    assert.deepEqual(await stopWords(page), [
      '1 more key here, not drawn. The tree draws the first 5,000 values; Source has the rest, from line 5,692.',
      '8,415 more items here, not drawn. The tree draws the first 5,000 values; Source has the rest, from line 5,694.',
    ]);
    assert.deepEqual(await page.$$eval('.marxy-article .marxy-tree-stop button', (bs) => bs.map((b) => b.textContent)), [
      'Go on in Source, at line 5,692',
      'Draw from here',
      'Go on in Source, at line 5,694',
      'Draw from here',
    ]);
    assert.deepEqual(await page.$$eval('.marxy-article .marxy-tree-undrawn', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim())), ['notes not drawn · draw from here']);
    assert.equal(await page.textContent('.marxy-article .marxy-reading-head'), 'JSON · 4 keys at the top · the first 5,000 of 73,519 values drawn; Source has the rest');
    assert.match(await page.textContent('.marxy-article .marxy-tree > .marxy-account .marxy-account-body'), /Find in the page searches what is drawn; find in Source searches everything\.$/);
    assert.deepEqual(await headSays(page), { text: 'The first 5,000 values', tier: true });
    await showPanel(page, 'metadata');
    const tiers = await page.$$eval('.marxy-drawer .marxy-l-how .marxy-tiers li', (els) => els.map((e) => `${e.querySelector('b').textContent}${e.hasAttribute('data-marxy-here') ? '*' : ''}`));
    assert.deepEqual(tiers, ['The whole tree', 'The first 5,000 values*', 'As written', 'The bytes']);
    assert.match(await howText(page), /73,519 values in all\. Draw from here starts the tree at any part; Source has every line\./);
    // The Keys card is Outline's Keys section now, its detail the section's note.
    const keys = (await panelSecs(page, 'outline'))[0];
    assert.equal(keys[0], 'Keys');
    assert.match(keys[1], /^draw from any/);
    assert.deepEqual(await keysRows(page), ['survey 6 keys · line 2', 'stations 40 items · line 14', 'soundings 9,000 items · line 296', 'notes line 83,646']);
  });
});

test('Go on in Source opens Source at the line where the rest of the list is', async () => {
  await withFrame({ files: FILES, open: ['/r/soundings.json'] }, async (page) => {
    await ready(page);
    await page.click('.marxy-article .marxy-tree-stop >> nth=1 >> button:has-text("Go on in Source")');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source' && document.querySelector('.cm-line'));
    await page.waitForTimeout(300);
    const at = await page.evaluate(() => window.__marxyHandle.panes().focused.view.position().byteOffset);
    assert.equal(lineOf(SOUNDINGS, at), 5694);
    assert.equal(await headSays(page).then((h) => h?.text ?? null), null, 'Source of a file under 2 MB is coloured, and says no tier');
  });
});

test('Draw from here draws the tree from that item, with a crumb back to the top, and the tab alone holds where', async () => {
  await withFrame({ files: FILES, open: ['/r/soundings.json'] }, async (page) => {
    await ready(page);
    const writesBefore = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFile').length);
    await page.click('.marxy-article .marxy-tree-stop >> nth=1 >> button:has-text("Draw from here")');
    await page.waitForFunction(() => document.querySelector('.marxy-article .marxy-tree-crumb'));
    assert.equal(await crumb(page), 'soundings.json › soundings › from item 585');
    const shown = await indices(page);
    assert.equal(shown[0], 585, 'the first item drawn is the one the stop was before');
    assert.ok(!shown.includes(584));
    assert.equal(await page.textContent('.marxy-article .marxy-reading-head'), 'JSON · 4 keys at the top · 5,000 of 73,519 values drawn from here; Source has the rest');
    assert.match((await stopWords(page)).at(-1), /^[\d,]+ more items here, not drawn\./, 'again 5,000 values at most');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-article .marxy-tree-crumb').getBoundingClientRect().top < innerHeight), true, 'the page shows its top');
    assert.deepEqual(await headSays(page), { text: 'The first 5,000 values', tier: true });
    // Nothing is written of where the tree is drawn from (the fence).
    const writes = await page.evaluate((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFile').slice(n).map((c) => `${c.args[0]} ${typeof c.args[1] === 'string' ? c.args[1] : new TextDecoder().decode(new Uint8Array(Object.values(c.args[1] ?? {})))}`), writesBefore);
    assert.ok(writes.every((w) => !/585|treeFrom|tree-from/.test(w)), writes.join('\n'));
    // The crumb's file name leads back to the top.
    await page.click('.marxy-article .marxy-tree-crumb button');
    await page.waitForFunction(() => !document.querySelector('.marxy-article .marxy-tree-crumb'));
    assert.equal((await indices(page))[0], 0);
    assert.equal((await stopWords(page)).length, 2);
  });
});

test('the Keys card draws the tree from a key; a key not reached draws from itself', async () => {
  await withFrame({ files: FILES, open: ['/r/soundings.json'] }, async (page) => {
    await ready(page);
    await showPanel(page, 'outline');
    await page.click('.marxy-drawer .marxy-l-prow:has-text("soundings")');
    await page.waitForFunction(() => document.querySelector('.marxy-article .marxy-tree-crumb')?.textContent === 'soundings.json › soundings');
    assert.match(await page.textContent('.marxy-article .marxy-tree > details > summary'), /^soundings \[ \] 9,000 items$/);
    assert.equal((await indices(page))[0], 0);
    await page.click('.marxy-article .marxy-tree-crumb button');
    await page.waitForFunction(() => !document.querySelector('.marxy-article .marxy-tree-crumb'));
    await page.click('.marxy-article .marxy-tree-undrawn button');
    await page.waitForFunction(() => document.querySelector('.marxy-article .marxy-tree-crumb')?.textContent === 'soundings.json › notes');
    assert.match(await page.textContent('.marxy-article .marxy-tree > .marxy-tree-leaf'), /^notes “Constructed data/);
  });
});

test('a JSON past 2 MB opens as the first 5,000 values as a tree, not as written', async () => {
  assert.ok(BIG.length > 2 * 1024 * 1024);
  await withFrame({ files: FILES, open: ['/r/big.json'] }, async (page) => {
    await ready(page);
    assert.deepEqual(await headSays(page), { text: 'The first 5,000 values', tier: true });
    assert.equal(await page.textContent('.marxy-article .marxy-reading-head'), 'JSON · 5 keys at the top · the first 5,000 of 73,520 values drawn; Source has the rest');
    assert.deepEqual((await stopWords(page)).map((w) => w.split('.')[0]), ['1 more key here, not drawn', '8,415 more items here, not drawn']);
    // Source is the bytes as ever, in its own tier past 2 MB.
    await page.click('.marxy-article .marxy-tree-stop >> nth=1 >> button:has-text("Go on in Source")');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source' && document.querySelector('.cm-line'));
    await page.waitForTimeout(300);
    assert.equal(lineOf(BIG, await page.evaluate(() => window.__marxyHandle.panes().focused.view.position().byteOffset)), 5694);
    assert.deepEqual(await headSays(page), { text: 'Plain text · no colour past 2 MB', tier: true });
  });
});
