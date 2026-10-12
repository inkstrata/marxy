// A log in Read (K-08): it opens as Read, the level word is weight 700 and the timestamp the comment colour, an ERROR line
// carries a rule, ESC is shown as a picture and copied as the byte, and the level filter hides lines by level, says how
// many it hides, and shows them again on a click. WebKit, over the shipped skeleton and the memory shell, as
// transcript.test.mjs runs. The last test opens a log of tens of megabytes and records the time to first text and to a
// filtered page (commitment 5); the numbers are printed, and what is asserted is that first text does not wait.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';
import { keptLines } from '../src/kinds/log-filter.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

const fixture = readFileSync(new URL('../../../fixtures/corpus/35-build.log', import.meta.url), 'utf8');
const fixtureLines = fixture.replace(/\n$/, '').split('\n');
const files = {
  '/r/build.log': fixture,
  '/r/headed.log': `# Release 4\n\n## Notes\n${fixture}`,
  '/r/note.md': '# Note\n\nSome words to read.\n',
};

async function withPage(fn, { width = 1280, height = 900, sample = false } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    // A sampler on every frame from before the page's scripts: the number of frames a heading was painted in #doc.
    if (sample) {
      await page.addInitScript(() => {
        window.__headings = 0;
        window.__frames = 0;
        const tick = () => {
          window.__frames++;
          const h = document.querySelector('#doc h1, #doc h2, #doc h3');
          if (h && h.getClientRects().length > 0) window.__headings++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** The log's pieces highlighted: the last one's colour has arrived. */
const coloured = (page) =>
  page.waitForFunction(() => {
    const code = document.querySelector('#doc pre.language-log > code');
    return code !== null && code.dataset.marxyDone === 'highlight';
  }, null, { timeout: 15_000 });

const mode = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.view.mode);
const open = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};

/** A line's text as the file has it: the markers' labels are the page's, not the file's. */
const PAGE_HELPERS = `
  window.__lineText = (el) => {
    const copy = el.cloneNode(true);
    for (const g of copy.querySelectorAll('.marxy-invisible-glyph, .marxy-log-hidden-run')) g.remove();
    return copy.textContent;
  };
  window.__shownLines = () => [...document.querySelectorAll('#doc pre.language-log > code > .marxy-line')]
    .filter((l) => !l.classList.contains('marxy-log-hidden') && l.getClientRects().length > 0)
    .map((l) => window.__lineText(l));
  window.__runs = () => [...document.querySelectorAll('#doc .marxy-log-hidden-run')]
    .map((r) => ({ words: r.textContent, count: Number(r.getAttribute('data-marxy-log-hidden')), shown: r.getClientRects().length > 0 }));
`;

/** Runs Filter by level and chooses `id` from its menu, then waits for the filter to have handled every piece. */
async function chooseLevel(page, id) {
  await page.evaluate(PAGE_HELPERS);
  await page.evaluate(async () => {
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const handle = window.__marxyHandle;
    await handle.commands().find((c) => c.id === 'log.filter-level').run(buildAppContext(handle));
  });
  await page.click(`[data-row-key="log.level.${id}"]`);
  await settled(page, id);
}

async function settled(page, id) {
  if (id !== 'all') {
    await page.waitForFunction(async () => {
      const { filterOf } = await import('/src/kinds/log-view.ts');
      const view = window.__marxyHandle.panes().focused;
      return filterOf(view.article, view.view.store()) !== undefined;
    }, null, { timeout: 15_000 });
  }
  await page.evaluate(async () => {
    const { filterOf } = await import('/src/kinds/log-view.ts');
    const view = window.__marxyHandle.panes().focused;
    await filterOf(view.article, view.view.store())?.settled();
  });
}

/** The text of the last copy the page made. */
const copied = (page) =>
  page.evaluate(() => {
    const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    return call ? new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes) : null;
  });
const modifier = (page) => page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));

