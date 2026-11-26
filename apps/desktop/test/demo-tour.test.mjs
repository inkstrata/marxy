// The demo tour (scripts/demo-tour.mjs) as assertions: the app as `vite` serves it to a plain browser, booted over the
// demo files (src/harness/web.ts, fixtures/demo under /demo), driven through the frame, every reading, a page's fenced
// parts, word marks, Levels and zones, the proposals, a Settings write and Export. The tour drives the built demo in Chromium; this runs
// the same steps on the source in WebKit, with no page errors allowed. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, before, test as nodeTest } from 'node:test';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { closeHarness, harnessBase } from './support/two-pane.mjs';
import { cardsOf, panelRows, panelSecs, showPanel, skip } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
let browser = null;
before(async () => {
  if (!skip) browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  await closeHarness();
});

/** A page on the demo with `open` (under fixtures/demo) in front; the log's times are read in New York. */
async function demo(open, fn) {
  const base = await harnessBase();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York' });
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  try {
    await page.goto(`${base}?open=${encodeURIComponent(open)}`);
    await page.waitForFunction(() => window.marxy?.handle);
    // The frame helpers read the handle where the test harness puts it.
    await page.evaluate(() => { window.__marxyHandle ??= window.marxy.handle; });
    await page.waitForFunction(() => document.querySelector('.marxy-article [data-marxy-s]') && document.querySelector('.marxy-rail .marxy-l-rb'));
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, mod);
  } finally {
    await page.close();
  }
  assert.deepEqual(problems, []);
}

const cardTitles = async (page) => (await cardsOf(page)).map((c) => c.title);
/** The fenced parts Metadata lists, by their lines and how each is read. */
const partRows = async (page) => (await panelRows(page, 'metadata')).filter((r) => r.k.startsWith('part:'));
/** "Read as prose + session", as the Reading card said it: the page, then each kind its parts are read as. */
const readingLine = async (page) => `Read as ${['prose', ...new Set((await partRows(page)).map((r) => r.as.split(' · ')[0]))].join(' + ')}`;
const partsText = async (page) => (await partRows(page)).map((r) => `${r.name} ${r.as}`).join('\n');
const openDemo = (page, path) => page.evaluate((p) => window.marxy.handle.open(`/demo/${p}`), path);

test('the plan opens in the frame: the rail, its head and the drawer, its heading set, and the Outline card', async () => {
  await demo('plans/pg16-upgrade-plan.md', async (page) => {
    assert.ok(await page.evaluate(() => !!document.querySelector('.marxy-rail') && !!document.querySelector('.marxy-head') && !!document.querySelector('.marxy-drawer')));
    assert.match(await page.textContent('.marxy-article h1'), /Postgres 14/);
    assert.ok((await panelRows(page, 'outline')).some((r) => r.k.startsWith('h:')), 'Outline lists its headings');
  });
});

test('each data and text file is read as what it is: trees, records, a table, verse and prose', async () => {
  await demo('plans/pg16-upgrade-plan.md', async (page) => {
    const readings = [
      ['data/release.json', 'tree'], ['data/ci.yaml', 'tree'], ['tidemark/tidemark.toml', 'tree'], ['tidemark/docs/releases.xml', 'tree'],
      ['data/index-runs.jsonl', 'records'], ['data/p95-latency.csv', 'table'], ['reading/tide-table.txt', 'verse'], ['tidemark/NOTES', 'prose'],
    ];
    for (const [file, id] of readings) {
      // The last file's page is marked, so the reading read below is the new file's and not the one it replaced.
      await page.evaluate(() => document.querySelector('.marxy-article [data-marxy-reading]')?.setAttribute('data-tour-seen', ''));
      await openDemo(page, file);
      const fresh = '.marxy-article [data-marxy-reading]:not([data-tour-seen])';
      await page.waitForSelector(fresh, { timeout: 10_000 });
      assert.equal(await page.getAttribute(fresh, 'data-marxy-reading'), id, file);
    }
  });
});

