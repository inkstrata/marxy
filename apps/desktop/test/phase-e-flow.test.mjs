// Phase E's screen criterion, end to end (E-18). An assistant's answer sits on the pasteboard, wrapped in one
// `markdown` fence. A reader pastes it (Rendered Mod+V opens a scratch document, J-05), unwraps the fence from the
// palette (E-06), ticks and unticks a task box (E-02), fixes a typo in place (E-04) and saves it (Mod+Shift+S).
// The saved bytes must be the pasted bytes with exactly those splices applied and nothing else changed, on a file
// with LF endings and on one with CRLF; and four Mod+Z take the document back to what was pasted. WebKit, the
// real app over the memory shell, real keys and clicks (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { assertMinimalDiff, canFail, crlf } from '../../../packages/core/src/operations/testing/test-kit.ts';
import { MUTATING_OPERATIONS } from '../../../packages/core/src/operations/index.ts';
import { MENU_ORDER } from '../src/selection/verbs.ts';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const FIXTURE = readFileSync(new URL('./fixtures/e-answer-fenced.md', import.meta.url), 'utf8');
assert.ok(!FIXTURE.includes('\r'), 'the fixture is stored with LF; the CRLF twin is made here');

const A = '/r/A.md';
const OUT = '/out/answer.md';
const TEXT = 'public.utf8-plain-text';
const enc = new TextEncoder();

/**
 * The four changes the criterion makes, found in `doc` (ASCII, so a UTF-16 offset is a byte offset), and the
 * bytes they must give. The fence is two spans, its opening and its closing line with their endings, so the
 * block's own content may not change under cover of the unwrap. Computed here from the fixture directly, not
 * by the app's code.
 */
function expectation(doc) {
  const lineAt = (needle, from = 0) => {
    const start = doc.indexOf(needle, from);
    assert.ok(start >= 0, `${needle} is in the fixture`);
    const eol = doc.indexOf('\n', start);
    return { start, end: eol + 1 };
  };
  const open = lineAt('````markdown');
  const close = lineAt('\n````', open.end);
  close.start += 1; // the line, not the ending before it
  close.end = doc.length;
  assert.equal(doc.slice(close.start).replace(/\r?\n$/, ''), '````', 'the closing fence is the last line');
  const tick = (needle, was, now) => {
    const at = doc.indexOf(needle);
    assert.ok(at >= 0 && doc.slice(at, at + 3) === was, `${needle} starts with ${was}`);
    return { start: at, end: at + 3, with: now };
  };
  const edits = [
    { ...open, with: '' },
    tick('[ ] Draft', '[ ]', '[x]'),
    tick('[x] Open', '[x]', '[ ]'),
    (() => {
      const at = doc.indexOf('tpyo');
      return { start: at, end: at + 4, with: 'typo' };
    })(),
    { ...close, with: '' },
  ];
  let expected = '';
  let cursor = 0;
  for (const e of edits) {
    expected += doc.slice(cursor, e.start) + e.with;
    cursor = e.end;
  }
  expected += doc.slice(cursor);
  return { expected, targets: edits.map(({ start, end }) => ({ start, end })) };
}

/** The page's helpers over the running app. */
function driver(page, mod) {
  const handle = (fn, arg) => page.evaluate(fn, arg);
  return {
    mod,
    /** Another app put these on the pasteboard: the memory shell's, which the paste command reads. */
    pasteboard: (items) =>
      handle((items) => {
        const bytes = items.map((i) => Object.fromEntries(Object.entries(i).map(([t, s]) => [t, new TextEncoder().encode(s)])));
        window.__marxyHandle.shell.setPasteboard(bytes);
      }, items),
    text: () => handle(() => new TextDecoder().decode(window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes)),
    snap: () =>
      handle(() => {
        const s = window.__marxyHandle.panes().panes[0].content.store().snapshot();
        return { path: s.path, dirty: s.dirty, canUndo: s.canUndo, canRedo: s.canRedo };
      }),
    /** Every write to a document of the reader's; Marxy's own state files live under /data. */
    docWrites: () =>
      handle(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !c.args[0].startsWith('/data/')).map((c) => [c.args[0], new TextDecoder().decode(c.args[1])])),
    until: (pred, arg) => page.waitForFunction(pred, arg),
    textBecomes: (needle) =>
      page.waitForFunction((n) => new TextDecoder().decode(window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes).includes(n), needle),
  };
}

/**
 * The criterion, once, on `doc` (the fixture with the file's line endings). `neutralise` serves the slice fold
 * (`foldSlice`, the splice of edit-in-place) in a version that normalises line endings, to show the flow can fail.
 */
