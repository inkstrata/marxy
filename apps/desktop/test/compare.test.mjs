// "Show what changed on disk" and "Show unsaved changes" (E-17), end to end in WebKit over the memory shell:
// the commands are listed only when they mean something, the diff opens as a scratch document with the
// expected lines and counts, the document it was made from is not touched, nothing is written, the "before"
// is what Marxy had loaded (not a second read), and a 1 MB regenerated file does not stall the page.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const A = '/d/a.md';
const B = '/d/b.md';
const BODY = '# Title\n\nline one\n\nline two\n\nline three\n';
const LONG = '# Long\n\n' + Array.from({ length: 60 }, (_, i) => `Paragraph ${i} runs on for a good while so that the page is tall enough to scroll a long way down it.`).join('\n\n') + '\n';
const TASKS = '# Hi\n\n- [ ] a\n\nlast\n';

async function withPage(fn, { files, open = [A], viewport = { width: 1470, height: 700 } }) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport });
    await bootTwoPanes(page, { files, open, guard: true });
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** The ids of the compare commands the palette would list now (`when` over the real context). */
const listed = (page) =>
  page.evaluate(async () => {
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const ctx = buildAppContext(window.__marxyHandle);
    return window.__marxyHandle.commands().filter((c) => c.id.startsWith('compare.') && c.when(ctx)).map((c) => c.id);
  });
const run = (page, id) =>
  page.evaluate(async (id) => {
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const ctx = buildAppContext(window.__marxyHandle);
    await window.__marxyHandle.commands().find((c) => c.id === id).run(ctx);
  }, id);
const outside = (page, text) => page.evaluate((t) => window.__outside('/d/a.md', t), text);
const store = (page, slot = 0) => `window.__marxyHandle.panes().panes[${slot}].content.store()`;
const prev = (page) => page.evaluate(`${store(page)}.snapshot().previousDisk !== null`);
const waitReloaded = (page) => page.waitForFunction(`${store(page)}.snapshot().previousDisk !== null`);
const textOf = (page, slot) => page.evaluate(`new TextDecoder().decode(${store(page, slot)}.snapshot().buffer.bytes)`);
const pathOf = (page, slot) => page.evaluate(`${store(page, slot)}.snapshot().path`);
const docWrites = (page) =>
  page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !String(c.args[0]).startsWith('/data/')).map((c) => c.args[0]));
const notices = (page) => page.evaluate(() => [...document.querySelectorAll('#marxy-notices .marxy-notice')].map((n) => n.textContent));

