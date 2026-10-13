// F-84: the note that says how much of a long line is not shown ("… 1,340 more characters") is the page's words, not the
// file's. A piece split into lines (the level filter does it to a piece that holds a marker, before its colour has
// arrived) and then coloured was read back from the page, note and all, and the note became text of the line: the page held
// 24 characters the bytes do not, and a filtered copy took the head of a hidden line. WebKit, over the shipped skeleton and
// the memory shell (test/support/two-pane.mjs), as test/log.test.mjs runs. The state a race would leave is built by hand
// so the test does not depend on timing.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';
import { keptLines } from '../src/kinds/log-filter.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const stamp = (i) => `2026-10-12T09:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
/** 900 lines: a 1,500-character INFO line every 150 lines, a ZWSP in a WARN line and an ESC in an INFO line, a WARN every 100. */
const lines = Array.from({ length: 900 }, (_, i) => {
  if (i % 150 === 70) return `${stamp(i)} INFO  blob ${'Zz9'.repeat(500)} end`;
  if (i % 100 === 50) return `${stamp(i)} WARN  slow ${i} ​ marker`;
  if (i % 100 === 20) return `${stamp(i)} INFO  \u001b[33mcolour\u001b[0m ${i}`;
  return `${stamp(i)} INFO  tick number ${i}`;
});
const text = `${lines.join('\n')}\n`;

async function withLog(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(page, { files: { '/r/a.log': text }, open: ['/r/a.log'] });
    await page.waitForFunction(() => {
      const code = document.querySelector('#doc pre.language-log > code');
      return code !== null && code.dataset.marxyDone === 'highlight';
    }, null, { timeout: 30_000 });
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** The page text of `el` as the copy sees it: the marker labels, the hidden-run words and the elision note left out. */
const PAGE_TEXT = `
  window.__pageText = (n) => {
    const skip = ['marxy-elided', 'marxy-invisible-glyph', 'marxy-link-dest', 'marxy-link-host-label', 'marxy-log-hidden-run'];
    if (n.nodeType === 3) return n.data;
    if (n.nodeType !== 1 || skip.some((c) => n.classList.contains(c))) return '';
    return [...n.childNodes].map(window.__pageText).join('');
  };
`;

test('a piece split into lines and then coloured keeps exactly its bytes as text: the elision note does not become source', async () => {
  await withLog(async (page) => {
    await page.evaluate(PAGE_TEXT);
    const got = await page.evaluate(async () => {
      const { applyLinesToCode, applyHighlightToCode } = await import('/src/render/highlight.ts');
      const { sourceTextFromCode } = await import('/src/render/invisibles-dom.ts');
      const source = `2026-10-12T09:00:00.000Z INFO  short\n2026-10-12T09:00:01.000Z INFO  long ${'a'.repeat(1500)} end\n2026-10-12T09:00:02.000Z INFO  ​ tail\n`;
      const make = () => {
        const pre = document.createElement('pre');
        pre.className = 'language-log';
        const code = document.createElement('code');
        code.className = 'language-log';
        code.textContent = source;
        pre.append(code);
        document.body.append(pre);
        return code;
      };
      const plain = make();
      await applyHighlightToCode(plain);
      const split = make();
      applyLinesToCode(split);
      const afterLines = window.__pageText(split);
      const note = split.querySelector('.marxy-elided')?.textContent ?? null;
      const lineEls = [...split.querySelectorAll('.marxy-line')];
      const fromLines = lineEls.map((l) => sourceTextFromCode(l));
      await applyHighlightToCode(split);
      const out = {
        source,
        plain: window.__pageText(plain),
        afterLines,
        afterBoth: window.__pageText(split),
        noteShown: note,
        // What the level filter ranks (log-view `analyse`): each line's text, less the note.
        analysed: fromLines,
        elidedNotes: split.querySelectorAll('.marxy-elided').length,
      };
      plain.parentElement.remove();
      split.parentElement.remove();
      return out;
    });
    assert.equal(got.plain, got.source, 'colour alone leaves the bytes');
    assert.equal(got.afterLines, got.source, 'so does the line split');
    assert.match(got.noteShown ?? '', /more characters/, 'the long line carries its note');
    assert.equal(got.afterBoth, got.source, 'the line split and then the colour: the page holds exactly the bytes, no note among them');
    assert.equal(got.elidedNotes, 1, 'and the note is still drawn, once');
    assert.deepEqual(got.analysed, got.source.replace(/\n$/, '').split('\n'), 'the lines the filter ranks are the file\'s lines, no note on the long one');
    // The ranking is the same function of the same text: the lines the filter keeps do not move.
    assert.deepEqual(keptLines(got.analysed, 2), keptLines(got.source.replace(/\n$/, '').split('\n'), 2));
  });
});

test('Mod+A Mod+C of a filtered log with a long line and a marker in each piece is exactly the lines shown', async () => {
  await withLog(async (page) => {
    // The state a race leaves: a piece the filter reached before its colour (it holds a marker, so the filter splits it into
    // lines itself) and then the colour job, which takes its text from the page.
    const pieces = await page.evaluate(async () => {
      const { applyLinesToCode, applyHighlightToCode } = await import('/src/render/highlight.ts');
      const bytes = window.__marxyHandle.document().snapshot().buffer.bytes;
      let n = 0;
      for (const code of document.querySelectorAll('#doc pre.language-log > code')) {
        const source = new TextDecoder().decode(bytes.subarray(Number(code.dataset.marxyS), Number(code.dataset.marxyE)));
        code.replaceChildren(document.createTextNode(source));
        delete code.dataset.marxyDone;
        applyLinesToCode(code);
        await applyHighlightToCode(code);
        n++;
      }
      return n;
    });
    assert.ok(pieces >= 2, `${pieces} pieces`);
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      await handle.commands().find((c) => c.id === 'log.filter-level').run(buildAppContext(handle));
    });
    await page.click('[data-row-key="log.level.warn"]');
    await page.waitForFunction(async () => {
      const { filterOf } = await import('/src/kinds/log-view.ts');
      const view = window.__marxyHandle.panes().focused;
      return filterOf(view.article, view.view.store()) !== undefined;
    }, null, { timeout: 30_000 });
    await page.evaluate(async () => {
      const { filterOf } = await import('/src/kinds/log-view.ts');
      const view = window.__marxyHandle.panes().focused;
      await filterOf(view.article, view.view.store())?.settled();
    });
    assert.ok(await page.evaluate(() => document.querySelectorAll('#doc .marxy-log-hidden-text').length) > 0, 'the filter hid lines');
    // Select everything in the article and copy it with the real key.
    const key = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('doc'));
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForTimeout(80);
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    const copied = await page.evaluate(() => {
      const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
      return new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes);
    });
    const expected = keptLines(lines, 2).map((i) => `${lines[i]}\n`).join('');
    assert.ok(expected.includes('​') && expected.includes('WARN'), 'the expectation holds the marker lines');
    assert.equal(copied, expected, 'the copy is the lines shown, each as the file has it, with nothing of a hidden line');
  });
});
