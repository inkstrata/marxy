// J-05: Mod+V in Rendered opens the clipboard as Markdown in a new scratch document (E-13); the file on disk is
// untouched and Save As is the first write. Not bound in Source, the find field or the palette. A concealed item
// is refused before any read. WebKit, the real app over the memory shell, real keys (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const A = '/r/A.md';
const B = '/r/B.md';
const FILES = { [A]: '# Alpha\n\nalpha text\n', [B]: '# Bravo\n\nbravo text\n' };
const TEXT = 'public.utf8-plain-text';
const HTML = 'public.html';
const CONCEALED = 'org.nspasteboard.ConcealedType';
const TRANSIENT = 'org.nspasteboard.TransientType';

async function withApp(open, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 800 } });
    await bootTwoPanes(page, { files: FILES, open, guard: true });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const api = {
      mod,
      pasteboard: (...items) =>
        page.evaluate((items) => {
          const enc = new TextEncoder();
          window.__marxyHandle.shell.setPasteboard(items.map((i) => Object.fromEntries(Object.entries(i).map(([t, s]) => [t, enc.encode(s)]))));
          window.__marxyHandle.shell.calls.length = 0;
        }, items),
      paths: () => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path())),
      /** The bytes pane `slot`'s store holds, as text. */
      text: (slot = 0) =>
        page.evaluate((s) => new TextDecoder().decode(window.__marxyHandle.panes().panes[s].content.store().snapshot().buffer.bytes), slot),
      calls: (...methods) =>
        page.evaluate((m) => window.__marxyHandle.shell.calls.filter((c) => m.includes(c.method)).map((c) => c.method), methods),
      reads: () => page.evaluate(() => [...window.__marxyHandle.shell.pasteboardDataReads]),
      notices: () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent)),
      /** Every write the app made to a document: its own state files under /data are not. */
      docWrites: () => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && !c.args[0].startsWith('/data/')).map((c) => c.args[0])),
      converted: (payload) => page.evaluate(async (p) => (await import('/src/paste/read-clipboard.ts')).convertClipboard(p), payload),
      settle: () => page.evaluate(() => new Promise((r) => setTimeout(r, 250))),
      paste: () => page.keyboard.press(`${mod}+v`),
    };
    await fn(page, api);
  } finally {
    await browser.close();
  }
}

const SAMPLES = {
  html: { [HTML]: '<h1>Title</h1><p>a <b>b</b> and <a href="https://example.com/x">c</a></p><ul><li>one</li><li>two</li></ul>', [TEXT]: 'Title a b and c one two' },
  text: { [TEXT]: 'just some words\nover two lines' },
  json: { [TEXT]: '{"a":1,"b":[2,3]}' },
  markdown: { [TEXT]: '# Notes\n\n- a\n- b\n' },
  'html beside markdown text': { [HTML]: '<h1>Notes</h1><ul><li>a</li><li>b</li></ul>', [TEXT]: '# Notes\n\n- a\n- b\n' },
};

for (const [name, item] of Object.entries(SAMPLES)) {
  test(`Mod+V in Rendered with ${name} opens a scratch whose bytes are convertClipboard's, and writes nothing`, async () => {
    await withApp([A], async (page, s) => {
      const payload = { ...(item[HTML] === undefined ? {} : { html: item[HTML] }), ...(item[TEXT] === undefined ? {} : { text: item[TEXT] }) };
      const want = await s.converted(payload);
      assert.ok(want.markdown !== '');
      await s.pasteboard(item);
      await s.paste();
      await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === 'untitled');
      assert.equal(await s.text(), want.markdown, 'the scratch holds exactly what the converter made');
      assert.deepEqual(await s.docWrites(), [], 'nothing written: Save As is the first write');
      assert.equal(await page.evaluate((p) => window.__disk(p), A), FILES[A], 'the file on disk is untouched');
      assert.deepEqual(await s.reads(), [HTML, TEXT].filter((t) => t in item), 'html then text, once each, only what the item holds');
      const converted = (await s.notices()).filter((n) => n.startsWith('Pasted as Markdown'));
      assert.deepEqual(converted, want.kind === 'html' ? ['Pasted as Markdown (converted from HTML)'] : []);
    });
  });
}

test('Mod+V with nothing on the pasteboard opens nothing and says so', async () => {
  await withApp([A], async (page, s) => {
    await s.pasteboard({ [TEXT]: '  \n ' });
    await s.paste();
    await page.waitForFunction(() => document.body.textContent.includes('Nothing to paste'));
    // An empty paste is a Note that fades, never a sticky "Not done" (U-02.1).
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.marxy-notice')].map((n) => n.dataset.noticeKind)), ['info']);
    await page.waitForFunction(() => document.querySelector('.marxy-notice') === null, undefined, { timeout: 7000 });
    assert.deepEqual(await s.paths(), [A]);
    await s.pasteboard({});
    await s.paste();
    await s.settle();
    assert.deepEqual(await s.paths(), [A]);
  });
});

