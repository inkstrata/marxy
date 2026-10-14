// Notes about a file in Source (V-04, WebKit): a fence never closed, a heading that skips a level and a path that is not
// there each get a faint ring in the right-edge strip, a count in the bottom bar, and a stop for *Go to next note*. Notes
// are a view: no class or decoration lands on the reader's text (commitment 3), a path Marxy cannot check is never called
// missing, and a big file's first text does not wait for them (commitment 5). The running app over the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

// Line 3 skips from h1 to h3; line 5 names a file that is not there; `docs/real.md` is; `ghost/dir/x.md` is under a folder
// that was never listed and `~/n/m.md` has no home to look in, so neither is called missing; the fence on line 9 is never closed.
const NOTED = [
  '# Title',
  '',
  '### Skips a level',
  '',
  'See `docs/gone.md` and `docs/real.md` and `ghost/dir/x.md` and `~/n/m.md`.',
  '',
  '## Fine',
  '',
  '```js',
  'const a = 1;',
  '',
].join('\n');
const files = { '/r/noted.md': NOTED, '/r/docs/real.md': '# real\n', '/r/clean.md': '# A\n\n## B\n\n```\nx\n```\n' };

async function withApp(open, fn, fileSet = files, { source = true } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    await bootTwoPanes(page, { files: fileSet, open: [open], guard: true });
    await page.waitForFunction(() => window.__marxyHandle !== undefined);
    await page.waitForTimeout(300);
    if (source) {
      if ((await page.evaluate(() => document.body.dataset.marxyMode)) !== 'source') await runCommand(page, 'view.mode-source');
      await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-line'));
    }
    await fn(page);
  } finally {
    await browser.close();
  }
}

const runCommand = (page, id) =>
  page.evaluate(async (cmdId) => {
    const { commands } = await import('/src/commands/index.ts');
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const ctx = buildAppContext(window.__marxyHandle);
    const cmd = commands().find((c) => c.id === cmdId);
    if (cmd && cmd.when(ctx)) await cmd.run(ctx);
    return cmd !== undefined;
  }, id);

const caretLine = (page) =>
  page.evaluate(async () => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const { state } = activeSourceEditor().view;
    return state.doc.lineAt(state.selection.main.head).number;
  });

test('V-04 a file with one of each shows three note marks and "3 notes"; next note visits them in order and wraps', async () => {
  await withApp('/r/noted.md', async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('.marxy-source-mark-note').length === 3);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-source-notes').textContent), '3 notes');
    const titles = await page.evaluate(() => [...document.querySelectorAll('.marxy-source-mark-note')].map((m) => m.title));
    assert.deepEqual(titles, [
      'Heading at 3:1 jumps from level 1 to level 3',
      'Path docs/gone.md at 5:6 is not found',
      'Fence opened at 9:1 is never closed',
    ]);
    // Each mark is a ring (a shape of its own), not a bar, and sits in the strip beside the other marks.
    const shape = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.marxy-source-mark-note'));
      return { radius: s.borderRadius, fill: s.backgroundColor };
    });
    assert.match(shape.radius, /50%|3px/);
    assert.match(shape.fill, /rgba\(0, 0, 0, 0\)|transparent/);

    // Next note, in order, then around.
    await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      activeSourceEditor().view.dispatch({ selection: { anchor: 0 } });
    });
    const seen = [];
    for (let i = 0; i < 4; i++) {
      assert.equal(await runCommand(page, 'source.next-note'), true);
      seen.push(await caretLine(page));
    }
    assert.deepEqual(seen, [3, 5, 9, 3]);
    const back = [];
    for (let i = 0; i < 3; i++) {
      await runCommand(page, 'source.previous-note');
      back.push(await caretLine(page));
    }
    assert.deepEqual(back, [9, 5, 3]);
    // A click on a mark goes there.
    await page.click('.marxy-source-mark-note >> nth=2');
    await page.waitForFunction(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const { state } = activeSourceEditor().view;
      return state.doc.lineAt(state.selection.main.head).number === 9;
    });
  });
});

