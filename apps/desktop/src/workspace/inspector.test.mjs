// The inspector (W-09): the real app on the shipped skeleton and CSS over the memory shell, in WebKit
// (test/support/two-pane.mjs). What it checks is what the reader sees: the strip, the Links rows and their status, the
// landing on a link, a Source-default file that is never parsed for the tab, nothing fetched, the keys, and a reading column that
// does not move. The tab table is inspector.test.ts; the link and path rules are links-tab.test.ts.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from '../../test/support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const filler = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i} runs long enough to be a paragraph of the reading column and no more than that.`).join('\n\n');
const files = {
  '/r/Notes.md': [
    '# Notes', '',
    'First [apple.com](https://xn--pple-43d.com/login) and [a fair one](https://example.com/docs).', '',
    'The code is in `lib/a.ts`, and `lib/gone.ts` is not there; `node_modules/p/y.js` sits where nothing is claimed.', '',
    filler(60), '',
    'Far down: [the far link](https://far.example/page).', '',
    filler(10), '',
  ].join('\n'),
  '/r/Plain.md': '# Plain\n\nNo links and no paths.\n',
  '/r/Sections.md': '# A\n\na one\n\n## B\n\nb\n\n# C\n\nc\n',
  '/r/lib/a.ts': 'export const a = 1;\n',
  '/r/node_modules/p/x.js': 'x\n',
  '/r/s.py': '# see `src/helper.py` and [not a link](https://x.example)\ndef f():\n    return 1\n',
  '/r/src/helper.py': 'x = 1\n',
};

async function withPage(width, fn, { open = ['/r/Notes.md'], dock = true, unfold = true, onPage } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    onPage?.(page);
    await bootTwoPanes(page, { files, open });
    if (unfold) await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    if (unfold && dock) await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
    // The Links rows are drawn on the app's own signal, not synchronously: wait for the first row, not for a while.
    if (unfold && dock) await page.waitForSelector('.marxy-links [data-marxy-link-row]');
    await fn(page);
  } finally {
    await browser.close();
  }
}

// Two animation frames: whatever the last action scheduled for the next paint has run. Counts frames, not milliseconds.
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
// Opens `path` and waits until the Links tab shows what that document holds (`ready` runs in the page), not for a while.
const openFile = async (page, path, ready) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.waitForFunction(ready);
};
// Every path row drawn (n of them) and none still checking. A bare "none is checking" is true before the rows exist.
const pathsChecked = (page, n) =>
  page.waitForFunction((count) => {
    const s = [...document.querySelectorAll('[data-marxy-link-row=path] .marxy-link-status')];
    return s.length === count && s.every((x) => x.textContent !== 'checking');
  }, n);
const tabsOf = (page) => page.evaluate(() => [...document.querySelectorAll('[data-marxy-inspector-tab]')].map((t) => t.getAttribute('data-marxy-inspector-tab')));
const rowsOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-marxy-link-row]')].map((r) => ({
      kind: r.getAttribute('data-marxy-link-row'),
      text: r.querySelector('.marxy-link-text')?.textContent,
      dest: r.querySelector('.marxy-link-dest')?.textContent ?? null,
      mismatch: r.querySelector('.marxy-link-mismatch')?.textContent ?? null,
      status: r.querySelector('.marxy-link-status')?.textContent ?? null,
      label: r.getAttribute('aria-label'),
      anchor: r.closest('a') !== null || r.querySelector('a') !== null,
    })),
  );
const column = (page) => page.evaluate(() => { const r = document.getElementById('doc').getBoundingClientRect(); return { x: r.x, width: r.width }; });

test('folded there is no inspector element; unfolded it holds Links, Outline and Versions, and a registered stub adds a tab and its withdrawal takes it away', async () => {
  await withPage(1700, async (page) => {
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-inspector, [data-marxy-inspector-tab], [data-marxy-link-row]').length), 0, 'folded');
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    await page.waitForSelector('[data-marxy-inspector-tab]');
    assert.deepEqual(await tabsOf(page), ['links', 'outline', 'versions']);
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-inspector-tab]').getAttribute('aria-selected')), 'true');
    await page.evaluate(async () => {
      const { registerInspectorTab } = await import('/src/workspace/inspector.ts');
      window.__off = registerInspectorTab({ id: 'stub', title: 'Stub', mount: (el) => { el.textContent = 'stub panel'; return () => { el.textContent = ''; }; } });
    });
    assert.deepEqual(await tabsOf(page), ['links', 'outline', 'versions', 'stub']);
    await page.click('[data-marxy-inspector-tab="stub"]');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-inspector-panel').textContent), 'stub panel');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-link-row]').length), 0, 'the Links panel was let go');
    await page.evaluate(() => window.__off());
    assert.deepEqual(await tabsOf(page), ['links', 'outline', 'versions'], 'the withdrawn tab is gone, and the shell falls back to the first');
    assert.ok((await rowsOf(page)).length > 0, 'Links is mounted again');
    await page.evaluate(() => window.__marxyHandle.workspace().fold());
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-inspector, [data-marxy-inspector-tab]').length), 0, 'folded again');
  }, { unfold: false });
});

