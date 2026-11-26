// The look on the page in WebKit: with no look.toml the theme paints the page as it always has;
// once look.toml says a look, the window and each pane are painted from the look engine, a pane by its own context (a
// file in reading/ in Book, code fixed width), and `a`, `+`, `N` and `B` act on it and are written back.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { fileText, skip, withFrame } from './support/frame.mjs';
import { LOOKS } from '../../../packages/theme/src/looks.ts';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PLAN = ['# Plan', '', 'The first paragraph of the plan, long enough to wrap at least once in a column of the measure the look sets.', '', 'A second paragraph.', '', '```rust', 'fn main() { let x = 1; }', '```', '', '```sql', 'select 1 from tides;', '```', ''].join('\n');
const ESSAY = ['# On margins', '', 'A paragraph of an essay in the reading folder.', '', 'And another one after it.', ''].join('\n');
const FILES = { '/r/plans/plan.md': PLAN, '/r/reading/on-margins.md': ESSAY };
const ON = (look, extra = '') => `on = true\nlook = "${look}"\nmode = "day"\nlean = false\n${extra}`;

/** The look as the page wears it: the focused pane's attributes and painted tokens, and the root's. */
const worn = (page, slot = 0) =>
  page.evaluate((slot) => {
    const host = document.querySelector(`[data-marxy-pane="${slot}"]`);
    const root = document.documentElement;
    return {
      look: host.getAttribute('data-marxy-look'),
      scheme: host.getAttribute('data-marxy-scheme'),
      root: root.getAttribute('data-marxy-look'),
      variant: root.getAttribute('data-marxy-variant'),
      face: host.style.getPropertyValue('--marxy-font-text'),
      size: host.style.getPropertyValue('--marxy-size-body'),
      bg: root.style.getPropertyValue('--marxy-color-bg'),
    };
  }, slot);
const lookIs = (page, id) => page.waitForFunction((id) => document.querySelector('[data-marxy-pane="0"]').getAttribute('data-marxy-look') === id, id);
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());

test('no look.toml: the theme paints the page as it always has, and nothing is painted on the panes', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page) => {
    await page.waitForTimeout(400);
    const w = await worn(page);
    assert.equal(w.look, null);
    assert.equal(w.root, null);
    assert.equal(w.bg, '');
  });
});

test('36a: a look in look.toml paints the window and the pane; Book is Palatino; night turns the pane and the window; lean raises the size', async () => {
  await withFrame({ files: { ...FILES, '/look.toml': ON('book') }, open: ['/r/plans/plan.md'] }, async (page) => {
    await lookIs(page, 'book');
    const a = await worn(page);
    assert.match(a.face, /Palatino/);
    assert.equal(a.root, 'book');
    assert.equal(a.scheme, 'day');
    assert.equal(a.variant, 'light');
    await blur(page);
    await page.keyboard.press('Shift+N');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"]').getAttribute('data-marxy-scheme') === 'night');
    const b = await worn(page);
    assert.equal(b.variant, 'dark', 'the window turns too');
    assert.notEqual(b.bg, a.bg);
    const before = parseFloat(b.size);
    await page.keyboard.press('Shift+B');
    await page.waitForFunction((s) => parseFloat(document.querySelector('[data-marxy-pane="0"]').style.getPropertyValue('--marxy-size-body')) > s, before);
    await page.evaluate(async () => (await import('/src/look/store.ts')).flushLooks());
    const file = await fileText(page, '/look.toml');
    assert.match(file, /mode = "night"/);
    assert.match(file, /lean = true/);
  });
});

test('36b: the sample rule: a file in reading/ is in Book; the plan keeps the look in use', async () => {
  await withFrame({ files: { ...FILES, '/look.toml': ON('paper') }, open: ['/r/reading/on-margins.md', '/r/plans/plan.md'] }, async (page) => {
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="1"]')?.getAttribute('data-marxy-look') === 'paper');
    assert.equal((await worn(page, 0)).look, 'book');
    assert.equal((await worn(page, 1)).look, 'paper');
    assert.equal((await worn(page, 0)).root, 'paper', 'the window keeps the look in use');
  });
});

