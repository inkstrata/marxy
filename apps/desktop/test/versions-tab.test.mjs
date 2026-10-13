// The inspector's Versions tab (V-06, ADR-0072), in the real app over the memory shell, in WebKit. What the reader is promised:
// open, edit, save, then the file changes outside: the tab shows *Changed since you read* with the right counts and three
// versions; Restore to a copy writes `x (version HH.MM).md` and leaves `x.md`'s bytes as they were; when that name is taken it
// writes `(version HH.MM 2)` and never writes a path that exists; every write versioning makes is under the data folder; a
// large file, `versions = false`, a copy removed by hand and a damaged record are each said in the tab. The rules are the node
// tests (versions/store.test.ts, versions/recorder.test.ts, workspace/versions-tab.test.ts).
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

const X = '# Notes\n\nOne line.\nTwo lines.\nThree lines.\n';
const files = {
  '/r/x.md': X,
  '/r/other.md': '# Other\n\nSomething else.\n',
  '/r/big.md': `# Big\n\n${'A line of filler text that runs to the end of the column.\n'.repeat(40_000)}`,
};

async function withPage(fn, { extra = {}, open = ['/r/x.md'] } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1700, height: 900 } });
    await bootTwoPanes(page, { files: { ...files, ...extra }, open });
    await settled(page);
    await fn(page);
  } finally {
    await browser.close();
  }
}

const settled = (page) =>
  page.evaluate(async () => {
    const { versionRecorder } = await import('/src/versions/recorder.ts');
    await versionRecorder()?.settled();
  });

async function showTab(page) {
  await page.evaluate(() => window.__marxyHandle.workspace().unfold());
  await page.evaluate(async () => {
    const { selectInspectorTab } = await import('/src/workspace/inspector.ts');
    selectInspectorTab('versions');
  });
  await page.waitForSelector('.marxy-versions .marxy-versions-heading');
}

/** The writes since call `from`: paths only. */
const writesFrom = (page, from) =>
  page.evaluate((n) => window.__marxyHandle.shell.calls.slice(n).filter((c) => c.method === 'writeFileAtomic').map((c) => c.args[0]), from);
const mark = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.length);
const disk = (page, path) => page.evaluate((p) => window.__marxyHandle.shell.peekFile(p).then((b) => new TextDecoder().decode(b)), path);
const rows = (page) =>
  page.$$eval('.marxy-versions-row', (els) =>
    els.map((el) => ({ reason: el.getAttribute('data-marxy-version-reason'), id: Number(el.getAttribute('data-marxy-version-id')), state: el.getAttribute('data-marxy-version-state'), text: el.textContent })),
  );

/** Open, edit, save, then another program rewrites the file: the card's scenario. Returns the call index before it began. */
async function openEditSaveChange(page) {
  const start = await mark(page);
  // Edit: "One line." becomes "One line, edited."; then save.
  await page.evaluate(async () => {
    const store = window.__marxyHandle.document();
    const text = new TextDecoder().decode(store.snapshot().buffer.bytes);
    const at = new TextEncoder().encode(text.slice(0, text.indexOf('One line.') + 8)).length;
    await store.apply({ range: { file: '/r/x.md', start: at, end: at + 1 }, replacement: ', edited.', label: 'edit' });
  });
  assert.equal(await page.evaluate(() => window.__marxyHandle.save()), 'saved');
  await settled(page);
  const outsideAt = await mark(page);
  // Another program: two lines removed, three added.
  await page.evaluate(async () => {
    const shell = window.__marxyHandle.shell;
    await shell.writeFileAtomic('/r/x.md', new TextEncoder().encode('# Notes\n\nOne line, edited.\nA new line.\nAnother.\nAnd a third.\n'));
    shell.emit([{ kind: 'modified', path: '/r/x.md' }]);
  });
  await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('And a third.'));
  await settled(page);
  return { start, outsideAt };
}

