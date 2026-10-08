// The pane model and the two-pane skeleton (D-01): `PaneSet` opens a second `section.marxy-pane` beside
// the first, focuses, lays out and closes panes, and with one document the page is what it always was.
// Booted on the shipped skeleton and CSS (test/support/two-pane.mjs), over the memory shell.
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

const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(4)}\n\n- [ ] alpha task\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(4)}\n\n- [ ] bravo task\n`,
  '/r/C.md': `# Charlie\n\n${para('Charlie').repeat(4)}\n`,
};

async function withPage(fn, viewport = { width: 1470, height: 900 }) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport });
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** What the DOM says about the panes. */
const layout = (page) =>
  page.evaluate(() => {
    const main = document.getElementById('marxy-main');
    return {
      split: main.hasAttribute('data-marxy-split'),
      panes: [...main.querySelectorAll(':scope > section.marxy-pane')].map((host) => ({
        slot: host.getAttribute('data-marxy-pane'),
        article: host.querySelector(':scope > article')?.id ?? null,
        notices: host.querySelector(':scope > [role="status"]')?.id ?? null,
        source: host.querySelector(':scope > .marxy-source-mount')?.id ?? null,
        focus: host.hasAttribute('data-marxy-focus'),
        heading: host.querySelector('article h1')?.textContent ?? null,
        rect: (({ x, width }) => ({ x, width }))(host.getBoundingClientRect()),
      })),
      dividers: document.querySelectorAll('.marxy-divider').length,
    };
  });

test('one document: one pane, no divider and no split, the skeleton the app always had', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    const state = await layout(page);
    assert.equal(state.split, false);
    assert.equal(state.dividers, 0);
    assert.equal(state.panes.length, 1);
    assert.deepEqual(
      { ...state.panes[0], rect: undefined },
      { slot: '0', article: 'doc', notices: 'marxy-notices', source: 'marxy-source', focus: true, heading: 'Alpha', rect: undefined },
    );
    // The pane fills the window: the article is laid out against the same width as before.
    assert.equal(state.panes[0].rect.width, 1470);
    // Nothing visible outside #marxy-main (the gate's checkChrome), and the find slot is empty and not drawn.
    const outside = await page.evaluate(() => {
      const main = document.getElementById('marxy-main');
      return [...document.querySelectorAll('body *')].filter((el) => {
        if (main.contains(el)) return false;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }).map((el) => el.tagName);
    });
    assert.deepEqual(outside, []);
    const slot = await page.evaluate(() => {
      const el = document.querySelector('.marxy-find-slot');
      return { children: el.childNodes.length, display: getComputedStyle(el).display };
    });
    assert.deepEqual(slot, { children: 0, display: 'none' });
  });
});

test("openIn('other') makes a second pane beside the first, each with its own view and store", async () => {
  await withPage(async (page) => {
    const shown = await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    assert.deepEqual(shown, [
      { slot: 0, path: '/r/A.md', article: 'doc' },
      { slot: 1, path: '/r/B.md', article: 'doc-2' },
    ]);
    const state = await layout(page);
    assert.equal(state.split, true);
    assert.deepEqual(
      state.panes.map(({ slot, article, notices, source, heading }) => ({ slot, article, notices, source, heading })),
      [
        { slot: '0', article: 'doc', notices: 'marxy-notices', source: 'marxy-source', heading: 'Alpha' },
        { slot: '1', article: 'doc-2', notices: 'marxy-notices-2', source: 'marxy-source-2', heading: 'Bravo' },
      ],
    );
    // Side by side at the default ratio: two columns of half the window each.
    const [left, right] = state.panes;
    assert.equal(left.rect.x, 0);
    assert.ok(Math.abs(left.rect.width - 735) <= 1 && Math.abs(right.rect.x - 735) <= 1, JSON.stringify(state.panes));
    // Each article is centred in its own pane: --marxy-room is measured against the pane, not the window.
    const centres = await page.evaluate(() =>
      ['doc', 'doc-2'].map((id) => {
        const article = document.getElementById(id).getBoundingClientRect();
        const pane = document.getElementById(id).parentElement.getBoundingClientRect();
        return Math.abs(article.x + article.width / 2 - (pane.x + pane.width / 2));
      }),
    );
    assert.ok(centres.every((d) => d <= 1), `articles off centre by ${centres}`);
    // The pane is the container its article's room (`100cqi` in --marxy-room) is measured against, not
    // #marxy-main: a probe 100cqi wide in each article is its pane's width, half the window.
    const room = await page.evaluate(() =>
      ['doc', 'doc-2'].map((id) => {
        const probe = document.createElement('div');
        probe.style.width = '100cqi';
        document.getElementById(id).append(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return Math.round(width);
      }),
    );
    assert.deepEqual(room, [735, 735]);
    // The window title stays the focused pane's: the document opened beside it does not take it.
    const title = await page.evaluate(() => ({
      document: document.title,
      shell: window.__marxyHandle.shell.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0],
    }));
    assert.deepEqual(title, { document: 'A.md — Marxy', shell: 'A.md — marxy' });
    const identity = await page.evaluate(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      return {
        views: a.view !== b.view,
        stores: a.view.store() !== b.view.store() && a.view.store() !== null && b.view.store() !== null,
        marks: window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'split_open').length,
        ratio: document.getElementById('marxy-main').style.gridTemplateColumns,
      };
    });
    assert.deepEqual(identity, { views: true, stores: true, marks: 1, ratio: '0.5fr 0.5fr' });
  });
});