test('37: text holds 7 : 1 on the page in every look, by day and night, as the page computes it', async () => {
  await withFrame({ files: { ...FILES, '/look.toml': ON('paper') }, open: ['/r/plans/plan.md'] }, async (page) => {
    await lookIs(page, 'paper');
    const rows = [];
    for (const id of ['paper', 'plain', 'book', 'slate', 'vellum', 'draft', 'console', 'large']) {
      for (const mode of ['day', 'night']) {
        await page.evaluate(
          async ({ id, mode }) => {
            const s = await import('/src/look/store.ts');
            s.setLookState({ ...s.lookState(), id, mode });
          },
          { id, mode },
        );
        await page.waitForFunction(({ id, mode }) => {
          const h = document.querySelector('[data-marxy-pane="0"]');
          return h.getAttribute('data-marxy-look') === id && h.getAttribute('data-marxy-scheme') === (mode === 'day' ? 'day' : 'night');
        }, { id, mode });
        rows.push(
          await page.evaluate(({ id, mode }) => {
            const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
            const lum = ([r, g, b]) => [r, g, b].map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
            const host = document.querySelector('[data-marxy-pane="0"]');
            const p = host.querySelector('.marxy-article p');
            const fg = lum(rgb(getComputedStyle(p).color));
            const bg = lum(rgb(getComputedStyle(host).backgroundColor));
            return { id, mode, ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
          }, { id, mode }),
        );
      }
    }
    const low = rows.filter((r) => r.ratio < 7);
    assert.deepEqual(low, [], JSON.stringify(rows));
  });
});

test('on one page each fenced part wears its own language, and it is the pane\'s palette colour', async () => {
  await withFrame({ files: { ...FILES, '/look.toml': ON('paper') }, open: ['/r/plans/plan.md'] }, async (page) => {
    await lookIs(page, 'paper');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="0"] [data-marxy-lang="rust"] .marxy-tok-keyword') && document.querySelector('[data-marxy-pane="0"] [data-marxy-lang="sql"] .marxy-tok-keyword'));
    const s = await page.evaluate(() => {
      const host = document.querySelector('[data-marxy-pane="0"]');
      const probe = (v) => {
        const i = document.createElement('i');
        i.style.color = v;
        host.append(i);
        const c = getComputedStyle(i).color;
        i.remove();
        return c;
      };
      const c = (lang) => getComputedStyle(host.querySelector(`[data-marxy-lang="${lang}"] .marxy-tok-keyword`)).color;
      return { rust: c('rust'), sql: c('sql'), wantRust: probe('var(--marxy-pl-rust-keyword)'), wantSql: probe('var(--marxy-pl-sql-keyword)'), shared: probe('var(--marxy-tok-keyword)') };
    });
    assert.equal(s.rust, s.wantRust);
    assert.equal(s.sql, s.wantSql);
    assert.notEqual(s.rust, s.sql);
    assert.notEqual(s.sql, s.shared);
  });
});

test('a opens the look at hand; a look chosen there paints the page; + makes the text larger and is written; Use the theme gives the page back', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page) => {
    await page.waitForTimeout(300);
    await blur(page);
    await page.keyboard.press('a');
    await page.waitForSelector('dialog.marxy-look-pop[open]');
    assert.equal(await page.locator('.marxy-look-pop-look').count(), LOOKS.length, 'every look, the bundled themes among them');
    assert.equal(await page.locator('.marxy-look-pop-look[aria-pressed="true"]').textContent(), 'AgInk', 'Ink, the theme in force, is the one in use');
    await page.locator('.marxy-look-pop-look', { hasText: 'Slate' }).click();
    await lookIs(page, 'slate');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.marxy-look-pop'));
    await blur(page);
    const before = parseFloat((await worn(page)).size);
    await page.keyboard.press('+');
    await page.waitForFunction((s) => parseFloat(document.querySelector('[data-marxy-pane="0"]').style.getPropertyValue('--marxy-size-body')) > s, before);
    await page.evaluate(async () => (await import('/src/look/store.ts')).flushLooks());
    const file = await fileText(page, '/look.toml');
    assert.match(file, /look = "slate"/);
    assert.match(file, /\[tweaks\.slate\.type\]\s+size = 19/);
    await page.evaluate(async () => (await import('/src/look/store.ts')).turnLooksOff());
    await page.waitForFunction(() => !document.querySelector('[data-marxy-pane="0"]').hasAttribute('data-marxy-look'));
    assert.equal((await worn(page)).bg, '');
  });
});

test('looks off gives config.toml back as it is now: its size and measure, and the variant a write made while a look was on; that write never sticks over the look', async () => {
  const look = 'on = true\nlook = "slate"\nmode = "night"\nlean = false\n';
  await withFrame({ files: { ...FILES, '/look.toml': look }, config: 'size = 24\nmeasure = 70\n', open: ['/r/plans/plan.md'] }, async (page) => {
    await lookIs(page, 'slate');
    const rootTok = (k) => page.evaluate((k) => document.documentElement.style.getPropertyValue(k), k);
    const lookSize = await rootTok('--marxy-size-body');
    assert.notEqual(lookSize, '24px');
    await page.evaluate(async () => (await import('/src/theme/live-config.ts')).writeAndApply(window.__marxyHandle, 'size', '26'));
    await page.waitForFunction((s) => document.documentElement.style.getPropertyValue('--marxy-size-body') === s, lookSize, { timeout: 2000 });
    await page.evaluate(async () => (await import('/src/theme/live-config.ts')).writeAndApply(window.__marxyHandle, 'variant', '"light"'));
    await page.waitForFunction(() => document.documentElement.getAttribute('data-marxy-variant') === 'dark', null, { timeout: 2000 });
    await page.evaluate(async () => (await import('/src/look/store.ts')).turnLooksOff());
    await page.waitForFunction(() => !document.querySelector('[data-marxy-pane="0"]').hasAttribute('data-marxy-look'));
    await page.waitForTimeout(100);
    assert.equal(await rootTok('--marxy-size-body'), '26px');
    assert.equal(await rootTok('--marxy-measure-chars'), '70');
    assert.equal((await worn(page)).variant, 'light', 'the variant config.toml says now, not the one worn when the look came on');
  });
});

