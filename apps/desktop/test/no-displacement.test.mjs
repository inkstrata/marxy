// F-45: a "no displacement" guard. Chrome that appears on a command (a sheet, a popup, a menu, a picker) floats over the
// page or sits in the chrome; the reading column and the text under it do not move by a pixel. For each surface in
// SURFACES below: scroll the article partway, record the first visible line's rect and the scroll position, open the
// surface, check both are unchanged, close it, check again. The real app over the memory shell, in WebKit.
//
// Notices are covered (F-46, U-02): a notice is a pill floated at the foot of its pane, off the column's flow, so raising or
// dismissing one (an outcome, a refusal, a decision that takes focus, three stacked) moves nothing. A floating notice can
// cover a line of text while it is up; the guard measures the rect and the scroll, not the cover. Notices over Source are
// measured in test/notices-pill.test.mjs, where the editor's own lines are the text.
// Not covered, on purpose: the inline block editor (in flow by design; it holds the reading line, see commands/block-edit.ts).
//
// To add a surface: append `{ name, open, close }` to SURFACES (`splitToo`: also run it with two panes; `splitOnly`: only with two). `open(page, s)` runs the command and resolves when the
// surface is up; `close(page, s)` dismisses it and resolves when it is gone. `s.mod` is the platform's modifier key.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { TRANSFORMS } from '../../../packages/core/src/index.ts';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const corpus = join(fileURLToPath(new URL('../../../fixtures/corpus/', import.meta.url)));
const A = '/r/long.md';
const B = '/r/other.md';
const DOC = skip ? '' : readFileSync(join(corpus, '01-long-technical.md'), 'utf8');
const TEXT = 'public.utf8-plain-text';
const FIRST_TRANSFORM = TRANSFORMS[0].name;

const escapeKey = (page) => page.keyboard.press('Escape');
const gone = (page, selector) => page.waitForFunction((sel) => !document.querySelector(sel), selector);