test('focus marks exactly one pane and puts the keyboard in it', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    const focus = await page.evaluate(() => {
      const panes = window.__marxyHandle.panes();
      const seen = [];
      panes.onChange((e) => seen.push(`${e.kind}:${e.pane?.slot}`));
      panes.focus(panes.panes[1]);
      return {
        marked: [...document.querySelectorAll('[data-marxy-focus]')].map((el) => el.getAttribute('data-marxy-pane')),
        active: panes.panes[1].host.contains(document.activeElement),
        focused: panes.focused.slot,
        current: window.__marxyHandle.currentPath(),
        seen,
        title: document.title,
      };
    });
    assert.deepEqual(focus, { marked: ['1'], active: true, focused: 1, current: '/r/B.md', seen: ['focus:1'], title: 'B.md — Marxy' });
  });
});

test('onSplit runs once when the second pane appears, and its cleanup once when it goes', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    const counts = await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      const counts = { split: 0, cleanup: 0, main: false };
      panes.onSplit((main) => {
        counts.split += 1;
        counts.main = main === document.getElementById('marxy-main');
        return () => {
          counts.cleanup += 1;
        };
      });
      const atRest = { ...counts };
      await panes.openIn('other', '/r/B.md');
      const split = { ...counts };
      // Replacing the second pane's document is not a new split.
      await panes.openIn(1, '/r/C.md');
      await panes.close(panes.panes[1]);
      return { atRest, split, closed: { ...counts } };
    });
    assert.deepEqual(counts, {
      atRest: { split: 0, cleanup: 0, main: false },
      split: { split: 1, cleanup: 0, main: true },
      closed: { split: 1, cleanup: 1, main: true },
    });
  });
});

test('closing the left pane leaves the survivor as #doc, unsplit, with one typesetter, one observer and one watch, ten times over', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    const once = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const panes = handle.panes();
      const split = window.__marxyWatches;
      const closed = await panes.close(panes.panes[0]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { closed, counts: handle.debugCounts(), path: handle.currentPath(), focused: panes.focused.slot, watches: [split, window.__marxyWatches] };
    });
    assert.deepEqual(once, { closed: true, counts: { typesetters: 1, resizeObservers: 1 }, path: '/r/B.md', focused: 0, watches: [2, 1] });
    const state = await layout(page);
    assert.equal(state.split, false);
    assert.deepEqual(
      state.panes.map(({ slot, article, notices, source, heading, focus }) => ({ slot, article, notices, source, heading, focus })),
      [{ slot: '0', article: 'doc', notices: 'marxy-notices', source: 'marxy-source', heading: 'Bravo', focus: true }],
    );
    assert.equal(await page.evaluate(() => document.getElementById('marxy-main').hasAttribute('style')), false, 'the grid template is cleared');
    // Every way a pane goes: the left one (its store shared with the survivor for the swap), the right one
    // over a different document, and either one over the same document (one store, two watches until
    // D-10). A pane that lets go of a store the other still shows closes its own watch on it.
    const cycles = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const panes = handle.panes();
      const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
      const watches = {};
      for (let i = 0; i < 10; i++) {
        await panes.openIn('other', i % 2 === 0 ? '/r/A.md' : '/r/C.md');
        await panes.close(panes.panes[i % 2]);
      }
      await settle();
      watches.mixed = window.__marxyWatches;
      for (let i = 0; i < 10; i++) {
        await panes.openIn('other', i % 2 === 0 ? '/r/A.md' : '/r/C.md');
        await panes.close(panes.panes[0]);
      }
      await settle();
      watches.closeLeft = window.__marxyWatches;
      for (let i = 0; i < 10; i++) {
        await panes.openIn('other', i % 2 === 0 ? '/r/A.md' : '/r/C.md');
        await panes.close(panes.panes[1]);
      }
      await settle();
      watches.closeRight = window.__marxyWatches;
      for (let i = 0; i < 10; i++) {
        await panes.openIn('other', handle.currentPath());
        await settle();
        watches.sameFileSplit ??= window.__marxyWatches;
        await panes.close(panes.panes[i % 2]);
      }
      await settle();
      watches.sameFile = window.__marxyWatches;
      return { counts: handle.debugCounts(), panes: panes.panes.length, docs: document.querySelectorAll('article.marxy-article').length, watches };
    });
    assert.deepEqual(cycles, {
      counts: { typesetters: 1, resizeObservers: 1 },
      panes: 1,
      docs: 1,
      watches: { mixed: 1, closeLeft: 1, closeRight: 1, sameFileSplit: 2, sameFile: 1 },
    });
  });
});