async function runCriterion(doc, { neutralise = false } = {}) {
  const { expected, targets } = expectation(doc);
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    if (neutralise) {
      await page.route(/\/fold-slice\.ts(\?|$)/, (route) =>
        route.fulfill({
          contentType: 'text/javascript',
          body: `import { byteToUtf16, textOf } from '/@fs${new URL('../../../packages/core/src/buffer/buffer.ts', import.meta.url).pathname}';
export function foldSlice(buffer, slice, text) {
  const old = textOf(buffer, slice);
  if (old === text) return null;
  const replacement = new TextEncoder().encode(text.replace(/\\r\\n|\\r/g, '\\n'));
  return { range: slice, replacement, text: new TextDecoder().decode(replacement) };
}
`,
        }),
      );
    }
    await bootTwoPanes(page, { files: { [A]: '# Alpha\n\nalpha text\n' }, open: [A], guard: true });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const d = driver(page, mod);
    // The two-pane harness boots without the palette (main.ts mounts it): mount it the same way.
    await page.evaluate(async (path) => {
      const { mountPaletteFromHandle } = await import('/src/palette/view.ts');
      const handle = window.__marxyHandle;
      const palette = mountPaletteFromHandle(handle, { initialPath: path });
      handle.setPaletteSession(() => palette.session);
    }, A);

    // 1. Paste: another app puts the answer on the pasteboard, and Mod+V in Rendered opens it as a scratch.
    await d.pasteboard([{ [TEXT]: doc }]);
    await page.keyboard.press(`${mod}+v`);
    await d.until(() => window.__marxyHandle.panes().panes[0].path() === 'untitled');
    await page.waitForSelector('#doc pre');
    assert.equal(await d.text(), doc, 'the scratch holds exactly the pasted bytes');
    assert.deepEqual(await d.docWrites(), [], 'nothing is written until Save As');
    const pasted = await d.snap();
    assert.equal(pasted.canUndo, false);

    // 2. Click the fenced block and unwrap it from the palette.
    await page.locator('#doc pre').click();
    await d.until(() => window.__marxyHandle.selection.state().selection.node?.type === 'codeBlock');
    await page.keyboard.press(`${mod}+p`);
    await d.until(() => document.getElementById('marxy-palette')?.open === true);
    await page.keyboard.type('>unwrap markdown fence');
    await page.waitForSelector('#marxy-palette .marxy-palette-row[data-row-key="op.unwrap-markdown-fence"]');
    await page.keyboard.press('Enter');
    await d.until(() => document.getElementById('marxy-palette')?.open !== true);
    await d.until(() => !new TextDecoder().decode(window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes).includes('````'));
    // The heading, the list and the paragraph are top-level blocks now; only the JSON fence is still a code block.
    await d.until(() => document.querySelectorAll('#doc input[data-marxy-s]').length === 3 && document.querySelectorAll('#doc pre').length === 1);
    assert.equal((await d.text()).includes('````'), false, 'both fence lines are gone');

    // 3. Tick the first box, untick the last: two three-byte markers.
    // The box is disabled with `pointer-events: none` (render/tasks.ts): the click is a real press at its rectangle.
    const clickBox = async (n) => {
      const at = await page.evaluate((n) => {
        const box = document.querySelectorAll('#doc input[data-marxy-s]')[n];
        box.scrollIntoView({ block: 'center' });
        const r = box.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, n);
      await page.mouse.click(at.x, at.y);
    };
    await clickBox(0);
    await d.textBecomes('[x] Draft the notes');
    await clickBox(2);
    await d.textBecomes('[ ] Open the branch');

    // 4. Edit the typo paragraph in place: Mod+Enter, replace one word, Esc.
    await page.locator('#doc p', { hasText: 'Mind the' }).click();
    await d.until(() => window.__marxyHandle.selection.state().selection.node?.type === 'paragraph');
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForSelector('.marxy-block-editor .cm-content');
    await page.keyboard.press(mod === 'Meta' ? 'Meta+ArrowUp' : 'Control+Home');
    for (let i = 0; i < 'Mind the '.length; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 'tpyo'.length; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.type('typo');
    await page.keyboard.press('Escape');
    await d.until(() => document.querySelector('.marxy-block-editor') === null);
    await d.textBecomes('Mind the typo in this line');
    assert.deepEqual(await d.docWrites(), [], 'still nothing written: the reader has not saved');

    // 5. Save As, Mod+Shift+S, to a path in the memory shell.
    await page.evaluate((path) => window.__marxyHandle.shell.queueSaveDialog(path), OUT);
    await page.keyboard.press(`${mod}+Shift+S`);
    await d.until(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'writeFileAtomic' && c.args[0] === '/out/answer.md'));
    await d.until(() => window.__marxyHandle.panes().panes[0].content.store().snapshot().dirty === false);
    const writes = await d.docWrites();
    assert.deepEqual(writes.map(([path]) => path), [OUT], 'one write, to the path the reader chose');
    const savedBytes = await page.evaluate((path) => window.__marxyHandle.shell.peekFile(path).then((b) => [...b]), OUT);
    const saved = new TextDecoder().decode(Uint8Array.from(savedBytes));
    assert.equal(saved, writes[0][1], 'the write is what is on disk');
    assert.equal(await d.text(), saved, 'and what the buffer holds');

    // The saved bytes are the pasted bytes with the four splices applied and nothing else.
    assert.equal(saved, expected, 'saved bytes: exactly the four splices of the criterion');
    assertMinimalDiff(enc.encode(doc), { start: 0, end: enc.encode(doc).length }, saved, targets);
    if (doc.includes('\r\n')) assert.equal(/(?<!\r)\n|\r(?!\n)/.test(saved), false, 'saved bytes: every line ending is CRLF');
    else assert.equal(saved.includes('\r'), false, 'saved bytes: no CR in an LF file');

    // 6. Undo: four edits (unwrap, two ticks, the block edit) take the buffer back to what was pasted.
    for (let i = 0; i < 4; i++) await page.keyboard.press(`${mod}+z`);
    await d.until(() => !window.__marxyHandle.panes().panes[0].content.store().snapshot().canUndo);
    assert.equal(await d.text(), doc, 'four Mod+Z give the pasted bytes back');
    await page.keyboard.press(`${mod}+z`);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
    assert.equal(await d.text(), doc, 'a fifth Mod+Z has nothing left to undo');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-block-editor').length), 0, 'no editor at rest');
  } finally {
    await browser.close();
  }
}