test('a .log opens in Read with no heading painted from a # line in any frame, as the log it is', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/headed.log'] });
    await coloured(page);
    await page.waitForTimeout(150);
    const seen = await page.evaluate(() => ({
      mode: window.__marxyHandle.panes().focused.view.mode,
      kind: document.querySelector('section.marxy-pane').getAttribute('data-marxy-kind'),
      headings: window.__headings,
      frames: window.__frames,
      pieces: document.querySelectorAll('#doc pre.language-log.marxy-run').length,
      anyHeading: document.querySelectorAll('#doc h1, #doc h2, #doc h3').length,
      editor: document.querySelector('.cm-editor') !== null && document.querySelector('.cm-editor').getClientRects().length > 0,
    }));
    assert.equal(seen.mode, 'rendered', 'a log opens in Read');
    assert.equal(seen.kind, 'log');
    assert.ok(seen.frames > 3, `${seen.frames} frames were sampled`);
    assert.equal(seen.headings, 0, 'no heading was painted in any frame');
    assert.equal(seen.anyHeading, 0);
    assert.ok(seen.pieces >= 1);
    assert.equal(seen.editor, false, 'Source is not what opened');
  }, { sample: true }));

test('the level word is weight 700 and the colour of its line, the timestamp is the comment colour, frames are present and unfolded', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'] });
    await coloured(page);
    const seen = await page.evaluate(() => {
      const css = (el) => getComputedStyle(el);
      const probe = document.createElement('i');
      probe.style.color = 'var(--marxy-tok-comment)';
      document.querySelector('#doc').append(probe);
      const comment = css(probe).color;
      probe.remove();
      const error = [...document.querySelectorAll('#doc .marxy-log-level')].find((el) => el.textContent === 'ERROR');
      const line = error.closest('.marxy-line');
      const time = line.querySelector('.marxy-log-time');
      const info = [...document.querySelectorAll('#doc .marxy-log-level')].find((el) => el.textContent === 'INFO');
      const body = css(line.parentElement);
      const lines = [...line.parentElement.querySelectorAll(':scope > .marxy-line')];
      const at = lines.indexOf(line);
      const root = css(document.documentElement);
      return {
        offset: root.getPropertyValue('--marxy-weight-offset').trim(),
        weight: css(error).fontWeight,
        bodyWeight: css(line).fontWeight,
        infoWeight: css(info).fontWeight,
        errorColour: css(error).color,
        lineColour: css(line).color,
        timeColour: css(time).color,
        timeStyle: css(time).fontStyle,
        comment,
        rule: css(line).borderInlineStartColor,
        ruleWidth: css(line).borderInlineStartWidth,
        frameRule: css(lines[at + 1]).borderInlineStartColor,
        plainRule: css(lines[0]).borderInlineStartColor,
        frames: lines.slice(at + 1, at + 4).map((l) => ({ text: l.textContent, shown: l.getClientRects().length > 0 })),
        size: body.fontSize,
        lineHeight: body.lineHeight,
        levelTimes: document.querySelectorAll('#doc .marxy-log-time').length,
        folded: document.querySelectorAll('#doc details, #doc [hidden], #doc .marxy-log-hidden-run').length,
      };
    });
    // Weight 700; the platform's weight offset (set per machine, 0 on most) is added to every weight.
    const expectedWeight = String(700 + Number(seen.offset));
    assert.equal(seen.weight, expectedWeight, `the ERROR word is weight 700 (+ offset ${seen.offset})`);
    assert.ok(Number(seen.bodyWeight) < Number(seen.weight), `against ${seen.bodyWeight} for the line`);
    assert.equal(seen.infoWeight, expectedWeight, 'every level word, not only the errors');
    assert.equal(seen.errorColour, seen.lineColour, 'the level is weight, not a hue');
    assert.equal(seen.timeColour, seen.comment, 'the timestamp is in the comment colour');
    assert.notEqual(seen.timeStyle, 'italic');
    assert.equal(seen.levelTimes, fixtureLines.filter((l) => /^\d{4}-/.test(l)).length, 'a timestamp on every head');
    assert.equal(seen.ruleWidth, '2px');
    assert.notEqual(seen.rule, 'rgba(0, 0, 0, 0)', 'the ERROR line carries a rule');
    assert.equal(seen.frameRule, seen.rule, 'and so do the frames that continue it');
    assert.equal(seen.plainRule, 'rgba(0, 0, 0, 0)', 'a line below ERROR has none');
    assert.deepEqual(seen.frames.map((f) => f.text.trim()), ['at parseReading (src/loader/readings.ts:88:41)', 'at loadGauge (src/loader/gauges.ts:140:12)', 'at async refresh (src/loader/index.ts:57:5)']);
    assert.ok(seen.frames.every((f) => f.shown), 'the stack frames are present and shown');
    assert.equal(seen.folded, 0, 'nothing is folded');
    assert.equal(seen.size, '15px', 'mono at 15');
    assert.equal(seen.lineHeight, '24px', 'on 24');
  }));

