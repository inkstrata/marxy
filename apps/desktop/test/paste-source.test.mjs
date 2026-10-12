// J-05: paste in the Source editor. HTML on the pasteboard becomes Markdown at the caret (one transaction, one
// undo step, the buffer's own line break); a paste with no HTML is the editor's own; a concealed item is
// refused before any read; Mod+Alt+Shift+V pastes the plain text. WebKit, the real app over the memory shell
// (test/support/two-pane.mjs); the `paste` event is dispatched on the editor with a DataTransfer, as a paste is.
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness, harnessBase } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const fixtures = join(fileURLToPath(new URL('..', import.meta.url)), 'test/fixtures/paste');
const pairs = readdirSync(fixtures).filter((f) => f.endsWith('.html')).sort().map((f) => ({
  name: f.slice(0, -5),
  html: readFileSync(join(fixtures, f), 'utf8'),
  md: readFileSync(join(fixtures, `${f.slice(0, -5)}.md`), 'utf8'),
}));

const DOC = '/r/A.md';
const TEXT = 'public.utf8-plain-text';
const HTML = 'public.html';
const CONCEALED = 'org.nspasteboard.ConcealedType';
const TRANSIENT = 'org.nspasteboard.TransientType';

/** A booted app on `text` at DOC with the Source editor showing; `fn(page, api)` runs, the browser closes after. */
async function withSource(text, fn, { extraFiles = {} } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await bootTwoPanes(page, { files: { [DOC]: text, ...extraFiles }, open: [DOC], guard: true });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.waitForSelector('.cm-content');
    const api = {
      mod,
      /** Puts one item on the fake pasteboard: `{ type: text }`. */
      pasteboard: (...items) =>
        page.evaluate((items) => {
          const enc = new TextEncoder();
          window.__marxyHandle.shell.setPasteboard(items.map((i) => Object.fromEntries(Object.entries(i).map(([t, s]) => [t, enc.encode(s)]))));
          window.__marxyHandle.shell.calls.length = 0;
        }, items),
      /** Dispatches a `paste` event on the editor carrying `data` ({ 'text/html': …, 'text/plain': … }); resolves the event's `defaultPrevented`. */
      paste: (data) =>
        page.evaluate(async (data) => {
          const { activeSourceEditor } = await import('/src/source/editor.ts');
          const view = activeSourceEditor().view;
          view.focus();
          const dt = new DataTransfer();
          for (const [type, value] of Object.entries(data)) dt.setData(type, value);
          const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
          view.contentDOM.dispatchEvent(event);
          return event.defaultPrevented;
        }, data),
      settle: () => page.evaluate(() => new Promise((r) => setTimeout(r, 200))),
      doc: () =>
        page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText()),
      select: (...ranges) =>
        page.evaluate(async (ranges) => {
          const { activeSourceEditor } = await import('/src/source/editor.ts');
          const view = activeSourceEditor().view;
          const Selection = view.state.selection.constructor;
          view.dispatch({ selection: Selection.create(ranges.map(([a, b]) => Selection.range(a, b ?? a))) });
          view.focus();
        }, ranges),
      /** How many Mod+Z presses change the text: the history's depth. Undoes everything it counts. */
      undoSteps: async () => {
        let steps = 0;
        for (let i = 0; i < 8; i++) {
          const before = await api.doc();
          await page.keyboard.press(`${api.mod}+z`);
          if ((await api.doc()) === before) break;
          steps += 1;
        }
        return steps;
      },
      store: () => page.evaluate(() => [...window.__marxyHandle.panes().panes[0].view.store().snapshot().buffer.bytes]),
      calls: (...methods) =>
        page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => m.includes(c.method)).map((c) => c.method), methods),
      /** Writes to a document: the app's own state files under /data (positions, layout) are not. */
      docWrites: () => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !c.args[0].startsWith('/data/')).map((c) => c.args[0])),
      reads: () => page.evaluate(() => [...window.__marxyHandle.shell.pasteboardDataReads]),
      notices: () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent)),
      panePaths: () => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path())),
      /** Saves with Mod+S and returns the bytes the app wrote to DOC. */
      save: async () => {
        await page.evaluate(() => { window.__appWrites.length = 0; });
        await page.keyboard.press(`${mod}+s`);
        await page.waitForFunction((p) => window.__appWrites.some((w) => w.path === p), DOC, { timeout: 5000 }).catch(() => {});
        // The bytes themselves: `__disk` decodes to text, which would drop a BOM.
        return page.evaluate((p) => window.__marxyHandle.shell.peekFile(p).then((b) => [...b]), DOC);
      },
    };
    await fn(page, api);
  } finally {
    await browser.close();
  }
}

