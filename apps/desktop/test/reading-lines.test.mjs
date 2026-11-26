// A big log read as lines: a 20 MB log opens as Lines with only the rows near the screen on the page, each with its
// bytes; the end of the page is its last line; a resize keeps a screen of rows and the reader's line; find, the level
// filter and a jump to a byte reach every line of the file. Playwright WebKit over the app harness (src/harness/web.ts);
// the log is made in the page and written to the memory shell, so no large fixture is kept.
import { strict as assert } from 'node:assert';
import { after, before, test as nodeTest } from 'node:test';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { closeHarness, harnessBase } from './support/two-pane.mjs';
import { skip } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
let browser = null;
before(async () => {
  if (!skip) browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  await closeHarness();
});

const MB = 20;

async function withLog(fn) {
  const base = await harnessBase();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  try {
    await page.goto(`${base}?open=${encodeURIComponent('logs/build-2026-10-14.log')}`);
    await page.waitForFunction(() => window.marxy?.handle);
    // Every 46th line a warning that wraps, every 46th an error with a frame under it; the last line says so.
    const made = await page.evaluate(async (mb) => {
      const parts = [];
      let n = 0;
      for (let i = 0; n < mb * 1024 * 1024; i++) {
        const t = 8 * 3600 + i * 0.37;
        const stamp = `2026-11-19T${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${(t % 60).toFixed(3).padStart(6, '0')}Z`;
        const k = i % 46;
        let line = `${stamp} ${k === 6 ? 'WARN ' : k === 10 ? 'ERROR' : 'INFO '} api: GET /v2/stations/${i} 200 ${1 + (i % 37)} ms`;
        if (k === 6) line += ' select * from readings where station_id = $1 order by taken_at desc limit 500 offset 1000, a query long enough to wrap under itself';
        parts.push(line);
        if (k === 10) parts.push('    at ingest::validate (ingest/validate.rs:88)');
        n += line.length + 1;
      }
      parts.push('2026-11-19T23:59:59.999Z INFO  the very last line');
      const bytes = new TextEncoder().encode(`${parts.join('\n')}\n`);
      await window.marxy.shell.plant('/demo/logs/big.log', bytes);
      await window.marxy.handle.open('/demo/logs/big.log');
      return { lines: parts.length, bytes: bytes.length };
    }, MB);
    await page.waitForFunction(() => document.title.startsWith('big.log') && document.querySelector('.marxy-article .marxy-lines-row'));
    await fn(page, made);
  } finally {
    await page.close();
  }
  assert.deepEqual(problems, []);
}

const drawn = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-article .marxy-lines-row')].map((row) => {
      const box = row.getBoundingClientRect();
      return { no: Number(row.querySelector('.marxy-lines-no').textContent), s: Number(row.dataset.marxyS), e: Number(row.dataset.marxyE), top: box.top, bottom: box.bottom };
    }),
  );

const onScreen = (rows) => rows.filter((r) => r.bottom > 0 && r.top < 860);

/** What Ctrl+End does to the page: to the end of the scroll, and again, as a reader pressing it twice would. */
async function toEnd(page) {
  for (let i = 0; i < 2; i++) {
    await page.evaluate(async () => {
      document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
  }
}

test('a 20 MB log opens as Lines, its rows near the screen only, each with its bytes, and its end is its last line', async () => {
  await withLog(async (page, made) => {
    assert.equal(await page.textContent('.marxy-article .marxy-lines .marxy-reading-head'), 'Lines');
    assert.match(await page.textContent('.marxy-article .marxy-lines .marxy-account-body'), /Past 5 MB a text file is drawn as lines/);
    const top = await drawn(page);
    assert.ok(top.length > 20 && top.length < 300, `${top.length} rows on the page for ${made.lines} lines`);
    assert.equal(top[0].no, 1);
    const texts = await page.evaluate(async (rows) => {
      const bytes = await window.marxy.shell.readFile('/demo/logs/big.log');
      return rows.map((r) => new TextDecoder().decode(bytes.subarray(r.s, r.e)));
    }, top.slice(0, 12));
    const shown = await page.evaluate(() => [...document.querySelectorAll('.marxy-article .marxy-lines-text')].slice(0, 12).map((t) => t.textContent));
    assert.deepEqual(shown, texts, 'each row is its bytes, as the file writes them');
    // The time in the comment colour, a warning's level in bold.
    const marks = await page.evaluate(() => {
      const warn = document.querySelector('.marxy-lines-row[data-marxy-rank="2"] .marxy-lines-level');
      const info = document.querySelector('.marxy-lines-row[data-marxy-rank="1"] .marxy-lines-level');
      return { warn: getComputedStyle(warn).fontWeight, info: getComputedStyle(info).fontWeight, time: !!document.querySelector('.marxy-lines-time') };
    });
    assert.equal(marks.warn, '700');
    assert.notEqual(marks.info, '700');
    assert.equal(marks.time, true);
    // Nothing has asked for the parse of the whole file: the page is drawn from the bytes.
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => window.marxy.handle.panes().focused.content.store().parsed()), false);
    await toEnd(page);
    const end = await drawn(page);
    assert.ok(end.length < 300, `${end.length} rows at the end`);
    const last = end[end.length - 1];
    assert.equal(last.no, made.lines, 'the last row drawn is the last line');
    assert.ok(onScreen(end).some((r) => r.no === made.lines), 'and it is on screen');
  });
});

