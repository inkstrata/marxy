// Round-three desktop defects (MARXY-337), each in a real WebKit page over the real app modules:
// the Source round trip, deferred post-pass failures, notices under Source, notice de-duplication,
// click jitter, and the grid after images and invisible-character markers.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { createServer } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = new URL('../../../', import.meta.url).pathname;
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const corpus = (name) => readFileSync(join(repoRoot, 'fixtures', 'corpus', name));
// The real index.html rules: the Source overlay and the notices region are styled there, not in the theme.
const indexCss = /<style>([\s\S]*?)<\/style>/.exec(readFileSync(join(desktopRoot, 'index.html'), 'utf8'))[1];
/** The app's Mod key as the page itself sees the platform (Control on Linux CI). */
const modOf = async (page) => ((await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control');

let harnessPromise;
let closeHarness = () => {};
function harnessBase() {
  harnessPromise ??= (async () => {
    const server = await createServer({
      root: desktopRoot,
      configFile: join(desktopRoot, 'vite.config.ts'),
      logLevel: 'silent',
      server: { port: 0, strictPort: false, host: '127.0.0.1' },
    });
    await server.listen();
    closeHarness = () => server.close();
    return `http://127.0.0.1:${server.config.server.port}/`;
  })();
  return harnessPromise;
}
after(() => closeHarness());

/** A solid PNG `w`×`h`, valid enough for WebKit to decode and for the header read. */
function png(w, h) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Boots the app through `bootApplication` over a memory shell. `patch` is a function body that
 * receives the shell before the app starts, to make one of its calls fail.
 */
async function boot(page, files, argv, { patch = '', viewport } = {}) {
  const base = await harnessBase();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'warning') errors.push(m.text());
  });
  await page.addInitScript(() => {
    globalThis.process = { env: {} };
  });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function', undefined, { timeout: 20_000 });
  await page.addStyleTag({ content: indexCss });
  if (viewport) await page.setViewportSize(viewport);
  const encoded = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v).toString('base64')]));
  await page.evaluate(
    async ({ encoded, argv, patch }) => {
      const bytes = {};
      for (const [path, b64] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const shell = createMemoryShell(bytes);
      if (patch) new Function('shell', patch)(shell);
      const handle = await bootApplication(shell, { argv });
      await handle.ready;
      window.__handle = handle;
    },
    { encoded, argv, patch },
  );
  return errors;
}

/** Resolves once `predicate` has held for `ms` in a row (idle-time typesetting and passes have settled). */
const settle = (page, ms = 800) =>
  page.evaluate(async (ms) => {
    let last = '';
    let since = performance.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 100));
      const cur = `${document.querySelectorAll('#doc .marxy-set').length}/${document.documentElement.scrollHeight}`;
      if (cur !== last) {
        last = cur;
        since = performance.now();
      } else if (performance.now() - since >= ms) return cur;
    }
  }, ms);

test('MARXY-337 #1: Rendered to Source to Rendered after 500 ms restores position and typesetting', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
    const path = '/repo/15-prose-volume.md';
    await boot(page, { [path]: corpus('15-prose-volume.md') }, [path]);
    await settle(page);
    await page.evaluate(() => {
      document.documentElement.scrollTop = 8000;
    });
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => ({
      top: document.documentElement.scrollTop,
      set: document.querySelectorAll('#doc .marxy-set').length,
    }));
    assert.ok(before.top > 5000 && before.set > 20, JSON.stringify(before));
    await page.keyboard.press(`${await modOf(page)}+KeyE`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.waitForTimeout(500);
    await page.keyboard.press(`${await modOf(page)}+KeyE`);
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({
      top: document.documentElement.scrollTop,
      set: document.querySelectorAll('#doc .marxy-set').length,
    }));
    assert.ok(Math.abs(after.top - before.top) < 80, `reading position ${before.top} -> ${after.top}`);
    assert.ok(after.set >= before.set, `paragraphs still set: ${before.set} -> ${after.set}`);
  } finally {
    await browser.close();
  }
});

test('MARXY-337 #2: an allowAssetScope rejection leaves the rendered page and open document', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const path = '/repo/d/i.md';
    const files = { [path]: '# Scoped\n\nBefore.\n\n![p](pic.png)\n\nAfter.\n', '/repo/d/pic.png': png(40, 30) };
    const errors = await boot(page, files, [path], {
      patch: "shell.allowAssetScope = async () => { throw new Error('scope refused'); };",
    });
    await page.waitForTimeout(1000);
    const state = await page.evaluate(() => ({
      text: document.getElementById('doc').textContent,
      path: window.__handle.currentPath(),
    }));
    assert.match(state.text, /Scoped/);
    assert.match(state.text, /After\./);
    assert.equal(state.path, path);
    assert.ok(errors.some((e) => /scope refused/.test(e)), `expected a console.warn naming the failure: ${errors}`);
  } finally {
    await browser.close();
  }
});

for (const [name, doc, pattern] of [
  ['the katex chunk', '# Math\n\nInline $x^2$ here.\n\nAfter.\n', /katex/],
  ['the highlight chunk', '# Code\n\n```js\nconst a = 1;\n```\n\nAfter.\n', /render\/highlight/],
]) {
  test(`MARXY-337 #2: a failed load of ${name} leaves the rendered page and open document`, async () => {
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
      await page.route((url) => pattern.test(url.pathname) && !/\.css/.test(url.pathname), (route) => route.abort());
      const path = '/repo/d/x.md';
      await boot(page, { [path]: doc }, [path]);
      await page.waitForTimeout(1000);
      const state = await page.evaluate(() => ({
        text: document.getElementById('doc').textContent,
        path: window.__handle.currentPath(),
      }));
      assert.match(state.text, /After\./);
      assert.equal(state.path, path);
    } finally {
      await browser.close();
    }
  });
}

