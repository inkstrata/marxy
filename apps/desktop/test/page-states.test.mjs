// The page's states, hardened: a failed open is the floor's card and the tab, head
// and the cards' subject name that file; a wide table is cut between columns, fades and counts what is past the edge; a margin note
// measures its room to the Shape strip; a large open says so in the head while it works; a file gone from disk is a
// state that goes when the file comes back; an empty file says so; a block takes its own direction and language.
// Playwright WebKit over the memory shell.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, panelKvs, panelText, rowOf, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const open = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);
/** Waits until the cards' head (Metadata's) says they are about file 
ame. */
const panelNamed = async (page, name) => {
  await showPanel(page, 'metadata');
  await page.waitForFunction((n) => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === n, name);
};

test('a file that could not be opened is the floor card, and the tab, head and cards name it', async () => {
  await withFrame({ files: { '/r/a.md': '# Alpha\n\nA page.\n' }, open: ['/r/a.md'] }, async (page) => {
    await open(page, '/r/gone.md');
    await page.waitForSelector('[data-marxy-failed] .marxy-fcard');
    assert.equal(await page.textContent('.marxy-fcard-kicker'), 'This file could not be opened');
    assert.equal(await page.textContent('.marxy-fcard-name'), 'gone.md');
    const card = await page.innerText('.marxy-fcard');
    assert.match(card, /Nothing is at this path now/);
    assert.match(card, /\/r\/gone\.md/);
    assert.ok(await page.$('.marxy-fcard-acts button:has-text("Copy path")'));
    assert.ok(!/Error:/.test(await page.innerText('section.marxy-pane')), 'no raw error on the page');
    assert.deepEqual(await rowOf(page), ['a.md', 'gone.md*']);
    await panelNamed(page, 'gone.md');
    assert.match(await cardText(page, 'facts'), /could not be opened/);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[0].path()), '/r/gone.md');
    // The file it names opens when asked again and is there.
    await page.evaluate(() => window.__marxyHandle.shell.plant('/r/gone.md', new TextEncoder().encode('# Back\n')));
    await open(page, '/r/gone.md');
    await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent === 'Back');
    assert.equal(await page.$('[data-marxy-failed]'), null);
  });
});

const wideMd = (cols) =>
  `# Wide\n\n| ${Array.from({ length: cols }, (_, i) => `c${i}`).join(' | ')} |\n|${' ---: |'.repeat(cols)}\n` +
  Array.from({ length: 4 }, (_, r) => `| ${Array.from({ length: cols }, (_, i) => String((r + 1) * (i + 1) * 12_347)).join(' | ')} |`).join('\n') +
  '\n\nAfter.\n';

test('a wide table ends between two columns, fades at the side with more, and counts the columns past the edge', async () => {
  await withFrame({ files: { '/r/wide.md': wideMd(16), '/r/narrow.md': wideMd(3) }, open: ['/r/wide.md'], viewport: { width: 760, height: 800 } }, async (page) => {
    await page.waitForSelector('.marxy-article table[data-marxy-cut]');
    const seen = await page.evaluate(() => {
      const table = document.querySelector('.marxy-article table');
      const box = table.getBoundingClientRect();
      const cells = [...table.rows[0].cells].map((c) => c.getBoundingClientRect());
      return {
        cut: cells.filter((c) => c.left < box.right - 0.5 && c.right > box.right + 0.5).length,
        shown: cells.filter((c) => c.right <= box.right + 0.5).length,
        more: table.getAttribute('data-marxy-more'),
        note: table.getAttribute('data-marxy-more-cols'),
        noteShown: getComputedStyle(table, '::after').content,
      };
    });
    assert.equal(seen.cut, 0, 'no cell is cut through');
    assert.equal(seen.more, 'end');
    assert.equal(seen.note, `${16 - seen.shown} more columns →`);
    assert.match(seen.noteShown, /more columns/);
    // Scrolled to its end, the other side fades and the note counts what is before.
    await page.evaluate(() => {
      const t = document.querySelector('.marxy-article table');
      t.scrollLeft = t.scrollWidth;
    });
    await page.waitForFunction(() => document.querySelector('.marxy-article table').getAttribute('data-marxy-more') === 'start');
    assert.match(await page.getAttribute('.marxy-article table', 'data-marxy-more-cols'), /^← \d+ columns before$/);
    // A table that fits is left as it is.
    await open(page, '/r/narrow.md');
    await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent === 'Wide' && document.querySelector('.marxy-article table')?.rows[0].cells.length === 3);
    await page.waitForTimeout(200);
    assert.equal(await page.$('.marxy-article table[data-marxy-cut], .marxy-article table[data-marxy-more-cols]'), null);
  });
});

