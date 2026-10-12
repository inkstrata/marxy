// The Source frame (V-05, WebKit): the bars say only what the bytes say, the ruler sits on the text's character grid, the bars
// never cover text and do not move when it scrolls, the column keeps ADR-0067's measure inside the frame, the marks sit at
// exact bytes, and none of it is a focus stop or a live region. The real app over the memory shell, with the shipped
// skeleton's own CSS (index.html), so the frame is laid out by the rules the app ships.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';
import { closeHarness, harnessBase, shippedSkeleton } from '../../test/support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const enc = new TextEncoder();
const bytes = (...parts) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...enc.encode(p)] : p)));

/** Boots the app on `open` (a path in `files`), in Source: a code file opens there; Markdown is sent there with Mod+E. */
async function boot(page, files, open, { source = true } = {}) {
  const base = await harnessBase();
  const { style, body } = shippedSkeleton();
  await page.route(`${base}app.html`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace('</head>', `<style>${style}</style></head>`)
      .replace(/<body[^>]*>/, '<body data-marxy-mode="rendered" data-marxy-variant="dark">')
      .replace('<article id="doc" class="marxy-article"></article>', body);
    await route.fulfill({ response, body: html });
  });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const encoded = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, Buffer.from(content).toString('base64')]));
  await page.evaluate(async ({ encoded, open }) => {
    const raw = {};
    for (const [path, text] of Object.entries(encoded)) raw[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const { bootApplication } = await import('/src/main.ts');
    const shell = createMemoryShell(raw);
    const handle = await bootApplication(shell, { argv: [open] });
    await handle.ready;
    window.__h = handle;
    window.__shell = shell;
  }, { encoded, open });
  if (source && /\.md$/.test(open)) await page.keyboard.press('Meta+E');
  await page.waitForSelector('#marxy-source .cm-line');
  await page.evaluate(() => document.fonts.ready);
}

async function withPage(fn, viewport = { width: 1440, height: 900 }) {
  const browser = await launchWebkit();
  try {
    return await fn(await browser.newPage({ viewport }));
  } finally {
    await browser.close();
  }
}

const fact = (page, name) => page.evaluate((n) => document.querySelector(`.marxy-source-fact[data-fact="${n}"]`)?.textContent ?? null, name);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const rect = (page, sel) =>
  page.evaluate((s) => {
    const b = document.querySelector(s)?.getBoundingClientRect();
    return b ? { left: b.left, top: b.top, width: b.width, height: b.height, right: b.right, bottom: b.bottom } : null;
  }, sel);
/** Places the caret (and a selection) in the editor of the focused pane. */
const select = (page, anchor, head = anchor) =>
  page.evaluate(async ({ anchor, head }) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    activeSourceEditor().view.dispatch({ selection: { anchor, head } });
  }, { anchor, head });
const readout = (page) => text(page, '.marxy-source-readout');

test('V-05 the top bar says what the bytes are: line endings, BOM, bytes that are not UTF-8, indentation, size and lines', async () => {
  const cases = [
    { name: 'a CRLF file says CRLF', file: bytes('x = 1\r\ny = 2\r\n'), want: { endings: 'CRLF', encoding: 'UTF-8', size: '14 bytes', lines: '2 lines' } },
    { name: 'a mixed file says Mixed', file: bytes('a = 1\r\nb = 2\nc = 3\r\n'), want: { endings: 'Mixed', size: '20 bytes', lines: '3 lines' } },
    { name: 'a lone-CR file says CR', file: bytes('a = 1\rb = 2\r'), want: { endings: 'CR', lines: '2 lines' } },
    { name: 'a BOM file says UTF-8 with BOM', file: bytes([0xef, 0xbb, 0xbf], 'x = 1\n'), want: { encoding: 'UTF-8 with BOM', size: '9 bytes', lines: '1 line' } },
    { name: 'bytes that are not UTF-8 are named and counted', file: bytes('x = "', [0xe9, 0xff], '"\n'), want: { encoding: 'Not valid UTF-8 · 2 bytes', size: '9 bytes' } },
    { name: 'two-space indentation', file: bytes('def f():\n  x = 1\n  if x:\n    y = 2\n'), want: { indent: '2 spaces', endings: 'LF' } },
    { name: 'tabs, at the width the editor draws them', file: bytes('f {\n\ta;\n\tb;\n}\n'), want: { indent: /^Tabs, width \d+$/ } },
    { name: 'no indented line, nothing said of indentation', file: bytes('a = 1\nb = 2\n'), want: { indent: '' } },
  ];
  for (const c of cases) {
    await withPage(async (page) => {
      await boot(page, { '/p/a.py': c.file }, '/p/a.py');
      for (const [key, want] of Object.entries(c.want)) {
        const got = await fact(page, key);
        if (want instanceof RegExp) assert.match(got, want, `${c.name}: ${key}`);
        else assert.equal(got, want, `${c.name}: ${key} (${got})`);
      }
    });
  }
});

