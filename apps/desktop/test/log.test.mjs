// A log in Read: it opens as Read, as the log page (the time of day and the level in columns of their
// own, a heading with the day and the zone, a pause marked, an escape code hidden and its colour drawn in the theme's tone, with the fold saying so),
// all of it drawn over the file's text, so a copy is the bytes; and the level filter hides lines by level, says how many it
// hides, and shows them again on a click. WebKit, over the shipped skeleton and the memory shell, as
// transcript.test.mjs runs. The last tests open a log just under the size from which a log is read as lines (whose own
// tests are reading-lines.test.mjs) and record the time to first text and to a filtered page (commitment 5); the numbers
// are printed, and what is asserted is that first text does not wait.
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
/** The demo's build log: the shots are of it (pauses, an escape code, a stack trace). */
const steps = readFileSync(new URL('../../../fixtures/demo/logs/build-2026-10-14.log', import.meta.url), 'utf8');
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
  // The text of a piece as the page shows it: the lines the filter hides, the words that stand for them and the markers' labels are not in it.
  window.__lineText = (el) => {
    const copy = el.cloneNode(true);
    for (const g of copy.querySelectorAll('.marxy-invisible-glyph, .marxy-log-hidden-run, .marxy-log-hidden-text')) g.remove();
    return copy.textContent;
  };
  window.__shownLines = () => [...document.querySelectorAll('#doc pre.language-log:not(.marxy-log-hidden-piece) > code')]
    .flatMap((code) => { const t = window.__lineText(code); const lines = t.split('\\n'); if (lines.at(-1) === '') lines.pop(); return lines; });
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

/**
 * Types `query` into the open find field and waits for the match run of the whole query: find matches on the frame after
 * a keystroke, so a slow machine can paint the count of a prefix ("s") between two keys, and a count showing is not the
 * count of the query. The field holds the query once every key has landed, and two frames later the last run has been.
 */
async function typeQuery(page, query) {
  await page.keyboard.type(query);
  await page.waitForFunction((q) => document.querySelector('.marxy-find-input')?.value === q, query);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForFunction(() => /\d+ of \d+/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''));
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

test('the log page: the time of day in a column of its own, the level in another, WARN and ERROR weight 700 in the strong ink, INFO faint; frames present and unfolded under the message', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'] });
    await coloured(page);
    const seen = await page.evaluate(() => {
      const css = (el) => getComputedStyle(el);
      const ink = (token) => {
        const probe = document.createElement('i');
        probe.style.color = `var(${token})`;
        document.querySelector('#doc').append(probe);
        const colour = css(probe).color;
        probe.remove();
        return colour;
      };
      /** Where a line's own text starts on screen, past its leading spaces. */
      const textLeft = (line) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const at = node.data.search(/\S/);
          if (at < 0 || node.parentElement.closest('.marxy-log-time, .marxy-log-space, .marxy-log-level')) continue;
          const r = document.createRange();
          r.setStart(node, at);
          r.setEnd(node, at + 1);
          return r.getBoundingClientRect().left;
        }
        return NaN;
      };
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
        infoColour: css(info).color,
        faint: ink('--marxy-color-text-faint'),
        strong: ink('--marxy-color-text-strong'),
        comment: ink('--marxy-tok-comment'),
        errorColour: css(error).color,
        lineColour: css(line).color,
        timeColour: css(time).color,
        timeStyle: css(time).fontStyle,
        timeShown: time.dataset.marxyShown,
        timeText: time.textContent,
        timeSize: css(time).fontSize,
        timeRight: time.getBoundingClientRect().right,
        levelLeft: error.getBoundingClientRect().left,
        messageLeft: textLeft(line),
        frameLeft: textLeft(lines[at + 1]),
        ruleWidth: css(line).borderInlineStartWidth,
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
    assert.equal(seen.infoWeight, seen.bodyWeight, 'INFO is the line\'s weight');
    assert.equal(seen.infoColour, seen.faint, 'in the faint ink');
    assert.equal(seen.errorColour, seen.strong, 'ERROR is weight and the strong ink, not a hue');
    assert.equal(seen.lineColour, seen.strong, 'and so is its entry');
    assert.equal(seen.timeColour, seen.comment, 'the time is in the comment colour');
    assert.notEqual(seen.timeStyle, 'italic');
    assert.equal(seen.timeText, '2026-10-12T09:30:09.870Z', 'the timestamp is the file\'s text');
    assert.equal(seen.timeShown, '09:30:09.870', 'the time of day is what is drawn');
    assert.equal(seen.timeSize, '0px', 'the rest of it is text at no size');
    assert.ok(seen.timeRight <= seen.levelLeft, `the time stands left of the level (${seen.timeRight} against ${seen.levelLeft})`);
    assert.ok(seen.messageLeft > seen.levelLeft, 'the message after the level');
    assert.ok(seen.frameLeft > seen.messageLeft, `a frame sits under the message, indented (${seen.frameLeft} against ${seen.messageLeft})`);
    assert.equal(seen.levelTimes, fixtureLines.filter((l) => /^\d{4}-/.test(l)).length, 'a timestamp on every head');
    assert.equal(seen.ruleWidth, '0px', 'no rule: the entry\'s ink marks it');
    assert.deepEqual(seen.frames.map((f) => f.text.trim()), ['at parseReading (src/loader/readings.ts:88:41)', 'at loadGauge (src/loader/gauges.ts:140:12)', 'at async refresh (src/loader/index.ts:57:5)']);
    assert.ok(seen.frames.every((f) => f.shown), 'the stack frames are present and shown');
    assert.equal(seen.folded, 0, 'nothing is folded');
    assert.equal(seen.size, '15px', 'mono at 15');
    assert.equal(seen.lineHeight, '24px', 'on 24');
  }));

