// A mail message (an .eml, or an Outlook .msg read into one): the head set as a letter's; the HTML part
// cleaned and drawn in a sandbox with no scripts and nothing from the network, its own styles inside the frame; images
// from the network held back, loaded through the shell only when asked, for that message until its tab closes, and
// blocked again when it is opened again; links shown and never followed; the text part's quotes and signature; all the
// headers as written; attachments opening into memory in a tab of their own; a message found from its headers; Export.
// The page's every request is watched: none leaves for the network. WebKit, over the memory shell.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, cardsOf, rowOf, showCardPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'mail');
const NOTICE = '/r/mail/low-water-notice.eml';
const REPLY = '/r/mail/re-gauge-readings.eml';
const FILES = {
  '/r/README.md': '# Here\n',
  [NOTICE]: readFileSync(join(demo, 'low-water-notice.eml')),
  [REPLY]: readFileSync(join(demo, 're-gauge-readings.eml')),
  // The same reply with no extension: found from its headers.
  '/r/mail/saved-message': readFileSync(join(demo, 're-gauge-readings.eml')),
};
const REMOTE = ['https://news.harbour.example/i/banner.png', 'https://news.harbour.example/i/chart-nov.png', 'https://t.harbour.example/o/7f3a9c.gif?u=lab'];

const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => c.args), method);
const noticeTexts = (page) => page.$$eval('.marxy-notice-text', (els) => els.map((e) => e.textContent));

/** Every request the page makes that is not for the app's own files. */
function watchNetwork(page) {
  const off = [];
  const base = new URL(page.url()).host;
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return;
    if (new URL(u).host !== base) off.push(u);
  });
  return off;
}

const open = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);
const frameReady = (page) =>
  page.waitForFunction(() => {
    const d = document.querySelector('iframe.marxy-sandbox')?.contentDocument;
    return !!d && d.readyState === 'complete' && d.querySelector('h1') !== null;
  });