test('a link whose text names apple.com and whose target is punycode shows the real destination and the warning; clicking it moves the document to that link', async () => {
  await withPage(1700, async (page) => {
    const rows = await rowsOf(page);
    const links = rows.filter((r) => r.kind === 'link');
    assert.deepEqual(links.map((r) => [r.text, r.dest]), [
      ['apple.com', 'https://xn--pple-43d.com/login'],
      ['a fair one', 'https://example.com/docs'],
      ['the far link', 'https://far.example/page'],
    ]);
    assert.ok(links[0].mismatch?.includes('xn--pple-43d.com'), String(links[0].mismatch));
    assert.equal(links[1].mismatch, null);
    assert.ok(links.every((r) => !r.anchor), 'a destination is text: nothing here is a link to follow');
    assert.ok(links[0].label.includes('Warning'), links[0].label);
    assert.ok(rows.every((r) => r.label && r.label.length > 0), 'every row has an accessible name');
    const before = await page.evaluate(() => window.scrollY);
    await page.click('[data-marxy-link-row="link"] >> text=the far link');
    await page.waitForFunction(() => window.scrollY > 500 && [...document.querySelectorAll('#doc a')].some((x) => x.textContent.startsWith('the far link')));
    const target = await page.evaluate(() => {
      const a = [...document.querySelectorAll('#doc a')].find((x) => x.textContent.startsWith('the far link'));
      const r = a.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: window.innerHeight };
    });
    assert.ok(before < 100 && target.bottom > 0 && target.top < target.h, `the far link is on screen: ${JSON.stringify(target)}`);
  });
});

test('paths: one that exists reads found, one that does not reads not found, one under a deny-listed folder reads not checked', async () => {
  await withPage(1700, async (page) => {
    await pathsChecked(page, 3);
    const paths = (await rowsOf(page)).filter((r) => r.kind === 'path');
    assert.deepEqual(paths.map((r) => [r.text, r.status]), [['lib/a.ts', 'found'], ['lib/gone.ts', 'not found'], ['node_modules/p/y.js', 'not checked']]);
    assert.deepEqual(paths.map((r) => r.label), ['lib/a.ts, found', 'lib/gone.ts, not found', 'node_modules/p/y.js, not checked']);
  });
});

test('a document with neither says so, and the tab follows the focused document', async () => {
  await withPage(1700, async (page) => {
    await openFile(page, '/r/Plain.md', () => document.querySelector('.marxy-links')?.textContent.includes('No paths are named in this document.'));
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-link-row]').length), 0);
    const text = await page.evaluate(() => document.querySelector('.marxy-links').textContent);
    assert.ok(text.includes('No links in this document.') && text.includes('No paths are named in this document.'), text);
    await openFile(page, '/r/Notes.md', () => document.querySelectorAll('[data-marxy-link-row]').length >= 6);
    assert.ok((await rowsOf(page)).length >= 6);
  });
});

test('a Source-default file is never parsed for the tab: its paths are listed from the bytes, Links say why they are absent, and Rendered, which reads it as code, finds no links', async () => {
  await withPage(1700, async (page) => {
    await page.evaluate(() => { window.__h = window.__marxyHandle; });
    await openFile(page, '/r/s.py', () => document.querySelector('.marxy-links')?.textContent.includes('Links are listed for Markdown'));
    assert.equal(await page.evaluate(() => window.__h.document().parsed()), false, 'a code file opens unparsed');
    await pathsChecked(page, 1);
    const text = await page.evaluate(() => document.querySelector('.marxy-links').textContent);
    assert.ok(text.includes('Links are listed for Markdown'), text);
    assert.deepEqual((await rowsOf(page)).map((r) => [r.kind, r.text, r.status]), [['path', 'src/helper.py', 'found']]);
    assert.equal(await page.evaluate(() => window.__h.document().parsed()), false, 'listing them did not parse the file');
    // The reader's own switch to Rendered makes the parse, and the tab looks again.
    await page.keyboard.press('ControlOrMeta+e');
    await page.waitForFunction(() => window.__h.document().parsed() === true, null, { timeout: 5000 });
    // A code file is code, not Markdown (V-10): `[not a link](...)` in it is not a link, so the tab looks again and now
    // says there are none, where before the parse it said why it did not list them.
    await page.waitForFunction(() => document.querySelector('.marxy-links')?.textContent.includes('No links in this document'), null, { timeout: 5000 });
    const after = await page.evaluate(() => document.querySelector('.marxy-links').textContent);
    assert.ok(!after.includes('Links are listed for Markdown'), after);
    assert.deepEqual((await rowsOf(page)).map((r) => [r.kind, r.text, r.status]), [['path', 'src/helper.py', 'found']]);
  }, { dock: true });
});