test('a log named .txt reads as the log it is: Read, the log page, its levels counted, and a $ in it is text, not maths', () =>
  withPage(async (page) => {
    const api = [
      '2026-11-19T08:10:00.000Z INFO api: listening on :8443 (workers=8)',
      '2026-11-19T08:10:02.220Z WARN db: slow query (1,204 ms): select * from readings where station_id = $1 order by taken_at desc',
      '2026-11-19T08:10:02.590Z INFO api: GET /v2/gauges/0417 200 10 ms',
      '2026-11-19T08:10:03.700Z ERROR ingest: gauge 0417 sent a reading out of range: $14.92 m',
      '    at ingest::validate (ingest/validate.rs:88)',
      '',
    ].join('\n');
    await bootTwoPanes(page, { files: { '/r/api-2026-11-19.txt': api }, open: ['/r/api-2026-11-19.txt'] });
    await coloured(page);
    const seen = await page.evaluate(() => ({
      mode: window.__marxyHandle.panes().focused.view.mode,
      kind: document.querySelector('section.marxy-pane').getAttribute('data-marxy-kind'),
      pieces: document.querySelectorAll('#doc pre.language-log.marxy-run').length,
      maths: document.querySelectorAll('#doc .marxy-math, #doc .marxy-math-inline, #doc math').length,
      paragraphs: document.querySelectorAll('#doc p:not(.marxy-log-day)').length,
      ranks: [...document.querySelectorAll('#doc pre.language-log .marxy-line')].map((l) => l.getAttribute('data-marxy-rank')),
      text: [...document.querySelectorAll('#doc pre.language-log > code')].map((c) => c.textContent).join(''),
    }));
    assert.equal(seen.mode, 'rendered', 'it opens in Read');
    assert.equal(seen.kind, 'log');
    assert.ok(seen.pieces >= 1, 'it is the log page');
    assert.equal(seen.maths, 0, 'nothing between two $ is set as maths');
    assert.equal(seen.paragraphs, 0, 'no line is joined into a paragraph');
    assert.deepEqual(seen.ranks.slice(0, 5), ['1', '2', '1', '3', null], 'each entry ranked; the frame is no entry of its own');
    assert.ok(seen.text.includes('station_id = $1 order by'), 'the $ is the file\'s text');
  }));

test('the shapes Windows and the servers write are entries of the log page: a time in its column, a level, a status inside its line', () =>
  withPage(async (page) => {
    const access = [
      '203.0.113.7 - - [10/Oct/2024:13:55:36 +0000] "GET /v2/tides HTTP/1.1" 200 157 "-" "curl/8.4.0"',
      '203.0.113.7 - - [10/Oct/2024:13:55:52 +0000] "GET /v2/gauges HTTP/1.1" 404 12 "-" "curl/8.4.0"',
      '203.0.113.7 - - [10/Oct/2024:13:55:53 +0000] "POST /v2/readings HTTP/1.1" 502 157 "-" "curl/8.4.0"',
      '',
    ].join('\n');
    const cbs = [
      '2024-01-15 10:23:45, Info                  CBS    Starting TrustedInstaller initialization.',
      '2024-01-15 10:23:46, Warning               CBS    Failed to get session package state',
      '2024-01-15 10:23:47, Error                 CSI    00000007 (F) Hydration failed',
      '',
    ].join('\r\n');
    const dotnet = ['info: Microsoft.Hosting.Lifetime[14]', '      Now listening on: http://localhost:5000', 'warn: Tides.Gauges[3]', '      Gauge 0417 is slow', 'fail: Tides.Ingest[9]', '      Reading out of range', ''].join('\n');
    await bootTwoPanes(page, { files: { '/r/access.log': access, '/r/CBS.log': cbs, '/r/console.txt': dotnet }, open: ['/r/access.log'] });
    const lines = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#doc pre.language-log .marxy-line')].map((l) => ({
          rank: l.getAttribute('data-marxy-rank'),
          shown: l.querySelector('.marxy-log-time')?.dataset.marxyShown ?? null,
          level: l.querySelector('.marxy-log-level')?.textContent ?? null,
          inline: l.querySelector('.marxy-log-level')?.classList.contains('marxy-log-inline') ?? false,
          gap: l.getAttribute('data-marxy-gap'),
        })),
      );
    await coloured(page);
    const web = await lines();
    assert.deepEqual(web.map((l) => [l.rank, l.shown, l.level, l.inline]), [
      ['1', '13:55:36', '200', true], ['2', '13:55:52', '404', true], ['3', '13:55:53', '502', true],
    ]);
    assert.equal(web[1].gap, '+16 s', 'a pause is measured across the access log\'s own times');
    await open(page, '/r/CBS.log');
    await coloured(page);
    assert.deepEqual((await lines()).map((l) => [l.rank, l.shown, l.level]), [['1', '10:23:45', 'Info'], ['2', '10:23:46', 'Warning'], ['3', '10:23:47', 'Error']]);
    await open(page, '/r/console.txt');
    await coloured(page);
    assert.equal(await page.evaluate(() => document.querySelector('section.marxy-pane').getAttribute('data-marxy-kind')), 'log', '.NET\'s console in a .txt is a log by its shape');
    assert.deepEqual((await lines()).map((l) => [l.rank, l.level]), [['1', 'info'], [null, null], ['2', 'warn'], [null, null], ['3', 'fail'], [null, null]]);
  }));