test("a CSV reading wider than its room says the columns past the edge in its own foot", async () => {
  const head = Array.from({ length: 14 }, (_, i) => `column_${i}`).join(',');
  const rows = Array.from({ length: 5 }, (_, r) => Array.from({ length: 14 }, (_, i) => (r + 1) * (i + 1) * 4_001).join(','));
  await withFrame({ files: { '/r/data.csv': `${head}\n${rows.join('\n')}\n` }, open: ['/r/data.csv'], viewport: { width: 760, height: 800 } }, async (page) => {
    await page.waitForSelector('.marxy-reading-scroll[data-marxy-cut]');
    const note = await page.getAttribute('.marxy-reading-foot', 'data-marxy-more-cols');
    assert.match(note, /^\d+ more columns →$/);
    const cut = await page.evaluate(() => {
      const box = document.querySelector('.marxy-reading-scroll').getBoundingClientRect();
      return [...document.querySelector('.marxy-reading-table').rows[0].cells].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left < box.right - 0.5 && r.right > box.right + 0.5;
      }).length;
    });
    assert.equal(cut, 0, 'no cell is cut through');
  });
});

const notes = ['# Notes', '', `A line that calls a note.[^1] ${'More words to fill the column out. '.repeat(6)}`, '', '[^1]: A note of a few words, set beside its line.', ''].join('\n');

test('a margin note measures its room to the Shape strip, and falls back under its line when a drawer takes it', async () => {
  await withFrame({ files: { '/docs/notes.md': notes }, open: ['/docs/notes.md'], viewport: { width: 1440, height: 900 } }, async (page) => {
    // The drawer docked takes the room a margin note needs: the rail alone is where the note sits in its margin.
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="places"]');
    await page.waitForSelector('.marxy-article > .marxy-note-margin');
    const inside = () =>
      page.evaluate(() => {
        const note = document.querySelector('.marxy-note-margin');
        const strip = document.querySelector('.marxy-mmap:not([hidden])');
        const pane = document.querySelector('section.marxy-pane').getBoundingClientRect();
        return note ? note.getBoundingClientRect().right <= (strip ? strip.getBoundingClientRect().left : pane.right) : null;
      });
    assert.equal(await inside(), true);
    // The old frame's drawer and panel together left the page 764 px; the one docked drawer leaves about that (740) at 1100.
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.click('.marxy-rail .marxy-l-rb[data-marxy-left="places"]');
    await page.waitForFunction(() => document.body.getAttribute('data-marxy-drawer') === 'docked' && !document.querySelector('.marxy-note-margin'), null, { timeout: 5000 });
    await page.click('sup.marxy-footnote-ref a');
    await page.waitForSelector('.marxy-article .marxy-note-here');
  });
});

test('a large open says "Reading N MB…" in the grey of a tier while it works, and not after', async () => {
  const big = Array.from({ length: 4_000 }, (_, i) => `## Part ${i}\n\nParagraph ${i} ${'lorem ipsum dolor sit amet '.repeat(10)}\n`).join('\n');
  await withFrame({ files: { '/r/a.md': '# A\n', '/r/big.md': big } , open: ['/r/a.md'] }, async (page) => {
    const said = page.evaluate(
      () =>
        new Promise((resolve) => {
          const guess = document.querySelector('section.marxy-pane .marxy-guess');
          const seen = new MutationObserver(() => {
            if (!guess.hidden && /^Reading /.test(guess.textContent)) {
              seen.disconnect();
              resolve({ text: guess.textContent, tier: guess.hasAttribute('data-marxy-tier') });
            }
          });
          seen.observe(guess, { attributes: true, childList: true, characterData: true, subtree: true });
        }),
    );
    const opening = open(page, '/r/big.md');
    assert.deepEqual(await said, { text: `Reading ${(big.length / 1024 / 1024).toFixed(1)} MB…`, tier: true });
    await opening;
    assert.equal(await page.evaluate(() => document.querySelector('section.marxy-pane').hasAttribute('data-marxy-working')), false);
    assert.ok(!/^Reading /.test((await page.textContent('section.marxy-pane .marxy-guess')) ?? ''));
  });
});