const bytes = (s) => [...new TextEncoder().encode(s)];
const html = (s) => ({ [HTML]: s, [TEXT]: 'copied text' });

for (const pair of pairs) {
  test(`golden pair ${pair.name}: Mod+V with HTML puts the Markdown at the caret, and one undo restores the buffer's bytes`, async () => {
    await withSource('XY\n', async (page, s) => {
      await s.pasteboard({ [HTML]: pair.html, [TEXT]: 'copied text' });
      await s.select([1]);
      const taken = await s.paste({ 'text/html': pair.html, 'text/plain': 'copied text' });
      assert.equal(taken, true, 'the event is taken');
      await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().length > 3);
      assert.equal(await s.doc(), `X${pair.md}Y\n`);
      await page.keyboard.press(`${s.mod}+z`);
      assert.equal(await s.doc(), 'XY\n', 'one undo brings back the buffer');
      assert.equal(await s.undoSteps(), 0, 'and that was the only step');
      assert.deepEqual(await s.store(), bytes('XY\n'), 'the store never changed');
      assert.deepEqual(await s.docWrites(), []);
      assert.deepEqual(await s.reads(), [HTML, TEXT], 'read once, the two types, after the paste');
    });
  });
}

test('the notice says once that the paste was converted', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard(html('<h1>Title</h1><p>a <b>b</b></p>'));
    await s.select([1]);
    await s.paste({ 'text/html': '<h1>Title</h1>' });
    await page.waitForFunction(() => document.body.textContent.includes('Pasted as Markdown'));
    assert.equal(await s.doc(), 'X# Title\n\na **b**\nY\n');
    assert.deepEqual((await s.notices()).filter((n) => n.startsWith('Pasted')), ['Pasted as Markdown (converted from HTML)']);
  });
});

test('a CRLF buffer: every line break of the insert is CRLF and no bare LF is in the saved bytes', async () => {
  const doc = 'one\r\ntwo\r\n';
  await withSource(doc, async (page, s) => {
    await s.pasteboard(html('<h1>T</h1><ul><li>a</li><li>b</li></ul>'));
    await s.select([4]);
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('# T'));
    const want = 'one\r\n# T\r\n\r\n- a\r\n- b\r\ntwo\r\n';
    assert.equal(await s.doc(), want);
    const saved = await s.save();
    assert.deepEqual(saved, bytes(want));
    assert.equal(saved.filter((b, i) => b === 0x0a && saved[i - 1] !== 0x0d).length, 0, 'no bare LF');
    await page.keyboard.press(`${s.mod}+z`);
    assert.equal(await s.doc(), doc);
  });
});

test('an LF buffer gets LF; a mixed one gets LF and its own endings are untouched', async () => {
  await withSource('one\ntwo\n', async (page, s) => {
    await s.pasteboard(html('<h1>T</h1><p>p</p>'));
    await s.select([4]);
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('# T'));
    assert.deepEqual(await s.save(), bytes('one\n# T\n\np\ntwo\n'));
  });
  const mixed = 'a\r\nb\nc\rd\n';
  await withSource(mixed, async (page, s) => {
    await s.pasteboard(html('<h1>T</h1><p>p</p>'));
    await s.select([3]);
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('# T'));
    assert.deepEqual(await s.save(), bytes('a\r\n# T\n\np\nb\nc\rd\n'), 'LF in, the existing CRLF, CR and LF endings as they were');
  });
});

