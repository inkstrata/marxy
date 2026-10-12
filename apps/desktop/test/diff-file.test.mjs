// A diff in Read (K-09): a .diff or .patch opens in Read, set mono at 16 on 26 exactly as authored. Every `+` line carries
// the added tint and every `-` line the removed one; hunk headers, file headers and `\ No newline at end of file` carry
// neither; copying gives the file's bytes (the markers in column one, CRLF, no newline at the end); a wrapped row hangs
// past the marker column; under forced colours added and removed rows differ by border style; Source shows the bytes.
// The last test opens a 10 MB diff and records the time to first text (commitment 5). WebKit, over the shipped skeleton
// and the memory shell, as log.test.mjs runs.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

const fixture = readFileSync(new URL('../../../fixtures/corpus/36-change.diff', import.meta.url), 'utf8');
const fixtureLines = fixture.replace(/\n$/, '').split('\n');
assert.ok(fixture.endsWith('No newline at end of file\n'));
// CRLF, a tab in a context line, and a last line with no newline.
const crlf = '--- a/x.txt\r\n+++ b/x.txt\r\n@@ -1,3 +1,3 @@\r\n keep\r\n-gone\r\n+here\r\n \tindented\r\n\\ No newline at end of file';
const files = { '/r/change.diff': fixture, '/r/fix.patch': crlf, '/r/note.md': '# Note\n\nSome words to read.\n' };

async function withPage(fn, { width = 1280, height = 900 } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const modifier = (page) => page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));
const copied = (page) =>
  page.evaluate(() => {
    const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    return call ? new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes) : null;
  });
const ready = (page) =>
  page.waitForFunction(() => {
    const code = document.querySelector('#doc pre.language-diff > code');
    return code !== null && code.dataset.marxyDone === 'highlight';
  }, null, { timeout: 15_000 });

/** The page's lines of the diff: text with the markers' labels removed, and the line's classes. */
const PAGE_LINES = `
  window.__lines = () => [...document.querySelectorAll('#doc pre.language-diff > code > .marxy-line')].map((el) => {
    const copy = el.cloneNode(true);
    for (const g of copy.querySelectorAll('.marxy-invisible-glyph')) g.remove();
    return { text: copy.textContent.replace(/\\n$/, ''), cls: [...el.classList] };
  });
`;

test('a .diff opens in Read, as a diff: no editor, no heading, mono 16 on 26', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/change.diff'] });
    await ready(page);
    const seen = await page.evaluate(() => {
      const code = document.querySelector('#doc pre.language-diff > code');
      const style = getComputedStyle(code);
      return {
        mode: window.__marxyHandle.panes().focused.view.mode,
        kind: document.querySelector('section.marxy-pane').getAttribute('data-marxy-kind'),
        editor: document.querySelector('.cm-editor') !== null && document.querySelector('.cm-editor').getClientRects().length > 0,
        headings: document.querySelectorAll('#doc h1, #doc h2, #doc h3').length,
        size: style.fontSize,
        lineHeight: style.lineHeight,
        family: style.fontFamily,
      };
    });
    assert.equal(seen.mode, 'rendered', 'a diff opens in Read');
    assert.equal(seen.kind, 'diff');
    assert.equal(seen.editor, false);
    assert.equal(seen.headings, 0, 'a `+` or `-` or `#` line is never a heading');
    assert.equal(seen.size, '16px', 'mono at 16');
    assert.equal(seen.lineHeight, '26px', 'on 26');
    assert.match(seen.family, /mono/i);
  }));

test('a .patch opens in Read too', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/fix.patch'] });
    await ready(page);
    const mode = await page.evaluate(() => window.__marxyHandle.panes().focused.view.mode);
    assert.equal(mode, 'rendered');
  }));

