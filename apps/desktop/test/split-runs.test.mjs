// F-79: a run of text with no space in it is cut into pieces by `<wbr>` (render/long-runs.ts) so that WebKit can lay it
// out; the cut must move no byte. A page whose one paragraph is 20,000 letters (four cuts, at 4096, 8192, 12288 and 16384
// characters) is checked against the same page with the cuts taken out and the text nodes joined again (the page as it was
// before F-79), and against the source bytes: what Mod+A and a drag across a cut copy, what a click or a drag selects (the
// bytes of its blocks), what find matches and highlights, and what a transform applied to the paragraph writes. The real app
// over the memory shell, in WebKit, with real keys (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

let seed = 12345;
const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) >>> 8;
/** 20,000 lower-case letters, the same every run, no two neighbouring windows alike. */
const RUN = Array.from({ length: 20_000 }, () => 'abcdefghijklmnopqrstuvwxyz'[next() % 26]).join('');
const HEAD = '# Split runs\n\nBefore.\n\n';
const DOC = `${HEAD}${RUN}\n\nAfter.\n`;
/** The run's first byte in the file: ASCII, so a character offset is a byte offset. */
const RUN_START = HEAD.length;
const A = '/r/split.md';


/** Scrolls the pane so character `offset` of the long paragraph is 300px down, and returns where to click on it. */
function pointAt(offset) {
  const p = document.querySelectorAll('#doc p')[1];
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let left = offset;
  let at;
  for (let n = walker.nextNode(); n && !at; n = walker.nextNode()) {
    if (left < n.data.length) at = [n, left];
    else left -= n.data.length;
  }
  const range = document.createRange();
  range.setStart(...at);
  range.setEnd(at[0], at[1] + 1);
  let scroller = p.parentElement;
  while (scroller && !(['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
  const root = scroller ?? document.scrollingElement;
  root.scrollTop += range.getBoundingClientRect().top - 300;
  const r = range.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

async function withApp(fn, doc = DOC) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootTwoPanes(page, { files: { [A]: doc }, open: [A], guard: true });
    await page.evaluate(async (initialPath) => {
      const { mountPaletteFromHandle } = await import('/src/palette/view.ts');
      const handle = window.__marxyHandle;
      const palette = mountPaletteFromHandle(handle, { initialPath });
      handle.setPaletteSession(() => palette.session);
    }, A);
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    const api = {
      mod,
      /** The long paragraph: how many breaks it holds, and how many text nodes. */
      shape: () => page.evaluate(() => {
        const p = document.querySelectorAll('#doc p')[1];
        return { wbr: p.querySelectorAll('wbr').length, texts: [...p.childNodes].filter((n) => n.nodeType === 3).length, chars: p.textContent.length };
      }),
      /** The page as it was before F-79: no break, one text node. */
      unsplit: () => page.evaluate(() => {
        for (const w of document.querySelectorAll('#doc wbr')) w.remove();
        document.getElementById('doc').normalize();
      }),
      /** Every provenance pair on the page, in document order. */
      provenance: () => page.evaluate(() => [...document.querySelectorAll('#doc [data-marxy-s]')].map((e) => `${e.tagName} ${e.dataset.marxyS}-${e.dataset.marxyE}`)),
      /** A drag over characters `from` to `to` of the long paragraph, as the reader's selection leaves it. */
      drag: async (from, to) => {
        await page.evaluate(({ from, to }) => {
          const p = document.querySelectorAll('#doc p')[1];
          const at = (offset) => {
            const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
            let left = offset;
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if (left <= n.data.length) return [n, left];
              left -= n.data.length;
            }
            throw new Error('past the end');
          };
          const range = document.createRange();
          range.setStart(...at(from));
          range.setEnd(...at(to));
          const sel = document.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
        }, { from, to });
        await page.waitForTimeout(80);
      },
      /** What the app made of the selection: its kind, text, and the bytes of the blocks a drag touches. */
      selection: () => page.evaluate(() => {
        const s = window.__marxyHandle.selection.state().selection;
        return { kind: s.kind, text: s.text ?? null, src: s.src ? { start: s.src.start, end: s.src.end } : (s.node?.src ? { start: s.node.src.start, end: s.node.src.end } : null), dom: document.getSelection().toString() };
      }),
      /** Presses Mod+C and returns the plain text of the pasteboard item the app wrote. */
      copy: async () => {
        await page.evaluate(() => { window.__marxyHandle.shell.calls.length = 0; });
        await page.keyboard.press(`${mod}+KeyC`);
        await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
        return page.evaluate(() => {
          const item = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1).args[0];
          const dec = (t) => { const r = item.find((x) => x.type === t); return r ? new TextDecoder().decode(r.bytes) : null; };
          return { text: dec('public.utf8-plain-text'), html: dec('public.html') };
        });
      },
      store: () => page.evaluate(() => new TextDecoder('utf-8', { ignoreBOM: true }).decode(window.__marxyHandle.document().snapshot().buffer.bytes)),
      select: (css) => page.evaluate((css) => window.__marxyHandle.selection.selectAt(document.querySelector(css), { link: 'select' }), css),
      /** Opens find, types `query`, and reports the count and the highlighted text; closes it. */
      find: async (query) => {
        await page.evaluate(() => document.getSelection().removeAllRanges());
        await page.keyboard.press(`${mod}+KeyF`);
        await page.waitForSelector('.marxy-find input');
        await page.keyboard.type(query);
        await page.waitForFunction((q) => {
          const f = document.querySelector('.marxy-find');
          return f?.querySelector('input')?.value === q && /\d+ of \d+|No match|0/.test(f.querySelector('.marxy-find-count')?.textContent ?? '');
        }, query);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
        const got = await page.evaluate(() => ({
          // "N of M": which match is current depends on where the page was scrolled, so only M is compared.
          total: (document.querySelector('.marxy-find-count')?.textContent ?? '').replace(/^\d+ of /, ''),
          highlighted: [...(CSS.highlights.get('marxy-find') ?? [])].map((r) => r.toString()),
          current: [...(CSS.highlights.get('marxy-find-current') ?? [])].map((r) => r.toString()),
        }));
        await page.keyboard.press('Escape');
        return got;
      },
      sheet: () => page.evaluate(() => {
        const d = document.getElementById('marxy-transform');
        if (!d?.open) return null;
        const [before, after] = [...d.querySelectorAll('.marxy-transform-text')].map((p) => p.textContent);
        return { before, after };
      }),
      choose: async (name) => {
        await page.keyboard.press(`${mod}+Slash`);
        await page.waitForSelector('#marxy-palette[open] .marxy-palette-row');
        await page.locator('#marxy-palette .marxy-palette-query').fill(`>Transform: ${name}`);
        const row = page.locator('#marxy-palette .marxy-palette-title').filter({ hasText: new RegExp(`^Transform: ${name}$`) });
        await row.waitFor();
        await row.click();
        await page.waitForSelector('#marxy-transform[open]');
      },
    };
    await fn(page, api);
  } finally {
    await browser.close();
  }
}