test('a BOM buffer saves with its one BOM, and an insert holding U+FEFF adds none', async () => {
  await withSource('\uFEFFone\n', async (page, s) => {
    await s.pasteboard(html('<p>\uFEFFhello \uFEFFworld</p>'));
    await s.select([4]);
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('hello'));
    assert.ok(!(await s.doc()).includes('\uFEFF'), 'the editor holds none');
    const saved = await s.save();
    assert.deepEqual(saved, bytes('\uFEFFone\nhello world\n'));
    const boms = saved.filter((b, i) => b === 0xef && saved[i + 1] === 0xbb && saved[i + 2] === 0xbf).length;
    assert.equal(boms, 1, 'the file\'s own BOM and no other');
  });
});

test('a concealed item: nothing is read, a notice names the refusal, the buffer and the panes are unchanged', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard({ [HTML]: '<h1>secret</h1>', [TEXT]: 'secret', [CONCEALED]: '' });
    const paths = await s.panePaths();
    await s.select([1]);
    await s.paste({ 'text/html': '<h1>secret</h1>' });
    await s.settle();
    assert.deepEqual(await s.reads(), [], 'pasteboardDataReads is empty');
    assert.deepEqual(await s.calls('clipboardRead'), [], 'no read was even attempted');
    assert.equal(await s.doc(), 'XY\n');
    assert.deepEqual(await s.panePaths(), paths);
    assert.equal(await s.undoSteps(), 0, 'no history entry');
    const said = (await s.notices()).join('|');
    assert.match(said, /concealed/);
    // Plain-text paste of a concealed item is refused the same way.
    await page.keyboard.press(`${s.mod}+Alt+Shift+KeyV`);
    await s.settle();
    assert.deepEqual(await s.reads(), []);
    assert.equal(await s.doc(), 'XY\n');
  });
});

test('a TransientType item pastes as any other', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard({ [HTML]: '<h1>T</h1>', [TEXT]: 'T', [TRANSIENT]: '' });
    await s.select([1]);
    await s.paste({ 'text/html': '<h1>T</h1>' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('# T'));
    assert.equal(await s.doc(), 'X# T\nY\n');
  });
});

test('a rejected read refuses with its own message and inserts nothing', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard(html('<h1>T</h1>'));
    await page.evaluate(() => {
      window.__marxyHandle.shell.clipboardRead = async () => {
        throw Object.assign(new Error('the clipboard is not available right now'), { code: 'permission' });
      };
    });
    await s.select([1]);
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(() => document.body.textContent.includes('not available right now'));
    assert.equal(await s.doc(), 'XY\n');
    assert.equal(await s.undoSteps(), 0, 'no history entry');
  });
});

test('hostile payloads pasted into Source give only the golden text: no request, no script, no change outside the editor', async () => {
  const hostile = [
    pairs.find((p) => p.name === 'hostile-page').html,
    '<img src=x onerror="window.__pwned=1"><p>one</p>',
    '<p><img src="https://t.example/p.gif" width=1 height=1></p><p>two</p>',
    '<a href="javascript:window.__pwned=1">click</a><p>three</p>',
    '<svg><script>window.__pwned=1</script></svg><p>four</p>',
    '<style>p{background:url(https://e.example/x)}</style><p>five</p>',
    '<p>x</p><iframe srcdoc="<script>window.__pwned=1</script>"></iframe><p>six</p>',
    '<script>window.__pwned=1</script><p>seven</p>',
  ];
  await withSource('XY\n', async (page, s) => {
    const base = await harnessBase();
    const requested = [];
    await page.route((url) => !url.href.startsWith(base), (route) => { requested.push(route.request().url()); return route.abort(); });
    const outside = () =>
      page.evaluate(() => {
        const copy = document.body.cloneNode(true);
        // The editor (where the text goes) and the notice regions (where it is said) are the two places a paste may change.
        copy.querySelectorAll('.cm-editor, [role="status"]').forEach((n) => n.remove());
        return copy.outerHTML + document.head.innerHTML;
      });
    const before = await outside();
    const convertClipboard = (h) => page.evaluate(async (h) => (await import('/src/paste/read-clipboard.ts')).convertClipboard({ html: h }), h);
    for (const h of hostile) {
      const golden = (await convertClipboard(h)).markdown;
      await s.pasteboard({ [HTML]: h, [TEXT]: 'copied text' });
      await s.select([0, (await s.doc()).length]);
      await s.paste({ 'text/html': h });
      await page.waitForFunction(async (g) => (await import('/src/source/editor.ts')).activeSourceEditor().docText() === g, golden);
      assert.equal(await s.doc(), golden);
      for (const bad of ['<script', 'javascript:', 'onerror', 'e.example', 'evil.example'])
        assert.ok(!golden.includes(bad), `${bad} in ${golden}`);
    }
    await s.settle();
    assert.deepEqual(requested, [], 'the page made no request');
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'no script ran');
    assert.equal(await outside(), before, 'the page outside the editor is byte-identical');
    assert.deepEqual(await s.docWrites(), []);
  });
});

