// Close a pane, and save, the title and quit with two documents (D-08). `Mod+Shift+\` closes the focused
// pane; a document with unsaved changes is never lost by closing or replacing its pane: the notice names
// it, sits in its pane and saves it. Quitting asks about each unsaved document in turn. `Mod+S` saves the
// focused pane's document and the window title follows it with its dirty dot. Also the three ways the
// D-01 review found to lose edits with two panes: an open into a dirty unfocused pane, both panes dirty
// with the prompt naming the focused one, and `close()` of a dirty pane.
// Booted on the shipped skeleton over the memory shell (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
// A guard that waits for an answer no test gives would hang: the timeout makes that a failure.
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(12)}\n\n## Later\n\n${para('Later').repeat(12)}\n\n- [ ] alpha task\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(4)}\n\n- [ ] bravo task\n`,
  '/r/C.md': `# Charlie\n\n${para('Charlie').repeat(4)}\n`,
};

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** The pane's notices, as `{ text, buttons }`; slot 0's region is `#marxy-notices`, slot 1's `#marxy-notices-2`. */
const notices = (page, slot) =>
  page.evaluate(
    (id) =>
      [...(document.getElementById(id)?.querySelectorAll('.marxy-notice') ?? [])].map((line) => ({
        text: line.querySelector('.marxy-notice-text')?.textContent,
        buttons: [...line.querySelectorAll('button')].map((b) => b.textContent),
      })),
    slot === 0 ? 'marxy-notices' : 'marxy-notices-2',
  );
const click = (page, slot, label) =>
  page.locator(`#${slot === 0 ? 'marxy-notices' : 'marxy-notices-2'} .marxy-notice button`, { hasText: label }).click();
/** The memory shell's calls of `method`; for writes, those to `arg`, else to any of the documents. */
const calls = (page, method, arg) =>
  page.evaluate(
    ({ method, arg }) =>
      window.__marxyHandle.shell.calls.filter(
        (c) => c.method === method && (arg === undefined ? method !== 'writeFileAtomic' || String(c.args[0]).startsWith('/r/') : c.args[0] === arg),
      ).length,
    { method, arg },
  );
const disk = (page, path) =>
  page.evaluate(async (p) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p)), path);
const paths = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));
const lastTitle = (page) =>
  page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0]);
const focus = (page, slot) =>
  page.evaluate((s) => {
    const panes = window.__marxyHandle.panes();
    panes.focus(panes.panes[s]);
  }, slot);
const closeKey = (page) => page.keyboard.press('ControlOrMeta+Shift+Backslash');

/** Ticks the task in the pane at `slot`, through its own article, and waits for its store to be dirty. */
async function editTask(page, slot) {
  await page.evaluate((s) => {
    const article = window.__marxyHandle.panes().panes[s].article;
    article.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, slot);
  await page.waitForFunction((s) => window.__marxyHandle.panes().panes[s].view.store()?.snapshot().dirty === true, slot);
}

test('Mod+Shift+\\ closes the focused clean pane: one pane remains, #doc is its article, the left page is left alone', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    // The left pane is left alone: its page is not set again and its store is the same. (Its scroll place
    // across the split's end is per-pane scrolling's, D-05, which moves the scroller back to the window.)
    const place = () =>
      page.evaluate(() => {
        const left = window.__marxyHandle.panes().panes[0];
        window.__left ??= { first: left.article.firstElementChild, store: left.view.store() };
        const { byteOffset, fraction } = left.view.position();
        return {
          byteOffset,
          fraction,
          samePage: left.article.firstElementChild === window.__left.first && left.article.firstElementChild.isConnected,
          sameStore: left.view.store() === window.__left.store,
          version: left.view.store().snapshot().version,
        };
      });
    const before = await place();
    await focus(page, 1);
    await closeKey(page);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 1);
    const after = await page.evaluate(() => ({
      article: window.__marxyHandle.panes().panes[0].article.id,
      split: document.getElementById('marxy-main').hasAttribute('data-marxy-split'),
      second: document.getElementById('doc-2'),
    }));
    assert.deepEqual(after, { article: 'doc', split: false, second: null });
    assert.deepEqual(await place(), before, "the left pane's place is unchanged");
    assert.deepEqual(await paths(page), ['/r/A.md']);
    assert.deepEqual(await notices(page, 0), []);
  });
});