test('ESC is shown as a picture in the comment colour, never interpreted; a copy of Read is the file, ESC bytes and all', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'] });
    await coloured(page);
    const seen = await page.evaluate(() => {
      const marks = [...document.querySelectorAll('#doc .marxy-invisible-esc')];
      const probe = document.createElement('i');
      probe.style.color = 'var(--marxy-tok-comment)';
      document.querySelector('#doc').append(probe);
      const comment = getComputedStyle(probe).color;
      probe.remove();
      const glyph = marks[0].querySelector('.marxy-invisible-glyph');
      return {
        count: marks.length,
        labels: marks.map((m) => m.querySelector('.marxy-invisible-glyph').textContent),
        colour: getComputedStyle(glyph).color,
        comment,
        visible: glyph.getClientRects().length > 0,
        // `[33m` is ordinary text after the picture: the sequence was not run.
        around: marks[0].parentElement.textContent.includes('[33mslow frame'),
        bold: [...document.querySelectorAll('#doc [style]')].length,
      };
    });
    assert.equal(seen.count, 4, 'four ESC bytes in the file, four marks');
    assert.deepEqual(seen.labels, ['␛', '␛', '␛', '␛']);
    assert.equal(seen.colour, seen.comment);
    assert.ok(seen.visible);
    assert.ok(seen.around, 'the rest of the sequence is text');
    const key = await modifier(page);
    await page.locator('#doc pre').first().click();
    await page.keyboard.press(`${key}+KeyA`);
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    const text = await copied(page);
    assert.equal(text.length, fixture.length);
    assert.ok(text === fixture, 'the clipboard holds the file');
    assert.equal([...text].filter((c) => c === '\u001b').length, 4, 'and its four ESC bytes');
  }));

test('Filter by level: Warn leaves the WARN and ERROR lines with their frames, and one line of words for each run it hides', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'] });
    await coloured(page);
    await chooseLevel(page, 'warn');
    const shown = await page.evaluate(() => window.__shownLines());
    const runs = await page.evaluate(() => window.__runs());
    const expected = keptLines(fixtureLines, 2).map((i) => fixtureLines[i]);
    assert.deepEqual(shown, expected, 'the lines shown are the lines Warn keeps, each as the file has it');
    assert.deepEqual(runs.map((r) => r.words), ['7 lines below Warn', '9 lines below Warn', '1 line below Warn', '5 lines below Warn', '4 lines below Warn', '4 lines below Warn', '1 line below Warn']);
    assert.ok(runs.every((r) => r.shown), 'each is a line on the page');
    assert.equal(runs.reduce((n, r) => n + r.count, 0), fixtureLines.length - expected.length, 'the counts sum to the hidden lines');
    assert.equal(runs.reduce((n, r) => n + r.count, 0), 31);
    // The words stand where the lines were: the first run is before the first shown line.
    const order = await page.evaluate(() => {
      const code = document.querySelector('#doc pre.language-log > code');
      return [...code.children].filter((c) => !c.classList.contains('marxy-log-hidden')).slice(0, 3).map((c) => (c.classList.contains('marxy-log-hidden-run') ? 'words' : 'line'));
    });
    assert.deepEqual(order, ['words', 'line', 'line']);
    // The notice says how many, and what is unchanged.
    const notice = await page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));
    assert.ok(notice.includes('Warn and above · 31 lines of 49 hidden · the file is unchanged'), JSON.stringify(notice));
    // Error leaves the ERROR and FATAL lines; Info only drops DEBUG; All is the whole log again.
    await chooseLevel(page, 'error');
    assert.deepEqual(await page.evaluate(() => window.__shownLines()), keptLines(fixtureLines, 3).map((i) => fixtureLines[i]));
    await chooseLevel(page, 'info');
    assert.deepEqual(await page.evaluate(() => window.__shownLines()), keptLines(fixtureLines, 1).map((i) => fixtureLines[i]));
    await chooseLevel(page, 'all');
    assert.deepEqual(await page.evaluate(() => window.__shownLines()), fixtureLines);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-log-hidden-run, .marxy-log-hidden').length), 0);
    // A view only: the file, and the page's text, are what they were.
    assert.equal(await page.evaluate(() => window.__marxyHandle.document().snapshot().buffer.text), fixture);
  }));

