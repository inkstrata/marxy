// Save and trust defects found after explicit save (MARXY-49) and trust grants (MARXY-44) landed (MARXY-337).
// Nothing here sets window.__marxyOrigBytes: that override masks exactly the dirty-state bugs under test.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { register } from 'node:module';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

register('./support/tauri-stub-hooks.mjs', import.meta.url);
globalThis.navigator ??= { platform: 'MacIntel' };
const { fs, hooks } = await import('./support/tauri-core-stub.mjs');
const { shell } = await import('../src/shell/tauri.ts');
const { createTrustStore, emptyTrustEnvelope, TRUST_FILE_VERSION } = await import('../src/trust/trust.ts');
// A namespace, so the tests still load (and fail one by one) against a build that lacks a helper.
const trustCopy = await import('../src/notices/trust-copy.ts');
const { blockedTrustNoticeText, displayHost } = trustCopy;
const grantableBlockedImages = (...args) => trustCopy.grantableBlockedImages(...args);
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = new URL('..', import.meta.url).pathname;
const outDir = mkdtempSync(join(tmpdir(), 'marxy-r4-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: desktopRoot, logLevel: 'silent', build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: { app: join(desktopRoot, 'app.html'), paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
    },
  });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const b64 = (s) => Buffer.from(s).toString('base64');

async function open(browser, files, argv) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__h = handle;
    window.__sh = handle.shell;
  }, { files, argv });
  await page.waitForTimeout(300);
  return page;
}

/** The save tests boot the way save.test.mjs does: the palette harness carries the save commands. */
async function openForSave(browser, files, argv) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const boot = await window.marxyPaletteBoot.start(files, argv, []);
    window.__h = boot.handle;
    window.__sh = boot.handle.shell;
  }, { files, argv });
  await page.waitForFunction(() => window.__marxyTasksReady === true && typeof window.marxyHarnessSave === 'function');
  return page;
}

const notices = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#marxy-notices .marxy-notice-text')].map((n) => n.textContent ?? ''));
const lastTitle = (page) => page.evaluate(() => __sh.calls.filter((c) => c.method === 'setTitle').at(-1)?.args[0]);
const buffer = (page) => page.evaluate(() => new TextDecoder().decode(__h.openDocument().buffer.bytes));
const clickCheckbox = (page, i) =>
  page.evaluate((i) =>
    document.querySelectorAll('#doc input[type=checkbox]')[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), i);
const clickAction = (page, re) =>
  page.evaluate((src) => {
    const button = [...document.querySelectorAll('button.marxy-notice-action')].find((b) => new RegExp(src).test(b.textContent ?? ''));
    button.click();
  }, re.source);

// ---- B9: an edit made while a save is in flight ------------------------------------------------

test('B9: an edit made while a save is in flight is kept, and the document stays dirty', async () => {
  const browser = await launchWebkit();
  try {
    const page = await openForSave(browser, { '/d/a.md': b64('# T\n\n- [ ] one\n- [ ] two\n') }, ['/d/a.md']);
    await clickCheckbox(page, 0);
    await page.waitForFunction(() => marxyDocumentEdit().dirty);
    await page.evaluate(() => {
      const write = __sh.writeFileAtomic;
      __sh.writeFileAtomic = async (p, b) => { await new Promise((r) => setTimeout(r, 600)); return write(p, b); };
    });
    const saving = page.evaluate(() => marxyHarnessSave());
    await page.waitForTimeout(150);
    await clickCheckbox(page, 1); // while the write is pending
    assert.equal(await saving, 'saved');
    assert.equal(await buffer(page), '# T\n\n- [x] one\n- [x] two\n', 'the newer buffer survives the save');
    assert.equal(await page.evaluate(async () => new TextDecoder().decode(await __sh.readFile('/d/a.md'))), '# T\n\n- [x] one\n- [ ] two\n', 'disk holds the bytes that were written');
    assert.equal((await page.evaluate(() => marxyDocumentEdit())).dirty, true);
    assert.match(await lastTitle(page), / •$/, 'the title still shows the dirty dot');
    assert.equal(await page.evaluate(() => marxyHarnessSave()), 'saved', 'the second edit can be saved');
    assert.equal(await page.evaluate(async () => new TextDecoder().decode(await __sh.readFile('/d/a.md'))), '# T\n\n- [x] one\n- [x] two\n');
    assert.equal((await page.evaluate(() => marxyDocumentEdit())).dirty, false);
  } finally {
    await browser.close();
  }
});

