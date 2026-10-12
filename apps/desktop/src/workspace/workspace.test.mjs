// The workspace shell (W-02; ADR-0058): two states, six empty regions in a grid around the panes, the reading
// column that never moves when the workspace unfolds, and the panels the reader last had, kept in
// workspace.json. The browser tests boot the real app on the shipped skeleton and CSS (test/support/two-pane.mjs)
// over the memory shell, in WebKit; the rest need no browser.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { WORKSPACE_REGIONS } from '@marxy/core/src/layout/workspace-storage.ts';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from '../../test/support/two-pane.mjs';
import { PANE_CHORDS, paneChordFor } from '../pane/keys.ts';
import { INSPECTOR_MIN_WINDOW, NARROW_WINDOW, arrangementFor } from './state.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
const plain = (name, fn) => nodeTest(name, fn);
after(() => closeHarness());

const repo = (rel) => readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), 'utf8');
const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';
const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(8)}\n\n## Later\n\n${para('Later').repeat(8)}\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(4)}\n`,
};

async function withPage(width, fn, extra = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await bootTwoPanes(page, { files: { ...files, ...extra }, open: ['/r/A.md'] });
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** The reading column: the article's left edge and width, and what the window is. */
const column = (page) =>
  page.evaluate(() => {
    const r = document.getElementById('doc').getBoundingClientRect();
    return { x: r.x, width: r.width, window: document.documentElement.clientWidth };
  });
const unfold = (page) => page.evaluate(() => window.__marxyHandle.workspace().unfold());
const fold = (page) => page.evaluate(() => window.__marxyHandle.workspace().fold());

// --- the names the gate holds -------------------------------------------------------------------------------

plain('the gate, the registry and the app spell the workspace vocabulary alike', () => {
  const gate = repo('scripts/gate-aesthetics.mjs');
  const regions = JSON.parse(gate.match(/regions:\s*(\[[^\]]*\])/)[1].replaceAll("'", '"'));
  assert.deepEqual(regions, [...WORKSPACE_REGIONS], 'the gate WORKSPACE.regions is the app list');
  assert.equal(gate.match(/attribute:\s*'([^']+)'/)[1], 'data-marxy-workspace');
  assert.equal(gate.match(/regionAttribute:\s*'([^']+)'/)[1], 'data-marxy-workspace-region');
  const registry = JSON.parse(repo('scripts/registry.json')).dataAttributes;
  for (const name of ['data-marxy-workspace', 'data-marxy-workspace-region']) assert.ok(registry.includes(name), `${name} is in the registry`);
});

// --- the arrangement ----------------------------------------------------------------------------------------

plain('with nothing remembered every region is docked, the inspector only in a window of 1600 px or more', () => {
  const narrow = arrangementFor({}, INSPECTOR_MIN_WINDOW - 1);
  const wide = arrangementFor({}, INSPECTOR_MIN_WINDOW);
  for (const name of WORKSPACE_REGIONS) assert.equal(narrow[name], name !== 'inspector', `${name} at ${INSPECTOR_MIN_WINDOW - 1}`);
  for (const name of WORKSPACE_REGIONS) assert.equal(wide[name], true, `${name} at ${INSPECTOR_MIN_WINDOW}`);
});

plain('what was remembered wins over the width, a region at a time', () => {
  const got = arrangementFor({ inspector: true, sidebar: false }, 900);
  assert.equal(got.inspector, true);
  assert.equal(got.sidebar, false);
  assert.equal(got.toolbar, true);
});

// --- folded is today ----------------------------------------------------------------------------------------

test('a fresh profile opens folded: no attribute, no region, nothing read from workspace.json', async () => {
  await withPage(1280, async (page) => {
    const got = await page.evaluate(() => ({
      mode: window.__marxyHandle.workspace().mode,
      attribute: document.body.getAttribute('data-marxy-workspace'),
      regions: document.querySelectorAll('[data-marxy-workspace-region]').length,
      touched: window.__marxyHandle.shell.calls.filter((c) => JSON.stringify(c.args).includes('workspace.json')).length,
      main: document.getElementById('marxy-main').getBoundingClientRect().width,
      window: document.documentElement.clientWidth,
    }));
    assert.deepEqual(got, { mode: 'folded', attribute: null, regions: 0, touched: 0, main: got.window, window: got.window });
  });
});

// --- unfolded: six regions, the column does not move --------------------------------------------------------

