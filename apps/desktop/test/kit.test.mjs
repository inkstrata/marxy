// The shared browser-test kit (support/kit.mjs): its waits end on conditions, its reads match what is on screen,
// and a recorded timing never fails a test while a held budget does. WebKit, over the shipped skeleton and the
// memory shell.
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as nodeTest } from 'node:test';
import { absent, holdBudget, markCount, markSeen, openBrowser, present, quiet, recordTiming, scrollSettled, sees, skip, withApp } from './support/kit.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

const long = `# Kit page\n\n## Second part\n\n${'A paragraph long enough to wrap across a few lines of the column. '.repeat(30)}\n\n${'Another one follows it, and fills the page further down. '.repeat(30)}\n\n${'A last paragraph. '.repeat(60)}\n`;
const FILES = { '/r/kit.md': long, '/r/other.md': '# Other file\n\nShort.\n' };

test('a boot waits for the document, and sees reads the headings, the tab and the path', async () => {
  await withApp({ files: FILES, open: ['/r/kit.md'] }, async (page, app) => {
    const seen = await sees(page);
    assert.deepEqual(seen.headings, ['Kit page', 'Second part']);
    assert.deepEqual(seen.paths, ['/r/kit.md']);
    assert.ok(seen.tabs.includes('kit.md'));
    assert.match(seen.text, /^Kit page Second part A paragraph/);
    assert.equal((await app.sees()).mode, 'rendered');
    assert.ok((await markCount(page, 'typeset_done')) >= 1);
    await markSeen(page, 'typeset_done');
  });
});

test('a wait for an element, and for its going, ends when it does and not before', async () => {
  await withApp({ files: FILES, open: ['/r/kit.md'] }, async (page, app) => {
    await page.evaluate(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = document.createElement('div');
        el.id = 'kit-probe';
        el.textContent = 'here';
        document.body.append(el);
      }));
    });
    await present(page, '#kit-probe');
    assert.equal(await page.textContent('#kit-probe'), 'here');
    await page.evaluate(() => requestAnimationFrame(() => document.querySelector('#kit-probe').remove()));
    await app.absent('#kit-probe');
    assert.equal(await page.$('#kit-probe'), null);
    await absent(page, '#never-there');
  });
});

test('scrollSettled returns the place a wheel scroll came to rest at, and quiet waits for a writer to stop', async () => {
  await withApp({ files: FILES, open: ['/r/kit.md'] }, async (page, app) => {
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, 900);
    const at = await scrollSettled(page);
    assert.ok(at > 0, `the page scrolled to ${at}`);
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), at);
    // A writer that touches the article for a few frames: quiet ends after the last write, not at the first calm frame.
    await page.evaluate(() => {
      let left = 20;
      window.__kitWrites = 0;
      const tick = () => {
        document.querySelector('#doc').setAttribute('data-kit', String(left));
        window.__kitWrites++;
        if (--left > 0) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await quiet(page, { still: 10 });
    assert.equal(await page.evaluate(() => window.__kitWrites), 20, 'quiet came after the writer was done');
    await app.idle();
  });
});

test('a second file opens beside the first and both are read', async () => {
  await withApp({ files: FILES, open: ['/r/kit.md', '/r/other.md'] }, async (page, app) => {
    assert.deepEqual((await app.sees()).paths, ['/r/kit.md', '/r/other.md']);
    assert.equal(await app.fileText('/r/other.md'), FILES['/r/other.md']);
  });
});

test('openBrowser gives pages from the one browser, and closes only its own', async () => {
  const first = await openBrowser();
  const second = await openBrowser();
  const a = await first.newPage();
  const b = await second.newPage();
  await first.close();
  assert.equal(a.isClosed(), true);
  assert.equal(b.isClosed(), false);
  await second.close();
});

test('a recorded timing is kept and never fails; a held budget fails only over its limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-kit-'));
  const file = join(dir, 'timings.jsonl');
  process.env.MARXY_TIMINGS = file;
  try {
    assert.equal(recordTiming('kit.slow', 123456.04), 123456);
    holdBudget(assert, 'kit.inside', 50, 100);
    assert.throws(() => holdBudget(assert, 'kit.over', 500, 100), /kit\.over took 500 ms, over its 100 ms budget/);
    process.env.MARXY_BUDGET_SCALE = '10';
    holdBudget(assert, 'kit.scaled', 500, 100);
  } finally {
    delete process.env.MARXY_TIMINGS;
    delete process.env.MARXY_BUDGET_SCALE;
  }
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.name), ['kit.slow', 'kit.inside', 'kit.over', 'kit.scaled']);
  assert.equal(lines[0].ms, 123456);
});
