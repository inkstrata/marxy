// The kind chip and the per-kind tool strip (K-07): the toolbar's `kind` door shows the focused file's kind, its menu
// says why and offers K-04's choices (which reopen the file), and the `strip` region holds the kind's registered tools.
// The real app on the shipped skeleton and CSS over the memory shell, in WebKit (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from '../../test/support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const prose = '# Title\n\nA paragraph of plain prose, long enough to be a document and no more than that.\n';
const plan = '# Plan\n\n## Summary\n\nx\n\n## Risks\n\ny\n\n## Next steps\n\nz\n';
const files = {
  '/r/README.md': prose,
  '/r/a.md': prose,
  '/r/todo.md': '# Todo\n\n- [ ] one\n- [x] two\n',
  '/r/plan.md': plan,
  '/r/s.py': 'def f():\n    return 1\n',
  '/r/CHANGELOG.md': '# Changelog\n\n## 1.0.0\n\n- first\n',
  '/config': '# mine\nsize = 20\n',
};

async function withPage(fn, { open = ['/r/README.md'], extra = {} } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(page, { files: { ...files, ...extra }, open });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const unfold = (page) => page.evaluate(() => window.__marxyHandle.workspace().unfold());
const fold = (page) => page.evaluate(() => window.__marxyHandle.workspace().fold());
const openFile = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);
const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 60)));

/** What the chip shows: null when it is not in the row. */
const chip = (page) =>
  page.evaluate(() => {
    const item = document.querySelector('[data-marxy-toolbar-item="kind"]');
    if (!item) return null;
    return { text: item.textContent.trim(), glyph: item.querySelector('svg')?.getAttribute('data-marxy-kind') ?? null, label: item.querySelector('button').getAttribute('aria-label') };
  });
const paneKind = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.host.getAttribute('data-marxy-kind'));
const strip = (page) =>
  page.evaluate(() => {
    const region = document.querySelector('[data-marxy-workspace-region="strip"]');
    if (!region) return null;
    return { hidden: region.hidden, tools: [...region.querySelectorAll('button')].map((b) => b.dataset.tool), arrangement: window.__marxyHandle.workspace().arrangement.strip };
  });
const openMenu = async (page) => {
  await page.click('[data-marxy-toolbar-item="kind"] button');
  await page.waitForSelector('.marxy-verb-menu');
};
const pickRow = async (page, key) => {
  await page.click(`.marxy-verb-menu [data-row-key="${key}"]`);
  await settle(page);
};
const read = (page, path) => page.evaluate(async (p) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p)), path);

test('folded, neither a chip nor a strip exists; unfolding makes both, folding takes them out', async () => {
  await withPage(async (page) => {
    assert.equal(await chip(page), null);
    assert.equal(await strip(page), null);
    await unfold(page);
    assert.notEqual(await chip(page), null);
    assert.notEqual(await strip(page), null);
    await fold(page);
    assert.equal(await chip(page), null);
    assert.equal(await strip(page), null);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-strip, .marxy-kind-glyph').length), 0);
  });
});

test('the chip shows README.md as readme, a .py as code, a task-list note as report, and follows the focused document', async () => {
  await withPage(async (page) => {
    await unfold(page);
    assert.deepEqual(await chip(page), { text: 'readme', glyph: 'readme', label: 'Kind: readme. How this file is read' });
    await openFile(page, '/r/s.py');
    await settle(page);
    assert.equal((await chip(page)).text, 'code');
    assert.equal((await chip(page)).glyph, 'code');
    await openFile(page, '/r/todo.md');
    await settle(page);
    assert.equal((await chip(page)).text, 'report');
    await openFile(page, '/r/a.md');
    await settle(page);
    assert.equal((await chip(page)).text, 'article');
    // A kind decided late, or again, changes the attribute and the chip follows it (K-05a.1).
    await page.evaluate(() => window.__marxyHandle.panes().focused.host.setAttribute('data-marxy-kind', 'log'));
    await settle(page);
    assert.equal((await chip(page)).text, 'log');
  });
});