test('the close command is listed only with two panes, under its key', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    const listed = () =>
      page.evaluate(async () => {
        const { buildAppContext } = await import('/src/selection/bind.ts');
        const cmd = window.__marxyHandle.commands().find((c) => c.id === 'view.close-pane');
        return { key: cmd?.key, title: cmd?.title, when: cmd?.when(buildAppContext(window.__marxyHandle)) };
      });
    assert.deepEqual(await listed(), { key: 'Mod+Shift+\\', title: 'Close this pane', when: false });
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    assert.deepEqual(await listed(), { key: 'Mod+Shift+\\', title: 'Close this pane', when: true });
  });
});

test('closing a dirty right pane asks in that pane; Close without saving closes it and writes nothing', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 1);
    await focus(page, 1);
    await closeKey(page);
    await page.waitForTimeout(300);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md'], 'the right pane stays');
    assert.deepEqual(await notices(page, 1), [
      { text: 'B.md has changes that are not saved.', buttons: ['Save and close', 'Close without saving', 'Dismiss'] },
    ]);
    assert.deepEqual(await notices(page, 0), [], 'not in the other pane');
    await click(page, 1, 'Close without saving');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 1);
    assert.deepEqual(await paths(page), ['/r/A.md']);
    assert.equal(await calls(page, 'writeFileAtomic'), 0);
    assert.equal(await disk(page, '/r/A.md'), files['/r/A.md'], "the survivor's bytes on disk are untouched");
    assert.equal(await disk(page, '/r/B.md'), files['/r/B.md']);
  });
});

test('closing a dirty right pane: Save and close writes that file and closes it; Dismiss keeps it', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 1);
    await focus(page, 1);
    await closeKey(page);
    await page.waitForTimeout(200);
    await click(page, 1, 'Dismiss');
    await page.waitForTimeout(200);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md'], 'Dismiss keeps the pane');
    assert.deepEqual(await notices(page, 1), [], 'a dismissed close says nothing more');
    await closeKey(page);
    await page.waitForTimeout(200);
    await click(page, 1, 'Save and close');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 1);
    assert.equal(await calls(page, 'writeFileAtomic', '/r/B.md'), 1);
    assert.equal(await calls(page, 'writeFileAtomic'), 1, 'only that file');
    assert.equal(await disk(page, '/r/B.md'), files['/r/B.md'].replace('- [ ] bravo', '- [x] bravo'));
    assert.deepEqual(await paths(page), ['/r/A.md']);
  });
});

test('close() of a dirty left pane asks in the left pane, naming it, before the right takes the window', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 0);
    await page.evaluate(() => {
      const panes = window.__marxyHandle.panes();
      window.__closed = panes.close(panes.panes[0]);
    });
    await page.waitForTimeout(300);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md']);
    assert.deepEqual(await notices(page, 0), [
      { text: 'A.md has changes that are not saved.', buttons: ['Save and close', 'Close without saving', 'Dismiss'] },
    ]);
    await click(page, 0, 'Close without saving');
    assert.equal(await page.evaluate(() => window.__closed), true);
    assert.deepEqual(await paths(page), ['/r/B.md']);
    assert.equal(await calls(page, 'writeFileAtomic'), 0);
  });
});

test('open beside a dirty pane (openIn other): the notice is in that pane, and nothing is replaced until the answer', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 1);
    // The left pane is focused and clean; the right is dirty.
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 0);
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/C.md'));
    await page.waitForTimeout(300);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md'], 'nothing replaced');
    assert.deepEqual(await notices(page, 1), [
      { text: 'B.md has changes that are not saved.', buttons: ['Save and open', 'Open without saving', 'Dismiss'] },
    ]);
    await click(page, 1, 'Open without saving');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/C.md');
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/C.md']);
    assert.equal(await calls(page, 'writeFileAtomic'), 0);
  });
});

