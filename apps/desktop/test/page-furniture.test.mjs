// A page's furniture, kept to one line and kept off the text: the caption is the key that opens How this is shown
// beneath it (a viewer's key ends its toolbar row; a page inside a page has none, and a gzip's page has one); the page
// keeps a foot as tall as the verb bar; one event says one notice; a find field stays with the document it was opened on.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { gzipSync } from 'node:zlib';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const long = ['# Long', '', ...Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} of the long page, with enough words in it to wrap once or twice across the measure of the column.\n`), 'The last line of the page.', ''].join('\n');
const FILES = {
  '/r/release.json': readFileSync(join(demo, 'data', 'release.json')),
  '/r/config.md': readFileSync(join(demo, 'tidemark', 'docs', 'config.md')),
  '/r/harbour.jpg': readFileSync(join(demo, 'images', 'harbour-at-low-water.jpg')),
  '/r/tide-table.txt.gz': readFileSync(join(demo, 'archives', 'tide-table.txt.gz')),
  '/r/tidemark-0.5.0.zip': readFileSync(join(demo, 'archives', 'tidemark-0.5.0.zip')),
  '/r/long.md': long,
  '/r/a.md': '# Alpha\n\nThe index is read once. The index is small.\n',
  '/r/b.md': '# Beta\n\nNothing about it here.\n',
  '/r/c.md': '# Gamma\n\nAnother page.\n',
  '/r/icon.png.gz': gzipSync(readFileSync(join(demo, 'images', 'tidemark-icon.png'))),
  '/r/ragged.pdf.gz': gzipSync(readFileSync(join(demo, 'reading', 'the-case-for-ragged-lines.pdf'))),
};

/** Every key to an account the reader can see, with what it says and where it is. */
const keys = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-account-key')]
      .filter((k) => k.getClientRects().length > 0 && getComputedStyle(k).visibility !== 'hidden')
      .map((k) => {
        const r = k.getBoundingClientRect();
        return { text: k.textContent, label: k.getAttribute('aria-label'), expanded: k.getAttribute('aria-expanded'), top: r.top, bottom: r.bottom, bar: k.parentElement.className, last: k.parentElement.lastElementChild === k };
      }),
  );
const bodyShown = (page, sel = '.marxy-account-body') =>
  page.evaluate((sel) => [...document.querySelectorAll(sel)].some((b) => b.getClientRects().length > 0 && getComputedStyle(b).display !== 'none'), sel);

test('a reading has one line of meta: its caption is the key, keyboard reachable, and opens the account beneath it', async () => {
  await withFrame({ files: FILES, open: ['/r/release.json'] }, async (page) => {
    const [key, ...more] = await keys(page);
    assert.equal(more.length, 0, 'one key');
    assert.equal(key.text, 'JSON · 9 keys at the top · folded past two levels', 'the caption is the key');
    assert.equal(await page.locator('.marxy-reading-head:not(.marxy-account-key .marxy-reading-head)').count(), 0, 'no caption line apart from the key');
    // Its accessible name is the caption; what it does is its description.
    const button = page.getByRole('button', { name: 'JSON · 9 keys at the top · folded past two levels' });
    assert.equal(await button.count(), 1);
    assert.equal(await button.getAttribute('title'), 'How this is shown');
    // The first thing under the key is the data, not a second line of furniture.
    const next = await page.evaluate(() => {
      const box = document.querySelector('.marxy-account');
      const body = box.querySelector('.marxy-account-body');
      return { after: box.nextElementSibling.className, bodyDisplay: getComputedStyle(body).display };
    });
    assert.equal(next.bodyDisplay, 'none', 'folded');
    assert.match(next.after, /marxy-tree|marxy-tnode|marxy-table/);
    // By the keyboard: Tab reaches the key, Enter opens the sentences beneath it, Enter again folds them.
    await button.focus();
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('marxy-account-key')), true);
    await page.keyboard.press('Enter');
    assert.equal(await button.getAttribute('aria-expanded'), 'true');
    assert.equal(await bodyShown(page), true);
    const under = await page.evaluate(() => {
      const k = document.querySelector('.marxy-account-key').getBoundingClientRect();
      const b = document.querySelector('.marxy-account-body').getBoundingClientRect();
      return b.top >= k.bottom - 1;
    });
    assert.equal(under, true, 'the sentences open beneath the key');
    assert.match(await page.textContent('.marxy-account-body'), /Keys are in the order the file writes them/);
    await page.keyboard.press('Enter');
    assert.equal(await button.getAttribute('aria-expanded'), 'false');
    assert.equal(await bodyShown(page), false);
  });
});

