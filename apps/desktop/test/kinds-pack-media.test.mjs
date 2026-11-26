// Mail and pictures under the cursor in WebKit. A message's parts are its headers (and the
// fields the page sets), the body shown (a text part's blocks inside it) and each attachment by its MIME number; an image's
// are the picture and the Image card's facts. `c` copies the part as stored, `x` shows it as sent or stored, `o` opens an
// attachment read-only in a tab of its own, `\` goes to Source at the part, and the change verbs refuse. The segments and chunks are not parts here: core keeps no list of them.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { rowOf, showCardPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const NOTICE = '/r/mail/low-water-notice.eml';
const REPLY = '/r/mail/re-gauge-readings.eml';
const JPG = '/r/images/harbour-at-low-water.jpg';
const SVG = '/r/images/sketch.svg';
const FILES = {
  '/r/README.md': '# Here\n',
  [NOTICE]: readFileSync(join(demo, 'mail', 'low-water-notice.eml')),
  [REPLY]: readFileSync(join(demo, 'mail', 're-gauge-readings.eml')),
  [JPG]: readFileSync(join(demo, 'images', 'harbour-at-low-water.jpg')),
  [SVG]: readFileSync(join(demo, 'images', 'sketch.svg')),
};

const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const clipboard = (page) =>
  page.evaluate(() => {
    const last = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    const rep = last?.args[0].find((r) => r.type === 'public.utf8-plain-text');
    return rep ? new TextDecoder().decode(rep.bytes) : null;
  });
const copied = (page, n) => page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === n, n);

/** The bar as the reader sees it, and the element under the cursor. */
const bar = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.marxy-verb-bar');
    const shown = b && !b.hidden;
    const el = document.querySelector('[data-marxy-pane="0"] .marxy-cursor');
    return {
      where: shown ? b.querySelector('.marxy-verb-bar-where').textContent : null,
      what: shown ? b.querySelector('.marxy-verb-bar-what').textContent : null,
      verbs: shown ? [...b.querySelectorAll('[data-marxy-verb]')].map((v) => v.textContent.trim()) : [],
      text: el ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) : null,
    };
  });
const noticeSaid = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll('.marxy-notice-text')].some((e) => new RegExp(src).test(e.textContent)), re.source);
const frameReady = (page) =>
  page.waitForFunction(() => {
    const d = document.querySelector('iframe.marxy-sandbox')?.contentDocument;
    return !!d && d.readyState === 'complete' && d.querySelector('h1') !== null;
  });
const imageReady = (page) => page.waitForFunction(() => document.querySelector('.marxy-imgpic')?.complete && document.querySelector('.marxy-imgpic').naturalWidth > 0 && document.querySelector('.marxy-imgbar-zoom')?.textContent);
const xrayText = (page) => page.$$eval('[data-marxy-pane="0"] .marxy-xray .marxy-xray-text', (els) => els.map((e) => e.textContent));
const xrayHead = (page) => page.getAttribute('[data-marxy-pane="0"] .marxy-xray .marxy-xray-head', 'data-marxy-xray-head');