test('the log page: a heading says the day and the zone the file writes, a pause before a slow step is marked, and neither is text of the page', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files: { ...files, '/r/steps.log': steps }, open: ['/r/steps.log'] });
    await coloured(page);
    await page.evaluate(PAGE_HELPERS);
    const seen = await page.evaluate(() => {
      const heading = document.querySelector('#doc .marxy-log-day');
      const pauses = [...document.querySelectorAll('#doc .marxy-line[data-marxy-gap]')];
      const line = pauses[0];
      return {
        day: heading?.dataset.marxyDay,
        times: heading?.dataset.marxyTimes,
        drawn: heading ? getComputedStyle(heading, '::after').content : '',
        headingText: heading?.textContent,
        beforePre: heading?.nextElementSibling?.matches('pre.language-log'),
        pauses: pauses.map((l) => [l.querySelector('.marxy-log-time').dataset.marxyShown, l.dataset.marxyGap]),
        pauseDrawn: line ? getComputedStyle(line, '::before').content : '',
        pauseRow: line ? line.querySelector('.marxy-log-level').getBoundingClientRect().top - line.getBoundingClientRect().top : 0,
        lineHeight: line ? parseFloat(getComputedStyle(line).lineHeight) : 0,
        text: window.__shownLines(),
      };
    });
    assert.equal(seen.day, 'Wednesday, 14 October 2026');
    assert.equal(seen.times, 'times are UTC, as the file writes them (Z)');
    assert.ok(seen.drawn.includes('times are UTC'), `the heading draws its words (${seen.drawn})`);
    assert.equal(seen.headingText, '', 'the heading holds no text of its own: find and a copy do not meet it');
    assert.equal(seen.beforePre, true, 'it stands over the log');
    assert.deepEqual(seen.pauses, [['16:02:48.017', '+36 s'], ['16:03:02.733', '+15 s'], ['16:03:09.118', '+6 s'], ['16:03:15.554', '+6 s']]);
    assert.equal(seen.pauseDrawn, '"+36 s"');
    assert.equal(seen.pauseRow, seen.lineHeight, 'a pause is a row of its own');
    assert.deepEqual(seen.text, steps.replace(/\n$/, '').split('\n'), 'the page\'s text is the file\'s lines');
    // Log times in your zone: the same page, its times and its heading drawn in the reader's zone, and back.
    const zoned = await page.evaluate(async () => {
      const { setLogZone } = await import('/src/proposals/log-zone.ts');
      const article = window.__marxyHandle.panes().focused.article;
      setLogZone(article, true);
      const time = document.querySelector('#doc .marxy-log-time');
      const d = new Date(Date.parse(time.textContent));
      const two = (n) => String(n).padStart(2, '0');
      const out = {
        shown: time.dataset.marxyShown,
        local: `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`,
        times: document.querySelector('#doc .marxy-log-day').dataset.marxyTimes,
        text: window.__shownLines(),
      };
      setLogZone(article, false);
      return { ...out, back: time.dataset.marxyShown };
    });
    assert.equal(zoned.shown, zoned.local, 'in your zone, the time of day is the same instant where you are');
    assert.match(zoned.times, /^times shown in your zone, UTC.*; the file writes them in UTC, and Source keeps them so$/);
    assert.deepEqual(zoned.text, seen.text, 'and the page\'s text is still the file\'s');
    assert.equal(zoned.back, '16:02:11.402', 'as written again');
  }));

test('an escape code is hidden and never run: what it colours takes the theme\'s tone, the fold says so, and a copy of Read is the file, ESC bytes and all', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'] });
    await coloured(page);
    const seen = await page.evaluate(() => {
      const css = (el, pseudo) => getComputedStyle(el, pseudo);
      const probe = document.createElement('i');
      probe.style.color = 'var(--marxy-color-status-warn)';
      document.querySelector('#doc').append(probe);
      const warn = css(probe).color;
      probe.remove();
      const codes = [...document.querySelectorAll('#doc .marxy-log-esc')];
      const tone = document.querySelector('#doc .marxy-ansi-warn');
      return {
        bytes: document.querySelectorAll('#doc .marxy-invisible-esc').length,
        codes: codes.map((c) => {
          const copy = c.cloneNode(true);
          for (const g of copy.querySelectorAll('.marxy-invisible-glyph')) g.remove();
          return copy.textContent.replace('\u001b', 'ESC');
        }),
        drawn: codes.map((c) => css(c, '::before').content),
        size: css(codes[0]).fontSize,
        wide: codes.map((c) => c.getBoundingClientRect().width),
        tone: tone?.textContent,
        toneColour: tone ? css(tone).color : '',
        warn,
        notes: document.querySelectorAll('#doc .marxy-line[data-marxy-esc]').length,
        fold: [...document.querySelectorAll('#doc .marxy-log-account .marxy-account-body p')].map((p) => p.textContent),
      };
    });
    assert.equal(seen.bytes, 4, 'four ESC bytes in the file, each still in the text');
    assert.deepEqual(seen.codes, ['ESC[33m', 'ESC[0m', 'ESC[2K', 'ESC[0m'], 'each sequence is the page\'s text, as the file has it');
    assert.deepEqual(seen.drawn, ['none', 'none', 'none', 'none'], 'no ESC box is drawn');
    assert.equal(seen.size, '0px', 'its parameters at no size: the sequence is neither run nor shown as text');
    assert.ok(seen.wide.every((w) => w < 1), 'and takes no room');
    assert.equal(seen.tone, 'slow frame');
    assert.equal(seen.toneColour, seen.warn, 'yellow is the theme\'s warning tone');
    assert.equal(seen.notes, 0, 'no line under the entry');
    assert.match(seen.fold[0], /^The file colours text with escape codes\./);
    assert.ok(seen.fold[0].endsWith('here yellow as the warning tone.'), seen.fold[0]);
    assert.ok(seen.fold.some((l) => l.startsWith('It also asks the terminal for clearing the line.')), 'a non-SGR code is named, not run');
    const key = await modifier(page);
    await page.locator('#doc .marxy-line:visible').first().click();
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
      return [...code.children].filter((c) => !c.classList.contains('marxy-log-hidden-text')).slice(0, 3).map((c) => (c.classList.contains('marxy-log-hidden-run') ? 'words' : 'line'));
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
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-log-hidden-run, .marxy-log-hidden-text, .marxy-log-hidden-piece').length), 0);
    // A view only: the file, and the page's text, are what they were.
    assert.equal(await page.evaluate(() => window.__marxyHandle.document().snapshot().buffer.text), fixture);
  }));