test('a click on a run of words shows its lines, and nothing else; the filter is not remembered when another file opens', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'] });
    await coloured(page);
    await chooseLevel(page, 'warn');
    await page.locator('.marxy-log-hidden-run', { hasText: '9 lines below Warn' }).click();
    const after = await page.evaluate(() => ({ shown: window.__shownLines(), runs: window.__runs().map((r) => r.words) }));
    const keep = new Set(keptLines(fixtureLines, 2));
    for (let i = 9; i < 18; i++) keep.add(i);
    assert.deepEqual(after.shown, [...keep].sort((a, b) => a - b).map((i) => fixtureLines[i]));
    assert.deepEqual(after.runs, ['7 lines below Warn', '1 line below Warn', '5 lines below Warn', '4 lines below Warn', '4 lines below Warn', '1 line below Warn']);
    // Keyboard: Enter on the focused words does the same.
    await page.locator('.marxy-log-hidden-run', { hasText: '7 lines below Warn' }).focus();
    await page.keyboard.press('Enter');
    assert.equal((await page.evaluate(() => window.__runs())).length, 5);
    // Another file, and back: the filter is gone.
    await open(page, '/r/note.md');
    await open(page, '/r/build.log');
    await coloured(page);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-log-hidden-run, .marxy-log-hidden').length), 0);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#doc pre.language-log > code > .marxy-line')].filter((l) => l.getClientRects().length > 0).length), fixtureLines.length);
  }));

test('a reload while filtered recounts: the runs are those of the new bytes', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'], guard: true });
    await coloured(page);
    await chooseLevel(page, 'warn');
    assert.equal((await page.evaluate(() => window.__runs())).reduce((n, r) => n + r.count, 0), 31);
    // Another program appends two INFO lines and an ERROR with a frame.
    const added = '2026-10-12T09:31:00.000Z INFO  tail     one\n2026-10-12T09:31:01.000Z INFO  tail     two\n2026-10-12T09:31:02.000Z ERROR tail     three\n    at late (a.ts:1:1)\n';
    await page.evaluate(([path, text]) => window.__outside(path, text), ['/r/build.log', fixture + added]);
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().buffer.text.includes('tail     three'), null, { timeout: 15_000 });
    await settled(page, 'warn');
    await page.waitForFunction(() => window.__shownLines().some((l) => l.includes('tail     three')), null, { timeout: 15_000 });
    const lines = (fixture + added).replace(/\n$/, '').split('\n');
    assert.deepEqual(await page.evaluate(() => window.__shownLines()), keptLines(lines, 2).map((i) => lines[i]));
    const runs = await page.evaluate(() => window.__runs());
    assert.equal(runs.reduce((n, r) => n + r.count, 0), lines.length - keptLines(lines, 2).length, 'the counts sum to the new hidden lines');
    assert.equal(runs.at(-1).words, '3 lines below Warn', 'the last run grew by the two INFO lines and the one before: 1 + 2');
  }));