test(`K-pack 10 a message opens as mail: j walks the header block, the body and the attachments; l goes into the fields; an attachment by its MIME number`, async () => {
  await withFrame({ files: FILES, open: [NOTICE] }, async (page) => {
    await frameReady(page);
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'mail');
    await blur(page);
    await keys(page, 'g', 'g');
    let b = await bar(page);
    assert.equal(b.where, 'low-water-notice.eml#headers');
    assert.equal(b.what, 'headers');
    assert.deepEqual(b.verbs, ['c copy', 'C cite', 'x x-ray', '\\ source', 'r read as', 'y collect', 'n note', 'Enter all'], 'only read: no change verbs');
    assert.match(b.text, /^A mail message · multipart\/mixed/);
    await keys(page, 'c');
    await copied(page, 1);
    const head = await clipboard(page);
    assert.match(head, /^Return-Path: <office@harbour\.example>\nReceived: from mail\.harbour\.example/);
    assert.match(head, /\nContent-Type: multipart\/mixed; boundary="=_harbour_mixed_0001"$/, 'the header lines as written, to the last');
    await keys(page, 'l');
    b = await bar(page);
    assert.equal(b.what, 'header Subject');
    assert.equal(b.where, 'low-water-notice.eml#headers/Subject');
    assert.equal(b.text, 'Low water walk — 14 November', 'the subject as the page sets it, decoded');
    await keys(page, 'c');
    await copied(page, 2);
    assert.equal(await clipboard(page), 'Subject: Low water walk =?utf-8?b?4oCU?= 14 November', 'as written');
    await keys(page, 'j');
    assert.equal((await bar(page)).what, 'header From');
    await keys(page, 'h');
    assert.equal((await bar(page)).what, 'headers', 'h comes out');
    await keys(page, 'j');
    b = await bar(page);
    assert.equal(b.what, 'body HTML');
    assert.equal(b.where, 'low-water-notice.eml#part=1.2.1');
    await keys(page, 'j');
    b = await bar(page);
    assert.equal(b.what, 'attachment tide-table-november.csv');
    assert.equal(b.where, 'low-water-notice.eml#part=2');
    assert.deepEqual(b.verbs, ['c copy', 'C cite', 'x x-ray', 'o open', '\\ source', 'r read as', 'y collect', 'n note', 'Enter all']);
    await keys(page, 'j');
    b = await bar(page);
    assert.equal(b.where, 'low-water-notice.eml#part=3', 'an attachment by its MIME number');
    assert.match(b.text, /^JPG harbour-mouth\.jpg|harbour-mouth\.jpg/);
    assert.ok(await page.$('.marxy-mail-card.marxy-cursor[data-marxy-attach="harbour-mouth.jpg"]'), 'its card is marked');
    await keys(page, 'Shift+G');
    assert.equal((await bar(page)).where, 'low-water-notice.eml#part=4');
  });
});

test(`K-pack 11 c on an attachment copies its name; x shows its MIME headers and its base64 lines as written`, async () => {
  await withFrame({ files: FILES, open: [NOTICE] }, async (page) => {
    await frameReady(page);
    await blur(page);
    await keys(page, 'g', 'g', 'j', 'j');
    assert.equal((await bar(page)).what, 'attachment tide-table-november.csv');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), 'tide-table-november.csv');
    await keys(page, 'x');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-xray');
    assert.equal(await xrayHead(page), 'As sent · part 2, base64');
    const lines = await xrayText(page);
    assert.deepEqual(lines.slice(0, 4), ['Content-Type: text/csv', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="tide-table-november.csv"', '']);
    assert.ok(lines.slice(4, 8).every((l) => /^[A-Za-z0-9+/=]+$/.test(l)), `base64 lines as sent: ${lines.slice(4, 8)}`);
    assert.match(lines.at(-1), /^… \d+ more lines$/);
    // The box sits after the card.
    assert.ok(await page.evaluate(() => document.querySelector('.marxy-mail-card.marxy-cursor').nextElementSibling?.classList.contains('marxy-xray')));
    await keys(page, 'x');
    await page.waitForFunction(() => !document.querySelector('[data-marxy-pane="0"] .marxy-xray'));
  });
});

test(`K-pack 12 o on an attachment opens it read-only in a tab of its own with the bytes that were sent; e only says so`, async () => {
  await withFrame({ files: FILES, open: [NOTICE] }, async (page) => {
    await frameReady(page);
    await blur(page);
    await keys(page, 'g', 'g', 'j', 'j', 'j');
    assert.equal((await bar(page)).what, 'attachment harbour-mouth.jpg');
    await keys(page, 'e');
    await noticeSaid(page, /A message is only read here/);
    await keys(page, 'd');
    const writes = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => /^write/.test(c.method)).map((c) => String(c.args[0])));
    assert.deepEqual(writes.filter((p) => /\.eml$|archive-entry:|harbour-mouth/.test(p)), [], 'the message is not written');
    await keys(page, 'o');
    await page.waitForFunction(() => /^archive-entry:\d+\/harbour-mouth\.jpg$/.test(window.__marxyHandle.panes().panes[0].path() ?? ''));
    await page.waitForSelector('[data-marxy-viewer="image"] img');
    assert.deepEqual(await rowOf(page), ['low-water-notice.eml', 'harbour-mouth.jpg*']);
    // In its own tab it is an image, and only read.
    await imageReady(page);
    await blur(page);
    await keys(page, 'g', 'g');
    assert.equal((await bar(page)).where, 'harbour-mouth.jpg#picture');
    await keys(page, 'e');
    await noticeSaid(page, /A file from inside another is only read here/);
  });
});