test('the run is cut into five pieces by four breaks, the page text is the file\'s, and no break is a character', async () => {
  await withApp(async (page, s) => {
    assert.deepEqual(await s.shape(), { wbr: 4, texts: 5, chars: RUN.length });
    const text = await page.evaluate(() => document.querySelectorAll('#doc p')[1].textContent);
    assert.equal(text, RUN, 'textContent is the source text');
    // The pieces are all there is of the cut: no other element, no attribute, in the paragraph.
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc p')[1].children.length), 4);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc p')[1].querySelectorAll(':not(wbr)').length), 0);
    // Past the typesetter's cap the engine wraps the paragraph itself.
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc p.marxy-set').length), 0);
  });
});

test('every provenance pair is what the page has without the breaks, and each is on a block, never on a break', async () => {
  await withApp(async (page, s) => {
    const split = await s.provenance();
    assert.deepEqual(split, ['H1 0-12', 'P 14-21', `P ${RUN_START}-${RUN_START + RUN.length}`, `P ${RUN_START + RUN.length + 2}-${RUN_START + RUN.length + 8}`]);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#doc wbr[data-marxy-s]').length), 0);
    await s.unsplit();
    assert.deepEqual(await s.provenance(), split, 'the same pairs, in the same order, as the page before F-79');
  });
});