test('with no document the chip is out of the row, and comes back in its place with one', async () => {
  await withPage(async (page) => {
    await unfold(page);
    const order = () => page.evaluate(() => [...document.querySelectorAll('[data-marxy-toolbar-item]')].map((el) => el.getAttribute('data-marxy-toolbar-item')));
    const withDocument = await order();
    assert.ok(withDocument.includes('kind'), withDocument.join());
    await page.evaluate(() => window.__marxyHandle.panes().focused.host.removeAttribute('data-marxy-kind'));
    await settle(page);
    assert.equal(await chip(page), null);
    assert.ok(!(await order()).includes('kind'));
    await openFile(page, '/r/a.md');
    await settle(page);
    assert.deepEqual(await order(), withDocument, 'back where it was');
  });
}, );

test('the menu lists the reasons the file was decided by at open, the decisive one first, then Show as each kind, detected and the folder list', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openMenu(page);
    const menu = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.marxy-verb-menu [role="menuitem"]')];
      const d = window.__marxyHandle.panes().focused.content.detected();
      return {
        label: document.querySelector('.marxy-verb-menu').getAttribute('aria-label'),
        notes: rows.filter((r) => r.getAttribute('aria-disabled') === 'true').map((r) => r.textContent),
        actions: rows.filter((r) => r.getAttribute('aria-disabled') !== 'true').map((r) => r.textContent),
        focused: document.activeElement?.dataset.rowKey,
        reasons: d.reasons.map((r) => ({ signal: r.signal, at: r.at, decisive: r.decisive })),
      };
    });
    assert.equal(menu.label, 'Kind: readme');
    assert.equal(menu.notes.length, menu.reasons.length, 'one note per reason, none computed here');
    const decisive = menu.reasons.find((r) => r.decisive);
    assert.ok(menu.notes[0].includes(decisive.signal) && menu.notes[0].includes(decisive.at), menu.notes[0]);
    for (const [i, r] of menu.reasons.filter((x) => !x.decisive).entries()) assert.ok(menu.notes[i + 1].includes(r.signal));
    assert.equal(menu.actions.filter((t) => t.startsWith('Show as ')).length, 15, 'fourteen kinds and detected');
    assert.ok(menu.actions.includes('Show as detected'));
    assert.ok(menu.actions.includes('Always open this folder as…'));
    assert.equal(menu.focused, 'kind.show-as.article', 'first focus is the first thing that does something, not a note');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.marxy-verb-menu').count(), 0);
  });
});

test('Show as report on an article writes kinds.json, reopens, the pane reads report, and the document is untouched', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openFile(page, '/r/a.md');
    await settle(page);
    assert.equal(await paneKind(page), 'article');
    const before = { doc: await read(page, '/r/a.md'), config: await read(page, '/config') };
    const reads = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile' && c.args[0] === '/r/a.md').length);
    await openMenu(page);
    await pickRow(page, 'kind.show-as.report');
    assert.equal(await paneKind(page), 'report', 'the kind takes effect now');
    assert.equal((await chip(page)).text, 'report');
    const kinds = JSON.parse(await read(page, '/data/kinds.json'));
    assert.equal(kinds.kinds['/r/a.md'], 'report');
    assert.equal(await read(page, '/r/a.md'), before.doc, 'the document\'s bytes are untouched');
    assert.equal(await read(page, '/config'), before.config, 'config.toml is not written by Show as');
    const after = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile' && c.args[0] === '/r/a.md').length);
    assert.ok(after > reads, 'the file was read again');
    const writes = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic').map((c) => c.args[0]));
    assert.ok(!writes.includes('/r/a.md'), writes.join());
    // And back: Show as detected forgets it and reopens.
    await openMenu(page);
    await pickRow(page, 'kind.show-as.detected');
    assert.equal(await paneKind(page), 'article');
  });
});

test('Always open this folder as appends one [[kind]] and no other byte of config.toml changes, and the file reopens as that kind', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openFile(page, '/r/a.md');
    await settle(page);
    const before = await read(page, '/config');
    await openMenu(page);
    await pickRow(page, 'kind.folder');
    assert.equal(await page.locator('.marxy-verb-menu').getAttribute('aria-label'), 'Always open this folder as');
    await pickRow(page, 'kind.folder.report');
    const after = await read(page, '/config');
    assert.ok(after.startsWith(before), 'every byte of the reader\'s file survives as a prefix');
    assert.equal((after.match(/\[\[kind\]\]/g) ?? []).length, 1);
    assert.match(after.slice(before.length), /is = 'report'/);
    assert.equal(await paneKind(page), 'report');
    assert.equal(await read(page, '/r/a.md'), prose);
    assert.equal(await read(page, '/data/kinds.json').catch(() => ''), '', 'no show-as entry was made');
  });
});

