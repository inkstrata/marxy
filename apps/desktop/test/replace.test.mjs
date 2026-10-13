// V-03: find and replace in Source. `Mod+Alt+F` opens find with its replace field; Replace all… opens a preview of every
// change and changes nothing; Apply (Mod+Return) makes every change in one transaction, one undo step, in the file's
// own line endings; an outside change while the preview is open makes Apply refuse. The real app over the memory shell,
// in WebKit, with real keys (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

const A = '/r/colours.md';
const BOM = '﻿';

// 37 matches on 21 lines: sixteen lines with two, five with one, and lines with none between them.
const LINES = ['# Palette', ''];
for (let i = 1; i <= 21; i++) LINES.push(i <= 16 ? `Line ${i}: a colour and another colour.` : `Line ${i}: one colour here.`, i % 4 === 0 ? 'No match on this line.' : '');
LINES.push('End.', '');
const LF_DOC = LINES.join('\n');
const CRLF_DOC = BOM + LINES.join('\r\n');
const REPLACED = BOM + LF_DOC.replaceAll('colour', 'color').replace(/\n/g, '\r\n');

const hex = (text) => Buffer.from(text, 'utf8').toString('hex');

async function withApp(files, fn, { open = [A] } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(page, { files, open, guard: true });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const api = {
      mod,
      settle: () => page.evaluate(() => new Promise((r) => setTimeout(r, 150))),
      /** The editor's text, "\n" between lines. */
      doc: () => page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().view.state.doc.toString()),
      /** The store's bytes as hex (a byte-order mark kept). */
      storeHex: () => page.evaluate(() => [...window.__marxyHandle.document().snapshot().buffer.bytes].map((b) => b.toString(16).padStart(2, '0')).join('')),
      writes: () => page.evaluate(() => window.__appWrites.filter((w) => !w.path.startsWith('/data/')).length),
      notices: () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice .marxy-notice-text')].map((n) => n.textContent)),
      preview: () =>
        page.evaluate(() => {
          const d = document.getElementById('marxy-replace');
          if (!d?.open) return null;
          return {
            title: d.querySelector('.marxy-transform-title').textContent,
            count: d.querySelector('#marxy-replace-count').textContent,
            note: d.querySelector('.marxy-transform-note').textContent,
            rows: d.querySelectorAll('#marxy-replace-rows del, #marxy-replace-rows ins').length,
            dels: [...d.querySelectorAll('#marxy-replace-rows del')].map((e) => e.textContent),
            inss: [...d.querySelectorAll('#marxy-replace-rows ins')].map((e) => e.textContent),
            text: d.querySelector('#marxy-replace-rows').textContent,
            status: d.querySelector('.marxy-transform-status').textContent,
            applyDisabled: d.querySelector('#marxy-replace-apply').getAttribute('aria-disabled') === 'true',
            focus: document.activeElement?.id ?? document.activeElement?.tagName,
          };
        }),
    };
    await fn(page, api);
  } finally {
    await browser.close();
  }
}