test('V-05 the path is quiet segments and the file is named last', async () => {
  await withPage(async (page) => {
    await boot(page, { '/Users/reader/Work/a.py': bytes('x = 1\n') }, '/Users/reader/Work/a.py');
    const segs = await page.evaluate(() => [...document.querySelectorAll('.marxy-source-seg')].map((s) => s.textContent));
    assert.deepEqual(segs, ['Users', 'reader', 'Work', 'a.py']);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-source-seg-file').textContent), 'a.py');
  });
});

test('V-05 the bottom bar says line, column and byte offset, and the code point after the caret (U+200B by name)', async () => {
  await withPage(async (page) => {
    // Line 1 is 9 bytes with its break (é is two); line 2 holds a zero width space after the b.
    await boot(page, { '/p/a.py': bytes('a = "é"\nb\u200b = 1\nc\n') }, '/p/a.py');
    await page.waitForFunction(() => document.querySelector('.marxy-source-readout')?.textContent?.startsWith('Ln 1, Col 1'));
    assert.equal(await readout(page), 'Ln 1, Col 1 · byte 0');
    assert.equal(await text(page, '.marxy-source-character'), 'U+0061 a');
    await select(page, 5);
    await page.waitForFunction(() => document.querySelector('.marxy-source-character')?.textContent === 'U+00E9 é');
    assert.equal(await readout(page), 'Ln 1, Col 6 · byte 5');
    await select(page, 6);
    await page.waitForFunction(() => document.querySelector('.marxy-source-readout')?.textContent === 'Ln 1, Col 7 · byte 7');
    // The character after the caret on line 2, at its second column.
    await select(page, 9);
    await page.waitForFunction(() => document.querySelector('.marxy-source-character')?.textContent === 'U+200B ZERO WIDTH SPACE');
    assert.equal(await readout(page), 'Ln 2, Col 2 · byte 10');
    // The end of a line is its break; the end of the file says so.
    await select(page, 7);
    await page.waitForFunction(() => document.querySelector('.marxy-source-character')?.textContent === 'U+000A LINE FEED');
    await select(page, await page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().view.state.doc.length));
    await page.waitForFunction(() => document.querySelector('.marxy-source-character')?.textContent === 'End of file');
    // A selection says how long it is, in characters and in bytes.
    await select(page, 5, 7);
    await page.waitForFunction(() => document.querySelector('.marxy-source-selected')?.textContent === '2 characters, 3 bytes selected');
  });
});

test('V-05 the bottom bar says CRLF at the end of a line in a CRLF file, and the byte offset counts both bytes', async () => {
  await withPage(async (page) => {
    await boot(page, { '/p/a.py': bytes('ab\r\ncd\r\n') }, '/p/a.py');
    await select(page, 2);
    await page.waitForFunction(() => document.querySelector('.marxy-source-character')?.textContent === 'U+000D U+000A CRLF');
    await select(page, 3);
    await page.waitForFunction(() => document.querySelector('.marxy-source-readout')?.textContent === 'Ln 2, Col 1 · byte 4');
  });
});