test('closing the right pane leaves the left pane and its document untouched', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    const result = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const panes = handle.panes();
      const left = panes.panes[0];
      const article = left.article;
      const store = left.view.store();
      const rightStore = panes.panes[1].view.store();
      panes.focus(panes.panes[1]);
      const closed = await panes.close(panes.panes[1]);
      const isOpen = (s) => s.undo().then(() => true, () => false);
      return {
        closed,
        same: panes.panes[0] === left && document.getElementById('doc') === article && left.view.store() === store,
        gone: document.getElementById('doc-2') === null && document.getElementById('marxy-notices-2') === null,
        counts: handle.debugCounts(),
        focused: panes.focused.slot,
        // The closed pane held B alone: its store closes with it. A stays open in the left pane.
        stores: { left: await isOpen(store), closed: await isOpen(rightStore) },
        title: document.title,
      };
    });
    assert.deepEqual(result, {
      closed: true,
      same: true,
      gone: true,
      counts: { typesetters: 1, resizeObservers: 1 },
      focused: 0,
      stores: { left: true, closed: false },
      title: 'A.md — Marxy',
    });
  });
});

test('canSplit false refuses a second pane; beforeReplace false keeps the document; the only pane does not close', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    const result = await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      panes.canSplit = () => false;
      const refused = await panes.openIn('other', '/r/B.md');
      const afterRefusal = { panes: panes.panes.length, split: document.getElementById('marxy-main').hasAttribute('data-marxy-split') };
      const onlyClose = await panes.close(panes.panes[0]);
      panes.canSplit = undefined;
      await panes.openIn('other', '/r/B.md');
      const asked = [];
      panes.beforeReplace = async (pane) => {
        asked.push(pane.slot);
        return false;
      };
      const kept = await panes.openIn(1, '/r/C.md');
      const notClosed = await panes.close(panes.panes[1]);
      return {
        refused,
        afterRefusal,
        onlyClose,
        kept,
        notClosed,
        asked,
        right: panes.panes[1].path(),
        heading: document.querySelector('#doc-2 h1')?.textContent,
      };
    });
    assert.deepEqual(result, {
      refused: null,
      afterRefusal: { panes: 1, split: false },
      onlyClose: false,
      kept: null,
      notClosed: false,
      asked: [1, 1],
      right: '/r/B.md',
      heading: 'Bravo',
    });
  });
});

test('the same file in both panes is one store; each pane has its own notices region and its own Source editor', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/A.md'] });
    const result = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const panes = handle.panes();
      const [left, right] = panes.panes;
      const { ensureNoticesRegion } = await import('/src/notices/index.ts');
      const regions = [ensureNoticesRegion().id, ensureNoticesRegion(right.host).id, ensureNoticesRegion(left.host).id];
      const sameStore = left.view.store() === right.view.store();
      // Source in both panes: two editors, one per mount; closing the right pane leaves the left one's.
      await left.view.toggleMode();
      await right.view.toggleMode();
      const editors = [left, right].map((pane) => pane.parts.source.querySelectorAll('.cm-editor').length);
      await panes.close(right);
      const leftEditor = document.querySelector('#marxy-source .cm-editor');
      return {
        regions,
        sameStore,
        editors,
        leftEditorAlive: leftEditor !== null && leftEditor.isConnected && left.view.mode === 'source',
        storeOpen: left.view.store() !== null && (await left.view.store().undo().then(() => true, () => false)),
      };
    });
    assert.deepEqual(result, {
      regions: ['marxy-notices', 'marxy-notices-2', 'marxy-notices'],
      sameStore: true,
      editors: [1, 1],
      leftEditorAlive: true,
      storeOpen: true,
    });
  });
});

