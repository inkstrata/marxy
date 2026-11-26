// Reviewer's real drives of a reading root arriving after the lookup has remembered "none" for the pane's article:
// Show as on an open file (Markdown, then transcript; Markdown, then log), and the article reused for another document.
// Run from the worktree root:
//   node scripts/browser-tests.mjs --jobs 1 C:/Dev/reader/work/wave1/key-lookup/late-roots-real.test.mjs
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
const WT = 'file:///C:/Dev/reader/worktrees/key-lookup/';
const { closeHarness } = await import(`${WT}apps/desktop/test/support/two-pane.mjs`);
const { withFrame } = await import(`${WT}apps/desktop/test/support/frame.mjs`);
after(() => closeHarness());

const CHAT = readFileSync(new URL(`${WT}fixtures/corpus/34-chat-transcript.md`), 'utf8');
const LOG = '2026-10-01 09:00:01 INFO started\n2026-10-01 09:00:02 WARN slow disk\n2026-10-01 09:00:09 ERROR gave up\n';
const LONG = readFileSync(new URL(`${WT}fixtures/corpus/32-long-reference.md`), 'utf8');
const SESSION = readFileSync(new URL(`${WT}fixtures/corpus/40-session.jsonl`), 'utf8');
const FILES = { '/r/40-session.jsonl': SESSION, '/r/chat.md': CHAT, '/r/run.md': LOG, '/r/run.log': LOG, '/r/long.md': LONG };

const run = (page, id) =>
  page.evaluate(async (id) => {
    const { commands } = await import('/src/commands/index.ts');
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const ctx = buildAppContext(window.__marxyHandle);
    const cmd = commands().find((c) => c.id === id);
    if (!cmd || !cmd.when(ctx)) throw new Error(`no ${id}`);
    await cmd.run(ctx);
  }, id);
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const what = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.marxy-verb-bar');
    return b && !b.hidden ? b.querySelector('.marxy-verb-bar-what').textContent : null;
  });
const scanned = (page) =>
  page.evaluate(async () => {
    const { readingPage } = await import('/src/parts/reading-parts.ts');
    return readingPage(document.querySelector('[data-marxy-pane="0"] .marxy-article'));
  });

test('a JSONL session opened in the pane after the long Markdown page: the cursor walks its turns', { timeout: 180_000 }, async () => {
  await withFrame({ files: FILES, open: ['/r/long.md'] }, async (page) => {
    await blur(page);
    await page.keyboard.press('j');
    const before = await what(page);
    assert.equal(await scanned(page), false);
    await page.evaluate(() => window.__marxyHandle.open('/r/40-session.jsonl'));
    await page.waitForSelector('[data-marxy-pane="0"] [data-marxy-derived="jsonl-transcript"] .marxy-turn');
    await blur(page);
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    const afterWhat = await what(page);
    console.log('transcript: before', before, 'after', afterWhat);
    assert.match(afterWhat ?? '', /^turn/);
  });
});

test('the long Markdown page, then a log opened in the same pane: the cursor walks entries', { timeout: 180_000 }, async () => {
  await withFrame({ files: FILES, open: ['/r/long.md'] }, async (page) => {
    await blur(page);
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    const before = await what(page);
    assert.equal(await scanned(page), false);
    await page.evaluate(() => window.__marxyHandle.open('/r/run.log'));
    await page.waitForSelector('[data-marxy-pane="0"] pre.language-log code[data-marxy-done="highlight"] .marxy-line');
    await blur(page);
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    const afterWhat = await what(page);
    console.log('reused: before', before, 'after', afterWhat);
    assert.equal(afterWhat, 'entry');
  });
});
