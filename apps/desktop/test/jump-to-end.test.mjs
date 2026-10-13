// A jump to the end of a huge page in Read (F-80). A 10 MB diff is 2,000 pieces of 200 lines (V-10); landing on the last of them
// split it into lines and set the whole article on the grid again, which took the padding off every piece and laid out every
// line of every one of them, twice, and again as the colour arrived: seconds each, 10 to 19 s of a held window at 10 MB, and
// the page was left short of the end besides. Now a piece is laid out only when it is near the screen (base.css), the grid pass
// after a highlight batch is over the pieces it changed (typeset `snapBlocks`), and the end follows the page while it changes.
//
// What is asserted is structural where it can be: how many pieces had their inline padding written after the jump (the whole
// article's pass writes every piece, twice), where the page ends, that every block is on the grid, and that copy and find
// still read the whole file. The longest the main thread was held is asserted under a bound that is generous for a loaded
// machine (measured at 0.1 to 1.7 s; it was 4 to 19 s) and is printed. WebKit, over the shipped skeleton and the memory shell,
// as diff-file.test.mjs runs.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 400_000 }, fn);
after(() => closeHarness());

/** The longest the main thread may be held after the jump: generous (it was 4 to 19 s without the change). */
const LONGEST_BLOCK_MS = 4000;

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const GENERATORS = `
  window.__make = (kind, mb) => {
    const target = mb * 1024 * 1024;
    const parts = [];
    let bytes = 0;
    let n = 0;
    if (kind === 'diff') {
      while (bytes < target) {
        const head = 'diff --git a/src/f' + n + '.ts b/src/f' + n + '.ts\\nindex 3f1c2aa..9b7d0e4 100644\\n--- a/src/f' + n + '.ts\\n+++ b/src/f' + n + '.ts\\n@@ -1,6 +1,7 @@ export function f' + n + '() {\\n';
        let body = '';
        for (let i = 0; i < 4; i++) body += ' const keep' + i + ' = ' + (n + i) + ';\\n';
        body += '-  return ' + n + ';\\n+  const next = ' + n + ' + 1;\\n+  return next;\\n }\\n';
        parts.push(head + body);
        bytes += head.length + body.length;
        n++;
      }
      parts.push('+ZZLASTTOKEN\\n');
    } else {
      while (bytes < target) {
        const t = 'def fn_' + n + '(a, b):\\n    x = a + ' + n + '\\n    return x * b  # ok\\n\\n';
        parts.push(t);
        bytes += t.length;
        n++;
      }
      parts.push('ZZLASTTOKEN = 1\\n');
    }
    return new TextEncoder().encode(parts.join(''));
  };
`;

/** Boots the app on a generated file of about `mb` MB and waits until it is wholly in the page (and, for a .py, in Read). */
async function openLarge(page, kind, mb) {
  const base = await harnessBase();
  await routeSkeleton(page, base);
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(GENERATORS);
  const info = await page.evaluate(async ({ kind, mb }) => {
    const path = kind === 'diff' ? '/r/big.diff' : '/r/big.py';
    const bytes = window.__make(kind, mb);
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const { startApp } = await import('/src/app.ts');
    const shell = createMemoryShell({ [path]: bytes });
    window.__firstText = null;
    window.__highlightDone = false;
    const mark = shell.mark.bind(shell);
    shell.mark = async (name, t, data) => {
      if (name === 'first_text') window.__firstText = performance.now();
      if (name === 'highlight_ms') window.__highlightDone = true;
      return mark(name, t, data);
    };
    const handle = await startApp(shell, { argv: [path] });
    await handle.ready;
    window.__marxyHandle = handle;
    return { bytes: bytes.length };
  }, { kind, mb });
  await page.waitForFunction(() => window.__firstText !== null, null, { timeout: 120_000 });
  // A code file opens in Source (V-11): Read is what Mod+1 asks for.
  if (kind === 'py') await page.evaluate(() => window.__marxyHandle.panes().focused.view.setMode('rendered'));
  await page.evaluate(() => window.__marxyHandle.contentComplete());
  const pieces = await page.evaluate(() => document.querySelector('#doc').childElementCount);
  // The page's own work after the mount (images, colour of the first screens, the grid passes they ask for) is not the jump's:
  // let it finish, and the padding stop being written.
  await page.waitForFunction(() => window.__highlightDone, null, { timeout: 120_000 });
  await page.evaluate(() => new Promise((resolve) => {
    const doc = document.querySelector('#doc');
    let quietSince = performance.now();
    const observer = new MutationObserver(() => { quietSince = performance.now(); });
    observer.observe(doc, { attributes: true, attributeFilter: ['style'], subtree: true });
    const tick = () => {
      if (performance.now() - quietSince > 1500) { observer.disconnect(); resolve(); } else setTimeout(tick, 100);
    };
    tick();
  }));
  return { ...info, pieces };
}