test('nothing is fetched: with every request outside the page refused, the tab loads and no request leaves for a link in the document', async () => {
  const seen = [];
  await withPage(1700, async (page) => {
    assert.ok((await rowsOf(page)).filter((r) => r.kind === 'link').length === 3);
    await page.click('[data-marxy-link-row="link"] >> nth=1');
    // No request in flight, and the frames the click scheduled have run; only then is "nothing left" a finding.
    await frames(page);
    await page.waitForLoadState('networkidle');
    assert.deepEqual(seen, [], `requests that left the machine: ${seen.join(', ')}`);
  }, {
    onPage(page) {
      page.on('request', (req) => { if (!/^(http:\/\/127\.0\.0\.1|http:\/\/localhost|data:|blob:)/.test(req.url())) seen.push(req.url()); });
      page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    },
  });
});

test('Tab reaches the inspector once and the arrows move inside it', async () => {
  await withPage(1700, async (page) => {
    await pathsChecked(page, 3);
    const stops = await page.evaluate(() => document.querySelectorAll('[data-marxy-workspace-region="inspector"] [tabindex="0"]').length);
    assert.equal(stops, 1, 'one tab stop in the whole region');
    await page.focus('[data-marxy-inspector-tab="links"]');
    const active = () => page.evaluate(() => { const a = document.activeElement; return a.getAttribute('aria-label') ?? a.textContent; });
    await page.keyboard.press('ArrowDown');
    assert.ok((await active()).startsWith('apple.com'), await active());
    await page.keyboard.press('ArrowDown');
    assert.ok((await active()).startsWith('a fair one'), await active());
    await page.keyboard.press('End');
    assert.equal(await active(), 'node_modules/p/y.js, not checked');
    await page.keyboard.press('ArrowUp');
    assert.equal(await active(), 'lib/gone.ts, not found');
    // Tab leaves the region: it does not walk the other rows.
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-marxy-workspace-region="inspector"]')), null);
    // Shift+Tab comes back to where the reader was, once.
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'lib/gone.ts, not found');
  });
});

test('the Outline tab\'s rows rove with the arrows inside the one tab stop', async () => {
  await withPage(1700, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/Sections.md'));
    await page.click('[data-marxy-inspector-tab="outline"]');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-outline [data-marxy-outline-row]').length === 3);
    const stops = await page.evaluate(() => document.querySelectorAll('[data-marxy-workspace-region="inspector"] [tabindex="0"]').length);
    assert.equal(stops, 1, 'one tab stop in the whole region');
    await page.focus('[data-marxy-inspector-tab="outline"]');
    const active = () => page.evaluate(() => { const a = document.activeElement; return a.getAttribute('aria-label') ?? a.textContent; });
    await page.keyboard.press('ArrowDown');
    assert.equal(await active(), 'Copy outline', 'the first stop in the panel');
    await page.keyboard.press('ArrowDown');
    assert.equal(await active(), 'A, level 1, 5 words');
    await page.keyboard.press('ArrowDown');
    assert.equal(await active(), 'B, level 2, 2 words');
    await page.keyboard.press('End');
    assert.equal(await active(), 'C, level 1, 2 words');
    await page.keyboard.press('ArrowUp');
    assert.equal(await active(), 'B, level 2, 2 words');
    // Tab leaves the region; Shift+Tab comes back to where the reader was, once.
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-marxy-workspace-region="inspector"]')), null);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'B, level 2, 2 words');
    // Home goes to the first stop, the Copy button; Up from the first row goes back to the tab.
    await page.keyboard.press('Home');
    assert.equal(await active(), 'Copy outline');
    await page.keyboard.press('ArrowUp');
    assert.equal(await active(), 'Outline');
  });
});

test('the reading column does not move for the inspector, in a wide window and in a narrow one with the real toolbar', async () => {
  for (const width of [1700, 929]) {
    await withPage(width, async (page) => {
      await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', false));
      await frames(page); // setPanel lays the region out synchronously; this lets the paint it scheduled run
      const undocked = await column(page);
      await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
      await page.waitForSelector('[data-marxy-workspace-region="inspector"] [data-marxy-link-row]');
      await frames(page);
      assert.deepEqual(await column(page), undocked, `the column at ${width} px`);
      const fit = await page.evaluate(() => {
        const bar = document.querySelector('.marxy-toolbar');
        const region = document.querySelector('[data-marxy-workspace-region="inspector"]').getBoundingClientRect();
        const tabs = [...document.querySelectorAll('.marxy-inspector-tab')].map((t) => t.getBoundingClientRect());
        const rows = [...document.querySelectorAll('.marxy-link-row')].map((t) => t.getBoundingClientRect());
        return {
          toggle: [...bar.querySelectorAll('button')].some((b) => /inspector/i.test(b.getAttribute('aria-label') ?? b.textContent ?? '')),
          toolbarOverflow: bar.scrollWidth - bar.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          outside: [...tabs, ...rows].filter((r) => r.left < region.left - 0.5 || r.right > region.right + 0.5).length,
          regionWidth: Math.round(region.width),
        };
      });
      assert.equal(fit.toggle, true, 'the toolbar draws the inspector door now that the region is filled');
      assert.ok(fit.toolbarOverflow <= 0, JSON.stringify(fit));
      assert.ok(fit.pageOverflow <= 0, JSON.stringify(fit));
      assert.equal(fit.outside, 0, JSON.stringify(fit));
    }, {});
  }
});