test('the click on a level answers at once: the menu is closed and the choice marked in the frame it was made in, and no slice of the work has run', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'] });
    await coloured(page);
    await page.evaluate(PAGE_HELPERS);
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const { filterOf } = await import('/src/kinds/log-view.ts');
      const handle = window.__marxyHandle;
      await handle.commands().find((c) => c.id === 'log.filter-level').run(buildAppContext(handle));
      window.__probe = null;
      // Registered while the click is still being dispatched, so it runs in the first frame after the click, ahead of any
      // frame callback the click's own handler asks for. What it reads is what the reader's first frame has.
      document.addEventListener('click', () => {
        const clicked = performance.now();
        requestAnimationFrame(() => {
          const pane = handle.panes().focused;
          const filter = filterOf(pane.article, pane.view.store());
          window.__probe = {
            menuOpen: document.querySelector('[data-row-key="log.level.warn"]') !== null,
            pill: [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).find((t) => t.startsWith('Filtering to Warn')) ?? null,
            // Work begun: a filter exists and is being worked through, or the page already holds a run of words or a hidden line.
            filterBusy: filter?.busy() ?? false,
            filtering: pane.article.classList.contains('marxy-log-filtering'),
            runs: document.querySelectorAll('.marxy-log-hidden-run').length,
            ms: performance.now() - clicked,
          };
        });
      }, { capture: true, once: true });
    });
    await page.click('[data-row-key="log.level.warn"]');
    await page.waitForFunction(() => window.__probe !== null, null, { timeout: 5000 });
    const first = await page.evaluate(() => window.__probe);
    console.log(`# filter click: the first frame after it came ${first.ms.toFixed(1)} ms later, with the menu ${first.menuOpen ? 'open' : 'closed'} and the pill "${first.pill}"`);
    assert.equal(first.menuOpen, false, 'the menu is closed in the first frame after the click');
    assert.ok(first.pill !== null, 'the choice is marked in that frame: the pill is up');
    assert.equal(first.filterBusy, false, 'no slice of the filter has run by that frame');
    assert.equal(first.filtering, true, 'the pieces not yet filtered are already not drawn in that frame: one class on the article, no piece touched');
    assert.equal(first.runs, 0, 'and no line is hidden yet');
    await settled(page, 'warn');
    assert.deepEqual(await page.evaluate(() => window.__shownLines()), keptLines(fixtureLines, 2).map((i) => fixtureLines[i]), 'the work still happens, and ends as it did');
  }));

test('a line over the highlighter cap shows its own text once, in order, and the next line shows its timestamp once; a copy of the filtered log is the file\'s lines', () =>
  withPage(async (page) => {
    const stampOf = (i) => `2026-10-12T09:00:${String(i).padStart(2, '0')}.000Z`;
    const long = `${stampOf(1)} INFO  long ${'a1b2'.repeat(375)} end`;
    const rows = [`${stampOf(0)} WARN  before`, long, `${stampOf(2)} WARN  after`, `${stampOf(3)} INFO  last`];
    assert.ok(long.length > 1500);
    const body = `${rows.join('\n')}\n`;
    await bootTwoPanes(page, { files: { '/r/long.log': body }, open: ['/r/long.log'] });
    await coloured(page);
    await page.evaluate(PAGE_HELPERS);
    const read = () => page.evaluate(() => {
      const note = new Set(['marxy-elided', 'marxy-log-hidden-run']);
      const text = (n) => (n.nodeType === 3 ? n.data : n.nodeType === 1 && ![...n.classList].some((c) => note.has(c)) ? [...n.childNodes].map(text).join('') : '');
      const code = document.querySelector('#doc pre.language-log > code');
      return { text: text(code), notes: code.querySelectorAll('.marxy-elided').length };
    });
    const plain = await read();
    assert.equal(plain.text, body, 'the page holds the file\'s bytes, the note aside');
    assert.equal(plain.notes, 1, 'one note, for the one long line');
    assert.equal(plain.text.split(stampOf(2)).length - 1, 1, 'the timestamp of the line after the long one is on the page once');
    await chooseLevel(page, 'warn');
    const filtered = await read();
    assert.deepEqual(await page.evaluate(() => window.__shownLines()), [rows[0], rows[2]], 'the lines shown are the file\'s, each once');
    assert.equal(filtered.text, body, 'the filtered page still holds every byte');
    const key = await modifier(page);
    await page.locator('#doc .marxy-line', { hasText: 'after' }).click();
    await page.keyboard.press(`${key}+KeyA`);
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'), null, { timeout: 10_000 });
    assert.equal(await copied(page), `${rows[0]}\n${rows[2]}\n`);
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
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-log-hidden-run, .marxy-log-hidden-text').length), 0);
    assert.equal(await page.evaluate(() => window.__shownLines().length), fixtureLines.length);
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
    const onPage = await page.evaluate(() => window.__shownLines().length);
    assert.equal(onPage, 650 + 2, 'one click shows all 650, and the 5 after the error stay hidden');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc .marxy-log-hidden-piece').length), 0);
  }));