test('a column\'s name sorts a table\'s rows, high to low first, and the table says so', async () => {
  await demo('data/p95-latency.csv', async (page) => {
    await page.click('th[data-marxy-sort="3"]');
    await page.waitForSelector('th[aria-sort="descending"]');
    assert.match(await page.textContent('[data-marxy-sort-note]'), /Sorted by/);
  });
});

test('a fence that opens with a prompt reads as a session part; the Reading card names the parts by line; the block menu reads it as written', async () => {
  await demo('handoffs/auth-refactor-handoff.md', async (page) => {
    const session = '.marxy-article pre[data-marxy-part="session"]';
    await page.waitForSelector(session);
    assert.equal((await page.$$(`${session} .marxy-term-prompt`)).length, 2);
    assert.equal(await readingLine(page), 'Read as prose + session');
    assert.match(await partsText(page), /Lines 20 to 27\s*session · guessed/);
    // In view first: the menu closes on a scroll, and a click that scrolls to its target would close it as it opens.
    await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), session);
    await page.waitForFunction((s) => {
      const box = document.querySelector(s).getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    }, session);
    await page.click(session, { button: 'right' });
    const readPart = '.marxy-verb-menu-item[data-row-key="view.read-part"]';
    await page.waitForSelector(readPart);
    assert.match(await page.textContent(readPart), /Read this part another way\s*terminal session/);
    await page.click(readPart);
    await page.click('.marxy-verb-menu-item[data-row-key="part.read-as.written"]');
    await page.waitForSelector('.marxy-article pre[data-marxy-part="written"]');
    assert.equal((await page.$$('.marxy-article pre[data-marxy-part] .marxy-term-prompt')).length, 0);
    assert.match(await partsText(page), /as written · yours/);
    // Kept in readings.json a moment later, by the file's path and the part's first line.
    const kept = () => page.evaluate(async () => {
      try {
        return JSON.parse(new TextDecoder().decode(await window.marxy.shell.readFile('/data/readings.json'))).parts;
      } catch {
        return null;
      }
    });
    // Polled here: waitForFunction takes an async predicate's promise as truthy and would not wait for the write.
    let parts = null;
    for (let i = 0; i < 40 && parts === null; i++) {
      parts = await kept();
      if (parts === null) await page.waitForTimeout(100);
    }
    assert.deepEqual(Object.keys(parts), ['/demo/handoffs/auth-refactor-handoff.md']);
    assert.deepEqual(Object.values(parts['/demo/handoffs/auth-refactor-handoff.md']), ['written']);
  });
});