test('V-05 the byte count follows the reader\'s edits exactly (multi-byte text, breaks, a deletion and its undo)', async () => {
  for (const [name, file] of [['LF', bytes('one\ntwo\n')], ['CRLF', bytes('one\r\ntwo\r\n')], ['a BOM', bytes([0xef, 0xbb, 0xbf], 'one\ntwo\n')]]) {
    await withPage(async (page) => {
      await boot(page, { '/p/a.py': file }, '/p/a.py');
      const sizeNow = () => page.evaluate(async () => {
        const { activeSourceEditor } = await import('/src/source/editor.ts');
        const ed = activeSourceEditor();
        return { shown: document.querySelector('.marxy-source-fact[data-fact="size"]').textContent, real: new TextEncoder().encode(ed.docText()).length + (ed.buffer.bom ? 3 : 0) };
      });
      const agrees = async (what) => {
        await page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => r(true))));
        const { shown, real } = await sizeNow();
        assert.equal(shown, `${real.toLocaleString('en-US')} ${real === 1 ? 'byte' : 'bytes'}`, `${name}: ${what}`);
      };
      await agrees('opened');
      await page.click('#marxy-source .cm-content');
      await page.keyboard.press('Meta+ArrowUp');
      await page.keyboard.insertText('é€😀');
      await page.keyboard.press('Enter');
      await agrees('after typing é€😀 and a break');
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Backspace');
      await agrees('after deleting everything');
      assert.equal((await sizeNow()).shown, name === 'a BOM' ? '3 bytes' : '0 bytes');
      await page.keyboard.press('Meta+z');
      await agrees('after the undo');
    });
  }
});

test('V-05 the ruler\'s tick for column N is within half a pixel of character N\'s centre, at 14 and 18 px, scrolled or not', async () => {
  const line = `${'0123456789'.repeat(21)}`;
  const file = bytes('x = 1\n', `y = "${line}"\n`, 'z = 2\n');
  await withPage(async (page) => {
    await boot(page, { '/p/a.py': file }, '/p/a.py');
    const measure = () => page.evaluate(() => {
      const longest = [...document.querySelectorAll('#marxy-source .cm-line')].sort((a, b) => b.textContent.length - a.textContent.length)[0];
      // The centre of the Nth character of the line, from a Range over it.
      const centre = (n) => {
        let seen = 0;
        const walker = document.createTreeWalker(longest, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (n - 1 < seen + node.length) {
            const range = document.createRange();
            range.setStart(node, n - 1 - seen);
            range.setEnd(node, n - seen);
            const b = range.getBoundingClientRect();
            return b.left + b.width / 2;
          }
          seen += node.length;
        }
        return null;
      };
      const clip = document.querySelector('.marxy-source-ruler-clip').getBoundingClientRect();
      const out = [];
      for (const tick of document.querySelectorAll('.marxy-source-ruler-tick')) {
        const col = Number(getComputedStyle(tick).getPropertyValue('--marxy-col'));
        const b = tick.getBoundingClientRect();
        const x = b.left + b.width / 2;
        if (x < clip.left + 2 || x > clip.right - 2) continue;
        const want = centre(col);
        if (want !== null) out.push({ col, err: Math.abs(x - want) });
      }
      return out;
    });
    const waitRuler = () => page.waitForFunction(() => document.querySelectorAll('.marxy-source-ruler-tick').length > 5);
    await waitRuler();
    for (const [size, lineBox] of [[14, 21], [18, 27]]) {
      await page.evaluate(({ size, lineBox }) => {
        document.documentElement.style.setProperty('--marxy-size-source', `${size}px`);
        document.documentElement.style.setProperty('--marxy-line-box-source', `${lineBox}px`);
      }, { size, lineBox });
      await page.waitForTimeout(400);
      for (const scrollLeft of [0, 700]) {
        await page.evaluate((x) => { document.querySelector('#marxy-source .cm-scroller').scrollLeft = x; }, scrollLeft);
        await page.waitForTimeout(300);
        const ticks = await measure();
        assert.ok(ticks.length >= 8, `${size}px, scrolled ${scrollLeft}: ${ticks.length} ticks measured`);
        const worst = ticks.reduce((a, b) => (b.err > a.err ? b : a));
        console.log(`ruler at ${size}px, scrolled ${scrollLeft}: ${ticks.length} ticks, worst error ${worst.err.toFixed(3)} px at column ${worst.col}`);
        assert.ok(worst.err < 0.5, `${size}px, scrolled ${scrollLeft}: column ${worst.col} is ${worst.err} px off`);
      }
    }
  });
});

