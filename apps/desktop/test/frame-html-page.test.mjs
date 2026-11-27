// An HTML file lands in Read as a page: the sandbox mail uses, no scripts, nothing from the network, links not followed,
// the form shown and never sent, the line above saying exactly what was left out; Links in the panel. Its code is
// Source, one key or one press away. Every request is watched. WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, cardsOf, panelRows, showCardPanel, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PAGE = '/r/site/harbour-notice.html';
const FILES = {
  '/r/README.md': '# Here\n',
  [PAGE]: readFileSync(join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'site', 'harbour-notice.html')),
  '/r/site/notices/2026.html': '<!doctype html><title>Archive</title><p>The 2026 notices.</p>\n',
};

function watchNetwork(page) {
  const off = [];
  const base = new URL(page.url()).host;
  page.on('request', (r) => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (new URL(u).host !== base) off.push(u);
  });
  return off;
}
const calls = (page, method) => page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => c.method === m).map((c) => c.args), method);
const headSays = (page) => page.evaluate(() => document.querySelector('[data-marxy-head="0"] .marxy-guess:not([hidden])')?.textContent ?? null);
const mode = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.view.mode);

test('an HTML file lands in Read as a page in the sandbox, found by its name, the head quiet', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    const off = watchNetwork(page);
    await page.evaluate((p) => window.__marxyHandle.open(p), PAGE);
    await page.waitForSelector('[data-marxy-viewer="page"] iframe.marxy-sandbox');
    await page.waitForFunction(() => document.querySelector('iframe.marxy-sandbox')?.contentDocument?.querySelector('h1')?.textContent === 'Entrance channel restrictions, 12 to 16 October');
    assert.equal(await mode(page), 'rendered');
    assert.equal(await headSays(page), null);
    // Metadata's Read as names the page as the reading found: a page is no longer a choice of its own.
    await showPanel(page, 'metadata');
    await page.click('.marxy-drawer [data-marxy-left-row="ra:another"]');
    const rows = await panelRows(page, 'metadata');
    assert.equal(rows.find((r) => r.k === 'ra:found')?.name, 'As found: A page');
    assert.equal(rows.find((r) => r.k === 'ra:page'), undefined);
    assert.equal(
      await page.innerText('.marxy-htmlpage-line'),
      'A web page, in a sandbox. Its code, in Source',
    );
    // The image from the network is held back, with mail's offer to load it for this page.
    assert.match(await page.textContent('.marxy-mail-remote'), /^1 image from the network is not loaded\. Loading them tells cdn\.harbour\.example that this page was read, and when\.Load them for this page$/);
    assert.equal(
      await page.textContent('.marxy-htmlpage .marxy-account-body p'),
      'In the sandbox: 2 scripts not run, 1 event handler left out; 1 stylesheet, 1 image, 1 frame from the network not loaded (cdn.harbour.example, maps.harbour.example); 1 form shown, never sent.',
    );
    const inside = await page.evaluate(() => {
      const f = document.querySelector('iframe.marxy-sandbox');
      const d = f.contentDocument;
      return {
        sandbox: f.getAttribute('sandbox'),
        scripts: d.querySelectorAll('script, link, iframe, object, embed').length,
        hrefs: d.querySelectorAll('[href]').length,
        stamp: d.getElementById('stamp').textContent,
        action: d.querySelector('form').hasAttribute('action'),
        disabled: [...d.querySelectorAll('input, button')].every((e) => e.disabled),
        frameLine: [...d.querySelectorAll('div')].some((e) => e.textContent === 'A frame from maps.harbour.example, not loaded.'),
        remote: [...d.querySelectorAll('img[data-marxy-remote]')].map((i) => i.getAttribute('data-marxy-remote')),
        banner: getComputedStyle(d.querySelector('.banner')).backgroundColor,
        ground: getComputedStyle(d.body).backgroundColor,
      };
    });
    assert.equal(inside.sandbox, 'allow-same-origin');
    assert.equal(inside.scripts, 0);
    assert.equal(inside.hrefs, 0);
    assert.equal(inside.stamp, '', 'the script that stamps the page never ran');
    assert.equal(inside.action, false, 'the form names nowhere to send to');
    assert.equal(inside.disabled, true);
    assert.equal(inside.frameLine, true);
    assert.deepEqual(inside.remote, ['https://cdn.harbour.example/img/mouth.jpg']);
    assert.equal(inside.banner, 'rgb(15, 76, 92)', 'its own styles, inside the frame');
    assert.equal(inside.ground, 'rgb(246, 243, 236)', 'on its own ground');
    // Submitting the form sends nothing: there is no action and the frame may not submit.
    await page.evaluate(() => document.querySelector('iframe.marxy-sandbox').contentDocument.querySelector('form').requestSubmit?.());
    // A press on a link in the page follows nothing and says so. WebKit runs no listener inside the frame; the press
    // lands on the app's own box over the link, where the reader's mouse would.
    const tides = page.frameLocator('iframe.marxy-sandbox').locator('a', { hasText: 'tide tables' });
    await tides.scrollIntoViewIfNeeded();
    const box = await tides.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /^https:\/\/harbour\.example\S*: links are not followed inside the page\. The Links panel opens one\.$/.test(n.textContent)));
    assert.equal(await page.evaluate(() => document.querySelector('iframe.marxy-sandbox').contentWindow.location.href), 'about:srcdoc');
    assert.deepEqual(await calls(page, 'openExternal'), []);
    // The panels: Metadata's Reading with its two tiers and Facts, then Links.
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts', 'Links']);
    assert.match(await cardText(page, 'reading'), /^Shown as a page, sandboxed\s+by its name · why\?/);
    assert.match(await cardText(page, 'reading'), /A page, sandboxed\s*no scripts, nothing from the network: Read\s*Its code\s*coloured, as written: Source, where it is edited\s*Its code, in Source/);
    assert.match(await cardText(page, 'links'), /^tide tables\s+harbour\.example\s+2026 notice archive\s+notices\/2026\.html\s+the Harbour Office\s+mailto/);
    await showCardPanel(page, 'links');
    // A relative link in the Links card opens the file beside it; an address opens in the browser.
    await page.click('.marxy-drawer [data-marxy-card="links"] .marxy-link-row:has-text("the Harbour Office")');
    assert.deepEqual(await calls(page, 'openExternal'), [['mailto:office@harbour.example']]);
    assert.deepEqual(off, [], `requests left for the network: ${off.join(', ')}`);
  });
});

test('a page chosen by an earlier Marxy changes nothing; Source is the code, one key away, and Its code goes there', async () => {
  await withFrame({ files: { ...FILES, '/data/readings.json': `${JSON.stringify({ version: 1, parts: {}, pages: [PAGE] }, null, 2)}\n` }, open: ['/r/README.md'] }, async (page, { mod }) => {
    const off = watchNetwork(page);
    await page.evaluate((p) => window.__marxyHandle.open(p), PAGE);
    await page.waitForSelector('[data-marxy-viewer="page"] iframe.marxy-sandbox');
    assert.equal(await headSays(page), null);
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForSelector('.cm-content');
    assert.equal(await mode(page), 'source');
    assert.match(await page.textContent('.cm-content'), /^<!doctype html>/);
    await page.click('.marxy-rs-read');
    await page.waitForSelector('.marxy-htmlpage-line');
    await page.click('.marxy-htmlpage-line .marxy-linkish:has-text("Its code, in Source")');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source' && !document.querySelector('[data-marxy-viewer="page"]:not([hidden]) iframe'));
    assert.deepEqual(off, [], `requests left for the network: ${off.join(', ')}`);
  });
});