test('both panes dirty: opening over the unfocused one names it and Save and open saves it, not the focused one', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 0);
    await editTask(page, 1);
    await page.evaluate(() => window.__marxyHandle.panes().openIn(1, '/r/C.md'));
    await page.waitForTimeout(300);
    assert.deepEqual(await notices(page, 1), [
      { text: 'B.md has changes that are not saved.', buttons: ['Save and open', 'Open without saving', 'Dismiss'] },
    ]);
    await click(page, 1, 'Save and open');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/C.md');
    assert.equal(await calls(page, 'writeFileAtomic', '/r/B.md'), 1);
    assert.equal(await calls(page, 'writeFileAtomic', '/r/A.md'), 0, 'the focused document is not saved');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.store().snapshot().dirty), true);
  });
});

test('the same file in both panes, dirty: closing one view does not ask; closing its last view does', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/A.md'] });
    await editTask(page, 1);
    const closed = await page.evaluate(() => {
      const panes = window.__marxyHandle.panes();
      return panes.close(panes.panes[1]);
    });
    assert.equal(closed, true);
    assert.deepEqual(await notices(page, 0), []);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.store().snapshot().dirty), true, 'the edit is kept');
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/B.md'));
    await focus(page, 0);
    await closeKey(page);
    await page.waitForTimeout(300);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md']);
    assert.deepEqual((await notices(page, 0)).map((n) => n.text), ['A.md has changes that are not saved.']);
  });
});

test('quit with two dirty documents asks about the left, then the right; Dismiss on either stops it', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 0);
    await editTask(page, 1);
    const requestClose = () => page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested());
    const texts = async () => [...(await notices(page, 0)), ...(await notices(page, 1))].map((n) => n.text);

    // Dismiss on the first: no quit, nothing more asked.
    await requestClose();
    assert.deepEqual(await texts(), ['A.md has changes that are not saved.']);
    assert.deepEqual((await notices(page, 0))[0].buttons, ['Save and close', 'Close without saving', 'Dismiss']);
    // A second request while the first of two is up does not quit past the second.
    await requestClose();
    assert.equal(await calls(page, 'confirmClose'), 0);
    await click(page, 0, 'Dismiss');
    await page.waitForTimeout(150);
    assert.deepEqual(await texts(), []);
    assert.equal(await calls(page, 'confirmClose'), 0);

    // Close without saving on the first asks about the second; Dismiss there stops the quit.
    await requestClose();
    await click(page, 0, 'Close without saving');
    await page.waitForTimeout(150);
    assert.deepEqual(await notices(page, 1), [
      { text: 'B.md has changes that are not saved.', buttons: ['Save and close', 'Close without saving', 'Dismiss'] },
    ]);
    assert.deepEqual(await notices(page, 0), []);
    await click(page, 1, 'Dismiss');
    await page.waitForTimeout(150);
    assert.equal(await calls(page, 'confirmClose'), 0);

    // Both answered: the window closes, and nothing was written.
    await requestClose();
    await click(page, 0, 'Close without saving');
    await page.waitForTimeout(150);
    await click(page, 1, 'Close without saving');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'confirmClose'));
    assert.equal(await calls(page, 'confirmClose'), 1);
    assert.equal(await calls(page, 'writeFileAtomic'), 0);
  });
});

test('quit: Save and close on the left writes it, then asks about the right; a second request on the last prompt quits', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 0);
    await editTask(page, 1);
    await page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested());
    await click(page, 0, 'Save and close');
    await page.waitForFunction(() => document.querySelector('#marxy-notices-2 .marxy-notice') !== null);
    assert.equal(await calls(page, 'writeFileAtomic', '/r/A.md'), 1);
    assert.equal(await calls(page, 'writeFileAtomic', '/r/B.md'), 0);
    assert.equal(await calls(page, 'confirmClose'), 0);
    await page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested());
    assert.equal(await calls(page, 'confirmClose'), 1);
  });
});