test('a run of hidden lines that crosses pieces is one line of words with the count of all of it, and a piece wholly inside it takes no room', () =>
  withPage(async (page) => {
    // 650 INFO lines (four pieces of at most 200 lines, cut at entries), then an ERROR with a frame, then 5 INFO lines.
    const info = (i) => `2026-10-12T09:00:00.${String(i % 1000).padStart(3, '0')}Z INFO  tick     number ${i}\n`;
    const text = Array.from({ length: 650 }, (_, i) => info(i)).join('') + '2026-10-12T09:01:00.000Z ERROR boom     here\n    at frame (a.ts:1:1)\n' + Array.from({ length: 5 }, (_, i) => info(i)).join('');
    await bootTwoPanes(page, { files: { ...files, '/r/runs.log': text }, open: ['/r/runs.log'] });
    await page.waitForFunction(() => document.querySelectorAll('#doc pre.language-log').length >= 4, null, { timeout: 15_000 });
    await chooseLevel(page, 'error');
    // The pieces the run covers are read from their text, the first is split for its words and the next two are hidden whole,
    // which leaves the last piece within two screens of the reader: it is handled too, and the words count what it hides.
    await page.waitForFunction(() => window.__runs().length === 2, null, { timeout: 15_000 });
    await settled(page, 'error');
    const seen = await page.evaluate(() => ({
      runs: window.__runs().map((r) => r.words),
      shown: window.__shownLines(),
      pieces: [...document.querySelectorAll('#doc pre.language-log')].map((p) => ({ hidden: p.classList.contains('marxy-log-hidden-piece'), room: p.getBoundingClientRect().height })),
    }));
    assert.deepEqual(seen.runs, ['650 lines below Error', '5 lines below Error'], 'the 650 are one run, however many pieces they are in');
    assert.deepEqual(seen.shown, ['2026-10-12T09:01:00.000Z ERROR boom     here', '    at frame (a.ts:1:1)']);
    assert.deepEqual(seen.pieces.map((p) => p.hidden), [false, true, true, false]);
    assert.ok(seen.pieces.filter((p) => p.hidden).every((p) => p.room === 0), 'a piece wholly in the run takes no room');
    await page.locator('.marxy-log-hidden-run', { hasText: '650 lines below Error' }).click();
    // Lines on the page: those of a split piece that are not hidden, the raw lines of one that is not split.
    const onPage = await page.evaluate(() => [...document.querySelectorAll('#doc pre.language-log > code')]
      .filter((c) => c.getClientRects().length > 0)
      .reduce((n, c) => n + (c.dataset.marxyDone === undefined ? window.__lineText(c).replace(/\n$/, '').split('\n').length : [...c.querySelectorAll(':scope > .marxy-line')].filter((l) => !l.classList.contains('marxy-log-hidden')).length), 0));
    assert.equal(onPage, 650 + 2, 'one click shows all 650, and the 5 after the error stay hidden');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc .marxy-log-hidden-piece').length), 0);
  }));

test('copying a filtered log takes the lines shown, each as the file has it, and not the hidden lines between them', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'] });
    await coloured(page);
    await chooseLevel(page, 'warn');
    const key = await modifier(page);
    await page.locator('#doc pre').first().click();
    await page.keyboard.press(`${key}+KeyA`);
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    const text = await copied(page);
    const expected = keptLines(fixtureLines, 2).map((i) => `${fixtureLines[i]}\n`).join('');
    assert.ok(text === expected, `${text.length} characters against ${expected.length}`);
    assert.ok(!text.includes('words'), 'no words of the filter in the clipboard');
  }));

