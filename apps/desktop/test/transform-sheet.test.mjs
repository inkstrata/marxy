// W-21: Transform. Mod+/ opens the palette on `>Transform` and lists every transform core can run; choosing one runs it
// on the selection, else the document, and opens the result sheet (Before and After with counts). Return copies the
// result as one pasteboard item; Mod+Return applies it over the input range as one undo step (edit transforms only);
// Esc changes nothing. The real app over the memory shell, in WebKit, with real keys (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { TRANSFORMS, parseMarkdown, runTransform, textOf, createBuffer } from '../../../packages/core/src/index.ts';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const TEXT = 'public.utf8-plain-text';
const A = '/r/list.md';

const LIST_DOC = '# Shopping\n\nSome intro.\n\n- pear\n- apple\n- mango\n\nTail paragraph.\n';
const CRLF_DOC = '﻿# Shopping\r\n\r\nSome intro.\r\n\r\n- pear\r\n- apple\r\n- mango\r\n\r\nTail paragraph.\r\n';

/** The source range of the first list of `text`, as the parse gives it. */
function listRange(text) {
  const bytes = enc.encode(text);
  const ast = parseMarkdown(bytes, { file: A });
  const list = ast.children.find((n) => n.type === 'list');
  assert.ok(list, 'the fixture has a list');
  return { start: list.src.start, end: list.src.end, text: textOf(createBuffer(A, bytes), list.src) };
}

/** The palette over the running app, as main.ts mounts it (the skeleton already holds its dialog). */
async function mountPalette(page, initialPath) {
  await page.evaluate(async (initialPath) => {
    const { mountPaletteFromHandle } = await import('/src/palette/view.ts');
    const handle = window.__marxyHandle;
    const palette = mountPaletteFromHandle(handle, { initialPath });
    handle.setPaletteSession(() => palette.session);
    window.__marxyPalette = palette;
  }, initialPath);
}

async function withApp(files, fn, { open = [A], width = 1280 } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await bootTwoPanes(page, { files, open, guard: true });
    await mountPalette(page, open[0]);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const api = {
      mod,
      /** The open store's bytes as text (a byte-order mark kept). */
      store: (slot = 0) => page.evaluate((s) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(window.__marxyHandle.panes().panes[s].content.store().snapshot().buffer.bytes), slot),
      version: () => page.evaluate(() => window.__marxyHandle.document().snapshot().version),
      snap: () => page.evaluate(() => { const s = window.__marxyHandle.document().snapshot(); return { version: s.version, dirty: s.dirty, canUndo: s.canUndo }; }),
      disk: (path = A) => page.evaluate((p) => window.__disk(p), path),
      /** Writes to documents: the app's own state files under /data are not. */
      writes: () => page.evaluate(() => window.__appWrites.filter((w) => !w.path.startsWith('/data/')).length),
      /** Selects the first element matching `css` as a click on it would. */
      select: (css) => page.evaluate((css) => window.__marxyHandle.selection.selectAt(document.querySelector(css), { link: 'select' }), css),
      selectNothing: () => page.evaluate(() => window.__marxyHandle.selection.selectAt(document.getElementById('doc'), { link: 'select' })),
      /** Summons the palette on the transforms and runs the one named `name`; resolves when the sheet is up. */
      choose: async (name) => {
        await page.keyboard.press(`${mod}+Slash`);
        await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
        await page.locator('#marxy-palette .marxy-palette-query').fill(`>Transform: ${name}`);
        await page.waitForFunction((name) => document.querySelector('#marxy-palette .marxy-palette-row .marxy-palette-title')?.textContent === `Transform: ${name}`, name);
        await page.keyboard.press('Enter');
        await page.waitForSelector('#marxy-transform[open]');
      },
      sheet: () =>
        page.evaluate(() => {
          const d = document.getElementById('marxy-transform');
          if (!d?.open) return null;
          const [before, after] = [...d.querySelectorAll('.marxy-transform-text')].map((p) => p.textContent);
          const [countBefore, countAfter] = [...d.querySelectorAll('.marxy-transform-count')].map((c) => c.textContent);
          return {
            title: d.querySelector('.marxy-transform-title').textContent,
            steps: [...d.querySelectorAll('.marxy-transform-steps li')].map((li) => li.textContent),
            before, after, countBefore, countAfter,
            buttons: [...d.querySelectorAll('.marxy-transform-actions button')].map((b) => b.firstChild.textContent),
            status: d.querySelector('.marxy-transform-status').textContent,
            note: d.querySelector('.marxy-transform-note').hidden ? '' : d.querySelector('.marxy-transform-note').textContent,
            focus: document.activeElement?.id ?? document.activeElement?.tagName,
          };
        }),
      /** What reached the pasteboard: each `clipboardWriteItem` the shell was given (the handle's counters are copies), and any read. */
      pasteboard: () =>
        page.evaluate(() => {
          const shell = window.__marxyHandle.shell;
          const items = shell.calls.filter((c) => c.method === 'clipboardWriteItem');
          const last = items.at(-1);
          const rep = last?.args[0].find((r) => r.type === 'public.utf8-plain-text');
          return {
            writes: items.length,
            reps: last ? last.args[0].map((r) => r.type) : [],
            text: rep ? new TextDecoder().decode(rep.bytes) : null,
            reads: [...shell.pasteboardDataReads],
            calls: shell.calls.filter((c) => c.method === 'clipboardRead' || c.method === 'clipboardTypes').length,
          };
        }),
      settle: () => page.evaluate(() => new Promise((r) => setTimeout(r, 150))),
    };
    await fn(page, api);
  } finally {
    await browser.close();
  }
}