test(`K-pack 16 a plain text message: the body's paragraphs, quotes and signature are its parts; c copies the signature as written; \\ goes to Source`, async () => {
  await withFrame({ files: FILES, open: [REPLY] }, async (page) => {
    await page.waitForSelector('.marxy-mail-text');
    await blur(page);
    await keys(page, 'g', 'g', 'j');
    let b = await bar(page);
    assert.equal(b.what, 'body text');
    assert.equal(b.where, 're-gauge-readings.eml#part=1');
    await keys(page, 'l');
    b = await bar(page);
    assert.equal(b.what, 'paragraph');
    assert.equal(b.text, 'Hi,');
    await keys(page, 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), 'Hi,');
    await keys(page, 'j');
    assert.match((await bar(page)).text, /^Thanks for the notice/);
    const seen = [];
    for (let i = 0; i < 12 && (await bar(page)).what !== 'signature'; i++) {
      await keys(page, 'j');
      seen.push((await bar(page)).what);
    }
    assert.ok(seen.includes('quote'), `quotes on the way: ${seen}`);
    assert.equal((await bar(page)).what, 'signature');
    assert.equal(await page.$$eval('[data-marxy-pane="0"] .marxy-cursor .marxy-mail-line', (ps) => ps.every((p) => 'marxySig' in p.dataset)), true, 'the signature lines are marked');
    await keys(page, 'c');
    await copied(page, 2);
    assert.equal((await clipboard(page)).split('\n')[0], '-- ', 'as written');
    await keys(page, 'h');
    assert.equal((await bar(page)).what, 'body text');
    await keys(page, 'l', 'Shift+G');
    assert.equal((await bar(page)).where, 're-gauge-readings.eml#part=1', 'G: the last part at the top, the body');
    await keys(page, 'l');
    for (let i = 0; i < 12 && (await bar(page)).what !== 'signature'; i++) await keys(page, 'j');
    // The signature's byte in the message: `\` lands Source there.
    const at = await page.evaluate(async () => (await import('/src/parts/cursor.ts')).partsHere()?.head?.at ?? null);
    const raw = FILES[REPLY];
    assert.equal(at, raw.indexOf('\n-- \r\n') + 1, 'the signature’s first byte');
    await keys(page, '\\');
    await page.waitForFunction(() => document.querySelector('.marxy-source-mount:not([hidden]) .cm-content'));
    assert.equal(await page.getAttribute('.marxy-rs-source', 'aria-pressed'), 'true');
  });
});