test('V-05 the ruler marks the caret column and a selection on one line, and the numbers are every tenth', async () => {
  await withPage(async (page) => {
    await boot(page, { '/p/a.py': bytes('abcdefghijklmnopqrstuvwxyz\n') }, '/p/a.py');
    await page.waitForSelector('.marxy-source-ruler-num');
    const nums = await page.evaluate(() => [...document.querySelectorAll('.marxy-source-ruler-num:not([hidden])')].map((n) => n.textContent).slice(0, 4));
    assert.deepEqual(nums, ['10', '20', '30', '40']);
    await select(page, 9);
    await page.waitForFunction(() => !document.querySelector('.marxy-source-ruler-caret').hidden);
    const at = await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const view = activeSourceEditor().view;
      const caret = document.querySelector('.marxy-source-ruler-caret').getBoundingClientRect();
      const after = view.coordsAtPos(9);
      const cw = view.defaultCharacterWidth;
      return { notch: caret.left + caret.width / 2, want: after.left + cw / 2 };
    });
    assert.ok(Math.abs(at.notch - at.want) < 1, `the notch is centred on the character after the caret (${at.notch} vs ${at.want})`);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-source-ruler-span').hidden), true, 'no selection, no span');
    await select(page, 3, 8);
    await page.waitForFunction(() => !document.querySelector('.marxy-source-ruler-span').hidden);
    const span = await page.evaluate(() => document.querySelector('.marxy-source-ruler-span').getBoundingClientRect().width);
    assert.ok(Math.abs(span - 5 * (await page.evaluate(async () => (await import('/src/source/editor.ts')).activeSourceEditor().view.defaultCharacterWidth))) < 1, `five characters selected: ${span}px`);
  });
});

test('V-05 the ruler is hidden with soft wrap (Markdown) and below 520 px', async () => {
  await withPage(async (page) => {
    await boot(page, { '/p/a.md': bytes('# A\n\ntext\n') }, '/p/a.md');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-source-ruler')), null, 'Markdown wraps, so there is no ruler to build');
  });
  await withPage(async (page) => {
    await boot(page, { '/p/a.py': bytes('x = 1\n') }, '/p/a.py');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.marxy-source-ruler')).display), 'none');
  }, { width: 1200, height: 700 });
  await withPage(async (page) => {
    await boot(page, { '/p/a.py': bytes('x = 1\n') }, '/p/a.py');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.marxy-source-ruler')).display), 'none');
    // The folders go with it; the file's name stays.
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.marxy-source-seg-file')).display !== 'none'), true);
  }, { width: 480, height: 700 });
});

test('V-05 the bars never cover text and scrolling does not move them', async () => {
  const lines = Array.from({ length: 300 }, (_, i) => `value_${i} = ${i}`).join('\n');
  await withPage(async (page) => {
    await boot(page, { '/p/a.py': bytes(`${lines}\n`) }, '/p/a.py');
    const geometry = () => page.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.top, b.bottom, b.left, b.right]; };
      return { top: r('.marxy-source-top'), ruler: r('.marxy-source-ruler'), bottom: r('.marxy-source-bottom'), scroller: r('#marxy-source .cm-scroller'), frame: r('.marxy-source-frame') };
    });
    const before = await geometry();
    assert.ok(before.top[1] <= before.ruler[0] + 0.01 && before.ruler[1] <= before.scroller[0] + 0.01, 'the top bar and the ruler end where the text begins');
    assert.ok(before.scroller[1] <= before.bottom[0] + 0.01, 'the text ends where the bottom bar begins');
    assert.ok(before.frame[0] <= before.top[0] && before.bottom[1] <= before.frame[1] + 0.01, 'everything is inside the frame');
    await page.evaluate(() => { document.querySelector('#marxy-source .cm-scroller').scrollTop = 1500; });
    await page.waitForTimeout(300);
    const after = await geometry();
    assert.deepEqual(after, before, 'the bars and the frame did not move with the scroll');
    assert.ok(await page.evaluate(() => document.querySelector('#marxy-source .cm-scroller').scrollTop > 1000), 'the text did scroll');
    // No visible row is under a bar: the point at each row's centre is the editor's, never a bar's.
    const covered = await page.evaluate(() => {
      const bad = [];
      for (const row of document.querySelectorAll('#marxy-source .cm-line')) {
        const b = row.getBoundingClientRect();
        const body = document.querySelector('.marxy-source-body').getBoundingClientRect();
        if (b.bottom <= body.top || b.top >= body.bottom) continue;
        const y = Math.min(Math.max(b.top + b.height / 2, body.top + 1), body.bottom - 1);
        const hit = document.elementFromPoint(b.left + 4, y);
        if (hit && hit.closest('.marxy-source-top, .marxy-source-ruler, .marxy-source-bottom')) bad.push(row.textContent);
      }
      return bad;
    });
    assert.deepEqual(covered, [], 'no row is under a bar');
  }, { width: 1200, height: 700 });
});