test('unfolding puts the six regions in the page, in order, and nothing else outside #marxy-main is visible', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    const got = await page.evaluate(() => {
      const main = document.getElementById('marxy-main');
      const regions = [...document.querySelectorAll('[data-marxy-workspace-region]')];
      const visible = [];
      for (const el of document.body.querySelectorAll('*')) {
        if (el === main || main.contains(el) || el.closest('[data-marxy-workspace-region]')) continue;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0) visible.push(el.tagName.toLowerCase());
      }
      return {
        attribute: document.body.getAttribute('data-marxy-workspace'),
        names: regions.map((r) => r.getAttribute('data-marxy-workspace-region')),
        children: regions.map((r) => r.childElementCount + r.textContent.length),
        parents: [...new Set(regions.map((r) => r.parentElement.tagName))],
        shown: regions.map((r) => !r.hidden),
        docked: regions.map((r) => window.__marxyHandle.workspace().arrangement[r.getAttribute('data-marxy-workspace-region')]),
        visible,
        order: [...document.body.children].map((c) => c.getAttribute('data-marxy-workspace-region') ?? c.id).filter(Boolean),
      };
    });
    assert.equal(got.attribute, 'unfolded');
    assert.deepEqual(got.names, ['sidebar', 'toolbar', 'tabs', 'strip', 'inspector', 'status-bar']);
    // The sidebar (W-07: its element, empty here, as no palette feeds it), the toolbar, the tab row (W-06: one tab for the one document) and the inspector (W-09: its strip of tabs, though undocked here) hold content; the strip (K-07) has a fill but nothing for an article.
    assert.deepEqual(got.children.map((n, i) => (['sidebar', 'toolbar', 'tabs', 'inspector'].includes(got.names[i]) ? n > 0 : n === 0)), [true, true, true, true, true, true], `only the sidebar, the toolbar, the one tab and the inspector's strip hold content (${got.children})`);
    assert.deepEqual(got.parents, ['BODY']);
    // The strip and the tabs are docked too (the arrangement says so). The strip holds nothing for an article, so its band is hidden (K-07);
    // one document is one tab, and the tab row shows from two (W-06).
    assert.deepEqual(got.shown, [true, true, false, false, false, false], 'a 1280 px window docks everything but the inspector; an empty strip, a row of one tab and a status bar with no fill are hidden from what is on them');
    assert.deepEqual(got.docked, [true, true, true, true, false, true], 'and the arrangement still says docked');
    assert.deepEqual(got.visible, [], 'a stray element outside the regions is what the gate would fail');
    assert.deepEqual(got.order.slice(0, 6), ['sidebar', 'toolbar', 'tabs', 'strip', 'marxy-main', 'inspector']);
  });
});

test('the reading column has the same left edge and width folded and unfolded (inspector docked, and not)', async () => {
  for (const width of [1280, 1700]) {
    await withPage(width, async (page) => {
      const folded = await column(page);
      await unfold(page);
      await page.waitForTimeout(100);
      const open = await column(page);
      assert.equal(open.x, folded.x, `x at ${width}`);
      assert.equal(open.width, folded.width, `width at ${width}`);
      await page.evaluate((docked) => window.__marxyHandle.workspace().setPanel('inspector', docked), width < 1600);
      const toggled = await column(page);
      assert.equal(toggled.x, folded.x, `x at ${width}, the inspector the other way`);
      assert.equal(toggled.width, folded.width, `width at ${width}, the inspector the other way`);
      await fold(page);
      assert.deepEqual(await column(page), folded, `folded again at ${width}`);
    });
  }
});

test('the column does not move when the sidebar alone is docked either', async () => {
  await withPage(1440, async (page) => {
    const folded = await column(page);
    await unfold(page);
    await page.evaluate(() => {
      const ws = window.__marxyHandle.workspace();
      for (const name of ['toolbar', 'tabs', 'strip', 'status-bar', 'inspector']) ws.setPanel(name, false);
    });
    const got = await column(page);
    assert.equal(got.x, folded.x);
    assert.equal(got.width, folded.width);
  });
});