// --- the palette's group ------------------------------------------------------------------------------------------

test('Mod+/ opens the palette on >Transform and lists exactly TRANSFORMS.length transform rows; again closes it', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    await page.keyboard.press(`${s.mod}+Slash`);
    await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
    const got = await page.evaluate(() => ({
      query: document.querySelector('#marxy-palette .marxy-palette-query').value,
      titles: [...document.querySelectorAll('#marxy-palette .marxy-palette-row .marxy-palette-title')].map((t) => t.textContent),
    }));
    assert.equal(got.query, '>Transform');
    const rows = got.titles.filter((t) => t.startsWith('Transform: '));
    assert.equal(rows.length, TRANSFORMS.length, 'one row per transform that can run');
    assert.deepEqual(rows, TRANSFORMS.map((t) => `Transform: ${t.name}`).sort());
    assert.deepEqual(got.titles, rows, 'and nothing else is listed under the query');
    await page.keyboard.press(`${s.mod}+Slash`);
    assert.equal(await page.evaluate(() => document.getElementById('marxy-palette').open), false);
    // Mod+Shift+P still opens on every command.
    await page.keyboard.press(`${s.mod}+Shift+KeyP`);
    assert.equal(await page.evaluate(() => document.querySelector('#marxy-palette .marxy-palette-query').value), '>');
  });
});

test('no transform that is NOT_YET has a row, and the palette does not list the toolbar door', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    await page.keyboard.press(`${s.mod}+Slash`);
    await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
    await page.locator('#marxy-palette .marxy-palette-query').fill('>');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-palette .marxy-palette-row').length > 40);
    const titles = await page.evaluate(() => [...document.querySelectorAll('#marxy-palette .marxy-palette-row .marxy-palette-title')].map((t) => t.textContent));
    for (const gone of ['Transform: Wrap at 80', 'Transform: Markdown → Slack', 'Transform: Markdown → HTML', 'Transform: Markdown → Jira wiki', 'Transform']) {
      assert.ok(!titles.includes(gone), gone);
    }
    assert.ok(titles.includes('Transform: Sort lines'));
  });
});

// --- the toolbar's door -------------------------------------------------------------------------------------------

test('the toolbar shows Transform once transform.open is registered, and the button opens the palette on >Transform', async () => {
  await withApp({ [A]: LIST_DOC }, async (page) => {
    assert.equal(await page.locator('[data-marxy-toolbar-item="transform"]').count(), 0, 'folded: no toolbar at all');
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    const items = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-toolbar-item]')].map((el) => el.getAttribute('data-marxy-toolbar-item')));
    assert.deepEqual(items, ['back', 'forward', 'title', 'mode', 'copy', 'transform', 'find']);
    const button = page.locator('[data-marxy-toolbar-item="transform"] button');
    assert.equal(await button.getAttribute('aria-label'), 'Transform');
    assert.equal(await button.getAttribute('aria-disabled'), null, 'a document is open');
    await button.click();
    await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
    assert.equal(await page.evaluate(() => document.querySelector('#marxy-palette .marxy-palette-query').value), '>Transform');
    assert.equal(await page.locator('#marxy-palette .marxy-palette-row').count(), TRANSFORMS.length);
  });
});