test("in Source the shape is drawn from the editor's lines, its scrollbar hidden, and a click on it goes there; Read has the spine alone", async () => {
  await demo('tidemark/docs/specs/incremental-indexing.md', async (page) => {
    const kinds = () => page.evaluate(() => {
      const m = document.querySelector('.marxy-mmap');
      return m.hidden ? null : { h: m.querySelectorAll('i.h').length, b: m.querySelectorAll('i.b').length, p: m.querySelectorAll('i.p').length };
    });
    const spineOnly = () => page.evaluate(() => {
      const spine = document.querySelector('.marxy-spine');
      return !!spine && !spine.hidden && [...document.querySelectorAll('.marxy-mmap')].every((m) => m.hidden);
    });
    await page.waitForFunction(() => document.querySelectorAll('.marxy-spine:not([hidden]) .marxy-spine-tick').length > 5);
    // Past the minimap's settling (120 ms), which drew a second strip beside the spine before.
    await page.waitForTimeout(400);
    assert.ok(await spineOnly(), 'Read: the spine, and no minimap beside it');
    const headings = await page.evaluate(() => [...document.querySelector('.marxy-article').children].filter((el) => /^H[1-3]$/.test(el.tagName)).length);
    await page.evaluate(() => window.marxy.handle.toggleMode());
    await page.waitForFunction(() => document.querySelector('.cm-scroller')?.hasAttribute('data-marxy-mmap') && !document.querySelector('.marxy-mmap').hidden);
    const source = await kinds();
    assert.equal(source.h, headings, 'a tick for each heading Read sets');
    assert.ok(source.b > 5 && source.p > 5, JSON.stringify(source));
    const box = await page.evaluate(() => {
      const r = document.querySelector('.marxy-mmap').getBoundingClientRect();
      return { x: r.left + 8, y: r.top + r.height * 0.75 };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForFunction(() => {
      const s = document.querySelector('.cm-scroller');
      return s.scrollTop > s.scrollHeight * 0.5;
    });
    await page.evaluate(() => window.marxy.handle.toggleMode());
    await page.waitForFunction(() => !document.querySelector('.cm-scroller')?.hasAttribute('data-marxy-mmap') && !document.querySelector('.marxy-spine').hidden);
    await page.waitForTimeout(400);
    assert.ok(await spineOnly(), 'back in Read: the spine alone');
  });
});

test('a JSON fence reads as a data tree at the file\'s own bytes, and the Reading card says prose + data + session', async () => {
  await demo('handoffs/release-0.5-handoff.md', async (page) => {
    const row = '.marxy-article .marxy-part[data-marxy-part="data"] [data-marxy-reading="tree"] [data-marxy-s]';
    await page.waitForSelector(row);
    const said = await page.evaluate(async (sel) => {
      const el = document.querySelector(sel);
      const bytes = await window.marxy.shell.readFile('/demo/handoffs/release-0.5-handoff.md');
      return new TextDecoder().decode(bytes.subarray(Number(el.getAttribute('data-marxy-s')), Number(el.getAttribute('data-marxy-e'))));
    }, row);
    assert.equal(said, '"tidemark"');
    assert.equal(await readingLine(page), 'Read as prose + data + session');
  });
});

test('a patch marks the words that changed in a changed line', async () => {
  await demo('patches/pg16-plan-tldr.diff', async (page) => {
    await page.waitForSelector('.marxy-diff-add-word');
    assert.ok((await page.$$('.marxy-diff-del-word')).length > 0);
  });
});

test('a log has the Levels card, and its times can be shown in your zone', async () => {
  await demo('logs/build-2026-10-14.log', async (page) => {
    assert.ok((await panelSecs(page, 'outline')).some(([t]) => t === 'Levels'));
    await showPanel(page, 'outline');
    await page.click('button[role="radio"]:has-text("in your zone")');
    await page.waitForFunction(() => document.querySelector('.marxy-log-time')?.dataset.marxyShown === '12:02:11.402');
  });
});

test('the log page has its day heading, the pauses and its escape code drawn as the warning tone, with the account in the fold; Filter by level to Warn hides the rest, saying so', async () => {
  await demo('logs/build-2026-10-14.log', async (page, mod) => {
    await page.waitForSelector('.marxy-log-day');
    assert.equal(await page.getAttribute('.marxy-log-day', 'data-marxy-day'), 'Wednesday, 14 October 2026');
    assert.deepEqual(await page.$$eval('.marxy-line[data-marxy-gap]', (els) => els.map((l) => l.dataset.marxyGap)), ['+36 s', '+15 s', '+6 s', '+6 s']);
    assert.equal(await page.textContent('.marxy-ansi-warn'), 'indexer');
    assert.match(await page.textContent('.marxy-log-account .marxy-account-body p'), /^The file colours text/);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press(`${mod}+Shift+P`);
    await page.keyboard.type('Filter by level');
    await page.waitForSelector('[data-row-key="log.level"], [role="option"]:has-text("Filter by level")');
    await page.keyboard.press('Enter');
    await page.click('[data-row-key="log.level.warn"]');
    await page.waitForFunction(() => {
      const shown = [...document.querySelectorAll('.marxy-article .marxy-line[data-marxy-rank]')].filter((l) => l.getClientRects().length > 0);
      return shown.map((l) => l.dataset.marxyRank).join() === '2,3' && document.querySelectorAll('.marxy-log-hidden-run').length === 3;
    });
  });
});

test('a photo is a page with its folder a step away, a HEIC falls to the card, a 2 GB disk image reaches its last byte', async () => {
  await demo('plans/pg16-upgrade-plan.md', async (page) => {
    const open = async (p) => {
      await showPanel(page, 'metadata');
      await page.evaluate((x) => window.marxy.handle.open(`/demo/${x}`), p);
      await page.waitForFunction((x) => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === x.slice(x.lastIndexOf('/') + 1), p);
    };
    await open('images/harbour-at-low-water.jpg');
    await page.waitForFunction(() => (document.querySelector('.marxy-imgpic')?.naturalWidth ?? 0) > 0);
    await page.waitForFunction(() => document.querySelector('.marxy-imgbar-pos')?.textContent === '4 of 8 in images/');
    assert.equal(await page.$$eval('.marxy-imgstrip .marxy-imgthumb', (els) => els.length), 8);
    assert.deepEqual(await cardTitles(page), ['Reading', 'Facts', 'EXIF', 'Image']);
    await page.click('.marxy-imgstage');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.marxy-fcard-kicker')?.textContent === 'An image this system cannot draw');
    await open('downloads/IMG_2231');
    await page.waitForFunction(() => document.querySelector('.marxy-guess')?.textContent === 'image · guessed');
    await open('lab/disk-2026-10.img');
    await page.click('.marxy-hexbar-end');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-hexrow .marxy-hex-o')].some((e) => e.textContent === '7FFFFFF0') && document.querySelector('.marxy-hexrow i[data-marxy-on]')?.textContent === '00');
    assert.match(await page.textContent('.marxy-fcard'), /2,147,483,648 bytes/);
    assert.match(await page.innerText('.marxy-fcard'), /GPT disk/);
  });
});

test('on the plan: Space turns the page and marks the lines carried over, the spine is the scrollbar, and a note opens where you read', async () => {
  await demo('plans/pg16-upgrade-plan.md', async (page) => {
    await page.evaluate(() => document.activeElement?.blur());
    const y0 = await page.evaluate(() => document.documentElement.scrollTop);
    await page.keyboard.press('Space');
    await page.waitForFunction((y) => document.documentElement.scrollTop > y && document.querySelectorAll('.marxy-carry').length === 1, y0);
    assert.ok(await page.evaluate(() => {
      const spine = document.querySelector('.marxy-spine');
      return !!spine && !spine.hidden && spine.querySelectorAll('.marxy-spine-tick').length > 5 && [...document.querySelectorAll('.marxy-mmap')].every((m) => m.hidden);
    }), "the page's headings are drawn down its edge, on one bar");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.documentElement.scrollTop === 0);
    // With room the note sits in the margin beside its line; without, a click opens it under the line.
    await page.waitForSelector('.marxy-article > .marxy-note-margin');
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForFunction(() => !document.querySelector('.marxy-note-margin'));
    await page.click('sup.marxy-footnote-ref a');
    await page.waitForSelector('.marxy-note-here');
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});

test('Settings lists the eleven proposals, and a switch writes config.toml', async () => {
  await demo('plans/pg16-upgrade-plan.md', async (page, mod) => {
    await page.keyboard.press(`${mod}+,`);
    await page.waitForSelector('[data-marxy-setting="proposals.log_zone"]');
    assert.equal((await page.$$('[data-marxy-setting^="proposals."]')).length, 11);
    await page.click('[data-marxy-control="proposals.glance"]');
    await page.waitForFunction(async () => {
      const shell = window.marxy.shell;
      return /proposals = \{ glance = true \}/.test(new TextDecoder().decode(await shell.readFile((await shell.configPaths()).config)));
    });
  });
});

test('Export opens on the file in front with a web page chosen', async () => {
  await demo('plans/pg16-upgrade-plan.md', async (page) => {
    await page.evaluate(async () => {
      // Export's command reads nothing from its context.
      await window.marxy.handle.commands().find((c) => c.id === 'document.export').run({});
    });
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="a:html"] .marxy-l-rd.marxy-l-on') && document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'pg16-upgrade-plan.md');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-drawer').contains(document.activeElement));
  });
});