test('a message reads as a letter: its head, its HTML part cleaned in a sandbox on its own paper, nothing from the network', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const off = watchNetwork(page);
    await open(page, NOTICE);
    await page.waitForSelector('.marxy-mailpage');
    await frameReady(page);
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'mail');
    assert.equal(await page.textContent('.marxy-mail-kicker'), 'A mail message · multipart/mixed · 6 parts');
    assert.equal(await page.textContent('.marxy-mail-subject'), 'Low water walk — 14 November');
    assert.equal(await page.innerText('.marxy-mail-who'), 'From\nHarbour Office office@harbour.example\nTo\nReader Lab lab@reader.example\nCc\nnotices@harbour.example\nDate\nMon 2 Nov 2026, 08:14 +0000, as the message writes it');
    assert.deepEqual(await page.$$eval('.marxy-mail-bar [role="radio"]', (bs) => bs.map((b) => `${b.textContent}:${b.getAttribute('aria-checked')}`)), ['HTML:true', 'Text:false']);
    assert.match(await page.innerText('.marxy-mail-bar'), /sent as both; the HTML part first\s+All 14 headers/);
    assert.equal(
      await page.innerText('.marxy-mail-remote-words'),
      '3 images from the network are not loaded. One is 1 × 1 pixel, the size senders use to learn that a message was opened. Loading them tells news.harbour.example and t.harbour.example that this message was read, and when.',
    );
    // The frame: sandboxed with no scripts, its own policy of no network, the message's styles inside it and not outside.
    assert.equal(await page.getAttribute('iframe.marxy-sandbox', 'sandbox'), 'allow-same-origin');
    const inside = await page.evaluate(() => {
      const d = document.querySelector('iframe.marxy-sandbox').contentDocument;
      return {
      csp: d.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
      scripts: d.querySelectorAll('script').length,
      handlers: [...d.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => a.name.startsWith('on'))).length,
      hrefs: d.querySelectorAll('[href]').length,
      remote: [...d.querySelectorAll('img[data-marxy-remote]')].map((i) => [i.getAttribute('data-marxy-remote'), i.src.slice(0, 26)]),
      crest: d.querySelector('img.crest').src.slice(0, 22),
      ground: getComputedStyle(d.body).backgroundColor,
      wrap: getComputedStyle(d.querySelector('.wrap')).maxWidth,
      title: d.title,
      };
    });
    assert.equal(inside.csp, "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'; frame-src 'none'");
    assert.equal(inside.scripts, 0);
    assert.equal(inside.handlers, 0);
    assert.equal(inside.hrefs, 0, 'no link can be followed inside');
    assert.deepEqual(inside.remote, REMOTE.map((u) => [u, 'data:image/svg+xml;charset']));
    assert.equal(inside.crest, 'data:image/png;base64,', 'the image inside the message is drawn, by its Content-ID');
    assert.equal(inside.ground, 'rgb(238, 242, 244)', "the message's own paper");
    assert.equal(inside.wrap, '600px');
    assert.equal(inside.title, '', 'the script that would have retitled it never ran');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(238, 242, 244)', 'its styles never reach the app');
    assert.match(await page.textContent('.marxy-mail-head .marxy-account-body'), /^The HTML part is shown in a sandbox: 1 script not run, 1 event handler left out; .*Links in it are shown but never followed when clicked/);
    // A press on a link in the page follows nothing: the frame stays on the message, nothing is opened, and the app says
    // where it goes. WebKit runs no listener inside a frame that may run no scripts, so the press lands on the app's own
    // box over the link; the mouse goes where the reader's would, since that box is what a hit test finds there.
    const tide = page.frameLocator('iframe.marxy-sandbox').locator('a', { hasText: 'tide table' });
    await tide.scrollIntoViewIfNeeded();
    const link = await tide.boundingBox();
    assert.ok(link, 'the link is drawn');
    assert.equal(await page.$$eval('.marxy-sandbox-hits', (l) => l.length), 1, 'WebKit: the layer that hears a press beside the frame');
    await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /links are not followed inside the message/.test(n.textContent)));
    assert.ok((await noticeTexts(page)).includes('https://harbour.example/tides: links are not followed inside the message. The Links panel opens one.'));
    assert.equal(await page.evaluate(() => document.querySelector('iframe.marxy-sandbox').contentWindow.location.href), 'about:srcdoc');
    assert.deepEqual(await calls(page, 'openExternal'), []);
    // A press beside a link is the page's own: no notice, nothing opened.
    const said = async () => (await noticeTexts(page)).filter((t) => /not followed/.test(t)).length;
    const before = await said();
    await page.mouse.click(link.x + link.width + 40, link.y + link.height / 2);
    await page.waitForTimeout(200);
    assert.ok((await said()) <= before);
    // Metadata: Reading, Headers, Facts; Outline: Message; Links: Links.
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts', 'Headers', 'Message', 'Links']);
    assert.match(await cardText(page, 'reading'), /^Shown as a mail message, 3 attachments\s+from its name · why\?/);
    assert.match(await cardText(page, 'reading'), /images from the network blocked until you ask, for this message only/);
    await showCardPanel(page, 'contents');
    const tree = await page.$$eval('.marxy-mail-tree-row', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(tree, [
      'multipart/mixed',
      'multipart/alternative',
      'text/plain 780 bytes · quoted-printable',
      'multipart/related',
      'text/html 2.0 KB · quoted-printable',
      'image/png · crest.png 1.1 KB · base64 · inline',
      'text/csv · tide-table-november.csv 1.0 KB · base64',
      'image/jpeg · harbour-mouth.jpg 15.7 KB · base64',
      'text/calendar · low-water-walk.ics 405 bytes · base64',
    ]);
    const links = await cardText(page, 'links');
    assert.match(links, /says harbour\.example, goes to harbour-example\.net/);
    assert.equal((links.match(/says /g) ?? []).length, 1, 'only the link whose words name another place');
    // A link in the Links card opens in the browser, on the reader's press.
    await page.click('.marxy-drawer [data-marxy-card="links"] .marxy-link-row:has-text("tide table")');
    assert.deepEqual(await calls(page, 'openExternal'), [['https://harbour.example/tides']]);
    // Text and back: the tab's choice; the frame goes with HTML.
    await page.click('.marxy-mail-bar [data-marxy-part="text"]');
    await page.waitForSelector('.marxy-mail-text');
    assert.equal(await page.$('iframe.marxy-sandbox'), null);
    assert.match(await page.innerText('.marxy-mail-text'), /^Low water walk, 14 November/);
    await page.click('.marxy-mail-bar [data-marxy-part="html"]');
    await frameReady(page);
    // Source is the message's text, as it travels.
    await page.click('.marxy-rs-source');
    await page.waitForSelector('.cm-content');
    assert.match(await page.textContent('.cm-content'), /^Return-Path: <office@harbour\.example>/);
    assert.deepEqual(off, [], `requests left for the network: ${off.join(', ')}`);
    assert.deepEqual(await calls(page, 'fetchRemoteImage'), []);
  });
});

