// A pane leaves a document while the other pane over it is typing (F-48; D-11; the F-42.1 review). The same
// file is open in two panes, both in Source. B has typed and A is typing: B's text is folded into the store
// or the reader is asked about it, whichever way B leaves (the pane closes, Read, another document opened in
// it, a tab click). The store is busy meanwhile (a queue held, as a slow save's write or a title refresh
// holds it), so B's fold has not landed when A's keys arrive: the order that wrote A's text over B's and
// lost it. Real keys and real clicks in WebKit, over the memory shell.
import { after, before } from 'node:test';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';
import { assert, editorText, focusPane, skip, test, texts, toSource, typeAtLineEnd } from './support/split-same.mjs';

let browser = null;
before(async () => {
  if (!skip) browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  await closeHarness();
});

const SOURCE = Array.from({ length: 10 }, (_, i) => `line${i + 1} the quick brown fox ${i + 1}`).join('\n') + '\n';
const FILES = { '/r/S.md': SOURCE, '/r/T.md': '# Tee\n\nA different document.\n' };

/** Holds the document store's queue until `release()`: whatever is queued behind it waits, as behind a slow write. */
const hold = (page) =>
  page.evaluate(() => {
    const store = window.__marxyHandle.panes().panes[0].view.store();
    const held = new Promise((resolve) => {
      window.__release = resolve;
    });
    void store.serially(() => held);
  });
const release = (page) => page.evaluate(() => window.__release());

/** Waits for every pane's queue and page, twice: the folds started so far have run. */
const settle = (page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      const panes = window.__marxyHandle.panes().panes;
      await Promise.all(panes.map((p) => p.view.serially(async () => {})));
      await Promise.all(panes.map((p) => p.view.settled()));
    }
  });

const radio = (page, label) => page.locator('[role=radiogroup] [role=radio]', { hasText: label });

/** How B leaves. Each starts the leave and does not wait for it: over text it cannot keep it waits for the reader. */
const WAYS = {
  // Read, in the toolbar's control (F-44): from Split it closes the right pane. B is the right pane.
  'Read (toolbar)': { b: 1, start: (page) => radio(page, 'Read').click() },
  'close the pane': {
    b: 1,
    start: (page, b) => page.evaluate((slot) => { window.__leaving = window.__marxyHandle.panes().close(window.__marxyHandle.panes().panes[slot]); }, b),
  },
  'close the left pane': {
    b: 0,
    start: (page, b) => page.evaluate((slot) => { window.__leaving = window.__marxyHandle.panes().close(window.__marxyHandle.panes().panes[slot]); }, b),
  },
  'Mod+E to Read': {
    b: 1,
    start: (page, b) => page.evaluate((slot) => { window.__leaving = window.__marxyHandle.panes().panes[slot].view.toggleMode(); }, b),
  },
  'Mod+E to Read in the left pane': {
    b: 0,
    start: (page, b) => page.evaluate((slot) => { window.__leaving = window.__marxyHandle.panes().panes[slot].view.toggleMode(); }, b),
  },
  'open another document': {
    b: 1,
    start: (page, b) => page.evaluate((slot) => { window.__leaving = window.__marxyHandle.panes().openIn(slot, '/r/T.md'); }, b),
  },
  'open another document in the left pane': {
    b: 0,
    start: (page, b) => page.evaluate((slot) => { window.__leaving = window.__marxyHandle.panes().openIn(slot, '/r/T.md'); }, b),
  },
  'a tab click': {
    b: 1,
    prepare: async (page, b) => {
      // The window has opened T once, so it has a tab.
      await page.evaluate((slot) => window.__marxyHandle.panes().openIn(slot, '/r/T.md'), b);
      await page.evaluate((slot) => window.__marxyHandle.panes().openIn(slot, '/r/S.md'), b);
    },
    start: async (page, b) => {
      await focusPane(page, b);
      await page.click('[data-marxy-tab="/r/T.md"] [role=tab]');
    },
  },
};

for (const [name, way] of Object.entries(WAYS)) {
  for (const aKeys of ['before', 'during']) {
    test(`B leaves (${name}) while A types (${aKeys} the leave): B's text is in the store, or the reader is asked`, async () => {
      const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
      try {
        await bootTwoPanes(page, { files: FILES, open: ['/r/S.md', '/r/S.md'], guard: true });
        await page.evaluate(() => window.__marxyHandle.workspace().unfold());
        const b = way.b;
        const a = 1 - b;
        await way.prepare?.(page, b);
        await toSource(page, a);
        await toSource(page, b);
        await typeAtLineEnd(page, b, 2, 'ZZB');
        await hold(page);
        // A types: B's fold (queued on B's focus leaving) waits behind the held store.
        await typeAtLineEnd(page, a, 5, aKeys === 'before' ? 'YYA' : 'Y1');
        await way.start(page, b, a);
        if (aKeys === 'during') {
          await typeAtLineEnd(page, a, 6, 'Y2');
          // A key per task, while the leave is waiting on the store.
          await page.keyboard.type('Y3');
        }
        await page.waitForTimeout(150);
        await release(page);
        await settle(page);
        await page.waitForTimeout(200);
        await settle(page);

        const stores = await page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => (p.view.store() ? new TextDecoder().decode(p.view.store().snapshot().buffer.bytes) : '')));
        const everyStore = stores.join('\n');
        const editors = [await editorText(page, 0).catch(() => null), await editorText(page, 1).catch(() => null)];
        const said = [await texts(page, 0), await texts(page, 1)];
        const panes = await page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => ({ path: p.path(), mode: p.view.mode })));
        const report = `store(s) ${JSON.stringify(stores)}; editors ${JSON.stringify(editors)}; panes ${JSON.stringify(panes)}; said ${JSON.stringify(said)}`;
        // B's text: in a store, or still in B's editor with the reader told or asked (the leave did not happen).
        const bKept = everyStore.includes('ZZB') || (panes.some((p) => p.mode === 'source') && editors.some((e) => e?.includes('ZZB')) && said.flat().length > 0);
        assert.ok(bKept, `ZZB (B's text) is in no store, and no pane still holds it with a notice up: ${report}`);
        // A's text: in a store or in A's editor.
        for (const token of aKeys === 'before' ? ['YYA'] : ['Y1', 'Y2', 'Y3']) {
          assert.ok(everyStore.includes(token) || editors.some((e) => e?.includes(token)), `${token} (A's text) is gone: ${report}`);
        }
      } finally {
        await page.close();
      }
    });
  }
}
