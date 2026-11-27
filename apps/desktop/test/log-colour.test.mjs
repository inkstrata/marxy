// A log's ANSI colour in both log readings: the ordinary log page and the Lines reading (a log from 5 MB). The escape
// codes are hidden, never run; what they colour takes the theme's tones (yellow its warning tone, red its error tone);
// what the fold says moved there from under the entry; x-ray still shows the bytes, escapes included; every drawn piece
// keeps its byte range, so a range of the page is the file's bytes. WebKit over the app harness, as log.test.mjs runs.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

const E = '\u001b';
const HEAD = [
  '2026-11-19T09:00:01.000Z INFO  boot ok',
  `2026-11-19T09:00:02.000Z WARN  ${E}[33mslow frame${E}[0m: 48 ms`,
  `2026-11-19T09:00:03.000Z ERROR ${E}[1;31mgave up${E}[0m after ${E}[38;5;208mretry${E}[0m`,
  `2026-11-19T09:00:04.000Z INFO  ${E}[38;2;0;200;0mgreen${E}[0m ${E}]0;build title\u0007done ${E}[2K${E}[38;5mcut`,
].join('\n');
const SMALL = `${HEAD}\n`;
// Past 5 MB a log is read as Lines.
const FILLER = '2026-11-19T09:01:00.000Z INFO  api: GET /v2/stations 200 12 ms\n';
const BIG = `${HEAD}\n${FILLER.repeat(Math.ceil((5.2 * 1024 * 1024) / FILLER.length))}`;

const PANE = '[data-marxy-pane="0"]';
const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};

/** What the reader sees of the escape codes in `scope`: each sequence's size, room and mark, and the drawn tones. */
const seen = (page, scope, textSel) =>
  page.evaluate(({ scope, textSel }) => {
    const css = (el, pseudo) => getComputedStyle(el, pseudo);
    // An element's text without the markers' labels: what the file holds there.
    const plain = (el) => {
      const copy = el.cloneNode(true);
      for (const g of copy.querySelectorAll('.marxy-invisible-glyph')) g.remove();
      return copy.textContent.replace('\u001b', 'ESC');
    };
    const box = document.querySelector(scope);
    const probe = (value) => {
      const i = document.createElement('i');
      i.style.color = value;
      box.append(i);
      const c = css(i).color;
      i.remove();
      return c;
    };
    const colourOf = (cls) => {
      const el = box.querySelector(`.${cls}`);
      return el ? { text: el.textContent, colour: css(el).color, weight: Number(css(el).fontWeight) } : null;
    };
    const escs = [...box.querySelectorAll(`${textSel} .marxy-log-esc`)];
    return {
      hidden: escs.filter((e) => !e.classList.contains('marxy-log-esc-bad')).map((e) => ({ text: plain(e), size: css(e).fontSize, width: e.getBoundingClientRect().width, mark: css(e, '::before').content })),
      bad: escs.filter((e) => e.classList.contains('marxy-log-esc-bad')).map((e) => ({ text: plain(e), mark: css(e, '::before').content })),
      warn: colourOf('marxy-ansi-warn'),
      err: colourOf('marxy-ansi-err'),
      ok: colourOf('marxy-ansi-ok'),
      tones: { warn: probe('var(--marxy-color-status-warn)'), err: probe('var(--marxy-color-status-err)'), ok: probe('var(--marxy-tok-string)') },
      raw: box.querySelectorAll(`${textSel} [style*="color"]`).length,
      underEntry: box.querySelectorAll('[data-marxy-esc]').length,
    };
  }, { scope, textSel });

const warnWords = /^The file colours text with escape codes\./;

function assertDrawn(s, where, lines = false) {
  assert.deepEqual(
    s.hidden.map((h) => h.text),
    ['ESC[33m', 'ESC[0m', 'ESC[1;31m', 'ESC[0m', 'ESC[38;5;208m', 'ESC[0m', 'ESC[38;2;0;200;0m', 'ESC[0m', 'ESC]0;build title\u0007', 'ESC[2K'],
    `${where}: every well-formed code is hidden, a title and a clear among them`,
  );
  assert.ok(s.hidden.every((h) => h.size === '0px' && h.width < 1), `${where}: hidden at no size and no room ${JSON.stringify(s.hidden.map((h) => [h.size, h.width]))}`);
  assert.ok(s.hidden.every((h) => h.mark === 'none'), `${where}: no ESC box is drawn`);
  // A code cut short is not swallowed: the log page keeps its ESC mark; Lines leaves its text as the file has it.
  assert.deepEqual(s.bad.map((b) => b.text), lines ? [] : ['ESC[38;5m'], `${where}: a code cut short`);
  if (!lines) assert.equal(s.bad[0].mark, '"ESC"', `${where}: it keeps its mark`);
  assert.equal(s.warn?.text, 'slow frame');
  assert.equal(s.warn.colour, s.tones.warn, `${where}: yellow is the theme's warning tone`);
  assert.equal(s.err?.text, 'gave up');
  assert.equal(s.err.colour, s.tones.err, `${where}: red is its error tone`);
  assert.ok(s.err.weight >= 600, `${where}: bold is weight`);
  assert.equal(s.ok?.text, 'green');
  assert.equal(s.ok.colour, s.tones.ok, `${where}: truecolour green takes the string tone, not its own rgb`);
  assert.equal(s.raw, 0, `${where}: no inline colour`);
  assert.equal(s.underEntry, 0, `${where}: no sentence under the entry`);
}

