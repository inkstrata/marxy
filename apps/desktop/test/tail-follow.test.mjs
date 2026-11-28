// A log that grows is followed by appending its new bytes: the old end is checked, only what follows is read, a reader
// at the end stays at the end, a reader further up keeps the place, and a file that shrank, was rotated or has unsaved
// edits in Marxy is handled as it always was. The log page (under 5 MB) and Lines (from 5 MB), over the memory shell,
// whose `calls` count every `readFile` and `readRange`.
import { strict as assert } from 'node:assert';
import { after, before, test as nodeTest } from 'node:test';
import { closeHarness, harnessBase } from './support/two-pane.mjs';
import { idle, openBrowser, skip } from './support/kit.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
let browser = null;
before(async () => {
  if (!skip) browser = await openBrowser();
});
after(async () => {
  await browser?.close();
  await closeHarness();
});

let PATH = '/demo/logs/tail.log';

/** Plants a log of about `kb` KB in the memory shell, opens it, and waits for its page. */
async function withLog(kb, fn, extra = '', file = 'tail.log', plain = false) {
  PATH = `/demo/logs/${file}`;
  const base = await harnessBase();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const problems = [];
  // The engine's note that a resize callback ran out of frame is not an error of the page.
  page.on('pageerror', (e) => {
    if (!e.message.startsWith('ResizeObserver loop')) problems.push(e.message);
  });
  try {
    await page.goto(`${base}?open=${encodeURIComponent('logs/build-2026-10-14.log')}`);
    await page.waitForFunction(() => window.marxy?.handle);
    const made = await page.evaluate(
      async ({ kb, path, extra, plain }) => {
        const lines = [];
        let n = 0;
        for (let i = 0; n < kb * 1024; i++) {
          const t = 8 * 3600 + i * 0.37;
          const stamp = `2026-11-19T${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${(t % 60).toFixed(3).padStart(6, '0')}Z`;
          const line = plain ? `station ${i} read ${1 + (i % 37)} units, kept as plain text` : `${stamp} ${i % 40 === 6 ? 'WARN ' : 'INFO '} api: GET /v2/stations/${i} 200 ${1 + (i % 37)} ms`;
          lines.push(line);
          n += line.length + 1;
        }
        const bytes = new TextEncoder().encode(`${lines.join('\n')}\n${extra}`);
        await window.marxy.shell.plant(path, bytes);
        await window.marxy.handle.open(path);
        return { lines: lines.length, bytes: bytes.length };
      },
      { kb, path: PATH, extra, plain },
    );
    await page.waitForFunction((file) => document.title.startsWith(file), file);
    await page.evaluate(() => window.marxy.handle.contentComplete());
    await fn(page, made);
  } finally {
    await page.close();
  }
  assert.deepEqual(problems, []);
}

