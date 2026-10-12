// The depth lens in Source (K-10a), in the running app over the memory shell, WebKit: a JSON file folds to a depth by
// palette command, every fold says how many lines it hides, and none of it touches the bytes. Commitment 3 (a fold is
// a view: the buffer, a copy and a save are the file's own) and commitment 4 (a fold says what it hides).
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

/** The research's fixture: 60 items of `{id, name, tags: [a, b], ok}`, indent 2: 544 lines. */
const ITEMS = JSON.stringify({ items: Array.from({ length: 60 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'], ok: true })) }, null, 2);
const JSON_PATH = '/r/data.json';
const files = {
  [JSON_PATH]: ITEMS,
  '/r/Cargo.toml': '[package]\nname = "x"\n\n[dependencies]\na = "1"\nb = { version = "2",\n  features = ["c"] }\n',
  '/r/notes.md': '# Title\n\nbody one\nbody two\n\n## Next\n\ntext\n',
  '/r/ci.yml': 'name: ci\njobs:\n  test:\n    steps:\n      - run: a\n      - run: b\n  lint:\n    steps:\n      - run: c\n',
};

/** A page tall enough to draw all of a folded file (CodeMirror draws only what is in view). */
async function withApp(open, fn, { height = 2600, inSource = true } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height } });
    await bootTwoPanes(page, { files, open: [open], guard: true });
    if (inSource) await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-line'));
    await fn(page, (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');
  } finally {
    await browser.close();
  }
}

/** The palette's own list, asked the way the palette asks it: a command runs only if its `when` allows. */
const runCommandSource = `async (id) => {
  const { commands } = await import('/src/commands/index.ts');
  const { buildAppContext } = await import('/src/selection/bind.ts');
  const ctx = buildAppContext(window.__marxyHandle);
  const cmd = commands().find((c) => c.id === id);
  if (cmd && cmd.when(ctx)) await cmd.run(ctx);
}`;

/** Runs a palette command by id in the page (the command's `when` decides whether it runs), once its language is on. */
async function run(page, id) {
  await page.waitForFunction(async () => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const { depthFoldKind } = await import('/src/source/depth-fold.ts');
    const editor = activeSourceEditor();
    return editor !== null && depthFoldKind(editor.view.state) !== null;
  });
  await page.evaluate(`(${runCommandSource})(${JSON.stringify(id)})`);
  await page.waitForTimeout(150);
}

/** Which of the five depth commands the palette's own list offers for the open file. */
function offered(page) {
  return page.evaluate(async () => {
    const { commands } = await import('/src/commands/index.ts');
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const ctx = buildAppContext(window.__marxyHandle);
    return commands()
      .filter((c) => c.id.startsWith('source.fold-depth-') || c.id === 'source.unfold-all')
      .filter((c) => c.when(ctx))
      .map((c) => c.title);
  });
}

/** What the page shows of the editor: its lines, its fold placeholders, and the document it holds. */
const shown = (page) =>
  page.evaluate(async () => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const { visibleLineCount } = await import('/src/source/depth-fold.ts');
    const view = activeSourceEditor().view;
    return {
      lines: view.dom.querySelectorAll('.cm-line').length,
      // Every line the reader would scroll through, drawn or not (CodeMirror draws a screenful of a long file).
      visible: visibleLineCount(view.state),
      placeholders: [...view.dom.querySelectorAll('.marxy-fold-placeholder')].map((el) => el.textContent),
      doc: view.state.doc.toString(),
    };
  }).then((s) => ({ ...s, folds: s.placeholders.length }));

const storeBytes = (page) =>
  page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));

test('Fold to depth 2 shows 64 lines or fewer of the 544, each fold says its count, and the bytes are unchanged', async () => {
  await withApp(JSON_PATH, async (page) => {
    assert.deepEqual(await offered(page), ['Fold to depth 1', 'Fold to depth 2', 'Fold to depth 3', 'Fold to depth 4', 'Unfold all']);
    const rest = await shown(page);
    assert.equal(rest.folds, 0, 'nothing is folded at rest');
    await run(page, 'source.fold-depth-2');
    const after = await shown(page);
    assert.equal(after.folds, 60);
    assert.ok(after.lines <= 64, `${after.lines} lines drawn`);
    assert.equal(after.lines, 64);
    // Each of the sixty items is a line `{ … 7 lines },`: nine lines, two stay.
    assert.equal(after.placeholders.length, 60);
    for (const text of after.placeholders) assert.equal(text, '… 7 lines');
    assert.equal(after.doc, ITEMS, 'the editor holds the same text');
    assert.equal(await storeBytes(page), ITEMS, 'the store holds the same bytes');
    assert.equal(await page.evaluate(() => window.__marxyHandle.document().snapshot().dirty), false, 'a fold is not an edit');
  });
});