test('a file gone from disk is said while it is gone, on its tab too, and nothing of it is left when it comes back', async () => {
  await withFrame({ files: { '/r/a.md': '# A\n', '/r/live.md': '# Live\n\nHere.\n' }, open: ['/r/live.md'] }, async (page) => {
    const notices = () => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));
    const mark = () => page.evaluate(() => document.querySelector('.marxy-tab[aria-selected="true"] .marxy-tab-gone')?.textContent ?? null);
    await page.evaluate(() => {
      window.__marxyHandle.shell.remove('/r/live.md');
      window.__marxyHandle.shell.emit([{ kind: 'removed', path: '/r/live.md' }]);
    });
    await page.waitForFunction(() => document.querySelector('.marxy-tab-gone'));
    assert.equal(await mark(), 'not on disk');
    assert.ok((await notices()).some((n) => n.startsWith('The file was removed from disk')));
    await page.evaluate(() => {
      window.__marxyHandle.shell.plant('/r/live.md', new TextEncoder().encode('# Live\n\nBack.\n'));
      window.__marxyHandle.shell.emit([{ kind: 'created', path: '/r/live.md' }]);
    });
    await page.waitForFunction(() => !document.querySelector('.marxy-tab-gone'));
    await page.waitForFunction(() => ![...document.querySelectorAll('.marxy-notice-text')].some((n) => n.textContent.includes('removed from disk')));
    assert.equal(await page.evaluate(() => document.querySelector('section.marxy-pane').hasAttribute('data-marxy-gone')), false);
    // Gone again, then another file opened: the mark is that file's state, not the next one's.
    await page.evaluate(() => {
      window.__marxyHandle.shell.remove('/r/live.md');
      window.__marxyHandle.shell.emit([{ kind: 'removed', path: '/r/live.md' }]);
    });
    await page.waitForFunction(() => document.querySelector('.marxy-tab-gone'));
    await open(page, '/r/a.md');
    await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent === 'A');
    assert.equal(await page.$('.marxy-tab-gone'), null);
  });
});

test('an empty file says so, and its cards say no reading time and no lines', async () => {
  await withFrame({ files: { '/r/a.md': '# A\n', '/r/empty.md': '', '/r/empty.txt': '' }, open: ['/r/a.md'] }, async (page) => {
    for (const path of ['/r/empty.md', '/r/empty.txt']) {
      await open(page, path);
      await panelNamed(page, path.slice(3));
      await page.waitForFunction(() => document.querySelector('section.marxy-pane .marxy-article')?.hasAttribute('data-marxy-empty'));
      const said = await page.evaluate(() => getComputedStyle(document.querySelector('section.marxy-pane .marxy-article'), '::before').content);
      assert.equal(said, '"This file is empty · 0 bytes"');
      // Metadata's The file says it is empty, and counts no lines or words.
      const size = (await panelKvs(page, 'metadata')).Size;
      assert.equal(size, 'Empty: 0 bytes');
      const outline = await panelText(page, 'outline');
      assert.ok(!/min|words/.test(outline), outline);
    }
    await open(page, '/r/a.md');
    await page.waitForFunction(() => document.querySelector('.marxy-article h1')?.textContent === 'A');
    assert.equal(await page.evaluate(() => document.querySelector('section.marxy-pane .marxy-article').hasAttribute('data-marxy-empty')), false);
  });
});

test('each block takes its own direction, a block in another script drops the chrome language, as do outline rows and tab names', async () => {
  const rtl = '# مرحبا بالعالم\n\nهذه فقرة باللغة العربية.\n\n## עברית\n\nזוהי פסקה בעברית.\n\nAn English line after.\n';
  await withFrame({ files: { '/r/a.md': '# A\n', '/r/مرحبا.md': rtl }, open: ['/r/مرحبا.md'] }, async (page) => {
    await page.waitForFunction(() => document.querySelector('.marxy-article h1'));
    const blocks = await page.evaluate(() =>
      [...document.querySelectorAll('.marxy-article > :is(h1, h2, p)')].map((b) => ({ dir: b.getAttribute('dir'), direction: getComputedStyle(b).direction, lang: b.closest('[lang]')?.getAttribute('lang') })),
    );
    assert.deepEqual(blocks, [
      { dir: 'auto', direction: 'rtl', lang: '' },
      { dir: 'auto', direction: 'rtl', lang: '' },
      { dir: 'auto', direction: 'rtl', lang: '' },
      { dir: 'auto', direction: 'rtl', lang: '' },
      { dir: 'auto', direction: 'ltr', lang: 'en' },
    ]);
    assert.equal(await page.getAttribute('.marxy-tab[aria-selected="true"] .marxy-tab-name', 'dir'), 'auto');
    await showPanel(page, 'outline');
    await page.waitForSelector('.marxy-drawer .marxy-l-nm [dir="auto"]');
  });
});
