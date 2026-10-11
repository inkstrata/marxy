// The phase's screen criterion, end to end (D-14; docs/plan/roadmap-2026-10/04-phase-d.md): a README
// beside the plan and the source it documents, walked as a reader walks it. One test, one page, one
// window of 1,470 px: open the plan; `Mod+\` Enter opens the most recent other document beside it;
// Cmd-click a link in the plan lands result.md in the neighbour; each pane scrolls on its own; `Mod+2`
// then `Mod+E` puts the right pane in Source; Cmd-click the README's link to src/lib.rs opens it in Source
// beside; `Mod+F` finds in the focused pane only; `Mod+Shift+\` closes a pane; `view.split-same` shows
// the one file twice; a window under 929 px says why it will not split. (`view.split-same` is offered
// with one pane only, so it runs after the close, and the narrow window comes last; relaunch restore is
// D-12's test, layout-restore.test.mjs.) Booted on the shipped skeleton, palette included, over the
// memory shell with the real app, as open-beside.test.mjs does.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { b64, closeHarness, harnessBase, shippedSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const para = (word, i) =>
  `${word} paragraph ${i} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. A lantern here. ';
const prose = (word, count) => Array.from({ length: count }, (_, i) => para(word, i).trim()).join('\n\n');
const files = {
  '/r/README.md': `# Readme\n\n${prose('Readme', 3)}\n\nThe code is in [the library](./src/lib.rs) and the notes are in [the plan](./plan.md).\n\n${prose('Readme', 24)}\n`,
  '/r/plan.md': `# Plan\n\n${prose('Plan', 3)}\n\nThe outcome is written up in [the result](./result.md).\n\n${prose('Plan', 24)}\n`,
  '/r/result.md': `# Result\n\n${prose('Result', 24)}\n\n## Deep\n\n${prose('Deep', 6)}\n`,
  '/r/src/lib.rs': 'pub fn answer() -> u32 {\n    42\n}\n',
};
const entries = Object.keys(files).map((path) => ({
  path,
  root: '/r',
  title: files[path].match(/^# (.*)$/m)?.[1] ?? path.split('/').pop(),
  headings: [],
  mtimeMs: 1,
  size: files[path].length,
  kind: path.endsWith('.md') ? 'markdown' : 'text',
}));
const FIT = 'Marxy needs a window at least 929 px wide to show two documents side by side.';

async function boot(page, { open }) {
  const base = await harnessBase();
  const { style, body } = shippedSkeleton();
  await page.route(`${base}app.html`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace('</head>', `<style>${style}</style></head>`)
      .replace(/<body[^>]*>/, '<body data-marxy-mode="rendered" data-marxy-variant="dark">')
      .replace('<article id="doc" class="marxy-article"></article>', body);
    await route.fulfill({ response, body: html });
  });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const encoded = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, b64(text)]));
  await page.evaluate(
    async ({ encoded, entries, open }) => {
      const bytes = {};
      for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: [open[0]] });
      await handle.ready;
      window.__marxyHandle = handle;
      handle.palette.setIndexEntries(entries);
      for (const path of open.slice(1)) await handle.open(path);
    },
    { encoded, entries, open },
  );
}