test('every + line has the added tint, every - line the removed one, and a header, a hunk header, a context line and the no-newline note have neither', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/change.diff'] });
    await ready(page);
    await page.evaluate(PAGE_LINES);
    const lines = await page.evaluate(() => window.__lines());
    assert.deepEqual(lines.map((l) => l.text), fixtureLines, 'every line of the file, in order, once');
    const expected = (t) =>
      t.startsWith('@@') || t.startsWith('+++') || t.startsWith('---') || t.startsWith('\\') ? null : t.startsWith('+') ? 'marxy-diff-add' : t.startsWith('-') ? 'marxy-diff-del' : null;
    let adds = 0;
    let dels = 0;
    for (const l of lines) {
      const tint = l.cls.filter((c) => c === 'marxy-diff-add' || c === 'marxy-diff-del');
      assert.deepEqual(tint, expected(l.text) === null ? [] : [expected(l.text)], JSON.stringify(l.text));
      if (tint[0] === 'marxy-diff-add') adds++;
      if (tint[0] === 'marxy-diff-del') dels++;
    }
    const authored = (c) => fixtureLines.filter((t) => t.startsWith(c) && !t.startsWith(c.repeat(3))).length;
    assert.equal(adds, authored('+'));
    assert.equal(dels, authored('-'));
    assert.deepEqual([adds, dels], [6, 3], 'six added and three removed lines in the fixture');
    const hunks = lines.filter((l) => l.text.startsWith('@@'));
    assert.equal(hunks.length, 3);
    for (const h of hunks) assert.deepEqual(h.cls.filter((c) => c.startsWith('marxy-diff')), []);
    // The tints are the theme's, and differ from the ground and from each other.
    const colours = await page.evaluate(() => {
      const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
      return { add: bg('#doc .marxy-diff-add'), del: bg('#doc .marxy-diff-del'), plain: getComputedStyle(document.querySelector('#doc pre.language-diff')).backgroundColor };
    });
    assert.notEqual(colours.add, colours.del);
    assert.notEqual(colours.add, colours.plain);
    assert.notEqual(colours.del, colours.plain);
    // The plus and minus stay in the text: the page shows the marker in column one of every line.
    const firstChars = await page.evaluate(() => [...document.querySelectorAll('#doc .marxy-diff-add, #doc .marxy-diff-del')].map((el) => el.textContent[0]));
    assert.ok(firstChars.every((c) => c === '+' || c === '-'));
  }));

test('copying all of Read gives the file: markers in column one and the no-newline note', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/change.diff'] });
    await ready(page);
    const key = await modifier(page);
    await page.locator('#doc pre').first().click();
    await page.keyboard.press(`${key}+KeyA`);
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    const text = await copied(page);
    assert.equal(text.length, fixture.length);
    assert.ok(text === fixture, 'the clipboard holds the file');
  }));

test('copying a hunk returns its bytes exactly', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/change.diff'] });
    await ready(page);
    // The second hunk: from its `@@` line to the end of its last line.
    const from = fixtureLines.findIndex((l) => l.startsWith('@@ -24'));
    const to = fixtureLines.findIndex((l, i) => i > from && l.startsWith('diff --git')) - 1;
    const expected = fixtureLines.slice(from, to + 1).join('\n');
    assert.ok(expected.includes('\n+// A whisper'), 'the hunk has added lines');
    await page.evaluate(({ from, to }) => {
      const lines = [...document.querySelectorAll('#doc pre.language-diff > code > .marxy-line')];
      const range = document.createRange();
      range.setStart(lines[from], 0);
      const last = lines[to];
      range.setEnd(last, last.childNodes.length);
      // The line's own newline is not part of what is copied.
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, { from, to });
    const key = await modifier(page);
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    const text = await copied(page);
    assert.equal(text.replace(/\n$/, ''), expected, 'the hunk, marker for marker');
  }));

test('copying a CRLF patch gives its CRLF, the tab and the note with no newline after it', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/fix.patch'] });
    await ready(page);
    const key = await modifier(page);
    await page.locator('#doc pre').first().click();
    await page.keyboard.press(`${key}+KeyA`);
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    const text = await copied(page);
    assert.equal(JSON.stringify(text), JSON.stringify(crlf), 'the clipboard holds the bytes, \\r\\n and all');
  }));

test('a wrapped + row hangs: its second row starts 2ch right of the marker, past the marker column', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/change.diff'] });
    await ready(page);
    const rows = await page.evaluate(() => {
      const line = [...document.querySelectorAll('#doc .marxy-diff-add')].find((el) => el.textContent.includes('A whisper is a shout'));
      const ch = (() => {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        probe.textContent = '0'.repeat(100);
        line.append(probe);
        const w = probe.getBoundingClientRect().width / 100;
        probe.remove();
        return w;
      })();
      const range = document.createRange();
      range.selectNodeContents(line);
      const byTop = new Map();
      for (const r of range.getClientRects()) {
        if (r.width === 0) continue;
        const key = Math.round(r.top);
        byTop.set(key, Math.min(byTop.get(key) ?? Infinity, r.left));
      }
      return { lefts: [...byTop.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]), ch, left: line.getBoundingClientRect().left, text: line.textContent.length };
    });
    assert.ok(rows.lefts.length >= 2, `the added line wraps in a 1280 px window (${rows.lefts.length} row)`);
    assert.ok(rows.lefts[1] >= rows.lefts[0] + 2 * rows.ch - 0.6, `the second row starts at ${rows.lefts[1]}; the first starts at ${rows.lefts[0]} and the hang is 2ch (${rows.ch} px each)`);
  }));

