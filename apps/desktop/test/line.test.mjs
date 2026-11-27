// The Line in WebKit: one field, the first character picks the scope (Go, > @ : / # = ! % ~ & ?),
// the page keys that open it in a scope, Tab keeping a result in its left panel, and each scope's rows and Enter.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PLAN_TEXT = [
  '# Release plan',
  '',
  'The plan for 1.0. It holds a debounce note.',
  '',
  '## Scope',
  '',
  '- [ ] Write the watcher',
  '- [x] Ship the walk',
  '',
  '## Rollback',
  '',
  'How to go back, with a debounce of its own.',
  '',
  '```sh',
  'tidemark rebuild',
  '```',
  '',
  ...Array.from({ length: 140 }, (_, i) => `Line ${i + 18} of the plan, a paragraph of its own.\n`),
  '## Last',
  '',
  'The end.',
  '',
].join('\n');

const FILES = {
  '/r/plans/release-plan.md': PLAN_TEXT,
  '/r/notes.md': '# Notes\n\nA note on the debounce.\n\n## Today\n\nNothing else.\n',
  '/r/src/watcher.ts': 'export const debounce = 120;\n// the debounce window\nexport function watch() {}\n',
  '/r/data/latency.csv': 'service,p95_ms\napi,120\nweb,80\n',
  '/r/logs/indexer.log': '2026-10-14T08:00:00Z INFO start\n2026-10-14T08:00:01Z WARN slow\n2026-10-14T08:00:02Z ERROR failed\n2026-10-14T08:00:03Z INFO done\n',
};
const PLAN = '/r/plans/release-plan.md';
const NOTES = '/r/notes.md';
const LOG = '/r/logs/indexer.log';
const CSV = '/r/data/latency.csv';

const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const lineOpen = (page) => page.evaluate(() => document.querySelector('#marxy-palette')?.open === true);
/** The Line as drawn: its scope word, its groups, and each row with its text, detail, group and whether it is chosen. */
const lineRows = (page) =>
  page.evaluate(() => {
    const d = document.querySelector('#marxy-palette');
    return {
      scope: d.querySelector('.marxy-palette-scope').textContent,
      count: d.querySelector('.marxy-palette-count').textContent,
      notice: d.querySelector('.marxy-palette-notice').hidden ? '' : d.querySelector('.marxy-palette-notice').textContent,
      groups: [...d.querySelectorAll('.marxy-palette-section')].map((x) => x.textContent),
      rows: [...d.querySelectorAll('.marxy-palette-row')].map((r) => ({
        t: (r.querySelector('.marxy-palette-title, .marxy-palette-ex')?.textContent ?? '').trim(),
        d: r.querySelector('.marxy-palette-sub')?.textContent ?? '',
        g: r.closest('.marxy-palette-group')?.querySelector('.marxy-palette-section')?.textContent ?? '',
        on: r.getAttribute('aria-selected') === 'true',
        dim: r.hasAttribute('data-marxy-unavailable'),
      })),
    };
  });
/** The cursor's part: its first line (1-based, from the byte it starts at) and its text. */
const cursorAt = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor');
    if (!el) return null;
    const carrier = el.hasAttribute('data-marxy-s') ? el : el.querySelector('[data-marxy-s]');
    const s = Number(carrier?.getAttribute('data-marxy-s') ?? -1);
    const bytes = window.__marxyHandle.document().snapshot().buffer.bytes;
    let line = 1;
    for (let i = 0; i < s; i++) if (bytes[i] === 0x0a) line++;
    const endByte = Number(carrier?.getAttribute('data-marxy-e') ?? s);
    let last = line;
    for (let i = s; i < endByte - 1; i++) if (bytes[i] === 0x0a) last++;
    return { first: line, last, text: el.textContent.trim().split('\n')[0].slice(0, 60) };
  });
const path = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.path());
async function summon(page, mod, text) {
  await blur(page);
  await page.keyboard.press(`${mod}+KeyK`);
  await page.waitForSelector('#marxy-palette[open]');
  if (text) await page.keyboard.type(text);
  await page.waitForTimeout(250);
}