test('images from the network load only when asked, for that message until its tab closes; opened again, they are blocked again', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const off = watchNetwork(page);
    await open(page, NOTICE);
    await frameReady(page);
    assert.deepEqual(await calls(page, 'fetchRemoteImage'), []);
    await page.click('.marxy-mail-remote .marxy-btn:has-text("Load them for this message")');
    await page.waitForSelector('.marxy-mail-remote[data-marxy-on]');
    await frameReady(page);
    // Fetched by the shell, each image once, in the order the message has them; the frame draws what the shell gave.
    assert.deepEqual(await calls(page, 'fetchRemoteImage'), REMOTE.map((u) => [u]));
    await page.waitForFunction(() => [...document.querySelector('iframe.marxy-sandbox').contentDocument.querySelectorAll('img[data-marxy-remote]')].every((i) => i.src.startsWith('data:image/png')));
    assert.match(await page.innerText('.marxy-mail-remote'), /^Images from the network, loaded for this message until its tab closes; not remembered for the sender or for other messages\.\s+Block them again$/);
    assert.ok((await noticeTexts(page)).includes('Loaded for this message only, until its tab closes. Not remembered.'));
    // Another tab and back: still this tab's, and nothing is fetched again.
    await open(page, REPLY);
    await page.waitForSelector('.marxy-mail-text');
    await page.click('.marxy-tabbar .marxy-tab[data-marxy-tab-path$="low-water-notice.eml"]');
    await page.waitForSelector('.marxy-mail-remote[data-marxy-on]');
    assert.equal((await calls(page, 'fetchRemoteImage')).length, 3);
    // Closed and opened again: blocked again, and nothing was kept that would load them.
    await page.click('.marxy-tabbar .marxy-tab[data-marxy-tab-path$="low-water-notice.eml"] .marxy-tab-close');
    await page.waitForFunction((p) => window.__marxyHandle.panes().panes[0].path() !== p, NOTICE);
    await open(page, NOTICE);
    await frameReady(page);
    await page.waitForSelector('.marxy-mail-remote:not([data-marxy-on])');
    assert.match(await page.innerText('.marxy-mail-remote'), /^3 images from the network are not loaded\./);
    assert.ok(await page.evaluate(() => [...document.querySelector('iframe.marxy-sandbox').contentDocument.querySelectorAll('img[data-marxy-remote]')].every((i) => i.src.startsWith('data:image/svg+xml'))));
    assert.equal((await calls(page, 'fetchRemoteImage')).length, 3, 'nothing fetched on reopening');
    // Never written: nothing the app keeps names an image it loaded or a host it asked. (The index lists the folder's
    // files and their words, as for any folder, the message's text among them: it says nothing of what was loaded.)
    for (const m of ['writeFileAtomic', 'writeFileNew']) {
      for (const [path, bytes] of (await calls(page, m)).filter(([p]) => !/\/index-[0-9a-f]+\.json$/.test(p))) {
        const text = new TextDecoder().decode(new Uint8Array(Object.values(bytes ?? {})));
        assert.doesNotMatch(text, /news\.harbour\.example|t\.harbour\.example|7f3a9c/, `${m} ${path}`);
      }
    }
    assert.deepEqual(off, [], `requests left for the network: ${off.join(', ')}`);
  });
});