test('a concealed item: nothing is read, a notice names the refusal, no scratch opens', async () => {
  await withApp([A], async (page, s) => {
    await s.pasteboard({ [HTML]: '<h1>secret</h1>', [TEXT]: 'secret', [CONCEALED]: '' });
    await s.paste();
    await page.waitForFunction(() => document.body.textContent.includes('concealed'));
    assert.deepEqual(await s.reads(), [], 'pasteboardDataReads is empty');
    assert.deepEqual(await s.calls('clipboardRead'), []);
    assert.deepEqual(await s.paths(), [A], 'the scratch count is unchanged');
    assert.equal(await s.text(), FILES[A]);
  });
});

test('a TransientType item pastes as any other', async () => {
  await withApp([A], async (page, s) => {
    await s.pasteboard({ [TEXT]: 'transient words', [TRANSIENT]: '' });
    await s.paste();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === 'untitled');
    assert.equal(await s.text(), 'transient words');
  });
});

test('a rejected read is a refusal with its message: no scratch opens', async () => {
  await withApp([A], async (page, s) => {
    await s.pasteboard({ [TEXT]: 'words' });
    await page.evaluate(() => {
      window.__marxyHandle.shell.clipboardRead = async () => {
        throw Object.assign(new Error('text is over the 16 MB clipboard cap'), { code: 'invalid' });
      };
    });
    await s.paste();
    await page.waitForFunction(() => document.body.textContent.includes('16 MB clipboard cap'));
    assert.deepEqual(await s.paths(), [A]);
  });
});

test('hostile HTML in Rendered opens a scratch of only the golden text: no request, no script', async () => {
  await withApp([A], async (page, s) => {
    const html = '<div><h2 onclick="steal()">Shipping</h2><script>window.__pwned=1</script><img src="https://track.example/p.gif" width=1 height=1><p>Read <a href="javascript:window.__pwned=1">this</a></p><iframe src="https://evil.example/f"></iframe></div>';
    const requested = [];
    await page.route((url) => url.hostname.endsWith('.example'), (route) => { requested.push(route.request().url()); return route.abort(); });
    const want = await s.converted({ html, text: 'Shipping Read this' });
    await s.pasteboard({ [HTML]: html, [TEXT]: 'Shipping Read this' });
    await s.paste();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === 'untitled');
    assert.equal(await s.text(), want.markdown);
    await s.settle();
    assert.deepEqual(requested, []);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc script, #doc iframe, #doc img').length), 0);
  });
});

test('Mod+V is not bound over the open palette or in the find field: nothing is read, nothing opens', async () => {
  await withApp([A], async (page, s) => {
    await s.pasteboard(SAMPLES.text);
    // The two-pane harness boots the app without its palette (main.ts mounts it): mount it the same way.
    await page.evaluate(async (path) => {
      const { mountPaletteFromHandle } = await import('/src/palette/view.ts');
      const handle = window.__marxyHandle;
      const palette = mountPaletteFromHandle(handle, { initialPath: path });
      handle.setPaletteSession(() => palette.session);
    }, A);
    await page.keyboard.press(`${s.mod}+p`);
    await page.waitForFunction(() => document.getElementById('marxy-palette')?.open === true);
    await s.paste();
    await s.settle();
    assert.deepEqual(await s.calls('clipboardTypes', 'clipboardRead'), [], 'the palette keeps its paste');
    assert.deepEqual(await s.paths(), [A]);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('marxy-palette')?.open !== true);
    await page.keyboard.press(`${s.mod}+f`);
    await page.waitForSelector('.marxy-find-input');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('marxy-find-input')), true);
    await s.paste();
    await s.settle();
    assert.deepEqual(await s.calls('clipboardTypes', 'clipboardRead'), [], 'the find field keeps its paste');
    assert.deepEqual(await s.paths(), [A]);
  });
});