const stamp = (i) => `2026-11-20T09:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
const newLines = (count, tag) => Array.from({ length: count }, (_, i) => `${stamp(i)} INFO  tail: ${tag} ${i}\n`).join('');

/**
 * Appends `text` to the file from outside and resolves once the page has reloaded (a `live_reload` mark). Returns the
 * shell calls made from the write on: what the watcher read.
 */
function growBy(page, text) {
  return page.evaluate(
    async ({ text, path }) => {
      const shell = window.marxy.shell;
      const old = await shell.readFile(path);
      const marks = () => shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
      const before = marks();
      const add = new TextEncoder().encode(text);
      const next = new Uint8Array(old.length + add.length);
      next.set(old, 0);
      next.set(add, old.length);
      await shell.plant(path, next);
      const from = shell.calls.length;
      shell.emit([{ kind: 'modified', path }]);
      while (marks() === before) await new Promise((r) => requestAnimationFrame(r));
      await window.marxy.handle.contentComplete();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const made = shell.calls.slice(from);
      return {
        reloaded: marks() > before,
        oldLength: old.length,
        added: add.length,
        readFiles: made.filter((c) => c.method === 'readFile').length,
        ranges: made.filter((c) => c.method === 'readRange').map((c) => c.args[2]),
        mark: shell.calls.findLast((c) => c.method === 'mark' && c.args[0] === 'live_reload')?.args[2] ?? '',
      };
    },
    { text, path: PATH },
  );
}

const distanceToEnd = (page) =>
  page.evaluate(() => {
    const s = document.scrollingElement;
    return s.scrollHeight - s.clientHeight - s.scrollTop;
  });

/** The store's bytes as text, from the document the page shows. */
const storeText = (page) => page.evaluate(() => new TextDecoder().decode(window.marxy.handle.document().snapshot().buffer.bytes));

/** True when the page's text has `needle` on it and it is on screen. */
const needleOnScreen = (page, needle) =>
  page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.querySelector('.marxy-article'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.includes(needle)) continue;
      const r = n.parentElement.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) return true;
    }
    return false;
  }, needle);

const scrollTo = (page, where) =>
  page.evaluate(async (where) => {
    const s = document.scrollingElement;
    s.scrollTop = where === 'end' ? s.scrollHeight : where === 'middle' ? s.scrollHeight / 2 : where;
    // Held still for twelve frames: the scroll and what it drew have finished.
    let last = NaN;
    for (let still = 0; still < 12; ) {
      await new Promise((r) => requestAnimationFrame(r));
      still = s.scrollTop === last ? still + 1 : 0;
      last = s.scrollTop;
    }
  }, where);

const place = (page) => page.evaluate(() => window.marxy.handle.sourceHarness().byteOffset);

test('a log at its end appends its new lines, reads only the new bytes, and stays at the end', async () => {
  await withLog(600, async (page) => {
    await scrollTo(page, 'end');
    assert.ok((await distanceToEnd(page)) <= 2, 'the reader starts at the end');
    const got = await growBy(page, newLines(30, 'APPENDED-AT-END'));
    assert.equal(got.reloaded, true);
    assert.equal(got.readFiles, 0, 'the whole file was not read again');
    assert.ok(got.ranges.length > 0, 'the new bytes were read by range');
    const read = got.ranges.reduce((a, b) => a + b, 0);
    assert.ok(read <= 2 * 64 * 1024 + got.added, `${read} bytes read for ${got.added} new ones (the old start and end, then the new)`);
    assert.match(got.mark, /appended=\d+/);
    assert.ok((await storeText(page)).endsWith(newLines(30, 'APPENDED-AT-END')), 'the store holds the old bytes with the new at their end');
    await page.waitForFunction(() => document.querySelector('.marxy-article')?.textContent.includes('APPENDED-AT-END 29'));
    await page.waitForFunction(() => {
      const s = document.scrollingElement;
      return s.scrollHeight - s.clientHeight - s.scrollTop <= 2;
    });
    assert.equal(await needleOnScreen(page, 'APPENDED-AT-END 29'), true, 'the last new line is on screen');
    // The next append is followed again.
    await growBy(page, newLines(5, 'SECOND-ROUND'));
    await page.waitForFunction(() => document.querySelector('.marxy-article')?.textContent.includes('SECOND-ROUND 4'));
    // The reader at the end is taken to the new end as the lines are drawn, a frame or more after they are in the text.
    await page.waitForFunction(() => {
      const s = document.scrollingElement;
      return s.scrollHeight - s.clientHeight - s.scrollTop <= 2;
    });
    assert.ok((await distanceToEnd(page)) <= 2);
  });
});

test('a log scrolled up appends its new lines and keeps the reader\'s place', async () => {
  await withLog(600, async (page) => {
    await scrollTo(page, 'middle');
    const before = await place(page);
    const top = await page.evaluate(() => document.scrollingElement.scrollTop);
    const got = await growBy(page, newLines(30, 'APPENDED-ABOVE-END'));
    assert.equal(got.readFiles, 0);
    await page.waitForFunction(() => document.querySelector('.marxy-article')?.textContent.includes('APPENDED-ABOVE-END 29'));
    assert.equal(await place(page), before, 'the reader is on the same byte');
    const after = await page.evaluate(() => document.scrollingElement.scrollTop);
    assert.ok(Math.abs(after - top) < 40, `scrolled ${top} then ${after}`);
    assert.ok((await distanceToEnd(page)) > 200, 'not taken to the end');
  });
});

test('a truncated log is read whole and shows the new file', async () => {
  await withLog(600, async (page) => {
    await scrollTo(page, 'end');
    const got = await page.evaluate(async (path) => {
      const shell = window.marxy.shell;
      const marks = () => shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
      const before = marks();
      const old = await shell.readFile(path);
      await shell.plant(path, new TextEncoder().encode('2026-11-20T10:00:00.000Z INFO  fresh start after truncation\n'));
      const from = shell.calls.length;
      shell.emit([{ kind: 'modified', path }]);
      while (marks() === before) await new Promise((r) => requestAnimationFrame(r));
      return { reloaded: marks() > before, was: old.length, readFiles: shell.calls.slice(from).filter((c) => c.method === 'readFile').length };
    }, PATH);
    assert.equal(got.reloaded, true);
    assert.ok(got.readFiles >= 1, 'a file that shrank is read whole');
    await page.waitForFunction(() => document.querySelector('.marxy-article')?.textContent.includes('fresh start after truncation'));
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-article').textContent.includes('/v2/stations/1 ')), false);
  });
});

test('a log rotated to a larger file is read whole', async () => {
  await withLog(600, async (page) => {
    const rotated = await page.evaluate(async (path) => {
      const shell = window.marxy.shell;
      const marks = () => shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
      const before = marks();
      const old = await shell.readFile(path);
      // Same length and then some, a different file all through.
      const text = `${'2026-11-21T00:00:00.000Z INFO  rotated line\n'.repeat(Math.ceil(old.length / 43) + 50)}`;
      await shell.plant(path, new TextEncoder().encode(text));
      const from = shell.calls.length;
      shell.emit([{ kind: 'modified', path }]);
      while (marks() === before) await new Promise((r) => requestAnimationFrame(r));
      return { reloaded: marks() > before, readFiles: shell.calls.slice(from).filter((c) => c.method === 'readFile').length, bigger: text.length > old.length };
    }, PATH);
    assert.equal(rotated.bigger, true);
    assert.equal(rotated.reloaded, true);
    assert.ok(rotated.readFiles >= 1, 'a rewritten file is read whole');
    assert.match(await storeText(page), /^2026-11-21T00:00:00.000Z INFO {2}rotated line/);
  });
});

test('a log copied and truncated, then grown past its old size in one tick, is read whole', async () => {
  await withLog(600, async (page) => {
    const got = await page.evaluate(async (path) => {
      const shell = window.marxy.shell;
      const marks = () => shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
      const before = marks();
      const old = await shell.readFile(path);
      // Another file all through, ending in the old file's last 64 KB and longer than it: the end alone cannot tell.
      const next = new Uint8Array(old.length + 40);
      next.set(old.subarray(old.length - 70000), next.length - 70000);
      next.set(new TextEncoder().encode('2026-11-22T00:00:00.000Z INFO  rotated head\n'), 0);
      next.fill(0x20, 44, next.length - 70000);
      await shell.plant(path, next);
      const from = shell.calls.length;
      shell.emit([{ kind: 'modified', path }]);
      while (marks() === before) await new Promise((r) => requestAnimationFrame(r));
      return { reloaded: marks() > before, readFiles: shell.calls.slice(from).filter((c) => c.method === 'readFile').length };
    }, PATH);
    assert.equal(got.reloaded, true);
    assert.ok(got.readFiles >= 1, 'a file whose start changed is read whole');
    assert.match(await storeText(page), /^2026-11-22T00:00:00.000Z INFO {2}rotated head/);
  });
});

test('a log with unsaved edits in Marxy is not appended to: the change waits for the reader\'s choice', async () => {
  await withLog(600, async (page) => {
    const kept = await page.evaluate(async (path) => {
      const store = window.marxy.handle.document();
      const typed = await store.apply({ range: { file: path, start: 0, end: 0 }, replacement: 'MY NOTE ', label: 'type' });
      const mine = new TextDecoder().decode(store.snapshot().buffer.bytes.subarray(0, 8));
      const shell = window.marxy.shell;
      const old = await shell.readFile(path);
      // The file on disk is what Marxy loaded; the change appends to that, not to the edited buffer.
      const base = old.slice(0, old.length);
      const add = new TextEncoder().encode('2026-11-20T09:00:00.000Z INFO  appended behind unsaved edits\n');
      const next = new Uint8Array(base.length + add.length);
      next.set(base, 0);
      next.set(add, base.length);
      await shell.plant(path, next);
      const from = shell.calls.length;
      shell.emit([{ kind: 'modified', path }]);
      while (store.conflict() === null) await new Promise((r) => requestAnimationFrame(r));
      const made = shell.calls.slice(from);
      return {
        typed,
        mine,
        conflict: store.conflict() !== null,
        ranges: made.filter((c) => c.method === 'readRange').length,
        still: new TextDecoder().decode(store.snapshot().buffer.bytes.subarray(0, 8)),
        endsWithNew: new TextDecoder().decode(store.snapshot().buffer.bytes.subarray(-20)).includes('unsaved edits'),
      };
    }, PATH);
    assert.equal(kept.typed, true);
    assert.equal(kept.conflict, true, 'the change is held for the reader\'s choice');
    assert.equal(kept.ranges, 0, 'nothing was appended blindly');
    assert.equal(kept.still, 'MY NOTE ');
    assert.equal(kept.endsWithNew, false);
  });
});

const E = '\u001b';
const foldOf = (page) => page.$$eval('.marxy-article .marxy-log-account .marxy-account-body p', (ps) => ps.map((p) => p.textContent));

test('escapes only in the last piece of a log are in the fold, and escapes in appended lines join it', async () => {
  const warn = `2026-11-19T23:00:00.000Z WARN  ${E}[33mlast piece only${E}[0m\n`;
  // Small enough to be one or two pieces, all drawn at once: the fold is made when the last piece is drawn.
  await withLog(
    6,
    async (page) => {
      await page.waitForSelector('.marxy-article .marxy-log-account', { state: 'attached', timeout: 15_000 });
      const fold = await foldOf(page);
      assert.ok(fold.length > 0 && fold[0].includes('yellow as the warning tone'), `the fold names the escape of the last piece: ${JSON.stringify(fold)}`);
      assert.equal(fold[0].includes('red'), false);
      await growBy(page, `2026-11-20T09:00:00.000Z ERROR ${E}[1;31mappended red${E}[0m\n`);
      await page.waitForFunction(() => document.querySelector('.marxy-article')?.textContent.includes('appended red'));
      await page.waitForFunction(() => /red as the error tone/.test(document.querySelector('.marxy-article .marxy-log-account')?.textContent ?? ''));
      const after = await foldOf(page);
      assert.ok(after[0].includes('yellow as the warning tone') && after[0].includes('red as the error tone'), JSON.stringify(after));
    },
    warn,
  );
  await withLog(6, async (page) => {
    assert.deepEqual(await foldOf(page), [], 'a log with no escapes has no fold');
    await growBy(page, `2026-11-20T09:00:00.000Z WARN  ${E}[33mnow coloured${E}[0m\n`);
    await page.waitForFunction(() => /yellow as the warning tone/.test(document.querySelector('.marxy-article .marxy-log-account')?.textContent ?? ''));
  });
});

test('a piece drawn before it is marked done puts its escapes in the fold', async () => {
  const base = await harnessBase();
  const page = await browser.newPage();
  try {
    await page.goto(`${base}?open=${encodeURIComponent('logs/build-2026-10-14.log')}`);
    await page.waitForFunction(() => window.marxy?.handle);
    const fold = await page.evaluate(async () => {
      const { drawLogPiece } = await import('/src/render/log-page.ts');
      const article = document.createElement('div');
      article.className = 'marxy-article';
      const piece = (text, esc) => {
        const pre = document.createElement('pre');
        pre.className = 'language-log marxy-run';
        const code = document.createElement('code');
        const line = document.createElement('span');
        line.className = 'marxy-line';
        line.append(document.createTextNode(`2026-11-19T09:00:00.000Z INFO  ${text}`));
        if (esc) {
          const e = document.createElement('span');
          e.className = 'marxy-log-esc';
          e.textContent = esc;
          line.append(e);
        }
        code.append(line);
        pre.append(code);
        return { pre, code };
      };
      const first = piece('plain', '');
      const last = piece('coloured', '\u001b[33m');
      first.code.dataset.marxyDone = 'highlight';
      article.append(first.pre, last.pre);
      document.body.append(article);
      // The last piece is drawn as the page draws it: its lines are made, `data-marxy-done` comes after.
      drawLogPiece(last.code);
      const text = article.querySelector('.marxy-log-account')?.textContent ?? null;
      article.remove();
      return text;
    });
    assert.ok(fold !== null && fold.includes('yellow'), `the escape of the piece drawn last is in the fold: ${fold}`);
  } finally {
    await page.close();
  }
});

// ---- Lines: a log from 5 MB --------------------------------------------------------------------------------------------

const rowsOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-article .marxy-lines-row')].map((row) => {
      const box = row.getBoundingClientRect();
      return { no: Number(row.querySelector('.marxy-lines-no').textContent), top: box.top, bottom: box.bottom, text: row.querySelector('.marxy-lines-text').textContent };
    }),
  );

test('Lines: a 5 MB log appends only the new bytes and a reader at the end stays on the last line', async () => {
  await withLog(5 * 1024 + 200, async (page, made) => {
    await page.waitForSelector('.marxy-article .marxy-lines-row');
    await scrollTo(page, 'end');
    await scrollTo(page, 'end');
    const got = await growBy(page, newLines(40, 'LINES-AT-END'));
    assert.equal(got.reloaded, true);
    assert.equal(got.readFiles, 0);
    const read = got.ranges.reduce((a, b) => a + b, 0);
    assert.ok(read <= 2 * 64 * 1024 + got.added, `${read} bytes read for ${got.added} new ones`);
    assert.ok(got.oldLength > 5 * 1024 * 1024, 'the file is over the Lines size');
    await page.waitForFunction(() => document.querySelector('.marxy-article .marxy-lines-row'));
    await page.waitForFunction((n) => [...document.querySelectorAll('.marxy-lines-no')].some((e) => Number(e.textContent) === n), made.lines + 40);
    await idle(page);
    const rows = await rowsOf(page);
    const last = rows[rows.length - 1];
    assert.equal(last.no, made.lines + 40, 'the last line drawn is the last new line');
    assert.match(last.text, /LINES-AT-END 39/);
    assert.ok(last.bottom > 0 && last.top < 860, 'and it is on screen');
    assert.ok((await distanceToEnd(page)) <= 2);
    assert.equal(await page.evaluate(() => window.marxy.handle.panes().focused.content.store().parsed()), false, 'still no parse of the whole file');
  });
});

test('Lines: a big plain-text file (not a log) that grows is read whole', async () => {
  await withLog(5 * 1024 + 200, async (page) => {
    await page.waitForSelector('.marxy-article .marxy-lines-row');
    const got = await growBy(page, newLines(20, 'TEXT-GROWN'));
    assert.equal(got.reloaded, true);
    assert.ok(got.readFiles >= 1, 'only logs are followed by their tail');
    assert.equal(got.ranges.length, 0);
    assert.ok((await storeText(page)).endsWith(newLines(20, 'TEXT-GROWN')));
  }, '', 'dump.txt', true);
});

test('Lines: a reader above the end keeps the line at the top of the screen; a truncated log is read whole', async () => {
  await withLog(5 * 1024 + 200, async (page, made) => {
    await page.waitForSelector('.marxy-article .marxy-lines-row');
    await scrollTo(page, 'middle');
    const seen = (await rowsOf(page)).find((r) => r.top >= 0);
    const got = await growBy(page, newLines(40, 'LINES-ABOVE'));
    assert.equal(got.readFiles, 0);
    await idle(page);
    const after = (await rowsOf(page)).find((r) => r.no === seen.no);
    assert.ok(after && after.top >= -2 && after.top < 860, `line ${seen.no} is still on screen`);
    assert.ok(Math.abs(after.top - seen.top) < 60, `line ${seen.no} moved from ${seen.top} to ${after.top}`);
    assert.ok((await distanceToEnd(page)) > 1000);
    const cut = await page.evaluate(async (path) => {
      const shell = window.marxy.shell;
      const marks = () => shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
      const before = marks();
      await shell.plant(path, new TextEncoder().encode('2026-11-20T10:00:00.000Z INFO  lines fresh start\n'));
      const from = shell.calls.length;
      shell.emit([{ kind: 'modified', path }]);
      while (marks() === before) await new Promise((r) => requestAnimationFrame(r));
      return { reloaded: marks() > before, readFiles: shell.calls.slice(from).filter((c) => c.method === 'readFile').length };
    }, PATH);
    assert.equal(cut.reloaded, true);
    assert.ok(cut.readFiles >= 1, 'a file that shrank is read whole');
    assert.ok(made.lines > 1000);
    assert.match(await storeText(page), /lines fresh start/);
  });
});

test('Lines: the level filter and the line count follow the appended lines', async () => {
  await withLog(5 * 1024 + 200, async (page, made) => {
    await page.waitForSelector('.marxy-article .marxy-lines-row');
    const counted = await page.evaluate(async () => {
      const view = (await import('/src/view/reading-lines.ts')).linesViewIn(document.querySelector('.marxy-article'));
      const warned = await view.setLevel(2);
      return { level: view.level(), hidden: warned.hidden, total: warned.total };
    });
    assert.equal(counted.level, 2);
    const errors = Array.from({ length: 7 }, (_, i) => `${stamp(i)} ERROR tail: boom ${i}\n`).join('');
    await growBy(page, newLines(10, 'QUIET') + errors);
    await page.waitForFunction(() => document.querySelector('.marxy-lines-row'));
    await idle(page);
    await scrollTo(page, 'end');
    await scrollTo(page, 'end');
    const after = await page.evaluate(async () => {
      const view = (await import('/src/view/reading-lines.ts')).linesViewIn(document.querySelector('.marxy-article'));
      return { level: view.level(), count: view.lines.count, texts: [...document.querySelectorAll('.marxy-lines-text')].map((t) => t.textContent) };
    });
    assert.equal(after.level, 2, 'the level the reader chose is kept');
    assert.equal(after.count, made.lines + 17, 'the index counts the appended lines');
    assert.ok(after.texts.some((t) => t.includes('boom 6')), 'an appended error is among the lines the filter keeps');
    assert.equal(after.texts.some((t) => t.includes('QUIET')), false, 'an appended line below the level stays hidden');
  });
});