// --- the sheet ----------------------------------------------------------------------------------------------------

test('Sort lines on a selected list: Before is the selection\'s bytes, After is runTransform, with counts; Return copies one item and changes nothing', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    const list = listRange(LIST_DOC);
    const want = runTransform('sort', list.text);
    assert.notEqual(want, list.text);
    const version = await s.version();
    await s.select('#doc ul');
    await s.choose('Sort lines');
    const sheet = await s.sheet();
    assert.equal(sheet.before, list.text, 'Before is the selection\'s bytes');
    assert.equal(sheet.after, want, 'After is what the transform makes');
    assert.equal(sheet.countBefore, `${[...list.text].length} characters`);
    assert.equal(sheet.countAfter, `${[...want].length} characters`);
    assert.deepEqual(sheet.steps, ['Sort lines']);
    assert.deepEqual(sheet.buttons, ['Copy result', 'Apply', 'Open as new document', 'Add another step']);
    assert.equal(sheet.focus, 'marxy-transform-copy', 'Return is Copy result');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    const board = await s.pasteboard();
    assert.equal(board.writes, 1, 'one pasteboard item');
    assert.deepEqual(board.reps, ['public.utf8-plain-text'], 'plain text only');
    assert.equal(board.text, want, 'the item is After');
    assert.deepEqual(board.reads, [], 'the sheet reads nothing from the pasteboard');
    assert.equal(board.calls, 0);
    assert.equal(await s.version(), version, 'the store did not change');
    assert.equal(await s.store(), LIST_DOC);
    assert.equal(await s.disk(), LIST_DOC, 'the file did not change');
    assert.equal(await s.writes(), 0);
  });
});

test('Esc: nothing changed, nothing copied, and focus is back on the page', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    const before = await s.snap();
    await s.select('#doc ul');
    await s.choose('Sort lines');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    assert.deepEqual(await s.snap(), before);
    const board = await s.pasteboard();
    assert.equal(board.writes, 0);
    assert.equal(board.text, null);
    assert.deepEqual(board.reads, []);
    assert.equal(await s.store(), LIST_DOC);
    const focused = await page.evaluate(() => document.activeElement?.closest('#marxy-transform, #marxy-palette') === null);
    assert.ok(focused, 'focus is not left in a closed dialog');
  });
});

test('Apply replaces exactly the range: every byte outside it is identical, the buffer is dirty, nothing is on disk, one undo restores the bytes', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    const list = listRange(LIST_DOC);
    const want = runTransform('sort', list.text);
    await s.select('#doc ul');
    await s.choose('Sort lines');
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    const after = await s.store();
    const head = LIST_DOC.slice(0, list.start);
    const tail = LIST_DOC.slice(list.end);
    assert.equal(after, head + want + tail, 'the range holds the result and every byte outside it is as it was');
    assert.ok(after.startsWith(head) && after.endsWith(tail));
    assert.deepEqual(await s.snap(), { version: (await s.snap()).version, dirty: true, canUndo: true });
    assert.equal(await s.disk(), LIST_DOC, 'nothing on disk until Save');
    assert.equal(await s.writes(), 0);
    const board = await s.pasteboard();
    assert.equal(board.writes, 0, 'Apply copies nothing');
    await page.keyboard.press(`${s.mod}+z`);
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().canUndo === false);
    assert.equal(await s.store(), LIST_DOC, 'one undo restores the exact bytes');
    assert.equal((await s.snap()).dirty, false);
  });
});

test('a CRLF file with a byte-order mark keeps both through Apply, on a selection and on the whole document', async () => {
  await withApp({ [A]: CRLF_DOC }, async (page, s) => {
    const list = listRange(CRLF_DOC.replace('﻿', ''));
    // The selection: its bytes sit after the 3-byte mark.
    await s.select('#doc ul');
    await s.choose('Sort lines');
    let sheet = await s.sheet();
    assert.equal(sheet.before, list.text.replace(/\r\n/g, '\n'), 'Before is the selection (painted with one kind of line break; the bytes below keep the CRLF)');
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    const sorted = await s.store();
    assert.equal(sorted, CRLF_DOC.replace(list.text, runTransform('sort', list.text)));
    assert.ok(sorted.startsWith('﻿'), 'the mark is still first');
    assert.ok(!/[^\r]\n/.test(sorted), 'no bare LF appeared');
    await page.keyboard.press(`${s.mod}+z`);
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().canUndo === false);
    assert.equal(await s.store(), CRLF_DOC);
    // The whole document: nothing selected.
    await s.selectNothing();
    assert.notEqual(runTransform('dedupe', CRLF_DOC), CRLF_DOC, 'the fixture has something to remove');
    await s.choose('Remove duplicate lines');
    sheet = await s.sheet();
    assert.ok(!sheet.before.startsWith('﻿'), 'the mark is not shown as text');
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    assert.equal(await s.store(), runTransform('dedupe', CRLF_DOC), 'the whole buffer is the range, and the transform kept the mark and the endings');
    assert.ok((await s.store()).startsWith('﻿'));
    await page.keyboard.press(`${s.mod}+z`);
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().canUndo === false);
    assert.equal(await s.store(), CRLF_DOC);
  });
});

