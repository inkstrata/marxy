// The cursor in WebKit: single keys move it over the parts of a Markdown page (j k l h, J K,
// ] [, g g, G, Escape), the verb bar at the pane's foot names the part and its verbs, and c, C, e, t, Enter and \ act
// on it. The keys are the page's only: inert in a field, in Source, and with `verbs = false`.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PLAN = [
  '# Plan', '', 'The first paragraph of the plan.', '', '- one', '- two', '  - two a', '- three', '',
  '> A quoted line.', '>', '> Another.', '', '## Scope', '', 'What is in scope.', '',
  '- [ ] a task to do', '- [x] done already', '', '```ts', 'const x = 1;', '```', '', '# Last', '', 'The end.', '',
].join('\n');
const FILES = { '/r/plan.md': PLAN };

/** The cursor as the reader sees it: the selection's kind, the text of the part under it, and the bar. */
const cur = (page) =>
  page.evaluate(() => {
    const s = window.__marxyHandle.selection.state().selection;
    const el = document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor');
    const bar = document.querySelector('.marxy-verb-bar');
    const shown = bar && !bar.hidden;
    return {
      kind: s.kind,
      text: el ? el.textContent.trim().split('\n')[0].slice(0, 40) : null,
      painted: document.querySelectorAll('[data-marxy-pane="0"] .marxy-article .marxy-selected').length,
      where: shown ? bar.querySelector('.marxy-verb-bar-where').textContent : null,
      what: shown ? bar.querySelector('.marxy-verb-bar-what').textContent : null,
      verbs: shown ? [...bar.querySelectorAll('[data-marxy-verb]')].map((b) => b.textContent.trim()) : [],
    };
  });

const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
/** The text of the last pasteboard item the app wrote, as the memory shell recorded it; null before any. */
const clipboard = (page) =>
  page.evaluate(() => {
    const last = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    const rep = last?.args[0].find((r) => r.type === 'public.utf8-plain-text');
    return rep ? new TextDecoder().decode(rep.bytes) : null;
  });
const copied = (page, n) => page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === n, n);
const bufferText = (page) => page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));

test('j with no cursor starts on the first part at or below the reading line; j and k step over the top level', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], viewport: { width: 1200, height: 560 } }, async (page) => {
    await blur(page);
    const want = await page.evaluate(() => {
      const line = window.innerHeight * 0.4;
      const tops = [...document.querySelectorAll('[data-marxy-pane="0"] .marxy-article > [data-marxy-s], [data-marxy-pane="0"] .marxy-article > pre > code[data-marxy-s]')];
      const el = tops.find((t) => t.getBoundingClientRect().bottom > line);
      return el.textContent.trim().split('\n')[0].slice(0, 40);
    });
    await keys(page, 'j');
    const first = await cur(page);
    assert.equal(first.text, want, 'the first part whose bottom is below 40 % of the window');
    await keys(page, 'g', 'g');
    assert.deepEqual(await cur(page), {
      kind: 'section', text: 'Plan', painted: 1, where: 'plan.md:1–23', what: '§ Plan',
      verbs: ['c copy', 'C cite', 'x x-ray', 'e edit', 'z fold', 'v only this', '\\ source', 'y collect', 'n note', 'Enter all'],
    });
    await keys(page, 'j');
    assert.equal((await cur(page)).text, 'The first paragraph of the plan.');
    await keys(page, 'k');
    assert.equal((await cur(page)).kind, 'section', 'k goes back to the heading, which stands for its section');
  });
});

test('l goes in and h comes out: a section heading, a list, a nested list, a quote', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    await keys(page, 'g', 'g', 'l');
    let c = await cur(page);
    assert.equal(c.text, 'The first paragraph of the plan.', 'l on a section heading: the first part under it');
    assert.deepEqual([c.where, c.what], ['plan.md:3', 'paragraph']);
    await keys(page, 'j');
    c = await cur(page);
    assert.deepEqual([c.kind, c.what, c.where], ['node', 'list of 3', 'plan.md:5–8']);
    await keys(page, 'l');
    assert.deepEqual([(await cur(page)).text, (await cur(page)).what], ['one', 'item']);
    await keys(page, 'j');
    assert.equal((await cur(page)).text, 'two');
    await keys(page, 'l');
    c = await cur(page);
    assert.deepEqual([c.text, c.what, c.where], ['two a', 'list of 1', 'plan.md:7']);
    await keys(page, 'h');
    assert.equal((await cur(page)).text, 'two', 'h: back to the item that holds the nested list');
    await keys(page, 'j', 'j');
    c = await cur(page);
    assert.equal(c.what, 'quote', 'j at the last item steps out of the list to the part after it');
    await keys(page, 'l');
    c = await cur(page);
    assert.deepEqual([c.text, c.what, c.where], ['A quoted line.', 'paragraph', 'plan.md:10']);
    await keys(page, 'j', 'h');
    assert.equal((await cur(page)).what, 'quote');
    await keys(page, 'h');
    c = await cur(page);
    assert.deepEqual([c.kind, c.text], ['section', 'Plan'], 'h at the top level: the heading whose section holds it');
  });
});