test('open, edit, save, change outside: Changed since you read with the right counts, three versions; every versioning write is under the data folder', async () => {
  await withPage(async (page) => {
    const { start, outsideAt } = await openEditSaveChange(page);
    await showTab(page);
    await page.waitForSelector('[data-marxy-versions-since]');
    const since = await page.textContent('[data-marxy-versions-since]');
    assert.match(since, /^Changed since you read/);
    assert.match(since, /3 lines added, 2 removed/, since);
    assert.match(since, /since it changed on disk at \d\d\.\d\d today/);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-versions-row').length === 3);
    assert.deepEqual((await rows(page)).map((r) => r.reason), ['read', 'before reload', 'read'], 'newest first');
    assert.match(await page.textContent('.marxy-versions-heading'), /Earlier versions \(3\)/);
    // Every write since the boot: the reader's save of x.md, the outside program's write, and versioning's, all under /data.
    const writes = await writesFrom(page, start);
    const outside = await page.evaluate((n) => window.__marxyHandle.shell.calls.slice(n).findIndex((c) => c.method === 'writeFileAtomic' && c.args[0] === '/r/x.md'), outsideAt);
    assert.ok(outside >= 0);
    const data = await page.evaluate(async () => (await window.__marxyHandle.shell.configPaths()).data);
    const notData = writes.filter((p) => !p.startsWith(`${data}/`));
    assert.deepEqual(notData, ['/r/x.md', '/r/x.md'], 'the reader\'s save and the outside write; versioning wrote nothing else');
    assert.ok(writes.some((p) => /^\/data\/versions-[0-9a-f]{40}-\d\d$/.test(p)) && writes.some((p) => /^\/data\/versions-[0-9a-f]{40}\.json$/.test(p)));
    // The launch's own read was kept before the scenario began: all of it is under /data too.
    const launch = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && String(c.args[0]).includes('versions-')).map((c) => c.args[0]));
    assert.ok(launch.every((p) => p.startsWith('/data/versions-')));
    // A click on the block opens the diff from the copy last read to the bytes on disk, as a scratch document; x.md is not written.
    const before = await mark(page);
    await page.click('[data-marxy-versions-since]');
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === 'untitled');
    const diff = await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));
    assert.match(diff, /^# Changes in x\.md/);
    assert.match(diff, /3 lines added, 2 removed since it changed on disk/);
    assert.match(diff, /\n-Two lines\.\n/);
    assert.match(diff, /\n\+A new line\.\n/);
    assert.deepEqual((await writesFrom(page, before)).filter((p) => !p.startsWith('/data/')), [], 'looking at a diff writes nothing of the reader\'s');
  });
});

test('choosing a version opens the diff from it to the buffer; Restore to a copy writes x (version HH.MM).md, opens it and leaves x.md\'s bytes as they were', async () => {
  await withPage(async (page) => {
    await openEditSaveChange(page);
    await showTab(page);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-versions-row').length === 3);
    const xBefore = await disk(page, '/r/x.md');
    const oldest = (await rows(page)).at(-1);
    await page.click(`[data-marxy-version-id="${oldest.id}"]`);
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === 'untitled');
    const diff = await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));
    assert.match(diff, /since the version kept at \d\d\.\d\d today \(read\)/);
    assert.match(diff, /\n-One line\.\n/, 'from the first read, before the reader\'s edit');
    await page.evaluate(() => window.__marxyHandle.open('/r/x.md'));
    await page.waitForFunction(() => document.querySelectorAll('.marxy-versions-row').length === 3);
    // Restore the first read.
    const expected = await page.evaluate(async (id) => {
      const { versionRecorder } = await import('/src/versions/recorder.ts');
      const { versionCopyPath } = await import('/src/versions/restore.ts');
      const l = await versionRecorder().store.list('/r/x.md');
      return versionCopyPath('/r/x.md', l.versions.find((v) => v.id === id).time, 1);
    }, oldest.id);
    assert.match(expected, /^\/r\/x \(version \d\d\.\d\d\)\.md$/);
    const from = await mark(page);
    await page.click(`[data-marxy-version-restore="${oldest.id}"]`);
    await page.waitForFunction((p) => window.__marxyHandle.currentPath() === p, expected);
    assert.equal(await disk(page, expected), X, 'the copy holds the version\'s bytes exactly');
    assert.equal(await disk(page, '/r/x.md'), xBefore, 'x.md is unchanged');
    const outsideData = (await writesFrom(page, from)).filter((p) => !p.startsWith('/data/'));
    assert.deepEqual(outsideData, [expected], 'one write, the copy');
    assert.match(await page.textContent('#marxy-notices'), /Restored the version of \d\d\.\d\d as x \(version \d\d\.\d\d\)\.md · x\.md is unchanged/);
  });
});