test('MARXY-337 #3: a notice is on top of the Source overlay', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const path = '/repo/a.md';
    await boot(page, { [path]: '# A\n\nBody.\n' }, [path]);
    await page.keyboard.press(`${await modOf(page)}+KeyE`);
    await page.waitForSelector('#marxy-source .cm-editor');
    const hit = await page.evaluate(async () => {
      const { notify } = await import('/src/notices/index.ts');
      notify({ kind: 'info', text: 'The file was removed from disk.' });
      const rect = document.querySelector('.marxy-notice').getBoundingClientRect();
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { rect: [rect.width, rect.height], inNotice: el?.closest('#marxy-notices') !== null };
    });
    assert.ok(hit.rect[0] > 0 && hit.rect[1] > 0, JSON.stringify(hit));
    assert.equal(hit.inNotice, true);
  } finally {
    await browser.close();
  }
});

test('MARXY-337 #4: the same notice is not stacked, and blocked content keeps the other notices', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const path = '/repo/a.md';
    await boot(page, { [path]: '# A\n\nBody.\n' }, [path]);
    const result = await page.evaluate(async () => {
      const { notify } = await import('/src/notices/index.ts');
      const { blockedContentNotice } = await import('/src/notices/blocked.ts');
      const lines = () => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent);
      for (let i = 0; i < 4; i++) notify({ kind: 'info', text: 'The file changed on disk; your edits were kept.' });
      const stacked = lines();
      notify({ kind: 'info', text: 'The file was removed from disk.' });
      blockedContentNotice([{ host: 'a.example', url: 'https://a.example/x.png' }]);
      blockedContentNotice([{ host: 'b.example', url: 'https://b.example/x.png' }]);
      const after = lines();
      blockedContentNotice([]);
      return { stacked, after, end: lines() };
    });
    assert.deepEqual(result.stacked, ['The file changed on disk; your edits were kept.']);
    assert.equal(result.after.length, 3, result.after.join(' | '));
    assert.ok(result.after.includes('The file was removed from disk.'));
    assert.equal(result.after.filter((t) => /b\.example/.test(t)).length, 1);
    assert.equal(result.after.filter((t) => /a\.example/.test(t)).length, 0);
    assert.equal(result.end.length, 2);
  } finally {
    await browser.close();
  }
});

test('MARXY-337 #5: a click with a pixel of pointer jitter still selects; a real drag does not', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const path = '/repo/a.md';
    await boot(page, { [path]: '# Title\n\nA paragraph that is long enough to click on.\n\nSecond one.\n' }, [path]);
    await settle(page, 400);
    const box = await page.locator('#doc p').first().boundingBox();
    const x = box.x + 10;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 1, y + 1);
    await page.mouse.up();
    assert.equal(await page.locator('#doc p.marxy-selected').count(), 1, 'jittered click selects the paragraph');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#doc .marxy-selected').count(), 0);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y);
    await page.mouse.up();
    assert.equal(await page.locator('#doc p.marxy-selected').count(), 0, 'a real drag is not a click');
  } finally {
    await browser.close();
  }
});

/** Blocks whose top is not on a half-line grid step of `#doc`. */
const offGrid = (page) =>
  page.evaluate(() => {
    const doc = document.getElementById('doc');
    const unit = parseFloat(getComputedStyle(doc).lineHeight) / 2;
    const origin = doc.getBoundingClientRect().top;
    const bad = [];
    for (const el of doc.children) {
      const display = getComputedStyle(el).display;
      if (display === 'none' || display === 'inline') continue;
      const rem = (((el.getBoundingClientRect().top - origin) % unit) + unit) % unit;
      if (rem > 0.5 && unit - rem > 0.5) bad.push(`${el.tagName} off ${rem.toFixed(1)}`);
    }
    return bad;
  });

test('MARXY-337 #6: blocks stay on the baseline grid after local images get their boxes', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    const path = '/repo/d/i.md';
    const md = '# Img\n\n![big](big.png)\n\nText after.\n\n![small](small.png) inline small.\n\nMore text.\n\n<img src="big.png" width="3000" alt="wide">\n\nEnd.\n';
    await boot(page, { [path]: md, '/repo/d/big.png': png(2000, 900), '/repo/d/small.png': png(40, 30) }, [path]);
    await settle(page, 1200);
    assert.ok((await page.locator('#doc img[src^="blob:"], #doc img[src^="asset"], #doc img[src^="data:"]').count()) >= 2, 'images got a source');
    assert.deepEqual(await offGrid(page), []);
  } finally {
    await browser.close();
  }
});

test('MARXY-337 #6: blocks stay on the baseline grid after invisible-character markers are inserted', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    // Bundled faces withheld: the fallback face's metrics make the markers' boxes taller than a line.
    await page.route('**/*.ttf', (route) => route.fulfill({ status: 404, body: '' }));
    const path = '/repo/29-hidden-characters.md';
    await boot(page, { [path]: corpus('29-hidden-characters.md') }, [path]);
    await settle(page, 1200);
    assert.ok((await page.locator('#doc .marxy-invisible').count()) > 0, 'markers were inserted');
    assert.deepEqual(await offGrid(page), []);
  } finally {
    await browser.close();
  }
});