// ---- B10: save failure wording, and saving a file that was deleted ------------------------------

test('B10: the notice gives the shell message; a string rejection is shown as it is', async () => {
  const browser = await launchWebkit();
  try {
    const page = await openForSave(browser, { '/d/a.md': b64('# T\n\n- [ ] one\n') }, ['/d/a.md']);
    await clickCheckbox(page, 0);
    await page.waitForFunction(() => marxyDocumentEdit().dirty);
    await page.evaluate(() => {
      __sh.writeFileAtomic = async (p) => {
        const e = new Error(`${p}: has 2 hard links, and a rename would leave the other names on the old bytes`);
        e.code = 'permission';
        throw e;
      };
    });
    assert.equal(await page.evaluate(() => marxyHarnessSave()), 'failed');
    let text = (await notices(page)).join('\n');
    assert.match(text, /hard links/);
    assert.doesNotMatch(text, /read-only/);
    await page.evaluate(() => document.querySelectorAll('.marxy-notice-dismiss').forEach((b) => b.click()));
    await page.evaluate(() => { __sh.writeFileAtomic = async () => { throw '/d/a.md: Disk quota exceeded (os error 122)'; }; });
    assert.equal(await page.evaluate(() => marxyHarnessSave()), 'failed');
    text = (await notices(page)).join('\n');
    assert.match(text, /Disk quota exceeded/);
    assert.doesNotMatch(text, /the write failed/);
  } finally {
    await browser.close();
  }
});

test('B10: saving a file deleted since it was opened recreates it', async () => {
  const p = '/d/gone.md';
  fs.set(p, enc('one\n'));
  await shell.readFile(p);
  fs.delete(p);
  hooks.readError = `${p}: No such file or directory (os error 2)`; // Tauri rejects with a bare string
  try {
    await shell.writeFileAtomic(p, enc('two\n'));
  } finally {
    hooks.readError = null;
  }
  assert.equal(dec(fs.get(p)), 'two\n');
});

test('B10: any other failure to look at the file is an Error with the message, not a bare string', async () => {
  const p = '/d/locked.md';
  fs.set(p, enc('one\n'));
  await shell.readFile(p);
  hooks.readError = `${p}: Permission denied (os error 13)`;
  try {
    await assert.rejects(
      () => shell.writeFileAtomic(p, enc('two\n')),
      (err) => err instanceof Error && /Permission denied/.test(err.message),
    );
  } finally {
    hooks.readError = null;
  }
  assert.equal(dec(fs.get(p)), 'one\n');
});

// ---- B11: "Show source" lands on the byte, not the UTF-16 index --------------------------------