test('U-01: the bands reach the window edge, no region shows empty, and the column holds still in every state', async () => {
  await withPage(1440, async (page) => {
    const folded = await column(page);
    const same = (got, what) => {
      assert.equal(got.x, folded.x, `x ${what}`);
      assert.equal(got.width, folded.width, `width ${what}`);
    };
    const edges = (name) => page.evaluate((n) => {
      const el = document.querySelector(`[data-marxy-workspace-region="${n}"]`);
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, shown: !el.hidden };
    }, name);
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', false));
    const bar = await edges('toolbar');
    assert.equal(bar.right, 1440, 'the toolbar runs to the window edge (it ended at 1188)');
    assert.equal(bar.left, 252, 'and starts at the sidebar edge');
    assert.equal((await edges('status-bar')).shown, false, 'a status bar with no fill is not drawn');
    same(await column(page), 'unfolded, sidebar docked');
    // The bands stop at the inspector's edge while it is docked.
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
    const withInspector = await edges('toolbar');
    assert.equal(withInspector.right, (await edges('inspector')).left, 'the toolbar ends at the inspector');
    same(await column(page), 'inspector docked');
    // No sidebar: the bands start at the window edge.
    await page.evaluate(() => {
      const ws = window.__marxyHandle.workspace();
      ws.setPanel('inspector', false);
      ws.setPanel('sidebar', false);
    });
    assert.equal((await edges('toolbar')).left, 0, 'with no sidebar the toolbar starts at the left edge');
    same(await column(page), 'sidebar undocked');
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('sidebar', true));
    same(await column(page), 'sidebar docked again');
    await fold(page);
    same(await column(page), 'folded again');
    // A peek floats over the folded page.
    const peeked = await page.evaluate(() => window.__marxyHandle.workspace().peek('sidebar'));
    if (peeked) same(await column(page), 'a sidebar peek');
  });
});

/** A region's box and whether it is drawn (docked, filled and not display: none). */
const regionBox = (page, name) =>
  page.evaluate((n) => {
    const el = document.querySelector(`[data-marxy-workspace-region="${n}"]`);
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, drawn: !el.hidden && getComputedStyle(el).display !== 'none' && r.width > 0 };
  }, name);
const panes = (page) =>
  page.evaluate(() => {
    const r = document.getElementById('marxy-main').getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
const setPanels = (page, sidebar, inspector) =>
  page.evaluate(([s, i]) => {
    const ws = window.__marxyHandle.workspace();
    ws.setPanel('sidebar', s);
    ws.setPanel('inspector', i);
  }, [sidebar, inspector]);

// U-01's review: the sidebar-off/inspector-on, Split and narrow states were never measured, and a deliberately asymmetric grid passed.
for (const [name, width, open] of [['one pane', 1440, ['/r/A.md']], ['two panes (Split)', 1900, ['/r/A.md', '/r/B.md']]]) {
  test(`U-08: ${name}, the panes stay centred (and one pane's column is where it is folded) in all four arrangements of the two side panels`, async () => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await bootTwoPanes(page, { files, open });
      if (open.length > 1) assert.equal(await page.evaluate(() => document.getElementById('marxy-main').hasAttribute('data-marxy-split')), true, 'a split is showing');
      const folded = await column(page);
      await unfold(page);
      for (const [sidebar, inspector] of [[true, false], [false, true], [true, true], [false, false]]) {
        await setPanels(page, sidebar, inspector);
        await page.waitForTimeout(50);
        assert.equal((await regionBox(page, 'inspector')).drawn, inspector, `the inspector is ${inspector ? 'drawn' : 'away'}`);
        assert.equal((await regionBox(page, 'sidebar')).drawn, sidebar, `the sidebar is ${sidebar ? 'drawn' : 'away'}`);
        const main = await panes(page);
        assert.ok(Math.abs(main.left + main.right - width) < 1, `the panes are centred on the window (${main.left}..${main.right}), sidebar ${sidebar}, inspector ${inspector}, ${name}`);
        if (open.length === 1) {
          const got = await column(page);
          assert.equal(got.x, folded.x, `x, sidebar ${sidebar}, inspector ${inspector}, ${name}`);
          assert.equal(got.width, folded.width, `width, sidebar ${sidebar}, inspector ${inspector}, ${name}`);
        }
      }
    } finally {
      await browser.close();
    }
  });
}

test('U-08: at 760 px the sidebar is not docked, the right reserve is zero and the panes take the window', async () => {
  await withPage(760, async (page) => {
    const folded = await column(page);
    await unfold(page);
    await page.waitForTimeout(50);
    const arrangement = await page.evaluate(() => window.__marxyHandle.workspace().arrangement);
    assert.equal(arrangement.sidebar, false, 'the sidebar is not docked by default below 900 px');
    assert.equal((await regionBox(page, 'sidebar')).drawn, false);
    const p = await panes(page);
    assert.equal(p.left, 0);
    assert.equal(p.right, 760, 'no reserve on the right');
    assert.ok(p.width >= 700, `the panes are ${p.width} px wide (448 before)`);
    assert.ok(p.overflow <= 0, 'nothing runs off the window');
    const got = await column(page);
    assert.equal(got.x, folded.x, 'the column is where it is folded');
    assert.equal(got.width, folded.width);
    const title = await page.evaluate(() => {
      const el = document.querySelector('.marxy-toolbar [data-marxy-toolbar-item="title"]');
      return el ? getComputedStyle(el).display : 'absent';
    });
    assert.ok(title === 'none' || title === 'absent', `the toolbar has dropped its title (${title})`);
    // The reader docks the sidebar at this width: it is honoured, and still nothing is reserved on the right.
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('sidebar', true));
    await page.waitForTimeout(400);
    const docked = await panes(page);
    assert.equal(docked.left, 252, 'the docked sidebar takes its 252 px');
    assert.equal(docked.right, 760, 'and the right is still the window edge');
    assert.ok(docked.overflow <= 0, 'nothing runs off the window once the lines are set to the new width');
  });
});