test('copying a filtered log takes the lines shown, each as the file has it, and not the hidden lines between them', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'] });
    await coloured(page);
    await chooseLevel(page, 'warn');
    const key = await modifier(page);
    await page.locator('#doc .marxy-line:visible').first().click();
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

test('find with a filter on searches the lines shown, never the words of a hidden run, and counts the matches in hidden lines', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/build.log'] });
    await coloured(page);
    await chooseLevel(page, 'warn');
    const shown = keptLines(fixtureLines, 2).map((i) => fixtureLines[i]);
    const hiddenLines = fixtureLines.filter((l) => !shown.includes(l));
    const count = (lines, word) => lines.join('\n').match(new RegExp(word, 'gi'))?.length ?? 0;
    const inShown = count(shown, 'sync');
    const inHidden = count(hiddenLines, 'sync');
    assert.ok(inShown > 0 && inHidden > 0, `the fixture has both (${inShown} shown, ${inHidden} hidden)`);
    const key = await modifier(page);
    await page.keyboard.press(`${key}+KeyF`);
    await typeQuery(page, 'sync');
    const seen = await page.evaluate(() => ({
      count: document.querySelector('.marxy-find-count').textContent,
      ranges: [...(CSS.highlights.get('marxy-find') ?? [])].map((r) => ({ hidden: r.startContainer.parentElement.closest('.marxy-log-hidden-text, .marxy-log-hidden-piece, .marxy-log-hidden-run') !== null })),
      current: [...(CSS.highlights.get('marxy-find-current') ?? [])].map((r) => r.getClientRects().length),
    }));
    assert.equal(seen.count, `1 of ${inShown} · ${inHidden} more in hidden lines`, 'the count says how many more matches the hidden lines hold');
    assert.equal(seen.ranges.length, inShown, 'every highlight is a match in a line that is shown');
    assert.ok(seen.ranges.every((r) => !r.hidden));
    assert.ok(seen.current.every((n) => n > 0), 'the current match is on screen');
    // The words the filter leaves are not text of the log.
    await page.keyboard.press(`${key}+KeyA`);
    await typeQuery(page, 'below');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-find-count').textContent), '0 of 0', 'no match in "N lines below Warn"');
  }));

test('an entry keeps all its continuation lines, however many: the page and the notice agree on 2,500 frames', () =>
  withPage(async (page) => {
    const frames = Array.from({ length: 2500 }, (_, i) => `    at frame${i} (src/deep.ts:${i}:1)\n`).join('');
    const text = `2026-10-12T09:00:00.000Z INFO  start    before\n2026-10-12T09:00:01.000Z ERROR deep     boom\n${frames}2026-10-12T09:00:02.000Z INFO  end      after\n`;
    await bootTwoPanes(page, { files: { ...files, '/r/deep.log': text }, open: ['/r/deep.log'] });
    await coloured(page);
    await chooseLevel(page, 'error');
    const seen = await page.evaluate(() => ({
      runs: window.__runs().map((r) => r.words),
      shown: window.__shownLines().length,
      notice: [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent),
      pieces: document.querySelectorAll('#doc pre.language-log').length,
      ruleOnLast: (() => { const l = [...document.querySelectorAll('#doc .marxy-line')].find((x) => x.textContent.includes('frame2499')); return l?.classList.contains('marxy-log-error'); })(),
    }));
    assert.deepEqual(seen.runs, ['1 line below Error', '1 line below Error'], 'only the two INFO lines are hidden');
    assert.equal(seen.shown, 2501, 'the error and its 2,500 frames');
    assert.ok(seen.notice.includes('Error and above · 2 lines of 2,503 hidden · the file is unchanged'), JSON.stringify(seen.notice));
    assert.equal(seen.ruleOnLast, true, 'the last frame carries the error rule');
  }));

test('log4j and Laravel levels are read: ERROR is bold and the others at the line\'s weight, the filter works on them', () =>
  withPage(async (page) => {
    const log4j = [
      '2026-10-12 12:00:00,123 [main] INFO  com.example.App - starting',
      '2026-10-12 12:00:01,456 [http-nio-8080-exec-1] ERROR com.example.Service - boom',
      '    at com.example.Service.run(Service.java:42)',
      '2026-10-12 12:00:02,789 [main] DEBUG com.example.App - done',
      '',
    ].join('\n');
    const laravel = [
      '[2026-10-12 12:00:00] local.INFO: booted',
      '[2026-10-12 12:00:01] local.ERROR: Something failed {"exception":"[object] (RuntimeException)"}',
      '#0 /var/www/app/Http/Controller.php(12): fail()',
      '[2026-10-12 12:00:02] production.warning: slow query',
      '',
    ].join('\n');
    await bootTwoPanes(page, { files: { ...files, '/r/app4j.log': log4j, '/r/laravel.log': laravel }, open: ['/r/app4j.log'] });
    await coloured(page);
    const levels = () => page.evaluate(() => [...document.querySelectorAll('#doc .marxy-log-level')].map((l) => [l.textContent, getComputedStyle(l).fontWeight]));
    assert.deepEqual((await levels()).map((l) => l[0]), ['INFO', 'ERROR', 'DEBUG']);
    const offset = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marxy-weight-offset').trim());
    const weights = (await levels()).map((l) => Number(l[1]));
    assert.equal(weights[1], 700 + Number(offset), 'ERROR is weight 700');
    assert.ok(weights[0] < weights[1] && weights[2] < weights[1], `INFO and DEBUG are not (${weights})`);
    await chooseLevel(page, 'error');
    assert.deepEqual(await page.evaluate(() => window.__shownLines()), log4j.split('\n').slice(1, 3));
    await open(page, '/r/laravel.log');
    await coloured(page);
    assert.deepEqual((await levels()).map((l) => l[0]), ['INFO', 'ERROR', 'warning']);
    await chooseLevel(page, 'warn');
    assert.deepEqual(await page.evaluate(() => window.__shownLines()), laravel.split('\n').slice(1, 4));
  }));