test('the screen criterion on an LF file: paste, unwrap, tick, edit in place, save; only those bytes move', () => runCriterion(FIXTURE));

test('the screen criterion on a CRLF file: the same, and every ending in the saved file is CRLF', () => runCriterion(crlf(FIXTURE)));

test('the CRLF flow fails when edit in place normalises line endings (the criterion can fail)', async () => {
  await assert.rejects(
    runCriterion(crlf(FIXTURE), { neutralise: true }),
    (err) => err instanceof assert.AssertionError && /saved bytes/.test(err.message),
  );
});

test('the minimal-diff check rejects a saved file that changed a byte outside the four spans', () => {
  const { expected, targets } = expectation(crlf(FIXTURE));
  const bytes = enc.encode(crlf(FIXTURE));
  assertMinimalDiff(bytes, { start: 0, end: bytes.length }, expected, targets);
  canFail(() => assertMinimalDiff(bytes, { start: 0, end: bytes.length }, expected.replace('Release', 'release'), targets));
  canFail(() => assertMinimalDiff(bytes, { start: 0, end: bytes.length }, expected.replace('line,\r\nand', 'line,\nand'), targets));
});

// The verb menu's seven-row cap: the phase's operations rank below the copy verbs (E-18 step 3). The menu's order is
// `MENU_ORDER`, in the desktop app, so this check lives here and not in core's registry test.
const PHASE_E = [
  'bullets-from-glyphs', 'dedupe-lines', 'demote-heading', 'format-json', 'format-yaml', 'list-to-bullets',
  'list-to-numbers', 'promote-heading', 'renumber-list', 'sort-list-items', 'unwrap-markdown-fence',
];

test('every verb menu has at most seven rows, and Phase E operations rank below the copy verbs', () => {
  const registered = new Set(MUTATING_OPERATIONS.map((op) => op.id));
  for (const id of PHASE_E) assert.ok(registered.has(id), `${id} is a registered mutating operation`);
  const copyVerb = (id) => /^(selection\.copy|op\.copy-|op\.extract-)/.test(id);
  const paletteOnly = new Set(PHASE_E);
  for (const [kind, ids] of Object.entries(MENU_ORDER)) {
    console.log(`verb menu, ${kind}: ${ids.length} rows`);
    assert.ok(ids.length <= 7, `${kind}: ${ids.length} rows, the menu holds seven`);
    const lastCopy = ids.reduce((last, id, i) => (copyVerb(id) ? i : last), -1);
    for (const id of PHASE_E) {
      const at = ids.indexOf(`op.${id}`);
      if (at < 0) continue;
      paletteOnly.delete(id);
      assert.ok(at > lastCopy, `${kind}: op.${id} (row ${at + 1}) sits above a copy verb`);
    }
  }
  console.log(`Phase E operations with no verb-menu row (palette only): ${[...paletteOnly].join(', ')}`);
});