test('Shift+J and Shift+K grow and shrink a run from where it began; Escape lets go', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    await keys(page, 'g', 'g', 'j', 'Shift+J', 'Shift+J');
    let c = await cur(page);
    assert.deepEqual([c.kind, c.painted, c.what, c.where, c.text], ['blocks', 3, '3 parts', 'plan.md:3–12', 'A quoted line.']);
    assert.equal(await page.evaluate(() => window.__marxyHandle.selection.state().selection.range.start), PLAN.indexOf('The first'));
    await keys(page, 'Shift+K');
    c = await cur(page);
    assert.deepEqual([c.kind, c.painted, c.where], ['blocks', 2, 'plan.md:3–8']);
    await keys(page, 'Shift+K');
    c = await cur(page);
    assert.deepEqual([c.kind, c.text], ['node', 'The first paragraph of the plan.'], 'back to the part it began on');
    await keys(page, 'Shift+K');
    c = await cur(page);
    assert.deepEqual([c.kind, c.painted, c.text, c.where], ['blocks', 2, 'Plan', 'plan.md:1–3'], 'past it, upward');
    await keys(page, 'Escape');
    c = await cur(page);
    assert.deepEqual([c.kind, c.painted, c.where], ['none', 0, null], 'Escape lets go, and the bar goes with it');
  });
});

test('] and [ walk the headings; g g and G go to the first and last part', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    await keys(page, 'g', 'g');
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await keys(page, ']');
      const c = await cur(page);
      seen.push(`${c.kind}:${c.text}:${c.where}`);
    }
    assert.deepEqual(seen, ['section:Scope:plan.md:14–23', 'section:Last:plan.md:25–27', 'section:Last:plan.md:25–27']);
    await keys(page, '[');
    assert.equal((await cur(page)).text, 'Scope');
    await keys(page, 'Shift+G');
    let c = await cur(page);
    assert.deepEqual([c.text, c.where], ['The end.', 'plan.md:27']);
    await keys(page, 'g', 'g');
    c = await cur(page);
    assert.deepEqual([c.kind, c.text], ['section', 'Plan']);
    // A lone g is a prefix that lapses: g, a pause, then j is just j.
    await keys(page, 'g');
    await page.waitForTimeout(1000);
    await keys(page, 'j');
    assert.equal((await cur(page)).text, 'The first paragraph of the plan.');
  });
});

test('the verb bar: the address and the word for each kind; it covers no line and moves nothing', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], viewport: { width: 1200, height: 520 } }, async (page) => {
    await blur(page);
    const before = await page.evaluate(() => document.querySelector('[data-marxy-pane="0"] .marxy-article').getBoundingClientRect().toJSON());
    await keys(page, ']', 'l');
    let c = await cur(page);
    assert.deepEqual([c.what, c.where], ['paragraph', 'plan.md:16']);
    await keys(page, 'j');
    c = await cur(page);
    assert.deepEqual([c.what, c.where], ['list of 2', 'plan.md:18–19']);
    await keys(page, 'l');
    c = await cur(page);
    assert.deepEqual([c.what, c.where], ['task', 'plan.md:18']);
    assert.deepEqual(c.verbs, ['c copy', 'C cite', 'x x-ray', 'e edit', 't tick', '\\ source', 'y collect', 'n note', 'Enter all'], 'tick only where there is a task');
    await keys(page, 'h', 'j');
    c = await cur(page);
    assert.deepEqual([c.what, c.where], ['code (ts)', 'plan.md:21–23']);
    const after = await page.evaluate(() => document.querySelector('[data-marxy-pane="0"] .marxy-article').getBoundingClientRect().toJSON());
    assert.equal(after.height, before.height, 'the bar adds nothing to the page');
    assert.equal(after.left, before.left);
    // Scrolled to the end, the last line stays above the bar.
    await keys(page, 'Shift+G');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const room = await page.evaluate(() => {
      const bar = document.querySelector('.marxy-verb-bar').getBoundingClientRect();
      const last = [...document.querySelectorAll('[data-marxy-pane="0"] .marxy-article > p')].at(-1).getBoundingClientRect();
      return { lastBottom: last.bottom, barTop: bar.top, barBottom: bar.bottom, inner: window.innerHeight };
    });
    assert.ok(room.lastBottom <= room.barTop, `the last line (bottom ${room.lastBottom}) is above the bar (top ${room.barTop})`);
    assert.ok(room.barBottom <= room.inner, 'the bar is inside the window');
  });
});

