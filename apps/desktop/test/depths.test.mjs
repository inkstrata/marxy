// The depths in WebKit: x-ray (x) shows a part's stored lines in its place, invisibles drawn;
// Reveal (Shift+X) puts the markup back around the reading; z and Z fold sections; v shows one part alone, Escape brings
// the rest back. It also covers
// what the app's own page asks: an x-ray kept across an edit and dropped with its part, a copy in Reveal, find and a
// link opening a fold, the cursor passing over a fold, the verb bar's new verbs.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const DOC = [
  '# Plan', '', 'The first paragraph of the plan.', '',
  '- one', '- two', '', 'See [the scope](#deep) and *this* and `code`.', '',
  '## Vendor', '', 'Paid to the vendor,', 'a zero​width here,\t', 'and a trailing space ', '',
  '## Scope', '', 'What is in scope.', '', '- [ ] a task to do', '', '```ts', 'const needle = 1;', '```', '',
  '## Later', '', 'Later text.', '', '### Deep', '', 'More later.', '',
].join('\n');
const FILES = { '/r/plan.md': DOC, '/r/inline.md': '# Top\n\n## Sub\n\nSee *this* here.\n', '/r/crlf.md': '# Title\r\n\r\nOne line\r\nand two\r\n\r\nLast, no newline' };

const A = '[data-marxy-pane="0"] .marxy-article';
const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const cur = (page) =>
  page.evaluate(() => {
    const s = window.__marxyHandle.selection.state().selection;
    const bar = document.querySelector('.marxy-verb-bar');
    const shown = bar && !bar.hidden;
    return {
      kind: s.kind,
      where: shown ? bar.querySelector('.marxy-verb-bar-where').textContent : null,
      verbs: shown ? [...bar.querySelectorAll('[data-marxy-verb]')].map((b) => b.textContent.trim()) : [],
    };
  });
/** Puts the cursor on the top-level part whose text starts with `text`, by j from the first part. */
const goTo = async (page, text) => {
  await blur(page);
  await keys(page, 'g', 'g');
  for (let i = 0; i < 30; i++) {
    const at = await page.evaluate((A) => document.querySelector(`${A} .marxy-cursor`)?.textContent.trim() ?? '', A);
    if (at.startsWith(text)) return;
    await keys(page, 'j');
  }
  throw new Error(`no part starts with ${text}`);
};
const xray = (page) =>
  page.evaluate((A) => [...document.querySelectorAll(`${A} .marxy-xray`)].map((box) => ({
    lines: [...box.querySelectorAll('.marxy-xray-line')].map((l) => Number(l.getAttribute('data-marxy-line'))),
    texts: [...box.querySelectorAll('.marxy-xray-text')].map((t) => t.textContent),
    ends: [...box.querySelectorAll('.marxy-xray-text')].map((t) => t.getAttribute('data-marxy-eol')),
    nb: box.querySelectorAll('.marxy-invisible').length,
    tabs: box.querySelectorAll('.marxy-xray-tab').length,
    spaces: box.querySelectorAll('.marxy-xray-space').length,
    current: box.classList.contains('marxy-xray-current'),
    hidden: [...document.querySelectorAll(`${A} .marxy-xrayed`)].map((e) => e.textContent.trim().slice(0, 20)),
    nextHidden: box.nextElementSibling?.classList.contains('marxy-xrayed') ?? false,
  })), A);

/** What Mod+C puts on the pasteboard for a drag over the element `pick(A)` returns, as the memory shell recorded it. */
const copyOf = async (page, mod, pick) => {
  const before = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length);
  await page.evaluate(({ A, pick }) => {
    const el = new Function('A', `return (${pick})(A)`)(A);
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }, { A, pick: pick.toString() });
  await page.waitForTimeout(50);
  await page.keyboard.press(`${mod}+c`);
  await page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length > n, before);
  return page.evaluate(() => {
    const last = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    const rep = last.args[0].find((r) => r.type === 'public.utf8-plain-text');
    return new TextDecoder().decode(rep.bytes);
  });
};
test('11a x inserts one x-ray with one line per source line in place of the part; x again removes it', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await goTo(page, 'Paid to');
    await keys(page, 'x');
    const [box, ...more] = await xray(page);
    assert.equal(more.length, 0, 'one x-ray');
    assert.deepEqual(box.lines, [12, 13, 14], 'the paragraph\'s three lines, numbered from the file');
    assert.equal(box.nextHidden, true, 'the box sits directly before the part, which is out of the page while it shows');
    assert.equal(box.current, true, 'the box is under the cursor');
    assert.equal((await cur(page)).where, 'plan.md:12–14', 'the cursor stays on the part');
    await keys(page, 'x');
    assert.deepEqual(await xray(page), [], 'x again: gone');
    assert.equal(await page.evaluate((A) => document.querySelectorAll(`${A} .marxy-xrayed`).length, A), 0);
  });
});