const paths = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));
const modes = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.view.mode));
const focused = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.slot);
const scrollTops = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => Math.round(p.host.scrollTop)));
const settle = (page, ms = 300) => page.waitForTimeout(ms);
const link = (page, slot, href) => page.locator(`article#${slot === 0 ? 'doc' : 'doc-2'} a[href="${href}"]`);
const reveal = async (page, slot, href) => {
  await link(page, slot, href).evaluate((a) => a.scrollIntoView({ block: 'center' }));
  await settle(page, 300);
};
const click = (page, slot, href) => link(page, slot, href).click({ modifiers: ['ControlOrMeta'] });
const cmdClick = async (page, slot, href) => {
  await reveal(page, slot, href);
  await click(page, slot, href);
};
const notices = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.marxy-notice .marxy-notice-text')].map((el) => el.textContent));
const wheel = async (page, slot, dy) => {
  const box = await page.locator(`#marxy-main > section[data-marxy-pane="${slot}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, dy);
};

test('README beside the plan, the result and the source: open beside, follow a link, scroll apart, Source beside, find, close, split the same, narrow', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await boot(page, { open: ['/r/result.md', '/r/README.md', '/r/plan.md'] });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';

    // 1. The plan is open, alone. Mod+\ then Enter opens the most recent other document (the README) beside it.
    assert.deepEqual(await paths(page), ['/r/plan.md']);
    await page.keyboard.press(`${mod}+Backslash`);
    await page.waitForFunction(() => document.getElementById('marxy-palette').open);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1]?.path() === '/r/README.md');
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/README.md']);
    assert.equal(await focused(page), 1, 'focus follows the document into its pane');

    // 2. Cmd-click the plan's link to its result: it replaces the neighbour; the plan stays and keeps focus.
    await page.evaluate(() => { const p = window.__marxyHandle.panes(); p.focus(p.panes[0]); });
    await reveal(page, 0, './result.md');
    const planBefore = await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.position().byteOffset);
    await click(page, 0, './result.md');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/result.md');
    assert.deepEqual(await paths(page), ['/r/plan.md', '/r/result.md']);
    assert.equal(await focused(page), 0, 'the pane clicked in keeps focus');
    assert.ok(Math.abs((await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.position().byteOffset)) - planBefore) < 1, 'the plan stays where it was read');

    // 3. Each pane scrolls on its own: a wheel over one moves it and not the other.
    await settle(page, 600);
    const rest = await scrollTops(page);
    await wheel(page, 1, 900);
    await page.waitForFunction((was) => window.__marxyHandle.panes().panes[1].host.scrollTop > was + 300, rest[1]);
    await settle(page, 400);
    let now = await scrollTops(page);
    assert.equal(now[0], rest[0], 'the plan did not move when the result scrolled');
    await wheel(page, 0, 500);
    await page.waitForFunction((was) => window.__marxyHandle.panes().panes[0].host.scrollTop > was + 200, rest[0]);
    await settle(page, 400);
    const after = await scrollTops(page);
    assert.equal(after[1], now[1], 'the result did not move when the plan scrolled');
    now = after;

    // 4. Mod+2 then Mod+E puts the right pane in Source, and only it.
    await page.keyboard.press(`${mod}+2`);
    assert.equal(await focused(page), 1);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.mode === 'source');
    assert.deepEqual(await modes(page), ['rendered', 'source']);
    assert.deepEqual((await scrollTops(page))[0], now[0], 'the left pane is where it was');

    // 5. Bring the README into the left pane from the palette, then Cmd-click its link to the source file:
    //    the file opens in Source in the neighbour, and the README keeps focus.
    await page.keyboard.press(`${mod}+1`);
    await page.keyboard.press(`${mod}+KeyP`);
    await page.fill('#marxy-palette .marxy-palette-query', 'Readme');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length >= 1);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/README.md');
    assert.deepEqual(await paths(page), ['/r/README.md', '/r/result.md']);
    await cmdClick(page, 0, './src/lib.rs');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].path() === '/r/src/lib.rs');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.mode === 'source');
    assert.deepEqual(await modes(page), ['rendered', 'source']);
    assert.equal(await focused(page), 0);

    // 6. Mod+F finds in the focused (left) pane only.
    await page.keyboard.press(`${mod}+KeyF`);
    await page.waitForSelector('#marxy-main > section[data-marxy-pane="0"] .marxy-find input:focus');
    await page.keyboard.type('lantern');
    await page.waitForFunction(() => /\d+ of \d+/.test(document.querySelector('.marxy-find .marxy-find-count')?.textContent ?? ''));
    const found = await page.evaluate(() => ({
      fields: [...document.querySelectorAll('#marxy-main > section.marxy-pane')].map((s) => s.querySelectorAll('.marxy-find').length),
      count: document.querySelector('.marxy-find .marxy-find-count').textContent,
    }));
    assert.deepEqual(found.fields, [1, 0], 'the field is in the focused pane');
    assert.match(found.count, /^\d+ of 27$/, 'every lantern of the README and none of the source file');
    await page.keyboard.press('Escape');

    // 7. Mod+Shift+\ closes the focused (right, the source) pane; the survivor fills the window as the one document.
    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+Shift+Backslash`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 1);
    assert.deepEqual(await paths(page), ['/r/README.md']);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-main').hasAttribute('data-marxy-split')), false);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-divider').length), 0, 'no divider with one pane');

    // 8. The command to split the same document: the same file twice, one store.
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      await handle.commands().find((c) => c.id === 'view.split-same').run(buildAppContext(handle));
    });
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2);
    const same = await page.evaluate(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      return { same: a.path() === b.path(), store: a.view.store() === b.view.store() };
    });
    assert.deepEqual(same, { same: true, store: true });
    await page.keyboard.press(`${mod}+Shift+Backslash`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 1);

    // 9. Below two columns at the typography floor a window says why it will not split.
    await page.setViewportSize({ width: 900, height: 900 });
    await page.keyboard.press(`${mod}+Backslash`);
    await settle(page, 300);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-palette').open), false);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes.length), 1);
    assert.deepEqual(await notices(page), [FIT]);
  } finally {
    await browser.close();
  }
});