/** Source on, then the find panel with its replace field (`Mod+Alt+F`), with `search` and `replace` typed in. */
async function openReplace(page, s, search, replace) {
  if ((await page.evaluate(() => document.body.dataset.marxyMode)) !== 'source') {
    await page.keyboard.press(`${s.mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.waitForSelector('.cm-content');
    await page.click('.cm-content');
  }
  await page.keyboard.press(`${s.mod}+Alt+KeyF`);
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'replace' && document.activeElement.closest('.cm-search'));
  await page.fill('.cm-search input[name=search]', search);
  await page.fill('.cm-search input[name=replace]', replace);
}

async function replaceAll(page) {
  await page.click('.cm-search button[name=replaceAll]');
}

test('Mod+Alt+F opens find with its replace field; Replace all… on 37 matches shows 37 changes and changes nothing; Apply changes all 37 as one undo step, CRLF and BOM kept', async () => {
  await withApp({ [A]: CRLF_DOC }, async (page, s) => {
    await openReplace(page, s, 'colour', 'color');
    await replaceAll(page);
    await page.waitForSelector('#marxy-replace[open]');
    const preview = await s.preview();
    assert.equal(preview.count, '37 replacements on 21 lines');
    assert.equal(preview.dels.length, 37, 'one taken-out run per change');
    assert.equal(preview.inss.length, 37, 'one put-in run per change');
    assert.ok(preview.dels.every((d) => d === 'colour') && preview.inss.every((i) => i === 'color'));
    assert.equal(preview.text.match(/^ 3 {2}\u2212 Line 1: a colour and another colour\.$/gm)?.length, 2, 'each of line 3\u2019s two changes is a row with its line number');
    assert.match(preview.text, /^ {4}\+ Line 1: a color and another colour\.$/m, 'the after line under it');
    assert.equal(preview.focus, 'marxy-replace-rows', 'focus is on the changes, so Return does not apply');
    assert.equal(await s.doc(), LF_DOC, 'the buffer is unchanged while the preview is open');

    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-replace').open);
    assert.equal(await s.doc(), LF_DOC.replaceAll('colour', 'color'));
    assert.ok((await s.notices()).some((n) => n.startsWith('Made 37 replacements on 21 lines.')));

    // One Mod+Z in the editor gives back every match; redo puts them in again.
    await page.click('.cm-content');
    await page.keyboard.press(`${s.mod}+z`);
    assert.equal(await s.doc(), LF_DOC, 'one undo restores the text');
    await page.keyboard.press(`${s.mod}+Shift+z`);
    assert.equal(await s.doc(), LF_DOC.replaceAll('colour', 'color'));

    // Leaving Source folds the editor into the store: the file's own endings and its mark.
    await page.keyboard.press(`${s.mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    await s.settle();
    assert.equal(await s.storeHex(), hex(REPLACED));
    // In Rendered, one undo of the store gives the exact bytes back; nothing was written to disk.
    await page.evaluate(() => window.__marxyHandle.document().undo());
    assert.equal(await s.storeHex(), hex(CRLF_DOC), 'one undo restores the exact bytes');
    assert.equal(await s.writes(), 0, 'Apply never writes to disk');
  });
});

test('a regular expression with $1, Esc cancels and nothing changes, and a query with no matches opens no preview', async () => {
  await withApp({ [A]: LF_DOC }, async (page, s) => {
    await openReplace(page, s, 'Line (\\d+):', 'L$1 —');
    await page.click('.cm-search label:has(input[name=re])');
    assert.equal(await page.isChecked('.cm-search input[name=re]'), true);
    await replaceAll(page);
    await page.waitForSelector('#marxy-replace[open]');
    let preview = await s.preview();
    assert.match(preview.title, /regular expression/);
    assert.equal(preview.inss[0], 'L1 —');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('marxy-replace').open);
    assert.equal(await s.doc(), LF_DOC, 'Esc changes nothing');

    await page.fill('.cm-search input[name=search]', 'zzz');
    await replaceAll(page);
    await s.settle();
    preview = await s.preview();
    assert.equal(preview, null, 'no preview for no matches');
    assert.ok((await s.notices()).some((n) => /No matches for “zzz”\. Nothing was replaced\./.test(n)));
    assert.equal(await s.doc(), LF_DOC);
  });
});

test('Replace changes the current match and moves to the next, one undo step each', async () => {
  await withApp({ [A]: LF_DOC }, async (page, s) => {
    await openReplace(page, s, 'colour', 'hue');
    // The caret at the start: Replace looks from the selection on, as Find next does.
    await page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().view.dispatch({ selection: { anchor: 0 } }));
    await page.click('.cm-search button[name=replace]'); // selects the first match
    await page.click('.cm-search button[name=replace]'); // replaces it, selects the next
    await page.click('.cm-search button[name=replace]');
    const doc = await s.doc();
    assert.equal(doc, LF_DOC.replace('colour', 'hue').replace('colour', 'hue'));
    await page.click('.cm-content');
    await page.keyboard.press(`${s.mod}+z`);
    assert.equal(await s.doc(), LF_DOC.replace('colour', 'hue'), 'one undo takes back one replacement');
  });
});