test('B11: the truncation notice opens Source at the byte offset of its line (CJK, BOM)', async () => {
  const browser = await launchWebkit();
  try {
    const cjk = `# T\n\n${'日本語のテキスト。\n'.repeat(6)}<script>\nalert(1)\nmore\n${'tail\n'.repeat(30)}`;
    const bom = '﻿# T\r\n\r\nline\r\n<script>\r\nalert(1)\r\nmore\r\n';
    for (const src of [cjk, bom]) {
      const page = await open(browser, { '/d/T.md': b64(src) }, ['/d/T.md']);
      await clickAction(page, /Show source/);
      await page.waitForFunction(() => __h.sourceHarness()?.mode === 'source');
      const want = Buffer.from(src).indexOf('<script');
      assert.equal((await page.evaluate(() => __h.sourceHarness())).byteOffset, want);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

// ---- B13 / B14 / B15: trust grants -------------------------------------------------------------

const WIDE = '<div align="center">\n\n<details><summary>s</summary>\n\nbody\n\n</details>\n\n</div>\n\n';
const ONE_IMAGE = '![x](https://img.shields.io/badge/x-y.svg)\n';
const BOTH = `# B\n\n${WIDE}![x](https://img.shields.io/badge/x-y.svg) ![y](https://аpple.com/a.png)\n`;

test('B13: switching documents while a grant is being written announces nothing on the new document', async () => {
  const browser = await launchWebkit();
  try {
    const page = await open(browser, { '/d/B.md': b64(BOTH), '/d/C.md': b64('# C\n') }, ['/d/B.md']);
    await page.evaluate(() => {
      const write = __sh.writeFileAtomic;
      __sh.writeFileAtomic = async (p, b) => {
        if (String(p).endsWith('trust.json')) await new Promise((r) => setTimeout(r, 900));
        return write(p, b);
      };
    });
    await clickAction(page, /Show this document's HTML/);
    await page.waitForTimeout(100);
    await page.evaluate(() => __h.open('/d/C.md'));
    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(() => __h.currentPath()), '/d/C.md');
    const text = (await notices(page)).join('\n');
    assert.doesNotMatch(text, /Showing|C\.md/);
    assert.equal(await page.evaluate(() => !!document.querySelector('#doc details')), false);
  } finally {
    await browser.close();
  }
});

test('B14: a trust.json from a newer Marxy says so and does not claim the grant', async () => {
  const browser = await launchWebkit();
  try {
    const trust = JSON.stringify({ version: 2, documents: {} });
    const page = await open(browser, { '/d/B.md': b64(`# B\n\n${WIDE}`), '/data/trust.json': b64(trust) }, ['/d/B.md']);
    await clickAction(page, /Show this document's HTML/);
    await page.waitForFunction(() => /newer Marxy/.test(document.getElementById('marxy-notices')?.textContent ?? ''));
    assert.doesNotMatch((await notices(page)).join('\n'), /Showing HTML/);
    assert.equal(await page.evaluate(() => !!document.querySelector('#doc details')), false);
  } finally {
    await browser.close();
  }
});

test('B14: a failed trust write says so, shows no success and leaves the document as it was', async () => {
  const browser = await launchWebkit();
  try {
    const trust = JSON.stringify({ version: 1, documents: {} });
    const page = await open(browser, { '/d/B.md': b64(`# B\n\n${WIDE}`), '/data/trust.json': b64(trust) }, ['/d/B.md']);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluate(() => {
      const write = __sh.writeFileAtomic;
      __sh.writeFileAtomic = async (p, b) => {
        if (String(p).endsWith('trust.json')) { const e = new Error('disk full'); e.code = 'io'; throw e; }
        return write(p, b);
      };
    });
    await clickAction(page, /Show this document's HTML/);
    await page.waitForFunction(() => /disk full/.test(document.getElementById('marxy-notices')?.textContent ?? ''));
    assert.doesNotMatch((await notices(page)).join('\n'), /Showing HTML/);
    assert.equal(await page.evaluate(() => !!document.querySelector('#doc details')), false);
    await page.waitForTimeout(200);
    assert.deepEqual(errors, [], 'no unhandled rejection');
    // The in-memory grant was rolled back: reopening does not show HTML that was never saved.
    await page.evaluate(() => __h.open('/d/B.md'));
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => !!document.querySelector('#doc details')), false);
  } finally {
    await browser.close();
  }
});

test('B15: the HTML grant announces one summary; the notice offers no host list', async () => {
  const browser = await launchWebkit();
  try {
    const page = await open(browser, { '/d/B.md': b64(BOTH) }, ['/d/B.md']);
    assert.equal(await page.locator('.marxy-notice-details').count(), 0);
    assert.equal(await page.locator('#marxy-notices input').count(), 0);
    await clickAction(page, /Show this document's HTML/);
    await page.waitForFunction(() => /Showing HTML for B\.md\. Undo in the palette\./.test(document.getElementById('marxy-notices')?.textContent ?? ''));
  } finally {
    await browser.close();
  }
});

test('B15: a protocol-relative image is not counted or offered as a blocked host', async () => {
  const browser = await launchWebkit();
  try {
    const src = `# B\n\n${ONE_IMAGE}![p](//proto.example/y.png)\n`;
    const page = await open(browser, { '/d/B.md': b64(src) }, ['/d/B.md']);
    const text = (await notices(page)).join('\n');
    assert.match(text, /1 remote image from img\.shields\.io was not loaded/);
    assert.doesNotMatch(text, /proto\.example|2 /);
  } finally {
    await browser.close();
  }
});

// ---- B14 / B15 without a browser ---------------------------------------------------------------

nodeTest('B14: grant and revoke say false on a newer trust.json, and a failed write is put back', async () => {
  const writes = [];
  const newer = createTrustStore({ version: TRUST_FILE_VERSION + 1, documents: {} }, async (b) => { writes.push(b); });
  assert.equal(await newer.grant('/d/a.md', { html: true }), false);
  assert.equal(await newer.revoke('/d/a.md', 'html'), false);
  assert.equal(writes.length, 0);

  let fail = true;
  const store = createTrustStore(emptyTrustEnvelope(), async () => { if (fail) throw new Error('disk full'); });
  await assert.rejects(() => store.grant('/d/a.md', { html: true }), /disk full/);
  assert.equal(store.grantsFor('/d/a.md').html, false, 'the grant that was not saved is not held');
  fail = false;
  assert.equal(await store.grant('/d/a.md', { html: true }), true);
  assert.equal(store.grantsFor('/d/a.md').html, true);
});

nodeTest('B14: writes reach disk in the order the changes were made', async () => {
  const disk = [];
  let first = true;
  const store = createTrustStore(emptyTrustEnvelope(), async (bytes) => {
    if (first) { first = false; await new Promise((r) => setTimeout(r, 40)); }
    disk.push(JSON.parse(dec(bytes)));
  });
  await Promise.all([store.grant('/d/a.md', { html: true }), store.grant('/d/b.md', { html: true })]);
  const last = disk.at(-1).documents;
  assert.equal(last['/d/a.md'].html, true);
  assert.equal(last['/d/b.md'].html, true);
  assert.ok(!('imageHosts' in last['/d/a.md']));
});

nodeTest('B15: the image line agrees with its verb, and the copy skips images no grant can load', () => {
  const removal = (value, url) => ({ what: 'attribute', name: 'src', on: 'img', value, url, reason: 'remote image' });
  const schemeRelative = { ...removal('//proto.example/y.png', 'https://proto.example/y.png'), reason: 'a scheme-relative reference addresses a host' };
  const a = removal('https://img.shields.io/a.svg', 'https://img.shields.io/a.svg');
  const b = removal('https://img.shields.io/b.svg', 'https://img.shields.io/b.svg');
  const image = (r) => ({ host: new URL(r.url).hostname, url: r.url });
  assert.equal(blockedTrustNoticeText([a], [image(a)]), '1 image from img.shields.io was not loaded.');
  assert.equal(blockedTrustNoticeText([a, b], [image(a), image(b)]), '2 images from img.shields.io were not loaded.');
  const removed = [a, schemeRelative];
  const images = [image(a), image(schemeRelative)];
  assert.deepEqual(grantableBlockedImages(images, removed), [image(a)]);
  assert.equal(blockedTrustNoticeText(removed, images), '1 image from img.shields.io was not loaded.');
  assert.equal(blockedTrustNoticeText([schemeRelative], [image(schemeRelative)]), '');
});

nodeTest('B15: displayHost shows the Unicode form beside the punycode host', () => {
  assert.equal(displayHost('xn--pple-43d.com'), 'аpple.com (xn--pple-43d.com)');
  assert.equal(displayHost('img.shields.io'), 'img.shields.io');
});