test('a log with no level words cannot be filtered, and says so: the tool is off with its reason, and Jump to first error does not say there is no ERROR line', () =>
  withPage(async (page) => {
    const json = '{"time":"2026-10-12T09:00:00Z","level":"info","msg":"start"}\n{"time":"2026-10-12T09:00:01Z","level":"error","msg":"boom"}\n';
    await bootTwoPanes(page, { files: { ...files, '/r/lines.log': json }, open: ['/r/lines.log'] });
    await page.waitForSelector('#doc pre.language-log');
    const seen = await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      const ctx = buildAppContext(handle);
      const filter = handle.commands().find((c) => c.id === 'log.filter-level');
      const jump = handle.commands().find((c) => c.id === 'log.first-error');
      const offered = filter.when(ctx);
      const why = filter.unavailable(ctx);
      await jump.run(ctx);
      return { offered, why, jumpOffered: jump.when(ctx), notices: [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent) };
    });
    assert.equal(seen.offered, false, 'Filter by level is off');
    assert.equal(seen.why, 'No level words found in this log');
    assert.ok(seen.notices.some((t) => t.startsWith('No level words found in this log · nothing moved · ')), JSON.stringify(seen.notices));
    assert.ok(!seen.notices.some((t) => t.includes('No ERROR line')), 'it does not say there is no ERROR line');
    // A log that has them is on again. (The strip that drew the tool off went with the frame; the command is the tool.)
    await open(page, '/r/build.log');
    await page.waitForSelector('#doc pre.language-log');
    await page.waitForFunction(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      const ctx = buildAppContext(handle);
      const filter = handle.commands().find((c) => c.id === 'log.filter-level');
      return filter.when(ctx) === true && filter.unavailable(ctx) === null;
    });
  }));

test('a file that changes on disk while a level is being set: the notice when it is done counts the new file', () =>
  withPage(async (page) => {
    const rows = (n, level) => Array.from({ length: n }, (_, i) => `2026-10-12T09:00:00.${String(i % 1000).padStart(3, '0')}Z ${level.padEnd(5)} worker   handled request ${i} for /v1/tide/${i % 997}\n`).join('');
    const old = rows(30_000, 'INFO') + rows(10, 'WARN');
    await bootTwoPanes(page, { files: { ...files, '/r/grow.log': old }, open: ['/r/grow.log'], guard: true });
    await page.waitForSelector('#doc pre.language-log');
    await page.evaluate(PAGE_HELPERS);
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      await handle.commands().find((c) => c.id === 'log.filter-level').run(buildAppContext(handle));
    });
    // The page's frame callbacks are held from before the click, so the level is chosen and none of its work has begun: the
    // filter is busy for exactly as long as the test says, whatever the machine's speed.
    await page.evaluate(() => {
      const real = window.requestAnimationFrame.bind(window);
      const held = [];
      window.__gate = { open: false, release: () => { window.__gate.open = true; window.requestAnimationFrame = real; for (const cb of held.splice(0)) real(cb); } };
      window.requestAnimationFrame = (cb) => (window.__gate.open ? real(cb) : (held.push(cb), held.length));
    });
    await page.click('[data-row-key="log.level.warn"]');
    // Another program appends a thousand ERROR lines while the page is still being worked through.
    const grown = old + rows(1000, 'ERROR');
    const busy = await page.evaluate(async ([path, text]) => {
      const busy = document.querySelector('#doc').classList.contains('marxy-log-filter-busy');
      await window.__outside(path, text);
      window.__gate.release();
      return busy;
    }, ['/r/grow.log', grown]);
    assert.equal(busy, true, 'the file changed while the level was being set');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent.startsWith('Warn and above')), null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    const notices = await page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).filter((t) => t.startsWith('Warn and above')));
    const total = 30_000 + 10 + 1000;
    assert.deepEqual(notices, [`Warn and above · 30,000 lines of ${total.toLocaleString('en-US')} hidden · the file is unchanged`], 'the numbers are the new file\'s');
  }));

// ---- commitment 5: a log of megabytes, just under the lines tier ------------------------------------------------------------

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