test('Mod+S with the right pane focused writes the right file only; the title is its name with the dot until saved', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 0);
    await focus(page, 1);
    assert.equal(await lastTitle(page), 'B.md — marxy');
    await editTask(page, 1);
    await page.waitForFunction(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0] === 'B.md — marxy •');
    await page.keyboard.press('ControlOrMeta+KeyS');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.store().snapshot().dirty === false);
    assert.equal(await calls(page, 'writeFileAtomic', '/r/B.md'), 1);
    assert.equal(await calls(page, 'writeFileAtomic'), 1, 'the left document is not written');
    await page.waitForFunction(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0] === 'B.md — marxy');
    // Focus back on the dirty left document: the title is its, with the dot.
    await focus(page, 0);
    assert.equal(await lastTitle(page), 'A.md — marxy •');
  });
});

test('a refused close says why in the pane (an empty right pane), and a dismissed one says nothing', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    await page.evaluate(() => window.__marxyHandle.panes().openIn('other', '/r/missing.md'));
    await focus(page, 0);
    await closeKey(page);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes.length), 2);
    assert.deepEqual(await notices(page, 0), [
      { text: 'This pane stays open: the other pane has no document to take its place.', buttons: ['Dismiss'] },
    ]);
  });
});

const requestClose = (page) => page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested());
const allTexts = async (page) => [...(await notices(page, 0)), ...(await notices(page, 1))].map((n) => n.text);
const dirtyOf = (page, slot) => page.evaluate((s) => window.__marxyHandle.panes().panes[s].view.store().snapshot().dirty, slot);
/** Clicks the task in the pane at `slot` again (a second edit), and waits for its store to be dirty. */
const toggleTask = (page, slot) => editTask(page, slot);

test('quit: a document edited while another is asked about is asked about before the window closes', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 1);
    await requestClose(page);
    assert.deepEqual(await allTexts(page), ['B.md has changes that are not saved.']);
    // A was clean when the quit began; the reader edits it while B's notice is up.
    await editTask(page, 0);
    await click(page, 1, 'Close without saving');
    await page.waitForFunction(() => document.querySelector('#marxy-notices .marxy-notice') !== null);
    assert.equal(await calls(page, 'confirmClose'), 0, 'not closed over an edit nobody was asked about');
    assert.deepEqual(await allTexts(page), ['A.md has changes that are not saved.']);
    await click(page, 0, 'Close without saving');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'confirmClose'));
    assert.equal(await calls(page, 'writeFileAtomic'), 0);
  });
});

test('quit: a document saved in the walk and edited again is asked about again', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 0);
    await editTask(page, 1);
    await requestClose(page);
    await click(page, 0, 'Save and close');
    await page.waitForFunction(() => document.querySelector('#marxy-notices-2 .marxy-notice') !== null);
    assert.equal(await calls(page, 'writeFileAtomic', '/r/A.md'), 1);
    await toggleTask(page, 0);
    await click(page, 1, 'Close without saving');
    await page.waitForFunction(() => document.querySelector('#marxy-notices .marxy-notice') !== null);
    assert.equal(await calls(page, 'confirmClose'), 0, "A's new edit is not dropped");
    assert.deepEqual(await allTexts(page), ['A.md has changes that are not saved.']);
    // Discarded at this version, A is answered: the window closes.
    await click(page, 0, 'Close without saving');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'confirmClose'));
    assert.equal(await calls(page, 'confirmClose'), 1);
  });
});