test('U-08: a docked inspector lies over the page at 760 px, moves nothing, and is never over Source', async () => {
  await withPage(760, async (page) => {
    await unfold(page);
    const before = await panes(page);
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
    const inspector = await regionBox(page, 'inspector');
    assert.equal(inspector.drawn, true, 'the inspector is drawn over the page');
    assert.equal(inspector.right, 760);
    assert.ok(inspector.top > 0, 'under the bands');
    assert.deepEqual(await panes(page), before, 'the panes did not move for it');
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForSelector('.cm-editor');
    assert.equal((await regionBox(page, 'inspector')).drawn, false, 'not over Source');
    assert.deepEqual(await panes(page), before, 'Source has the same panes');
  });
});

/** The inspector door as a reader meets it: the toggle's state, what the palette lists, and whether it is drawn. */
const inspectorDoor = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-marxy-workspace-region="inspector"]');
    const toggle = document.querySelector('[data-marxy-toolbar-item="inspector"] button');
    return {
      docked: window.__marxyHandle.workspace().arrangement?.inspector,
      drawn: !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0,
      pressed: toggle?.getAttribute('aria-pressed') ?? 'absent',
      disabled: toggle?.getAttribute('aria-disabled') ?? 'no',
      tip: toggle?.title ?? '',
    };
  });
/** The palette lists a command that is `listed` and whose `when` holds (palette/commands.ts); `when` here ignores its context. */
const paletteListsInspector = (page) =>
  page.evaluate(() => {
    const c = window.__marxyHandle.commands().find((x) => x.id === 'view.toggle-inspector');
    return c.listed !== false && c.when({});
  });

for (const [name, open, enter] of [
  ['Source', ['/r/A.md'], async (page, mod) => { await page.keyboard.press(`${mod}+KeyE`); await page.waitForSelector('.cm-editor'); }],
  ['Split', ['/r/A.md', '/r/B.md'], async (page) => { await page.setViewportSize({ width: 760, height: 900 }); await page.waitForTimeout(300); assert.equal(await page.evaluate(() => document.getElementById('marxy-main').hasAttribute('data-marxy-split')), true, 'a split is showing'); }],
]) {
  test(`U-08: at 760 px in ${name} the inspector key does nothing, the door says why, and widening shows the docked choice`, async () => {
    const browser = await launchWebkit();
    try {
      // A split needs room to lay out: it is made wide, then the window is narrowed.
      const page = await browser.newPage({ viewport: { width: open.length > 1 ? 1900 : 760, height: 900 } });
      await bootTwoPanes(page, { files, open });
      const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
      await enter(page, mod);
      await unfold(page);
      await page.waitForTimeout(100);
      await page.keyboard.press(`${mod}+Alt+KeyI`);
      await page.waitForTimeout(100);
      const shut = await inspectorDoor(page);
      assert.equal(shut.docked, false, 'the key did nothing: the inspector was not docked');
      assert.equal(shut.pressed, 'false', 'the toggle is not shown as on');
      assert.equal(shut.disabled, 'true', 'the toggle is disabled');
      assert.match(shut.tip, /wider window/, 'and says why');
      assert.equal(shut.drawn, false);
      assert.equal(await paletteListsInspector(page), false, 'the palette does not offer it');
      // The reader's choice is kept: docked while the door is shut (a stored choice), it shows once the window widens.
      await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
      const kept = await inspectorDoor(page);
      assert.equal(kept.pressed, 'false', 'a docked choice is still not shown as on while it cannot show');
      assert.equal(kept.drawn, false);
      await page.setViewportSize({ width: 1100, height: 900 });
      await page.waitForTimeout(300);
      const wide = await inspectorDoor(page);
      assert.equal(wide.docked, true, 'the choice was kept');
      assert.equal(wide.pressed, 'true');
      assert.equal(wide.disabled, 'no');
      assert.equal(wide.drawn, true, 'widening shows the inspector');
      assert.equal(await paletteListsInspector(page), true, 'and the palette offers it again');
    } finally {
      await browser.close();
    }
  });
}