test('25a Ctrl+K: rollb shows a Headings result in the plan; Enter lands on it', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page, { mod }) => {
    await summon(page, mod, 'rollb');
    const s = await lineRows(page);
    assert.equal(s.scope, 'Go');
    const heads = s.rows.filter((r) => r.g === 'Headings');
    assert.ok(heads.length > 0, `a Headings group: ${JSON.stringify(s.groups)}`);
    assert.equal(s.rows[0].g, 'Headings', 'no file is called that: the headings lead');
    assert.equal(s.rows[0].t, 'Rollback', 'the plan heading is the first (selected) result');
    assert.ok(s.rows[0].on);
    assert.match(s.rows[0].d, /Release plan/, 'it names its document');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    assert.equal(await lineOpen(page), false, 'Line closed');
    assert.equal(await path(page), PLAN);
    const at = await page.evaluate(() => {
      const top = document.querySelector('[data-marxy-pane="0"] .marxy-article h2:nth-of-type(2)');
      return top ? top.textContent.trim() : null;
    });
    assert.equal(at, 'Rollback');
  });
});

test('25b Ctrl+K: watcher shows src/watcher.ts under Files; a written path:line goes there with the cursor on it', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page, { mod }) => {
    await summon(page, mod, 'watcher');
    let s = await lineRows(page);
    assert.ok(s.rows.some((r) => r.g === 'Files' && /watcher\.ts/.test(r.t)), JSON.stringify(s.rows.slice(0, 6)));
    await page.keyboard.press(`${mod}+KeyA`);
    await page.keyboard.type('plans/release-plan.md:12');
    await page.waitForTimeout(250);
    s = await lineRows(page);
    assert.deepEqual([s.rows[0].g, s.rows[0].t, s.rows[0].d], ['Reference', 'plans/release-plan.md:12', 'line 12'], 'the reference leads');
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, PLAN);
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor'));
    const c = await cursorAt(page);
    assert.ok(c.first <= 12 && 12 <= c.last, `the cursor's part holds line 12: ${JSON.stringify(c)}`);
  });
});

test('26a Line: > lists commands, with their keys; Mod+Shift+P opens it there', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page, { mod }) => {
    await blur(page);
    await page.keyboard.press(`${mod}+Shift+KeyP`);
    await page.waitForSelector('#marxy-palette[open]');
    await page.waitForTimeout(200);
    const s = await lineRows(page);
    assert.equal(s.scope, 'Commands', 'scope label');
    assert.ok(s.rows.length >= 40, `command rows: ${s.rows.length}`);
    assert.ok(s.rows.some((r) => /Next part/.test(r.t)), 'includes Next part');
    assert.equal(await page.evaluate(() => document.querySelector('#marxy-palette').dataset.marxyScope), 'cmd');
  });
});

test("26b Line: @ lists this document's headings; Enter puts the cursor on one", async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page, { mod }) => {
    await summon(page, mod, '@');
    const s = await lineRows(page);
    assert.equal(s.scope, 'In this document', 'scope label');
    assert.deepEqual(s.rows.map((r) => r.t), ['Release plan', 'Scope', 'Rollback', 'Last'], 'one row per heading, in order');
    assert.equal(s.rows[2].d, 'line 10');
    await page.keyboard.type('last');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor'));
    assert.equal((await cursorAt(page)).text, 'Last');
  });
});

const manyHeadings = (n, pad = '') => Array.from({ length: n }, (_, i) => `## Heading ${i}\n\nBody ${i}. ${pad}\n`).join('\n');

test('26b2 Line: @ draws the first 200 of a document with thousands of headings, and typing reaches the rest', async () => {
  await withFrame({ files: { '/r/many.md': manyHeadings(6000) }, open: ['/r/many.md'] }, async (page, { mod }) => {
    await summon(page, mod, '@');
    let s = await lineRows(page);
    assert.equal(s.rows.length, 200, 'a window of rows, not one per heading');
    assert.equal(s.rows[0].t, 'Heading 0');
    assert.match(s.notice, /The first 200 headings: keep typing to narrow them/);
    await page.keyboard.type('heading 5999');
    await page.waitForTimeout(250);
    s = await lineRows(page);
    assert.equal(s.rows[0].t, 'Heading 5999', 'the field reaches a heading past the window');
    assert.ok(s.rows.length < 200);
  });
});