test('a viewer puts its key at the end of its toolbar row, and the account opens under the row', async () => {
  await withFrame({ files: FILES, open: ['/r/harbour.jpg'] }, async (page) => {
    await page.waitForSelector('.marxy-imgbar .marxy-account-key');
    const [key, ...more] = await keys(page);
    assert.equal(more.length, 0, 'one key');
    assert.equal(key.bar, 'marxy-imgbar');
    assert.equal(key.last, true, 'at the end of the row');
    assert.match(key.text, /^JPEG · \d+ × \d+$/, 'the caption is the image\'s format and size');
    assert.equal(await page.locator('.marxy-imgpage > .marxy-account').count(), 0, 'no line of its own under the bar');
    await page.click('.marxy-imgbar .marxy-account-key');
    const band = await page.evaluate(() => {
      const bar = document.querySelector('.marxy-imgbar').getBoundingClientRect();
      const body = document.querySelector('.marxy-imgpage > .marxy-account-body');
      const r = body.getBoundingClientRect();
      return { shown: getComputedStyle(body).display !== 'none', below: r.top >= bar.bottom - 1, text: body.textContent };
    });
    assert.equal(band.shown, true);
    assert.equal(band.below, true, 'under the bar');
    assert.match(band.text, /Drawn by the webview from the file’s own bytes/);
    await page.click('.marxy-imgbar .marxy-account-key');
  });
});

test('a fenced block inside a Markdown page carries no caption and no key', async () => {
  await withFrame({ files: FILES, open: ['/r/config.md'] }, async (page) => {
    await page.waitForSelector('.marxy-part');
    assert.deepEqual(await keys(page), [], 'no key on the page');
    const inPart = await page.evaluate(() =>
      [...document.querySelectorAll('.marxy-part .marxy-reading-head, .marxy-part .marxy-account')].filter((e) => e.getClientRects().length > 0).length,
    );
    assert.equal(inPart, 0, 'nothing of a caption drawn in the part');
    assert.match(await page.textContent('.marxy-part'), /root/);
  });
});

test('a gzip page draws the fold once', async () => {
  await withFrame({ files: FILES, open: ['/r/tide-table.txt.gz'] }, async (page) => {
    await page.waitForFunction(() => /Low water at six/.test(document.querySelector('.marxy-arch-one')?.textContent ?? ''));
    const all = await keys(page);
    assert.equal(all.length, 1, JSON.stringify(all));
    assert.equal(all[0].label, 'How this is shown', 'the chevron before the lede, named');
    assert.equal(await page.textContent('.marxy-arch-lede'), 'A gzip stream of one file: tide-table.txt. 318 bytes in the file, 502 bytes unpacked. It is read below as what it is.');
    await page.click('.marxy-account-key');
    assert.match(await page.evaluate(() => [...document.querySelectorAll('.marxy-account-body')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent).join('|')), /^Nothing is unpacked to disk/);
    await page.click('.marxy-account-key');
  });
});

for (const [name, inner] of [['/r/icon.png.gz', '.marxy-imgpage'], ['/r/ragged.pdf.gz', '.marxy-pdfpage']]) {
  test(`a gzipped ${name.endsWith('.pdf.gz') ? 'PDF' : 'image'} draws one key and one account, the archive page's`, async () => {
    await withFrame({ files: FILES, open: [name] }, async (page) => {
      await page.waitForSelector(`.marxy-arch-one ${inner}`, { timeout: 20_000 });
      await page.waitForTimeout(300);
      const all = await keys(page);
      assert.equal(all.length, 1, JSON.stringify(all));
      assert.equal(all[0].label, 'How this is shown');
      assert.equal(await page.locator(`.marxy-arch-one .marxy-account-key, .marxy-arch-one .marxy-account-body`).count(), 0, 'the page inside builds none');
      await page.click('.marxy-account-key');
      const bodies = await page.evaluate(() => [...document.querySelectorAll('.marxy-account-body')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent));
      assert.equal(bodies.length, 1, JSON.stringify(bodies));
      assert.match(bodies[0], /^Nothing is unpacked to disk/);
      await page.click('.marxy-account-key');
    });
  });
}