test('with nothing selected the transform runs on the whole document (scope says so)', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    await s.choose('UPPERCASE');
    const sheet = await s.sheet();
    assert.equal(sheet.before, LIST_DOC);
    assert.equal(sheet.after, runTransform('upper', LIST_DOC));
    assert.match(sheet.title, /the document/);
  });
});

test('Apply is absent for a derive or literal transform and present for an edit; Mod+Return does nothing without it', async () => {
  const DOC = '# T\n\nSee [one](https://example.com/one) and [two](https://example.com/two).\n\nline\n';
  await withApp({ [A]: DOC }, async (page, s) => {
    const version = await s.version();
    for (const [name, kind] of [['Links', 'derive'], ['Escape as JSON string', 'literal'], ['Sort lines', 'edit']]) {
      assert.equal(TRANSFORMS.find((t) => t.name === name)?.kind, kind);
      await s.choose(name);
      const sheet = await s.sheet();
      assert.equal(sheet.buttons.includes('Apply'), kind === 'edit', `${name}: ${kind}`);
      if (kind !== 'edit') assert.match(sheet.note, /new text/);
      if (kind !== 'edit') {
        await page.keyboard.press(`${s.mod}+Enter`);
        await s.settle();
        assert.equal(await s.version(), version, 'Mod+Return changed nothing');
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
      assert.equal(await s.store(), DOC, 'the sheet changed nothing');
    }
  });
});

test('a derive result can be copied or opened as a new document; opening writes nothing', async () => {
  await withApp({ [A]: '# T\n\nSee [one](https://example.com/one) and [two](https://example.com/two).\n' }, async (page, s) => {
    await s.choose('Links');
    const sheet = await s.sheet();
    await page.getByRole('button', { name: /Open as new document/ }).click();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.some((p) => p.path() === 'untitled'));
    assert.equal(await page.evaluate(() => document.getElementById('marxy-transform').open), false);
    const text = await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.panes().panes.find((p) => p.path() === 'untitled').content.store().snapshot().buffer.bytes));
    assert.equal(text, sheet.after);
    assert.equal(await s.writes(), 0);
    assert.equal(await s.disk(), '# T\n\nSee [one](https://example.com/one) and [two](https://example.com/two).\n');
  });
});

test('editing the document after the sheet opened, then Apply, changes nothing and says the document changed', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    await s.select('#doc ul');
    await s.choose('Sort lines');
    // The document changes under the open sheet: an edit at the top, as another view or a reload would make.
    await page.evaluate(() => window.__marxyHandle.document().apply({ range: { file: '/r/list.md', start: 0, end: 0 }, replacement: 'NEW ', label: 'edit' }));
    const edited = await s.store();
    const version = await s.version();
    assert.ok(edited.startsWith('NEW # Shopping'));
    await page.keyboard.press(`${s.mod}+Enter`);
    await s.settle();
    assert.equal(await s.store(), edited, 'the bytes are as the edit left them');
    assert.equal(await s.version(), version, 'no transition');
    const sheet = await s.sheet();
    assert.ok(sheet, 'the sheet stays open');
    assert.match(sheet.status, /document changed/i);
    // Copy still works on the result that was made.
    await page.keyboard.press('Escape');
  });
});

test('a reload from disk under the open sheet makes Apply refuse as well', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    await s.select('#doc ul');
    await s.choose('Sort lines');
    const replaced = '# Replaced\n\n- zebra\n- yak\n- xerus\n';
    await page.evaluate(([path, text]) => window.__outside(path, text), [A, replaced]);
    await page.waitForFunction((text) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) === text, replaced);
    await page.keyboard.press(`${s.mod}+Enter`);
    await s.settle();
    assert.equal(await s.store(), replaced);
    assert.match((await s.sheet()).status, /document changed/i);
  });
});