test('the file changing on disk while the preview is open makes Apply refuse, say so, and change nothing', async () => {
  await withApp({ [A]: LF_DOC }, async (page, s) => {
    await openReplace(page, s, 'colour', 'color');
    await replaceAll(page);
    await page.waitForSelector('#marxy-replace[open]');
    // Another program writes the file. Nothing is unsaved, so the editor takes the new text (live reload).
    const outside = `${LF_DOC}One more colour.\n`;
    await page.evaluate((text) => window.__outside('/r/colours.md', text), outside);
    await page.waitForFunction(
      async (want) => (await import('/src/source/editor.ts')).activeSourceEditor().view.state.doc.toString() === want,
      outside,
    );
    await page.keyboard.press(`${s.mod}+Enter`);
    await s.settle();
    const preview = await s.preview();
    assert.ok(preview, 'the preview stays up to say why');
    assert.match(preview.status, /^The document changed while the preview was open\. Nothing was replaced;/);
    assert.equal(preview.applyDisabled, true);
    assert.ok((await s.notices()).some((n) => n.startsWith('The document changed while the preview was open.')));
    assert.equal(await s.doc(), outside, 'nothing was replaced');
  });
});

test('with unsaved edits, a change on disk while the preview is open makes Apply refuse with the disk notice', async () => {
  await withApp({ [A]: LF_DOC }, async (page, s) => {
    await openReplace(page, s, 'colour', 'color');
    // An edit the store has not seen yet: the change on disk is then held for the reader's choice, not loaded.
    await page.evaluate(async () => {
      const view = (await import('/src/source/editor.ts')).activeSourceEditor().view;
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'typed\n' } });
    });
    const typed = await s.doc();
    await replaceAll(page);
    await page.waitForSelector('#marxy-replace[open]');
    await page.evaluate((text) => window.__outside('/r/colours.md', text), `${LF_DOC}outside\n`);
    await page.waitForFunction(() => window.__marxyHandle.document().conflict() !== null, null, { timeout: 10_000 });
    await page.keyboard.press(`${s.mod}+Enter`);
    await s.settle();
    const preview = await s.preview();
    assert.match(preview.status, /^The file changed on disk while the preview was open\. Nothing was replaced;/);
    assert.equal(await s.doc(), typed, 'nothing was replaced');
  });
});

test('a 10 MB text: the preview and Apply stay responsive (measured), and the text is exactly the reference', async (t) => {
  // The 10 MB goes into the editor of a small file: opening a 10 MB file in Read first is the reading path's cost, not this one's.
  const line = 'The quick brown fox jumps over the lazy dog, and the fox runs on.\n';
  const big = line.repeat(Math.ceil((10 * 1024 * 1024) / line.length));
  await withApp({ [A]: LF_DOC }, async (page, s) => {
    await openReplace(page, s, 'fox', 'cat');
    // The baseline: the same 10 MB put into the editor as one change, as a paste would.
    const pasteMs = await page.evaluate(async (text) => {
      const view = (await import('/src/source/editor.ts')).activeSourceEditor().view;
      const t0 = performance.now();
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
      return Math.round(performance.now() - t0);
    }, big);
    t.diagnostic(`10 MB put into the editor as one change (the baseline): ${pasteMs} ms`);
    const timing = await page.evaluate(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      const t0 = performance.now();
      document.querySelector('.cm-search button[name=replaceAll]').click();
      const opened = performance.now() - t0;
      const count = document.getElementById('marxy-replace-count').textContent;
      await frame();
      const painted = performance.now() - t0;
      const t1 = performance.now();
      document.getElementById('marxy-replace-apply').click();
      const applied = performance.now() - t1;
      await frame();
      const appliedPainted = performance.now() - t1;
      return { opened: Math.round(opened), painted: Math.round(painted), applied: Math.round(applied), appliedPainted: Math.round(appliedPainted), count };
    });
    t.diagnostic(`10 MB, ${timing.count}: preview built in ${timing.opened} ms (on screen ${timing.painted} ms); Apply ${timing.applied} ms (on screen ${timing.appliedPainted} ms)`);
    assert.equal(timing.count, `${(big.split('fox').length - 1).toLocaleString('en-US')} replacements on ${(big.split('\n').length - 1).toLocaleString('en-US')} lines`);
    const same = await page.evaluate(async (want) => (await import('/src/source/editor.ts')).activeSourceEditor().view.state.doc.toString() === want, big.replaceAll('fox', 'cat'));
    assert.ok(same, 'the text is exactly the reference replace');
    await page.click('.cm-content');
    await page.keyboard.press(`${s.mod}+z`);
    const undone = { same: await page.evaluate(async (want) => (await import('/src/source/editor.ts')).activeSourceEditor().view.state.doc.toString() === want, big) };
    assert.ok(undone.same, 'one undo restores the text');
  });
});