async function toggleTask(page) {
  const before = await textOf(page, 0);
  await page.evaluate(() => {
    const article = window.__marxyHandle.panes().panes[0].article;
    article.querySelector('input[data-marxy-s]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(([b]) => new TextDecoder().decode(window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes) !== b, [before]);
}

test('after the file is rewritten on disk, "Show what changed on disk" opens the diff, and only that command is listed', () =>
  withPage(async (page) => {
    await page.waitForSelector('#doc h1');
    assert.deepEqual(await listed(page), [], 'nothing changed: neither command is listed');
    await outside(page, BODY.replace('line two', 'line TWO').replace('line three', 'line three\n\nline four'));
    await waitReloaded(page);
    assert.deepEqual(await listed(page), ['compare.since-reload']);

    const kept = await textOf(page, 0);
    const writesBefore = await docWrites(page); // the outside program's own write is among them
    await run(page, 'compare.since-reload');
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === 'untitled');
    const doc = await textOf(page, 0);
    assert.match(doc, /^# Changes in a\.md\n\n3 lines added, 1 removed since the file last changed on disk\.\n\n```diff\n--- before\n\+\+\+ after\n@@ /);
    assert.ok(doc.includes('\n-line two\n+line TWO\n'), doc);
    assert.ok(doc.includes('\n+line four\n'), doc);
    assert.ok(doc.endsWith('```\n'));
    assert.ok(kept.includes('line TWO'), 'the document that was open held the new version');
    assert.deepEqual(await docWrites(page), writesBefore, 'the command writes no file');
    assert.deepEqual(await page.evaluate(() => window.__appWrites.map((w) => w.path).filter((p) => !p.startsWith('/data/'))), [], 'the app wrote no document');
    await page.waitForSelector('#doc pre');
  }, { files: { [A]: BODY } }));

test('the "before" is what Marxy had loaded, not a second read of the disk', () =>
  withPage(async (page) => {
    await page.waitForSelector('#doc h1');
    await outside(page, BODY.replace('line one', 'line 1'));
    await waitReloaded(page);
    // The disk changes again with no watch event: a re-read would show this write, the held bytes do not.
    await page.evaluate(() => window.__outside('/d/a.md', '# something else entirely\n', []));
    const reads = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile' && c.args[0] === '/d/a.md').length);
    await run(page, 'compare.since-reload');
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === 'untitled');
    const doc = await textOf(page, 0);
    assert.ok(doc.includes('\n-line one\n+line 1\n'), doc);
    assert.ok(!doc.includes('something else'), doc);
    assert.equal(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile' && c.args[0] === '/d/a.md').length), reads, 'the file is not read again for the diff');
  }, { files: { [A]: BODY } }));

test('"Show unsaved changes" shows exactly the toggled line, beside an untouched document', () =>
  withPage(async (page) => {
    await page.waitForSelector('#doc input[data-marxy-s]');
    assert.deepEqual(await listed(page), []);
    await toggleTask(page);
    assert.deepEqual(await listed(page), ['compare.unsaved'], 'not "on disk": nothing was rewritten there');

    const bytesBefore = await textOf(page, 0);
    const position = await page.evaluate(() => window.__marxyHandle.sourceHarness().byteOffset);
    await run(page, 'compare.unsaved');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes[1].path() === 'untitled');
    const doc = await textOf(page, 1);
    assert.ok(doc.includes('```diff\n--- before\n+++ after\n@@ -1,5 +1,5 @@\n # Hi\n \n-- [ ] a\n+- [x] a\n \n last\n```\n'), doc);
    assert.match(doc, /1 line added, 1 removed compared with the file on disk\./);
    // The original document: same bytes, still unsaved, in the focused pane, at its place.
    assert.equal(await textOf(page, 0), bytesBefore);
    assert.equal(await pathOf(page, 0), A);
    assert.equal(await page.evaluate(`${store(page, 0)}.snapshot().dirty`), true);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 0);
    assert.equal(await page.evaluate(() => window.__marxyHandle.sourceHarness().byteOffset), position);
    assert.deepEqual(await docWrites(page), []);
  }, { files: { [A]: TASKS } }));

test('in a window too narrow for two panes, unsaved changes are not shown by replacing the document', () =>
  withPage(async (page) => {
    await page.waitForSelector('#doc input[data-marxy-s]');
    await toggleTask(page);
    await run(page, 'compare.unsaved');
    await page.waitForTimeout(300);
    assert.equal(await pathOf(page, 0), A, 'the document is still open, with its edit');
    assert.equal(await page.evaluate(`${store(page, 0)}.snapshot().dirty`), true);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes.length), 1);
    assert.ok((await notices(page)).length > 0, 'it said why');
  }, { files: { [A]: TASKS }, viewport: { width: 520, height: 700 } }));

test('the document the diff replaced comes back at its reading position (what Back opens)', () =>
  withPage(async (page) => {
    await page.waitForSelector('#doc h1');
    await page.evaluate(() => window.scrollTo(0, 99999));
    await page.waitForFunction(() => window.scrollY > 80);
    await outside(page, LONG + '\n\nA last paragraph, added.\n');
    await waitReloaded(page);
    await page.waitForFunction(() => document.getElementById('doc')?.textContent?.includes('A last paragraph, added.'));
    const before = await page.evaluate(() => window.__marxyHandle.sourceHarness().byteOffset);
    assert.ok(before > 0);
    await run(page, 'compare.since-reload');
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === 'untitled');
    // Back is the palette's history step: it opens the previous path, which restores the position kept on leaving.
    await page.evaluate(() => window.__marxyHandle.open('/d/a.md'));
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/d/a.md');
    await page.waitForFunction(() => document.getElementById('doc')?.textContent?.includes('A last paragraph, added.'));
    await page.waitForFunction((b) => window.__marxyHandle.sourceHarness().byteOffset === b, before);
  }, { files: { [A]: LONG } }));

test('the previous version is dropped when another document opens, and a kept edit never sets it', () =>
  withPage(async (page) => {
    await page.waitForSelector('#doc h1');
    await outside(page, BODY.replace('line one', 'line 1'));
    await waitReloaded(page);
    await page.evaluate(() => { window.__old = window.__marxyHandle.panes().panes[0].content.store(); });
    await page.evaluate(() => window.__marxyHandle.open('/d/b.md'));
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === '/d/b.md');
    assert.equal(await page.evaluate(() => window.__old.snapshot().previousDisk), null, 'the closed store holds nothing');
    assert.equal(await prev(page), false);
    assert.deepEqual(await listed(page), []);

  }, { files: { [A]: BODY, [B]: '# B\n\nbee\n' } }));