test('Mod+A then Mod+C copies the page\'s text, and a drag across a break copies exactly the source slice', async () => {
  await withApp(async (page, s) => {
    // Mod+A.
    await page.keyboard.press(`${s.mod}+KeyA`);
    const all = await s.copy();
    assert.ok(all.text.includes(RUN), 'the whole run, every character of it, in one piece');
    assert.ok(!/[​⁠﻿­]/.test(all.text), 'no zero-width character was put in');
    assert.ok(!(all.html ?? '').includes('<wbr'), 'the rich flavour carries no break either');
    // Drags across one break and across three.
    const drags = [[4000, 4200], [4096 - 1, 4096 + 1], [4090, 12_300], [0, RUN.length], [16_384, 16_400]];
    const copies = [];
    for (const [from, to] of drags) {
      await s.drag(from, to);
      const copied = await s.copy();
      assert.equal(copied.text, RUN.slice(from, to), `the drag ${from}-${to}`);
      assert.equal(copied.text, DOC.slice(RUN_START + from, RUN_START + to), `and it is the file's bytes ${from}-${to}`);
      copies.push(copied.text);
    }
    // And the page before F-79 copies the same.
    await s.unsplit();
    assert.equal((await s.shape()).wbr, 0);
    await page.keyboard.press(`${s.mod}+KeyA`);
    assert.equal((await s.copy()).text, all.text, 'Mod+A copies what it did');
    for (const [i, [from, to]] of drags.entries()) {
      await s.drag(from, to);
      assert.equal((await s.copy()).text, copies[i], `the unsplit page, drag ${from}-${to}`);
    }
  });
});

test('a drag across a break selects the same bytes as on the page without breaks, and a click inside a later piece selects the whole block', async () => {
  await withApp(async (page, s) => {
    const cases = [[4000, 4200], [8000, 8300], [4090, 12_300], [100, 19_900]];
    const split = [];
    for (const [from, to] of cases) {
      await s.drag(from, to);
      split.push(await s.selection());
    }
    for (const sel of split) {
      assert.equal(sel.kind, 'text');
      assert.deepEqual(sel.src, { start: RUN_START, end: RUN_START + RUN.length }, 'the bytes of the one block the drag touches');
    }
    assert.deepEqual(split.map((x) => x.text), cases.map(([a, b]) => RUN.slice(a, b)));
    // A click in the third piece (a real pointer, at the pixel where character 9000 is drawn).
    await page.evaluate(() => document.getSelection().removeAllRanges());
    const point = await page.evaluate(pointAt, 9000);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(100);
    const clicked = await s.selection();
    assert.equal(clicked.kind, 'node');
    assert.deepEqual(clicked.src, { start: RUN_START, end: RUN_START + RUN.length });
    // The page before F-79 resolves every one of them to the same thing.
    await s.unsplit();
    for (const [i, [from, to]] of cases.entries()) {
      await s.drag(from, to);
      assert.deepEqual(await s.selection(), split[i], `the unsplit page, drag ${from}-${to}`);
    }
    await page.evaluate(() => document.getSelection().removeAllRanges());
    const again = await page.evaluate(pointAt, 9000);
    await page.mouse.click(again.x, again.y);
    await page.waitForTimeout(100);
    const clickedUnsplit = await s.selection();
    assert.equal(clickedUnsplit.kind, clicked.kind);
    assert.deepEqual(clickedUnsplit.src, clicked.src);
  });
});

test('find counts and highlights a query across a break as it does on the page without breaks', async () => {
  await withApp(async (page, s) => {
    // Straddles the break at 4096, and is there once; "qz" is there many times.
    const across = RUN.slice(4086, 4106);
    const lower = `Split runsBefore.${RUN}After.`.toLowerCase();
    const countOf = (q) => lower.split(q).length - 1;
    const queries = [across, 'qz', 'zz', RUN.slice(8185, 8200)];
    const split = [];
    for (const q of queries) split.push(await s.find(q));
    for (const [i, q] of queries.entries()) {
      const n = countOf(q);
      assert.ok(n >= 1, `${q} is in the text`);
      assert.equal(split[i].total, String(n), `the count for ${q}`);
      assert.equal(split[i].highlighted.length, n, `every match of ${q} is highlighted`);
      assert.ok(split[i].highlighted.every((t) => t === q), `each highlight is exactly ${q}, whole, across the break`);
      assert.deepEqual(split[i].current, [q]);
    }
    await s.unsplit();
    for (const [i, q] of queries.entries()) assert.deepEqual(await s.find(q), split[i], `the unsplit page, ${q}`);
  });
});