test('a plain query with a hyphen is found and replaced, and a Replace that cannot run says why', async () => {
  const doc = 'A well-known fact, well-known twice.\n';
  await withApp({ [A]: doc }, async (page, s) => {
    await openReplace(page, s, 'well-known', 'famous');
    await replaceAll(page);
    await page.waitForSelector('#marxy-replace[open]');
    assert.equal((await s.preview()).count, '2 replacements on 1 line');
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-replace').open);
    assert.equal(await s.doc(), 'A famous fact, famous twice.\n');
    // Replace, one at a time, with a regular expression that does not parse: a refusal, not silence.
    await page.fill('.cm-search input[name=search]', '(');
    await page.click('.cm-search label:has(input[name=re])');
    await page.click('.cm-search button[name=replace]');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice .marxy-notice-text')].some((n) => /regular expression is not valid.*Nothing was replaced/.test(n.textContent)));
    // And with nothing to find. (The refusal pill sits over the panel's checkboxes; the box is set as a click would.)
    await page.evaluate(() => {
      const box = document.querySelector('.cm-search input[name=re]');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
    });
    await page.fill('.cm-search input[name=search]', 'zzz');
    await page.evaluate(() => document.querySelector('.cm-search button[name=replace]').click());
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice .marxy-notice-text')].some((n) => /No matches for “zzz”/.test(n.textContent)));
    assert.equal(await s.doc(), 'A famous fact, famous twice.\n');
  });
});

test('typed and undone while the preview is open: Apply still refuses, and says the preview may be out of date', async () => {
  await withApp({ [A]: LF_DOC }, async (page, s) => {
    await openReplace(page, s, 'colour', 'color');
    await replaceAll(page);
    await page.waitForSelector('#marxy-replace[open]');
    await page.evaluate(async () => {
      const view = (await import('/src/source/editor.ts')).activeSourceEditor().view;
      view.dispatch({ changes: { from: 0, insert: 'X' } });
      view.dispatch({ changes: { from: 0, to: 1 } });
    });
    assert.equal(await s.doc(), LF_DOC, 'the text reads the same');
    await page.keyboard.press(`${s.mod}+Enter`);
    await s.settle();
    const preview = await s.preview();
    assert.match(preview.status, /^The preview may be out of date: .* Nothing was replaced; run Replace all again\.$/);
    assert.equal(await s.doc(), LF_DOC);
  });
});

test('Replace one at a time with an empty-match expression over emoji: no uncaught error, and Replace all… matches JavaScript', async () => {
  const doc = 'a😀😀b 𝔸\n';
  await withApp({ [A]: doc }, async (page, s) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openReplace(page, s, '(?:)', '|');
    await page.click('.cm-search label:has(input[name=re])');
    await page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().view.dispatch({ selection: { anchor: 0 } }));
    for (let i = 0; i < 6; i++) await page.evaluate(() => document.querySelector('.cm-search button[name=replace]').click());
    assert.deepEqual(errors, [], 'no uncaught error');
    assert.ok(!(await s.notices()).some((n) => /could not run/.test(n)), 'nothing failed');
    await page.click('.cm-content');
    for (let i = 0; i < 6; i++) await page.keyboard.press(`${s.mod}+z`);
    assert.equal(await s.doc(), doc);
    await page.evaluate(() => document.querySelector('.cm-search button[name=replaceAll]').click());
    await page.waitForSelector('#marxy-replace[open]');
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-replace').open);
    assert.equal(await s.doc(), doc.replace(/(?:)/gmu, '|'));
  });
});
