// Each pane its own mode (D-11): `Mod+E` toggles the focused pane only, Source is a CodeMirror inside its
// pane, a source file opens in Source in whichever pane it opens in, and Source text reaches the other view
// of the same document when focus leaves the editor (folded into the store, one history entry). Text typed
// in a Source pane is never lost to what the other pane does. Booted on the shipped skeleton and CSS
// (test/support/two-pane.mjs), over the memory shell.
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
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(12)}\n\n## Later\n\n${para('Later').repeat(12)}\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(12)}\n`,
  '/r/D.md': `# Delta\n\n${'Delta is one short paragraph of its own.\n\n'.repeat(60)}## Later\n\n${'Later is one more.\n\n'.repeat(60)}`,
  '/r/C.md': `# Charlie\n\n${para('Charlie').repeat(4)}\n`,
  '/r/README.md': '# Readme\n\nThe crate is in [lib.rs](lib.rs).\n',
  '/r/lib.rs': 'pub fn answer() -> u32 {\n    42\n}\n',
  '/r/L.md': Array.from({ length: 8 }, (_, i) => `line${i + 1} hello world`).join('\n') + '\n',
  '/r/mid.md': Array.from({ length: 80 }, (_, i) => `mid ${i} the quick brown fox`).join('\n') + '\n',
};

async function withPanes(open, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await bootTwoPanes(page, { files, open });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, mod);
  } finally {
    await browser.close();
  }
}

/** Each pane's `data-marxy-mode`, left to right, and the body's. */
const modes = (page) =>
  page.evaluate(() => ({
    panes: [...document.querySelectorAll('#marxy-main > section.marxy-pane')].map((p) => p.dataset.marxyMode ?? null),
    body: document.body.dataset.marxyMode,
  }));

/** The text in pane `slot`'s Source editor, or null with none mounted. */
const editorText = (page, slot) =>
  page.evaluate(async (slot) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const pane = window.__marxyHandle.panes().panes[slot];
    return pane ? activeSourceEditor(pane.parts.source)?.docText() ?? null : null;
  }, slot);

/** The bytes pane `slot`'s store holds, as text. */
const storeText = (page, slot) =>
  page.evaluate(
    (slot) => new TextDecoder().decode(window.__marxyHandle.panes().panes[slot].view.store().snapshot().buffer.bytes),
    slot,
  );

/** The right pane in Source, focused, with `typed` typed at the end of its first line through the keyboard. */
async function typeInRightSource(page, mod, typed) {
  await page.keyboard.press(`${mod}+2`);
  if ((await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.mode)) !== 'source') {
    await page.keyboard.press(`${mod}+e`);
  }
  await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.mode === 'source');
  await page.waitForSelector('#marxy-source-2 .cm-content');
  await page.focus('#marxy-source-2 .cm-content');
  await page.evaluate(async () => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const view = activeSourceEditor(document.getElementById('marxy-source-2')).view;
    const end = view.state.doc.line(1).to;
    view.dispatch({ selection: { anchor: end, head: end } });
  });
  await page.keyboard.type(typed);
  assert.ok((await editorText(page, 1)).split('\n')[0].endsWith(typed), 'the editor took the keys');
}

test('Mod+E with the right pane focused makes only the right pane Source; the body mirrors the focused pane', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    // The left pane scrolled away from the top, so "untouched" means something.
    await page.evaluate(() => {
      const left = window.__marxyHandle.panes().panes[0];
      left.host.scrollTop = 400;
    });
    const before = await page.evaluate(() => {
      const left = window.__marxyHandle.panes().panes[0];
      return { scrollTop: left.host.scrollTop, html: left.article.innerHTML, hidden: left.article.hidden };
    });
    assert.ok(before.scrollTop > 0, 'the left pane can scroll');
    assert.deepEqual(await modes(page), { panes: ['rendered', 'rendered'], body: 'rendered' });

    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.mode === 'source');
    assert.deepEqual(await modes(page), { panes: ['rendered', 'source'], body: 'source' });
    const left = await page.evaluate(() => {
      const left = window.__marxyHandle.panes().panes[0];
      return { scrollTop: left.host.scrollTop, html: left.article.innerHTML, hidden: left.article.hidden };
    });
    assert.deepEqual(left, before);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.mode), 'rendered');

    await page.keyboard.press(`${mod}+1`);
    assert.deepEqual(await modes(page), { panes: ['rendered', 'source'], body: 'rendered' });
    await page.keyboard.press(`${mod}+2`);
    assert.deepEqual(await modes(page), { panes: ['rendered', 'source'], body: 'source' });
    // Back to Rendered in the right pane, from the right pane.
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.mode === 'rendered');
    assert.deepEqual(await modes(page), { panes: ['rendered', 'rendered'], body: 'rendered' });
  });
});