test('a text-only reply: quotes set in a level per >, the signature apart, and every header as written on request', async () => {
  await withFrame({ files: FILES, open: [REPLY] }, async (page) => {
    await page.waitForSelector('.marxy-mail-text');
    assert.equal(await page.textContent('.marxy-mail-kicker'), 'A mail message · text/plain · 1 part');
    assert.match(await page.innerText('.marxy-mail-bar'), /sent as text only\s+All 13 headers/);
    assert.equal(await page.$('.marxy-mail-remote'), null);
    const lines = await page.$$eval('.marxy-mail-line', (ps) => ps.map((p) => [p.dataset.marxyLevel ?? '0', 'marxySig' in p.dataset, p.textContent]));
    const at = (start) => lines.find(([, , t]) => t.startsWith(start));
    assert.deepEqual(at('Thanks for the notice').slice(0, 2), ['0', false]);
    assert.deepEqual(at('On Thu, 29 Oct').slice(0, 2), ['1', false]);
    assert.deepEqual(at('On Wed, 28 Oct').slice(0, 2), ['2', false]);
    assert.deepEqual(at('Yes, still on the north wall').slice(0, 2), ['1', false]);
    assert.deepEqual(lines.filter(([, sig]) => sig).map(([, , t]) => t), ['-- ', 'Ines Varga', 'Reader Lab (constructed sample)', 'ines@reader.example']);
    const indent = await page.$$eval('.marxy-mail-line', (ps) => Object.fromEntries(ps.map((p) => [p.dataset.marxyLevel ?? '0', getComputedStyle(p).paddingLeft])));
    assert.ok(parseFloat(indent['2']) > parseFloat(indent['1']) && parseFloat(indent['1']) > parseFloat(indent['0']), JSON.stringify(indent));
    // The usual headers first; all 13 as written when asked from the page.
    await showCardPanel(page, 'frontmatter');
    assert.match(await page.textContent('.marxy-drawer [data-marxy-card="frontmatter"] .marxy-card-head'), /the usual of 13/);
    await page.click('.marxy-mail-bar .marxy-linkish:has-text("All 13 headers")');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer .marxy-mail-header').length === 13);
    const headers = await page.$$eval('.marxy-drawer .marxy-mail-header-k', (ks) => ks.map((k) => k.textContent));
    assert.deepEqual(headers, ['Return-Path', 'Received', 'From', 'To', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References', 'MIME-Version', 'X-Mailer', 'Content-Transfer-Encoding', 'Content-Type']);
    assert.match(await cardText(page, 'frontmatter'), /"Ines Varga" <ines@reader\.example>/, 'as written, quotes and all');
  });
});

test('attachments are file cards, and one opens into memory in a tab of its own: never written, not in the Library', async () => {
  await withFrame({ files: FILES, open: [NOTICE] }, async (page) => {
    await frameReady(page);
    const cards = await page.$$eval('.marxy-mail-card', (bs) => bs.map((b) => [b.dataset.marxyAttach, b.querySelector('.marxy-mail-card-sub').textContent, b.querySelector('img') ? 'picture' : b.querySelector('.marxy-mail-card-kind').textContent]));
    assert.deepEqual(cards, [
      ['tide-table-november.csv', 'text/csv · 1.0 KB', 'CSV'],
      ['harbour-mouth.jpg', 'image/jpeg · 15.7 KB', 'picture'],
      ['low-water-walk.ics', 'text/calendar · 405 bytes', 'ICS'],
    ]);
    await page.click('.marxy-mail-card[data-marxy-attach="harbour-mouth.jpg"]');
    await page.waitForFunction(() => /^archive-entry:\d+\/harbour-mouth\.jpg$/.test(window.__marxyHandle.panes().panes[0].path() ?? ''));
    await page.waitForSelector('[data-marxy-viewer="image"] img');
    assert.deepEqual(await rowOf(page), ['low-water-notice.eml', 'harbour-mouth.jpg*']);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((e) => e.textContent.startsWith('An attachment of low-water-notice.eml, opened into memory when you asked: harbour-mouth.jpg.')));
    await showCardPanel(page, 'facts');
    const facts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.marxy-drawer [data-marxy-card="facts"] .marxy-fact')].map((e) => [e.children[0].textContent, e.children[1].textContent])));
    assert.equal(facts.path, 'low-water-notice.eml › harbour-mouth.jpg');
    assert.match(await cardText(page, 'contents'), /480 × 320 pixels/);
    // Nothing reaches the disk, under its name or any other.
    for (const m of ['writeFileAtomic', 'writeFileNew']) assert.deepEqual((await calls(page, m)).filter(([p]) => /archive-entry:|harbour-mouth/.test(String(p))), [], m);
    assert.deepEqual((await calls(page, 'readFile')).filter(([p]) => String(p).includes('harbour-mouth')), []);
    // The text one opens read as its name says, a table.
    await page.click('.marxy-tabbar .marxy-tab[data-marxy-tab-path$="low-water-notice.eml"]');
    await page.waitForSelector('.marxy-mail-card[data-marxy-attach="tide-table-november.csv"]');
    await page.click('.marxy-mail-card[data-marxy-attach="tide-table-november.csv"]');
    await page.waitForFunction(() => /\/tide-table-november\.csv$/.test(window.__marxyHandle.panes().panes[0].path() ?? ''));
    await page.waitForFunction(() => /2026-11-01/.test(document.querySelector('#marxy-main')?.innerText ?? ''));
  });
});

test('a message with no extension is found from its headers, and said as a guess', async () => {
  await withFrame({ files: FILES, open: ['/r/mail/saved-message'] }, async (page) => {
    await page.waitForSelector('.marxy-mail-text');
    assert.equal(await page.textContent('.marxy-mail-subject'), 'Re: Gauge readings at Lock Gate');
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-guess')?.textContent === 'mail · guessed');
    assert.match(await cardText(page, 'reading'), /guessed from its headers; the name did not say/);
  });
});

test('Export offers the message as it is, its text, and its HTML cleaned', async () => {
  await withFrame({ files: FILES, open: [NOTICE] }, async (page) => {
    await frameReady(page);
    const built = await page.evaluate(async () => {
      const v = window.__marxyHandle.panes().focused.content.viewer();
      return Promise.all(v.exports('rendered').map(async (e) => {
        const { bytes } = await e.build();
        return [e.name, e.extension, bytes.length, new TextDecoder().decode(bytes.slice(0, 40))];
      }));
    });
    assert.deepEqual(built.map(([n, x]) => [n, x]), [['The message, as it is', 'eml'], ['The text part', 'txt'], ['The HTML part, cleaned', 'html']]);
    assert.equal(built[0][2], readFileSync(join(demo, 'low-water-notice.eml')).length, 'every byte');
    assert.match(built[1][3], /^Low water walk, 14 November/);
    assert.match(built[2][3], /^<!doctype html>/);
    const html = await page.evaluate(async () => new TextDecoder().decode((await window.__marxyHandle.panes().focused.content.viewer().exports('rendered')[2].build()).bytes));
    assert.doesNotMatch(html, /<script|onclick|\shref=|src="https:/);
  });
});

const MSG = '/r/mail/gauge-4-reply.msg';
const OUTLOOK = { ...FILES, [MSG]: readFileSync(join(demo, 'gauge-4-reply.msg')), '/r/mail/other.msg': readFileSync(join(demo, 'gauge-4-reply.msg')).subarray(0, 4096) };
const outlookReady = (page) =>
  page.waitForFunction(() => {
    const d = document.querySelector('iframe.marxy-sandbox')?.contentDocument;
    return !!d && d.readyState === 'complete' && d.querySelector('h2') !== null;
  });

test('an Outlook message reads as a mail: its head, the HTML Outlook wrapped in its RTF, attachments, the message it answers', async () => {
  await withFrame({ files: OUTLOOK, open: ['/r/README.md'] }, async (page) => {
    const off = watchNetwork(page);
    await open(page, MSG);
    await page.waitForSelector('.marxy-mailpage');
    await outlookReady(page);
    assert.equal(await page.getAttribute('[data-marxy-viewer]', 'data-marxy-viewer'), 'mail');
    assert.equal(await page.textContent('.marxy-mail-kicker'), 'An Outlook message · multipart/mixed · 4 parts');
    assert.equal(await page.textContent('.marxy-mail-subject'), 'Re: Gauge 4 after the storm');
    assert.equal(
      await page.innerText('.marxy-mail-who'),
      'From\nHarbour Office office@harbour.example\nTo\nReader Lab lab@reader.example\nCc\nTide Desk tides@harbour.example\nDate\nMon 2 Nov 2026, 08:14 +0000, as the message writes it\nReceived\nMon 2 Nov 2026, 08:14 +0000, as the message writes it',
    );
    assert.match(await page.innerText('.marxy-mail-bar'), /sent as both; the HTML part first/);
    const inside = await page.evaluate(() => {
      const d = document.querySelector('iframe.marxy-sandbox').contentDocument;
      return { heading: d.querySelector('h2').textContent, cells: [...d.querySelectorAll('td')].map((t) => t.textContent), scripts: d.querySelectorAll('script').length };
    });
    assert.deepEqual(inside, { heading: 'Gauge 4 after the storm', cells: ['Thu', '08:14', '0.4 m', 'Fri', '08:51', '0.5 m'], scripts: 0 });
    const cards = await page.$$eval('.marxy-mail-card', (bs) => bs.map((b) => [b.dataset.marxyAttach, b.querySelector('.marxy-mail-card-sub').textContent]));
    assert.deepEqual(cards, [
      ['low-water-november.csv', 'text/csv · 86 bytes'],
      ['Gauge 4 after the storm.eml', 'message/rfc822 · 386 bytes'],
    ]);
    assert.match(await cardText(page, 'reading'), /^Shown as an Outlook message, 2 attachments$/m);
    // The message it answers opens as a mail of its own, held in memory.
    await page.click('.marxy-mail-card[data-marxy-attach="Gauge 4 after the storm.eml"]');
    await page.waitForFunction(() => /^archive-entry:\d+\/Gauge 4 after the storm\.eml$/.test(window.__marxyHandle.panes().panes[0].path() ?? ''));
    await page.waitForFunction(() => document.querySelector('.marxy-mail-subject')?.textContent === 'Gauge 4 after the storm');
    assert.match(await page.innerText('.marxy-mail-text'), /^Hello,/);
    for (const m of ['writeFileAtomic', 'writeFileNew']) assert.deepEqual((await calls(page, m)).filter(([p]) => /archive-entry:|gauge/i.test(String(p))), [], m);
    assert.deepEqual(off, []);
  });
});

test('an Outlook message’s Source is its bytes, and Export offers them and the message as an .eml', async () => {
  await withFrame({ files: OUTLOOK, open: [MSG] }, async (page) => {
    await outlookReady(page);
    const built = await page.evaluate(async () => {
      const v = window.__marxyHandle.panes().focused.content.viewer();
      return Promise.all(v.exports('rendered').map(async (e) => {
        const { bytes } = await e.build();
        return [e.name, e.extension, bytes.length, [...bytes.slice(0, 4)]];
      }));
    });
    assert.deepEqual(built.map(([n, x]) => [n, x]), [['The message, as it is', 'msg'], ['gauge-4-reply as a mail message', 'eml'], ['The text part', 'txt'], ['The HTML part, cleaned', 'html']]);
    assert.equal(built[0][2], readFileSync(join(demo, 'gauge-4-reply.msg')).length, 'every byte');
    assert.deepEqual(built[0][3], [0xd0, 0xcf, 0x11, 0xe0]);
    assert.deepEqual(built[1][3], [...Buffer.from('Date')]);
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-hexpage').length > 0);
  });
});

test('an Outlook message the build cannot read is the file card, which says why', async () => {
  await withFrame({ files: OUTLOOK, open: ['/r/mail/other.msg'] }, async (page) => {
    await page.waitForSelector('.marxy-fcard-kicker');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'An Outlook message the app cannot read');
    assert.match(await page.textContent('.marxy-fcard-why'), /This build reads only the demo’s own Outlook messages/);
  });
});
