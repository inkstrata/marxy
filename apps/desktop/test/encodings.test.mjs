// Text in another encoding: UTF-16 found from its BOM is a fact, said in
// Facts and the Reading card with the head quiet; Windows-1252 with no BOM is a guess, blue in the head, the card naming
// the byte that ruled out UTF-8; Read with encoding... reads the same bytes each way, and a choice re-reads the file, is
// said as yours, is kept in readings.json across a reopen and a relaunch, and the way back is offered. The bytes never
// change; a save writes the file's own encoding, or is refused. The samples are the demo's (fixtures/demo/encodings),
// decoded by the memory shell's port of the Rust module (core encoding/decode.ts). WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, howText, panelKvs, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'encodings');
const UTF16 = readFileSync(join(demo, 'tide-notes-utf16.txt'));
const CP1252 = readFileSync(join(demo, 'harbourmaster-1998.txt'));
const FILES = {
  '/r/README.md': '# Here\n',
  '/r/tide-notes-utf16.txt': UTF16,
  '/r/harbourmaster-1998.txt': CP1252,
};
const NOTE = '/r/harbourmaster-1998.txt';

/** Metadata's The file, as the Facts card's two rows were: its bytes, and its size as stored. */
const factsOf = async (page) => {
  const kv = await panelKvs(page, 'metadata');
  return { bytes: kv.Bytes, size: kv.Size };
};
/** The head's encoding mark: hidden, or its words and whether it is said as the reader's. */
const encodingMark = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('[data-marxy-head="0"] .marxy-guess-encoding');
    return !b || b.hidden ? null : { text: b.textContent, mine: b.hasAttribute('data-marxy-mine') };
  });
const articleText = (page) => page.evaluate(() => document.querySelector('#doc')?.innerText ?? '');
const bytesOf = (page, path) => page.evaluate(async (p) => [...(await window.__marxyHandle.shell.readFile(p))], path);
const readings = (page) =>
  page.evaluate(async () => {
    try {
      return JSON.parse(new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/data/readings.json')));
    } catch {
      return null;
    }
  });
const rows = (page) =>
  page.$$eval('.marxy-enc-way', (bs) =>
    bs.map((b) => ({
      label: b.value,
      name: b.querySelector('.marxy-enc-name > span').textContent,
      guess: b.querySelector('.marxy-enc-name > span').classList.contains('marxy-guessed'),
      sub: b.querySelector('.marxy-enc-name small')?.textContent ?? '',
      sample: b.querySelector('.marxy-enc-sample').textContent,
      on: b.getAttribute('aria-checked') === 'true',
    })),
  );
/** Polls `fn` (async: `waitForFunction` would not wait on its promise) until it is true, for up to 10 s. */
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail('waited 10 s');
}
const waitForMark = (page, text) =>
  page.waitForFunction((t) => {
    const b = document.querySelector('[data-marxy-head="0"] .marxy-guess-encoding');
    return t === null ? !b || b.hidden : b && !b.hidden && b.textContent === t;
  }, text);

test('UTF-16 found from its BOM reads right, is said in Facts and the Reading card, and the head is quiet', async () => {
  await withFrame({ files: FILES, open: ['/r/tide-notes-utf16.txt'] }, async (page) => {
    await page.waitForFunction(() => document.body.innerText.includes('Θάλασσα'));
    const text = await articleText(page);
    for (const word of ['Θάλασσα', 'Ærø', '½', 'Field notes']) assert.ok(text.includes(word), word);
    assert.equal(await encodingMark(page), null, 'a BOM is not a guess');
    const facts = await factsOf(page);
    assert.equal(facts.bytes, 'UTF-16 LE · CRLF · a BOM');
    assert.match(facts.size, /^2,736 bytes · /, 'its size as stored on disk');
    const card = await howText(page);
    assert.match(card, /Encoding\n+UTF-16 LE · found: its byte-order mark · why\?/);
    await page.click('.marxy-drawer .marxy-encoding button:text-is("why?")');
    assert.match(await howText(page), /It starts FF FE, the byte-order mark of UTF-16, little-endian/);
    // Source names the file's bytes: the first character is the byte after the BOM.
    await page.click('[data-marxy-head="0"] .marxy-rs-source');
    await page.waitForSelector('[data-marxy-pane="0"] .cm-content');
    await page.waitForFunction(() => /· byte 2$/.test(document.querySelector('.marxy-source-readout')?.textContent ?? ''));
    assert.match(await page.textContent('.marxy-source-readout'), /^Ln 1, Col 1 · byte 2$/);
  });
});