test('V-05 the frame is 960 px and centred folded, fills the pane unfolded; the column keeps ADR-0067\'s measure inside it', async () => {
  await withPage(async (page) => {
    await boot(page, { '/p/a.md': bytes('# A\n\nSome text that is a line.\n') }, '/p/a.md');
    const frame = await rect(page, '.marxy-source-frame');
    assert.equal(Math.round(frame.width), 960);
    assert.ok(Math.abs(frame.left + frame.width / 2 - 720) < 1, `centred in the window (${frame.left})`);
    // The measure is Rendered's, in pixels (ADR-0067 item 6): the same calc, resolved in the page.
    const col = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.width = 'calc(clamp(45, var(--marxy-measure-chars, 66), 80) * var(--marxy-avg-char, 0.463) * var(--marxy-size-body, 20px))';
      // Resolved where the editor resolves it: the Source mount re-declares the body size (K-05b).
      document.querySelector('.marxy-source-mount').append(probe);
      const want = probe.getBoundingClientRect().width;
      probe.remove();
      const c = document.querySelector('#marxy-source .cm-content').getBoundingClientRect();
      const e = document.querySelector('#marxy-source .cm-editor').getBoundingClientRect();
      return { want, got: c.width, centre: c.left + c.width / 2, editorCentre: e.left + e.width / 2 };
    });
    assert.ok(Math.abs(col.got - col.want) < 1, `the column is ${col.got} px, the measure ${col.want} px`);
    assert.ok(Math.abs(col.centre - col.editorCentre) < 1, 'the column is centred in the frame');
    await page.evaluate(() => window.__h.workspace().unfold());
    await page.waitForTimeout(500);
    const mount = await rect(page, '.marxy-source-mount');
    const inset = await rect(page, '.marxy-source-frame');
    assert.ok(Math.abs(inset.left - mount.left - 12) < 1 && Math.abs(mount.right - inset.right - 12) < 1, `unfolded the frame is inset 12 px from its pane (${inset.left - mount.left}, ${mount.right - inset.right})`);
    assert.ok(Math.abs(inset.width - (mount.width - 24)) < 1, `unfolded it fills its pane (${inset.width} in ${mount.width})`);
  });
});

test('V-05 invisible characters and find matches have marks at the height of their bytes; a click selects them', async () => {
  const lines = Array.from({ length: 200 }, (_, i) => (i === 49 ? `needle\u200b = ${i}` : `value_${i} = ${i}`)).join('\n');
  await withPage(async (page) => {
    await boot(page, { '/p/a.py': bytes(`${lines}\n`) }, '/p/a.py');
    await page.waitForSelector('.marxy-source-mark-invisible');
    const mark = await page.evaluate(() => {
      const m = document.querySelector('.marxy-source-mark-invisible');
      const body = document.querySelector('.marxy-source-marks').getBoundingClientRect();
      const b = m.getBoundingClientRect();
      return { title: m.title, at: (b.top + b.height / 2 - body.top) / body.height };
    });
    assert.match(mark.title, /^U\+200B ZERO WIDTH SPACE at 50:7$/);
    assert.ok(Math.abs(mark.at - 50 / 201) < 0.03, `line 50 of 201 sits a quarter of the way down the strip (${mark.at})`);
    await page.click('.marxy-source-mark-invisible');
    await page.waitForFunction(() => document.querySelector('.marxy-source-readout')?.textContent?.startsWith('Ln 50, Col 7'));
    assert.equal(await text(page, '.marxy-source-character'), 'U+200B ZERO WIDTH SPACE');
    // Find: the matches of the query while the panel is open, and none once it is shut.
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-source-mark-find').length), 0);
    await page.keyboard.press('Meta+f');
    await page.waitForSelector('.cm-search input[name=search]');
    // The panel commits a query on a key press or a change, not on the input event `fill` sends.
    await page.locator('.cm-search input[name=search]').click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('value_1');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-source-mark-find').length > 3);
    const first = await page.evaluate(() => document.querySelector('.marxy-source-mark-find').title);
    assert.match(first, /^Find match at 2:1$/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-source-mark-find').length === 0);
  }, { width: 1200, height: 700 });
});

test('V-05 find in Source still opens its panel inside the frame and finds the text', async () => {
  await withPage(async (page) => {
    await boot(page, { '/p/a.py': bytes('alpha = 1\nbeta = 2\nalpha = 3\n') }, '/p/a.py');
    await page.click('#marxy-source .cm-content');
    await page.keyboard.press('Meta+f');
    await page.waitForSelector('.marxy-source-frame .cm-search input[name=search]');
    await page.fill('.cm-search input[name=search]', 'alpha');
    await page.keyboard.press('Enter');
    await page.waitForFunction(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const { state } = activeSourceEditor().view;
      const { from, to } = state.selection.main;
      return state.sliceDoc(from, to) === 'alpha';
    });
    const panel = await rect(page, '.cm-panels');
    const body = await rect(page, '.marxy-source-body');
    assert.ok(panel.top >= body.top - 0.5 && panel.bottom <= body.bottom + 0.5, 'the panel is inside the editor, between the bars');
  });
});