test("closing the left pane keeps what was typed in the right pane's Source, and its mode", async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.toggleMode());
    await page.click('#marxy-source-2 .cm-content');
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('TYPED ');
    const result = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const panes = handle.panes();
      const right = panes.panes[1];
      const store = right.view.store();
      const before = { unfolded: right.view.sourceHasUnfoldedEdits(), mode: right.view.mode };
      const closed = await panes.close(panes.panes[0]);
      const left = panes.panes[0];
      const text = new TextDecoder().decode(left.view.store().snapshot().buffer.bytes);
      return {
        before,
        closed,
        sameStore: left.view.store() === store,
        typed: text.startsWith('TYPED # Bravo'),
        dirty: left.view.store().snapshot().dirty,
        mode: left.view.mode,
        body: document.body.getAttribute('data-marxy-mode'),
        editor: document.querySelector('#marxy-source .cm-content')?.textContent.startsWith('TYPED # Bravo') ?? false,
      };
    });
    assert.deepEqual(result, {
      before: { unfolded: true, mode: 'source' },
      closed: true,
      sameStore: true,
      typed: true,
      dirty: true,
      mode: 'source',
      body: 'source',
      editor: true,
    });
  });
});

test('closing the left pane closes its store when the survivor shows another document; an empty right pane refuses it', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md', '/r/B.md'] });
    const result = await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      const isOpen = (s) => s.undo().then(() => true, () => false);
      const a = panes.panes[0].view.store();
      await panes.close(panes.panes[0]);
      const closedA = !(await isOpen(a));
      // A right pane whose read failed shows nothing: closing the left one would drop the wrong document.
      await panes.openIn('other', '/r/missing.md');
      const empty = panes.panes[1].path();
      const refused = await panes.close(panes.panes[0]);
      return { closedA, empty, refused, panes: panes.panes.length, left: panes.panes[0].path() };
    });
    assert.deepEqual(result, { closedA: true, empty: null, refused: false, panes: 2, left: '/r/B.md' });
  });
});

test('onLanded fires in the pane opened, with the open change, and never when the set refuses', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    const result = await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      const seen = [];
      panes.onChange((e) => e.kind === 'open' && seen.push(`open:${e.pane.slot}:${e.pane.path()}`));
      const landed = (label) => () => seen.push(`landed:${label}:${panes.panes.map((p) => p.path()).join(',')}`);
      await panes.openIn('other', '/r/B.md', { onLanded: landed('other') });
      await panes.openIn(0, '/r/C.md', { onLanded: landed('slot0') });
      panes.beforeReplace = async () => false;
      const replaceRefused = await panes.openIn(1, '/r/A.md', { onLanded: landed('refused') });
      panes.beforeReplace = undefined;
      await panes.close(panes.panes[1]);
      panes.canSplit = () => false;
      const splitRefused = await panes.openIn('other', '/r/A.md', { onLanded: landed('nosplit') });
      return { seen, replaceRefused, splitRefused };
    });
    assert.deepEqual(result, {
      seen: ['open:1:/r/B.md', 'landed:other:/r/A.md,/r/B.md', 'open:0:/r/C.md', 'landed:slot0:/r/C.md,/r/B.md'],
      replaceRefused: null,
      splitRefused: null,
    });
  });
});

test('over unsaved edits, openIn resolves at the prompt; the open change and onLanded wait for the choice', async () => {
  await withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    const asked = await page.evaluate(async () => {
      const panes = window.__marxyHandle.panes();
      window.__seen = [];
      panes.onChange((e) => e.kind === 'open' && window.__seen.push(`open:${e.pane.path()}`));
      const store = panes.panes[0].view.store();
      await store.apply({ range: { file: '/r/A.md', start: 2, end: 7 }, replacement: 'Edited', label: 'edit', baseVersion: store.snapshot().version });
      const pane = await panes.openIn('focused', '/r/C.md', { onLanded: () => window.__seen.push('landed') });
      return { pane: pane?.slot, path: panes.panes[0].path(), seen: [...window.__seen] };
    });
    assert.deepEqual(asked, { pane: 0, path: '/r/A.md', seen: [] });
    await page.getByRole('button', { name: 'Open without saving' }).click();
    await page.waitForFunction(() => window.__seen.length === 2);
    const landed = await page.evaluate(() => ({ path: window.__marxyHandle.panes().panes[0].path(), seen: window.__seen }));
    assert.deepEqual(landed, { path: '/r/C.md', seen: ['open:/r/C.md', 'landed'] });
  });
});