test('U-08: at 760 px in Read the inspector key still docks it over the page, and the toggle is on', async () => {
  await withPage(760, async (page) => {
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await unfold(page);
    await page.keyboard.press(`${mod}+Alt+KeyI`);
    await page.waitForTimeout(100);
    const door = await inspectorDoor(page);
    assert.deepEqual([door.docked, door.drawn, door.pressed, door.disabled], [true, true, 'true', 'no']);
    assert.equal(await paletteListsInspector(page), true);
  });
});

test('U-08: the narrow default is not the reader\'s choice: widening brings the sidebar back, and a choice made narrow stays', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    const sidebar = () => page.evaluate(() => window.__marxyHandle.workspace().arrangement.sidebar);
    await unfold(page);
    assert.equal(await sidebar(), false, 'narrow: undocked');
    await fold(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unfold(page);
    assert.equal(await sidebar(), true, 'widened: the default was not remembered as a choice');
    await fold(page);
    await page.setViewportSize({ width: 760, height: 900 });
    await unfold(page);
    assert.equal(await sidebar(), true, 'narrowed again: the remembered choice is honoured');
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('sidebar', false));
    await fold(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unfold(page);
    assert.equal(await sidebar(), false, 'a sidebar the reader undocked stays undocked when widening');
  } finally {
    await browser.close();
  }
});

plain('the narrow line is the stylesheet\'s line', () => {
  assert.equal(NARROW_WINDOW, 900);
  assert.match(repo('packages/theme/src/base.css'), new RegExp(`@media \\(max-width: ${NARROW_WINDOW - 0.02}px\\)`));
  const narrow = arrangementFor({}, NARROW_WINDOW - 1);
  assert.equal(narrow.sidebar, false);
  assert.equal(arrangementFor({}, NARROW_WINDOW).sidebar, true);
  assert.equal(arrangementFor({ sidebar: true }, 760).sidebar, true, 'what was remembered wins');
});

test('at the two-column floor the column still holds its 45 characters unfolded', async () => {
  const browser = await launchWebkit();
  try {
    const probe = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(probe, { files, open: ['/r/A.md'] });
    const floor = await probe.evaluate(async () => {
      const { readSplitMetrics } = await import('/src/pane/fit.ts');
      const m = readSplitMetrics(document.getElementById('marxy-main'));
      return Math.ceil(2 * (45 * m.avgChar * m.bodyPx + 2 * m.gutterPx));
    });
    await probe.close();
    assert.ok(floor >= 900 && floor <= 960, `the floor is about 929 px (${floor})`);
    const page = await browser.newPage({ viewport: { width: floor, height: 900 } });
    await bootTwoPanes(page, { files, open: ['/r/A.md'] });
    const folded = await column(page);
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
    const got = await page.evaluate(() => {
      const article = document.getElementById('doc');
      const root = getComputedStyle(document.documentElement);
      const s = getComputedStyle(article);
      const content = parseFloat(s.width);
      return {
        chars: content / (parseFloat(root.getPropertyValue('--marxy-avg-char')) * parseFloat(root.getPropertyValue('--marxy-size-body'))),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pane: document.getElementById('marxy-main').getBoundingClientRect().width,
      };
    });
    assert.ok(got.chars >= 45 - 0.01, `${got.chars.toFixed(2)} characters in the column at ${floor} px with both panels docked`);
    assert.ok(got.overflow <= 0, 'nothing runs off the window');
    assert.ok(folded.width >= (await column(page)).width, 'the column is narrower than folded only because the measure no longer fits');
    await page.close();
  } finally {
    await browser.close();
  }
});

test('the room two panes need includes the panels: the refusal names the wider window', async () => {
  await withPage(1200, async (page) => {
    const got = async () =>
      page.evaluate(async () => {
        const { splitRefusal } = await import('/src/pane/fit.ts');
        return splitRefusal(window.__marxyHandle.panes());
      });
    assert.equal(await got(), null, 'folded, 1200 px holds two columns');
    await unfold(page);
    const refusal = await got();
    assert.match(refusal, /at least (\d+) px wide/);
    assert.ok(Number(refusal.match(/at least (\d+) px/)[1]) > 1200, refusal);
  });
});