test('quit: a close request while Save and close is writing does not start a second walk', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 0);
    await editTask(page, 1);
    await requestClose(page);
    // The second request arrives in the same turn as the click, while A's save is still writing.
    const askedDuringSave = await page.evaluate(() => {
      document.querySelector('#marxy-notices .marxy-notice button').click();
      window.__marxyHandle.shell.emitCloseRequested();
      return document.querySelectorAll('.marxy-notice').length;
    });
    assert.equal(askedDuringSave, 0, 'the request waits for the save; it does not ask about A again');
    await page.waitForFunction(() => document.querySelector('#marxy-notices-2 .marxy-notice') !== null);
    await page.waitForTimeout(200);
    assert.deepEqual(await allTexts(page), ['B.md has changes that are not saved.'], 'one walk, at B');
    assert.equal(await calls(page, 'writeFileAtomic', '/r/A.md'), 1);
    assert.equal(await calls(page, 'confirmClose'), 0);
    await click(page, 1, 'Close without saving');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'confirmClose'));
    await page.waitForTimeout(200);
    assert.equal(await calls(page, 'confirmClose'), 1);
  });
});

test("closing a pane: Save and close whose write fails keeps the pane, its edit and the file's bytes", async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 1);
    await page.evaluate(() => {
      const panes = window.__marxyHandle.panes();
      window.__closed = panes.close(panes.panes[1]);
    });
    await page.waitForFunction(() => document.querySelector('#marxy-notices-2 .marxy-notice') !== null);
    await page.evaluate(() => window.__marxyHandle.shell.rejectNextWrite('io'));
    await click(page, 1, 'Save and close');
    assert.equal(await page.evaluate(() => window.__closed), false);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md']);
    assert.equal(await dirtyOf(page, 1), true);
    assert.equal(await disk(page, '/r/B.md'), files['/r/B.md']);
    assert.ok((await allTexts(page)).some((t) => /^Could not save B\.md/.test(t)), 'the save-failed notice says so');
  });
});

test('the title is the focused document\'s: an edit in the unfocused pane does not mark it', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await focus(page, 1);
    assert.equal(await lastTitle(page), 'B.md — marxy');
    // An edit to the left document through its own pane's open path, focus staying on the right (a task
    // click would move focus first, D-06).
    await page.evaluate(async () => {
      const left = window.__marxyHandle.panes().panes[0].content;
      const { buffer } = left.store().snapshot();
      const text = new TextDecoder().decode(buffer.bytes).replace('- [ ] alpha', '- [x] alpha');
      await left.commitEdit({ ...buffer, bytes: new TextEncoder().encode(text) });
    });
    assert.equal(await dirtyOf(page, 0), true);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 1);
    await page.waitForTimeout(200);
    assert.equal(await lastTitle(page), 'B.md — marxy');
  });
});

test('quit: a document closed without saving and edited again before the walk ends is asked about again', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 0);
    await editTask(page, 1);
    await requestClose(page);
    await click(page, 0, 'Close without saving');
    await page.waitForFunction(() => document.querySelector('#marxy-notices-2 .marxy-notice') !== null);
    // A is still dirty: the answer covers the edit it was asked about, not this one.
    // (Unticking would put the bytes back as they are on disk, and A would be clean.)
    await page.evaluate(async () => {
      const left = window.__marxyHandle.panes().panes[0].content;
      const { buffer } = left.store().snapshot();
      const text = new TextDecoder().decode(buffer.bytes).replace('# Alpha', '# Alpha, again');
      await left.commitEdit({ ...buffer, bytes: new TextEncoder().encode(text) });
    });
    await click(page, 1, 'Close without saving');
    await page.waitForFunction(() => document.querySelector('#marxy-notices .marxy-notice') !== null);
    assert.equal(await calls(page, 'confirmClose'), 0);
    assert.deepEqual(await allTexts(page), ['A.md has changes that are not saved.']);
  });
});

const bufferOf = (page, slot) =>
  page.evaluate((s) => new TextDecoder().decode(window.__marxyHandle.panes().panes[s].view.store().snapshot().buffer.bytes), slot);
