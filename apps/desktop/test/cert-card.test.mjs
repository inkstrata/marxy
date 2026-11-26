// A certificate's file card: who it names, who issued it, when it starts and ends (an ended one says so), its key and
// whether it is a CA; a bundle lists each; a private key is said to be there and none of it is shown; a damaged file
// gives its reason; nothing is asked of anyone. The samples are built by fixtures/certs/make-certs.mjs. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, showCardPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const certs = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'certs');
const read = (n) => readFileSync(join(certs, n));
const keyLines = read('test-only-key.pem').toString().split('\n').filter((l) => /^[A-Za-z0-9+/=]{40,}$/.test(l));
const FILES = {
  '/r/README.md': '# Here\n',
  '/r/c/leaf.pem': read('tidemark-leaf.pem'),
  '/r/c/old.crt': read('tidemark-old.crt'),
  '/r/c/root.cer': read('tidemark-root.cer'),
  '/r/c/bundle.pem': read('tidemark-bundle.pem'),
  '/r/c/key.pem': read('test-only-key.pem'),
  '/r/c/both.crt': read('test-only-combined.crt'),
  '/r/c/key.der': read('test-only-key.der'),
  '/r/c/ec.der': read('test-only-ec-key.der'),
  '/r/c/broken.pem': '-----BEGIN CERTIFICATE-----\nMIIB@@@@\n-----END CERTIFICATE-----\n',
  '/r/c/indefinite.der': Buffer.from([0x30, 0x80, 0x02, 0x01, 0x01, 0x00, 0x00]),
  '/r/c/notes.pem': 'Just some notes saved with a .pem name.\n',
};

const open = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.waitForFunction((name) => document.querySelector('.marxy-fcard-name')?.textContent === name, path.slice(path.lastIndexOf('/') + 1));
};
const rows = (page) =>
  page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.marxy-fcard .marxy-fact')].map((e) => [e.children[0].textContent, e.children[1].innerText])));

test('a PEM leaf shows subject, issuer, validity and key size, and nothing is requested or handed over', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    const origin = new URL(page.url()).origin;
    await open(page, '/r/c/leaf.pem');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'A certificate');
    const r = await rows(page);
    assert.match(r.subject, /^tide\.tidemark\.test, Tidemark Harbour Works, GB/);
    assert.match(r.issuer, /^Tidemark Root, Tidemark Harbour Works, GB/);
    assert.equal(r.starts, '14 Mar 2026');
    assert.equal(r.ends, 'ends on 31 Dec 2049');
    assert.equal(r.key, 'RSA, 2048 bits');
    assert.equal(r.CA, 'no');
    assert.match(await page.innerText('.marxy-fcard-note'), /never checks it with anyone/);
    assert.equal(await page.$('.marxy-fchex'), null, 'a PEM is text: Source shows it, no hex beside the card');
    assert.deepEqual(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')), []);
    const calls = await page.evaluate(() => window.__marxyHandle.shell.calls.map((c) => c.method));
    assert.ok(!calls.some((m) => /openInSystem|exec|spawn|fetch|http/i.test(m)), calls.join());
  });
});

test('an ended certificate says "ended on" its date', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/c/old.crt');
    const r = await rows(page);
    assert.equal(r.ends, 'ended on 1 Jan 2021');
    assert.equal(r.key, 'EC, curve P-256');
  });
});

test('a DER root is read from its bytes: a CA, with the bytes beside it', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/c/root.cer');
    const r = await rows(page);
    assert.match(r.CA, /^yes/);
    assert.match(r.issuer, /names itself as its issuer/);
    assert.notEqual(await page.$('.marxy-fchex'), null);
  });
});

test('a bundle of three lists three certificates', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/c/bundle.pem');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'A bundle of 3 certificates');
    const r = await rows(page);
    assert.deepEqual(Object.keys(r).filter((k) => k.startsWith('certificate ')), ['certificate 1', 'certificate 2', 'certificate 3']);
    assert.match(r['certificate 3'], /ended on 1 Jan 2021/);
  });
});

test('a private key says it holds one and no byte of it reaches the card, its why list or the panel', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    for (const path of ['/r/c/key.pem', '/r/c/both.crt', '/r/c/key.der', '/r/c/ec.der']) {
      await open(page, path);
      const r = await rows(page);
      assert.equal(r['private key'].split('\n')[0], 'This file holds a private key.', path);
      assert.equal(await page.$('.marxy-fchex'), null, `${path}: no bytes beside the card`);
      assert.equal(r['first bytes'], undefined, path);
      const hex = (bytes) => [...bytes.subarray(0, 12)].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
      const head = hex(FILES[path]);
      // The list is folded, not absent: its text is in the page whether or not it shows.
      const page_ = await page.evaluate(() => document.querySelector('.marxy-fcard').textContent + ' ' + [...document.querySelectorAll('.marxy-reasons')].map((e) => e.textContent).join(' '));
      for (const line of keyLines) assert.ok(!page_.includes(line.slice(0, 16)), path);
      assert.ok(!/PRIVATE KEY-----|MIIE/.test(page_), path);
      assert.ok(!page_.includes(head.slice(0, 11)), `${path}: no hex of the file`);
      await showCardPanel(page, 'reading');
      const reading = await cardText(page, 'reading');
      assert.ok(!reading.includes(head.slice(0, 11)) && !/MIIE|PRIVATE KEY-----/.test(reading), path);
      await showCardPanel(page, 'facts');
      const facts = await cardText(page, 'facts');
      assert.ok(!/starts [0-9A-F]{2} /.test(facts) && !facts.includes(head.slice(0, 11)), path);
    }
  });
});

test('damaged base64 and an indefinite length give a reason; a text file under the name is a plain file', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/c/broken.pem');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'A certificate the app cannot read');
    assert.match(await page.innerText('.marxy-fcard-why'), /base64/);
    await open(page, '/r/c/indefinite.der');
    assert.match(await page.innerText('.marxy-fcard-why'), /indefinite length/);
    await open(page, '/r/c/notes.pem');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'No reading for this file');
  });
});

test('a key opens in Read even when the pane was in Source; Source is one press away', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    for (const path of ['/r/c/key.pem', '/r/c/key.der']) {
      await page.evaluate(() => window.__marxyHandle.panes().focused.view.setMode('source'));
      await open(page, path);
      assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.view.mode), 'rendered', path);
      assert.equal(await page.evaluate(() => document.querySelector('.cm-content')?.textContent?.includes('PRIVATE KEY') ?? false), false, path);
    }
  });
});

test('a certificate listed after a key block with a mismatched END is still a row', async () => {
  await withFrame({ files: { ...FILES, '/r/c/mixed.pem': '-----BEGIN PRIVATE KEY-----' + String.fromCharCode(10) + 'AAAA' + String.fromCharCode(10) + '-----END RSA PRIVATE KEY-----' + String.fromCharCode(10) + read('tidemark-leaf.pem') }, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/c/mixed.pem');
    const r = await rows(page);
    assert.match(r.subject, /^tide\.tidemark\.test/);
    assert.equal(r['private key'].split(String.fromCharCode(10))[0], 'This file holds a private key.');
  });
});