test('the page keeps a foot as tall as the verb bar: no line is under the bar, and the last line clears it', async () => {
  await withFrame({ files: FILES, open: ['/r/long.md'], viewport: { width: 1200, height: 700 } }, async (page) => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('j');
    await page.waitForSelector('.marxy-verb-bar:not([hidden])');
    // Mid-page: the pane's foot is pinned to the bottom of the view, in the page's ground, over the text, and the bar and
    // the room above it lie inside it. (The foot takes no pointer, so it is read from its style, not hit-tested.)
    const mid = await page.evaluate(() => {
      const pane = document.querySelector('[data-marxy-pane="0"]');
      const foot = getComputedStyle(pane, '::after');
      const bar = document.querySelector('.marxy-verb-bar').getBoundingClientRect();
      const height = parseFloat(foot.height);
      return {
        content: foot.content, position: foot.position, bottom: foot.bottom, z: foot.zIndex,
        ground: foot.backgroundColor === getComputedStyle(document.querySelector('[data-marxy-pane="0"] .marxy-article')).backgroundColor,
        barInside: bar.top >= innerHeight - height && bar.bottom <= innerHeight,
        roomAbove: bar.top - (innerHeight - height),
        scrolled: document.scrollingElement.scrollTop,
      };
    });
    assert.equal(mid.content, '""');
    assert.equal(mid.position, 'sticky');
    assert.equal(mid.bottom, '0px');
    assert.equal(mid.ground, true, 'drawn in the page\'s ground');
    assert.ok(Number(mid.z) > 0, 'over the text');
    assert.equal(mid.barInside, true, 'the bar sits in the foot');
    assert.ok(mid.roomAbove >= 8, `with room above it (${mid.roomAbove} px)`);
    // At the end: the last line is above the bar.
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.waitForTimeout(200);
    const end = await page.evaluate(() => {
      const bar = document.querySelector('.marxy-verb-bar').getBoundingClientRect();
      const last = [...document.querySelectorAll('[data-marxy-pane="0"] .marxy-article > p')].at(-1).getBoundingClientRect();
      return { last: last.bottom, bar: bar.top, hidden: document.querySelector('.marxy-verb-bar').hidden };
    });
    assert.equal(end.hidden, false);
    assert.ok(end.last <= end.bar, `the last line (${end.last}) clears the bar (${end.bar})`);
  });
});

test('without the verb bar there is no foot; with it, a part brought into view stops above the bar', async () => {
  await withFrame({ files: FILES, open: ['/r/long.md'], viewport: { width: 1200, height: 700 } }, async (page) => {
    const foot = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-marxy-pane="0"]'), '::after').content);
    assert.equal(await page.locator('.marxy-verb-bar:not([hidden])').count(), 0);
    assert.equal(await foot(), 'none', 'no band while no bar shows');
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('j');
    await page.waitForSelector('.marxy-verb-bar:not([hidden])');
    assert.equal(await foot(), '""');
    // The cursor walked down the page, one part at a time, each brought into view only as far as it must.
    for (let i = 0; i < 24; i++) await page.keyboard.press('j');
    await page.waitForTimeout(300);
    const walked = await page.evaluate(() => {
      const bar = document.querySelector('.marxy-verb-bar').getBoundingClientRect();
      const at = document.querySelector('[data-marxy-pane="0"] .marxy-cursor').getBoundingClientRect();
      return { bottom: at.bottom, bar: bar.top, scrolled: document.scrollingElement.scrollTop };
    });
    assert.ok(walked.scrolled > 0, 'the page scrolled');
    assert.ok(walked.bottom <= walked.bar, `the cursor's part (${walked.bottom}) is above the bar (${walked.bar})`);
    // A part scrolled to by the nearest edge (a viewer's cursor, a link's target) stops above the band too.
    const nearest = await page.evaluate(async () => {
      document.scrollingElement.scrollTop = 0;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const p = [...document.querySelectorAll('[data-marxy-pane="0"] .marxy-article > p')][30];
      p.scrollIntoView({ block: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const bar = document.querySelector('.marxy-verb-bar').getBoundingClientRect();
      return { bottom: p.getBoundingClientRect().bottom, bar: bar.top };
    });
    assert.ok(nearest.bottom <= nearest.bar, `scrolled by the nearest edge (${nearest.bottom}) it is above the bar (${nearest.bar})`);
    // The window's scroll padding is the bar's while it shows, and goes with it.
    const padding = () => page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom);
    assert.notEqual(await padding(), 'auto');
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Escape');
    await page.waitForSelector('.marxy-verb-bar', { state: 'hidden' });
    assert.equal(await padding(), 'auto', 'no scroll padding with no bar');
    await page.keyboard.press('j');
    await page.waitForSelector('.marxy-verb-bar:not([hidden])');
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-marxy-pane="0"]'), '::after').display), 'none', 'not printed');
    await page.emulateMedia({ media: 'screen' });
  });
});