test('plain text only: the editor\'s own paste inserts it, and the pasteboard is not asked', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard({ [TEXT]: 'one\ntwo' });
    await s.select([1]);
    const taken = await s.paste({ 'text/plain': 'one\ntwo' });
    assert.equal(taken, true, 'CodeMirror\'s own handler took it');
    assert.equal(await s.doc(), 'Xone\ntwoY\n');
    assert.deepEqual(await s.calls('clipboardTypes', 'clipboardRead'), []);
    assert.deepEqual(await s.notices().then((n) => n.filter((t) => t.startsWith('Pasted'))), []);
  });
});

test('HTML that is also Markdown text: the clipboard\'s own text goes in, not a conversion of the rendering', async () => {
  await withSource('XY\n', async (page, s) => {
    const md = '# Title\n\n- a\n- b\n';
    await s.pasteboard({ [HTML]: '<h1>Title</h1><ul><li>a</li><li>b</li></ul>', [TEXT]: md });
    await s.select([1]);
    await s.paste({ 'text/html': '<h1>Title</h1>' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('Title'));
    assert.equal(await s.doc(), `X${md}Y\n`);
    assert.equal((await s.notices()).filter((t) => t.startsWith('Pasted')).length, 0, 'not a conversion, so not announced');
  });
});

test('JSON text beside HTML goes in as typed: no fence is added to a Source buffer', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard({ [HTML]: '<span>x</span>', [TEXT]: '{"a":1}' });
    await s.select([1]);
    await s.paste({ 'text/html': '<span>x</span>' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('"a"'));
    assert.equal(await s.doc(), 'X{"a":1}Y\n');
  });
});

test('HTML with no text and nothing readable inserts nothing and says so', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard({ [HTML]: '<div><script>1</script></div>' });
    await s.select([1]);
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(() => document.body.textContent.includes('Nothing to paste'));
    // An empty paste is a Note that fades, never a sticky "Not done" (U-02.1).
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map((n) => n.dataset.noticeKind)), ['info']);
    await page.waitForFunction(() => document.querySelector('.marxy-notice') === null, undefined, { timeout: 7000 });
    assert.equal(await s.doc(), 'XY\n');
    assert.equal(await s.undoSteps(), 0, 'no history entry');
  });
});

test('several selections: the whole Markdown goes into every range, as one undo step', async () => {
  await withSource('a b c\n', async (page, s) => {
    await s.pasteboard(html('<h1>T</h1><p>p</p>'));
    await s.select([1], [3], [5, 5]);
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('# T'));
    const md = '# T\n\np\n';
    assert.equal(await s.doc(), `a${md} b${md} c${md}\n`);
    await page.keyboard.press(`${s.mod}+z`);
    assert.equal(await s.doc(), 'a b c\n', 'one undo restores every range');
    assert.equal(await s.undoSteps(), 0);
  });
});

test('a paste over a selection replaces it, and one undo brings it back', async () => {
  await withSource('keep SELECTED keep\n', async (page, s) => {
    await s.pasteboard(html('<p>new</p>'));
    await s.select([5, 13]);
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('new'));
    assert.equal(await s.doc(), 'keep new\n keep\n');
    await page.keyboard.press(`${s.mod}+z`);
    assert.equal(await s.doc(), 'keep SELECTED keep\n');
  });
});