test('Restore when x (version HH.MM).md exists writes (version HH.MM 2) and never writes a path that exists', async () => {
  await withPage(async (page) => {
    await openEditSaveChange(page);
    await showTab(page);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-versions-row').length === 3);
    const oldest = (await rows(page)).at(-1);
    const [first, second] = await page.evaluate(async (id) => {
      const { versionRecorder } = await import('/src/versions/recorder.ts');
      const { versionCopyPath } = await import('/src/versions/restore.ts');
      const l = await versionRecorder().store.list('/r/x.md');
      const time = l.versions.find((v) => v.id === id).time;
      return [versionCopyPath('/r/x.md', time, 1), versionCopyPath('/r/x.md', time, 2)];
    }, oldest.id);
    // Someone else's file already has the first name.
    await page.evaluate((p) => window.__marxyHandle.shell.writeFileAtomic(p, new TextEncoder().encode('not Marxy\'s\n')), first);
    const existing = await page.evaluate(() => [...new Set(window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic').map((c) => c.args[0]))].concat(['/r/x.md', '/r/other.md', '/r/big.md']));
    const from = await mark(page);
    await page.click(`[data-marxy-version-restore="${oldest.id}"]`);
    await page.waitForFunction((p) => window.__marxyHandle.currentPath() === p, second);
    assert.equal(await disk(page, first), 'not Marxy\'s\n', 'the taken name keeps its bytes');
    assert.equal(await disk(page, second), X);
    const written = (await writesFrom(page, from)).filter((p) => !p.startsWith('/data/'));
    assert.deepEqual(written, [second]);
    for (const p of written) assert.ok(!existing.includes(p), `${p} existed and was written`);
  });
});

test('a file over the large-file limit gets no version and the tab says so; versions = false keeps nothing new and the tab says it is off', async () => {
  await withPage(async (page) => {
    await settled(page);
    const writes = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && String(c.args[0]).includes('versions-')).length);
    assert.equal(writes, 0, 'nothing kept of the large file');
    await showTab(page);
    await page.waitForFunction(() => /larger than 2\.0 MB, the large-file limit/.test(document.querySelector('.marxy-versions')?.textContent ?? ''));
  }, { open: ['/r/big.md'] });
  await withPage(async (page) => {
    await settled(page);
    const writes = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && String(c.args[0]).includes('versions-')).length);
    assert.equal(writes, 0, 'nothing kept while off');
    await showTab(page);
    await page.waitForFunction(() => /Versions are off: config\.toml says versions = false/.test(document.querySelector('.marxy-versions')?.textContent ?? ''));
  }, { extra: { '/config': 'versions = false\n' } });
});

test('a copy removed by hand is listed as missing and a click says so; a damaged record is said and Clear versions of this file starts it again', async () => {
  await withPage(async (page) => {
    await openEditSaveChange(page);
    await showTab(page);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-versions-row').length === 3);
    const key = await page.evaluate(async () => (await import('/src/versions/store.ts')).versionsKey('/r/x.md'));
    const oldest = (await rows(page)).at(-1);
    const slot = await page.evaluate(async ({ id }) => {
      const { versionRecorder } = await import('/src/versions/recorder.ts');
      const l = await versionRecorder().store.list('/r/x.md');
      return l.versions.find((v) => v.id === id).slot;
    }, { id: oldest.id });
    await page.evaluate((p) => window.__marxyHandle.shell.remove(p), `/data/versions-${key}-${String(slot).padStart(2, '0')}`);
    // Look again: the tab redraws when it is shown.
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', false));
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
    await page.waitForFunction((id) => document.querySelector(`[data-marxy-version-id="${id}"]`)?.getAttribute('data-marxy-version-state') === 'missing', oldest.id);
    assert.match(await page.textContent(`[data-marxy-version-id="${oldest.id}"]`), /copy missing/);
    await page.click(`[data-marxy-version-id="${oldest.id}"]`);
    await page.waitForFunction(() => /missing from Marxy's data folder/.test(document.getElementById('marxy-notices')?.textContent ?? ''));
    assert.equal(await page.evaluate(() => window.__marxyHandle.currentPath()), '/r/x.md', 'no diff was opened');
    // The record itself damaged by hand.
    await page.evaluate((p) => window.__marxyHandle.shell.writeFileAtomic(p, new TextEncoder().encode('{ not json')), `/data/versions-${key}.json`);
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', false));
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
    await page.waitForFunction(() => /could not be read: it is not valid JSON/.test(document.querySelector('.marxy-versions')?.textContent ?? ''));
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-versions-row').length), 0);
    // Clear versions of this file: the record starts again, and every slot of the file holds nothing.
    await page.evaluate(async () => {
      const { commands } = await import('/src/commands/index.ts');
      const { buildAppContext } = await import('/src/selection/bind.ts');
      await commands().find((c) => c.id === 'versions.clear-file').run(buildAppContext(window.__marxyHandle));
    });
    await page.waitForFunction(() => /No earlier versions are kept yet/.test(document.querySelector('.marxy-versions')?.textContent ?? ''));
    const slots = await page.evaluate((k) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && String(c.args[0]).startsWith(`/data/versions-${k}-`)).map((c) => c.args[0]), key);
    // Each slot holds nothing (the one removed by hand stays gone).
    for (const p of new Set(slots)) assert.equal(await page.evaluate((path) => window.__marxyHandle.shell.peekFile(path).then((b) => b.length, () => 0), p), 0, p);
  });
});
