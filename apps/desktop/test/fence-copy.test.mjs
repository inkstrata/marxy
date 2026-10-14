// A selection wholly inside one Markdown code fence copies that fence's source bytes exactly, line endings and
// all; a selection that takes any prose copies the page's text (F-68). The mechanism is V-10's (a copy listener
// and `codeRunSourceText`); here it is Markdown's fences, with real key presses in WebKit. The tests of what is copied
// from a fence fail with the fence path off; those of prose, a quoted fence and the fields hold behaviour that must not
// change, and pass with it off too.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-fence-copy-'));
let server;
let base;
let browser;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } } },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  server?.close();
});

// The first fence holds a tab, trailing spaces and a multi-byte line; the second is a plain one. Every line ends CRLF.
const FENCE_ONE = ['const a = 1;', '\tindented with a tab', 'trailing spaces   ', 'naïve café 日本語 🙂', 'the last line'].join('\r\n') + '\r\n';
const FENCE_TWO = 'second one\r\nof two lines\r\n';
const DOC = `# Fences\r\n\r\nProse before the first fence.\r\n\r\n\`\`\`\r\n${FENCE_ONE}\`\`\`\r\n\r\nProse between.\r\n\r\n\`\`\`\r\n${FENCE_TWO}\`\`\`\r\n\r\nProse after.\r\n`;
const files = (text, path) => ({ '/repo/.git/HEAD': 'ref: refs/heads/main\n', [path]: text });
const b64 = (all) => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, Buffer.from(v, 'utf8').toString('base64')]));

async function open(text = DOC, path = '/repo/f.md') {
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await page.goto(`${base}test/palette-boot.html`);
  await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
  await page.evaluate(async ({ f, a }) => {
    const r = await window.marxyPaletteBoot.start(f, a);
    window.__h = r.handle;
  }, { f: b64(files(text, path)), a: [path] });
  if (path.endsWith('.py')) {
    // A code file opens in Source; Rendered shows its pieces (V-10).
    await page.waitForSelector('.cm-editor');
    await page.keyboard.press(`${await modifier(page)}+KeyE`);
    await drained(page);
  }
  // A code file's Rendered is its pieces (`pre.marxy-run`), drawn plain and then swapped for their highlighted lines, which
  // replaces the code's children and drops a selection made before it (`data-marxy-done`). Wait for the swap: under load it
  // lands after a test has selected, and the copy is then of an empty selection (V-10).
  const code = path.endsWith('.py') ? '#doc pre.marxy-run > code[data-marxy-done]' : '#doc pre > code';
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length >= 1, code);
  await page.evaluate(() => {
    window.__copies = [];
    document.addEventListener('copy', (e) => window.__copies.push({ prevented: e.defaultPrevented, data: e.clipboardData.getData('text/plain') }));
  });
  return page;
}
const modifier = (page) => page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));
const drained = (page) => page.evaluate(() => window.__h.panes().focused.view.serially(async () => {}));

/**
 * Selects, in the page, from page-text offset `from` of `in`'s text to `to` of `outIn`'s: each a [selector index, offset
 * into that element's text], the text being what the reader sees (a CRLF is one newline there). `null` offsets mean the
 * element's start or its end.
 */
async function select(page, [fromEl, from], [toEl, to]) {
  await page.evaluate(({ fromEl, from, toEl, to }) => {
    const at = (el, offset) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let left = offset;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (left <= n.data.length) return [n, left];
        left -= n.data.length;
      }
      return [el, el.childNodes.length];
    };
    const els = () => ({ code: [...document.querySelectorAll('#doc pre > code')], prose: [...document.querySelectorAll('#doc p')] });
    const pick = (spec) => (spec.startsWith('code') ? els().code[Number(spec.slice(4))] : els().prose[Number(spec.slice(5))]);
    const a = pick(fromEl);
    const b = pick(toEl);
    const range = document.createRange();
    range.setStart(...at(a, from ?? 0));
    range.setEnd(...at(b, to ?? b.textContent.length));
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { fromEl, from, toEl, to });
  await page.waitForTimeout(50);
}
const pageText = (source) => source.replaceAll('\r\n', '\n');
/** What the last Mod+C put on the clipboard: the shell's pasteboard write, else the page's own copy event. */
const copiedAfter = async (page, key) => {
  const before = await page.evaluate(() => window.__h.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length);
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
  return page.evaluate((before) => {
    const calls = window.__h.shell.calls.filter((c) => c.method === 'clipboardWriteItem');
    if (calls.length > before) {
      return new TextDecoder().decode(calls.at(-1).args[0].find((r) => r.type === 'public.utf8-plain-text').bytes);
    }
    const native = window.__copies.at(-1);
    return native?.prevented ? native.data : null;
  }, before);
};
/** Equal, or a short account of where they first differ. */
const same = (actual, expected, what) => {
  if (actual === expected) return;
  let i = 0;
  while (i < Math.min(actual?.length ?? 0, expected.length) && actual[i] === expected[i]) i++;
  assert.fail(`${what}: ${JSON.stringify(actual)} against ${JSON.stringify(expected)} (first difference at ${i})`);
};

