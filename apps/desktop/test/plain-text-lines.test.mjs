// A .txt looks like the file: it keeps its lines unless it carries Markdown marks. A notice with a tide table, numbered
// sections and bullets is set as written, every line drawn on its own over its own bytes; a .txt with headings, code and
// links is its Markdown page. WebKit, over the shipped skeleton and the memory shell, as log.test.mjs runs.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const notice = [
  "HARBOUR MASTER'S OFFICE - NOTE TO MASTERS AND PILOTS",
  'Issue 14, dated 3 March 1998',
  '',
  'All vessels must report to the Harbour Master before entering the Lock Gate.',
  '',
  '1. Pilotage and dues',
  '   • Pilotage for vessels over 40 m is £60, payable at the office.',
  '   • A *special tide* surcharge of £12 applies at springs.',
  '',
  '2. Tide times (at the Ferry Steps)',
  '   High water   06:12   4.9 m',
  '   Low water    12:31   0.6 m',
  '   High water   18:40   5.1 m',
  '',
].join('\r\n');
const markdown = '## Install\n\nRun `make` first, then read the [guide](https://example.com/guide).\n\n- one\n- two\n';

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    await fn(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
  } finally {
    await browser.close();
  }
}

test('a notice in a .txt is set as written: every line on its own, its columns kept, each drawn line its own bytes', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files: { '/r/notice.txt': notice, '/r/readme.txt': markdown }, open: ['/r/notice.txt'] });
    await page.waitForSelector('#doc [data-marxy-reading="written"] .marxy-written-line');
    const seen = await page.evaluate(() => {
      const bytes = window.__marxyHandle.panes().focused.view.store().snapshot().buffer.bytes;
      const dec = new TextDecoder();
      return {
        mode: window.__marxyHandle.panes().focused.view.mode,
        paragraphs: document.querySelectorAll('#doc [data-marxy-reading] p[data-marxy-s]').length,
        lists: document.querySelectorAll('#doc ol, #doc ul, #doc em').length,
        lines: [...document.querySelectorAll('#doc .marxy-written-line')].map((l) => ({
          text: l.querySelector('.marxy-written-text').textContent,
          bytes: dec.decode(bytes.subarray(Number(l.dataset.marxyS), Number(l.dataset.marxyE))),
        })),
      };
    });
    assert.equal(seen.mode, 'rendered');
    assert.equal(seen.paragraphs, 0, 'nothing is joined into a paragraph');
    assert.equal(seen.lists, 0, 'no numbered line or bullet becomes a list, no `*` emphasis');
    const lines = notice.split('\r\n').slice(0, -1);
    assert.equal(seen.lines.length, lines.length, 'one drawn line for each line of the file');
    for (const [i, line] of lines.entries()) {
      assert.equal(seen.lines[i].text, line, `line ${i + 1} as the file writes it, a blank line with no mark in it`);
      assert.equal(seen.lines[i].bytes.replace(/\r$/, ''), line, `line ${i + 1} maps to its own bytes`);
    }
    await page.evaluate((p) => window.__marxyHandle.open(p), '/r/readme.txt');
    await page.waitForSelector('#doc h2');
    const md = await page.evaluate(() => ({
      reading: document.querySelector('#doc [data-marxy-reading]') !== null,
      code: document.querySelectorAll('#doc p code').length,
      links: document.querySelectorAll('#doc a[href]').length,
    }));
    assert.equal(md.reading, false, 'a .txt carrying Markdown marks is its Markdown page');
    assert.ok(md.code >= 1, 'code in backticks is code');
    assert.ok(md.links >= 1, 'a link is a link');
  }));