test('V-05 the bars are not focus stops or live regions, and the strip and ruler are hidden from a screen reader', async () => {
  await withPage(async (page) => {
    await boot(page, { '/p/a.py': bytes('x = 1\n') }, '/p/a.py');
    const found = await page.evaluate(() => {
      const frame = document.querySelector('.marxy-source-frame');
      const bars = [...frame.querySelectorAll('.marxy-source-top, .marxy-source-bottom, .marxy-source-ruler, .marxy-source-marks')];
      return {
        stops: bars.flatMap((b) => [...b.querySelectorAll('a, button, input, select, textarea, [tabindex], [contenteditable]')]).length,
        // CodeMirror's own announcer lives in the editor; the bars hold none.
        live: bars.flatMap((b) => [b, ...b.querySelectorAll('*')]).filter((n) => n.matches('[aria-live], [role="status"], [role="alert"], [role="log"]')).length,
        ruler: document.querySelector('.marxy-source-ruler').getAttribute('aria-hidden'),
        strip: document.querySelector('.marxy-source-marks').getAttribute('aria-hidden'),
        bottom: document.querySelector('.marxy-source-bottom').getAttribute('aria-label'),
      };
    });
    assert.deepEqual(found, { stops: 0, live: 0, ruler: 'true', strip: 'true', bottom: 'Caret position' });
    // Tab from the editor goes on to the next thing; the editor has no trap and no bar takes the key.
    await page.click('#marxy-source .cm-content');
    await page.keyboard.press('Escape');
    const active = await page.evaluate(() => document.activeElement?.closest('.marxy-source-top, .marxy-source-bottom, .marxy-source-ruler') !== null);
    assert.equal(active, false);
  });
});

test('V-05 first text never waits for the frame: the bars are in the page, filled, when the first line is', async () => {
  await withPage(async (page) => {
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        if (window.__first || !document.querySelector('.cm-line')) return;
        window.__first = {
          top: document.querySelector('.marxy-source-top')?.textContent ?? null,
          bottom: document.querySelector('.marxy-source-bottom')?.textContent ?? null,
        };
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await boot(page, { '/p/a.py': bytes('x = 1\ny = 2\n') }, '/p/a.py');
    const first = await page.evaluate(() => window.__first);
    assert.ok(first, 'a first line was seen');
    assert.match(first.top, /a\.py.*UTF-8.*LF.*12 bytes.*2 lines/, `the top bar was filled with the first line (${first.top})`);
    assert.match(first.bottom, /^Ln 1, Col 1 · byte 0/, `the bottom bar was filled with the first line (${first.bottom})`);
  });
});

test('V-05 a change on disk updates what the bars say (a reload: another line ending, size and lines)', async () => {
  await withPage(async (page) => {
    await boot(page, { '/p/a.py': bytes('a = 1\nb = 2\n') }, '/p/a.py');
    assert.equal(await fact(page, 'endings'), 'LF');
    await page.evaluate(async () => {
      const marks = () => window.__shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
      const before = marks();
      await window.__shell.writeFileAtomic('/p/a.py', new TextEncoder().encode('a = 1\r\nb = 2\r\nc = 3\r\n'));
      window.__shell.emit([{ kind: 'modified', path: '/p/a.py' }]);
      for (let i = 0; i < 500 && marks() === before; i++) await new Promise((r) => setTimeout(r, 10));
    });
    await page.waitForFunction(() => document.querySelector('.marxy-source-fact[data-fact="endings"]')?.textContent === 'CRLF');
    assert.equal(await fact(page, 'lines'), '3 lines');
    assert.equal(await fact(page, 'size'), '21 bytes');
  });
});