test(`K-media 02 j k walk the picture and its facts, l goes into the facts, h out, the bar speaks each; c copies the fact's line; zoom keys stay`, async () => {
  await withFrame({ files: FILES, open: [JPG] }, async (page) => {
    await imageReady(page);
    // The facts' rows are the Image card's, drawn in Outline.
    await showCardPanel(page, 'contents');
    await blur(page);
    await keys(page, 'g', 'g');
    let b = await bar(page);
    assert.equal(b.where, 'harbour-at-low-water.jpg#picture');
    assert.equal(b.what, 'picture');
    assert.ok(!b.verbs.some((v) => /edit|tick/.test(v)), 'no edit is offered');
    assert.ok(await page.$('.marxy-imgstage.marxy-cursor'), 'the picture is marked');
    await keys(page, 'c');
    await copied(page, 1);
    assert.match(await clipboard(page), /^FF D8 FF E[01] /, 'the file’s first bytes as stored');
    assert.match(await clipboard(page), / …$/);
    await keys(page, 'j');
    b = await bar(page);
    assert.equal(b.where, 'harbour-at-low-water.jpg#facts');
    assert.ok(await page.$('.marxy-drawer [data-marxy-card="contents"].marxy-cursor'), 'the Image card is marked');
    await keys(page, 'l');
    b = await bar(page);
    assert.equal(b.what, 'fact size');
    assert.equal(b.where, 'harbour-at-low-water.jpg#facts/size');
    await keys(page, 'c');
    await copied(page, 2);
    assert.match(await clipboard(page), /^size: 960 × \d+ pixels/);
    await keys(page, 'j');
    assert.equal((await bar(page)).what, 'fact format');
    assert.ok(await page.$('.marxy-drawer .marxy-fact.marxy-cursor'), 'its row in the Image card is marked');
    await keys(page, 'c');
    await copied(page, 3);
    assert.equal(await clipboard(page), 'format: JPEG');
    await keys(page, 'h');
    assert.equal((await bar(page)).what, 'facts');
    await keys(page, 'k');
    assert.equal((await bar(page)).what, 'picture');
    // The page's own keys are kept: zoom.
    const before = await page.textContent('.marxy-imgbar-zoom');
    await keys(page, '+');
    await page.waitForFunction((z) => document.querySelector('.marxy-imgbar-zoom')?.textContent !== z, before);
    await keys(page, '0');
    await page.waitForFunction((z) => document.querySelector('.marxy-imgbar-zoom')?.textContent === z, before);
  });
});

test(`K-media 03 x shows the picture as the file's first bytes at their offsets; again takes it away`, async () => {
  await withFrame({ files: FILES, open: [JPG] }, async (page) => {
    await imageReady(page);
    await blur(page);
    await keys(page, 'g', 'g', 'x');
    await page.waitForSelector('[data-marxy-pane="0"] .marxy-xray');
    assert.match(await xrayHead(page), /^As stored · the file’s first bytes, 0–255 of [\d,]+$/);
    const rows = await page.$$eval('[data-marxy-pane="0"] .marxy-xray .marxy-xray-line', (els) => els.map((e) => [e.dataset.marxyLine, e.textContent]));
    assert.equal(rows.length, 16);
    assert.equal(rows[0][0], '0000');
    assert.match(rows[0][1], /^FF D8 FF /);
    assert.equal(rows[1][0], '0010');
    await keys(page, 'x');
    await page.waitForFunction(() => !document.querySelector('[data-marxy-pane="0"] .marxy-xray'));
  });
});

test(`K-media 07 Source is the bytes at the part and the Source key comes back; e says an image is only read`, async () => {
  await withFrame({ files: FILES, open: [JPG] }, async (page) => {
    await imageReady(page);
    await blur(page);
    await keys(page, 'g', 'g', 'e');
    await noticeSaid(page, /An image is only read here/);
    await keys(page, '\\');
    await page.waitForFunction(() => document.querySelector('.marxy-hexrow .marxy-hex-o')?.textContent === '00000000');
    assert.equal(await page.getAttribute('.marxy-rs-source', 'aria-pressed'), 'true');
    await page.waitForFunction(() => document.querySelector('.marxy-hexrow i[data-marxy-on]')?.textContent === 'FF', null, { timeout: 5000 });
    // In Source the parts are the hex view's rows.
    await keys(page, 'g', 'g');
    assert.equal((await bar(page)).where, 'harbour-at-low-water.jpg@0x0000');
    await keys(page, '\\');
    await imageReady(page);
    assert.equal(await page.getAttribute('.marxy-rs-read', 'aria-pressed'), 'true');
  });
});

test(`an SVG's picture is a part of its Read; its Source is the text editor`, async () => {
  await withFrame({ files: FILES, open: [SVG] }, async (page) => {
    await imageReady(page);
    await blur(page);
    await keys(page, 'g', 'g');
    assert.equal((await bar(page)).where, 'sketch.svg#picture');
    await keys(page, 'c');
    await copied(page, 1);
    assert.match(await clipboard(page), /<svg/, 'its text as written');
    await keys(page, 'j', 'l');
    assert.equal((await bar(page)).where, 'sketch.svg#facts/size');
    await keys(page, 'k', 'k', '\\');
    await page.waitForFunction(() => document.querySelector('.marxy-source-mount:not([hidden]) .cm-content')?.textContent.includes('<svg'));
  });
});