test(`a log of ${process.env.MARXY_LOG_MB ?? 4.5} MB: first text does not wait for the last chunk, and a filter is the whole file's: the notice, the page, a copy and the end of the log agree`, () =>
  withPage(async (page) => {
    const mb = Number(process.env.MARXY_LOG_MB ?? 4.5);
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
    // The page's own work at the end of a mount (typesetting, the grid) is not the filter's: let it finish before the filter is timed.
    await page.waitForTimeout(2500);
    await page.evaluate(PAGE_HELPERS);

    // The filter, chosen as a reader does. The page is worked through a slice a frame and stays live: the longest stretch the
    // main thread is held, the time to the first filtered screen and the time to every piece of the file are recorded.
    const timing = await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const { filterOf } = await import('/src/kinds/log-view.ts');
      const handle = window.__marxyHandle;
      const pane = handle.panes().focused;
      await handle.commands().find((c) => c.id === 'log.filter-level').run(buildAppContext(handle));
      let worst = 0;
      let lastBeat = performance.now();
      const began = performance.now();
      window.__blocks = [];
      const beat = setInterval(() => { const t = performance.now(); if (t - lastBeat > 60) window.__blocks.push([Math.round(lastBeat - began), Math.round(t - lastBeat)]); worst = Math.max(worst, t - lastBeat); lastBeat = t; }, 4);
      document.querySelector('[data-row-key="log.level.warn"]').click();
      // What proves the filter is sliced, whatever the machine: how much of the file each slice (one frame's task) presented.
      // The work is time-budgeted, so a slow machine only makes more, smaller slices; one task doing it all is the failure.
      const steps = [];
      let seenFraction = 0;
      let live = filterOf(pane.article, pane.view.store());
      while (live === undefined) { await new Promise((r) => setTimeout(r, 0)); live = filterOf(pane.article, pane.view.store()); }
      const stop = live.subscribe((state) => { steps.push(state.fraction - seenFraction); seenFraction = state.fraction; });
      while (document.querySelector('.marxy-log-hidden-run') === null) await new Promise((r) => setTimeout(r, 2));
      const firstScreen = performance.now() - began;
      const pill = document.querySelector('.marxy-notice-text')?.textContent ?? '';
      while (filterOf(pane.article, pane.view.store()) === undefined || filterOf(pane.article, pane.view.store()).busy()) await new Promise((r) => setTimeout(r, 5));
      const applied = performance.now() - began;
      await new Promise((r) => setTimeout(r, 300));
      clearInterval(beat);
      stop();
      return { slices: steps.length, widest: Math.max(0, ...steps), blocks: window.__blocks, firstScreen, applied, worst, pill, runs: document.querySelectorAll('.marxy-log-hidden-run').length };
    });
    console.log(`# log ${mb} MB filtered to Warn: first filtered screen ${timing.firstScreen.toFixed(0)} ms, every piece of the file ${timing.applied.toFixed(0)} ms, in ${timing.slices} slices, the widest ${(timing.widest * 100).toFixed(1)}% of the file, longest main-thread block ${timing.worst.toFixed(0)} ms ${JSON.stringify(timing.blocks)}`);
    assert.ok(timing.runs > 0);
    // Slicing is asserted structurally, not by the clock (a slow machine must not fail a check). The wall-clock hold
    // (`longest main-thread block`, printed above) is a record for a person to read, never a bound.
    assert.ok(timing.slices >= 5, `the filter ran in ${timing.slices} slices; a file this size is worked through in many`);
    assert.ok(timing.widest < 0.5, `one slice presented ${(timing.widest * 100).toFixed(0)}% of the file; each is a bounded share`);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent.startsWith('Warn and above')), null, { timeout: 120_000 });

    // The model, over the whole file: what Warn hides, and what it keeps.
    const agree = await page.evaluate(async () => {
      const { countHidden, keptLines } = await import('/src/kinds/log-filter.ts');
      const { filterOf } = await import('/src/kinds/log-view.ts');
      const pane = window.__marxyHandle.panes().focused;
      const text = pane.view.store().snapshot().buffer.text;
      const model = await countHidden(text, 2, () => new Promise((r) => setTimeout(r, 0)));
      const notice = [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).find((t) => t.startsWith('Warn and above')) ?? '';
      const lines = text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const kept = keptLines(lines, 2).map((i) => lines[i]);
      const pieces = [...document.querySelectorAll('#doc pre.language-log')];
      return {
        model,
        noticeHidden: Number(/ ([\d,]+) lines of/.exec(notice)?.[1].replaceAll(',', '')),
        page: filterOf(pane.article, pane.view.store()).hiddenLines(),
        pieces: pieces.length,
        shownMatchKept: window.__shownLines().length === kept.length && window.__shownLines().every((l, i) => l === kept[i]),
        kept: kept.length,
        shown: window.__shownLines().length,
      };
    });
    assert.equal(agree.noticeHidden, agree.model.hidden, 'the notice says what the model hides');
    assert.equal(agree.page, agree.model.hidden, 'and the page hides exactly that');
    assert.ok(agree.model.hidden > size.lines * 0.5, 'most lines of this log are below Warn');
    assert.ok(agree.shownMatchKept, `the page shows the ${agree.kept} lines Warn keeps and no others (${agree.shown} shown)`);

    // Select all and copy: exactly the lines shown, the file's own.
    const key = await modifier(page);
    // On an ERROR line: a click on the words of a run would open it.
    await page.locator('#doc .marxy-log-error').first().click();
    await page.keyboard.press(`${key}+KeyA`);
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'), null, { timeout: 120_000 });
    const copy = await page.evaluate(() => {
      const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
      const text = new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes);
      const shown = window.__shownLines();
      const same = text === shown.join('\n') + '\n';
      return { same, lines: text.split('\n').length - 1, shown: shown.length, below: text.split('\n').filter((l) => / (INFO|DEBUG) /.test(l.slice(0, 40))).length };
    });
    assert.equal(copy.below, 0, 'no line below Warn is on the clipboard');
    assert.ok(copy.same, `the copy is the ${copy.shown} lines shown (${copy.lines} on the clipboard)`);

    // A jump to the end, and back to the middle: no frame paints a line below the level.
    const frames = await page.evaluate(async () => {
      let violations = 0;
      let sampled = 0;
      let running = true;
      const sample = () => {
        sampled++;
        for (const pre of document.querySelectorAll('#doc pre.language-log:not(.marxy-log-hidden-piece)')) {
          const box = pre.getBoundingClientRect();
          if (box.bottom < 0 || box.top > window.innerHeight || getComputedStyle(pre.firstElementChild).visibility === 'hidden') continue;
          for (const line of window.__lineText(pre.firstElementChild).split('\n')) if (/ (INFO|DEBUG) /.test(line.slice(0, 40))) violations++;
        }
        if (running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      for (const at of [1, 0.5, 0.99, 0.25, 1]) {
        window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * at);
        await new Promise((r) => setTimeout(r, 800));
      }
      running = false;
      return { violations, sampled };
    });
    assert.ok(frames.sampled > 4, `${frames.sampled} frames were sampled`);
    assert.equal(frames.violations, 0, 'no frame showed a line below Warn');
  }));

