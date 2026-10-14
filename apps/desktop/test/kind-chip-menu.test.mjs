// F-103: the kind chip's menu says why a file is read as it is, in whole words. Each reason row's title is
// wide enough for its whole text (no ellipsis), at 800 and 1,400 px, and the `Show as …` choices keep one line.
// Booted on the shipped skeleton over the memory shell; the menu is the verb menu's, so the right-click menu
// is checked to lay out as before.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PATH = '/Users/reader/Work/plans/pg16-upgrade-plan-with-a-rather-long-file-name.md';
const BODY = [
  '---', 'title: Postgres 14 to 16 upgrade plan', '---', '',
  '# Postgres 14 to 16 upgrade plan', '',
  '## TL;DR', '', 'Upgrade a promoted replica in place.', '',
  '## Context', '', 'The primary runs Postgres 14.11.', '',
  '## Phases', '', 'Rehearse, cut over, verify.', '',
  '## Rollback', '', 'Keep the old primary for a week.', '',
].join('\n');

/** The rows of the open menu: title text, whether the title is cut, the row's height and its own box. */
const measure = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-verb-menu-item')].map((row) => {
      const t = row.querySelector('.marxy-verb-menu-title');
      const box = row.getBoundingClientRect();
      return {
        text: t.textContent,
        note: row.getAttribute('aria-disabled') === 'true',
        cut: t.scrollWidth > t.clientWidth,
        height: Math.round(box.height),
        inside: box.left >= 0 && box.right <= window.innerWidth,
        hint: [...row.querySelectorAll('.marxy-verb-menu-key')].map((k) => ({ text: k.textContent, cut: k.scrollWidth > k.clientWidth, right: Math.round(k.getBoundingClientRect().right), menuRight: Math.round(row.getBoundingClientRect().right) })),
      };
    }),
  );

for (const width of [800, 1400]) {
  test(`the kind chip's menu shows each reason in whole words at ${width} px`, async () => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await bootTwoPanes(page, { files: { [PATH]: BODY }, open: [PATH] });
      await page.evaluate(async () => {
        const { commands } = await import('/src/commands/index.ts');
        await commands().find((c) => c.id === 'kind.chip').run({});
      });
      await page.waitForSelector('.marxy-verb-menu');
      const rows = await measure(page);
      const notes = rows.filter((r) => r.note);
      assert.ok(notes.length >= 1, `reason rows: ${JSON.stringify(rows.slice(0, 4))}`);
      for (const r of notes) {
        assert.equal(r.cut, false, `"${r.text}" is cut`);
        assert.ok(r.inside);
        for (const h of r.hint) assert.ok(!h.cut && h.right <= h.menuRight, `hint "${h.text}" is cut`);
      }
      // The choices keep one line: every `Show as` row is as tall as the 28 px row.
      const choices = rows.filter((r) => /^Show as /.test(r.text));
      assert.ok(choices.length > 5);
      for (const r of choices) assert.ok(r.height <= 30, `${r.text}: ${r.height} px`);
      assert.ok(notes.some((r) => r.hint.length > 0));
    } finally {
      await browser.close();
    }
  });
}

test('the right-click menu keeps its one-line rows and its chords', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await bootTwoPanes(page, { files: { [PATH]: BODY }, open: [PATH] });
    await page.locator('#doc p').first().click({ button: 'right' });
    await page.waitForSelector('.marxy-verb-menu');
    const rows = await measure(page);
    assert.ok(rows.length >= 2);
    for (const r of rows) {
      assert.equal(r.note, false);
      assert.ok(r.height <= 30, `${r.text}: ${r.height} px`);
      assert.equal(r.cut, false, r.text);
    }
  } finally {
    await browser.close();
  }
});