test('the right pane\'s Source is absolutely placed inside its pane, and its editor is a descendant of it', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForSelector('[data-marxy-pane="1"] .cm-editor');
    const placed = await page.evaluate(() => {
      const mount = document.getElementById('marxy-source-2');
      const pane = document.querySelector('[data-marxy-pane="1"]');
      const box = mount.getBoundingClientRect();
      const host = pane.getBoundingClientRect();
      return {
        position: getComputedStyle(mount).position,
        inPane: pane.contains(mount),
        editorInPane: pane.contains(document.querySelector('#marxy-source-2 .cm-editor')),
        withinPane: box.left >= host.left - 0.5 && box.right <= host.right + 0.5,
        leftEditors: document.querySelectorAll('[data-marxy-pane="0"] .cm-editor').length,
      };
    });
    assert.deepEqual(placed, { position: 'absolute', inPane: true, editorInPane: true, withinPane: true, leftEditors: 0 });
  });
});

test('lib.rs opened beside a README is in Source with no Mod+E; the README stays Rendered and focused', async () => {
  await withPanes(['/r/README.md', '/r/lib.rs'], async (page) => {
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1]?.view.mode === 'source');
    assert.deepEqual(await modes(page), { panes: ['rendered', 'source'], body: 'rendered' });
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 0);
    assert.equal(await editorText(page, 1), files['/r/lib.rs']);
    assert.equal(await page.evaluate(() => document.getElementById('doc-2').hidden), true);
  });
});

test('the same file Rendered left and Source right: a key typed right reaches the left page on Mod+1; undo takes it out of both', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.store() === window.__marxyHandle.panes().panes[1].view.store()), true);
    const hashBefore = await page.evaluate(() => window.__marxyHandle.sourceHarness().bufferHash);
    await typeInRightSource(page, mod, 'Qz');
    await page.keyboard.press(`${mod}+1`);
    await page.waitForFunction(() => document.querySelector('#doc h1')?.textContent.includes('AlphaQz'));
    const after = await page.evaluate(() => ({
      focused: window.__marxyHandle.panes().focused.slot,
      hash: window.__marxyHandle.sourceHarness().bufferHash,
      mode: window.__marxyHandle.sourceHarness().mode,
    }));
    assert.equal(after.focused, 0);
    assert.equal(after.mode, 'rendered');
    assert.notEqual(after.hash, hashBefore);
    assert.ok((await storeText(page, 0)).startsWith('# AlphaQz\n'));

    await page.keyboard.press(`${mod}+z`);
    await page.waitForFunction(() => !document.querySelector('#doc h1')?.textContent.includes('Qz'));
    await page.waitForFunction(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      return activeSourceEditor(document.getElementById('marxy-source-2'))?.docText().startsWith('# Alpha\n');
    });
    assert.equal(await storeText(page, 0), files['/r/A.md']);
    assert.equal(await editorText(page, 1), files['/r/A.md']);
    assert.equal(await page.evaluate(() => window.__marxyHandle.sourceHarness().bufferHash), hashBefore);
  });
});

test('a Source round trip without edits leaves the buffer fingerprint identical, in either pane', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    for (const key of ['2', '1']) {
      await page.keyboard.press(`${mod}+${key}`);
      const before = await page.evaluate(() => window.__marxyHandle.sourceHarness().bufferHash);
      await page.keyboard.press(`${mod}+e`);
      await page.waitForFunction(() => window.__marxyHandle.sourceHarness().mode === 'source');
      await page.keyboard.press(`${mod}+e`);
      await page.waitForFunction(() => window.__marxyHandle.sourceHarness().mode === 'rendered');
      assert.equal(await page.evaluate(() => window.__marxyHandle.sourceHarness().bufferHash), before, `pane ${key}`);
      assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.view.store().snapshot().canUndo), false);
    }
  });
});