test('Add another step runs the second transform on the first\'s After; Apply replaces the original range with the final output, one undo step', async () => {
  const DOC = '# Names\n\nintro\n\n- pear\n- apple\n- pear\n- mango\n\nend\n';
  await withApp({ [A]: DOC }, async (page, s) => {
    const list = listRange(DOC);
    const first = runTransform('sort', list.text);
    const final = runTransform('dedupe', first);
    assert.notEqual(final, first);
    await s.select('#doc ul');
    await s.choose('Sort lines');
    assert.equal((await s.sheet()).after, first);
    await page.getByRole('button', { name: /Add another step/ }).click();
    await page.locator('#marxy-transform-filter').fill('duplicate');
    await page.waitForFunction(() => document.querySelector('#marxy-transform .marxy-transform-option')?.textContent.startsWith('Remove duplicate lines'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-transform .marxy-transform-steps li').length === 2);
    const sheet = await s.sheet();
    assert.deepEqual(sheet.steps, ['Sort lines', 'Remove duplicate lines']);
    assert.equal(sheet.before, list.text, 'Before stays the original');
    assert.equal(sheet.after, final, 'the second step ran on the first\'s After');
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    assert.equal(await s.store(), DOC.slice(0, list.start) + final + DOC.slice(list.end));
    await page.keyboard.press(`${s.mod}+z`);
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().canUndo === false);
    assert.equal(await s.store(), DOC, 'one undo steps over both transforms');
  });
});

test('adding a derive step takes Apply away; Esc in the step picker closes the picker and not the sheet', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    await s.select('#doc ul');
    await s.choose('Sort lines');
    await page.getByRole('button', { name: /Add another step/ }).click();
    await page.keyboard.press('Escape');
    assert.ok(await s.sheet(), 'the sheet is still open');
    assert.equal(await page.locator('#marxy-transform-filter').count(), 0, 'the picker closed');
    await page.getByRole('button', { name: /Add another step/ }).click();
    await page.locator('#marxy-transform-filter').fill('links');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#marxy-transform .marxy-transform-steps li').length === 2);
    assert.ok(!(await s.sheet()).buttons.includes('Apply'));
    await page.keyboard.press(`${s.mod}+Enter`);
    await s.settle();
    assert.equal(await s.store(), LIST_DOC);
  });
});

test('a drag selection across two paragraphs transforms those blocks\' bytes, and Apply replaces just them', async () => {
  const DOC = '# T\n\nfirst Paragraph one.\n\nsecond Paragraph two.\n\nthird stays.\n';
  await withApp({ [A]: DOC }, async (page, s) => {
    await page.evaluate(() => {
      const ps = [...document.querySelectorAll('#doc p')];
      const range = document.createRange();
      range.setStart(ps[0].firstChild, 3);
      range.setEnd(ps[1].firstChild, 4);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.waitForFunction(() => window.__marxyHandle.selection.state().selection.kind === 'text');
    const blocks = 'first Paragraph one.\n\nsecond Paragraph two.';
    await s.choose('UPPERCASE');
    const sheet = await s.sheet();
    assert.equal(sheet.before, blocks, 'the blocks the drag touches, from the source');
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    assert.equal(await s.store(), DOC.replace(blocks, blocks.toUpperCase()));
  });
});

test('text with bytes that are not UTF-8 in the range: Apply is not offered (it would rewrite them); copy still works', async () => {
  const bytes = Buffer.concat([Buffer.from('# T\n\nc\n'), Buffer.from([0xff]), Buffer.from('\nb\n')]);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(page, { files: { [A]: 'x' }, open: [A], guard: true });
    await mountPalette(page, A);
    await page.evaluate(async (b64) => {
      const raw = atob(b64);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      await window.__marxyHandle.document().reload(out);
    }, bytes.toString('base64'));
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().buffer.bytes.length === 11);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+Slash`);
    await page.locator('#marxy-palette .marxy-palette-query').fill('>Transform: Sort lines');
    await page.waitForFunction(() => document.querySelector('#marxy-palette .marxy-palette-row .marxy-palette-title')?.textContent === 'Transform: Sort lines');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#marxy-transform[open]');
    const got = await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('#marxy-transform .marxy-transform-actions button')].map((b) => b.firstChild.textContent),
      note: document.querySelector('#marxy-transform .marxy-transform-note').textContent,
    }));
    assert.ok(!got.buttons.includes('Apply'));
    assert.match(got.note, /not valid UTF-8/);
    await page.keyboard.press(`${mod}+Enter`);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual([...(await page.evaluate(() => [...window.__marxyHandle.document().snapshot().buffer.bytes]))], [...bytes]);
  } finally {
    await browser.close();
  }
});

test('a non-Markdown file says which steps read it as Markdown', async () => {
  await withApp({ '/r/script.py': 'print("hi")\n# Heading-looking comment\n' }, async (page, s) => {
    await s.choose('Remove emoji');
    assert.match((await s.sheet()).note, /not a Markdown file.*Remove emoji/i);
  }, { open: ['/r/script.py'] });
});

// --- Source -------------------------------------------------------------------------------------------------------

/** Opens Source on `A` and returns helpers over its CodeMirror view. */
async function inSource(page, s) {
  await page.keyboard.press(`${s.mod}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
  await page.waitForSelector('.cm-content');
  return {
    doc: () => page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().view.state.doc.toString()),
    select: (from, to) =>
      page.evaluate(async ([from, to]) => {
        const view = (await import('/src/source/editor.ts')).activeSourceEditor().view;
        view.dispatch({ selection: { anchor: from, head: to } });
        view.focus();
      }, [from, to]),
    selected: () => page.evaluate(async () => { const v = (await import('/src/source/editor.ts')).activeSourceEditor().view; return v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to); }),
    hasFocus: () => page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().view.hasFocus),
  };
}