test('a transform applied to a paragraph with four breaks in it rewrites exactly its bytes, and undo restores them', async () => {
  await withApp(async (page, s) => {
    const sel = (css) => s.select(css);
    await sel('#doc p:nth-of-type(2)');
    const state = await s.selection();
    assert.equal(state.kind, 'node');
    assert.deepEqual(state.src, { start: RUN_START, end: RUN_START + RUN.length });
    await s.choose('UPPERCASE');
    const sheet = await s.sheet();
    assert.equal(sheet.before, RUN, 'Before is the paragraph\'s bytes, whole');
    assert.equal(sheet.after, RUN.toUpperCase());
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    const after = await s.store();
    assert.equal(after, DOC.slice(0, RUN_START) + RUN.toUpperCase() + DOC.slice(RUN_START + RUN.length), 'only the paragraph\'s bytes changed');
    // The page, set again from the new bytes, has its breaks again and its text is the new text.
    await page.waitForFunction((up) => document.querySelectorAll('#doc p')[1]?.textContent === up, RUN.toUpperCase());
    assert.equal((await s.shape()).wbr, 4);
    // And undo restores every byte.
    await page.keyboard.press(`${s.mod}+KeyZ`);
    await page.waitForFunction((run) => document.querySelectorAll('#doc p')[1]?.textContent === run, RUN);
    assert.equal(await s.store(), DOC);
  });
});

test('the same transform on the page without breaks gives the same sheet and the same bytes', async () => {
  await withApp(async (page, s) => {
    await s.unsplit();
    await s.select('#doc p:nth-of-type(2)');
    await s.choose('UPPERCASE');
    const sheet = await s.sheet();
    assert.equal(sheet.before, RUN);
    assert.equal(sheet.after, RUN.toUpperCase());
    await page.keyboard.press(`${s.mod}+Enter`);
    await page.waitForFunction(() => !document.getElementById('marxy-transform').open);
    assert.equal(await s.store(), DOC.slice(0, RUN_START) + RUN.toUpperCase() + DOC.slice(RUN_START + RUN.length));
  });
});

test('prose with spaces is not cut: a long paragraph of words gets no break, a token over the limit does, wherever it sits', async () => {
  const words = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(' ');
  const token = 'q'.repeat(9000);
  const doc = `# Mixed\n\n${words}\n\nhead ${token} tail\n\n- item ${token}\n`;
  await withApp(async (page) => {
    const got = await page.evaluate(() => ({
      prose: document.querySelectorAll('#doc p')[0].querySelectorAll('wbr').length,
      inline: document.querySelectorAll('#doc p')[1].querySelectorAll('wbr').length,
      item: document.querySelectorAll('#doc li')[0].querySelectorAll('wbr').length,
      proseText: document.querySelectorAll('#doc p')[0].textContent,
      inlineText: document.querySelectorAll('#doc p')[1].textContent,
    }));
    assert.equal(got.prose, 0);
    assert.equal(got.proseText.replaceAll('\u00a0', ' '), words, 'the words, whole (the engine may bind the last space)');
    assert.equal(got.inline, 2, '9000 characters are cut at 4096 and 8192');
    assert.equal(got.inlineText, `head ${token} tail`);
    assert.equal(got.item, 2);
  }, doc);
});