test('11b x-ray of the vendor paragraph shows the no-break and zero-width characters, the tab and the trailing space', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page, { mod }) => {
    await goTo(page, 'Paid to');
    await keys(page, 'x');
    const [box] = await xray(page);
    assert.ok(box.nb >= 2, `invisible markers for U+00A0 and U+200B (${box.nb})`);
    assert.equal(box.tabs, 1, 'the tab');
    assert.equal(box.spaces, 1, 'the trailing space');
    assert.deepEqual(box.ends, [null, null, null], 'LF only: no ending drawn');
    const copied = await copyOf(page, mod, (A) => document.querySelectorAll(`${A} .marxy-xray .marxy-xray-text`)[1]);
    assert.equal(copied, 'a zero​width here,\t', 'the box\'s text is the stored bytes, nothing drawn over them');
  });
});

test('x-ray draws CRLF endings and a missing final newline', async () => {
  await withFrame({ files: FILES, open: ['/r/crlf.md'] }, async (page) => {
    await goTo(page, 'One line');
    await keys(page, 'x');
    assert.deepEqual((await xray(page))[0].ends, ['␍¬', '␍¬']);
    await keys(page, 'x', 'Shift+G', 'x');
    assert.deepEqual((await xray(page))[0].ends, ['∅']);
  });
});

test('an x-ray survives a re-render, follows an edit above it, and goes with a part an edit removed', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await goTo(page, 'What is in scope');
    await keys(page, 'x');
    const edit = (find, replacement) =>
      page.evaluate(async ({ find, replacement }) => {
        const store = window.__marxyHandle.document();
        const text = new TextDecoder().decode(store.snapshot().buffer.bytes);
        const start = new TextEncoder().encode(text.slice(0, text.indexOf(find))).length;
        await store.apply({ range: { file: store.snapshot().path, start, end: start + new TextEncoder().encode(find).length }, replacement, label: 'test' });
      }, { find, replacement });
    await edit('The first paragraph of the plan.', 'The first paragraph of the plan, now longer\nand over two lines.');
    await page.waitForTimeout(1000);
    console.log(await page.evaluate((A) => [document.querySelector(`${A} p`)?.outerHTML, new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).slice(0, 120)], A));
    await page.waitForFunction((A) => document.querySelector(`${A} p`)?.textContent.includes('over two'), A);
    let boxes = await xray(page);
    assert.equal(boxes.length, 1, 'still there after the page was set again');
    assert.deepEqual(boxes[0].lines, [19], 'and moved down a line with the edit');
    assert.deepEqual(boxes[0].texts, ['What is in scope.']);
    await edit('What is in scope.\n\n', '');
    await page.waitForFunction((A) => !document.querySelector(`${A}`).textContent.includes('What is in scope'), A);
    boxes = await xray(page);
    assert.deepEqual(boxes, [], 'its part removed: the x-ray is dropped');
  });
});

test('12 X toggles Reveal on the page, putting the markup back around the reading', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page, { mod }) => {
    await blur(page);
    const on = () => page.evaluate((A) => document.querySelector(A).hasAttribute('data-marxy-reveal'), A);
    assert.equal(await on(), false);
    await keys(page, 'j', 'Shift+X');
    assert.equal(await on(), true);
    const marks = await page.evaluate((A) => [...document.querySelectorAll(`${A} .marxy-reveal-mark`)].map((m) => m.textContent), A);
    for (const m of ['# ', '## ', '- ', '[', '](#deep)', '*', '`', '```ts', '```', '[ ]']) assert.ok(marks.includes(m), `mark ${JSON.stringify(m)} in ${JSON.stringify(marks)}`);
    const copied = await copyOf(page, mod, (A) => [...document.querySelectorAll(`${A} p`)].find((x) => x.textContent.includes('See')));
    assert.equal(copied, 'See [the scope](#deep) and *this* and `code`.', 'a copy in Reveal takes what is drawn');
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await blur(page);
    await keys(page, 'Shift+X');
    assert.equal(await on(), false);
    assert.equal(await page.evaluate((A) => document.querySelectorAll(`${A} .marxy-reveal-mark`).length, A), 0);
  });
});