test('26b3 Line: @ on a Markdown file read as lines (over 5 MiB) lists its headings from the scan and never parses the file', async () => {
  const text = manyHeadings(30_000, 'x'.repeat(170));
  assert.ok(text.length > 5 * 1024 * 1024, `${text.length} bytes`);
  await withFrame({ files: { '/r/huge.md': text }, open: ['/r/huge.md'] }, async (page, { mod }) => {
    await page.waitForFunction(() => document.querySelector('[data-marxy-lines]'));
    await summon(page, mod, '@');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length === 200, null, { timeout: 30_000 });
    const s = await lineRows(page);
    assert.equal(s.rows[0].t, 'Heading 0');
    assert.match(s.rows[0].d, /^line \d+$/);
    assert.equal(await page.evaluate(() => window.__marxyHandle.document().parsed()), false, 'no parse was made for the list');
  });
});

test('26c Line: :120 then Enter puts the cursor on the part holding line 120; a range and a line past the end', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page, { mod }) => {
    await summon(page, mod, ':999');
    let s = await lineRows(page);
    assert.equal(s.scope, 'Line');
    assert.equal(s.rows.length, 0);
    assert.match(s.notice, /A line from 1 to \d+, or a range such as 40-52/);
    await page.keyboard.press(`${mod}+KeyA`);
    await page.keyboard.type(':120');
    await page.waitForTimeout(150);
    s = await lineRows(page);
    assert.equal(s.rows[0].t, 'Go to line 120');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor'));
    const c = await cursorAt(page);
    assert.ok(c.first <= 120 && 120 <= c.last, `cursor part holds line 120: ${JSON.stringify(c)}`);
    // The page key opens the Line already in the scope.
    await blur(page);
    await page.keyboard.press('Shift+Semicolon');
    await page.waitForSelector('#marxy-palette[open]');
    assert.equal(await page.inputValue('#marxy-palette .marxy-palette-query'), ':');
  });
});

test('27 / find: rows for each matching line; Enter goes there and opens in-page find on the query; a capital is exact case', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await blur(page);
    await page.keyboard.press('Slash');
    await page.waitForSelector('#marxy-palette[open]');
    assert.equal(await page.inputValue('#marxy-palette .marxy-palette-query'), '/');
    await page.keyboard.type('debounce');
    await page.waitForTimeout(200);
    let s = await lineRows(page);
    assert.equal(s.scope, 'Find');
    assert.equal(s.count, '2 matches');
    assert.deepEqual(s.rows.map((r) => r.d), ['3', '12']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.marxy-find-input');
    await page.waitForTimeout(200);
    assert.equal(await lineOpen(page), false, 'Line closed on Enter');
    assert.equal(await page.inputValue('.marxy-find-input'), 'debounce', 'in-page find holds the query');
    assert.match(await page.textContent('.marxy-find-count'), /of 2/);
    assert.ok((await cursorAt(page)).text.startsWith('How to go back'), 'the cursor is on the part holding the line');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.marxy-find-input').count(), 0, 'Escape closes find');
    // A capital makes it exact case; /re/ is a regular expression.
    await page.evaluate(() => window.__marxyHandle.panes().focused.host.focus());
    await blur(page);
    await page.keyboard.press('Slash');
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.type('Debounce');
    await page.waitForTimeout(150);
    s = await lineRows(page);
    assert.equal(s.rows.length, 0, 'no line holds Debounce with a capital');
    await page.keyboard.press(`ControlOrMeta+KeyA`);
    await page.keyboard.type('//de(b|c)ounce/');
    await page.waitForTimeout(150);
    assert.equal((await lineRows(page)).count, '2 matches');
  });
});