test('Fold to depth 1 to 4 and Unfold all: 3, 64, 364 and 544 lines in view, and the text is never different', async () => {
  await withApp(JSON_PATH, async (page) => {
    const drawn = [];
    for (const depth of [1, 2, 3, 4]) {
      await run(page, `source.fold-depth-${depth}`);
      const s = await shown(page);
      drawn.push(s.visible);
      assert.equal(s.doc, ITEMS);
    }
    await run(page, 'source.fold-depth-1');
    assert.equal((await shown(page)).placeholders[0], '… 540 lines');
    await run(page, 'source.unfold-all');
    assert.equal((await shown(page)).folds, 0);
    // Depth 3 folds each item's tag list (2 lines hidden of 4); depth 4 has nothing to fold and leaves none folded.
    assert.deepEqual(drawn, [3, 64, 364, 544]);
  });
});

test('Mod+A Mod+C after folding to depth 1 copies every byte of the file, and a save writes the bytes read', async () => {
  await withApp(JSON_PATH, async (page, mod) => {
    await run(page, 'source.fold-depth-1');
    assert.equal((await shown(page)).folds, 1);
    await page.evaluate(() => {
      window.__copied = [];
      // After the editor's own handler, which puts the selected text on the event.
      document.addEventListener('copy', (e) => window.__copied.push(e.clipboardData?.getData('text/plain') ?? null));
    });
    await page.locator('#marxy-source .cm-content').click();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.press(`${mod}+c`);
    await page.waitForFunction(() => window.__copied.length > 0);
    const copied = await page.evaluate(() => window.__copied);
    assert.equal(copied.length, 1, 'one copy reached the clipboard');
    assert.equal(copied[0], ITEMS, 'the copy is the whole file, folded text and all');
    assert.equal((await shown(page)).folds, 1, 'the fold is still there');
    assert.equal(await storeBytes(page), ITEMS);

    // Save with the fold on a file with no edit, then with one edit in view: the bytes written are the file's own.
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${mod}+Home`);
    await page.keyboard.press(`${mod}+s`);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate((p) => window.__disk(p), JSON_PATH), ITEMS, 'a clean save leaves the file as it was');
    await page.keyboard.type(' ');
    await page.keyboard.press(`${mod}+s`);
    await page.waitForFunction((p) => window.__appWrites.some((w) => w.path === p), JSON_PATH);
    assert.equal(await page.evaluate((p) => window.__disk(p), JSON_PATH), ` ${ITEMS}`, 'only the typed byte changed; what the fold hides was written as read');
    assert.equal((await shown(page)).folds, 1, 'the fold survives the save');
  });
});

test('clicking a placeholder unfolds that fold alone', async () => {
  await withApp(JSON_PATH, async (page) => {
    await run(page, 'source.fold-depth-2');
    await page.locator('#marxy-source .marxy-fold-placeholder').first().click();
    const s = await shown(page);
    assert.equal(s.folds, 59);
    assert.equal(s.doc, ITEMS);
  });
});

test('a change inside a fold counts its lines again', async () => {
  await withApp(JSON_PATH, async (page) => {
    await run(page, 'source.fold-depth-2');
    // Add three lines inside the first item (a replace-all would do the same): the placeholder follows.
    await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const view = activeSourceEditor().view;
      const at = view.state.doc.toString().indexOf('"name"');
      view.dispatch({ changes: { from: at, insert: '"x": 1,\n"y": 2,\n"z": 3,\n' } });
    });
    await page.waitForTimeout(100);
    const s = await shown(page);
    assert.equal(s.folds, 60);
    assert.equal(s.placeholders[0], '… 10 lines');
    assert.equal(s.placeholders[1], '… 7 lines');
  });
});

test('YAML folds by depth too, and TOML is offered nothing', async () => {
  await withApp('/r/ci.yml', async (page) => {
    assert.equal((await offered(page)).length, 5);
    await run(page, 'source.fold-depth-2');
    const s = await shown(page);
    assert.equal(s.folds, 2, 'jobs.test and jobs.lint');
    assert.deepEqual(s.placeholders, ['… 3 lines', '… 2 lines']);
    assert.equal(s.doc, files['/r/ci.yml']);
  });
  await withApp('/r/Cargo.toml', async (page) => {
    assert.deepEqual(await offered(page), []);
    await page.evaluate(`(${runCommandSource})('source.fold-depth-1')`);
    assert.equal((await shown(page)).folds, 0, 'running it by id does nothing either');
  });
});

/** Where the editor's caret is, and puts it at `at`. */
const caretAt = (page, at) =>
  page.evaluate(async (at) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const view = activeSourceEditor().view;
    view.dispatch({ selection: { anchor: at } });
    view.focus();
    return view.state.doc.length;
  }, at);

test('Backspace at the end of a fold opens it, in JSON and in Markdown: no text is deleted out of sight', async () => {
  await withApp(JSON_PATH, async (page) => {
    await run(page, 'source.fold-depth-1');
    assert.equal((await shown(page)).folds, 1);
    // The fold hides the items array's inside; its end is the `]`'s start.
    await caretAt(page, ITEMS.lastIndexOf(']'));
    assert.equal((await shown(page)).folds, 1, 'the caret at its end does not open it');
    await page.keyboard.press('Backspace');
    const s = await shown(page);
    assert.equal(s.folds, 0, 'the fold opened');
    assert.ok(s.doc.length < ITEMS.length, 'the hidden indent went, and the fold is open for the reader to see it go');
  });
  await withApp('/r/notes.md', async (page, mod) => {
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-line'));
    await page.evaluate(`(${runCommandSource})('view.toggle-line-numbers')`);
    await page.waitForSelector('#marxy-source .cm-foldGutter .marxy-fold-open', { state: 'attached' });
    // The first line's chevron folds the `# Title` section.
    await page.locator('#marxy-source .cm-foldGutter .marxy-fold-open').first().click({ force: true });
    assert.equal((await shown(page)).placeholders.length, 1, 'the heading folded');
    const text = files['/r/notes.md'];
    await caretAt(page, text.indexOf('## Next'));
    await page.keyboard.press('Backspace');
    const s = await shown(page);
    assert.equal(s.placeholders.length, 0, 'the fold opened');
    assert.equal(s.doc.length, text.length - 1);
  }, { inSource: false });
});