const folds = (page) =>
  page.evaluate((A) => ({
    out: document.querySelectorAll(`${A} .marxy-fold-out`).length,
    folded: [...document.querySelectorAll(`${A} .marxy-folded`)].map((h) => `${h.textContent.trim()} (${h.getAttribute('data-marxy-folded')})`),
  }), A);

test('14a z folds a heading section and unfolds it; the cursor passes over what is folded', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await goTo(page, 'Scope');
    const bar = await cur(page);
    assert.ok(bar.verbs.includes('z fold') && bar.verbs.includes('v only this') && bar.verbs.includes('x x-ray'), JSON.stringify(bar.verbs));
    await keys(page, 'z');
    assert.deepEqual(await folds(page), { out: 3, folded: ['Scope (3 parts, 8 lines)'] });
    await keys(page, 'j');
    assert.equal(await page.evaluate((A) => document.querySelector(`${A} .marxy-cursor`).textContent.trim(), A), 'Later', 'j steps over the folded parts');
    await keys(page, 'k', 'z');
    assert.deepEqual(await folds(page), { out: 0, folded: [] }, 'after the second z');
  });
});

test('z inside a section folds the section and puts the cursor on its heading', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await goTo(page, 'a task to do');
    await keys(page, 'l', 'z');
    assert.deepEqual((await folds(page)).folded, ['Scope (3 parts, 8 lines)']);
    const c = await cur(page);
    assert.deepEqual([c.kind, c.where], ['section', 'plan.md:16–24']);
  });
});

test('z on an inline part folds its section and puts the cursor on that heading, not the one above', async () => {
  await withFrame({ files: FILES, open: ['/r/inline.md'] }, async (page) => {
    await page.click(`${A} em`);
    const inline = await page.evaluate(() => window.__marxyHandle.selection.state().selection.node?.type);
    assert.equal(inline, 'emphasis');
    await keys(page, 'z');
    assert.deepEqual((await folds(page)).folded, ['Sub (1 part, 2 lines)']);
    const c = await cur(page);
    assert.deepEqual([c.kind, c.where], ['section', 'inline.md:3–5']);
  });
});

test('a fold and an x-ray stay on their parts when the section is promoted, demoted or moved', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await goTo(page, 'Vendor');
    await keys(page, 'j', 'x');
    const ray = async () => (await xray(page)).map((x) => x.lines);
    assert.deepEqual(await ray(), [[12, 13, 14]]);
    await goTo(page, 'Later');
    await keys(page, 'z');
    const folded = (await folds(page)).folded;
    assert.equal(folded.length, 1);
    const level = () => page.evaluate((A) => document.querySelector(`${A} .marxy-folded`)?.tagName, A);
    assert.equal(await level(), 'H2');
    await page.keyboard.press('Shift+<');
    await page.waitForFunction((A) => document.querySelector(`${A} .marxy-folded`)?.tagName === 'H1', A);
    assert.deepEqual((await folds(page)).folded, folded, 'promoted');
    await page.keyboard.press('Shift+>');
    await page.waitForFunction((A) => document.querySelector(`${A} .marxy-folded`)?.tagName === 'H2', A);
    assert.deepEqual((await folds(page)).folded, folded, 'demoted');
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().version > 0 && new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).indexOf('## Later') < new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).indexOf('## Scope'));
    await page.waitForTimeout(200);
    assert.deepEqual((await folds(page)).folded, folded, 'moved up');
    assert.deepEqual(await ray(), [[12, 13, 14]], 'the x-ray before it all along');
  });
});

test('14b Z folds everything to the second-level headings; Z again opens it', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    await keys(page, 'j', 'Shift+Z');
    const a = await folds(page);
    assert.deepEqual(a.folded.map((f) => f.split(' (')[0]), ['Vendor', 'Scope', 'Later']);
    assert.ok(a.out > 0);
    await keys(page, 'Shift+Z');
    assert.deepEqual(await folds(page), { out: 0, folded: [] });
  });
});