/** Every command-opened surface. Add new ones here. */
export const SURFACES = [
  {
    name: 'palette',
    open: async (page, s) => {
      await page.keyboard.press(`${s.mod}+Shift+KeyP`);
      await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
    },
    close: async (page) => {
      await escapeKey(page);
      await page.waitForFunction(() => !document.getElementById('marxy-palette')?.open);
    },
  },
  {
    name: 'outline',
    open: async (page, s) => {
      await page.keyboard.press(`${s.mod}+Shift+KeyO`);
      await page.waitForSelector('#marxy-outline[open]');
    },
    close: async (page) => {
      await escapeKey(page);
      await page.waitForFunction(() => !document.getElementById('marxy-outline')?.open);
    },
  },
  {
    name: 'find',
    open: async (page, s) => {
      await page.keyboard.press(`${s.mod}+KeyF`);
      await page.waitForSelector('.marxy-find');
    },
    close: async (page) => {
      await escapeKey(page);
      await gone(page, '.marxy-find');
    },
  },
  {
    name: 'verb menu',
    open: async (page) => {
      // Right-click the paragraph under the first visible line.
      const at = await page.evaluate(() => {
        const p = [...document.querySelectorAll('#doc p[data-marxy-s]')].find((e) => e.getBoundingClientRect().top > 40);
        const r = p.getBoundingClientRect();
        return { x: r.left + 20, y: r.top + 6 };
      });
      await page.mouse.click(at.x, at.y, { button: 'right' });
      await page.waitForSelector('.marxy-verb-menu');
    },
    close: async (page) => {
      await escapeKey(page);
      await gone(page, '.marxy-verb-menu');
    },
  },
  {
    name: 'transform sheet (document)',
    open: async (page, s) => {
      await page.keyboard.press(`${s.mod}+Slash`);
      await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
      await page.locator('#marxy-palette .marxy-palette-query').fill(`>Transform: ${FIRST_TRANSFORM}`);
      const row = page.locator('#marxy-palette .marxy-palette-title').filter({ hasText: new RegExp(`^Transform: ${FIRST_TRANSFORM}$`) });
      await row.waitFor();
      await row.click();
      await page.waitForSelector('#marxy-transform[open]');
    },
    close: async (page) => {
      await escapeKey(page);
      await page.waitForFunction(() => !document.getElementById('marxy-transform')?.open);
    },
  },
  {
    name: 'transform sheet (clipboard)',
    open: async (page, s) => {
      await page.evaluate((TEXT) => {
        window.__marxyHandle.shell.setPasteboard([{ [TEXT]: new TextEncoder().encode('pear\napple\nmango\n') }]);
      }, TEXT);
      await page.keyboard.press(`${s.mod}+Shift+KeyP`);
      await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
      await page.locator('#marxy-palette .marxy-palette-query').fill(`>Transform clipboard: ${FIRST_TRANSFORM}`);
      await page.waitForFunction((name) => document.querySelector('#marxy-palette .marxy-palette-row .marxy-palette-title')?.textContent === `Transform clipboard: ${name}`, FIRST_TRANSFORM);
      await page.keyboard.press('Enter');
      await page.waitForSelector('#marxy-transform[open]');
    },
    close: async (page) => {
      await escapeKey(page);
      await page.waitForFunction(() => !document.getElementById('marxy-transform')?.open);
    },
  },
  {
    name: 'notice (raised, then dismissed)',
    splitToo: true,
    open: async (page) => {
      await page.evaluate(async () => {
        const { notify } = await import('/src/notices/index.ts');
        notify({ kind: 'info', text: 'A notice, raised for the guard.' });
      });
      await page.waitForSelector('.marxy-notice');
    },
    close: async (page) => {
      await page.locator('.marxy-notice .marxy-notice-dismiss').first().click();
      await gone(page, '.marxy-notice');
    },
  },
  {
    name: 'notice (refusal, which stays until dismissed)',
    splitToo: true,
    open: async (page) => {
      await page.evaluate(async () => {
        const { notify } = await import('/src/notices/index.ts');
        notify({ kind: 'refused', text: 'A refusal, raised for the guard.' });
      });
      await page.waitForSelector('.marxy-notice[data-notice-kind="refused"]');
    },
    close: async (page) => {
      await page.locator('.marxy-notice .marxy-notice-dismiss').first().click();
      await gone(page, '.marxy-notice');
    },
  },
  {
    name: 'notice (decision, which takes focus; Esc dismisses it)',
    splitToo: true,
    open: async (page) => {
      await page.evaluate(async () => {
        const { notify } = await import('/src/notices/index.ts');
        notify({ kind: 'decision', text: 'A decision, raised for the guard.', actions: [{ label: 'Choose', onClick: () => {} }] });
      });
      await page.waitForFunction(() => document.activeElement?.classList.contains('marxy-notice-action'));
    },
    close: async (page) => {
      await escapeKey(page);
      await gone(page, '.marxy-notice');
    },
  },
  {
    name: 'notices (three at once)',
    splitToo: true,
    open: async (page) => {
      await page.evaluate(async () => {
        const { notify } = await import('/src/notices/index.ts');
        notify({ kind: 'done', text: 'First.' });
        notify({ kind: 'refused', text: 'Second.' });
        notify({ kind: 'error', text: 'Third.' });
      });
      await page.waitForFunction(() => document.querySelectorAll('.marxy-notice').length === 3);
    },
    close: async (page) => {
      for (let i = 0; i < 3; i++) await page.locator('.marxy-notice .marxy-notice-dismiss').first().click();
      await gone(page, '.marxy-notice');
    },
  },
  {
    // The Source frame (V-05) is chrome that arrives with a mode: Source in the other pane brings its bars and ruler, and the
    // reading column beside it does not move. It needs a second pane, so it runs split only.
    name: 'Source in the other pane (opened, then left)',
    splitOnly: true,
    open: async (page, s) => {
      await page.keyboard.press(`${s.mod}+Alt+ArrowRight`);
      await page.waitForFunction(() => document.querySelector('.marxy-pane[data-marxy-pane="1"]')?.hasAttribute('data-marxy-focus'));
      await page.keyboard.press(`${s.mod}+KeyE`);
      await page.waitForSelector('.marxy-pane[data-marxy-pane="1"] .marxy-source-frame');
    },
    close: async (page, s) => {
      await page.keyboard.press(`${s.mod}+KeyE`);
      await page.waitForFunction(() => document.querySelector('.marxy-pane[data-marxy-pane="1"]')?.dataset.marxyMode === 'rendered');
    },
  },
  {
    name: 'notice (empty clipboard transform)',
    splitToo: true,
    open: async (page, s) => {
      await page.evaluate(() => window.__marxyHandle.shell.setPasteboard([]));
      await page.keyboard.press(`${s.mod}+Shift+KeyP`);
      await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
      await page.locator('#marxy-palette .marxy-palette-query').fill(`>Transform clipboard: ${FIRST_TRANSFORM}`);
      await page.waitForFunction((name) => document.querySelector('#marxy-palette .marxy-palette-row .marxy-palette-title')?.textContent === `Transform clipboard: ${name}`, FIRST_TRANSFORM);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.marxy-notice');
    },
    close: async (page) => {
      await page.locator('.marxy-notice .marxy-notice-dismiss').first().click();
      await gone(page, '.marxy-notice');
    },
  },
];