test('Jump to first error brings the first ERROR line to the middle, and says so when there is none', () =>
  withPage(async (page) => {
    // Three thousand lines of INFO, then the error.
    const head = Array.from({ length: 3000 }, (_, i) => `2026-10-12T09:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z INFO  tick     number ${i}\n`).join('');
    // A screenful and more of INFO after them, so the page can scroll far enough to put the error in the middle.
    const tail = Array.from({ length: 80 }, (_, i) => `2026-10-12T10:01:${String(i % 60).padStart(2, '0')}.000Z INFO  tock     number ${i}\n`).join('');
    const body = `${head}2026-10-12T10:00:00.000Z ERROR boom     the first one\n    at somewhere (a.ts:1:1)\n2026-10-12T10:00:01.000Z ERROR boom     the second\n${tail}`;
    await bootTwoPanes(page, { files: { ...files, '/r/long.log': body, '/r/calm.log': head }, open: ['/r/long.log'] });
    await coloured(page);
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      await handle.commands().find((c) => c.id === 'log.first-error').run(buildAppContext(handle));
    });
    const seen = await page.evaluate(() => {
      const line = [...document.querySelectorAll('#doc .marxy-line')].find((l) => l.textContent.includes('the first one'));
      const box = line.getBoundingClientRect();
      return { found: line !== undefined, top: box.top, bottom: box.bottom, height: window.innerHeight, active: document.activeElement === line };
    });
    assert.ok(seen.top >= 0 && seen.bottom <= seen.height, `the first error is on screen (${seen.top}..${seen.bottom} of ${seen.height})`);
    assert.ok(Math.abs((seen.top + seen.bottom) / 2 - seen.height / 2) < seen.height / 4, `and near the middle (${seen.top}..${seen.bottom} of ${seen.height})`);
    // None to find: nothing moves, and the notice says what happened, what is unchanged and what to do.
    await open(page, '/r/calm.log');
    await page.waitForSelector('#doc pre.language-log');
    const before = await page.evaluate(() => window.scrollY);
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      await handle.commands().find((c) => c.id === 'log.first-error').run(buildAppContext(handle));
    });
    assert.equal(await page.evaluate(() => window.scrollY), before);
    const notice = await page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));
    assert.ok(notice.some((t) => t.startsWith('No ERROR line in this log · nothing moved · ')), JSON.stringify(notice));
  }));

test('the two tools are offered only for a log in Read', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/note.md'] });
    const offered = () =>
      page.evaluate(async () => {
        const { buildAppContext } = await import('/src/selection/bind.ts');
        const handle = window.__marxyHandle;
        const ctx = buildAppContext(handle);
        return ['log.filter-level', 'log.first-error'].map((id) => handle.commands().find((c) => c.id === id).when(ctx));
      });
    assert.deepEqual(await offered(), [false, false], 'not for a Markdown file');
    await open(page, '/r/build.log');
    await coloured(page);
    assert.deepEqual(await offered(), [true, true]);
    assert.equal(await mode(page), 'rendered');
  }));

// ---- commitment 5: a log of tens of megabytes -------------------------------------------------------------------------------

/** A log of about `mb` megabytes made in the page (a base64 argument that size would be the test's own cost). */
const LARGE_SOURCE = `
  window.__makeLog = (mb) => {
    const levels = ['INFO', 'INFO', 'INFO', 'INFO', 'INFO', 'DEBUG', 'DEBUG', 'WARN', 'INFO', 'ERROR'];
    const parts = [];
    let bytes = 0;
    let n = 0;
    while (bytes < mb * 1024 * 1024) {
      const level = levels[n % levels.length];
      const s = n % 86400;
      const head = '2026-10-12T' + String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + '.' + String(n % 1000).padStart(3, '0') + 'Z ' + level.padEnd(5) + ' worker-' + (n % 8) + ' handled request ' + n + ' for /v1/tide/' + (n % 997) + ' in ' + (n % 53) + ' ms\\n';
      parts.push(head);
      bytes += head.length;
      if (level === 'ERROR') {
        const frames = '    at handle (src/server/handler.ts:' + (n % 400) + ':9)\\n    at async dispatch (src/server/router.ts:88:5)\\n';
        parts.push(frames);
        bytes += frames.length;
      }
      n++;
    }
    return new TextEncoder().encode(parts.join(''));
  };
`;