test('find and a link landing inside a fold open it', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page, { mod }) => {
    await blur(page);
    await keys(page, 'j', 'Shift+Z');
    await page.click(`${A} a[href="#deep"]`);
    await page.waitForFunction((A) => document.querySelectorAll(`${A} .marxy-folded`).length === 2, A);
    assert.deepEqual((await folds(page)).folded.map((f) => f.split(' (')[0]), ['Vendor', 'Scope'], 'the link opened Later, which held its heading');
    assert.equal(await page.evaluate((A) => document.querySelector(`${A} #deep`).getBoundingClientRect().height > 0, A), true);
    await keys(page, `${mod}+f`);
    await page.keyboard.type('needle');
    await page.waitForFunction((A) => document.querySelectorAll(`${A} .marxy-folded`).length === 1, A);
    assert.deepEqual((await folds(page)).folded.map((f) => f.split(' (')[0]), ['Vendor'], 'find opened Scope, which held the match');
  });
});

test('a goto into a fold or past only-this opens it, and the cursor lands on a part shown', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    await keys(page, 'j', 'Shift+Z');
    const byteOf = (text) => new TextEncoder().encode(DOC.slice(0, DOC.indexOf(text))).length;
    assert.ok(await page.evaluate((at) => window.__marxyHandle.selection.cursorAt(at), byteOf('What is in scope.')));
    assert.deepEqual((await folds(page)).folded.map((f) => f.split(' (')[0]), ['Vendor', 'Later'], 'Scope, which held it, is open');
    const shown = () => page.evaluate((A) => {
      const el = document.querySelector(`${A} .marxy-cursor`);
      return el ? [el.textContent.trim(), el.getBoundingClientRect().height > 0] : null;
    }, A);
    assert.deepEqual(await shown(), ['What is in scope.', true]);
    await keys(page, 'v');
    assert.ok(await page.evaluate((at) => window.__marxyHandle.selection.cursorAt(at), byteOf('Later text.')));
    assert.equal(await page.evaluate((A) => document.querySelectorAll(`${A} .marxy-focus-out`).length, A), 0, 'only-this let go');
    assert.deepEqual(await shown(), ['Later text.', true]);
  });
});

test('15 v shows only the part; Escape brings the rest back', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await goTo(page, 'What is in scope');
    await keys(page, 'v');
    const a = await page.evaluate((A) => {
      const tops = [...document.querySelector(A).children].filter((x) => !x.classList.contains('marxy-elide'));
      return {
        out: tops.filter((x) => x.classList.contains('marxy-focus-out')).length,
        shown: tops.filter((x) => !x.classList.contains('marxy-focus-out')).map((x) => x.textContent.trim()),
        elide: [...document.querySelectorAll(`${A} .marxy-elide`)].map((e) => e.getAttribute('data-marxy-elide')),
      };
    }, A);
    assert.ok(a.out > 5, `others are out (${a.out})`);
    assert.deepEqual(a.shown, ['What is in scope.'], 'only the selected part is left');
    assert.deepEqual(a.elide, ['7 parts · lines 1–16', '6 parts · lines 20–32']);
    assert.equal((await cur(page)).kind, 'node', 'the cursor stays');
    await keys(page, 'Escape');
    const n = await page.evaluate((A) => document.querySelectorAll(`${A} .marxy-focus-out, ${A} .marxy-elide`).length, A);
    assert.equal(n, 0, 'the first Escape brings the rest back');
    assert.equal((await cur(page)).kind, 'node', 'and keeps the cursor');
    await keys(page, 'Escape');
    assert.equal((await cur(page)).kind, 'none', 'the second lets go of it');
  });
});

test('the depths keys are the page\'s: inert in Source and with verbs off', async () => {
  const dressed = (page) => page.evaluate((A) => document.querySelector(A).hasAttribute('data-marxy-reveal') || document.querySelectorAll(`${A} .marxy-folded`).length > 0, A);
  await withFrame({ files: FILES, open: ['/r/plan.md'], config: 'verbs = false\n' }, async (page) => {
    await blur(page);
    await keys(page, 'Shift+X', 'Shift+Z');
    assert.equal(await dressed(page), false, 'verbs off');
  });
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    await keys(page, 'g', 'g', '\\');
    await page.waitForSelector('[data-marxy-pane="0"] .cm-editor');
    await blur(page);
    await keys(page, 'Shift+X', 'Shift+Z');
    assert.equal(await dressed(page), false, 'in Source');
  });
});