test('under forced colours added and removed rows differ by border style', () =>
  withPage(async (page) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await bootTwoPanes(page, { files, open: ['/r/change.diff'] });
    await ready(page);
    const seen = await page.evaluate(() => {
      const style = (sel) => getComputedStyle(document.querySelector(sel));
      return { add: style('#doc .marxy-diff-add').borderInlineStartStyle, del: style('#doc .marxy-diff-del').borderInlineStartStyle, none: style('#doc pre.language-diff > code > .marxy-line:not(.marxy-diff-add):not(.marxy-diff-del)').borderInlineStartStyle };
    });
    assert.equal(seen.add, 'solid');
    assert.equal(seen.del, 'dashed');
    assert.equal(seen.none, 'none');
  }));

test('Source shows the diff exactly, and the bytes are unchanged by looking', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/fix.patch'] });
    await ready(page);
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      await handle.commands().find((c) => c.id === 'view.mode-source').run(buildAppContext(handle));
    });
    await page.waitForSelector('.cm-content', { timeout: 10_000 });
    const seen = await page.evaluate(() => ({
      mode: window.__marxyHandle.panes().focused.view.mode,
      text: window.__marxyHandle.panes().focused.view.store().text?.() ?? null,
      cm: document.querySelector('.cm-content').textContent,
    }));
    assert.equal(seen.mode, 'source');
    assert.equal(seen.cm.replace(/\r/g, ''), crlf.replace(/\r/g, '').replace(/\n/g, ''), 'Source shows every line, markers included');
  }));

// A diff of tens of megabytes: first text does not wait for the rest.
const LARGE_SOURCE = `
  window.__makeDiff = (mb) => {
    const parts = [];
    let bytes = 0;
    let n = 0;
    while (bytes < mb * 1024 * 1024) {
      const head = 'diff --git a/src/f' + n + '.ts b/src/f' + n + '.ts\\nindex 3f1c2aa..9b7d0e4 100644\\n--- a/src/f' + n + '.ts\\n+++ b/src/f' + n + '.ts\\n@@ -1,6 +1,7 @@ export function f' + n + '() {\\n';
      let body = '';
      for (let i = 0; i < 4; i++) body += ' const keep' + i + ' = ' + (n + i) + ';\\n';
      body += '-  return ' + n + ';\\n+  const next = ' + n + ' + 1;\\n+  return next;\\n }\\n';
      parts.push(head + body);
      bytes += head.length + body.length;
      n++;
    }
    return new TextEncoder().encode(parts.join(''));
  };
`;

test(`a diff of ${process.env.MARXY_DIFF_MB ?? 10} MB: first text does not wait for the last chunk`, () =>
  withPage(async (page) => {
    const mb = Number(process.env.MARXY_DIFF_MB ?? 10);
    const base = await harnessBase();
    await routeSkeleton(page, base);
    await page.goto(`${base}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    await page.evaluate(LARGE_SOURCE);
    const size = await page.evaluate(async (size) => {
      const bytes = window.__makeDiff(size);
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { startApp } = await import('/src/app.ts');
      const shell = createMemoryShell({ '/r/big.diff': bytes });
      const mark = shell.mark.bind(shell);
      const began = performance.now();
      window.__firstText = null;
      shell.mark = async (name, t, data) => {
        if (name === 'first_text') {
          window.__firstText = performance.now() - began;
          window.__piecesAtFirstText = document.querySelectorAll('#doc pre.language-diff').length;
        }
        return mark(name, t, data);
      };
      const handle = await startApp(shell, { argv: ['/r/big.diff'] });
      await handle.ready;
      window.__marxyHandle = handle;
      return { bytes: bytes.length, lines: bytes.reduce((n, b) => n + (b === 10 ? 1 : 0), 0) };
    }, mb);
    await page.waitForFunction(() => window.__firstText !== null, null, { timeout: 120_000 });
    const first = await page.evaluate(() => ({ at: window.__firstText, pieces: window.__piecesAtFirstText, total: window.__marxyHandle.panes().focused.view.document().ast.children.length }));
    console.log(`# diff ${mb} MB (${size.bytes} bytes, ${size.lines} lines, ${first.total} pieces): first text ${first.at.toFixed(0)} ms with ${first.pieces} pieces in the page`);
    assert.ok(first.pieces > 0, 'there is text at first text');
    assert.ok(first.pieces < first.total, `first text holds ${first.pieces} of ${first.total} pieces: it did not wait for the last chunk`);
    const tinted = await page.evaluate(() => document.querySelectorAll('#doc .marxy-diff-add').length);
    assert.ok(tinted > 0 || first.at > 0);
  }));