test('27b / Alt+Enter keeps only the parts that match (a lens); a press on a dashed row shows everything again', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await blur(page);
    await page.keyboard.press('Slash');
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.type('debounce');
    await page.waitForTimeout(150);
    await page.keyboard.press('Alt+Enter');
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => {
      const a = document.querySelector('[data-marxy-pane="0"] .marxy-article');
      const shown = [...a.children].filter((el) => el.getClientRects().length > 0 && !el.classList.contains('marxy-elide')).map((el) => el.textContent.trim().slice(0, 24));
      return { lens: a.dataset.marxyLens, shown, gaps: a.querySelectorAll('.marxy-elide').length };
    });
    assert.equal(s.lens, '“debounce”');
    assert.deepEqual(s.shown, ['Release plan', 'The plan for 1.0. It hol', 'Rollback', 'How to go back, with a d'], 'the matching parts and the headings above them');
    assert.ok(s.gaps >= 2, 'a dashed row for each run left out');
    await page.click('[data-marxy-pane="0"] .marxy-elide');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-elide, .marxy-focus-out').length), 0, 'everything shows again');
  });
});

test('28a # lists hits from three files, grouped by file', async () => {
  // Opened at the top of /r, so the index's place is /r and holds every file.
  await withFrame({ files: FILES, open: [NOTES] }, async (page) => {
    await blur(page);
    await page.keyboard.press('Shift+Digit3');
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.type('debounce');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length >= 4);
    const s = await lineRows(page);
    assert.equal(s.scope, 'Search the workspace');
    const files = [...new Set(s.rows.map((r) => r.g.replace(/\s+\(\d+\)$/, '')))];
    assert.ok(files.length >= 3, `rows grouped under >= 3 files: ${JSON.stringify(files)}`);
    assert.ok(s.rows.every((r) => /^:\d+$/.test(r.d)), 'each row says its line');
  });
});

test('28b # Enter opens a hit at its line with the part holding it selected', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page, { mod }) => {
    await summon(page, mod, '#rebuild');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length === 1);
    const s = await lineRows(page);
    assert.equal(s.rows[0].d, ':15');
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, PLAN);
    await page.waitForTimeout(400);
    const sel = await page.evaluate(() => window.__marxyHandle.selection.state().selection.kind);
    assert.equal(sel, 'node', 'the block holding the match is selected');
  });
});

test('Tab in the Line keeps the scope in its panel', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page, { mod }) => {
    await blur(page);
    await page.keyboard.press('Shift+Digit3');
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.type('max_wait');
    await page.keyboard.press('Tab');
    await drawerShows(page, 'search');
    assert.equal(await lineOpen(page), false, 'Search is open and the Line has closed');
    // The panel takes the keys once it has drawn; give them back to the page.
    await page.waitForTimeout(400);
    await blur(page);
    await page.keyboard.press('Shift+Digit2');
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.press('Tab');
    await drawerShows(page, 'outline');
    await summon(page, mod, 'notes');
    await page.keyboard.press('Tab');
    await drawerShows(page, 'places');
    assert.equal(await lineOpen(page), false);
  });
});

test('= on a log keeps the lines at a level; on a table it asks for the words its rows must hold', async () => {
  await withFrame({ files: FILES, open: [LOG] }, async (page, { mod }) => {
    await summon(page, mod, '=');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length === 4);
    const s = await lineRows(page);
    assert.equal(s.scope, 'Filter rows');
    assert.deepEqual(s.rows.map((r) => r.t), ['All levels', 'Info and above', 'Warn and above', 'Error only']);
    await page.keyboard.type('error');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /below Error/.test(document.querySelector('[data-marxy-pane="0"] .marxy-article').textContent));
    assert.equal(await lineOpen(page), false, 'Line closed');
  });
  await withFrame({ files: FILES, open: [CSV] }, async (page, { mod }) => {
    await summon(page, mod, '=');
    const s = await lineRows(page);
    // A table has a row filter (close-joins.test.mjs drives it): with no words yet, the Line says how.
    assert.equal(s.rows.length, 0);
    assert.match(s.notice, /the rows holding them stay, in the view only/);
  });
});

test('! lists the transforms with the patch each would stage; Enter stages it as one undoable change', async () => {
  await withFrame({ files: { '/r/list.md': '- pear\n- apple\n- fig\n' }, open: ['/r/list.md'] }, async (page, { mod }) => {
    await blur(page);
    await page.keyboard.press('Shift+Digit1');
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.type('sort lines');
    await page.waitForTimeout(500);
    const s = await lineRows(page);
    assert.equal(s.scope, 'Change the text');
    assert.equal(s.rows[0].g, 'On the whole file');
    const prev = await page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-line-prev-row')].map((r) => r.textContent));
    assert.ok(prev.includes('-- pear') && prev.includes('+- pear'), `the patch is previewed: ${JSON.stringify(prev)}`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty);
    const text = await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));
    assert.equal(text, '- apple\n- fig\n- pear\n', 'staged, not written');
    await page.keyboard.press(`${mod}+KeyZ`);
    await page.waitForFunction(() => !window.__marxyHandle.document().snapshot().dirty);
  });
});