test('guardLongRuns: a cut never lands inside a surrogate pair or a cluster, math is left alone, and a second pass adds nothing', async () => {
  await withApp(async (page) => {
    const got = await page.evaluate(async () => {
      const { guardLongRuns, RUN_CHARS } = await import('/src/render/long-runs.ts');
      const holder = document.createElement('div');
      // A pair that straddles the first cut, a mark that would start a piece, a run in `code` and `pre`, and a short run.
      const pair = `${'a'.repeat(RUN_CHARS - 1)}\u{1F600}${'b'.repeat(RUN_CHARS + 10)}`;
      const marks = `${'c'.repeat(RUN_CHARS)}\u0301\u0301${'d'.repeat(RUN_CHARS + 10)}`;
      const add = (tag, id, parent = holder) => {
        const el = document.createElement(tag);
        if (id) el.id = id;
        parent.append(el);
        return el;
      };
      add('p', 'pair').append(pair);
      add('p', 'marks').append(marks);
      add('code', '', add('p', 'code')).append('f'.repeat(3 * RUN_CHARS));
      add('pre', 'pre').append('g'.repeat(3 * RUN_CHARS));
      add('p', 'short').append('e'.repeat(RUN_CHARS));
      add('span', '', add('p', 'math')).className = 'marxy-math-inline';
      holder.querySelector('.marxy-math-inline').append('m'.repeat(3 * RUN_CHARS));
      const spaces = add('p', 'spaces');
      const prose = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ');
      spaces.append(prose);
      const before = holder.textContent;
      const breaks = guardLongRuns(holder);
      const again = guardLongRuns(holder);
      const pieces = (id) => [...holder.querySelector(id).childNodes].filter((n) => n.nodeType === 3).map((n) => n.data);
      return {
        breaks, again, same: holder.textContent === before,
        pair: pieces('#pair').map((t) => ({ length: t.length, last: t.codePointAt(t.length - 2), first: t.codePointAt(0) })),
        marks: pieces('#marks').map((t) => ({ length: t.length, first: t.codePointAt(0) })),
        code: holder.querySelectorAll('p code wbr').length,
        pre: holder.querySelectorAll('pre wbr').length,
        math: holder.querySelectorAll('#math wbr').length,
        short: holder.querySelectorAll('#short wbr').length,
        spaces: holder.querySelectorAll('#spaces wbr').length,
        RUN_CHARS,
      };
    });
    assert.equal(got.same, true, 'the text is the text');
    assert.equal(got.again, 0, 'a second pass finds nothing to cut');
    assert.equal(got.code, 2, 'inline code is cut, 3 x the interval at two places');
    assert.equal(got.pre, 2, 'and so is a code block');
    assert.equal(got.math, 0, 'math is not touched');
    assert.equal(got.short, 0, 'a run of exactly the limit is not cut');
    assert.equal(got.spaces, 0, 'prose is not cut, however long the paragraph');
    // Pair: the cut falls after the whole emoji (4096 + 1), so the first piece ends with it and the second starts with a letter.
    assert.equal(got.pair[0].last, 0x1f600);
    assert.equal(got.pair[1].first, 'b'.codePointAt(0));
    // Marks: the two combining marks stay with the letter they follow.
    assert.equal(got.marks[0].length, got.RUN_CHARS + 2);
    assert.equal(got.marks[1].first, 'd'.codePointAt(0));
  });
});

test('guardLongRuns: two adjacent text nodes, as the HTML parser makes of a long run, are each cut and the run in between is bounded', async () => {
  await withApp(async (page) => {
    const got = await page.evaluate(async () => {
      const { guardLongRuns, RUN_CHARS } = await import('/src/render/long-runs.ts');
      const p = document.createElement('p');
      p.append('x'.repeat(65_536), 'y'.repeat(65_536));
      const before = p.textContent;
      guardLongRuns(p);
      const longest = [...p.childNodes].filter((n) => n.nodeType === 3).reduce((m, n) => Math.max(m, n.data.length), 0);
      // The longest stretch with no break in it: a text node, or two with nothing between them (the seam of the original nodes).
      let run = 0;
      let worst = 0;
      for (const n of p.childNodes) {
        if (n.nodeType === 3) run += n.data.length;
        else run = 0;
        worst = Math.max(worst, run);
      }
      return { same: p.textContent === before, longest, worst, RUN_CHARS };
    });
    assert.equal(got.same, true);
    assert.ok(got.longest <= got.RUN_CHARS + 2, `no piece is longer than a break interval: ${got.longest}`);
    assert.ok(got.worst <= 2 * got.RUN_CHARS, `and no unbroken stretch is longer than two: ${got.worst}`);
  });
});