test('Source text in one pane survives the other pane switching mode, opening another file and undoing', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await typeInRightSource(page, mod, 'Qz');
    await page.keyboard.press(`${mod}+1`);
    // Another document: nothing is folded across (the right pane is the only view of B), and nothing lost.
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.sourceHasUnfoldedEdits()), true);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.mode === 'source');
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.mode === 'rendered');
    await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'undo' }));
    await page.evaluate(() => window.__marxyHandle.panes().openIn(0, '/r/C.md'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === '/r/C.md');
    assert.ok((await editorText(page, 1)).startsWith('# BravoQz\n'));
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.sourceHasUnfoldedEdits()), true);
    assert.deepEqual(await modes(page), { panes: ['rendered', 'source'], body: 'rendered' });
  });
});

test('closing the left pane keeps the right pane\'s Source text: it is folded into the store the survivor shows', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await typeInRightSource(page, mod, 'Qz');
    const closed = await page.evaluate(() => {
      const panes = window.__marxyHandle.panes();
      return panes.close(panes.panes[0]);
    });
    assert.equal(closed, true);
    const survivor = await page.evaluate(() => ({
      count: window.__marxyHandle.panes().panes.length,
      path: window.__marxyHandle.currentPath(),
      mode: window.__marxyHandle.panes().panes[0].view.mode,
    }));
    assert.deepEqual(survivor, { count: 1, path: '/r/B.md', mode: 'source' });
    assert.ok((await storeText(page, 0)).startsWith('# BravoQz\n'));
    assert.ok((await editorText(page, 0)).startsWith('# BravoQz\n'));
    assert.deepEqual(await modes(page), { panes: ['source'], body: 'source' });
  });
});

test('the same file twice: a reload from disk the other pane\'s watch reads keeps the Source pane\'s typed text', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await typeInRightSource(page, mod, 'Qz');
    // Still focused in the editor: nothing folded yet.
    assert.equal(await storeText(page, 1), files['/r/A.md']);
    const elsewhere = '# Elsewhere\n\nWritten by another program.\n';
    await page.evaluate(async (text) => {
      const h = window.__marxyHandle;
      await h.shell.writeFileAtomic('/r/A.md', new TextEncoder().encode(text));
      h.shell.emit([{ kind: 'modified', path: '/r/A.md' }]);
    }, elsewhere);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile' || c.method === 'peekFile').length > 0);
    await page.waitForTimeout(400);
    assert.ok((await editorText(page, 1)).startsWith('# AlphaQz\n'), 'the typed text is still in the editor');
    // Kept as an unsaved edit over what disk now holds: in the store, so the left page and a save see it.
    assert.ok((await storeText(page, 1)).startsWith('# AlphaQz\n'), 'the typed text is in the store');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.store().snapshot().dirty), true);
    await page.waitForFunction(() => document.querySelector('#doc h1')?.textContent.includes('AlphaQz'));
  });
});

test('undo with a Source pane focused folds its text first, per pane: undo takes it out, redo puts it back in both views', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await typeInRightSource(page, mod, 'Qz');
    assert.equal(await storeText(page, 1), files['/r/A.md']);
    await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'undo' }));
    assert.equal(await storeText(page, 1), files['/r/A.md']);
    assert.equal(await editorText(page, 1), files['/r/A.md']);
    await page.evaluate(() => window.__marxyHandle.dispatch({ type: 'redo' }));
    assert.ok((await storeText(page, 1)).startsWith('# AlphaQz\n'));
    assert.ok((await editorText(page, 1)).startsWith('# AlphaQz\n'));
    await page.waitForFunction(() => document.querySelector('#doc h1')?.textContent.includes('AlphaQz'));
  });
});

test('a right pane scrolled in Source comes back to Rendered at the line on its reading line, not the top', async () => {
  await withPanes(['/r/B.md', '/r/D.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.mode === 'source');
    // Two frames for the entry place, then the reader scrolls the pane's Source down to "## Later".
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const later = files['/r/D.md'].indexOf('## Later');
    const scrolled = await page.evaluate(async (later) => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const mount = document.getElementById('marxy-source-2');
      const view = activeSourceEditor(mount).view;
      const top = view.lineBlockAt(later).top + view.documentTop - mount.getBoundingClientRect().top;
      const scrolling = [mount, view.scrollDOM, mount.parentElement].find((el) => el.scrollHeight > el.clientHeight + 1);
      scrolling.scrollTop += top - scrolling.clientHeight * 0.4;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return scrolling.scrollTop;
    }, later);
    assert.ok(scrolled > 0, 'the pane\'s Source scrolled');
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.mode === 'rendered');
    const at = await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.position().byteOffset);
    assert.ok(Math.abs(at - later) < 200, `the right pane came back at byte ${at}, not near "## Later" (${later})`);
  });
});

