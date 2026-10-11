// A fold from a Source pane does not rebuild a page nobody can see (B-27). Folding Source text into the
// store used to set the hidden Rendered article of every view of the document from the new bytes (seconds
// per view at 1 MB); now a view in Source marks its page stale and sets it when Rendered next shows. The
// page that then shows must be the whole render of the store's current bytes. Booted on the shipped
// skeleton over the memory shell (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { settle } from './settle.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const para = (word) => `${word} runs long enough to wrap across several lines of the column, so that the typesetter has real paragraphs. `;
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(6)}\n\n## Middle\n\n${para('Middle').repeat(6)}\n\n## Last\n\nThe *end* of [Alpha](http://x.example/).\n`,
};

async function withPanes(open, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await bootTwoPanes(page, { files, open });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, mod);
  } finally {
    await browser.close();
  }
}

/** Pane `slot` in Source (it was Rendered). */
async function toSource(page, mod, slot) {
  await page.keyboard.press(`${mod}+${slot + 1}`);
  await page.keyboard.press(`${mod}+e`);
  await page.waitForFunction((slot) => window.__marxyHandle.panes().panes[slot].view.mode === 'source', slot);
}

/**
 * Types `text` at the end of line `line` (1-based) of pane `slot`'s editor, then folds it into the store.
 * Counts what every article's children and attributes did meanwhile, from before the fold to after it.
 */
function typeAndFold(page, slot, line, text) {
  return page.evaluate(
    async ({ slot, line, text }) => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const panes = window.__marxyHandle.panes().panes;
      const records = [];
      const observers = panes.map((p, i) => {
        const o = new MutationObserver((list) => records.push(...list.map(() => i)));
        o.observe(p.article, { childList: true, subtree: true, attributes: true, characterData: true });
        return o;
      });
      const firsts = panes.map((p) => p.article.firstElementChild);
      const view = activeSourceEditor(panes[slot].parts.source).view;
      const at = view.state.doc.line(line).to;
      view.dispatch({ changes: { from: at, insert: text } });
      const folded = await panes[slot].view.foldSource();
      await new Promise((r) => setTimeout(r, 50));
      for (const o of observers) o.takeRecords().forEach((rec) => records.push(rec));
      observers.forEach((o) => o.disconnect());
      return {
        folded,
        mutations: records.length,
        sameFirst: panes.map((p, i) => p.article.firstElementChild === firsts[i]),
        stored: new TextDecoder().decode(panes[slot].view.store().snapshot().buffer.bytes),
      };
    },
    { slot, line, text },
  );
}

/** Pane `slot`'s page set whole from the store, as every open does and settled, as markup: the control. */
async function wholeRender(page, slot) {
  await page.evaluate((slot) => window.__marxyHandle.panes().panes[slot].view.rerender(), slot);
  await settle(page);
  return markup(page, slot);
}

const markup = (page, slot) => page.evaluate((slot) => window.__marxyHandle.panes().panes[slot].article.innerHTML, slot);

test('folds with both panes in Source set no page; each pane then shows the whole render of the current bytes (B-27)', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await toSource(page, mod, 0);
    await toSource(page, mod, 1);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes.every((p) => p.view.mode === 'source')), true);
    const before = [await markup(page, 0), await markup(page, 1)];

    // Several folds, from either pane, at different places.
    let last;
    for (const [slot, line, text] of [[1, 1, 'Qz'], [0, 3, ' second'], [1, 5, ' third'], [0, 1, 'Wx']]) {
      last = await typeAndFold(page, slot, line, text);
      assert.equal(last.folded, true, 'the text went into the store');
      assert.equal(last.mutations, 0, `no page was touched by the fold in pane ${slot}`);
      assert.deepEqual(last.sameFirst, [true, true]);
    }
    assert.ok(last.stored.startsWith('# AlphaQzWx\n'), last.stored.slice(0, 20));
    assert.deepEqual([await markup(page, 0), await markup(page, 1)], before, 'both hidden pages still hold the opened render');

    // Back to Rendered in pane 1, then pane 0: each page is the whole render of the folded bytes.
    for (const slot of [1, 0]) {
      await page.keyboard.press(`${mod}+${slot + 1}`);
      await page.keyboard.press(`${mod}+e`);
      await page.waitForFunction((slot) => window.__marxyHandle.panes().panes[slot].view.mode === 'rendered', slot);
      await page.waitForFunction((slot) => window.__marxyHandle.panes().panes[slot].article.querySelector('h1')?.textContent.includes('AlphaQzWx'), slot);
      await settle(page);
      const shown = await markup(page, slot);
      assert.ok(shown.includes('second') && shown.includes('third'), `pane ${slot} shows the folded text`);
      const text = await page.evaluate((slot) => window.__marxyHandle.panes().panes[slot].article.textContent, slot);
      assert.ok(text.includes('AlphaQzWx'));
      assert.equal(await wholeRender(page, slot), shown, `pane ${slot}: the page that showed is a whole render of the current bytes`);
      assert.notEqual(shown, before[slot]);
    }
  });
});

test('a fold from the Source pane reaches the other pane showing Rendered, and nothing else changed for one pane (B-27)', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await toSource(page, mod, 1);
    await typeAndFold(page, 1, 1, 'Qz');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].article.querySelector('h1')?.textContent.includes('AlphaQz'));
    await settle(page);
    const shown = await markup(page, 0);
    assert.equal(await wholeRender(page, 0), shown, 'the other pane\'s page is a whole render of the folded bytes');
  });
  // One pane: Source and back to Rendered shows what was typed.
  await withPanes(['/r/A.md'], async (page, mod) => {
    await toSource(page, mod, 0);
    const r = await typeAndFold(page, 0, 1, 'Qz');
    assert.equal(r.mutations, 0);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.mode === 'rendered');
    await page.waitForFunction(() => document.querySelector('#doc h1')?.textContent.includes('AlphaQz'));
    await settle(page);
    const shown = await markup(page, 0);
    assert.equal(await wholeRender(page, 0), shown);
  });
});