test('opening an archive\'s entry says one notice, not two', async () => {
  await withFrame({ files: FILES, open: ['/r/tidemark-0.5.0.zip'] }, async (page) => {
    await page.waitForSelector('.marxy-arow');
    await page.dblclick('.marxy-arow:has(.marxy-arch-name:text-is("config.md"))');
    await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent === 'Configuration');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-notice').length > 0);
    // Anything the open would add comes within a beat; wait past it.
    await page.waitForTimeout(600);
    const said = await page.$$eval('.marxy-notice-text', (els) => els.map((e) => e.textContent));
    assert.deepEqual(said, ['An entry of tidemark-0.5.0.zip, opened into memory when you asked: tidemark-0.5.0/docs/config.md. It is not on disk, and nothing here can be edited.']);
  });
});

/** The find field drawn in pane `slot`, and what it says. */
const findIn = (page, slot) =>
  page.evaluate((slot) => {
    const input = document.querySelector(`[data-marxy-pane="${slot}"] .marxy-find-input`);
    return input ? { query: input.value, count: document.querySelector(`[data-marxy-pane="${slot}"] .marxy-find-count`).textContent } : null;
  }, slot);
const openIn = (page, slot, path) =>
  page.evaluate(({ slot, path }) => window.__marxyHandle.panes().openIn(slot, path), { slot, path });

test('a find field stays with its document: another document puts it away, and it comes back with its own', async () => {
  await withFrame({ files: FILES, open: ['/r/a.md', '/r/b.md'] }, async (page, { mod }) => {
    await page.evaluate(() => window.__marxyHandle.panes().focus(window.__marxyHandle.panes().panes[0]));
    await page.keyboard.press(`${mod}+f`);
    await page.keyboard.type('index');
    await page.waitForFunction(() => /of 2/.test(document.querySelector('[data-marxy-pane="0"] .marxy-find-count')?.textContent ?? ''));
    // Another document in its pane: the field goes, and is not left over that document.
    await openIn(page, 0, '/r/c.md');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article h1')?.textContent === 'Gamma');
    assert.equal(await findIn(page, 0), null, 'no field over Gamma');
    assert.equal(await findIn(page, 1), null, 'nor over Beta in the other pane');
    // Its document again, in the other pane this time: the field comes back there, with its words, matched.
    await openIn(page, 1, '/r/a.md');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="1"] .marxy-find-input') !== null);
    await page.waitForFunction(() => /of 2/.test(document.querySelector('[data-marxy-pane="1"] .marxy-find-count')?.textContent ?? ''));
    assert.equal((await findIn(page, 1)).query, 'index');
    assert.equal(await findIn(page, 0), null);
    // Away again (the tab in that pane goes to Beta), and back.
    await openIn(page, 1, '/r/b.md');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="1"] .marxy-article h1')?.textContent === 'Beta');
    assert.equal(await findIn(page, 1), null);
    await openIn(page, 1, '/r/a.md');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="1"] .marxy-find-input')?.value === 'index');
  });
});

test('a find put away does not come back over a find the reader has open on another document', async () => {
  await withFrame({ files: FILES, open: ['/r/a.md', '/r/b.md'] }, async (page, { mod }) => {
    await page.evaluate(() => window.__marxyHandle.panes().focus(window.__marxyHandle.panes().panes[0]));
    await page.keyboard.press(`${mod}+f`);
    await page.keyboard.type('index');
    await page.waitForFunction(() => /of 2/.test(document.querySelector('[data-marxy-pane="0"] .marxy-find-count')?.textContent ?? ''));
    await openIn(page, 0, '/r/c.md');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article h1')?.textContent === 'Gamma');
    // The reader finds in Beta now.
    await page.evaluate(() => window.__marxyHandle.panes().focus(window.__marxyHandle.panes().panes[1]));
    await page.keyboard.press(`${mod}+f`);
    await page.keyboard.type('about');
    await page.waitForFunction(() => /of 1/.test(document.querySelector('[data-marxy-pane="1"] .marxy-find-count')?.textContent ?? ''));
    // Alpha comes back in the left pane: Beta's find stays, and Alpha's does not come back over it.
    await openIn(page, 0, '/r/a.md');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article h1')?.textContent === 'Alpha');
    await page.waitForTimeout(800);
    assert.deepEqual(await findIn(page, 1), { query: 'about', count: '1 of 1' });
    assert.equal(await findIn(page, 0), null);
  });
});