test('a filter chosen while the log is still being put on the page filters every piece that arrives, before it is drawn', () =>
  withPage(async (page) => {
    await bootLarge(page, 4);
    await page.waitForFunction(() => window.__firstText !== null, null, { timeout: 60_000 });
    await page.evaluate(PAGE_HELPERS);
    const seen = await page.evaluate(async () => {
      const { filterFor } = await import('/src/kinds/log-view.ts');
      const { levelOf, countHidden } = await import('/src/kinds/log-filter.ts');
      const pane = window.__marxyHandle.panes().focused;
      const filter = filterFor(pane.article, pane.view.store(), () => true);
      const stillMounting = window.__complete === null;
      const piecesThen = document.querySelectorAll('#doc pre.language-log').length;
      filter.setLevel(levelOf('warn'));
      // Every frame from here on: a line below Warn painted in a piece that is drawn.
      let violations = 0;
      let running = true;
      const sample = () => {
        for (const pre of document.querySelectorAll('#doc pre.language-log:not(.marxy-log-hidden-piece)')) {
          if (pre.getBoundingClientRect().height === 0 || getComputedStyle(pre.firstElementChild).visibility === 'hidden') continue;
          for (const line of window.__lineText(pre.firstElementChild).split('\n')) if (/ (INFO|DEBUG) /.test(line.slice(0, 40))) violations++;
        }
        if (running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      while (window.__complete === null) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 500));
      running = false;
      const text = pane.view.store().snapshot().buffer.text;
      const model = await countHidden(text, 2, () => new Promise((r) => setTimeout(r, 0)));
      return { stillMounting, piecesThen, piecesNow: document.querySelectorAll('#doc pre.language-log').length, violations, page: filter.hiddenLines(), model: model.hidden };
    });
    assert.ok(seen.stillMounting && seen.piecesNow > seen.piecesThen, `${seen.piecesNow} pieces arrived after the filter was chosen with ${seen.piecesThen} there`);
    assert.equal(seen.violations, 0, 'no frame drew a line below Warn');
    assert.equal(seen.page, seen.model, 'the page hides what the model hides, the pieces that came later included');
  }));

test('while a level is being set the page stays live: a pill says how far, nothing unfiltered is drawn, a copy says it must wait, and Esc shows every line', () =>
  withPage(async (page) => {
    await bootLarge(page, 4.5);
    await page.waitForFunction(() => window.__complete !== null, null, { timeout: 120_000 });
    await page.evaluate(PAGE_HELPERS);
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      await handle.commands().find((c) => c.id === 'log.filter-level').run(buildAppContext(handle));
    });
    // From the click on, every frame is looked at.
    await page.evaluate(() => {
      window.__violations = 0;
      window.__sampling = true;
      const sample = () => {
        for (const pre of document.querySelectorAll('#doc pre.language-log:not(.marxy-log-hidden-piece)')) {
          const box = pre.getBoundingClientRect();
          if (box.bottom < 0 || box.top > window.innerHeight || getComputedStyle(pre.firstElementChild).visibility === 'hidden') continue;
          for (const line of window.__lineText(pre.firstElementChild).split('\n')) if (/ (INFO|DEBUG) /.test(line.slice(0, 40))) window.__violations++;
        }
        if (window.__sampling) requestAnimationFrame(sample);
      };
      // The first frame looked at is the first after the click that chooses the level.
      document.addEventListener('click', () => requestAnimationFrame(sample), { capture: true, once: true });
    });
    // The filter is held after a few slices, until the page is released below: the steps that follow ask what a page says
    // *while* a level is being set, and a fast machine finishes ten megabytes of filtering between two of them. When it did,
    // the page was a few thousand pixels shorter under the click's scroll, which in WebKit left the page at its foot and the
    // click's point off screen.
    await page.evaluate(() => {
      const raf = window.requestAnimationFrame.bind(window);
      const held = [];
      let free = 5;
      window.__release = () => { window.requestAnimationFrame = raf; for (const cb of held.splice(0)) raf(cb); };
      window.requestAnimationFrame = (cb) => {
        if (cb.name !== 'slice' || free-- > 0) return raf(cb);
        held.push(cb);
        return 0;
      };
    });
    await page.click('[data-row-key="log.level.warn"]');
    const pill = await page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));
    assert.ok(pill.some((t) => /^Filtering to Warn · \d+% · the file is unchanged · Esc stops$/.test(t)), JSON.stringify(pill));
    assert.equal(await page.evaluate(() => document.querySelector('#doc').classList.contains('marxy-log-filter-busy')), true, 'the page knows it is busy');
    // A copy now says it must wait, and puts nothing on the pasteboard.
    const key = await modifier(page);
    // The selection is made in the page: select-all follows the focus, and while the pill is up a click near the top of a
    // log that is millions of pixels tall can leave it on the pill's words, and Playwright's own scroll to that click can
    // leave its point off screen. What is asked here is what a copy of the log's text says.
    await page.evaluate(() => getSelection().selectAllChildren(document.querySelector('#doc')));
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent.startsWith('Still filtering this log · nothing was copied')), null, { timeout: 10_000 });
    assert.equal(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length), 0);
    // Esc stops it and shows every line (from here a line below Warn is allowed on the page).
    const violations = await page.evaluate(() => { window.__sampling = false; return window.__violations; });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__release());
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent === 'All lines shown · the file is unchanged'), null, { timeout: 60_000 });
    const after = await page.evaluate(() => ({
      wrappers: document.querySelectorAll('.marxy-log-hidden-text, .marxy-log-hidden-run, .marxy-log-hidden-piece').length,
      filtering: document.querySelector('#doc').classList.contains('marxy-log-filtering'),
      pills: [...document.querySelectorAll('.marxy-notice-text')].filter((n) => n.textContent.startsWith('Filtering to')).length,
    }));
    assert.equal(violations, 0, 'no frame drew a line below Warn while it was being set');
    assert.equal(after.wrappers, 0, 'every line is shown again');
    assert.equal(after.filtering, false);
    assert.equal(after.pills, 0, 'the pill is gone');
  }));