test('a paste is one undo step on its own, apart from the typing before and after it', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard(html('<p>new</p>'));
    await s.select([1]);
    await page.keyboard.type('a');
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('new'));
    await page.keyboard.type('b');
    assert.equal(await s.doc(), 'Xanew\nbY\n');
    await page.keyboard.press(`${s.mod}+z`);
    assert.equal(await s.doc(), 'Xanew\nY\n', 'the typing after');
    await page.keyboard.press(`${s.mod}+z`);
    assert.equal(await s.doc(), 'XaY\n', 'the paste, whole');
    assert.equal(await s.undoSteps(), 1, 'and the typing before');
  });
});

test('the document changing while the pasteboard is read: nothing is inserted and a notice says so', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard(html('<p>new</p>'));
    await page.evaluate(() => {
      const shell = window.__marxyHandle.shell;
      const read = shell.clipboardRead.bind(shell);
      shell.clipboardRead = async (type) => {
        await new Promise((r) => setTimeout(r, 150));
        return read(type);
      };
    });
    await s.select([1]);
    await s.paste({ 'text/html': 'x' });
    await page.keyboard.type('Q');
    await page.waitForFunction(() => document.body.textContent.includes('the document changed while'));
    assert.equal(await s.doc(), 'XQY\n', 'only the typing');
    assert.equal(await s.undoSteps(), 1, 'the typing, and no paste');
  });
});

test('a paste into a file that changed on disk goes into the reloaded text, and the app writes nothing', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard(html('<p>new</p>'));
    await page.evaluate(() => window.__outside('/r/A.md', 'ZW\n'));
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText() === 'ZW\n');
    await s.select([1]);
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('new'));
    assert.equal(await s.doc(), 'Znew\nW\n');
    assert.deepEqual(await page.evaluate(() => window.__appWrites.filter((w) => w.path === '/r/A.md')), [], 'nothing was written');
    assert.equal(await page.evaluate(() => window.__disk('/r/A.md')), 'ZW\n', 'disk is what the other program wrote');
  });
});

test('a paste while a conflict is pending lands in the editor like typing, and nothing is written over the other program\'s text', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.select([1]);
    await page.keyboard.type('mine');
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].content.foldSource());
    await page.evaluate(() => window.__outside('/r/A.md', 'theirs\n'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].view.store().conflict() !== null);
    await s.pasteboard(html('<p>pasted</p>'));
    await s.select([0]);
    await s.paste({ 'text/html': 'x' });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('pasted'));
    await page.keyboard.press(`${s.mod}+s`);
    await s.settle();
    assert.deepEqual(await page.evaluate(() => window.__appWrites.filter((w) => w.path === '/r/A.md')), [], 'the save is refused while the conflict is pending');
    assert.equal(await page.evaluate(() => window.__disk('/r/A.md')), 'theirs\n');
    assert.match(await s.doc(), /pasted/);
  });
});

test('Mod+Alt+Shift+V inserts the plain text, byte for byte, once, with no conversion notice', async () => {
  await withSource('XY\n', async (page, s) => {
    const text = 'plain  text\twith\ttabs\nand a second line';
    await s.pasteboard({ [HTML]: '<h1>Heading</h1>', [TEXT]: text });
    await s.select([1]);
    await page.keyboard.press(`${s.mod}+Alt+Shift+KeyV`);
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('plain'));
    await s.settle();
    assert.equal(await s.doc(), `X${text}Y\n`, 'once, exactly the text');
    assert.deepEqual(await s.reads(), [TEXT], 'the text only');
    assert.deepEqual((await s.notices()).filter((t) => t.startsWith('Pasted')), [], 'no notice of a conversion');
    await page.keyboard.press(`${s.mod}+z`);
    assert.equal(await s.doc(), 'XY\n');
    assert.equal(await s.undoSteps(), 0, 'one step');
  });
});

