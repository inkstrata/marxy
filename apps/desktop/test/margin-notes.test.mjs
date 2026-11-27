// Notes in the margin (proposals/notes-in-place.ts): a note set beside its line keeps clear of the code and tables that
// run into the same margin, and a note opened under its line, moved into the margin, leaves its number no longer marked
// open. Playwright WebKit over the memory shell.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const long = `const line = ${JSON.stringify('x'.repeat(260))};`;
const page = [
  '# Notes',
  '',
  'A line that calls a long note.[^1]',
  '',
  '```js',
  long,
  long,
  '```',
  '',
  'A table that runs wide below a second note.[^2]',
  '',
  `| ${'wide column heading '.repeat(8)} | b |`,
  '| --- | --- |',
  `| ${'cell '.repeat(40)} | 2 |`,
  '',
  'A last paragraph, with a third note.[^3]',
  '',
  `[^1]: ${'The first note runs on, long enough to take several lines in the margin at its width. '.repeat(3)}`,
  '[^2]: The second note, short.',
  '[^3]: The third note.',
  '',
].join('\n');

const boxes = (p) =>
  p.evaluate(() => {
    const article = document.querySelector('.marxy-article');
    const col = article.getBoundingClientRect();
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, right: r.right };
    };
    return {
      column: { right: col.right },
      notes: [...article.querySelectorAll(':scope > .marxy-note-margin')].map(rect),
      wide: [...article.querySelectorAll('pre, table')].filter((el) => !el.closest('.marxy-note-margin')).map(rect).filter((r) => r.right > col.right + 0.5),
    };
  });

test('a margin note goes below the code or table that runs into the margin beside it, and the notes keep their order', async () => {
  await withFrame({ files: { '/docs/notes.md': page }, open: ['/docs/notes.md'], viewport: { width: 1700, height: 1000 } }, async (p) => {
    await p.waitForSelector('.marxy-article > .marxy-note-margin');
    await p.waitForFunction(() => document.querySelectorAll('.marxy-article > .marxy-note-margin').length === 3);
    const { notes, wide } = await boxes(p);
    assert.ok(wide.length >= 2, `the code and the table run into the margin here: ${JSON.stringify(wide)}`);
    for (const [i, n] of notes.entries()) {
      for (const w of wide) assert.ok(n.bottom <= w.top || n.top >= w.bottom, `note ${i + 1} ${JSON.stringify(n)} covers a wide block ${JSON.stringify(w)}`);
      if (i > 0) assert.ok(n.top >= notes[i - 1].bottom, `note ${i + 1} is below note ${i}`);
    }
  });
});

test('Metadata’s Footnotes row says where the notes are as a resize moves them in and out of the margin', async () => {
  await withFrame({ files: { '/docs/notes.md': page }, open: ['/docs/notes.md'], viewport: { width: 1700, height: 1000 } }, async (p) => {
    await showPanel(p, 'metadata');
    const said = () => p.evaluate(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:foot"]')?.textContent ?? '');
    await p.waitForSelector('.marxy-article > .marxy-note-margin');
    await p.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:foot"]')?.textContent.includes('in the margin'));
    await p.setViewportSize({ width: 1000, height: 1000 });
    await p.waitForFunction(() => !document.querySelector('.marxy-note-margin'));
    await p.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:foot"]')?.textContent.includes('the margin has no room'), null, { timeout: 5000 }).catch(() => {});
    assert.match(await said(), /the margin has no room/);
  });
});

test('a note opened under its line and then moved into the margin leaves its number no longer marked open', async () => {
  await withFrame({ files: { '/docs/notes.md': page }, open: ['/docs/notes.md'], viewport: { width: 1000, height: 1000 } }, async (p) => {
    await p.waitForFunction(() => document.querySelector('.marxy-article sup.marxy-footnote-ref'));
    await p.click('sup.marxy-footnote-ref a');
    await p.waitForSelector('.marxy-note-here');
    assert.ok(await p.evaluate(() => !!document.querySelector('sup[data-marxy-note-open]')));
    await p.setViewportSize({ width: 1700, height: 1000 });
    await p.waitForSelector('.marxy-article > .marxy-note-margin');
    assert.deepEqual(
      await p.evaluate(() => ({ open: document.querySelectorAll('.marxy-note-here').length, marked: document.querySelectorAll('[data-marxy-note-open]').length })),
      { open: 0, marked: 0 },
    );
  });
});

const body = (n) => `Paragraph ${n} runs on for a line or two so that the page has height to set. `.repeat(6);
const longPage = [
  '# Many notes',
  '',
  ...Array.from({ length: 60 }, (_, i) => `${body(i)}${i % 10 === 4 ? `[^${(i - 4) / 10 + 1}]` : ''}\n`),
  ...Array.from({ length: 6 }, (_, i) => `[^${i + 1}]: Note number ${i + 1}, short.`),
  '',
].join('\n');

const settle = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));