test('a find put away is let go when its document\'s tab closes, and when the reader closes a find', async () => {
  await withFrame({ files: FILES, open: ['/r/a.md'] }, async (page, { mod }) => {
    const putAway = async () => {
      await page.keyboard.press(`${mod}+f`);
      await page.keyboard.type('index');
      await page.waitForFunction(() => /of 2/.test(document.querySelector('[data-marxy-pane="0"] .marxy-find-count')?.textContent ?? ''));
      await openIn(page, 0, '/r/c.md');
      await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article h1')?.textContent === 'Gamma');
    };
    await putAway();
    await page.click('.marxy-tabbar .marxy-tab:has(.marxy-tab-name:text-is("a.md")) .marxy-tab-close');
    await page.waitForFunction(() => ![...document.querySelectorAll('.marxy-tabbar .marxy-tab-name')].some((n) => n.textContent === 'a.md'));
    await openIn(page, 0, '/r/a.md');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article h1')?.textContent === 'Alpha');
    await page.waitForTimeout(800);
    assert.equal(await findIn(page, 0), null, 'its tab closed: it does not come back');
    // Put away again, then a find opened and closed by the reader on Gamma: Alpha's is let go too.
    await putAway();
    await page.keyboard.press(`${mod}+f`);
    await page.keyboard.press('Escape');
    await openIn(page, 0, '/r/a.md');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article h1')?.textContent === 'Alpha');
    await page.waitForTimeout(800);
    assert.equal(await findIn(page, 0), null, 'the reader closed a find since: it does not come back');
  });
});

test('the same document opened in the other pane leaves the find where it is', async () => {
  await withFrame({ files: FILES, open: ['/r/a.md', '/r/b.md'] }, async (page, { mod }) => {
    await page.evaluate(() => window.__marxyHandle.panes().focus(window.__marxyHandle.panes().panes[0]));
    await page.keyboard.press(`${mod}+f`);
    await page.keyboard.type('index');
    await page.waitForFunction(() => /of 2/.test(document.querySelector('[data-marxy-pane="0"] .marxy-find-count')?.textContent ?? ''));
    await openIn(page, 1, '/r/a.md');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="1"] .marxy-article h1')?.textContent === 'Alpha');
    await page.waitForTimeout(800);
    assert.equal((await findIn(page, 0))?.query, 'index', 'still in the pane it was opened in');
    assert.equal(await findIn(page, 1), null, 'and not moved to the other');
  });
});

test('the verb bar coming up changes no attribute of the root and the root\'s scroll padding is a plain length', async () => {
  await withFrame({ files: FILES, open: ['/r/long.md'], viewport: { width: 1200, height: 700 } }, async (page) => {
    const customs = () => page.evaluate(() => [...document.documentElement.style].filter((name) => name.startsWith('--')).sort());
    const before = await customs();
    await page.evaluate(() => {
      window.__rootAttrs = [];
      new MutationObserver((records) => {
        for (const r of records) window.__rootAttrs.push(r.attributeName);
      }).observe(document.documentElement, { attributes: true });
    });
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('j');
    await page.waitForSelector('.marxy-verb-bar:not([hidden])');
    const seen = await page.evaluate(() => {
      const rootRules = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (rule.style && /:root/.test(rule.selectorText) && /var\(/.test(rule.style.getPropertyValue('scroll-padding-bottom'))) rootRules.push(rule.selectorText);
        }
      }
      return {
        attrs: window.__rootAttrs.filter((a) => a !== 'style'),
        padding: getComputedStyle(document.documentElement).scrollPaddingBottom,
        inline: document.documentElement.style.scrollPaddingBottom,
        rootRules,
      };
    });
    // A `var()` in the root's style, or an attribute the style sheet reads there, restyles every element of a long page.
    assert.deepEqual(seen.attrs, []);
    assert.deepEqual(seen.rootRules, []);
    assert.match(seen.inline, /^\d+(\.\d+)?px$/, 'the root\'s own scroll padding is written as a length, not through var()');
    assert.match(seen.padding, /^\d+(\.\d+)?px$/);
    assert.deepEqual(await customs(), before, 'no custom property is set on the root as the bar comes up');
  });
});