test('a resize keeps a screen of rows and the line the reader was on', async () => {
  await withLog(async (page) => {
    await page.evaluate(async () => {
      document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight / 2;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const before = onScreen(await drawn(page))[0].no;
    // Rows the resize puts on the page or changes: only those of the screen and its margin, never the file's.
    await page.evaluate(() => {
      window.__touched = 0;
      window.__seen = new MutationObserver((records) => {
        for (const r of records) window.__touched += r.addedNodes.length;
      });
      window.__seen.observe(document.querySelector('[data-marxy-lines]'), { childList: true });
    });
    await page.setViewportSize({ width: 900, height: 860 });
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(600);
    const touched = await page.evaluate(() => (window.__seen.disconnect(), window.__touched));
    const after = await drawn(page);
    assert.ok(after.length < 300, `${after.length} rows after the resize`);
    assert.ok(touched < 1500, `${touched} rows put on the page by two resizes`);
    const now = onScreen(after).map((r) => r.no);
    assert.ok(now.includes(before) || Math.abs(now[0] - before) < 5, `the reader's line ${before} stays on screen (now ${now[0]})`);
  });
});

test('find, the level filter and a jump to a byte reach every line of the file', async () => {
  await withLog(async (page, made) => {
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+f`);
    await page.keyboard.type('the very last line');
    await page.waitForFunction(() => /\b1 of 1\b/.test(document.querySelector('.marxy-find-slot')?.textContent ?? ''));
    await page.waitForFunction((n) => [...document.querySelectorAll('.marxy-article .marxy-lines-row')].some((row) => {
      const box = row.getBoundingClientRect();
      return row.querySelector('.marxy-lines-no').textContent === String(n) && box.top >= 0 && box.bottom <= innerHeight;
    }), made.lines);
    await page.keyboard.press('Escape');

    const hidden = await page.evaluate(async () => {
      const { setLogLevel } = await import('/src/commands/log.ts');
      const { levelOf } = await import('/src/kinds/log-filter.ts');
      await setLogLevel(levelOf('warn'));
      const { linesViewIn } = await import('/src/view/reading-lines.ts');
      return linesViewIn(document.querySelector('.marxy-article')).level();
    });
    assert.equal(hidden, 2);
    const kept = await drawn(page);
    const ranks = await page.evaluate(() => [...document.querySelectorAll('.marxy-article .marxy-lines-row')].map((r) => r.dataset.marxyRank ?? 'frame'));
    assert.ok(kept.length > 0 && ranks.every((r) => r === '2' || r === '3' || r === 'frame'), 'only warnings, errors and their frames');
    await page.evaluate(async () => {
      const { setLogLevel } = await import('/src/commands/log.ts');
      const { levelOf } = await import('/src/kinds/log-filter.ts');
      await setLogLevel(levelOf('all'));
    });

    const target = Math.floor(made.lines * 0.73);
    const byte = await page.evaluate(async (line) => {
      const bytes = await window.marxy.shell.readFile('/demo/logs/big.log');
      let n = 0;
      for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10 && ++n === line - 1) return i + 1;
      return -1;
    }, target);
    await page.evaluate((at) => window.marxy.handle.open('/demo/logs/big.log', { at }), byte);
    await page.waitForFunction((n) => [...document.querySelectorAll('.marxy-article .marxy-lines-row')].some((row) => {
      const box = row.getBoundingClientRect();
      return row.querySelector('.marxy-lines-no').textContent === String(n) && box.top >= 0 && box.bottom <= innerHeight;
    }), target);
  });
});

test('a 6 MB plain .txt opens as Lines, no time marked, and is never parsed behind its page', async () => {
  const base = await harnessBase();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  try {
    await page.goto(`${base}?open=${encodeURIComponent('logs/build-2026-10-14.log')}`);
    await page.waitForFunction(() => window.marxy?.handle);
    await page.evaluate(async () => {
      const line = 'the reader keeps a place in a long text and the page holds it while the window moves around it\n';
      const bytes = new TextEncoder().encode(line.repeat(Math.ceil((6 * 1024 * 1024) / line.length)));
      await window.marxy.shell.plant('/demo/notes/big.txt', bytes);
      await window.marxy.handle.open('/demo/notes/big.txt');
    });
    await page.waitForFunction(() => document.title.startsWith('big.txt') && document.querySelector('.marxy-article .marxy-lines-row'));
    assert.equal(await page.textContent('.marxy-article .marxy-lines .marxy-reading-head'), 'Lines');
    assert.equal(await page.$('.marxy-article .marxy-lines-time'), null);
    await page.evaluate(() => window.marxy.handle.panes().focused.view.contentComplete());
    await page.waitForTimeout(2000);
    assert.equal(await page.evaluate(() => window.marxy.handle.panes().focused.content.store().parsed()), false);
  } finally {
    await page.close();
  }
});

test('a level is kept across a reload that appends, find follows a change of level, and Show all stops a level being read', async () => {
  await withLog(async (page) => {
    const setLevel = (id) =>
      page.evaluate(async (id) => {
        const { setLogLevel } = await import('/src/commands/log.ts');
        const { levelOf } = await import('/src/kinds/log-filter.ts');
        await setLogLevel(levelOf(id));
      }, id);
    const level = () => page.evaluate(async () => (await import('/src/view/reading-lines.ts')).linesViewIn(document.querySelector('.marxy-article')).level());
    // Show all while Warn is still reading the ranks: Warn never lands.
    await page.evaluate(async () => {
      const { setLogLevel } = await import('/src/commands/log.ts');
      const { levelOf } = await import('/src/kinds/log-filter.ts');
      const warn = setLogLevel(levelOf('warn'));
      await setLogLevel(levelOf('all'));
      await warn;
    });
    assert.equal(await level(), 0);

    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+f`);
    await page.keyboard.type('WARN ');
    await page.waitForFunction(() => /\bof [1-9]/.test(document.querySelector('.marxy-find-slot')?.textContent ?? ''));
    await setLevel('error');
    await page.waitForFunction(() => /^0 of 0\b/.test(document.querySelector('.marxy-find-slot .marxy-find-count')?.textContent ?? ''));
    await page.keyboard.press('Escape');

    await setLevel('warn');
    assert.equal(await level(), 2);
    const appended = await page.evaluate(async () => {
      const path = '/demo/logs/big.log';
      const before = await window.marxy.shell.readFile(path);
      const tail = new TextEncoder().encode('2026-11-19T23:59:59.999Z WARN  appended after the reload\n2026-11-19T23:59:59.999Z INFO  hidden by the level\n');
      const next = new Uint8Array(before.length + tail.length);
      next.set(before);
      next.set(tail, before.length);
      window.marxy.shell.plant(path, next);
      window.marxy.shell.emit([{ kind: 'modified', path }]);
      return next.length;
    });
    await page.waitForFunction((n) => window.marxy.handle.panes().focused.content.store().snapshot().buffer.bytes.length === n, appended);
    await page.waitForFunction(async () => {
      const m = await import('/src/view/reading-lines.ts');
      const view = m.linesViewIn(document.querySelector('.marxy-article'));
      return view?.lines.bytes.length === window.marxy.handle.panes().focused.content.store().snapshot().buffer.bytes.length && view.level() === 2 && document.querySelector('.marxy-article .marxy-lines-row');
    });
    const ranks = await page.evaluate(() => [...document.querySelectorAll('.marxy-article .marxy-lines-row')].map((r) => r.dataset.marxyRank ?? 'frame'));
    assert.ok(ranks.every((r) => r === '2' || r === '3' || r === 'frame'), 'the reload drew only what the level keeps');
    await toEnd(page);
    const last = await page.evaluate(() => [...document.querySelectorAll('.marxy-article .marxy-lines-text')].at(-1)?.textContent);
    assert.match(last, /appended after the reload/);
  });
});

test('a find refreshed mid-count never reads a place past the total', async () => {
  await withLog(async (page) => {
    const text = () => page.evaluate(() => document.querySelector('.marxy-find-slot .marxy-find-count')?.textContent ?? '');
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+f`);
    await page.keyboard.type('WARN ');
    await page.waitForFunction(() => /^\d+ of [1-9]\d*$/.test(document.querySelector('.marxy-find-slot .marxy-find-count')?.textContent ?? ''));
    for (let i = 0; i < 5; i++) await page.keyboard.press('Enter');
    await page.waitForFunction(() => /^6 of \d+$/.test(document.querySelector('.marxy-find-slot .marxy-find-count')?.textContent ?? ''));
    // The refresh's read is held: it reports what it has counted so far and settles only when released.
    await page.evaluate(async () => {
      const { linesViewIn } = await import('/src/view/reading-lines.ts');
      const { activeFind } = await import('/src/find/view.ts');
      const find = linesViewIn(document.querySelector('.marxy-article')).find;
      window.__held = {
        report: (n) => window.__progress(n),
        release: (n) => window.__settle(n),
      };
      find.run = (_re, progress) => {
        window.__progress = progress;
        progress(2);
        return new Promise((resolve) => {
          window.__settle = resolve;
        });
      };
      activeFind().refresh();
    });
    await page.waitForFunction(() => /still counting/.test(document.querySelector('.marxy-find-slot .marxy-find-count')?.textContent ?? ''));
    assert.equal(await text(), '2 so far · still counting');
    // The edge: five counted is still short of the sixth match, six counted reaches it.
    await page.evaluate(() => window.__held.report(5));
    assert.equal(await text(), '5 so far · still counting');
    await page.evaluate(() => window.__held.report(6));
    assert.equal(await text(), '6 of 6 · still counting');
    await page.evaluate(() => window.__held.report(9));
    assert.equal(await text(), '6 of 9 · still counting');
    // Back to two counted, the sixth match still kept: forward stays put, back lands on the last match counted.
    await page.evaluate(() => window.__held.report(2));
    assert.equal(await text(), '2 so far · still counting');
    const at = () => page.evaluate(async () => (await import('/src/find/view.ts')).activeFind().state().current);
    await page.keyboard.press('Enter');
    assert.equal(await text(), '2 so far · still counting');
    assert.equal(await at(), 5);
    await page.keyboard.press('Shift+Enter');
    assert.equal(await text(), '2 of 2 · still counting');
    assert.equal(await at(), 1);
    // On the last match counted, forward still does not wrap to the first: more may follow.
    await page.keyboard.press('Enter');
    assert.equal(await text(), '2 of 2 · still counting');
    assert.equal(await at(), 1);
    await page.evaluate(() => window.__held.release(40));
    await page.waitForFunction(() => document.querySelector('.marxy-find-slot .marxy-find-count')?.textContent === '2 of 40');
    // Settled, stepping wraps as before.
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Shift+Enter');
    assert.equal(await text(), '40 of 40');
    await page.keyboard.press('Enter');
    assert.equal(await text(), '1 of 40');
  });
});

test('past 32 MB Read does not edit, and a level that keeps no line says so', async () => {
  const base = await harnessBase();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  try {
    await page.goto(`${base}?open=${encodeURIComponent('logs/build-2026-10-14.log')}`);
    await page.waitForFunction(() => window.marxy?.handle);
    await page.evaluate(async () => {
      const line = '2026-11-19T08:00:00.000Z INFO  api: a quiet line with nothing to report in it at all\n';
      const bytes = new TextEncoder().encode(line.repeat(Math.ceil((33 * 1024 * 1024) / line.length)));
      await window.marxy.shell.plant('/demo/logs/huge.log', bytes);
      await window.marxy.handle.open('/demo/logs/huge.log');
    });
    await page.waitForFunction(() => document.title.startsWith('huge.log') && document.querySelector('.marxy-article .marxy-lines-row'));
    assert.match(await page.textContent('.marxy-article .marxy-lines .marxy-account-body'), /Past 32 MB Read does not edit it; Source still does/);
    const applied = await page.evaluate(async () => {
      const store = window.marxy.handle.panes().focused.content.store();
      return window.marxy.handle.dispatch({ type: 'apply', range: { start: 0, end: 4 }, replacement: 'XXXX', label: 'Edit', baseVersion: store.snapshot().version });
    });
    assert.equal(applied, false);
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /Past 32 MB a file is only read here: Source edits it/.test(n.textContent)));
    assert.equal(await page.evaluate(() => window.marxy.handle.panes().focused.content.store().snapshot().dirty), false);
    await page.evaluate(async () => {
      const { setLogLevel } = await import('/src/commands/log.ts');
      const { levelOf } = await import('/src/kinds/log-filter.ts');
      await setLogLevel(levelOf('error'));
    });
    assert.equal(await page.textContent('.marxy-article .marxy-lines-none'), 'No lines at this level');
    assert.equal(await page.$('.marxy-article .marxy-lines-row'), null);
  } finally {
    await page.close();
  }
});

test('the Outline lists a log read as lines from its line index: its levels, its warnings and errors', async () => {
  await withLog(async (page) => {
    await page.evaluate(() => window.marxy.handle.frame().left.show('outline'));
    await page.waitForFunction(() => /Levels/.test(document.querySelector('.marxy-drawer')?.textContent ?? '') && /Warnings and errors/.test(document.querySelector('.marxy-drawer')?.textContent ?? ''));
    const text = await page.textContent('.marxy-drawer');
    assert.match(text, /WARN/);
    assert.match(text, /ERROR/);
  });
});