/**
 * Where the reading column and the text under it are: the first line of text that is visible in the viewport (its
 * client rect), the article's box, and every scroller's position.
 */
const measure = (page) =>
  page.evaluate(() => {
    const article = document.getElementById('doc');
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let line = null;
    for (let n = walker.nextNode(); n && !line; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight) {
          line = { text: n.nodeValue.trim().slice(0, 40), x: r.x, y: r.y, w: r.width, h: r.height };
          break;
        }
      }
    }
    const a = article.getBoundingClientRect();
    return {
      line,
      article: { x: a.x, y: a.y, w: a.width, h: a.height },
      scrollY: window.scrollY,
      scrollX: window.scrollX,
      paneScrollTop: document.querySelector('.marxy-pane')?.scrollTop ?? 0,
    };
  });

async function withApp(fn, { split = false } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(page, { files: { [A]: DOC, [B]: DOC }, open: split ? [A, B] : [A], guard: true });
    await page.evaluate(async (initialPath) => {
      const { mountPaletteFromHandle } = await import('/src/palette/view.ts');
      const handle = window.__marxyHandle;
      const palette = mountPaletteFromHandle(handle, { initialPath });
      handle.setPaletteSession(() => palette.session);
    }, A);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, { mod });
  } finally {
    await browser.close();
  }
}

const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 250)));

/** The window as the reader has it: folded (the column alone), or unfolded (the workspace around it). */
const WINDOWS = ['folded', 'unfolded', 'split'];

for (const windowState of WINDOWS) {
  for (const surface of SURFACES) {
    if (windowState === 'split' && !surface.splitToo && !surface.splitOnly) continue;
    if (windowState !== 'split' && surface.splitOnly) continue;
    test(`${windowState}: ${surface.name}: opening and closing it moves neither the first visible line nor the scroll position`, async () => {
      await withApp(async (page, s) => {
        if (windowState === 'unfolded') await page.evaluate(() => window.__marxyHandle.workspace().unfold());
        // Split: each pane scrolls on its own; the window does not.
        await page.evaluate(() => (document.querySelector('#marxy-main[data-marxy-split]') ? document.querySelector('.marxy-pane').scrollTo(0, 1500) : window.scrollTo(0, 1500)));
        await settle(page);
        const before = await measure(page);
        assert.ok(before.line, 'a line of text is visible');
        assert.ok(before.scrollY > 0 || before.paneScrollTop > 0, 'the article is scrolled');
        await surface.open(page, s);
        await settle(page);
        assert.deepEqual(await measure(page), before, `${surface.name} open`);
        await surface.close(page, s);
        await settle(page);
        assert.deepEqual(await measure(page), before, `${surface.name} closed`);
      }, { split: windowState === 'split' });
    });
  }
}