test('the first click on a long page with notes shows the bar and leaves the margin notes where they are', async () => {
  await withFrame({ files: { '/docs/long.md': longPage }, open: ['/docs/long.md'], viewport: { width: 1700, height: 900 } }, async (p) => {
    await p.waitForFunction(() => document.querySelectorAll('.marxy-article > .marxy-note-margin').length === 6);
    await settle(p);
    await p.evaluate(() => {
      const seen = { added: 0, removed: 0 };
      window.__noteChurn = seen;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) if (n.classList?.contains('marxy-note-margin')) seen.added++;
          for (const n of r.removedNodes) if (n.classList?.contains('marxy-note-margin')) seen.removed++;
        }
      }).observe(document.querySelector('.marxy-article'), { childList: true });
    });
    await p.click('.marxy-article > p:nth-of-type(12)');
    await p.waitForSelector('.marxy-verb-bar:not([hidden])');
    await settle(p);
    assert.deepEqual(await p.evaluate(() => window.__noteChurn), { added: 0, removed: 0 });
    assert.equal(await p.locator('.marxy-article > .marxy-note-margin').count(), 6);
  });
});

test('a margin note whose markup changes without a change of text is copied again at the next relayout', async () => {
  await withFrame({ files: { '/docs/long.md': longPage }, open: ['/docs/long.md'], viewport: { width: 1700, height: 900 } }, async (p) => {
    await p.waitForFunction(() => document.querySelectorAll('.marxy-article > .marxy-note-margin').length === 6);
    await settle(p);
    // As a colouring pass does to code in a note: the same characters, wrapped in new elements.
    await p.evaluate(() => {
      const note = document.getElementById(document.querySelector('sup.marxy-footnote-ref a').getAttribute('href').slice(1));
      const text = [...note.querySelectorAll('p')][0].firstChild;
      const word = text.splitText(text.data.indexOf('number')).splitText('number'.length).previousSibling;
      const mark = document.createElement('span');
      mark.className = 'marxy-test-wrapped';
      word.replaceWith(mark);
      mark.append(word);
    });
    await p.setViewportSize({ width: 1680, height: 900 });
    await p.waitForFunction(() => document.querySelector('.marxy-article > .marxy-note-margin .marxy-test-wrapped')?.textContent === 'number', null, { timeout: 5000 });
  });
});

test('margin notes follow their lines when the page above them changes height', async () => {
  await withFrame({ files: { '/docs/long.md': longPage }, open: ['/docs/long.md'], viewport: { width: 1700, height: 900 } }, async (p) => {
    await p.waitForFunction(() => document.querySelectorAll('.marxy-article > .marxy-note-margin').length === 6);
    await settle(p);
    const beside = () =>
      p.evaluate(() => {
        const article = document.querySelector('.marxy-article');
        const notes = [...article.querySelectorAll(':scope > .marxy-note-margin')];
        const links = [...article.querySelectorAll('sup.marxy-footnote-ref a')];
        return notes.map((n, i) => ({ note: n.getBoundingClientRect().top, line: links[i].getBoundingClientRect().top }));
      });
    const before = await beside();
    for (const { note, line } of before) assert.ok(Math.abs(note - line) <= 1, `a note sits beside its line (${note} against ${line})`);
    await p.evaluate(() => {
      document.querySelector('.marxy-article > p:nth-of-type(2)').style.paddingTop = '400px';
    });
    await p.waitForFunction(
      () => {
        const article = document.querySelector('.marxy-article');
        const first = article.querySelector(':scope > .marxy-note-margin').getBoundingClientRect().top;
        return Math.abs(first - article.querySelector('sup.marxy-footnote-ref a').getBoundingClientRect().top) <= 1;
      },
      null,
      { timeout: 5000 },
    );
    const after = await beside();
    assert.ok(after[0].line - before[0].line > 300, 'the line moved down');
    for (const { note, line } of after) assert.ok(Math.abs(note - line) <= 1, `a note still sits beside its line (${note} against ${line})`);
  });
});