test('a partial selection inside a CRLF fence copies the source bytes, CRLF kept (F-68)', async () => {
  const page = await open();
  const norm = pageText(FENCE_ONE);
  const from = norm.indexOf('a = 1;');
  const to = norm.indexOf('café') + 'caf'.length;
  await select(page, ['code0', from], ['code0', to]);
  const expected = FENCE_ONE.slice(FENCE_ONE.indexOf('a = 1;'), FENCE_ONE.indexOf('café') + 'caf'.length);
  assert.ok(expected.includes('\r\n') && expected.includes('\t') && expected.includes('trailing spaces   \r\n'));
  same(await copiedAfter(page, `${await modifier(page)}+KeyC`), expected, 'partial');
  await page.close();
});

test('a selection of a whole CRLF fence copies every byte of it, the last line ending too (F-68)', async () => {
  const page = await open();
  await select(page, ['code0', null], ['code0', null]);
  same(await copiedAfter(page, `${await modifier(page)}+KeyC`), FENCE_ONE, 'whole fence');
  await page.close();
});

test('a multi-byte line, a tab and trailing spaces copy as they are (F-68)', async () => {
  const page = await open();
  const norm = pageText(FENCE_ONE);
  const from = norm.indexOf('\tindented');
  const to = norm.indexOf('🙂') + '🙂'.length;
  await select(page, ['code0', from], ['code0', to]);
  const expected = FENCE_ONE.slice(FENCE_ONE.indexOf('\tindented'), FENCE_ONE.indexOf('🙂') + '🙂'.length);
  same(await copiedAfter(page, `${await modifier(page)}+KeyC`), expected, 'multi-byte');
  await page.close();
});

test('the second fence copies its own bytes, not the first\'s (F-68)', async () => {
  const page = await open();
  await select(page, ['code1', 3], ['code1', 'second one\nof two'.length]);
  same(await copiedAfter(page, `${await modifier(page)}+KeyC`), 'ond one\r\nof two', 'second fence');
  await page.close();
});

/** A fence whose last line is `npm install foo`, ending as `eol` does, then prose. */
const lastLineDoc = (eol) => `# T${eol}${eol}\`\`\`${eol}echo one${eol}npm install foo${eol}\`\`\`${eol}${eol}After.${eol}`;

for (const [name, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`the last line of a ${name} fence copies without its line ending (F-68)`, async () => {
    const page = await open(lastLineDoc(eol));
    await select(page, ['code0', 'echo one\n'.length], ['code0', 'echo one\nnpm install foo'.length]);
    same(await copiedAfter(page, `${await modifier(page)}+KeyC`), 'npm install foo', 'last line');
    // And the line before it, ending included when the selection takes it.
    await select(page, ['code0', 0], ['code0', 'echo one\n'.length]);
    same(await copiedAfter(page, `${await modifier(page)}+KeyC`), `echo one${eol}`, 'first line and its ending');
    await page.close();
  });

  test(`a selection through the last line's ending to the next block copies the ending, nothing more (${name}, F-68)`, async () => {
    const page = await open(lastLineDoc(eol));
    // The page has no closing fence line to select: the fence ends after its last newline and the prose follows. A
    // selection that runs on into the prose takes the prose, so it is the page's text; one that stops at the fence's end
    // takes the ending, which is the fence's last byte.
    await select(page, ['code0', 'echo one\n'.length], ['code0', null]);
    same(await copiedAfter(page, `${await modifier(page)}+KeyC`), `npm install foo${eol}`, 'to the fence end');
    await select(page, ['code0', 'echo one\n'.length], ['prose0', 'After'.length]);
    same(await copiedAfter(page, `${await modifier(page)}+KeyC`), 'npm install foo\n\nAfter', 'into the prose');
    await page.close();
  });
}