/** Puts the cursor on the entry holding `needle` and x-rays it; resolves the x-ray's lines as the file stores them. */
async function xrayOf(page, needle) {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await keys(page, 'g', 'g');
  for (let i = 0; i < 12; i++) {
    const at = await page.evaluate((pane) => document.querySelector(`${pane} .marxy-cursor`)?.textContent ?? '', PANE);
    if (at.includes(needle)) break;
    await keys(page, 'j');
  }
  await keys(page, 'x');
  await page.waitForSelector(`${PANE} .marxy-xray`);
  return page.$$eval(`${PANE} .marxy-xray .marxy-xray-text`, (els) => els.map((e) => {
    const copy = e.cloneNode(true);
    for (const g of copy.querySelectorAll('.marxy-invisible-glyph')) g.remove();
    return copy.textContent;
  }));
}

test('the ordinary log page draws the colours in the theme\'s tones with the escapes hidden; the sentence is in the fold; x-ray shows the bytes', async () => {
  await withFrame({ files: { '/r/colour.log': SMALL }, open: ['/r/colour.log'] }, async (page) => {
    await page.waitForSelector(`${PANE} pre.language-log .marxy-log-esc`, { state: 'attached' });
    assertDrawn(await seen(page, `${PANE} .marxy-article`, 'pre.language-log'), 'log page');
    const fold = await page.$$eval(`${PANE} .marxy-log-account .marxy-account-body p`, (ps) => ps.map((p) => p.textContent));
    assert.match(fold[0], warnWords);
    assert.ok(fold[0].includes('yellow as the warning tone') && fold[0].includes('red as the error tone') && fold[0].includes('a truecolour code as the string tone'), fold[0]);
    assert.ok(fold.some((l) => l.startsWith('It also asks the terminal for a window title and clearing the line.') || l.startsWith('It also asks the terminal for clearing the line and a window title.')), JSON.stringify(fold));
    assert.ok(fold.some((l) => l.startsWith('One code is cut short or garbled')), 'the broken one is named');
    // X-ray over the whole page's bytes, as the file stores them.
    await page.evaluate(async () => {
      const { toggleXray } = await import('/src/depths/dress.ts');
      const pane = window.__marxyHandle.panes().panes[0];
      const end = pane.view.store().snapshot().buffer.bytes.length;
      toggleXray({ article: pane.article, store: () => pane.view.store(), mountThrough: (b) => pane.view.mountThrough(b) }, { start: 0, end });
    });
    await page.waitForSelector(`${PANE} .marxy-xray`);
    const xray = await page.$$eval(`${PANE} .marxy-xray .marxy-xray-text`, (els) => els.map((e) => {
      const copy = e.cloneNode(true);
      for (const g of copy.querySelectorAll('.marxy-invisible-glyph')) g.remove();
      return copy.textContent;
    }));
    assert.ok(xray.some((t) => t.includes(`${E}[33mslow frame${E}[0m`)), `x-ray shows the escape bytes: ${JSON.stringify(xray)}`);
  });
});

test('the Lines reading (a log from 5 MB) draws the same: tones, escapes hidden and still in their row\'s bytes, the fold, x-ray', async () => {
  await withFrame({ files: { '/r/big.log': BIG }, open: ['/r/big.log'] }, async (page) => {
    await page.waitForSelector('.marxy-article .marxy-lines-row .marxy-log-esc', { state: 'attached' });
    assert.equal(await page.textContent('.marxy-article .marxy-lines .marxy-reading-head'), 'Lines');
    assertDrawn(await seen(page, '.marxy-article', '.marxy-lines-text'), 'Lines', true);
    const fold = await page.$$eval('.marxy-article .marxy-lines .marxy-account-body p', (ps) => ps.map((p) => p.textContent));
    assert.ok(fold.some((l) => warnWords.test(l) && l.includes('yellow as the warning tone')), JSON.stringify(fold));
    assert.ok(fold.some((l) => l.startsWith('It also asks the terminal for ')), 'its controls are named');
    // Every drawn span keeps its byte range, and the range is the text the span holds: a selection reads the file.
    const ranges = await page.evaluate(async () => {
      const bytes = await window.__marxyHandle.shell.readFile('/r/big.log');
      const plain = (el) => {
        const copy = el.cloneNode(true);
        for (const g of copy.querySelectorAll('.marxy-invisible-glyph')) g.remove();
        return copy.textContent;
      };
      const out = [];
      for (const row of document.querySelectorAll('.marxy-lines-row')) {
        const rs = Number(row.dataset.marxyS);
        const re = Number(row.dataset.marxyE);
        for (const span of row.querySelectorAll('.marxy-lines-text [data-marxy-s]')) {
          const s = Number(span.dataset.marxyS);
          const e = Number(span.dataset.marxyE);
          out.push({ inside: rs <= s && e <= re, same: new TextDecoder().decode(bytes.subarray(s, e)) === plain(span) });
        }
        const text = row.querySelector('.marxy-lines-text');
        if (text.querySelector('.marxy-log-esc')) out.push({ inside: true, same: new TextDecoder().decode(bytes.subarray(rs, re)) === plain(text) });
      }
      return out;
    });
    assert.ok(ranges.length > 10, 'spans were checked');
    assert.deepEqual(ranges.filter((r) => !(r.inside && r.same)), [], 'each span is its bytes, inside its row');
    const xray = await xrayOf(page, 'slow frame');
    assert.ok(xray.some((t) => t.includes(`${E}[33mslow frame${E}[0m`)), `x-ray shows the escape bytes: ${JSON.stringify(xray)}`);
  });
});