async function bootLarge(page, mb) {
  const base = await harnessBase();
  await routeSkeleton(page, base);
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(LARGE_SOURCE);
  return page.evaluate(async (size) => {
    const bytes = window.__makeLog(size);
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const { startApp } = await import('/src/app.ts');
    const shell = createMemoryShell({ '/r/big.log': bytes });
    const mark = shell.mark.bind(shell);
    const began = performance.now();
    window.__firstText = null;
    window.__pieces = null;
    shell.mark = async (name, t, data) => {
      if (name === 'first_text') {
        window.__firstText = performance.now() - began;
        window.__piecesAtFirstText = document.querySelectorAll('#doc pre.language-log').length;
      }
      return mark(name, t, data);
    };
    const handle = await startApp(shell, { argv: ['/r/big.log'] });
    await handle.ready;
    window.__marxyHandle = handle;
    window.__complete = null;
    void handle.contentComplete().then(() => { window.__complete = performance.now() - began; });
    return { bytes: bytes.length, lines: bytes.reduce((n, b) => n + (b === 10 ? 1 : 0), 0) };
  }, mb);
}

test(`a log of ${process.env.MARXY_LOG_MB ?? 20} MB: first text arrives before the last chunk is in the page, and a level filter reaches the first screen quickly`, () =>
  withPage(async (page) => {
    const mb = Number(process.env.MARXY_LOG_MB ?? 20);
    const size = await bootLarge(page, mb);
    await page.waitForFunction(() => window.__firstText !== null, null, { timeout: 120_000 });
    const first = await page.evaluate(() => ({ at: window.__firstText, pieces: window.__piecesAtFirstText, total: window.__marxyHandle.panes().focused.view.document().ast.children.length }));
    assert.ok(first.pieces > 0, 'there is text at first text');
    assert.ok(first.pieces < first.total, `first text holds ${first.pieces} of ${first.total} pieces: it did not wait for the last chunk`);
    console.log(`# log ${mb} MB (${size.bytes} bytes, ${size.lines} lines, ${first.total} pieces): first text ${first.at.toFixed(0)} ms with ${first.pieces} pieces in the page`);
    await page.waitForFunction(() => window.__complete !== null, null, { timeout: 240_000 });
    const complete = await page.evaluate(() => window.__complete);
    console.log(`# log ${mb} MB: wholly in the page after ${complete.toFixed(0)} ms`);
    assert.ok(complete > first.at, 'the rest arrived after first text');
    // The filter: the time from the choice to the first screen showing only what Warn keeps, and to the pieces near it handled.
    await page.evaluate(PAGE_HELPERS);
    const timing = await page.evaluate(async () => {
      const { filterFor } = await import('/src/kinds/log-view.ts');
      const { levelOf } = await import('/src/kinds/log-filter.ts');
      const pane = window.__marxyHandle.panes().focused;
      const filter = filterFor(pane.article, pane.view.store(), () => true);
      const began = performance.now();
      filter.setLevel(levelOf('warn'));
      while (document.querySelector('.marxy-log-hidden-run') === null) await new Promise((r) => setTimeout(r, 2));
      const firstScreen = performance.now() - began;
      await filter.settled();
      const shown = window.__shownLines().slice(0, 30);
      return {
        firstScreen,
        settled: performance.now() - began,
        hidden: filter.hiddenLines(),
        shown,
        handled: document.querySelectorAll('#doc .marxy-log-filtered').length,
        pieces: document.querySelectorAll('#doc pre.language-log').length,
      };
    });
    console.log(`# log ${mb} MB filtered to Warn: first screen ${timing.firstScreen.toFixed(0)} ms, the pieces near it handled in ${timing.settled.toFixed(0)} ms (${timing.handled} of ${timing.pieces} pieces, ${timing.hidden} lines hidden there)`);
    assert.ok(timing.handled >= 1 && timing.handled < timing.pieces / 4, `${timing.handled} of ${timing.pieces} pieces were handled: the ones near the reader, not the whole log`);
    assert.ok(timing.hidden > 0);
    assert.ok(timing.shown.every((l) => / (WARN|ERROR) /.test(l.slice(0, 40)) || l.startsWith('    at ')), `the first screen shows only WARN and ERROR lines and frames: ${JSON.stringify(timing.shown.slice(0, 6))}`);
  }, { height: 900 }));