test('Windows-1252 with no BOM is guessed: blue in the head, the byte that ruled out UTF-8 named in the card', async () => {
  await withFrame({ files: FILES, open: [NOTE] }, async (page) => {
    await page.waitForFunction(() => document.body.innerText.includes('HARBOUR MASTER'));
    assert.ok((await articleText(page)).includes('OFFICE — NOTE TO MASTERS AND PILOTS'));
    assert.ok((await articleText(page)).includes('café clock'));
    await waitForMark(page, 'Windows-1252 · guessed');
    assert.deepEqual(await encodingMark(page), { text: 'Windows-1252 · guessed', mine: false });
    // Alone in the head: the reading's own guess is said only in the Reading card.
    assert.equal(await page.isVisible('[data-marxy-head="0"] .marxy-guess:not(.marxy-guess-encoding)'), false);
    const blue = await page.$eval('[data-marxy-head="0"] .marxy-guess-encoding', (b) => getComputedStyle(b).color);
    const accent = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'marxy-guessed';
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    assert.equal(blue, accent, 'the guess is in the accent, as every guess is');
    assert.equal((await factsOf(page)).bytes, 'Windows-1252 · CRLF · no BOM');
    assert.match(await howText(page), /Windows-1252 · guessed: no BOM, and not UTF-8 · why\?/);
    await page.click('.marxy-drawer .marxy-encoding button:text-is("why?")');
    const card = await howText(page);
    assert.match(card, /It is not UTF-8: the byte 97 at offset 24 \(line 1, column 25\) cannot start a UTF-8 character, and no BOM says otherwise\./);
    assert.match(card, /Its 25 bytes above 7F are 15 different values, every one a letter or a mark in Windows-1252, 19 of them in 80 to 9F, where Windows-1252 keeps its quotes and dashes and ISO-8859-1 has only controls: 97 —/);
    assert.match(card, /So it is read as Windows-1252, the likeliest for text written on Windows in English and western European languages\./);
    // The head's mark leads to the card: Metadata is shown for it.
    await showPanel(page, 'places');
    await page.click('[data-marxy-head="0"] .marxy-guess-encoding');
    assert.ok(await page.isVisible('.marxy-drawer .marxy-l-how .marxy-encoding'));
  });
});