// --- Source and the grid ------------------------------------------------------------------------------------

/** Every Source editor, the notices line of each pane and the article, against `#marxy-main`. */
const containment = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const main = box(document.getElementById('marxy-main'));
    const inside = (r) =>
      r.left >= main.left - 0.5 && r.right <= main.right + 0.5 && r.top >= main.top - 0.5 && r.bottom <= main.bottom + 0.5 &&
      r.editorLeft >= main.left - 0.5 && r.editorRight <= main.right + 0.5;
    // The editor is as tall as its text and scrolls inside its mount: the mount is what must fit the column,
    // and the editor must fit it across.
    const editors = [...document.querySelectorAll('.marxy-source-mount:not([hidden])')].map((m) => {
      const mount = box(m);
      const editor = box(m.querySelector('.cm-editor'));
      return { ...mount, editorLeft: editor.left, editorRight: editor.right };
    });
    const notices = [...document.querySelectorAll('.marxy-pane [role=status]')].map(box).filter((r) => r.width > 0);
    return { main, editors, editorsInside: editors.map(inside), noticesInside: notices.map((r) => r.left >= main.left - 0.5 && r.right <= main.right + 0.5) };
  });

for (const [name, open] of [['one pane', ['/r/A.md']], ['two panes', ['/r/A.md', '/r/B.md']]]) {
  test(`unfolded, ${name}: the Source editor and the notices stay inside the panes' column, and so does Rendered`, async () => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
      await bootTwoPanes(page, { files, open });
      await unfold(page);
      await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
      const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
      const rendered = await page.evaluate(() => {
        const main = document.getElementById('marxy-main').getBoundingClientRect();
        return [...document.querySelectorAll('.marxy-article')].map((a) => {
          const r = a.getBoundingClientRect();
          return r.left >= main.left - 0.5 && r.right <= main.right + 0.5;
        });
      });
      assert.ok(rendered.length > 0 && rendered.every(Boolean), `Rendered articles inside #marxy-main: ${rendered}`);
      await page.keyboard.press(`${mod}+KeyE`);
      await page.waitForSelector('.cm-editor');
      await page.waitForTimeout(150);
      const got = await containment(page);
      assert.ok(got.editors.length >= 1, 'a Source editor is showing');
      assert.ok(got.main.left > 0 && got.main.right < 1470, `the panes' column is inside the window (${got.main.left}..${got.main.right})`);
      assert.deepEqual(got.editorsInside, got.editors.map(() => true), `the Source mount and .cm-editor inside #marxy-main ${JSON.stringify(got.main)}: ${JSON.stringify(got.editors)}`);
      assert.ok(got.noticesInside.every(Boolean), 'the notices line is inside #marxy-main');
      // Folded, one pane's Source is the window's: the rule is the workspace's and leaves today's page alone.
      await fold(page);
      const folded = await containment(page);
      assert.ok(folded.editors.length >= 1);
    } finally {
      await browser.close();
    }
  });
}

// --- the command, and the key ------------------------------------------------------------------------------

test('the command folds and unfolds, is in the palette list, and is the one command on Mod+\\', async () => {
  await withPage(1280, async (page) => {
    const got = await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      const command = handle.commands().find((c) => c.id === 'view.toggle-workspace');
      const keyed = handle.commands().filter((c) => c.key === 'Mod+\\' || (c.keys ?? []).includes('Mod+\\')).map((c) => c.id);
      const beside = handle.commands().find((c) => c.id === 'view.open-beside').key;
      const ctx = {};
      const before = handle.workspace().mode;
      await command.run(ctx);
      const during = handle.workspace().mode;
      await command.run(ctx);
      return { title: command.title, key: command.key ?? null, group: command.group, when: command.when(ctx), keyed, beside, before, during, after: handle.workspace().mode };
    });
    assert.deepEqual(got, {
      title: 'Fold or unfold the workspace',
      key: 'Mod+\\',
      group: 'view',
      when: true,
      keyed: ['view.toggle-workspace'],
      beside: 'Mod+Alt+\\',
      before: 'folded',
      during: 'unfolded',
      after: 'folded',
    });
  });
});

test('Mod+\\ on the keyboard folds and unfolds the workspace; Mod+Alt+\\ leaves it alone', async () => {
  await withPage(1470, async (page) => {
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const mode = () => page.evaluate(() => window.__marxyHandle.workspace().mode);
    assert.equal(await mode(), 'folded');
    await page.keyboard.press(`${mod}+Backslash`);
    await page.waitForFunction(() => window.__marxyHandle.workspace().mode === 'unfolded');
    await page.keyboard.press(`${mod}+Backslash`);
    await page.waitForFunction(() => window.__marxyHandle.workspace().mode === 'folded');
    await page.keyboard.press(`${mod}+Alt+Backslash`);
    await page.waitForTimeout(200);
    assert.equal(await mode(), 'folded', 'open beside (its own test, open-beside.test.mjs) does not fold or unfold');
  });
});