test('a CRLF code file copies whole line endings at a selection\'s start and end (V-10, F-68)', async () => {
  const py = 'a = 1\r\nb = 2\r\nc = 3\r\n';
  const page = await open(py, '/repo/f.py');
  const mod = await modifier(page);
  // Ends just after a line break: the CR and its LF both, not a bare CR.
  await select(page, ['code0', 0], ['code0', 'a = 1\n'.length]);
  same(await copiedAfter(page, `${mod}+KeyC`), 'a = 1\r\n', 'ends after a break');
  // Starts just after a line break: no bare LF at the front.
  await select(page, ['code0', 'a = 1\n'.length], ['code0', 'a = 1\nb = 2'.length]);
  same(await copiedAfter(page, `${mod}+KeyC`), 'b = 2', 'starts after a break');
  await page.close();
});

test('a native copy event over a fence carries the same bytes (F-68)', async () => {
  const page = await open();
  const norm = pageText(FENCE_ONE);
  await select(page, ['code0', norm.indexOf('trailing')], ['code0', norm.indexOf('naïve') + 'naïve'.length]);
  await page.evaluate(() => document.execCommand('copy'));
  const seen = await page.evaluate(() => window.__copies);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].prevented, true);
  same(seen[0].data, FENCE_ONE.slice(FENCE_ONE.indexOf('trailing'), FENCE_ONE.indexOf('naïve') + 'naïve'.length), 'native copy');
  await page.close();
});

test('a selection from prose into a fence copies the page text, as before (F-68)', async () => {
  const page = await open();
  await select(page, ['prose0', 6], ['code0', 'const a'.length]);
  const text = await copiedAfter(page, `${await modifier(page)}+KeyC`);
  assert.ok(text?.includes('before the first fence'), `the prose is on the clipboard: ${JSON.stringify(text)}`);
  assert.ok(text.endsWith('const a'), JSON.stringify(text));
  assert.ok(!text.includes('\r'), 'the page text has no CR');
  await page.close();
});

test('a selection across two fences copies the page text, as before (F-68)', async () => {
  const page = await open();
  await select(page, ['code0', 'const'.length], ['code1', 'second'.length]);
  const text = await copiedAfter(page, `${await modifier(page)}+KeyC`);
  assert.ok(text?.includes('Prose between') || text?.includes('the last line'), JSON.stringify(text));
  assert.ok(!text.includes('\r'), 'the page text has no CR');
  await page.close();
});

test('a fence in a quote is left to the page text, never half its bytes (F-68)', async () => {
  const page = await open('# Q\r\n\r\n> ```\r\n> quoted one\r\n> quoted two\r\n> ```\r\n');
  await select(page, ['code0', 'quoted'.length + 1], ['code0', 'quoted one\nquoted'.length]);
  const text = await copiedAfter(page, `${await modifier(page)}+KeyC`);
  same(text, 'one\nquoted', 'the page text, without the container\'s marks');
  await page.close();
});

/** A fence chosen in the page, then a field of the app's own: its copy is its own. */
async function fenceChosen(page) {
  await select(page, ['code0', 'const'.length], ['code0', 'const a = 1;\n\tindented'.length]);
  await page.evaluate(() => { window.__copies = []; });
}

test('a copy in the find field is the field\'s own after a fence was selected (F-68)', async () => {
  const page = await open();
  await fenceChosen(page);
  const mod = await modifier(page);
  await page.keyboard.press(`${mod}+KeyF`);
  await page.keyboard.type('hello world');
  await page.keyboard.press(`${mod}+KeyA`);
  await page.keyboard.press(`${mod}+KeyC`);
  const seen = await page.evaluate(() => window.__copies);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].prevented, false, 'the page did not take the copy');
  assert.ok(!seen[0].data.includes('indented'), 'and put no code on it');
  await page.close();
});

test('a copy in the palette field is the palette\'s own after a fence was selected (F-68)', async () => {
  const page = await open();
  await fenceChosen(page);
  const mod = await modifier(page);
  await page.keyboard.press(`${mod}+KeyK`);
  await page.waitForSelector('#marxy-palette[open] input');
  await page.keyboard.type('abc');
  await page.keyboard.press(`${mod}+KeyA`);
  await page.keyboard.press(`${mod}+KeyC`);
  const seen = await page.evaluate(() => window.__copies);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].prevented, false);
  assert.ok(!seen[0].data.includes('indented'));
  await page.close();
});

test('a copy in Source is the editor\'s own selection after a fence was selected in Rendered (F-68)', async () => {
  const page = await open();
  await fenceChosen(page);
  const mod = await modifier(page);
  await page.keyboard.press(`${mod}+KeyE`);
  await page.waitForSelector('.cm-editor');
  await drained(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${mod}+ArrowUp`);
  await page.keyboard.press('Shift+End');
  await page.keyboard.press(`${mod}+KeyC`);
  const seen = await page.evaluate(() => window.__copies);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].data, '# Fences', 'the editor\'s own text, not the fence');
  await page.close();
});