test('Mod+V in Source is the editor\'s: the registry does not open a scratch, and a plain paste does not ask the pasteboard', async () => {
  await withApp([A], async (page, s) => {
    await page.keyboard.press(`${s.mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.click('.cm-content');
    await s.pasteboard(SAMPLES.text);
    await s.paste();
    await s.settle();
    assert.deepEqual(await s.paths(), [A]);
    assert.deepEqual(await s.calls('clipboardTypes', 'clipboardRead'), []);
  });
});

test('nothing reads the pasteboard at boot, on focus, after a copy or a mode switch', async () => {
  await withApp([A], async (page, s) => {
    const n = () => s.calls('clipboardTypes', 'clipboardRead').then((c) => c.length);
    assert.equal(await n(), 0, 'at boot');
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.evaluate(() => document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true })));
    await page.keyboard.press(`${s.mod}+e`);
    await page.keyboard.press(`${s.mod}+e`);
    await s.settle();
    assert.equal(await n(), 0);
  });
});

test('with two panes the scratch opens in the other pane and the focused one keeps its document', async () => {
  await withApp([A, B], async (page, s) => {
    const focusedSlot = await page.evaluate(() => window.__marxyHandle.panes().panes.findIndex((p) => p === window.__marxyHandle.panes().focused));
    await s.pasteboard(SAMPLES.text);
    await s.paste();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.some((p) => p.path() === 'untitled'));
    const paths = await s.paths();
    assert.equal(paths[focusedSlot], focusedSlot === 0 ? A : B, 'the pane the reader pasted in is unchanged');
    assert.equal(paths[1 - focusedSlot], 'untitled', 'the other pane now shows the scratch (the card\'s risk 2)');
  });
});

test('with unsaved changes in the pane, a prompt stands before they are replaced: nothing is lost or written until the reader answers', async () => {
  await withApp([A], async (page, s) => {
    await page.keyboard.press(`${s.mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.click('.cm-content');
    await page.keyboard.type('EDIT');
    await page.keyboard.press(`${s.mod}+e`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    const dirty = await s.text();
    assert.match(dirty, /EDIT/);
    await s.pasteboard(SAMPLES.text);
    await s.paste();
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice button')].some((b) => b.textContent === 'Open without saving'));
    assert.deepEqual(await s.paths(), [A], 'the pane still shows the document');
    assert.equal(await s.text(), dirty, 'with its unsaved text');
    assert.deepEqual(await s.docWrites(), []);
    assert.equal(await page.evaluate((p) => window.__disk(p), A), FILES[A]);
    await page.evaluate(() => [...document.querySelectorAll('.marxy-notice button')].find((b) => b.textContent === 'Open without saving').click());
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === 'untitled');
    assert.equal(await s.text(), SAMPLES.text[TEXT]);
    assert.deepEqual(await s.docWrites(), [], 'discarding writes nothing either');
  });
});

async function dirtyViaSource(page, s) {
  await page.keyboard.press(`${s.mod}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
  await page.click('.cm-content');
  await page.keyboard.type('EDIT');
  await page.keyboard.press(`${s.mod}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
}
const pasteNotices = async (s) => (await s.notices()).filter((n) => n.startsWith('Opened as a new document') || n.startsWith('Pasted as Markdown'));
const clickNoticeButton = (page, label) =>
  page.evaluate((l) => [...document.querySelectorAll('.marxy-notice button')].find((b) => b.textContent === l).click(), label);

const promptStands = (page) => page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice button')].some((b) => b.textContent === 'Open without saving'));

test('no scratch notice while the unsaved-edits prompt stands, and none after Dismiss', async () => {
  await withApp([A], async (page, s) => {
    await dirtyViaSource(page, s);
    await s.pasteboard(SAMPLES.html);
    await s.paste();
    await promptStands(page);
    await s.settle();
    assert.deepEqual(await pasteNotices(s), [], 'nothing claims a new document while the prompt stands');
    await clickNoticeButton(page, 'Dismiss');
    await s.settle();
    assert.deepEqual(await pasteNotices(s), [], 'nothing claims a new document after Dismiss');
    assert.deepEqual(await s.paths(), [A]);
  });
});

test('both scratch notices come once Open without saving is chosen', async () => {
  await withApp([A], async (page, s) => {
    await dirtyViaSource(page, s);
    await s.pasteboard(SAMPLES.html);
    await s.paste();
    await promptStands(page);
    await clickNoticeButton(page, 'Open without saving');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === 'untitled');
    await page.waitForFunction(() => document.body.textContent.includes('Opened as a new document'));
    assert.deepEqual(await pasteNotices(s), ['Opened as a new document (not saved)', 'Pasted as Markdown (converted from HTML)']);
  });
});

test('a leading U+FEFF in a Rendered paste is the reader\'s text: it is kept as that character, never read as the file\'s BOM', async () => {
  await withApp([A], async (page, s) => {
    await s.pasteboard({ [TEXT]: '﻿hello\n' });
    await s.paste();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].path() === 'untitled');
    const state = await page.evaluate(() => {
      const b = window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer;
      return { bom: b.bom, bytes: [...b.bytes] };
    });
        assert.deepEqual(state.bytes, [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, ...Buffer.from('hello\n')], 'a file BOM, then the pasted U+FEFF as a character');
    assert.equal(state.bom, true, 'behind a file BOM written for it, so the character is not taken as the BOM');
    await page.waitForFunction(() => document.body.textContent.includes('kept as a character'));
  });
});