/** What the page measures while a jump happens: the main thread held, and how many pieces had their padding written. */
const WATCH = `
  window.__watch = () => {
    const state = { worst: 0, writes: 0, pieces: new Set() };
    let last = performance.now();
    const beat = setInterval(() => { const t = performance.now(); state.worst = Math.max(state.worst, t - last); last = t; }, 4);
    const doc = document.querySelector('#doc');
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.attributeName !== 'style' || r.target.parentElement !== doc) continue;
        state.writes++;
        state.pieces.add(r.target);
      }
    });
    observer.observe(doc, { attributes: true, attributeFilter: ['style'], subtree: true });
    window.__watching = { state, stop: () => { clearInterval(beat); observer.disconnect(); return { worst: state.worst, writes: state.writes, pieces: state.pieces.size }; } };
  };
  // Until the page has stopped changing: the scroll offset and the height the same for a second, and the last piece coloured.
  window.__quiet = () => new Promise((resolve) => {
    const d = document.documentElement;
    let sig = '';
    let since = performance.now();
    const tick = () => {
      const code = document.querySelector('#doc').lastElementChild.firstElementChild;
      const now = d.scrollTop + ':' + d.scrollHeight + ':' + (code?.dataset.marxyDone ?? '');
      if (now !== sig) { sig = now; since = performance.now(); }
      if (performance.now() - since > 1500 && code?.dataset.marxyDone === 'highlight') resolve(now);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  window.__ends = () => {
    const d = document.documentElement;
    const doc = document.querySelector('#doc');
    const unit = parseFloat(getComputedStyle(doc).lineHeight) / 2;
    const origin = doc.getBoundingClientRect().top;
    const off = [];
    for (const [i, el] of [...doc.children].entries()) {
      const r = (((el.getBoundingClientRect().top - origin) % unit) + unit) % unit;
      if (r > 0.6 && unit - r > 0.6) off.push([i, Math.round(r * 100) / 100]);
    }
    const last = doc.lastElementChild.getBoundingClientRect();
    return { distance: d.scrollHeight - d.clientHeight - d.scrollTop, off, lastBottom: last.bottom, innerHeight, blocks: doc.childElementCount };
  };
`;

async function jumpToEnd(page, how) {
  await page.evaluate(WATCH);
  await page.evaluate(() => { window.__watch(); document.activeElement?.blur?.();  });
  if (how === 'End') await page.keyboard.press('End');
  else if (how === 'scrollTop') await page.evaluate(() => { document.documentElement.scrollTop = document.documentElement.scrollHeight; });
  else throw new Error(`unknown jump ${how}`);
  await page.evaluate(() => window.__quiet());
  const watched = await page.evaluate(() => window.__watching.stop());
  const ends = await page.evaluate(() => window.__ends());
  return { watched, ends };
}