test('! keeps a byte-order mark out of the patch it previews: the first line is not shown changed', async () => {
  await withFrame({ files: { '/r/bom.txt': '﻿a\nc\nb\n' }, open: ['/r/bom.txt'] }, async (page) => {
    await blur(page);
    await page.keyboard.press('Shift+Digit1');
    await page.waitForSelector('#marxy-palette[open]');
    await page.keyboard.type('sort lines');
    await page.waitForTimeout(500);
    const prev = await page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-line-prev-row')].map((r) => r.textContent));
    assert.ok(prev.includes('-c') && prev.includes('+c'), `the patch is previewed: ${JSON.stringify(prev)}`);
    assert.ok(!prev.some((r) => /^[-+]﻿?a$/.test(r)), `line 1 is unchanged: ${JSON.stringify(prev)}`);
  });
});

test('% lists the lenses with what the page holds; choosing one shows only those parts', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page, { mod }) => {
    await summon(page, mod, '%');
    const s = await lineRows(page);
    assert.equal(s.scope, 'Lens');
    const open = s.rows.find((r) => r.t === 'Open tasks');
    assert.equal(open?.d, '1 open of 2');
    await page.keyboard.type('code');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const shown = await page.evaluate(() => [...document.querySelector('[data-marxy-pane="0"] .marxy-article').children].filter((el) => el.getClientRects().length > 0 && !el.classList.contains('marxy-elide')).map((el) => el.localName));
    assert.deepEqual(shown, ['h1', 'h2', 'pre'], 'the code and the headings above it');
    await summon(page, mod, '%');
    assert.equal((await lineRows(page)).rows[0].t, 'Show everything');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-focus-out').length), 0);
  });
});

test('& lists the readings, Bytes last; ~ compares with another file beside; ? says what each first character does', async () => {
  await withFrame({ files: FILES, open: [NOTES] }, async (page, { mod }) => {
    await summon(page, mod, '&');
    let s = await lineRows(page);
    assert.equal(s.scope, 'Read this as');
    assert.equal(s.rows[0].g, 'The reading found');
    assert.equal(s.rows.at(-1).t, 'Bytes', 'the floor is last');
    await page.keyboard.press('Escape');
    await summon(page, mod, '~watcher');
    s = await lineRows(page);
    assert.equal(s.scope, 'Compare this file with');
    assert.equal(s.rows[0].t, '/r/src/watcher.ts');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2);
    await summon(page, mod, '?');
    s = await lineRows(page);
    assert.deepEqual(s.rows.map((r) => r.t.split(/\s+/)[0]), ['>', '@', ':', '/', '#', '=', '!', '%', '~', '&', '?']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.inputValue('#marxy-palette .marxy-palette-query'), '@', 'choosing one types it');
    assert.equal(await lineOpen(page), true);
  });
});

test('the empty Line: open tabs not already in Recent, then Recent, then what each first character does; the foot follows the scope', async () => {
  await withFrame({ files: FILES, open: [PLAN, NOTES] }, async (page, { mod }) => {
    await summon(page, mod, '');
    const s = await lineRows(page);
    assert.ok(s.groups.includes('Or type'), JSON.stringify(s.groups));
    const keys = await page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row')].map((r) => r.dataset.rowKey));
    assert.equal(new Set(keys).size, keys.length, 'no file is listed twice');
    const foot = () => page.evaluate(() => document.querySelector('#marxy-palette .marxy-palette-foot').textContent);
    assert.match(await foot(), /keep it in Places/);
    await page.keyboard.type('#');
    await page.waitForTimeout(100);
    assert.match(await foot(), /keep it in Search/);
    await page.keyboard.press('Backspace');
    await page.keyboard.type('>');
    await page.waitForTimeout(100);
    assert.doesNotMatch(await foot(), /keep it in/);
  });
});