test('no placeholder is a tab stop, so Tab leaves the editor; the caret-on-a-fold key unfolds it', async () => {
  await withApp(JSON_PATH, async (page, mod) => {
    await run(page, 'source.fold-depth-2');
    const tabbable = await page.evaluate(() => [...document.querySelectorAll('#marxy-source .marxy-fold-placeholder')].filter((el) => el.tabIndex >= 0).length);
    assert.equal(await page.locator('#marxy-source .marxy-fold-placeholder').count(), 60);
    assert.equal(tabbable, 0, 'none of the sixty is a tab stop');
    const first = page.locator('#marxy-source .marxy-fold-placeholder').first();
    assert.equal(await first.getAttribute('role'), 'button');
    assert.equal(await first.getAttribute('aria-label'), '7 lines folded');
    // Tab from the text goes somewhere else, not into a placeholder.
    await caretAt(page, 0);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('marxy-fold-placeholder')), false);
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.cm-editor') === null), true, 'focus left the editor');
    // The caret on a folded line, then CodeMirror's unfold key.
    const line3 = ITEMS.split('\n').slice(0, 2).join('\n').length + 1;
    await caretAt(page, line3 + 1);
    await page.keyboard.press(mod === 'Meta' ? 'Meta+Alt+]' : 'Control+Shift+]');
    const s = await shown(page);
    assert.equal(s.folds, 59, 'that fold opened, the others stayed');
    assert.equal(s.doc, ITEMS);
  });
});