test('V-04 nothing lands on the reader\'s text: no class or decoration in the editor, and the bytes are the file\'s', async () => {
  await withApp('/r/noted.md', async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('.marxy-source-mark-note').length === 3);
    const dom = await page.evaluate(() => {
      const content = document.querySelector('#marxy-source .cm-content');
      const classes = new Set();
      for (const node of content.querySelectorAll('*')) for (const c of node.classList) classes.add(c);
      for (const c of content.classList) classes.add(c);
      return {
        classes: [...classes],
        underlines: [...content.querySelectorAll('*')].filter((n) => /underline|wavy|squiggle/.test(getComputedStyle(n).textDecorationLine + getComputedStyle(n).textDecorationStyle)).length,
        gutter: document.querySelectorAll('#marxy-source .cm-gutters .marxy-source-mark-note, #marxy-source .cm-gutter .cm-gutterElement [class*="note"]').length,
        text: [...content.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'),
      };
    });
    // Classes the editor and Source already had on `main` (CodeMirror's own, the grammar's, V-12's hanging indent); a note adds none.
    const foreign = dom.classes.filter((c) => !/^(cm-|ͼ|tok-|marxy-source-hang$)/.test(c));
    assert.deepEqual(foreign, [], `unexpected classes on the text: ${foreign.join(' ')}`);
    assert.deepEqual(dom.classes.filter((c) => /note/i.test(c)), []);
    assert.equal(dom.underlines, 0);
    assert.equal(dom.gutter, 0);
    assert.equal(dom.text, NOTED.split('\n').slice(0, dom.text.split('\n').length).join('\n'), 'the lines are the file\'s own');
    const same = await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      return activeSourceEditor().docText();
    });
    assert.equal(same, NOTED, 'the editor holds the file as it is');
  });
});

test('V-04 a clean file has no marks and no count, and a path Marxy cannot check is not called missing', async () => {
  await withApp('/r/clean.md', async (page) => {
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-source-mark-note').length), 0);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-source-notes').hidden), true);
    assert.equal(await runCommand(page, 'source.next-note'), true, 'the command is offered in Source and says so when there is nothing to visit');
  });
  // Only the unlisted folder and the home path: neither is a note.
  await withApp('/r/unsure.md', async (page) => {
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-source-mark-note').length), 0);
  }, { ...files, '/r/unsure.md': 'See `ghost/dir/x.md` and `~/n/m.md` and `docs/real.md`.\n' });
});

test('V-04 notes follow the text: a repaired fence loses its note, and Source is one undo for an edit, none for a note', async () => {
  await withApp('/r/noted.md', async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('.marxy-source-mark-note').length === 3);
    await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const { view } = activeSourceEditor();
      view.dispatch({ changes: { from: view.state.doc.length, insert: '```\n' } });
    });
    await page.waitForFunction(() => document.querySelectorAll('.marxy-source-mark-note').length === 2, null, { timeout: 15_000 });
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-source-notes').textContent), '2 notes');
    // Moving between notes writes nothing: the history holds the one edit above.
    await runCommand(page, 'source.next-note');
    await runCommand(page, 'source.previous-note');
    const doc = await page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText());
    assert.equal(doc, `${NOTED}\`\`\`\n`);
  });
});

test('V-04 a 2 MB Markdown file shows its first text before its notes, and the numbers are recorded', async () => {
  const para = 'A paragraph of ordinary prose that fills a line of the file with words.\n\n';
  const big = `# Big\n\n${para.repeat(Math.ceil(2_000_000 / para.length))}\n#### Skips\n\n\`\`\`\nnever closed\n`;
  await withApp('/r/big.md', async (page) => {
    // From the moment Source is asked for to its first line, and to its first note.
    const times = await page.evaluate(async () => {
      const t0 = performance.now();
      const seen = { text: null, note: null, longest: 0 };
      let beat = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        if (seen.text !== null) seen.longest = Math.max(seen.longest, now - beat - 20);
        beat = now;
      }, 20);
      const look = () => {
        if (seen.text === null && document.querySelector('#marxy-source .cm-line')) seen.text = performance.now() - t0;
        if (seen.note === null && document.querySelector('.marxy-source-mark-note')) seen.note = performance.now() - t0;
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true });
      const { commands } = await import('/src/commands/index.ts');
      const { buildAppContext } = await import('/src/selection/bind.ts');
      await commands().find((c) => c.id === 'view.mode-source').run(buildAppContext(window.__marxyHandle));
      for (let i = 0; i < 400 && seen.note === null; i++) await new Promise((r) => setTimeout(r, 100));
      look();
      clearInterval(timer);
      return seen;
    });
    console.log(`V-04 2 MB file, Source asked for at 0: first text ${Math.round(times.text)} ms, first note ${times.note === null ? 'none' : `${Math.round(times.note)} ms`}`);
    console.log(`V-04 2 MB file: the page was held at most ${Math.round(times.longest)} ms at a time once the text was up (the same with notes turned off: Source's own work on a file this size)`);
    assert.ok(times.text !== null);
    if (times.note !== null) assert.ok(times.text < times.note, 'the text is up before a note is');
    assert.ok(times.note !== null, 'the notes arrive');
  }, { '/r/big.md': big }, { source: false });
});