/** Puts the pane at `slot` in Source and types `text` at the start of its document, not folded into the store. */
async function typeInSource(page, slot, text) {
  await page.evaluate((s) => window.__marxyHandle.panes().panes[s].view.toggleMode(), slot);
  await page.click(`#${slot === 0 ? 'marxy-source' : 'marxy-source-2'} .cm-content`);
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type(text);
  assert.equal(await page.evaluate((s) => window.__marxyHandle.panes().panes[s].view.sourceHasUnfoldedEdits(), slot), true);
}

test('the same file in both panes: closing the one with text typed in its Source keeps the text', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/A.md'] });
    await typeInSource(page, 1, 'Qz');
    const closed = await page.evaluate(() => {
      const panes = window.__marxyHandle.panes();
      return panes.close(panes.panes[1]);
    });
    assert.equal(closed, true);
    assert.deepEqual(await allTexts(page), [], 'the store is still shown: nothing asked');
    assert.ok((await bufferOf(page, 0)).startsWith('Qz# Alpha'), 'the typed text went into the store');
    assert.match(await page.evaluate(() => window.__marxyHandle.panes().panes[0].article.textContent), /Qz/);
  });
});

test('quit sees text typed in the Source of the unfocused pane', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await typeInSource(page, 1, 'Qz');
    await focus(page, 0);
    await requestClose(page);
    await page.waitForFunction(() => document.querySelector('.marxy-notice') !== null);
    assert.deepEqual(await allTexts(page), ['B.md has changes that are not saved.']);
    assert.equal(await calls(page, 'confirmClose'), 0);
  });
});

test('quit: text typed in a Source after its document was closed without saving is asked about again', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 1);
    await typeInSource(page, 0, 'Qz');
    await requestClose(page);
    await page.waitForFunction(() => document.querySelector('#marxy-notices .marxy-notice') !== null);
    await click(page, 0, 'Close without saving');
    await page.waitForFunction(() => document.querySelector('#marxy-notices-2 .marxy-notice') !== null);
    // More text in A's Source, not folded: the answer was for the text before it.
    await page.click('#marxy-source .cm-content');
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('More');
    await click(page, 1, 'Close without saving');
    await page.waitForFunction(() => document.querySelector('#marxy-notices .marxy-notice') !== null);
    assert.equal(await calls(page, 'confirmClose'), 0);
    assert.deepEqual(await allTexts(page), ['A.md has changes that are not saved.']);
  });
});

test('quit: a second close request on the last notice does not quit over Source text typed after an answer', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await editTask(page, 0);
    await editTask(page, 1);
    await requestClose(page);
    await click(page, 0, 'Close without saving');
    await page.waitForFunction(() => document.querySelector('#marxy-notices-2 .marxy-notice') !== null);
    // A's answer was for its version before this: the text typed now is in its Source only.
    await typeInSource(page, 0, 'Late');
    await requestClose(page);
    await page.waitForTimeout(200);
    assert.equal(await calls(page, 'confirmClose'), 0, 'the second request does not quit');
    assert.deepEqual(await allTexts(page), ['B.md has changes that are not saved.'], 'the walk goes on at B');
    await click(page, 1, 'Close without saving');
    await page.waitForFunction(() => document.querySelector('#marxy-notices .marxy-notice') !== null);
    assert.deepEqual(await allTexts(page), ['A.md has changes that are not saved.']);
    assert.equal(await calls(page, 'confirmClose'), 0);
  });
});

test("split window: the left pane's guard sits over its own Source and takes a pointer click", async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await typeInSource(page, 0, 'Qz');
    await focus(page, 0);
    await closeKey(page);
    await page.waitForFunction(() => document.querySelector('#marxy-notices .marxy-notice') !== null);
    const box = await page.locator('#marxy-notices .marxy-notice button', { hasText: 'Dismiss' }).boundingBox();
    const top = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.textContent,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    assert.equal(top, 'Dismiss', 'the button is on top, not the Source editor');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => document.querySelector('#marxy-notices .marxy-notice') === null);
    assert.deepEqual(await paths(page), ['/r/A.md', '/r/B.md'], 'Dismiss keeps the pane');
  });
});