test('Mod+Alt+Shift+V writes the plain text\'s line breaks as the buffer\'s own', async () => {
  await withSource('one\r\ntwo\r\n', async (page, s) => {
    await s.pasteboard({ [TEXT]: 'a\nb\r\nc' });
    await s.select([4]);
    await page.keyboard.press(`${s.mod}+Alt+Shift+KeyV`);
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('a'));
    assert.deepEqual(await s.save(), bytes('one\r\na\r\nb\r\nc' + 'two\r\n'));
  });
});

test('Mod+Alt+Shift+V is not the find field\'s: in the find panel it reads nothing and inserts nothing', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard({ [TEXT]: 'plain' });
    await page.keyboard.press(`${s.mod}+f`);
    await page.waitForSelector('.cm-panels input');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.cm-panels') !== null), true);
    await page.keyboard.press(`${s.mod}+Alt+Shift+KeyV`);
    await s.settle();
    assert.deepEqual(await s.calls('clipboardTypes', 'clipboardRead'), []);
    assert.equal(await s.doc(), 'XY\n');
  });
});

test('nothing reads the pasteboard at boot, on focus, on a mode switch or after a copy', async () => {
  await withSource('XY\n', async (page, s) => {
    const all = () => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardTypes' || c.method === 'clipboardRead').length);
    assert.equal(await all(), 0, 'after boot and the switch to Source');
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.keyboard.press(`${s.mod}+e`);
    await page.keyboard.press(`${s.mod}+e`);
    await page.evaluate(() => document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true })));
    await page.evaluate(() => window.__marxyHandle.shell.clipboardWriteItem([{ type: 'public.utf8-plain-text', bytes: new TextEncoder().encode('x') }]));
    await s.settle();
    assert.equal(await all(), 0);
  });
});

test('source.paste-plain is a palette command too: run from the registry it inserts the text once, and is not offered in Rendered', async () => {
  await withSource('XY\n', async (page, s) => {
    await s.pasteboard({ [HTML]: '<h1>Heading</h1>', [TEXT]: 'from the palette' });
    await s.select([1]);
    await page.evaluate(async () => {
      const { commands } = await import('/src/commands/index.ts');
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const cmd = commands().find((c) => c.id === 'source.paste-plain');
      if (!cmd.when(buildAppContext())) throw new Error('not offered in Source');
      await cmd.run(buildAppContext());
    });
    await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('palette'));
    assert.equal(await s.doc(), 'Xfrom the paletteY\n');
    await page.keyboard.press(`${s.mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    assert.equal(await page.evaluate(async () => {
      const { commands } = await import('/src/commands/index.ts');
      const { buildAppContext } = await import('/src/selection/bind.ts');
      return commands().find((c) => c.id === 'source.paste-plain').when(buildAppContext());
    }), false);
  });
});

test('a shell with no native pasteboard (unsupported): an HTML + text paste in Source inserts the text as before, one undo restores, and nothing is said', async () => {
  await withSource('XY\n', async (page, s) => {
    await page.evaluate(() => {
      const refuse = async () => { throw Object.assign(new Error('no pasteboard here'), { code: 'unsupported' }); };
      window.__marxyHandle.shell.clipboardTypes = refuse;
      window.__marxyHandle.shell.clipboardRead = refuse;
    });
    for (const round of [1, 2]) {
      await s.select([1]);
      await s.paste({ 'text/html': '<h1>Heading</h1>', 'text/plain': 'plain words' });
      await page.waitForFunction(async () => (await import('/src/source/editor.ts')).activeSourceEditor().docText().includes('plain'));
      assert.equal(await s.doc(), 'Xplain wordsY\n', `round ${round}: the text, as the editor pastes it`);
      assert.deepEqual(await s.notices(), [], 'no notice');
      await page.keyboard.press(`${s.mod}+z`);
      assert.equal(await s.doc(), 'XY\n', 'one undo restores the buffer');
      assert.equal(await s.undoSteps(), 0);
    }
    assert.deepEqual(await s.store(), bytes('XY\n'));
  });
});