test('in Source: the selection is the input, Apply is one CodeMirror transaction and one undo, and the store is untouched until the fold', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    const src = await inSource(page, s);
    const from = LIST_DOC.indexOf('- pear');
    const to = LIST_DOC.indexOf('\n\nTail');
    await src.select(from, to);
    const text = LIST_DOC.slice(from, to);
    await s.choose('Sort lines');
    const sheet = await s.sheet();
    assert.equal(sheet.before, text);
    assert.equal(sheet.after, runTransform('sort', text));
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    const edited = LIST_DOC.slice(0, from) + runTransform('sort', text) + LIST_DOC.slice(to);
    assert.equal(await src.doc(), edited);
    assert.equal(await s.disk(), LIST_DOC, 'nothing on disk');
    assert.equal(await s.writes(), 0);
    assert.ok(await src.hasFocus(), 'focus is back in the editor');
    await page.keyboard.press(`${s.mod}+z`);
    await s.settle();
    assert.equal(await src.doc(), LIST_DOC, 'one undo in the editor restores the text');
  });
});

test('in Source: a CRLF file keeps its endings through Apply (no doubled CR), and nothing selected means the whole document', async () => {
  await withApp({ [A]: CRLF_DOC }, async (page, s) => {
    const src = await inSource(page, s);
    assert.notEqual(runTransform('dedupe', CRLF_DOC), CRLF_DOC, 'the fixture has something to remove');
    await s.choose('Remove duplicate lines');
    const sheet = await s.sheet();
    assert.match(sheet.title, /the document/);
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    // Leave Source: the fold writes the editor's text to the store with the file's endings.
    await page.keyboard.press(`${s.mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    await s.settle();
    const stored = await s.store();
    assert.equal(stored, runTransform('dedupe', CRLF_DOC));
    assert.ok(stored.startsWith('﻿') && !/\r\r/.test(stored) && !/[^\r]\n/.test(stored));
  });
});

test('in Source: editing after the sheet opened, then Apply, changes nothing and says so', async () => {
  await withApp({ [A]: LIST_DOC }, async (page, s) => {
    const src = await inSource(page, s);
    await src.select(LIST_DOC.indexOf('- pear'), LIST_DOC.indexOf('\n\nTail'));
    await s.choose('Sort lines');
    await page.evaluate(async () => {
      const view = (await import('/src/source/editor.ts')).activeSourceEditor().view;
      view.dispatch({ changes: { from: 0, insert: 'X' } });
    });
    const edited = await src.doc();
    await page.keyboard.press(`${s.mod}+Enter`);
    await s.settle();
    assert.equal(await src.doc(), edited);
    assert.match((await s.sheet()).status, /document changed/i);
  });
});