plain('the chords resolve on the physical key: Mod+\\ to the fold, Mod+Alt+\\ to open beside, each alone', () => {
  const press = (init) => paneChordFor({ code: 'Backslash', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, ...init }, true)?.command ?? null;
  assert.equal(press({}), 'view.toggle-workspace');
  assert.equal(press({ altKey: true, key: '«' }), 'view.open-beside');
  assert.equal(press({ shiftKey: true, key: '|' }), 'view.close-pane');
  assert.equal(press({ metaKey: false }), null, 'Mod is held for each');
});

plain('the pane chord table: Mod+\\ folds, Mod+Alt+\\ opens beside, Mod+Shift+\\ closes', () => {
  assert.deepEqual(PANE_CHORDS.filter((c) => c.code === 'Backslash').map((c) => [c.shift ?? false, c.alt ?? false, c.command]), [
    [false, false, 'view.toggle-workspace'],
    [false, true, 'view.open-beside'],
    [true, false, 'view.close-pane'],
  ]);
});

// --- the remembered arrangement -----------------------------------------------------------------------------

/** What a relaunch finds: the app's data files, read out of this page's memory shell. */
const workspaceFile = (page) =>
  page.evaluate(async () => {
    const shell = window.__marxyHandle.shell;
    return shell.hasFile('/data/workspace.json') ? new TextDecoder().decode(await shell.readFile('/data/workspace.json')) : null;
  });

test('fold, unfold, quit, relaunch: it opens folded, and unfolding brings back the last panels', async () => {
  let kept = null;
  await withPage(1280, async (page) => {
    assert.equal(await workspaceFile(page), null, 'launching writes nothing');
    await unfold(page);
    await page.evaluate(() => {
      const ws = window.__marxyHandle.workspace();
      ws.setPanel('sidebar', false);
      ws.setPanel('inspector', true);
      ws.setPanel('strip', false);
    });
    assert.equal(await workspaceFile(page), null, 'unfolded, nothing is written until the reader folds');
    await fold(page);
    const saved = JSON.parse(await workspaceFile(page));
    assert.deepEqual(saved, { version: 1, panels: { sidebar: false, toolbar: true, tabs: true, strip: false, inspector: true, 'status-bar': true } });
    await page.evaluate(() => window.__marxyHandle.shell.quit());
    kept = await workspaceFile(page);
  });
  // The next launch, on a new page over the same data directory.
  await withPage(1280, async (page) => {
    const launched = await page.evaluate(() => ({
      mode: window.__marxyHandle.workspace().mode,
      regions: document.querySelectorAll('[data-marxy-workspace-region]').length,
      attribute: document.body.getAttribute('data-marxy-workspace'),
      readBeforeUnfold: window.__marxyHandle.shell.calls.filter((c) => c.method === 'readHead' && JSON.stringify(c.args).includes('workspace.json')).length,
    }));
    assert.equal(launched.mode, 'folded');
    assert.equal(launched.regions, 0);
    assert.equal(launched.attribute, null);
    assert.equal(launched.readBeforeUnfold, 0, 'the launch did not read workspace.json');
    await unfold(page);
    const shown = await page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll('[data-marxy-workspace-region]')].map((r) => [r.getAttribute('data-marxy-workspace-region'), !r.hidden])),
    );
    // The tab row is docked (the saved file says so) and hides itself below two tabs (W-06); the status bar has no fill, so it is not drawn (U-01).
    assert.deepEqual(shown, { sidebar: false, toolbar: true, tabs: false, strip: false, inspector: true, 'status-bar': false });
    assert.deepEqual(await page.evaluate(() => window.__marxyHandle.workspace().arrangement), { sidebar: false, toolbar: true, tabs: true, strip: false, inspector: true, 'status-bar': true });
  }, { '/data/workspace.json': kept });
});

test('quitting while unfolded keeps the panels too', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('tabs', false));
    await page.evaluate(() => window.__marxyHandle.shell.quit());
    assert.equal(JSON.parse(await workspaceFile(page)).panels.tabs, false);
  });
});