test('with both panes in Source, line numbers toggle in the focused pane\'s editor only', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    // The right pane's editor first and the left's last, so "the editor mounted last" is not the focused one.
    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForSelector('#marxy-source-2 .cm-editor');
    await page.keyboard.press(`${mod}+1`);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForSelector('#marxy-source .cm-editor');
    await page.keyboard.press(`${mod}+2`);
    const gutters = () =>
      page.evaluate(() => ['#marxy-source', '#marxy-source-2'].map((m) => Boolean(document.querySelector(`${m} .cm-lineNumbers`))));
    const before = await gutters();
    await page.evaluate(async () => {
      const { sourceViewCommands } = await import('/src/commands/source-view.ts');
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const cmd = sourceViewCommands().find((c) => c.id === 'view.toggle-line-numbers');
      await cmd.run(buildAppContext(window.__marxyHandle));
    });
    await page.waitForFunction(
      (want) => Boolean(document.querySelector('#marxy-source-2 .cm-lineNumbers')) === want,
      !before[1],
    );
    assert.deepEqual(await gutters(), [before[0], !before[1]]);
  });
});

/** Types `typed` at the end of the first line of pane `slot`'s Source editor, through the keyboard. */
async function typeAtFirstLineEnd(page, slot, typed) {
  const mount = slot === 0 ? '#marxy-source' : '#marxy-source-2';
  await page.focus(`${mount} .cm-content`);
  await page.evaluate(async (mount) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const view = activeSourceEditor(document.querySelector(mount)).view;
    const end = view.state.doc.line(1).to;
    view.dispatch({ selection: { anchor: end, head: end } });
  }, mount);
  await page.keyboard.type(typed);
}

/** Both panes on A.md, both in Source, the right one focused last. */
async function bothInSource(page, mod) {
  await page.keyboard.press(`${mod}+1`);
  await page.keyboard.press(`${mod}+e`);
  await page.waitForSelector('#marxy-source .cm-editor');
  await page.keyboard.press(`${mod}+2`);
  await page.keyboard.press(`${mod}+e`);
  await page.waitForSelector('#marxy-source-2 .cm-editor');
  assert.deepEqual(await modes(page), { panes: ['source', 'source'], body: 'source' });
}

const firstLines = async (page) => [
  (await editorText(page, 0)).split('\n')[0],
  (await editorText(page, 1)).split('\n')[0],
  (await storeText(page, 0)).split('\n')[0],
];

test('the same file in Source in both panes: each pane\'s fold reaches the other editor, so neither writes the other\'s typing back out', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await bothInSource(page, mod);
    await page.keyboard.press(`${mod}+1`);
    await typeAtFirstLineEnd(page, 0, 'X');
    await page.keyboard.press(`${mod}+2`);
    assert.deepEqual(await firstLines(page), ['# AlphaX', '# AlphaX', '# AlphaX']);
    await typeAtFirstLineEnd(page, 1, 'Y');
    await page.keyboard.press(`${mod}+1`);
    assert.deepEqual(await firstLines(page), ['# AlphaXY', '# AlphaXY', '# AlphaXY']);
    await typeAtFirstLineEnd(page, 0, 'Z');
    await page.keyboard.press(`${mod}+2`);
    assert.deepEqual(await firstLines(page), ['# AlphaXYZ', '# AlphaXYZ', '# AlphaXYZ']);
    // Leaving Source in either pane writes nothing back over the other's.
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[1].view.mode === 'rendered');
    assert.equal((await storeText(page, 0)).split('\n')[0], '# AlphaXYZ');
    await page.waitForFunction(() => document.querySelector('#doc-2 h1')?.textContent.includes('AlphaXYZ'));
  });
});