test('a change kept over unsaved edits sets no previous version', () =>
  withPage(async (page) => {
    await page.waitForSelector('#doc input[data-marxy-s]');
    await toggleTask(page);
    await outside(page, TASKS + '\nmore\n');
    await page.waitForFunction(`${store(page)}.conflict() !== null`);
    assert.equal(await prev(page), false);
    assert.deepEqual(await listed(page), ['compare.unsaved']);
  }, { files: { [A]: TASKS } }));

test('identical content, line endings only, a coarse diff and a fence in the text are each told honestly', () =>
  withPage(async (page) => {
    await page.waitForSelector('#doc h1');
    const out = await page.evaluate(async () => {
      const { changesDocument, fenceFor } = await import('/src/commands/compare.ts');
      const enc = (s) => new TextEncoder().encode(s);
      const doc = (a, b) => changesDocument('f.md', enc(a), enc(b), 'since the file last changed on disk');
      const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('\n') + '\n';
      return {
        same: doc('a\nb\n', 'a\nb\n'),
        eol: doc('a\r\nb\r\n', 'a\nb\n'),
        fence: doc('x\n```\ny\n', 'x\n````\ny\n'),
        huge: doc(lines(60_000, (i) => `l${i}`), 'x\n'),
        // Every common line repeats more than the anchor limit and the work budget cannot cover it.
        coarse: doc(lines(20_000, (i) => (i % 3 ? 'same' : `u${i}`)), lines(20_000, (i) => (i % 5 ? 'same' : `v${i}`))),
        fenceFor: [fenceFor('a'), fenceFor('``` x'), fenceFor('````` y')],
      };
    });
    assert.deepEqual(out.same, { kind: 'none' });
    assert.deepEqual(out.huge, { kind: 'too-large' });
    assert.equal(out.eol.kind, 'document');
    assert.match(out.eol.text, /Only the line endings differ \(CRLF before, LF after\) since the file last changed on disk\./);
    assert.ok(out.eol.text.includes('-a\r\n-b\r\n+a\n+b\n'), 'the endings are shown, not hidden');
    assert.ok(out.fence.text.includes('`````diff\n') && out.fence.text.endsWith('\n`````\n'), out.fence.text);
    assert.equal(out.coarse.kind, 'document');
    assert.match(out.coarse.text, /This comparison is approximate/);
    assert.deepEqual(out.fenceFor, ['```', '````', '``````']);
  }, { files: { [A]: BODY } }));

// Ten thousand short paragraphs, two lines each: 20,000 lines and a little over 1 MB, as a regenerated report is.
const regenerated = (edit) =>
  Array.from({ length: 10_000 }, (_, i) => `## Item ${i}${edit && i === 7_000 ? ' (revised)' : ''}\nA regenerated paragraph with text to fill the line and pad it out a little, number ${i}.`).join('\n\n') + '\n';

test('a regenerated 1 MB file: the diff does not block the page, and the time is recorded', () =>
  withPage(async (page) => {
    assert.ok(regenerated(false).length > 1_000_000);
    await page.waitForSelector('#doc h2');
    await outside(page, regenerated(true));
    await waitReloaded(page);
    const m = await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const ctx = buildAppContext(window.__marxyHandle);
      // A heartbeat on the main thread: its largest gap is the longest the page was unresponsive.
      let last = performance.now();
      let worst = 0;
      const beat = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; }, 4);
      const t0 = performance.now();
      await window.__marxyHandle.commands().find((c) => c.id === 'compare.since-reload').run(ctx);
      const total = performance.now() - t0;
      clearInterval(beat);
      return { total, worst };
    });
    console.log(`# E-17 1 MB regenerated file: command ${m.total.toFixed(0)} ms, longest main-thread gap ${m.worst.toFixed(0)} ms`);
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === 'untitled');
    const doc = await textOf(page, 0);
    assert.ok(doc.includes('-## Item 7000\n+## Item 7000 (revised)\n'), doc.slice(0, 400));
    assert.ok(m.worst < 400, `the page stalled for ${m.worst} ms`);
  }, { files: { [A]: regenerated(false) } }));