test('+ changes the look the pane wears: a file in reading/ is in Book by the sample rule, and + makes Book larger', async () => {
  await withFrame({ files: { ...FILES, '/look.toml': ON('paper') }, open: ['/r/reading/on-margins.md'] }, async (page) => {
    await lookIs(page, 'book');
    await blur(page);
    await page.keyboard.press('+');
    await page.evaluate(async () => (await import('/src/look/store.ts')).flushLooks());
    const s = await page.evaluate(async () => (await import('/src/look/store.ts')).lookState());
    assert.deepEqual(s.tweaks, { book: { size: 22 } });
  });
});

test('a look chosen a moment before the window closes is written before it goes', async () => {
  await withFrame({ files: { ...FILES, '/look.toml': ON('paper') }, open: ['/r/plans/plan.md'] }, async (page) => {
    await lookIs(page, 'paper');
    await page.evaluate(async () => {
      const s = await import('/src/look/store.ts');
      s.setLookState({ ...s.lookState(), id: 'slate' });
      window.__marxyHandle.shell.emitCloseRequested();
    });
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'confirmClose'));
    assert.match(await fileText(page, '/look.toml'), /look = "slate"/);
  });
});

test('a look.toml that is not TOML is said, and never written over by the defaults', async () => {
  const broken = 'on = true\nlook = "slate\n';
  await withFrame({ files: { ...FILES, '/look.toml': broken }, open: ['/r/plans/plan.md'] }, async (page) => {
    await page.waitForFunction(() => /look\.toml could not be read/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    await page.evaluate(async () => {
      const s = await import('/src/look/store.ts');
      s.setLookState({ ...s.lookState(), id: 'book' });
      await s.flushLooks();
    });
    assert.equal(await fileText(page, '/look.toml'), broken);
  });
});

test('the look at hand says why the pane looks as it does for the look just chosen there, not the one before', async () => {
  await withFrame({ files: { ...FILES, '/look.toml': ON('paper') }, open: ['/r/plans/plan.md'] }, async (page) => {
    await lookIs(page, 'paper');
    await blur(page);
    await page.keyboard.press('a');
    await page.waitForSelector('dialog.marxy-look-pop[open]');
    await page.locator('.marxy-look-pop-look', { hasText: 'Slate' }).click();
    await lookIs(page, 'slate');
    await page.waitForTimeout(150);
    assert.match(await page.locator('.marxy-look-pop-why li').first().innerText(), /^Slate/);
  });
});

test('Book\'s headings are italic in the page only, not in the window\'s own; a pane a rule puts in Paper is not justified under a Book window', async () => {
  const rule = '[[rule]]\nid = "plans"\nlabel = "Plans use Paper"\non = true\n[rule.when]\npath = "plans/"\n[rule.set]\nlook = "paper"\n';
  await withFrame({ files: { ...FILES, '/look.toml': ON('book', rule) }, open: ['/r/reading/on-margins.md', '/r/plans/plan.md'] }, async (page) => {
    await lookIs(page, 'book');
    await page.waitForFunction(() => document.querySelector('[data-marxy-pane="1"]')?.getAttribute('data-marxy-look') === 'paper');
    const s = await page.evaluate(() => {
      const chrome = document.createElement('h2');
      chrome.textContent = 'Chrome';
      document.body.append(chrome);
      const out = {
        page: getComputedStyle(document.querySelector('[data-marxy-pane="0"] .marxy-article h1')).fontStyle,
        chrome: getComputedStyle(chrome).fontStyle,
        root: document.documentElement.getAttribute('data-marxy-look-align'),
        paper: getComputedStyle(document.querySelector('[data-marxy-pane="1"] .marxy-article p')).textAlign,
      };
      chrome.remove();
      return out;
    });
    assert.equal(s.page, 'italic');
    assert.equal(s.chrome, 'normal');
    assert.equal(s.root, null, 'the window carries no justification for the panes under it');
    assert.notEqual(s.paper, 'justify');
  });
});