test('a fold from the other pane meets Source text of this pane\'s own not yet folded: it is held apart, nothing lost', async () => {
  await withPanes(['/r/A.md', '/r/A.md'], async (page, mod) => {
    await bothInSource(page, mod);
    // The right pane focused, with typing of its own still in its editor alone.
    await typeAtFirstLineEnd(page, 1, 'Y');
    assert.equal((await storeText(page, 0)).split('\n')[0], '# Alpha');
    // The left editor takes edits and is folded while the right pane keeps focus (no route of the app
    // does this any more: it is the guard behind them).
    await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const view = activeSourceEditor(document.getElementById('marxy-source')).view;
      const end = view.state.doc.line(1).to;
      const later = view.state.doc.line(3).from;
      view.dispatch({ changes: [{ from: end, insert: 'X' }, { from: later, insert: 'Lx ' }] });
      await window.__marxyHandle.panes().panes[0].content.foldSource();
    });
    const folded = await storeText(page, 0);
    assert.ok(folded.startsWith('# AlphaX\n\nLx Alpha'), folded.slice(0, 40));
    // The right editor keeps its own text as typed; the reader is told.
    assert.ok((await editorText(page, 1)).startsWith('# AlphaY\n\nAlpha'), (await editorText(page, 1)).slice(0, 40));
    await page.waitForFunction(() => document.body.textContent.includes('Source in the other pane changed this file'));
    // Its folds are refused: on blur, and on leaving Source, which would write it over the left's.
    await page.keyboard.press(`${mod}+1`);
    assert.equal(await storeText(page, 0), folded);
    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+e`);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.mode), 'source');
    assert.equal(await storeText(page, 0), folded);
    assert.ok((await editorText(page, 1)).startsWith('# AlphaY\n'));
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].view.sourceHasUnfoldedEdits()), true);
  });
});

/**
 * The route the review found: the right pane holds unfolded Source on `file`, which only it shows; the
 * left pane opens `file`, goes to Source and types; focus moves back to the right editor and then left.
 */
async function openOverUnfolded(page, mod, file, rightEdits, leftEdits) {
  await page.evaluate((f) => window.__marxyHandle.panes().openIn(1, f), file);
  await page.keyboard.press(`${mod}+2`);
  await page.keyboard.press(`${mod}+e`);
  await page.waitForSelector('#marxy-source-2 .cm-content');
  for (const [line, typed] of rightEdits) await typeAtLineEnd(page, 1, line, typed);
  await page.keyboard.press(`${mod}+1`);
  await page.evaluate((f) => window.__marxyHandle.panes().openIn(0, f), file);
  await page.waitForFunction((f) => window.__marxyHandle.panes().panes[0].path() === f, file);
  await page.keyboard.press(`${mod}+e`);
  await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.mode === 'source');
  await page.waitForSelector('#marxy-source .cm-content');
  for (const [line, typed] of leftEdits) await typeAtLineEnd(page, 0, line, typed);
  await page.keyboard.press(`${mod}+2`);
  await page.keyboard.press(`${mod}+1`);
  await page.waitForTimeout(200);
}

async function typeAtLineEnd(page, slot, line, typed) {
  const mount = slot === 0 ? '#marxy-source' : '#marxy-source-2';
  await page.focus(`${mount} .cm-content`);
  await page.evaluate(async ({ mount, line }) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const view = activeSourceEditor(document.querySelector(mount)).view;
    const end = view.state.doc.line(line).to;
    view.dispatch({ selection: { anchor: end, head: end } });
  }, { mount, line });
  await page.keyboard.type(typed);
}

test('a pane opening a file the other pane holds unfolded in Source folds the holder first: both panes\' typing survives (C2)', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await openOverUnfolded(page, mod, '/r/L.md', [[1, 'R1'], [6, 'R6']], [[3, 'LEFT3']]);
    const want = files['/r/L.md'].replace('line1 hello world', 'line1 hello worldR1').replace('line6 hello world', 'line6 hello worldR6').replace('line3 hello world', 'line3 hello worldLEFT3');
    assert.equal(await storeText(page, 0), want);
    assert.equal(await editorText(page, 0), want);
    assert.equal(await editorText(page, 1), want);
  });
});

test('the same route in an 80-line file: no typed text moves to another line (C9)', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await openOverUnfolded(page, mod, '/r/mid.md', [[40, 'RIGHT']], [[2, 'L'], [78, 'L']]);
    const want = files['/r/mid.md'].split('\n');
    want[39] += 'RIGHT';
    want[1] += 'L';
    want[77] += 'L';
    assert.equal(await storeText(page, 0), want.join('\n'));
    assert.equal(await editorText(page, 1), want.join('\n'));
  });
});