test('the strip holds exactly the tools of the kind\'s row whose commands exist, and clicking Changes runs compare.since-reload', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openFile(page, '/r/plan.md');
    await settle(page);
    assert.deepEqual(await strip(page), { hidden: false, tools: ['changes'], arrangement: true });
    // U-09: the kind leads (id in the DOM, capitals from CSS), each tool has a glyph and keeps its accessible name, the band is 40 px.
    const look = await page.evaluate(() => {
      const region = document.querySelector('[data-marxy-workspace-region="strip"]');
      const lead = region.querySelector('.marxy-strip-kind');
      const b = region.querySelector('button[data-tool="changes"]');
      return { text: lead.textContent, transform: getComputedStyle(lead).textTransform, h: region.getBoundingClientRect().height, glyph: !!b.querySelector('svg'), name: b.getAttribute('aria-label'), customise: !!region.querySelector('[data-tool="customise"]') };
    });
    assert.deepEqual(look, { text: 'report', transform: 'uppercase', h: 40, glyph: true, name: look.name, customise: false });
    assert.ok(look.name);
    await openFile(page, '/r/README.md');
    await settle(page);
    assert.deepEqual((await strip(page)).tools, ['outline']);
    await openFile(page, '/r/s.py');
    await settle(page);
    assert.deepEqual((await strip(page)).tools, ['line-numbers']);
    await openFile(page, '/r/CHANGELOG.md');
    await settle(page);
    assert.deepEqual((await strip(page)).tools, ['changes']);

    // Changes is enabled once the file has changed on disk; pressing it shows what changed.
    await openFile(page, '/r/plan.md');
    await settle(page);
    const disabled = await page.locator('[data-marxy-workspace-region="strip"] button[data-tool="changes"]').getAttribute('aria-disabled');
    assert.equal(disabled, 'true', 'nothing has changed on disk yet');
    await page.evaluate(async () => {
      const h = window.__marxyHandle;
      await h.shell.writeFileAtomic('/r/plan.md', new TextEncoder().encode('# Plan\n\n## Summary\n\nchanged\n\n## Risks\n\ny\n'));
      h.shell.emit([{ kind: 'modified', path: '/r/plan.md' }]);
    });
    await page.waitForFunction(() => document.querySelector('[data-marxy-workspace-region="strip"] button[data-tool="changes"]')?.getAttribute('aria-disabled') === null);
    await page.click('[data-marxy-workspace-region="strip"] button[data-tool="changes"]');
    await page.waitForFunction(() => /Changes in plan\.md/.test(document.getElementById('doc').textContent), null, { timeout: 5000 });
  });
});

test('a kind with no registered tool hides its band without changing the remembered panels; folded, nothing is left over', async () => {
  await withPage(async (page) => {
    await unfold(page);
    await openFile(page, '/r/a.md');
    await settle(page);
    assert.deepEqual(await strip(page), { hidden: true, tools: [], arrangement: true });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-marxy-workspace-region="strip"]')).display), 'none');
    // Docking the strip by hand does not show an empty band either.
    await page.evaluate(() => { const w = window.__marxyHandle.workspace(); w.setPanel('strip', false); w.setPanel('strip', true); });
    await settle(page);
    assert.equal((await strip(page)).hidden, true);
    await openFile(page, '/r/plan.md');
    await settle(page);
    assert.equal((await strip(page)).hidden, false);
    await fold(page);
    assert.equal(await strip(page), null);
  });
});

test('[strip] in config.toml chooses a kind\'s tools; an unknown name is skipped and an emptied list hides the band', async () => {
  await withPage(
    async (page) => {
      await unfold(page);
      await openFile(page, '/r/README.md');
      await settle(page);
      assert.deepEqual((await strip(page)).tools, ['changes'], 'the reader chose Changes for a readme');
      await openFile(page, '/r/plan.md');
      await settle(page);
      assert.deepEqual(await strip(page), { hidden: true, tools: [], arrangement: true }, '["nope"] is skipped and leaves none');
    },
    { extra: { '/config': '[strip]\nreadme = ["changes"]\nreport = ["nope"]\n' } },
  );
});
