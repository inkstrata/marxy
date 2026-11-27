// The colour tiers: a code file past 2 MB, or with a line past 10,000 characters, is plain text, and the pane's
// head says so in grey; the Reading card lists the three tiers with this one marked and offers colour anyway, which
// colours what is in view, says so in the head and is kept in readings.json. A file on the full page is coloured and
// its head is quiet. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { howText, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const line = 'export function f(a) { return "s" + a * 2; } // a comment\n';
const FILES = {
  '/r/README.md': '# Here\n\nA page.\n',
  '/r/small.js': line.repeat(400),
  '/r/big.js': line.repeat(Math.ceil((2.2 * 1024 * 1024) / line.length)),
  '/r/wide.js': `${line}const blob = "${'x'.repeat(12_000)}";\n${line}`,
};

const open = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  // Code lands in Read; the tiers are read in Source, one press away.
  await page.evaluate(() => window.__marxyHandle.panes().focused.view.setMode('source'));
  await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p && document.querySelector('.cm-line'), path);
};
const headSays = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('[data-marxy-head="0"] .marxy-guess');
    return g && !g.hidden ? { text: g.textContent, tier: g.hasAttribute('data-marxy-tier') } : null;
  });
const tokensInView = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.cm-line [class*="marxy-tok-"]')].filter((e) => e.getBoundingClientRect().top < innerHeight).length);

test('a file on the full page is coloured, and its head says nothing of a tier', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/small.js');
    await page.waitForFunction(() => document.querySelector('.cm-line [class*="marxy-tok-"]'));
    assert.equal(await headSays(page), null);
  });
});

test('past 2 MB: plain text, said in the head and the Reading card; colour anyway colours what is in view and is kept', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/big.js');
    assert.deepEqual(await headSays(page), { text: 'Plain text · no colour past 2 MB', tier: true });
    await page.waitForTimeout(1500);
    assert.equal(await tokensInView(page), 0, 'no colour');
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-how .marxy-tiers'));
    const card = await howText(page);
    assert.match(card, /Shown as plain text/);
    assert.match(card, /by its size: 2\.2 MB, past the 2 MB a full page is made for/);
    const tiers = await page.$$eval('.marxy-drawer .marxy-tiers li', (els) => els.map((e) => `${e.querySelector('b').textContent}${e.hasAttribute('data-marxy-here') ? '*' : ''}`));
    assert.deepEqual(tiers, ['The full page', 'Plain text*', 'The bytes']);
    await page.click('.marxy-drawer .marxy-tier button:has-text("Colour it anyway")');
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-guess')?.textContent === 'Coloured as you scroll · your choice');
    await page.waitForFunction(() => [...document.querySelectorAll('.cm-line [class*="marxy-tok-"]')].some((e) => e.getBoundingClientRect().top < innerHeight));
    // Kept in readings.json, and back to plain text undoes it.
    // Written a moment after the choice (an async predicate never waits in waitForFunction, so this polls).
    let kept = null;
    for (let i = 0; i < 40 && !(kept ?? []).includes('/r/big.js'); i++) {
      await page.waitForTimeout(150);
      kept = await page.evaluate(async () => {
        try {
          return JSON.parse(new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/data/readings.json'))).colour ?? [];
        } catch {
          return null;
        }
      });
    }
    assert.deepEqual(kept, ['/r/big.js']);
    await page.click('.marxy-drawer .marxy-tier button:has-text("Back to plain text")');
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-guess')?.textContent === 'Plain text · no colour past 2 MB');
    await page.waitForFunction(() => !document.querySelector('.cm-line [class*="marxy-tok-"]'));
  });
});

test('a line past 10,000 characters: plain text at any size, said as such', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/wide.js');
    assert.deepEqual(await headSays(page), { text: 'Plain text · no colour with lines past 10,000 characters', tier: true });
    await showPanel(page, 'metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-how .marxy-tiers'));
    assert.match(await howText(page), /by a line of 12,016 characters, past the 10,000 a full page is made for/);
  });
});

test('Read on the full page colours a file as one text: a comment opened in one piece runs on into the next', async () => {
  const lines = [];
  for (let i = 0; i < 190; i++) lines.push(`const v${i} = ${i};`);
  lines.push('/* a comment that opens here');
  for (let i = 0; i < 40; i++) lines.push(`   still the comment, line ${i}, with const and return words`);
  lines.push('*/');
  for (let i = 0; i < 100; i++) lines.push(`const w${i} = ${i};`);
  await withFrame({ files: { ...FILES, '/r/spans.js': `${lines.join('\n')}\n` }, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/spans.js');
    await page.evaluate(() => window.__marxyHandle.panes().focused.view.setMode('rendered'));
    await page.waitForFunction(() => document.querySelectorAll('pre.marxy-run').length >= 2);
    // The second piece's first lines are inside the comment the first piece opened.
    await page.evaluate(() => document.querySelectorAll('pre.marxy-run')[1].scrollIntoView());
    await page.waitForFunction(() => document.querySelectorAll('pre.marxy-run')[1]?.querySelector('code')?.dataset.marxyDone === 'highlight', undefined, { timeout: 20_000 });
    const roles = await page.evaluate(() => {
      const code = document.querySelectorAll('pre.marxy-run')[1].querySelector('code');
      const first = code.querySelector('.marxy-line');
      return [...first.querySelectorAll('[class*="marxy-tok-"]')].map((s) => s.className);
    });
    assert.ok(roles.length > 0 && roles.every((c) => c === 'marxy-tok-comment'), `the second piece's first line is comment: ${roles.join(', ')}`);
  });
});