test('Read with encoding... reads the same bytes each way; a choice re-reads the file, said as yours, kept, and the way back', async () => {
  await withFrame({ files: FILES, open: [NOTE] }, async (page) => {
    await waitForMark(page, 'Windows-1252 · guessed');
    const before = await bytesOf(page, NOTE);
    await showPanel(page, 'metadata');
    await page.click('.marxy-drawer .marxy-encoding button:text-is("Read with encoding…")');
    await drawerShows(page, 'transforms');
    await page.waitForSelector('.marxy-enc-way');
    assert.match(await page.textContent('.marxy-encodings .marxy-dlab'), /^Read with encoding…guessed$/);
    const list = await rows(page);
    const labels = list.map((r) => r.label);
    for (const l of ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'iso-8859-1', 'iso-8859-15', 'macintosh', 'shift_jis', 'gb18030', 'euc-kr', 'big5', 'koi8-r', 'windows-1251']) assert.ok(labels.includes(l), l);
    const row = (l) => list.find((r) => r.label === l);
    assert.deepEqual([row('windows-1252').on, row('windows-1252').guess, row('windows-1252').sub], [true, true, 'the guess']);
    assert.ok(row('windows-1252').sample.startsWith('FICE — NOTE'));
    assert.equal(row('utf-8').sub, '25 bytes it cannot read');
    assert.equal(row('iso-8859-1').sub, '1 control character');
    assert.ok(row('macintosh').sample.startsWith('FICE ó NOTE'));
    assert.equal(list.filter((r) => r.guess).length, 1);

    await page.click('.marxy-enc-way[value="macintosh"]');
    await waitForMark(page, 'Mac Roman · your choice');
    assert.deepEqual(await encodingMark(page), { text: 'Mac Roman · your choice', mine: true });
    await page.waitForFunction(() => document.body.innerText.includes('OFFICE ó NOTE'));
    assert.equal((await factsOf(page)).bytes, 'Mac Roman · CRLF · no BOM');
    assert.match(await howText(page), /Mac Roman · your choice · why\?\n+Read with encoding… · Back to Windows-1252/);
    assert.deepEqual(await bytesOf(page, NOTE), before, 'the bytes never change');
    // Written a moment after the choice (readings-file.ts).
    await until(async () => (await readings(page))?.encodings?.[NOTE] === 'macintosh');
    assert.deepEqual((await readings(page)).encodings, { [NOTE]: 'macintosh' });

    // Kept across a reopen: another file, then this one again.
    await page.evaluate(() => window.__marxyHandle.open('/r/README.md'));
    await waitForMark(page, null);
    await page.evaluate((p) => window.__marxyHandle.open(p), NOTE);
    await waitForMark(page, 'Mac Roman · your choice');

    // The way back.
    await showPanel(page, 'metadata');
    await page.click('.marxy-drawer .marxy-encoding button:text-is("Back to Windows-1252")');
    await waitForMark(page, 'Windows-1252 · guessed');
    await page.waitForFunction(() => document.body.innerText.includes('OFFICE — NOTE'));
    await until(async () => (await readings(page))?.encodings === undefined);
    assert.deepEqual(await bytesOf(page, NOTE), before);
  });
});

test('a choice kept in readings.json is how the file is read at the next launch', async () => {
  const kept = `${JSON.stringify({ version: 1, parts: {}, encodings: { [NOTE]: 'macintosh' } }, null, 2)}\n`;
  await withFrame({ files: { ...FILES, '/data/readings.json': kept }, open: [NOTE] }, async (page) => {
    await waitForMark(page, 'Mac Roman · your choice');
    await page.waitForFunction(() => document.body.innerText.includes('OFFICE ó NOTE'));
  });
});

test('a save writes the text back in the file’s own encoding, or is refused, saying which character it cannot write', async () => {
  await withFrame({ files: FILES, open: ['/r/tide-notes-utf16.txt'] }, async (page) => {
    await page.waitForFunction(() => document.body.innerText.includes('Θάλασσα'));
    await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'apply', range: { file: '/r/tide-notes-utf16.txt', start: 0, end: 5 }, replacement: 'Θ notes', label: 'test', baseVersion: window.__marxyHandle.document().snapshot().version }));
    const saved = await page.evaluate(() => window.__marxyHandle.save());
    assert.equal(saved.result ?? saved, 'saved');
    const bytes = Buffer.from(await bytesOf(page, '/r/tide-notes-utf16.txt'));
    assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe], 'the BOM is written back');
    assert.ok(bytes.subarray(2).toString('utf16le').startsWith('Θ notes notes,'), 'UTF-16 LE, as it was');
    assert.equal(bytes.length, UTF16.length + 4, 'two characters more, two bytes each');
  });
  await withFrame({ files: FILES, open: [NOTE] }, async (page) => {
    await waitForMark(page, 'Windows-1252 · guessed');
    await page.evaluate((p) => window.__marxyHandle.dispatch({ type: 'apply', range: { file: p, start: 0, end: 7 }, replacement: 'Θ', label: 'test', baseVersion: window.__marxyHandle.document().snapshot().version }), NOTE);
    const saved = await page.evaluate(() => window.__marxyHandle.save());
    assert.notEqual(saved.result ?? saved, 'saved');
    assert.deepEqual(Buffer.from(await bytesOf(page, NOTE)), CP1252, 'nothing written');
    assert.ok((await page.$$eval('.marxy-notice-text', (els) => els.map((e) => e.textContent))).some((t) => /“Θ” \(U\+0398\) on line 1 has no bytes in Windows-1252/.test(t)));
  });
});