test('a corrupt workspace file is kept beside itself, the window opens folded, and unfolding uses the defaults', async () => {
  await withPage(1280, async (page) => {
    assert.equal(await page.evaluate(() => window.__marxyHandle.workspace().mode), 'folded');
    await unfold(page);
    const shown = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-workspace-region]')].map((r) => !r.hidden));
    assert.deepEqual(shown, [true, true, false, false, false, false], 'the strip is docked and empty (K-07), the tab row holds one tab (W-06) and the status bar has no fill (U-01): each hidden from what is on it');
    assert.deepEqual(await page.evaluate(() => Object.values(window.__marxyHandle.workspace().arrangement)), [true, true, true, true, false, true], 'the defaults dock all but the inspector');
    const kept = await page.evaluate(async () => {
      const shell = window.__marxyHandle.shell;
      const bad = [];
      for (let t = 0; t < 1; t++) for (const key of shell.calls.filter((c) => c.method === 'writeFileAtomic').map((c) => c.args[0])) if (String(key).includes('workspace.json.bad-')) bad.push(key);
      return { bad, text: shell.hasFile(bad[0] ?? '') ? new TextDecoder().decode(await shell.readFile(bad[0])) : null, now: new TextDecoder().decode(await shell.readFile('/data/workspace.json')) };
    });
    assert.equal(kept.bad.length, 1);
    assert.equal(kept.text, '{"version": 1, "panels": {"sidebar": ');
    assert.deepEqual(JSON.parse(kept.now), { version: 1, panels: {} });
  }, { '/data/workspace.json': '{"version": 1, "panels": {"sidebar": ' });
});

// --- the file failing, and a held key -----------------------------------------------------------------------

test('a workspace.json write that fails does not stop the fold, and the next fold writes it', async () => {
  await withPage(1280, async (page) => {
    await unfold(page);
    await page.evaluate(() => {
      window.__marxyHandle.workspace().setPanel('tabs', false);
      window.__marxyHandle.shell.rejectNextWrite('io');
    });
    await fold(page);
    assert.equal(await page.evaluate(() => window.__marxyHandle.workspace().mode), 'folded', 'the window folded anyway');
    assert.equal(await workspaceFile(page), null, 'the refused write left nothing behind');
    await unfold(page);
    await fold(page);
    assert.equal(JSON.parse(await workspaceFile(page)).panels.tabs, false, 'the next fold wrote the panels the reader had');
  });
});

test('a rejected first open is not remembered: a quarantine write that fails is retried at the next save', async () => {
  await withPage(1280, async (page) => {
    await page.evaluate(() => window.__marxyHandle.shell.rejectNextWrite('permission'));
    await unfold(page); // reads the corrupt file; the write that keeps its bytes is refused
    const first = await page.evaluate(() => ({ mode: window.__marxyHandle.workspace().mode, shown: [...document.querySelectorAll('[data-marxy-workspace-region]')].length }));
    assert.deepEqual(first, { mode: 'unfolded', shown: 6 }, 'the defaults apply');
    assert.equal(await workspaceFile(page), '{"version": 1, "panels": {"sidebar": ', 'the corrupt file is untouched');
    await fold(page); // opens again, quarantines, and writes
    const saved = JSON.parse(await workspaceFile(page));
    assert.equal(saved.version, 1);
    assert.ok(saved.panels.sidebar === true, 'the disk recovered and the panels were written');
  }, { '/data/workspace.json': '{"version": 1, "panels": {"sidebar": ' });
});

test('a held Mod+\\ strobes nothing, and presses that arrive together settle on the state they ask for', async () => {
  await withPage(1280, async (page) => {
    await page.evaluate(() => {
      window.__changes = [];
      window.__marxyHandle.workspace().onChange((mode) => window.__changes.push(mode));
      const press = (repeat) =>
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backslash', key: '\\', metaKey: navigator.platform === 'MacIntel', ctrlKey: navigator.platform !== 'MacIntel', repeat, bubbles: true, cancelable: true }));
      press(false);
      for (let i = 0; i < 6; i++) press(true);
    });
    await page.waitForFunction(() => window.__changes.length >= 1);
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => window.__changes), ['unfolded'], 'one press, six repeats: one transition');
    // Four presses before the first transition ends: each counts, so the window ends where it began.
    const final = await page.evaluate(async () => {
      const ws = window.__marxyHandle.workspace();
      const all = [ws.toggle(), ws.toggle(), ws.toggle(), ws.toggle()];
      await Promise.all(all);
      return ws.mode;
    });
    assert.equal(final, 'unfolded', 'four toggles from unfolded: unfolded again');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-marxy-workspace-region]').length), 6);
  });
});