test('the cursor scrolls its part into view only as far as it must', async () => {
  const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of a long page.`).join('\n\n');
  await withFrame({ files: { '/r/long.md': `${long}\n` }, open: ['/r/long.md'], viewport: { width: 1200, height: 600 } }, async (page) => {
    await blur(page);
    await keys(page, 'j');
    const top0 = await page.evaluate(() => document.scrollingElement.scrollTop);
    await keys(page, 'k');
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), top0, 'a part already in view: no scroll');
    for (let i = 0; i < 12; i++) await keys(page, 'j');
    const seen = await page.evaluate(() => {
      const r = document.querySelector('.marxy-article .marxy-cursor').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, inner: window.innerHeight, scrolled: document.scrollingElement.scrollTop };
    });
    assert.ok(seen.scrolled > top0, 'the page moved to follow the cursor');
    assert.ok(seen.bottom <= seen.inner - 40 && seen.bottom > seen.inner - 120, `the part sits just above the foot (${seen.bottom} of ${seen.inner})`);
    await keys(page, 'Shift+G');
    assert.equal((await cur(page)).text, 'Paragraph 60 of a long page.');
  });
});

test('c copies the part exactly as written, C copies it as a quote with path:lines', async () => {
  const text = '# Notes\r\n\r\nFirst line \u{1F642} with *stars*\r\nand a second line.\r\n\r\n- a\r\n- b\r\n';
  await withFrame({ files: { '/r/notes.md': text }, open: ['/r/notes.md'] }, async (page) => {
    await blur(page);
    await keys(page, 'g', 'g', 'j', 'c');
    await copied(page, 1);
    assert.equal(await clipboard(page), 'First line \u{1F642} with *stars*\r\nand a second line.', 'the bytes of the paragraph, CRLF kept');
    await keys(page, 'Shift+C');
    await copied(page, 2);
    assert.equal(await clipboard(page), '> First line \u{1F642} with *stars*\n> and a second line.\n\n— `/r/notes.md:3-4`\n');
    await keys(page, 'k', 'c');
    await copied(page, 3);
    assert.equal(await clipboard(page), text, 'a section copies the whole of it, as written');
    // The bar's buttons run the same commands, and leave focus on the page.
    await keys(page, 'Shift+G');
    await page.click('.marxy-verb-bar [data-marxy-verb="cursor.copy"]');
    await copied(page, 4);
    assert.equal(await clipboard(page), '- a\r\n- b');
    await keys(page, 'k');
    assert.equal((await cur(page)).text, 'First line \u{1F642} with stars', 'k after a click on the bar still moves the cursor');
  });
});

test('e opens the block editor on the part; t ticks a task; Enter opens the verb menu; \\ flips to Source at the part', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    await keys(page, ']', 'l', 'j', 'l', 't');
    await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('- [x] a task'));
    assert.equal(await bufferText(page), PLAN.replace('- [ ] a task', '- [x] a task'), 'only the box changed');

    await blur(page);
    await keys(page, 'g', 'g', 'j', 'e');
    await page.waitForSelector('.marxy-block-editor .cm-content');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-block-editor .cm-content').textContent), 'The first paragraph of the plan.');
    await keys(page, 'Escape');
    await page.waitForSelector('.marxy-block-editor', { state: 'detached' });

    await blur(page);
    await keys(page, 'g', 'g', 'j', 'Enter');
    await page.waitForSelector('.marxy-verb-menu');
    await keys(page, 'Escape');
    await page.waitForSelector('.marxy-verb-menu', { state: 'detached' });

    await blur(page);
    await keys(page, 'g', 'g', 'j', 'j');
    await keys(page, '\\');
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
    const listAt = (await bufferText(page)).indexOf('- one');
    await page.waitForFunction((at) => window.__marxyHandle.sourceHarness().byteOffset === at, listAt);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-verb-bar').hidden), true, 'no bar over Source');
    // In Source every key is the editor's: \ types a backslash and leaves the mode alone.
    await keys(page, '\\');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__marxyHandle.sourceHarness().mode), 'source');
  });
});

test('the cursor stays on its part through a reload from disk, an edit above it, its undo and a whole-file transform', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    await keys(page, ']', 'l');
    assert.equal((await cur(page)).text, 'What is in scope.');
    const settled = () => page.waitForFunction(() => window.__marxyHandle.selection.runtime()?.version === window.__marxyHandle.document()?.snapshot().version);
    const apply = (start, end, replacement) =>
      page.evaluate(async ({ start, end, replacement }) => {
        const store = window.__marxyHandle.document();
        const len = store.snapshot().buffer.bytes.length;
        await store.apply({ range: { file: store.snapshot().path, start, end: end ?? len }, replacement, label: 'test' });
      }, { start, end, replacement });
    await page.evaluate(async (next) => {
      await window.__marxyHandle.shell.writeFileAtomic('/r/plan.md', new TextEncoder().encode(next));
      window.__marxyHandle.shell.emit([{ kind: 'modified', path: '/r/plan.md' }]);
    },`Another line on disk.\n\n${PLAN}`);
    await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).startsWith('Another line'));
    await settled();
    assert.equal((await cur(page)).text, 'What is in scope.', 'after a reload with a line added above');
    await apply(0, 0, 'A line added above.\n\n');
    await settled();
    assert.equal((await cur(page)).text, 'What is in scope.', 'after a line added above');
    await page.evaluate(() => window.__marxyHandle.document().undo());
    await settled();
    assert.equal((await cur(page)).text, 'What is in scope.', 'after its undo');
    const now = await bufferText(page);
    await apply(0, null, now.replace('The end.', 'The very end.'));
    await settled();
    assert.equal((await cur(page)).text, 'What is in scope.', 'after a whole-file splice');
  });
});

test('g t with one tab is a sequence that cannot run: the t is swallowed, the task under the cursor is not ticked', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    await keys(page, ']', 'l', 'j', 'l');
    assert.equal((await cur(page)).what, 'task');
    await keys(page, 'g', 't', 'g', 'Shift+T');
    await page.waitForTimeout(200);
    assert.equal(await bufferText(page), PLAN, 'nothing ticked');
    await keys(page, 't');
    await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('- [x] a task'));
  });
});

test('the single keys are inert in a field, in Source and with verbs = false; the chords still work', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page, { mod }) => {
    await blur(page);
    await page.keyboard.press(`${mod}+KeyF`);
    const field = page.locator('.marxy-find input').first();
    await field.waitFor();
    await keys(page, 'j', 'g', 'g', 'c');
    assert.equal(await field.inputValue(), 'jggc', 'the field took the letters');
    assert.equal((await cur(page)).kind, 'none', 'and the page did not move');
    await keys(page, 'Escape');

    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.sourceHarness()?.mode === 'source');
    await page.click('.cm-content');
    await keys(page, 'End', 'k');
    assert.equal((await cur(page)).kind, 'none');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-verb-bar').hidden), true);
  });

  await withFrame({ files: FILES, open: ['/r/plan.md'], config: 'verbs = false\n' }, async (page) => {
    await blur(page);
    await keys(page, 'j', 'g', 'g', 'Shift+G');
    assert.equal((await cur(page)).kind, 'none', 'verbs off: no key moves anything');
    await page.locator('[data-marxy-pane="0"] .marxy-article > p').first().click();
    let c = await cur(page);
    assert.deepEqual([c.kind, c.where], ['node', null], 'a click still selects; no bar is drawn');
    await keys(page, 'j', 'c');
    await page.waitForTimeout(150);
    assert.equal((await cur(page)).text, 'The first paragraph of the plan.');
    assert.equal(await clipboard(page), null, 'c copied nothing');
    await keys(page, 'Alt+ArrowDown');
    c = await cur(page);
    assert.equal(c.text, 'one', 'Alt+ArrowDown, a chord, still moves the selection');
  });
});

test('Settings has one row for verbs; switching it off takes the bar and the keys at once', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page, { mod }) => {
    await blur(page);
    await keys(page, 'g', 'g');
    assert.notEqual((await cur(page)).where, null);
    await page.keyboard.press(`${mod}+,`);
    await page.waitForSelector('[data-marxy-setting="verbs"]');
    assert.equal(await page.isChecked('[data-marxy-control="verbs"]'), true);
    await page.click('[data-marxy-control="verbs"]');
    await page.waitForFunction(async () => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/config')).includes('verbs = false'));
    await page.waitForFunction(() => document.querySelector('.marxy-verb-bar').hidden);
    await blur(page);
    await keys(page, 'j', 'Shift+G');
    const c = await cur(page);
    assert.deepEqual([c.kind, c.text], ['section', 'Plan'], 'the keys stopped with it');
  });
});