for (const [kind, mb] of [['diff', Number(process.env.MARXY_JUMP_DIFF_MB ?? 10)], ['py', Number(process.env.MARXY_JUMP_PY_MB ?? 3)]]) {
  for (const how of kind === 'diff' ? ['End', 'scrollTop'] : ['End']) {
    test(`a ${mb} MB ${kind === 'diff' ? '.diff' : '.py'} in Read: a jump to the end (${how}) writes no padding on most pieces, holds the window briefly, ends at the end, every block on the grid`, () =>
      withPage(async (page) => {
        const open = await openLarge(page, kind, mb);
        assert.ok(open.pieces > 150, `${open.pieces} pieces`);
        const { watched, ends } = await jumpToEnd(page, how);
         console.log(`# ${kind} ${mb} MB (${open.bytes} bytes, ${open.pieces} pieces) ${how}: longest main-thread block ${watched.worst.toFixed(0)} ms, ${watched.writes} padding writes on ${watched.pieces} pieces, ends ${ends.distance} px from the end, ${ends.off.length} blocks off the grid`);
        // The whole article's grid pass writes the padding of every piece, twice; a pass over what changed writes a handful.
        assert.ok(watched.pieces < open.pieces / 10, `${watched.pieces} of ${open.pieces} pieces had their padding written after the jump`);
        assert.ok(watched.worst < LONGEST_BLOCK_MS, `the main thread was held for ${watched.worst.toFixed(0)} ms; the bound is ${LONGEST_BLOCK_MS} ms`);
        assert.ok(ends.distance <= 2, `the page ends ${ends.distance} px below where the jump left the reader`);
        assert.ok(ends.lastBottom > 0 && ends.lastBottom <= ends.innerHeight + 2, `the last block's bottom is at ${ends.lastBottom}`);
        assert.deepEqual(ends.off, [], 'every block starts on the grid');
      }));
  }
}

test('a jump to the end and the reader scrolling up: the end is not held against them', () =>
  withPage(async (page) => {
    await openLarge(page, 'diff', 3);
    await page.evaluate(WATCH);
    await page.keyboard.press('End');
    await page.evaluate(() => window.__quiet());
    const before = await page.evaluate(() => document.documentElement.scrollTop);
    await page.mouse.move(600, 400);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__quiet());
    const after = await page.evaluate(() => ({ top: document.documentElement.scrollTop, distance: window.__ends().distance }));
    assert.ok(after.top < before - 1000, `scrolled from ${before} to ${after.top}`);
    assert.ok(after.distance > 1000, `the page did not pull the reader back to the end (${after.distance} px from it)`);
  }));

test('select all and copy after a jump to the end are the file, and find reaches the last match, in a 3 MB diff', () =>
  withPage(async (page) => {
    await openLarge(page, 'diff', 3);
    await page.keyboard.press('End');
    await page.evaluate(WATCH);
    await page.evaluate(() => window.__quiet());
    const key = await page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));
    const source = await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.panes().focused.view.store().snapshot().buffer.bytes));
    await page.mouse.click(400, 300);
    await page.keyboard.press(`${key}+KeyA`);
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'), null, { timeout: 120_000 });
    const copied = await page.evaluate(() => {
      const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
      return new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes);
    });
    assert.equal(copied.length, source.length, 'the copy is as long as the file');
    assert.ok(copied === source, 'the copy is the file, byte for byte');

    // Find: back to the top, then the last match.
    await page.evaluate(() => { document.documentElement.scrollTop = 0; });
    await page.keyboard.press(`${key}+KeyF`);
    await page.keyboard.type('ZZLASTTOKEN');
    await page.keyboard.press('Enter');
    await page.waitForFunction(async () => {
      const { activeFind } = await import('/src/find/view.ts');
      const state = activeFind()?.state();
      return state !== undefined && state.count === 1 && state.current === 0;
    }, null, { timeout: 60_000 });
    await page.waitForFunction(() => {
      const code = document.querySelector('#doc').lastElementChild.querySelector('code');
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        const at = n.data.indexOf('ZZLASTTOKEN');
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + 11);
        const box = range.getBoundingClientRect();
        return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight;
      }
      return false;
    }, null, { timeout: 30_000 });
  }));
